/**
 * Firebase on the web and in Node: there is none (the web shop reports through Google Tag Manager,
 * see track.ts). The phone build gets firebaseAnalytics.native.ts instead, which wires
 * @react-native-firebase/analytics and /crashlytics. Never import this file's own name from the
 * native one (src/blynk/lib/platformFiles.test.ts): both only share ./firebaseTypes.
 */
import type { FirebaseShim } from './firebaseTypes';

export const nativeFirebase = (): FirebaseShim | null => null;
