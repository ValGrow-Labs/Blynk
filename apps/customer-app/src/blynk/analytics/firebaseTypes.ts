/*
 * The two thin shims the phone build wires to Firebase (firebaseAnalytics.native.ts). Everything
 * else (event mapping, consent, privacy) is pure code that talks to these interfaces, so Node tests
 * inject a fake. Every method may throw or return a promise: callers (firebaseSink.ts) swallow both.
 */
export type AnalyticsShim = {
  logEvent(name: string, params?: Record<string, unknown>): unknown;
  /** null clears the user id. */
  setUserId(id: string | null): unknown;
  setUserProperty(name: string, value: string | null): unknown;
  setCollectionEnabled(enabled: boolean): unknown;
};

export type CrashlyticsShim = {
  log(message: string): unknown;
  recordError(error: Error, name?: string): unknown;
  /** An empty string clears the user id (Crashlytics has no null). */
  setUserId(id: string): unknown;
  setCollectionEnabled(enabled: boolean): unknown;
};

export type FirebaseShim = { analytics: AnalyticsShim; crashlytics: CrashlyticsShim };
