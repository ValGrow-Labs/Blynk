import { router } from 'expo-router';
import { Platform } from 'react-native';
import { registerDevice, unregisterDevice } from '@/blynk/api/push';
import { splashHandover } from '@/lib/splash';
import { createPushManager, type PushPermission } from './manager';
import { createTargetOpener } from './openTarget';
import { createPushPlatform } from './platformFactory';

/*
 * The app's push instance: web push in the PWA, Firebase Cloud Messaging in the Android app
 * (platformFactory). Started and kept in step with the session by <SessionEffects /> in the root
 * layout. Other screens only ever call requestPushPermission(), from a tap:
 *   - agent c1: right after "Place order" succeeds (Flutter: cart_screen_payment_container);
 *   - agent c3: when "Notify me" is switched on (Flutter: notify_me_button);
 *   - the account screen's "Order updates" row.
 */

const STARTED_AT = Date.now();
/** The launch intro ends ~0.7 s in with router.replace('/home'); a tap that launched the app waits for it. */
const INTRO_MS = 1_500;

// A tapped notification opens its screen (target.ts); on the phone a launching tap waits for the intro.
const openTarget = createTargetOpener({
  navigate: (path) => router.push(path as never),
  ready: () => Platform.OS === 'web' || (Date.now() - STARTED_AT >= INTRO_MS && splashHandover.get() !== 'covering'),
});

export const push = createPushManager({
  platform: createPushPlatform,
  register: registerDevice,
  unregister: (token, accessToken) => unregisterDevice(token, accessToken),
  onTap: openTarget,
});

/** Ask to allow notifications (call it from the tap that makes them useful). Never throws. */
export function requestPushPermission(): Promise<PushPermission> {
  return push.requestPermission().catch(() => 'unsupported' as const);
}

export type { PushPermission } from './manager';
