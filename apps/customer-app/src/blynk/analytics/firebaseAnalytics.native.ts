import { getAnalytics, logEvent, setAnalyticsCollectionEnabled, setUserId, setUserProperty } from '@react-native-firebase/analytics';
import {
  getCrashlytics, log, recordError, setCrashlyticsCollectionEnabled, setUserId as setCrashlyticsUserId,
} from '@react-native-firebase/crashlytics';
import type { FirebaseShim } from './firebaseTypes';

/*
 * The phone's Firebase (React Native Firebase 26, modular API; Google Analytics for Firebase and
 * Crashlytics of project blynk-15cd4, lk.blynk.customer). Created once, on first use. When the
 * native module is not in this build (Expo Go, a build made before the packages were added) the
 * factory throws inside the try and the app simply reports nothing: it never crashes for it.
 * Crashlytics' instance also installs its JS global error handler (fatal errors and unhandled
 * promise rejections), so it is created here even before the first explicit log.
 */
let cached: FirebaseShim | null | undefined;

export function nativeFirebase(): FirebaseShim | null {
  if (cached !== undefined) return cached;
  try {
    const analytics = getAnalytics();
    const crashlytics = getCrashlytics();
    // logEvent's overloads are typed per GA4 event name; ours are built from names at run time
    const send = logEvent as unknown as (a: typeof analytics, name: string, params?: Record<string, unknown>) => unknown;
    cached = {
      analytics: {
        logEvent: (name, params) => send(analytics, name, params),
        setUserId: (id) => setUserId(analytics, id),
        setUserProperty: (name, value) => setUserProperty(analytics, name, value),
        setCollectionEnabled: (enabled) => setAnalyticsCollectionEnabled(analytics, enabled),
      },
      crashlytics: {
        log: (message) => log(crashlytics, message),
        recordError: (error, name) => recordError(crashlytics, error, name),
        setUserId: (id) => setCrashlyticsUserId(crashlytics, id),
        setCollectionEnabled: (enabled) => setCrashlyticsCollectionEnabled(crashlytics, enabled),
      },
    };
  } catch {
    cached = null;
  }
  return cached;
}
