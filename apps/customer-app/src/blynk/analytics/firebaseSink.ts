import { storage } from '../lib/storage';
import { nativeFirebase } from './firebaseAnalytics';
import { screenView, toFirebaseEvent, type FirebaseEvent } from './firebaseEvents';
import type { FirebaseShim } from './firebaseTypes';
import { redact } from './privacy';

/*
 * The phone's side of analytics and crash reporting (Google Analytics for Firebase + Crashlytics,
 * project blynk-15cd4). track.ts hands every event here next to its web dataLayer push; on the web
 * and in Node there is no Firebase (firebaseAnalytics.ts is a no-op), so everything below returns
 * false / does nothing.
 *
 * - Never throws, never blocks: every call into the shims is wrapped and its promise swallowed.
 * - Consent: `analyticsEnabled()` (storage, default ON because the privacy policy covers analytics
 *   and crash reports) turns Firebase collection and every call below off. No UI yet: a settings
 *   switch only has to call setAnalyticsEnabled().
 * - No personal data: events are shaped by firebaseEvents.ts (personal keys dropped), the user id
 *   is the internal customer id (never phone or name), error messages and stacks have phone- and
 *   email-looking text redacted.
 */

/** Storage key of the consent switch: '0' = off, anything else / nothing = on. */
export const ANALYTICS_ENABLED_KEY = 'blynk.app.analytics.enabled.v1';

let override: FirebaseShim | null | undefined; // tests

function shim(): FirebaseShim | null {
  try {
    return override !== undefined ? override : nativeFirebase();
  } catch {
    return null;
  }
}

/** Run a shim call: a throw or a rejected promise is dropped. */
function guard(f: () => unknown): boolean {
  try {
    const r = f();
    if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).then(undefined, () => {});
    return true;
  } catch {
    return false;
  }
}

/** Has the customer left reporting on (the default)? Read from storage on every call (cached by the store). */
export function analyticsEnabled(): boolean {
  try {
    return storage.get(ANALYTICS_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The shim to use right now: only on the phone and only while reporting is on. */
function active(): FirebaseShim | null {
  const s = shim();
  return s && analyticsEnabled() ? s : null;
}

/** Is Firebase listening (the phone with the native module, reporting on)? */
export const firebaseActive = (): boolean => active() !== null;

/** The consent switch: remembered, and Firebase collection follows it at once. */
export function setAnalyticsEnabled(on: boolean): void {
  try { storage.set(ANALYTICS_ENABLED_KEY, on ? '1' : '0'); } catch { /* the in-memory fallback holds it */ }
  const s = shim();
  if (!s) return;
  guard(() => s.analytics.setCollectionEnabled(on));
  guard(() => s.crashlytics.setCollectionEnabled(on && !isDev()));
  if (!on) lastError = { key: '', at: 0 };
}

let devOverride: boolean | undefined; // tests
const isDev = () => devOverride ?? (typeof __DEV__ !== 'undefined' && __DEV__);

/**
 * App start (the root layout): collection on or off by the consent switch. Crashlytics also stays
 * off in a development build (Metro, `expo run:android` debug) so test crashes do not fill the
 * production dashboard; a release build always reports.
 */
export function initFirebase(): void {
  const s = shim();
  if (!s) return;
  const on = analyticsEnabled();
  guard(() => s.analytics.setCollectionEnabled(on));
  guard(() => s.crashlytics.setCollectionEnabled(on && !isDev()));
}

function sendEvent(e: FirebaseEvent | null): boolean {
  const s = active();
  if (!s || !e) return false;
  return guard(() => s.analytics.logEvent(e.name, e.params));
}

/** A (sanitized) dataLayer entry as a Firebase event; false when nothing listens or the phone does not send it. */
export const sendFirebase = (entry: Record<string, unknown>): boolean => sendEvent(toFirebaseEvent(entry));

/** The phone's page view: `screen_view` plus a Crashlytics breadcrumb. */
export function sendScreen(route: string, title: string): boolean {
  const ok = sendEvent(screenView(route, title));
  logBreadcrumb(`screen: ${route}`);
  return ok;
}

/** Who is shopping: the internal customer id on both Analytics and Crashlytics; null clears both. */
export function firebaseIdentify(userId: string | null): boolean {
  const s = active();
  if (!s) return false;
  const a = guard(() => s.analytics.setUserId(userId));
  guard(() => s.crashlytics.setUserId(userId ?? ''));
  return a;
}

/** The app's language as the `app_language` user property (en / si / ta). */
export function firebaseSetLanguage(lang: string): boolean {
  const s = active();
  if (!s) return false;
  return guard(() => s.analytics.setUserProperty('app_language', lang));
}

/** A Crashlytics breadcrumb (it travels with the next crash or recorded error). */
export function logBreadcrumb(message: string): boolean {
  const s = active();
  if (!s) return false;
  return guard(() => s.crashlytics.log(message.slice(0, 200)));
}

/* ------------------------------------------------------------------ errors */

/** A copy of the error safe to send: phone- and email-looking text in message and stack is redacted. */
export function safeError(e: unknown): Error {
  let message = '';
  let name = 'Error';
  let stack: string | undefined;
  if (e instanceof Error) {
    message = e.message; name = e.name || 'Error'; stack = e.stack;
  } else if (typeof e === 'string') {
    message = e;
  } else if (e && typeof e === 'object') {
    const o = e as { message?: unknown; name?: unknown; code?: unknown };
    message = typeof o.message === 'string' ? o.message : typeof o.code === 'string' ? o.code : 'Non-error thrown';
    if (typeof o.name === 'string') name = o.name;
  } else {
    message = String(e);
  }
  const out = new Error(redact(message).slice(0, 500));
  out.name = name;
  out.stack = stack ? redact(stack) : undefined;
  return out;
}

let lastError = { key: '', at: 0 };

/**
 * Report a handled error (or a render error from the root ErrorBoundary) to Crashlytics as a
 * non-fatal. A pure no-op on the web and in Node; never throws; the same error again within 10 s is
 * one report (a render loop must not flood Crashlytics).
 */
export function reportError(e: unknown, now = Date.now()): boolean {
  try {
    const s = active();
    if (!s) return false;
    const err = safeError(e);
    const key = `${err.name}:${err.message}`;
    if (key === lastError.key && now - lastError.at < 10_000) return false;
    lastError = { key, at: now };
    return guard(() => s.crashlytics.recordError(err));
  } catch {
    return false;
  }
}

/** For tests: inject the shims (null = none, undefined = the real ones) and forget what is remembered. */
export function setFirebaseForTests(s: FirebaseShim | null | undefined, opts: { dev?: boolean } = {}) {
  override = s;
  devOverride = opts.dev;
  lastError = { key: '', at: 0 };
}
