import { writePendingReferral } from '@/blynk/rewards/api';
import { nativeIntentPath } from '@/blynk/share/nativeIntent';

/** Expo Router, phone only: every incoming link (cold start or while running) is mapped here first. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return nativeIntentPath(path, writePendingReferral);
}
