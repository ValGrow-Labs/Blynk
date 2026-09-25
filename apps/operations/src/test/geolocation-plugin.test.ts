import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserGeolocationPlugin } from '../lib/geolocation-plugin';

/**
 * `lib/geolocation-plugin.ts` - the only file that reads
 * `navigator.geolocation` directly (common.md rule 10; task-F4-brief.md's
 * "write this against injectable/mockable geolocation, not real browser
 * APIs"). jsdom does not implement the Geolocation API at all, so every test
 * here defines `navigator.geolocation`/`navigator.permissions` itself with a
 * fake, restoring both after each test - proving the plugin against an
 * injected fake, never a real browser API.
 */

function stubGeolocation(fake: Partial<Geolocation>) {
  Object.defineProperty(navigator, 'geolocation', { value: fake, configurable: true });
}

function stubPermissions(query: (desc: { name: string }) => Promise<{ state: string }>) {
  Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
}

afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
});

describe('checkPermission', () => {
  it('is unavailable when the browser has no Geolocation API at all', async () => {
    expect(await browserGeolocationPlugin.checkPermission()).toBe('unavailable');
  });

  it('is not_requested when Geolocation exists but the Permissions API does not', async () => {
    stubGeolocation({});
    expect(await browserGeolocationPlugin.checkPermission()).toBe('not_requested');
  });

  it('reads granted/denied from the Permissions API without prompting', async () => {
    stubGeolocation({});
    const query = vi.fn(async () => ({ state: 'granted' }));
    stubPermissions(query);
    expect(await browserGeolocationPlugin.checkPermission()).toBe('granted');

    stubPermissions(async () => ({ state: 'denied' }));
    expect(await browserGeolocationPlugin.checkPermission()).toBe('denied');

    stubPermissions(async () => ({ state: 'prompt' }));
    expect(await browserGeolocationPlugin.checkPermission()).toBe('not_requested');
  });

  it('falls back to not_requested if the Permissions API throws', async () => {
    stubGeolocation({});
    stubPermissions(async () => {
      throw new Error('not supported');
    });
    expect(await browserGeolocationPlugin.checkPermission()).toBe('not_requested');
  });
});

describe('requestPermission', () => {
  it('is unavailable when there is no Geolocation API', async () => {
    expect(await browserGeolocationPlugin.requestPermission()).toBe('unavailable');
  });

  it('resolves granted when getCurrentPosition succeeds', async () => {
    stubGeolocation({
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() } as GeolocationPosition);
      },
    });
    expect(await browserGeolocationPlugin.requestPermission()).toBe('granted');
  });

  it('resolves denied only for a PERMISSION_DENIED error (code 1)', async () => {
    stubGeolocation({
      getCurrentPosition: (_success, error) => {
        error!({ code: 1, message: 'denied' } as GeolocationPositionError);
      },
    });
    expect(await browserGeolocationPlugin.requestPermission()).toBe('denied');
  });

  it('resolves granted for a non-denial error (e.g. POSITION_UNAVAILABLE) - permission itself is fine', async () => {
    stubGeolocation({
      getCurrentPosition: (_success, error) => {
        error!({ code: 2, message: 'unavailable' } as GeolocationPositionError);
      },
    });
    expect(await browserGeolocationPlugin.requestPermission()).toBe('granted');
  });
});

describe('start/stop', () => {
  it('start() maps a watchPosition point into a TrackingPoint', async () => {
    const watchPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: 6.4, longitude: 80.0, accuracy: 12 },
        timestamp: 1_700_000_000_000,
      } as GeolocationPosition);
      return 42;
    });
    stubGeolocation({ watchPosition: watchPosition as unknown as Geolocation['watchPosition'], clearWatch: vi.fn() });

    const onPoint = vi.fn();
    const onError = vi.fn();
    await browserGeolocationPlugin.start(onPoint, onError);

    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(onPoint).toHaveBeenCalledWith({
      latitude: 6.4,
      longitude: 80.0,
      accuracy: 12,
      capturedAt: new Date(1_700_000_000_000),
    });
  });

  it('start() maps a watchPosition error to permission_denied/position_unavailable', async () => {
    let deliver: (err: GeolocationPositionError) => void = () => {};
    stubGeolocation({
      watchPosition: ((_s: unknown, error: PositionErrorCallback) => {
        deliver = error;
        return 1;
      }) as unknown as Geolocation['watchPosition'],
      clearWatch: vi.fn(),
    });
    const onError = vi.fn();
    await browserGeolocationPlugin.start(vi.fn(), onError);

    deliver({ code: 1, message: 'x' } as GeolocationPositionError);
    expect(onError).toHaveBeenLastCalledWith('permission_denied');
    deliver({ code: 2, message: 'x' } as GeolocationPositionError);
    expect(onError).toHaveBeenLastCalledWith('position_unavailable');
    deliver({ code: 3, message: 'x' } as GeolocationPositionError);
    expect(onError).toHaveBeenLastCalledWith('position_unavailable');
  });

  it('start() throws if there is no Geolocation API (callers never reach here - requestPermission already returned unavailable)', async () => {
    await expect(browserGeolocationPlugin.start(vi.fn(), vi.fn())).rejects.toThrow();
  });

  it('stop() clears the watch registered by start(), and is a no-op if nothing was started', async () => {
    const clearWatch = vi.fn();
    stubGeolocation({ watchPosition: (() => 7) as unknown as Geolocation['watchPosition'], clearWatch });
    await browserGeolocationPlugin.start(vi.fn(), vi.fn());
    await browserGeolocationPlugin.stop();
    expect(clearWatch).toHaveBeenCalledWith(7);

    clearWatch.mockClear();
    await browserGeolocationPlugin.stop();
    expect(clearWatch).not.toHaveBeenCalled();
  });
});
