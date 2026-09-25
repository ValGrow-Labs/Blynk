import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { ADMIN_NO_RIDER, ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('bottom tab navigation', () => {
  it('every tab is present and reachable in one tap from Home', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    for (const label of ['Home', 'Orders', 'Delivery', 'Catalog', 'More']) {
      expect(await screen.findByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it('reaches the Delivery screen in one tap when the session has rider capability', async () => {
    // F4 replaced the F1 placeholder with the real Delivery queue
    // (pages/Delivery/Queue.tsx) - an empty `GET /riders/deliveries` list
    // (this test's own mock) renders its honest empty state.
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await user.click(await screen.findByRole('link', { name: /^Delivery/ }));
    expect(await screen.findByText('No deliveries assigned to you right now.')).toBeInTheDocument();
  });

  it('shows the Delivery tab disabled with an explanation when the session is ADMIN_ONLY, but it stays reachable', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_NO_RIDER, '/', { 'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND') });

    const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
    expect(deliveryTab).toHaveAttribute('aria-disabled', 'true');
    expect(deliveryTab).toHaveAttribute('title', 'No rider profile is linked to this account');
    expect(screen.getByText('No profile')).toBeInTheDocument();

    // Still a real, reachable link - not removed, not a dead end.
    await user.click(deliveryTab);
    expect(await screen.findByText('No rider profile is linked to this account yet.')).toBeInTheDocument();
  });

  it('does not mark the Delivery tab disabled once rider capability is confirmed', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
    expect(deliveryTab).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('No profile')).not.toBeInTheDocument();
  });
});
