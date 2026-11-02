import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { isLowEnd } from '@/blynk/lib/lowEndRule';

/*
 * True on a low-end phone (3 GB of RAM or less, or Android 9 and older; the rule and its tests are
 * in src/blynk/lib/lowEndRule.ts). Read once: the facts never change while the app runs. The heavy
 * decorative loops (banner clouds and sparkles, tab hero idle, promo mascot, empty-cart art, the
 * rolling price line) draw still when this is true.
 */
function read(): boolean {
  try {
    return isLowEnd({ totalMemory: Device.totalMemory, os: Platform.OS, osVersion: Platform.Version });
  } catch {
    return false; // never let a device lookup break the first screen
  }
}

export const LOW_END: boolean = read();
