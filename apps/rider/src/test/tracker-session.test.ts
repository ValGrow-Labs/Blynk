import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { __resetTrackerSessionForTests, getTracker, syncTracking } from '../lib/tracker-session';
import type { TrackingPoint } from '../lib/tracking-plugin';
import { summary } from './helpers';

// A fake plugin and a fake send: the real plugin needs a native bridge and
// the real send needs the network. Neither is touched here.
const h = vi.hoisted(() => {
  const fake = {
    onPoint: (() => {}) as (p: TrackingPoint) => void,
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async (onPoint: (p: TrackingPoint) => void) => {
      fake.onPoint = onPoint;
    }),
    stop: vi.fn(async () => undefined),
  };
  return { fake, sendLocation: vi.fn() };
});

vi.mock('../lib/tracking-plugin', () => ({ capacitorTrackingPlugin: h.fake }));
vi.mock('../api/resources', () => ({ deliveriesApi: { sendLocation: h.sendLocation } }));

const onRoad = (delivery_id = 'd-1') =>
  summary({ delivery_id, assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' });

let clock = Date.parse('2026-09-19T10:00:00Z');
const point = (): TrackingPoint => ({
  latitude: 6.4,
  longitude: 80.0,
  accuracy: 10,
  // Far apart in time so the tracker's throttle never swallows a test point.
  capturedAt: new Date((clock += 60_000)),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.sendLocation.mockResolvedValue({ accepted: true });
  __resetTrackerSessionForTests();
});

describe('syncTracking', () => {
  it('starts tracking a trackable delivery, once, however often it is synced', async () => {
    await syncTracking(onRoad());
    await syncTracking(onRoad());
    await syncTracking(onRoad());
    expect(h.fake.start).toHaveBeenCalledTimes(1);
    expect(getTracker().getDeliveryId()).toBe('d-1');
    expect(getTracker().getState().active).toBe(true);
  });

  it('does not double-start when syncs overlap', async () => {
    await Promise.all([syncTracking(onRoad()), syncTracking(onRoad())]);
    expect(h.fake.start).toHaveBeenCalledTimes(1);
  });

  it('a different trackable delivery stops the old tracking first, then starts the new one', async () => {
    await syncTracking(onRoad('d-old'));
    await syncTracking(onRoad('d-new'));
    expect(h.fake.stop).toHaveBeenCalledTimes(1);
    expect(h.fake.start).toHaveBeenCalledTimes(2);
    expect(h.fake.stop.mock.invocationCallOrder[0]).toBeLessThan(h.fake.start.mock.invocationCallOrder[1]);
    expect(getTracker().getDeliveryId()).toBe('d-new');

    // Points after the switch belong to the new delivery only.
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));
    expect(h.sendLocation.mock.calls.map((c) => c[0])).toEqual(['d-new']);
  });

  it('stops for null and for every non-trackable state, including arrival', async () => {
    const closed = [
      null,
      summary({ assignment_status: 'PICKED_UP', order_status: 'CANCELLED' }),
      summary({ assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' }),
      summary({ assignment_status: 'DELIVERED', order_status: 'DELIVERED' }),
      summary({ assignment_status: 'FAILED', order_status: 'FAILED' }),
    ];
    for (const next of closed) {
      vi.clearAllMocks();
      await syncTracking(onRoad());
      expect(getTracker().getState().active).toBe(true);
      await syncTracking(next);
      expect(h.fake.stop).toHaveBeenCalledTimes(1);
      expect(getTracker().getDeliveryId()).toBeNull();
      expect(getTracker().getState().active).toBe(false);
    }
  });

  it('does not touch the plugin when there is nothing to stop', async () => {
    await syncTracking(null);
    await syncTracking(summary({ assignment_status: 'ASSIGNED', order_status: 'PACKED' }));
    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(h.fake.start).not.toHaveBeenCalled();
  });

  it('sends points with the delivery id and the API payload shape', async () => {
    await syncTracking(onRoad());
    const p = point();
    h.fake.onPoint(p);
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));
    expect(h.sendLocation).toHaveBeenCalledWith('d-1', {
      latitude: 6.4,
      longitude: 80.0,
      accuracy: 10,
      captured_at: p.capturedAt.toISOString(),
    });
  });
});

describe('server-authoritative stop', () => {
  it('a 409 from the location endpoint stops the tracker and is not reported as a network problem', async () => {
    h.sendLocation.mockRejectedValueOnce(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await syncTracking(onRoad());
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.fake.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getTracker().getState().active).toBe(false));
    expect(getTracker().getDeliveryId()).toBeNull();
    expect(getTracker().getState().lastError).toBeNull();
    expect(getTracker().getState().lastSentAt).toBeNull();
  });

  it('a 409 for an old delivery does not stop the tracking of the one that replaced it', async () => {
    let rejectOld: (e: unknown) => void = () => {};
    h.sendLocation.mockImplementationOnce(() => new Promise((_, reject) => (rejectOld = reject)));
    await syncTracking(onRoad('d-old'));
    h.fake.onPoint(point());
    await vi.waitFor(() => expect(h.sendLocation).toHaveBeenCalledTimes(1));

    await syncTracking(onRoad('d-new'));
    h.fake.stop.mockClear();
    rejectOld(new ApiError('Not trackable.', 409, 'DELIVERY_NOT_TRACKABLE'));
    await new Promise((r) => setTimeout(r, 20));

    expect(h.fake.stop).not.toHaveBeenCalled();
    expect(getTracker().getDeliveryId()).toBe('d-new');
    expect(getTracker().getState().active).toBe(true);
  });

  it('any other failure keeps tracking and reports a network problem', async () => {
    for (const err of [new ApiError('Could not reach the Blynk API.', 0, 'NETWORK'), new ApiError('Boom', 500, 'INTERNAL')]) {
      __resetTrackerSessionForTests();
      vi.clearAllMocks();
      h.sendLocation.mockRejectedValueOnce(err);
      await syncTracking(onRoad());
      h.fake.onPoint(point());
      await vi.waitFor(() => expect(getTracker().getState().lastError).toBe('network'));
      expect(h.fake.stop).not.toHaveBeenCalled();
      expect(getTracker().getState().active).toBe(true);
      expect(getTracker().getDeliveryId()).toBe('d-1');
    }
  });
});
