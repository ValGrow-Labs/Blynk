/*
 * The "Add to Home Screen" hint for iPhone visitors (owner's brother, 2026-11-05: most Beruwala
 * customers use iPhones). iOS has no install prompt, so we point at Safari's Share button. Pure
 * rules here; the bar itself is src/components/IosInstallHint.web.tsx.
 *
 * Shown only in Safari on an iPhone / iPad / iPod that is NOT already running Blynk from the Home
 * Screen, and not again for HINT_QUIET_DAYS after it was closed or ran its course.
 */

export const HINT_KEY = 'blynk.iosHint.shownAt';
/** Days the hint stays away after it was shown (closed, or left to fade). */
export const HINT_QUIET_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HintEnv = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** navigator.standalone === true (iOS) */
  navigatorStandalone?: boolean;
  /** matchMedia('(display-mode: standalone)').matches */
  displayStandalone?: boolean;
  /** Epoch ms of the last time the hint was shown, or null. */
  lastShownAt: number | null;
  now: number;
};

/** iPhone, iPod, iPad (including iPadOS, which calls itself a Mac with a touch screen). */
export function isIos(userAgent: string, platform = '', maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/**
 * Safari itself. Chrome, Firefox, Edge and Opera on iOS can add to the Home Screen too, but their
 * menus differ from the instructions, and in-app browsers (Facebook, Instagram, TikTok, LINE, Gmail
 * ...) cannot at all: the hint would only mislead there.
 */
export function isIosSafari(userAgent: string): boolean {
  if (!/Safari\//.test(userAgent)) return false; // WKWebView shells (in-app browsers) omit it
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Snapchat|Twitter|Pinterest|MicroMessenger|GoogleApp/.test(userAgent);
}

export function inQuietPeriod(lastShownAt: number | null, now: number, days = HINT_QUIET_DAYS): boolean {
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return false;
  // a clock set back must not hide the hint for ever
  if (lastShownAt > now) return false;
  return now - lastShownAt < days * DAY_MS;
}

export function shouldShowIosHint(env: HintEnv): boolean {
  if (!isIos(env.userAgent, env.platform, env.maxTouchPoints)) return false;
  if (env.navigatorStandalone === true || env.displayStandalone === true) return false;
  if (!isIosSafari(env.userAgent)) return false;
  return !inQuietPeriod(env.lastShownAt, env.now);
}

/** The stored value -> epoch ms, or null (nothing stored, or not a number). */
export function parseShownAt(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
