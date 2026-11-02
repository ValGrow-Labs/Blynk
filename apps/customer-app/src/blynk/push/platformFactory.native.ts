import { Platform } from 'react-native';
import { DEMO } from '@/demo/mode';
import type { PushPlatform } from './manager';
import { createNativePushPlatform } from './nativePlatform';

/*
 * The phone build (see platformFactory.ts). Android only: the backend sends through Firebase
 * Cloud Messaging, and an iPhone's native token is an APNs token FCM cannot use without an
 * Apple key, so iOS has no push for now. DEMO stays off.
 */
export function createPushPlatform(): PushPlatform | null {
  return Platform.OS === 'android' && !DEMO ? createNativePushPlatform() : null;
}
