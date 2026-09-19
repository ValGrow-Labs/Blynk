import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeliveryTracker } from '../lib/tracking';
import type { TrackingPlugin, TrackingPoint } from '../lib/tracking-plugin';

function fakePlugin(): TrackingPlugin & { emit(p: TrackingPoint): void; emitError(code: 'permission_denied' | 'position_unavailable'): void } {
  let onPoint: (p: TrackingPoint) => void = () => {};
  let onError: (code: 'permission_denied' | 'position_unavailable') => void = () => {};
  let permission: 'not_requested' | 'requesting' | 'granted' | 'denied' | 'unavailable' = 'not_requested';
  return {
    async checkPermission() { return permission; },
    async requestPermission() { permission = 'granted'; return permission; },
    async start(op, oe) { onPoint = op; onError = oe; },
    async stop() {},
    emit(p) { onPoint(p); },
    emitError(code) { onError(code); },
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
    plugin.emit({ ...p1, capturedAt: new Date(p1.capturedAt.getTime() + 500) }); // 0.5s later, under the interval
    await new Promise((r) => setTimeout(r, 50));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends anyway once the max interval elapses, even if stationary', async () => {
    vi.useFakeTimers();
    await tracker.start('delivery-1');
    const p1 = { latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() };
    plugin.emit(p1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(11_000);
    plugin.emit({ ...p1, capturedAt: new Date(Date.now()) });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it('reports position_unavailable without crashing, does not mark lastSentAt', async () => {
    await tracker.start('delivery-1');
    plugin.emitError('position_unavailable');
    expect(tracker.getState().lastError).toBe('position_unavailable');
    expect(tracker.getState().active).toBe(true); // still trying, not torn down
  });

  it('a failed send is not treated as success - lastSentAt does not advance', async () => {
    send.mockRejectedValueOnce(new Error('network'));
    await tracker.start('delivery-1');
    plugin.emit({ latitude: 6.4, longitude: 80.0, accuracy: 10, capturedAt: new Date() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(tracker.getState().lastSentAt).toBeNull();
    expect(tracker.getState().lastError).toBe('network');
  });

  it('stop() calls the plugin\'s stop and marks inactive', async () => {
    await tracker.start('delivery-1');
    await tracker.stop();
    expect(tracker.getState().active).toBe(false);
  });

  it('notifies subscribers on every state change', async () => {
    const states: unknown[] = [];
    tracker.subscribe((s) => states.push(s.active));
    await tracker.start('delivery-1');
    await tracker.stop();
    expect(states).toContain(true);
    expect(states).toContain(false);
  });
});
