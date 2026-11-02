/*
 * One GPS fix for the delivery spot. The same call on every platform:
 *   getCurrentPosition() -> { ok: true, lat, lng, accuracy } | { ok: false, reason }
 * and it never throws or rejects. This file is the web (and Node) side: the browser's
 * navigator.geolocation, with the options the map screens always used. A phone gets
 * position.native.ts instead (expo-location; see nativePosition.ts).
 */

import { POSITION_TIMEOUT_MS, validFix, type PositionFailure, type PositionResult } from './positionShared';

export * from './positionShared';

type Geo = {
  getCurrentPosition(
    ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    fail: (e: { code?: number }) => void,
    o?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void;
};

/** GeolocationPositionError.code: 1 denied, 2 unavailable, 3 timeout. */
const failureOfCode = (code: unknown): PositionFailure => (code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');

/** The browser's geolocation as a PositionResult. `geo` is injectable for tests. */
export function webPosition(
  geo: Geo | null | undefined = (globalThis as { navigator?: { geolocation?: Geo } }).navigator?.geolocation,
  timeout = POSITION_TIMEOUT_MS,
): Promise<PositionResult> {
  return new Promise<PositionResult>((resolve) => {
    if (!geo) { resolve({ ok: false, reason: 'unavailable' }); return; }
    try {
      geo.getCurrentPosition(
        (p) => {
          const fix = validFix(p?.coords?.latitude, p?.coords?.longitude, p?.coords?.accuracy);
          resolve(fix ? { ok: true, ...fix } : { ok: false, reason: 'unavailable' });
        },
        (e) => resolve({ ok: false, reason: failureOfCode(e?.code) }),
        { enableHighAccuracy: true, timeout, maximumAge: 30_000 },
      );
    } catch {
      resolve({ ok: false, reason: 'unavailable' });
    }
  });
}

export const getCurrentPosition = (): Promise<PositionResult> => webPosition();

/**
 * Set on a phone (position.native.ts), null on the web: the old `locateOnce()` shape built on
 * getCurrentPosition. The map screens keep their browser code when this is null.
 */
export const phoneLocateOnce: (() => Promise<{ lat: number; lng: number }>) | null = null;

