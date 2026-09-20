import type { TrackingState } from '../lib/tracking';

function secondsSince(when: Date): number {
  return Math.max(0, Math.round((Date.now() - when.getTime()) / 1000));
}

/**
 * A small, passive readout of the location-sharing state (plan §13). It
 * never shows a coordinate - only whether sharing is on, just stopped, or
 * blocked, and roughly how fresh the last confirmed send was.
 *
 * Precedence: blocking errors (permission, GPS) first, then stopped, then
 * the live state, where a failed send is flagged rather than hidden behind
 * an otherwise healthy-looking line.
 */
export function TrackingStatus({ state }: { state: TrackingState }) {
  // Denied at pickup, or revoked mid-session. Either way nothing is being
  // shared, whatever `active` says, so this outranks every other state.
  if (state.permission === 'denied' || state.lastError === 'permission_denied') {
    return (
      <p className="tracking-status tracking-status--error">
        Location permission is off — turn it on in your phone's settings so your customer can see you.
      </p>
    );
  }
  if (state.lastError === 'position_unavailable') {
    return <p className="tracking-status tracking-status--error">Can't get your location — check GPS is on.</p>;
  }
  if (!state.active) {
    return state.lastSentAt ? <p className="tracking-status">Stopped sharing your location.</p> : null;
  }
  const secondsAgo = state.lastSentAt ? secondsSince(state.lastSentAt) : null;
  if (state.lastError === 'network') {
    return (
      <p className="tracking-status tracking-status--error">
        <span>Couldn't send your last location — retrying.</span>
        {secondsAgo !== null ? <span> Last sent {secondsAgo}s ago.</span> : null}
      </p>
    );
  }
  return (
    <p className="tracking-status tracking-status--active">
      Sharing your location{secondsAgo !== null ? ` — updated ${secondsAgo}s ago` : ''}
    </p>
  );
}
