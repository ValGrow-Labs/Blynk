/*
 * What every platform shares for the GPS fix: the result types, the plausibility check and the
 * old locateOnce() adapter. It lives in its own file, NOT in position.ts, because position.native.ts
 * replaces position.ts on a phone (Metro resolves ./position to the .native file there), so the
 * native files must never import "./position" (they would import themselves and get undefined).
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
