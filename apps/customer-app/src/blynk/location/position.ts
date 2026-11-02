/*
 * One GPS fix for the delivery spot. The same call on every platform:
 *   getCurrentPosition() -> { ok: true, lat, lng, accuracy } | { ok: false, reason }
 * and it never throws or rejects. This file is the web (and Node) side: the browser's
 * navigator.geolocation, with the options the map screens always used. A phone gets
 * position.native.ts instead (expo-location; see nativePosition.ts).
 */

export type PositionFailure = 'denied' | 'unavailable' | 'timeout';
export type PositionResult =
  | { ok: true; lat: number; lng: number; accuracy: number }
  | { ok: false; reason: PositionFailure };

/** How long to wait for a fix before giving up. */
export const POSITION_TIMEOUT_MS = 10_000;
/** Reported when the device gives no accuracy figure (metres). */
export const UNKNOWN_ACCURACY_M = 1000;

/** A fix with plausible numbers, else null (a device must never send the map to NaN). */
export function validFix(lat: unknown, lng: unknown, accuracy: unknown): { lat: number; lng: number; accuracy: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const acc = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : UNKNOWN_ACCURACY_M;
  return { lat, lng, accuracy: acc };
}

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

const CODE: Record<PositionFailure, number> = { denied: 1, unavailable: 2, timeout: 3 };

/**
 * The old `locateOnce()` shape of the map screens: resolves { lat, lng }, rejects with a
 * { code } like GeolocationPositionError (so area/flow.ts gpsFailureOf keeps working).
 * `get` is whichever getCurrentPosition the platform has.
 */
export async function locateWith(get: () => Promise<PositionResult>): Promise<{ lat: number; lng: number }> {
  const r = await get();
  if (r.ok) return { lat: r.lat, lng: r.lng };
  throw Object.assign(new Error(r.reason), { code: CODE[r.reason] });
}
