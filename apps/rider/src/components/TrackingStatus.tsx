import type { TrackingState } from '../lib/tracking';

/**
 * A small, passive readout of the location-sharing state (plan §13). It
 * never shows a coordinate - only whether sharing is on, just stopped, or
 * blocked, and roughly how fresh the last send was.
 */
export function TrackingStatus({ state }: { state: TrackingState }) {
  if (state.lastError === 'position_unavailable') {
    return <p className="tracking-status tracking-status--error">Can't get your location — check GPS is on.</p>;
  }
  if (!state.active) {
    return state.lastSentAt ? <p className="tracking-status">Stopped sharing your location.</p> : null;
  }
  const secondsAgo = state.lastSentAt ? Math.max(0, Math.round((Date.now() - state.lastSentAt.getTime()) / 1000)) : null;
  return (
    <p className="tracking-status tracking-status--active">
      Sharing your location{secondsAgo !== null ? ` — updated ${secondsAgo}s ago` : ''}
    </p>
  );
}
