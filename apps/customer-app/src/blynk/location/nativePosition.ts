import { POSITION_TIMEOUT_MS, validFix, type PositionResult } from './positionShared';

/*
 * The phone's GPS fix on top of expo-location (SDK 57): foreground permission, then
 * getCurrentPositionAsync at balanced accuracy, with our own 10 s limit (the call has no timeout
 * option). Never throws. The module is injected so this file is tested in Node; the real one is
 * wired in position.native.ts.
 */
export type LocationModule = {
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{ coords: { latitude: number; longitude: number; accuracy: number | null } }>;
  Accuracy: { Balanced: number };
};

type Timers = { set(f: () => void, ms: number): unknown; clear(t: unknown): void };
const realTimers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) };

export function createNativePosition(Loc: LocationModule, timeoutMs = POSITION_TIMEOUT_MS, timers: Timers = realTimers) {
  return async function getCurrentPosition(): Promise<PositionResult> {
    try {
      const perm = await Loc.requestForegroundPermissionsAsync();
      if (perm?.status !== 'granted') return { ok: false, reason: 'denied' };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    let timer: unknown;
    const timedOut = new Promise<PositionResult>((resolve) => {
      timer = timers.set(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
    });
    const fix = (async (): Promise<PositionResult> => {
      try {
        const p = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
        const v = validFix(p?.coords?.latitude, p?.coords?.longitude, p?.coords?.accuracy);
        return v ? { ok: true, ...v } : { ok: false, reason: 'unavailable' };
      } catch {
        // location services switched off, no provider, or the system refused
        return { ok: false, reason: 'unavailable' };
      }
    })();
    try {
      return await Promise.race([fix, timedOut]);
    } finally {
      timers.clear(timer);
    }
  };
}
