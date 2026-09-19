import { describe, it, expect, vi } from 'vitest';
import { subscribe, broadcastLocation, subscriberCount, closeAllStreams, type LocationEvent } from '../src/modules/realtime/location-stream.js';

function fakeRes() {
  return { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
}

const EVENT: LocationEvent = { latitude: 6.4, longitude: 80.0, accuracy: 10, captured_at: '2026-09-19T10:00:00.000Z', received_at: '2026-09-19T10:00:01.000Z' };

describe('location-stream broadcaster', () => {
  it('delivers a broadcast to every subscriber of that order, and no other order', () => {
    const a = fakeRes();
    const b = fakeRes();
    const unsubA = subscribe('order-1', a);
    subscribe('order-2', b);
    broadcastLocation('order-1', EVENT);
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('"latitude":6.4'));
    expect(b.write).not.toHaveBeenCalled();
    unsubA();
  });

  it('unsubscribing stops further broadcasts and cleans up empty order entries', () => {
    const a = fakeRes();
    const unsub = subscribe('order-3', a);
    expect(subscriberCount('order-3')).toBe(1);
    unsub();
    expect(subscriberCount('order-3')).toBe(0);
    broadcastLocation('order-3', EVENT);
    expect(a.write).not.toHaveBeenCalled();
  });

  it('broadcasting to an order with no subscribers is a harmless no-op', () => {
    expect(() => broadcastLocation('order-nobody', EVENT)).not.toThrow();
  });

  it('a second subscriber to the same order gets its own broadcasts, independent of the first', () => {
    const a = fakeRes();
    const b = fakeRes();
    subscribe('order-4', a);
    subscribe('order-4', b);
    broadcastLocation('order-4', EVENT);
    expect(a.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('closeAllStreams ends every open connection and clears the registry', () => {
    const a = fakeRes();
    subscribe('order-5', a);
    closeAllStreams();
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('server_shutdown'));
    expect(a.end).toHaveBeenCalled();
    expect(subscriberCount('order-5')).toBe(0);
  });
});
