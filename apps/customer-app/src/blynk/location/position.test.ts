import { describe, expect, test, vi } from 'vitest';
import { createNativePosition, type LocationModule } from './nativePosition';
import { getCurrentPosition, locateWith, phoneLocateOnce, validFix, webPosition } from './position';
import { gpsFailureOf } from '../area/flow';

const loc = (over: Partial<LocationModule> = {}): LocationModule => ({
  requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: 6.44, longitude: 80.01, accuracy: 12.5 } })),
  Accuracy: { Balanced: 3 },
  ...over,
});

describe('native position (expo-location)', () => {
  test('granted: asks for foreground permission, balanced accuracy, returns the fix', async () => {
    const L = loc();
    const r = await createNativePosition(L)();
    expect(r).toEqual({ ok: true, lat: 6.44, lng: 80.01, accuracy: 12.5 });
    expect(L.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(L.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: 3 });
  });

  test('denied permission: reason denied, no position is asked for', async () => {
    const L = loc({ requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'denied' })) });
    expect(await createNativePosition(L)()).toEqual({ ok: false, reason: 'denied' });
    expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
    const undetermined = loc({ requestForegroundPermissionsAsync: vi.fn(async () => ({ status: 'undetermined' })) });
    expect(await createNativePosition(undetermined)()).toEqual({ ok: false, reason: 'denied' });
  });

  test('the permission call itself failing is "unavailable", never a throw', async () => {
    const L = loc({ requestForegroundPermissionsAsync: vi.fn(async () => { throw new Error('boom'); }) });
    expect(await createNativePosition(L)()).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('location services off / no provider: unavailable', async () => {
    const L = loc({ getCurrentPositionAsync: vi.fn(async () => { throw new Error('Location provider is unavailable'); }) });
    expect(await createNativePosition(L)()).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('no answer within the limit: timeout (10 s by default)', async () => {
    vi.useFakeTimers();
    try {
      const L = loc({ getCurrentPositionAsync: vi.fn(() => new Promise<never>(() => {})) });
      const p = createNativePosition(L)();
      let done = false;
      void p.then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('a fix that arrives in time cancels the timer', async () => {
    const clear = vi.fn();
    const r = await createNativePosition(loc(), 10_000, { set: () => 7, clear })();
    expect(r.ok).toBe(true);
    expect(clear).toHaveBeenCalledWith(7);
  });

  test('numbers are validated: NaN, out-of-range and missing accuracy', async () => {
    const bad = loc({ getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: NaN, longitude: 80, accuracy: 5 } })) });
    expect(await createNativePosition(bad)()).toEqual({ ok: false, reason: 'unavailable' });
    const range = loc({ getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: 91, longitude: 80, accuracy: 5 } })) });
    expect(await createNativePosition(range)()).toEqual({ ok: false, reason: 'unavailable' });
    const noAcc = loc({ getCurrentPositionAsync: vi.fn(async () => ({ coords: { latitude: 6.4, longitude: 80, accuracy: null } })) });
    expect(await createNativePosition(noAcc)()).toEqual({ ok: true, lat: 6.4, lng: 80, accuracy: 1000 });
  });
});

describe('web position (browser geolocation)', () => {
  const geo = (fn: (ok: (p: unknown) => void, fail: (e: unknown) => void, o: unknown) => void) => ({ getCurrentPosition: fn }) as never;

  test('a fix, asked for with the options the map always used', async () => {
    let opts: unknown;
    const r = await webPosition(geo((ok, _f, o) => { opts = o; ok({ coords: { latitude: 6.4, longitude: 80, accuracy: 20 } }); }));
    expect(r).toEqual({ ok: true, lat: 6.4, lng: 80, accuracy: 20 });
    expect(opts).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  });

  test('error codes: 1 denied, 3 timeout, anything else unavailable; no API unavailable', async () => {
    const fail = (code: number) => webPosition(geo((_o, f) => f({ code })));
    expect(await fail(1)).toEqual({ ok: false, reason: 'denied' });
    expect(await fail(3)).toEqual({ ok: false, reason: 'timeout' });
    expect(await fail(2)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await webPosition(null)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await webPosition(geo(() => { throw new Error('x'); }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('getCurrentPosition never throws in Node (no geolocation)', async () => {
    expect(await getCurrentPosition()).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('phoneLocateOnce is null on the web build', () => {
    expect(phoneLocateOnce).toBeNull();
  });
});

describe('locateWith: the old locateOnce shape', () => {
  test('resolves a fix', async () => {
    expect(await locateWith(async () => ({ ok: true, lat: 1, lng: 2, accuracy: 3 }))).toEqual({ lat: 1, lng: 2 });
  });
  test('rejects with a GeolocationPositionError-like code that gpsFailureOf understands', async () => {
    for (const [reason, want] of [['denied', 'denied'], ['unavailable', 'unavailable'], ['timeout', 'timeout']] as const) {
      const err = await locateWith(async () => ({ ok: false, reason })).catch((e) => e);
      expect(gpsFailureOf(err)).toBe(want);
    }
  });
});

test('validFix', () => {
  expect(validFix(1, 2, 3)).toEqual({ lat: 1, lng: 2, accuracy: 3 });
  expect(validFix('1', 2, 3)).toBeNull();
  expect(validFix(0, 181, 3)).toBeNull();
  expect(validFix(0, 0, -1)).toEqual({ lat: 0, lng: 0, accuracy: 1000 });
});
