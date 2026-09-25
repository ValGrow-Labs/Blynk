import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const RIDERS = [
  {
    id: 'r1',
    full_name: 'Farhan Mohamed',
    phone: '+94779876543',
    vehicle_type: 'MOTORCYCLE',
    vehicle_registration_number: 'WP-BCX-8842',
    open_deliveries: 2,
  },
  {
    id: 'r2',
    full_name: null,
    phone: '+94775551199',
    vehicle_type: 'BICYCLE',
    vehicle_registration_number: 'N/A',
    open_deliveries: 0,
  },
];

describe('Riders', () => {
  it('is reachable from the More tab', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/more', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    await user.click(await screen.findByRole('link', { name: 'Riders' }));
    expect(await screen.findByRole('heading', { name: 'Riders' })).toBeInTheDocument();
  });

  it('renders the real rider list from a mocked response, including the open-deliveries count and vehicle type', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });

    expect(await screen.findByText('Farhan Mohamed')).toBeInTheDocument();
    expect(screen.getByText(/MOTORCYCLE/)).toBeInTheDocument();
    expect(screen.getByText('WP-BCX-8842')).toBeInTheDocument();
    expect(screen.getByText('2 open deliveries')).toBeInTheDocument();

    // A rider with no full_name falls back to phone; 0 open deliveries is
    // its own singular-safe copy, not "0 open deliveries".
    expect(screen.getByText('+94775551199')).toBeInTheDocument();
    expect(screen.getByText(/BICYCLE/)).toBeInTheDocument();
    expect(screen.getByText('No open deliveries')).toBeInTheDocument();
  });

  it('shows a real error, not a silent failure, when the list cannot load', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', {
      'GET /admin/riders': () => fail(500, 'INTERNAL', 'boom'),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The Blynk API had a problem. Try again in a moment.');
  });

  it('empty state ("No active riders") matches the real empty-list case, with no fabricated data', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: [] }) });
    expect(await screen.findByText('No active riders')).toBeInTheDocument();
  });

  it('offers no create/edit/activate/deactivate control anywhere on this screen - a real DOM assertion, not vacuous', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    await screen.findByText('Farhan Mohamed');

    // No button of any kind renders on this screen - the roster is pure
    // display, and the backend has no rider create/activate/deactivate/edit
    // endpoint to wire one up to (common.md rule 9, plan §14/§26 row D).
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    for (const forbidden of [/add/i, /new rider/i, /create/i, /edit/i, /activate/i, /deactivate/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('the honest provisioning note is real, visible copy, not hidden or implied by a disabled control', async () => {
    renderAs(ADMIN_WITH_RIDER, '/more/riders', { 'GET /admin/riders': () => ok({ riders: RIDERS }) });
    expect(
      await screen.findByText('Rider accounts are currently provisioned outside this app.', { exact: false })
    ).toBeInTheDocument();
  });
});
