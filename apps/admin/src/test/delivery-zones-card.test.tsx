import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { DeliveryZonesCard } from '../components/DeliveryZonesCard';
import { tokenStore } from '../api/client';
import type { DeliveryZone } from '../api/types';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Settings -> Extra delivery areas (2026-11-01; docs/superpowers/plans/2026-11-01-extra-delivery-areas.md).
 * The endpoint is the backend's; here, what the card shows and sends.
 */

const BERUWALA: DeliveryZone = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false };
const PATH = '/admin/settings/delivery-zones';

function zonesApi(initial: DeliveryZone[] = [BERUWALA], extra: (call: Call) => Reply | undefined = () => undefined) {
  let zones = initial;
  return mockApi((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.path === PATH) {
      if (c.method === 'PUT') zones = c.body.zones;
      return ok({ zones, updated_at: c.method === 'PUT' ? '2026-11-01T05:00:00.000Z' : null });
    }
    return undefined;
  });
}

const renderCard = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <DeliveryZonesCard />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('Settings - extra delivery areas card', () => {
  it('shows the Beruwala default switched off with its centre, radius and Google Maps link, and the explanation', async () => {
    zonesApi();
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    const row = await within(panel).findByRole('group', { name: 'Beruwala' });
    expect(within(row).getByRole('switch', { name: 'Beruwala switched on' })).toHaveAttribute('aria-checked', 'false');
    expect(within(row).getByLabelText('Name')).toHaveValue('Beruwala');
    expect(within(row).getByLabelText('Latitude')).toHaveValue('6.4759');
    expect(within(row).getByLabelText('Longitude')).toHaveValue('79.9842');
    expect(within(row).getByLabelText(/Radius \(km\)/)).toHaveValue('3');
    expect(within(row).getByRole('link', { name: 'Open Beruwala in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=6.4759,79.9842');
    expect(within(row).getByRole('button', { name: 'Remove Beruwala' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('The main delivery area is the circle around the Blynk store (Delivery radius).');
    expect(panel).toHaveTextContent('without making the main circle bigger');
    expect(panel).toHaveTextContent('inside any area that is switched on');
    expect(screen.getByTestId('delivery-zones-state')).toHaveTextContent('Saved.');
  });

  it('switches Beruwala on and saves the exact PUT body', async () => {
    const user = userEvent.setup();
    const api = zonesApi();
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    await user.click(await within(panel).findByRole('switch', { name: 'Beruwala switched on' }));
    expect(screen.getByTestId('delivery-zones-state')).toHaveTextContent('Not saved yet.');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PATH)).toHaveLength(1));
    expect(api.find('PUT', PATH)[0].body).toEqual({ zones: [{ ...BERUWALA, enabled: true }] });
    expect(await screen.findByText('Extra delivery areas saved. 1 switched on.')).toBeInTheDocument();
    expect(within(panel).getByRole('switch', { name: 'Beruwala switched on' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('delivery-zones-state')).toHaveTextContent('Saved.');
  });

  it('adds an area from a pasted Google Maps link', async () => {
    const user = userEvent.setup();
    const api = zonesApi();
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    await user.click(await within(panel).findByRole('button', { name: 'Add area' }));
    const row = within(panel).getByRole('group', { name: 'Area 2' });
    await user.type(within(row).getByLabelText('Name'), 'Aluthgama South');
    await user.click(within(row).getByLabelText(/Paste coordinates/));
    await user.paste('https://www.google.com/maps/place/Spot/@6.4351,80.0043,15z');
    expect(within(row).getByLabelText('Latitude')).toHaveValue('6.4351');
    expect(within(row).getByLabelText('Longitude')).toHaveValue('80.0043');
    const radius = within(row).getByLabelText(/Radius \(km\)/);
    await user.clear(radius);
    await user.type(radius, '2.5');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PATH)).toHaveLength(1));
    expect(api.find('PUT', PATH)[0].body).toEqual({
      zones: [BERUWALA, { id: 'aluthgama-south', name: 'Aluthgama South', lat: 6.4351, lng: 80.0043, radius_km: 2.5, enabled: true }],
    });
  });

  it('also reads a "lat, lng" pair pasted into the latitude box', async () => {
    const user = userEvent.setup();
    zonesApi([]);
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    expect(await within(panel).findByText('No extra areas yet.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Add area' }));
    await user.click(within(panel).getByLabelText('Latitude'));
    await user.paste('6.47, 79.98');
    expect(within(panel).getByLabelText('Latitude')).toHaveValue('6.47');
    expect(within(panel).getByLabelText('Longitude')).toHaveValue('79.98');
  });

  it('removes an area and saves the shorter list', async () => {
    const user = userEvent.setup();
    const api = zonesApi();
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    await user.click(await within(panel).findByRole('button', { name: 'Remove Beruwala' }));
    expect(within(panel).queryByRole('group', { name: 'Beruwala' })).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PATH)[0]?.body).toEqual({ zones: [] }));
    expect(await screen.findByText('Extra delivery areas saved. None is switched on.')).toBeInTheDocument();
  });

  it('shows what is wrong inline and sends nothing', async () => {
    const user = userEvent.setup();
    const api = zonesApi();
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    const row = await within(panel).findByRole('group', { name: 'Beruwala' });
    await user.clear(within(row).getByLabelText('Name'));
    const lat = within(row).getByLabelText('Latitude');
    await user.clear(lat);
    await user.type(lat, '12.5');
    const lng = within(row).getByLabelText('Longitude');
    await user.clear(lng);
    await user.type(lng, '84');
    const radius = within(row).getByLabelText(/Radius \(km\)/);
    await user.clear(radius);
    await user.type(radius, '20');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Enter the name of the area, like Beruwala.')).toBeInTheDocument();
    expect(within(panel).getByText(/Latitude is a number from 5 to 10/)).toBeInTheDocument();
    expect(within(panel).getByText(/Longitude is a number from 78 to 83/)).toBeInTheDocument();
    expect(within(panel).getByText('The radius must be between 0.5 and 15 km.')).toBeInTheDocument();
    expect(api.find('PUT', PATH)).toHaveLength(0);
  });

  it('stops Add area at 10 areas', async () => {
    const zones = Array.from({ length: 10 }, (_, i) => ({ ...BERUWALA, id: `a${i}`, name: `Area ${i}` }));
    zonesApi(zones);
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    expect(await within(panel).findByRole('button', { name: 'Add area' })).toBeDisabled();
  });

  it('shows the server refusal and keeps the rows as they were typed', async () => {
    const user = userEvent.setup();
    zonesApi([BERUWALA], (c) =>
      c.method === 'PUT' ? fail(400, 'VALIDATION_ERROR', 'Invalid input', { issues: [{ path: 'zones.0.radius_km', message: 'Radius is too large.' }] }) : undefined
    );
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    await user.click(await within(panel).findByRole('switch', { name: 'Beruwala switched on' }));
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(/Radius is too large\.|Invalid input/);
    expect(within(panel).getByRole('switch', { name: 'Beruwala switched on' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('delivery-zones-state')).toHaveTextContent('Not saved yet.');
  });

  it('shows a load failure', async () => {
    zonesApi([BERUWALA], (c) => (c.method === 'GET' ? fail(500, 'INTERNAL', 'Could not load the extra delivery areas.') : undefined));
    renderCard();
    const panel = await screen.findByRole('region', { name: 'Extra delivery areas' });
    expect(await within(panel).findByText('Could not load the extra delivery areas.')).toBeInTheDocument();
  });
});
