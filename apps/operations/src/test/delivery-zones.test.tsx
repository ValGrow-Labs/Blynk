import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { OrderMap } from '../api/insights';
import { OPERATIONS_STAFF, fail, moreSettings, ok, renderAs } from './helpers';

/**
 * 2026-11-01 (docs/superpowers/plans/2026-11-01-extra-delivery-areas.md, section A and O), Operations:
 * the "Extra delivery areas" card on More, GET|PUT /admin/settings/delivery-zones (mocked; the backend is built
 * in parallel), and the zone rings on the Delivery map (`store.zones`).
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const BERUWALA = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false };
const DEFAULT = { zones: [BERUWALA], updated_at: null };
const GET_ZONES = 'GET /admin/settings/delivery-zones';
const PUT_ZONES = 'PUT /admin/settings/delivery-zones';
const PUT_PATH = '/admin/settings/delivery-zones';

const cardOf = async () => (await screen.findByRole('heading', { name: 'Extra delivery areas' })).closest('section') as HTMLElement;

describe('Extra delivery areas card', () => {
  it('shows the Beruwala default switched off with its centre, radius, Maps link and the explanation', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok(DEFAULT) });
    const card = await cardOf();
    const row = await within(card).findByRole('listitem', { name: 'Extra area: Beruwala' });
    expect(within(row).getByRole('switch', { name: 'Beruwala on or off' })).toHaveAttribute('aria-checked', 'false');
    expect(within(row).getByLabelText('Latitude of Beruwala')).toHaveValue('6.4759');
    expect(within(row).getByLabelText('Longitude of Beruwala')).toHaveValue('79.9842');
    expect(within(row).getByLabelText('Radius of Beruwala in km')).toHaveValue('3');
    expect(within(row).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=6.4759,79.9842');
    expect(within(row).getByRole('button', { name: 'Remove Beruwala' })).toBeInTheDocument();
    expect(card).toHaveTextContent(
      'The main delivery area is the circle around the Blynk store (Delivery radius). Extra areas add a separate circle, for example Beruwala, without making the main circle bigger. Customers can order from an address inside the circle or inside any area that is switched on.'
    );
    expect(screen.queryByTestId('zones-unsaved')).not.toBeInTheDocument();
  });

  it('is placed right after the Delivery radius card on More', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok(DEFAULT) });
    const card = await cardOf();
    const radius = (await screen.findByRole('heading', { name: 'Delivery radius' })).closest('section')!;
    expect(radius.nextElementSibling).toBe(card);
  });

  it('switches Beruwala on and saves with the exact PUT body', async () => {
    const user = userEvent.setup();
    const saved = { zones: [{ ...BERUWALA, enabled: true }], updated_at: '2026-11-01T05:00:00.000Z' };
    const { api } = renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok(DEFAULT), [PUT_ZONES]: () => ok(saved) });
    const card = await cardOf();
    await user.click(await within(card).findByRole('switch', { name: 'Beruwala on or off' }));
    expect(within(card).getByTestId('zones-unsaved')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PUT_PATH)).toHaveLength(1));
    expect(api.find('PUT', PUT_PATH)[0].body).toEqual({
      zones: [{ id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: true }],
    });
    expect(await within(card).findByRole('status')).toHaveTextContent('Extra delivery areas saved. Beruwala is on.');
    expect(within(card).getByRole('switch', { name: 'Beruwala on or off' })).toHaveAttribute('aria-checked', 'true');
    expect(within(card).queryByTestId('zones-unsaved')).not.toBeInTheDocument();
  });

  it('adds an area from a pasted Google Maps link and saves it', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), {
      [GET_ZONES]: () => ok(DEFAULT),
      [PUT_ZONES]: (call) => ok({ zones: call.body.zones, updated_at: '2026-11-01T05:00:00.000Z' }),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('button', { name: 'Add area' }));
    const row = within(card).getByRole('listitem', { name: 'Extra area: Area 2' });
    expect(within(row).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(row).getByLabelText('Radius of Area 2 in km')).toHaveValue('3');
    await user.type(within(row).getByLabelText('Name'), 'Maggona');
    await user.click(within(row).getByLabelText('Paste the centre of Maggona'));
    await user.paste('https://www.google.com/maps/place/Maggona/@6.5201,79.9744,15z');
    expect(within(row).getByLabelText('Latitude of Maggona')).toHaveValue('6.5201');
    expect(within(row).getByLabelText('Longitude of Maggona')).toHaveValue('79.9744');
    expect(within(row).getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=6.5201,79.9744');
    await user.clear(within(row).getByLabelText('Radius of Maggona in km'));
    await user.type(within(row).getByLabelText('Radius of Maggona in km'), '2.5');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PUT_PATH)).toHaveLength(1));
    expect(api.find('PUT', PUT_PATH)[0].body).toEqual({
      zones: [BERUWALA, { id: 'maggona', name: 'Maggona', lat: 6.5201, lng: 79.9744, radius_km: 2.5, enabled: true }],
    });
  });

  it('also reads a pasted "lat, lng" and tells when the paste is not a position', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok({ zones: [], updated_at: null }) });
    const card = await cardOf();
    expect(await within(card).findByText('No extra areas yet.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Add area' }));
    const box = within(card).getByLabelText('Paste the centre of Area 1');
    await user.click(box);
    await user.paste('nothing useful');
    expect(within(card).getByText('Paste the centre as "6.4759, 79.9842" or a Google Maps link.')).toBeInTheDocument();
    await user.clear(box);
    await user.click(box);
    await user.paste('6.4759, 79.9842');
    expect(within(card).getByLabelText('Latitude of Area 1')).toHaveValue('6.4759');
    expect(within(card).getByLabelText('Longitude of Area 1')).toHaveValue('79.9842');
    expect(within(card).queryByText(/Paste the centre as/)).not.toBeInTheDocument();
  });

  it('removes an area and saves the shorter list', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), {
      [GET_ZONES]: () => ok(DEFAULT),
      [PUT_ZONES]: () => ok({ zones: [], updated_at: '2026-11-01T05:00:00.000Z' }),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('button', { name: 'Remove Beruwala' }));
    expect(within(card).getByText('No extra areas yet.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', PUT_PATH)).toHaveLength(1));
    expect(api.find('PUT', PUT_PATH)[0].body).toEqual({ zones: [] });
    expect(await within(card).findByRole('status')).toHaveTextContent('No extra area is switched on.');
  });

  it('shows the problems inline and sends nothing when the rows are not valid', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok(DEFAULT) });
    const card = await cardOf();
    await user.click(await within(card).findByRole('button', { name: 'Add area' }));
    await user.clear(within(card).getByLabelText('Latitude of Beruwala'));
    await user.type(within(card).getByLabelText('Latitude of Beruwala'), '12');
    await user.clear(within(card).getByLabelText('Radius of Beruwala in km'));
    await user.type(within(card).getByLabelText('Radius of Beruwala in km'), '20');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(within(card).getByText(/Enter the name of the area/)).toBeInTheDocument();
    expect(within(card).getAllByText(/latitude, a number from 5 to 10/)).toHaveLength(2);
    expect(within(card).getByText(/Radius: enter the km, 0.5 to 15/)).toBeInTheDocument();
    expect(api.find('PUT', PUT_PATH)).toHaveLength(0);
  });

  it('allows at most 10 areas (Add area is disabled at 10)', async () => {
    const user = userEvent.setup();
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...BERUWALA, id: `a${i}`, name: `Area ${i}` }));
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => ok({ zones: ten, updated_at: null }) });
    const card = await cardOf();
    const add = await within(card).findByRole('button', { name: 'Add area' });
    expect(add).toBeDisabled();
    await user.click(within(card).getByRole('button', { name: 'Remove Area 0' }));
    expect(add).toBeEnabled();
  });

  it('shows the API error when saving fails, and keeps the typed rows', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), {
      [GET_ZONES]: () => ok(DEFAULT),
      [PUT_ZONES]: () => fail(400, 'VALIDATION_ERROR', 'zones.0.radius_km: too big'),
    });
    const card = await cardOf();
    await user.click(await within(card).findByRole('switch', { name: 'Beruwala on or off' }));
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('too big');
    expect(within(card).getByRole('switch', { name: 'Beruwala on or off' })).toHaveAttribute('aria-checked', 'true');
    expect(within(card).getByTestId('zones-unsaved')).toBeInTheDocument();
  });

  it('shows the API error when loading fails', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), { [GET_ZONES]: () => fail(500, 'INTERNAL', 'Zones are unavailable') });
    const card = await cardOf();
    expect(await within(card).findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

const MAP: OrderMap = {
  range: 'last_30_days',
  status: 'delivered',
  timezone: 'Asia/Colombo',
  period: { from: '2026-10-02', to: '2026-10-31' },
  cell_meters: 150,
  cell_degrees: 0.00135,
  edge_km: 0.5,
  store: { name: 'Dharga Town', lat: 6.4351, lng: 80.0243, radius_km: 4 },
  totals: { orders: 1, revenue: 1000, inside: 1, near_edge: 0, outside: 0, farthest_km: 6.1, cells: 1 },
  cells: [{ cell: '4791:59277', lat: 6.4759, lng: 79.9842, orders: 1, delivered: 1, revenue: 1000, area: 'Beruwala', label: null, addresses: 1, customers: 1, distance_km: 6.1, zone: 'inside' }],
  busiest: [],
};

describe('Delivery map extra areas', () => {
  async function maps() {
    return (await import('maplibre-gl')) as unknown as {
      mapInstances: { sources: Record<string, { data: any }>; handlers: Record<string, () => void>; fitted: any }[];
    };
  }

  it('draws a second ring per enabled zone with its name, fits both circles and keeps the API wording', async () => {
    const { mapInstances } = await maps();
    const withZone: OrderMap = { ...MAP, store: { ...MAP.store, zones: [{ name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3 }] } };
    renderAs(OPERATIONS_STAFF, '/dashboard/map', { 'GET /admin/reports/order-map': () => ok(withZone) });
    await screen.findByTestId('order-map');
    const m = mapInstances[mapInstances.length - 1];
    m.handlers.load();
    expect(m.sources.radius.data.geometry.type).toBe('Polygon');
    expect(m.sources.zones.data.features).toHaveLength(1);
    expect(m.sources.zones.data.features[0].properties).toEqual({ name: 'Beruwala' });
    expect(m.sources.zones.data.features[0].geometry.type).toBe('Polygon');
    // The frame holds the store circle AND the Beruwala circle.
    const [[west, south], [east, north]] = m.fitted;
    expect(west).toBeLessThan(79.9842 - 0.02);
    expect(north).toBeGreaterThan(6.4759 + 0.02);
    expect(east).toBeGreaterThan(80.0243 + 0.03);
    expect(south).toBeLessThan(6.4351 - 0.03);
    expect(screen.getByTestId('order-map-zone-legend')).toHaveTextContent('Beruwala (3 km)');
    expect(screen.getByText('Service radius · 4 km')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Most orders come from well inside the 4 km radius.');
  });

  it('draws no zone ring when the API sends none (empty list or an older API)', async () => {
    const { mapInstances } = await maps();
    renderAs(OPERATIONS_STAFF, '/dashboard/map', { 'GET /admin/reports/order-map': () => ok({ ...MAP, store: { ...MAP.store, zones: [] } }) });
    await screen.findByTestId('order-map');
    const first = mapInstances[mapInstances.length - 1];
    first.handlers.load();
    expect(first.sources.radius).toBeDefined();
    expect(first.sources.zones).toBeUndefined();
    cleanup();
    tokenStore.clear();
    renderAs(OPERATIONS_STAFF, '/dashboard/map', { 'GET /admin/reports/order-map': () => ok(MAP) });
    await screen.findByTestId('order-map');
    const second = mapInstances[mapInstances.length - 1];
    second.handlers.load();
    expect(second.sources.zones).toBeUndefined();
    expect(screen.queryByTestId('order-map-zone-legend')).not.toBeInTheDocument();
  });
});
