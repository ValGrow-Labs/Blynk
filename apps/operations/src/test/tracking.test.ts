import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackingPlugin, TrackingPoint } from '../lib/geolocation-plugin';
import { DeliveryTracker } from '../lib/tracking';

/**
 * `DeliveryTracker` (ported from apps/rider/src/lib/tracking.ts's own class,
 * common.md rule 2) against a fake `TrackingPlugin` - the real plugin needs a
 * real browser, which this test never touches (task-F4-brief.md: "write
 * this against injectable/mockable geolocation, not real browser APIs").
 */
function fakePlugin(): TrackingPlugin & {
  emit(p: TrackingPoint): void;
  emitError(code: 'permission_denied' | 'position_unavailable'): void;
} {
  let onPoint: (p: TrackingPoint) => void = () => {};
  let onError: (code: 'permission_denied' | 'position_unavailable') => void = () => {};
  return {
    async checkPermission() {
      return 'not_requested';
    },
    async requestPermission() {
      return 'granted';
    },
    async start(op, oe) {
      onPoint = op;
      onError = oe;
    },
    async stop() {},
    emit(p) {
      onPoint(p);
    },
    emitError(code) {
      onError(code);
    },
  };
}

describe('DeliveryTracker', () => {
  let plugin: ReturnType<typeof fakePlugin>;
  let send: ReturnType<typeof vi.fn>;
  let tracker: DeliveryTracker;

  beforeEach(() => {
    plugin = fakePlugin();
    send = vi.fn().mockResolvedValue(undefined);
    tracker = new DeliveryTracker(plugin, send);
  });

  it('requests permission and starts the plugin on start()', async () => {
    await tracker.start('delivery-1');
    expect(tracker.getState().permission).toBe('granted');
    expect(tracker.getState().active).toBe(true);
    expect(tracker.getDeliveryId()).toBe('delivery-1');
  });

  it('sends a point through the throttle and records lastSentAt', async () => {
    await tracker.start('delivery-1');
    plugin.emit({ latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('delivery-1', expect.objectContaining({ latitude: 6.4 })));
    expect(tracker.getState().lastSentAt).not.toBeNull();
  });

  it('suppresses a duplicate point that arrives before the minimum interval', async () => {
    await tracker.start('delivery-1');
    const p1 = { latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() };
    plugin.emit(p1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    plugin.emit({ ...p1, capturedAt: new Date(p1.capturedAt.getTime() + 500) });
    await new Promise((r) => setTimeout(r, 50));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports position_unavailable without crashing, and does not mark lastSentAt', async () => {
    await tracker.start('delivery-1');
    plugin.emitError('position_unavailable');
    expect(tracker.getState().lastError).toBe('position_unavailable');
    expect(tracker.getState().active).toBe(true); // still trying, not torn down
    expect(tracker.getState().lastSentAt).toBeNull();
  });

  it('a permission_denied error also flips permission to denied', async () => {
    await tracker.start('delivery-1');
    plugin.emitError('permission_denied');
    expect(tracker.getState().lastError).toBe('permission_denied');
    expect(tracker.getState().permission).toBe('denied');
  });

  it('a failed send sets a network error and does not advance lastSentAt', async () => {
    send.mockRejectedValueOnce(new Error('network'));
    await tracker.start('delivery-1');
    plugin.emit({ latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(tracker.getState().lastSentAt).toBeNull();
    expect(tracker.getState().lastError).toBe('network');
  });

  it('stop() calls the plugin and marks inactive; getDeliveryId() reports null once stopped', async () => {
    await tracker.start('delivery-1');
    expect(tracker.getDeliveryId()).toBe('delivery-1');
    await tracker.stop();
    expect(tracker.getState().active).toBe(false);
    expect(tracker.getDeliveryId()).toBeNull();
  });

  it('does not request/start the plugin when permission is refused', async () => {
    plugin.requestPermission = vi.fn(async (): Promise<'denied'> => 'denied');
    const startSpy = vi.spyOn(plugin, 'start');
    await tracker.start('delivery-1');
    expect(startSpy).not.toHaveBeenCalled();
    expect(tracker.getState().active).toBe(false);
    expect(tracker.getState().permission).toBe('denied');
  });
});
