/*
 * "Low-end phone" rule (src/lib/lowEnd.ts reads the device and calls this): heavy decorative loops
 * (banner clouds and sparkles, the tab heroes' idle animation, the promo mascot, the empty-cart art,
 * the rolling price line) render still on these phones. Pure, so it is tested with injected values.
 */

/** 3 GB of RAM or less. Android reports less than the sticker (a "3 GB" phone ~2.8 GiB, a "4 GB" phone ~3.6 GiB), so the line sits between: 3.3 GiB. */
export const LOW_END_RAM_BYTES = 3.3 * 1024 * 1024 * 1024;
/** Android 9 (API level 28) and older. */
export const LOW_END_MAX_API = 28;

export interface DeviceFacts {
  /** expo-device totalMemory in bytes, null when unknown. */
  totalMemory: number | null | undefined;
  os: string;
  /** Platform.Version: the API level (a number) on Android, a string such as "17.2" on iOS. */
  osVersion: number | string | undefined;
}

export function isLowEnd(d: DeviceFacts): boolean {
  if (typeof d.totalMemory === 'number' && d.totalMemory > 0 && d.totalMemory <= LOW_END_RAM_BYTES) return true;
  if (d.os === 'android') {
    const api = typeof d.osVersion === 'number' ? d.osVersion : Number(d.osVersion);
    if (Number.isFinite(api) && api > 0 && api <= LOW_END_MAX_API) return true;
  }
  return false;
}
