import { Platform } from 'react-native';
import { DEMO } from '@/demo/mode';
import type { PushPlatform } from './manager';
import { createWebPushPlatform } from './webPlatform';

/*
 * The push platform for this build: the browser's Firebase web push in the PWA (this file, which
 * the web bundle uses); the phone's FCM registration in the Android app (platformFactory.native.ts,
 * so expo-notifications never loads in the browser). Null = push is off (the demo, or a platform
 * with no push). DEMO stays off everywhere.
 */
export function createPushPlatform(): PushPlatform | null {
  return Platform.OS === 'web' && !DEMO ? createWebPushPlatform() : null;
}
