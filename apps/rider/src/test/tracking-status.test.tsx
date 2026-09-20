import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TrackingStatus } from '../components/TrackingStatus';

describe('TrackingStatus', () => {
  it('shows sharing-active state', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.getByText(/sharing your location/i)).toBeInTheDocument();
  });

  it('shows a GPS-unavailable banner with the reason, not a coordinate', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: null, lastError: 'position_unavailable' }} />);
    expect(screen.getByText(/can't get your location/i)).toBeInTheDocument();
  });

  it('never renders a raw coordinate, regardless of state', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.queryByText(/6\.4|80\.0/)).not.toBeInTheDocument();
  });

  it('shows a stopped confirmation once tracking has ended', () => {
    render(<TrackingStatus state={{ permission: 'granted', active: false, lastSentAt: new Date(), lastError: null }} />);
    expect(screen.getByText(/stopped sharing/i)).toBeInTheDocument();
  });

  describe('blocking and failure states (plan §13)', () => {
    const permissionCopy = /location permission is off/i;
    const sendFailedCopy = /couldn't send your last location/i;
    const noCoordinate = /\d+\.\d{3,}/;

    it('says permission is needed when it was denied at pickup (never became active)', () => {
      const { container } = render(
        <TrackingStatus state={{ permission: 'denied', active: false, lastSentAt: null, lastError: null }} />
      );
      expect(screen.getByText(permissionCopy)).toBeInTheDocument();
      expect(container.querySelector('.tracking-status--error')).not.toBeNull();
      expect(container.textContent).not.toMatch(noCoordinate);
    });

    it('says permission is needed when it was revoked mid-session', () => {
      const { container } = render(
        <TrackingStatus state={{ permission: 'denied', active: false, lastSentAt: null, lastError: 'permission_denied' }} />
      );
      expect(screen.getByText(permissionCopy)).toBeInTheDocument();
      expect(container.querySelector('.tracking-status--error')).not.toBeNull();
      expect(container.textContent).not.toMatch(noCoordinate);
    });

    it('revocation wins over a still-active watcher and a stale "stopped" line', () => {
      render(
        <TrackingStatus
          state={{ permission: 'denied', active: true, lastSentAt: new Date(), lastError: 'permission_denied' }}
        />
      );
      expect(screen.getByText(permissionCopy)).toBeInTheDocument();
      expect(screen.queryByText(/sharing your location/i)).not.toBeInTheDocument();

      render(
        <TrackingStatus
          state={{ permission: 'denied', active: false, lastSentAt: new Date(), lastError: 'permission_denied' }}
        />
      );
      expect(screen.queryByText(/stopped sharing/i)).not.toBeInTheDocument();
    });

    it("says location isn't available when the location service can't be reached", () => {
      const { container } = render(
        <TrackingStatus state={{ permission: 'unavailable', active: false, lastSentAt: null, lastError: null }} />
      );
      expect(screen.getByText(/location isn't available on this device/i)).toBeInTheDocument();
      expect(container.querySelector('.tracking-status--error')).not.toBeNull();
      expect(container.textContent).not.toMatch(noCoordinate);
    });

    it('denied is more specific than unavailable, and unavailable outranks GPS-unavailable and stopped', () => {
      const { unmount } = render(
        <TrackingStatus state={{ permission: 'denied', active: false, lastSentAt: null, lastError: 'permission_denied' }} />
      );
      expect(screen.getByText(permissionCopy)).toBeInTheDocument();
      unmount();

      render(
        <TrackingStatus
          state={{ permission: 'unavailable', active: false, lastSentAt: new Date(), lastError: 'position_unavailable' }}
        />
      );
      expect(screen.getByText(/location isn't available on this device/i)).toBeInTheDocument();
      expect(screen.queryByText(/can't get your location/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/stopped sharing/i)).not.toBeInTheDocument();
    });

    it('permission denial takes precedence over GPS-unavailable', () => {
      render(
        <TrackingStatus state={{ permission: 'denied', active: true, lastSentAt: null, lastError: 'position_unavailable' }} />
      );
      expect(screen.getByText(permissionCopy)).toBeInTheDocument();
      expect(screen.queryByText(/can't get your location/i)).not.toBeInTheDocument();
    });

    it('flags a failed send while active, and still shows when the last good send was', () => {
      const { container } = render(
        <TrackingStatus
          state={{ permission: 'granted', active: true, lastSentAt: new Date(Date.now() - 47_000), lastError: 'network' }}
        />
      );
      expect(screen.getByText(sendFailedCopy)).toBeInTheDocument();
      expect(screen.getByText(/last sent 47s ago/i)).toBeInTheDocument();
      // A self-healing send failure is a retrying warning, not a blocking error.
      expect(container.querySelector('.tracking-status--retrying')).not.toBeNull();
      expect(container.querySelector('.tracking-status--error')).toBeNull();
      expect(screen.queryByText(/^sharing your location/i)).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(noCoordinate);
    });

    it('flags a failed send even before any send has succeeded', () => {
      render(<TrackingStatus state={{ permission: 'granted', active: true, lastSentAt: null, lastError: 'network' }} />);
      expect(screen.getByText(sendFailedCopy)).toBeInTheDocument();
      expect(screen.queryByText(/last sent/i)).not.toBeInTheDocument();
    });

    it('a failed send after tracking stopped is not shown as a live problem', () => {
      render(<TrackingStatus state={{ permission: 'granted', active: false, lastSentAt: new Date(), lastError: 'network' }} />);
      expect(screen.queryByText(sendFailedCopy)).not.toBeInTheDocument();
      expect(screen.getByText(/stopped sharing/i)).toBeInTheDocument();
    });
  });
});
