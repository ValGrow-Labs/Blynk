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
});
