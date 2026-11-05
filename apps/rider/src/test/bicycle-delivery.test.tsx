import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { BICYCLE_DELIVERY_LABEL, isBicycleDelivery } from '../lib/delivery';
import { __resetTrackerSessionForTests } from '../lib/tracker-session';
import { RIDER, detail, ok, renderAs, summary } from './helpers';

// Bicycle delivery (2026-11-05): a "Bicycle delivery" label on the job card and the job detail.
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetTrackerSessionForTests();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('bicycle delivery: rule', () => {
  it('only BICYCLE counts; MOTORBIKE and an older API (no field) do not', () => {
    expect(isBicycleDelivery({ delivery_method: 'BICYCLE' })).toBe(true);
    expect(isBicycleDelivery({ delivery_method: 'MOTORBIKE' })).toBe(false);
    expect(isBicycleDelivery({})).toBe(false);
    expect(BICYCLE_DELIVERY_LABEL).toBe('Bicycle delivery');
  });
});

describe('bicycle delivery: on screen', () => {
  it('labels the job detail', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ delivery_method: 'BICYCLE' }) }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.getByTestId('bicycle-tag')).toHaveTextContent('Bicycle delivery');
  });

  it('shows no label on a motorbike job detail', async () => {
    renderAs(RIDER, '/deliveries/d-1', {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ delivery_method: 'MOTORBIKE' }) }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.queryByTestId('bicycle-tag')).not.toBeInTheDocument();
  });

  it('labels only the bicycle job on the list (the "Now" card), not the motorbike one', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [
            summary({ delivery_method: 'BICYCLE', order_status: 'OUT_FOR_DELIVERY', assignment_status: 'PICKED_UP' }),
            summary({
              delivery_id: 'd-2',
              order_id: 'o-2',
              order_number: 'BLK-20260918-0002',
              delivery_address_line1: 'No. 9, Other Lane',
              delivery_method: 'MOTORBIKE',
            }),
          ],
        }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.getAllByTestId('bicycle-tag')).toHaveLength(1);
    expect(screen.getByTestId('bicycle-tag')).toHaveTextContent('Bicycle delivery');
  });

  it('labels a bicycle job in the "Next" rows', async () => {
    renderAs(RIDER, '/', {
      'GET /riders/deliveries': () =>
        ok({
          deliveries: [
            summary({ order_status: 'PACKED', assignment_status: 'ACCEPTED' }),
            summary({
              delivery_id: 'd-2',
              order_id: 'o-2',
              order_number: 'BLK-20260918-0002',
              delivery_address_line1: 'No. 9, Other Lane',
              delivery_method: 'BICYCLE',
            }),
          ],
        }),
    });
    expect(await screen.findByText('No. 9, Other Lane')).toBeInTheDocument();
    expect(screen.getAllByTestId('bicycle-tag')).toHaveLength(1);
  });
});
