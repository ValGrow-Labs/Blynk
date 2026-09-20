import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingStatus } from '../components/TrackingStatus';
import type { TrackingState } from '../lib/tracking';

/**
 * The "updated Ns ago" text must stay truthful while nothing else changes: if
 * the tracker goes silent without emitting a state, the readout still has to
 * age, or a rider sees a healthy line while the customer's map has gone stale.
 */
describe('TrackingStatus elapsed time', () => {
  const NOW = new Date('2026-09-20T10:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const active = (agoMs: number): TrackingState => ({
    permission: 'granted',
    active: true,
    lastSentAt: new Date(NOW.getTime() - agoMs),
    lastError: null,
  });

  it('re-renders on a low-frequency tick: "updated 4s ago" becomes "updated 9s ago" after 5 s with no state change', () => {
    render(<TrackingStatus state={active(4_000)} />);
    expect(screen.getByText(/updated 4s ago/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText(/updated 9s ago/)).toBeInTheDocument();
    expect(screen.queryByText(/updated 4s ago/)).not.toBeInTheDocument();
  });

  it('rolls over to minutes as time passes', () => {
    render(<TrackingStatus state={active(55_000)} />);
    expect(screen.getByText(/updated 55s ago/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(/updated 1 min ago/)).toBeInTheDocument();
  });

  it('ticks the "Last sent" line of the retrying state too', () => {
    render(<TrackingStatus state={{ ...active(47_000), lastError: 'network' }} />);
    expect(screen.getByText(/last sent 47s ago/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText(/last sent 1 min ago/i)).toBeInTheDocument();
  });

  it('clears its interval on unmount', () => {
    const { unmount } = render(<TrackingStatus state={active(4_000)} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the interval when the elapsed text goes away (stopped / blocked)', () => {
    const { rerender } = render(<TrackingStatus state={active(4_000)} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<TrackingStatus state={{ ...active(4_000), active: false }} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<TrackingStatus state={active(4_000)} />);
    expect(vi.getTimerCount()).toBe(1);
    rerender(<TrackingStatus state={{ ...active(4_000), permission: 'denied', lastError: 'permission_denied' }} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs no timer at all when no elapsed time is displayed', () => {
    const states: TrackingState[] = [
      { permission: 'granted', active: true, lastSentAt: null, lastError: null },
      { permission: 'granted', active: true, lastSentAt: null, lastError: 'network' },
      { permission: 'granted', active: false, lastSentAt: NOW, lastError: null },
      { permission: 'denied', active: false, lastSentAt: null, lastError: null },
      { permission: 'unavailable', active: false, lastSentAt: null, lastError: null },
      { permission: 'granted', active: true, lastSentAt: NOW, lastError: 'position_unavailable' },
    ];
    for (const state of states) {
      const { unmount } = render(<TrackingStatus state={state} />);
      expect(vi.getTimerCount(), JSON.stringify(state)).toBe(0);
      unmount();
    }
  });

  it('a new lastSentAt resets the elapsed text immediately', () => {
    const { rerender } = render(<TrackingStatus state={active(30_000)} />);
    expect(screen.getByText(/updated 30s ago/)).toBeInTheDocument();
    rerender(<TrackingStatus state={active(1_000)} />);
    expect(screen.getByText(/updated 1s ago/)).toBeInTheDocument();
  });
});
