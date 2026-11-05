import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ui';
import { OrderPanel } from '../components/OrderPanel';
import { AssignRiderDialog } from '../components/OrderDialogs';
import { BicycleTag, canSwitchToMotorbike } from '../components/OrderDeliveryMethod';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import type { BicycleDeliverySetting, BoardOrder } from '../api/types';
import {
  bicycleDraftsToInput,
  bicycleExampleText,
  bicycleFee,
  bicycleFeeWarning,
  bicycleRiderPay,
  bicycleToDrafts,
  motorbikeFeeAt,
} from '../lib/bicycleDelivery';
import { canRideFor, ridersForOrder } from '../lib/riderMap';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * Bicycle delivery (2026-11-05; docs/superpowers/plans/2026-11-05-bicycle-delivery-api.md): the Settings card,
 * the Bicycle badge, "Switch to motorbike" and the rider pickers. The rules are the backend's; here, what the
 * screens show and send.
 */

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const BICYCLE: BicycleDeliverySetting = {
  enabled: false,
  max_km: 3,
  fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },
  rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null },
  updated_at: null,
  ready: true,
};

describe('bicycle delivery lib', () => {
  it('charges the base while within the base km, then each started km beyond, capped', () => {
    const fee = { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null };
    expect(bicycleFee(1.5, fee)).toBe(80);
    expect(bicycleFee(2, fee)).toBe(80);
    expect(bicycleFee(2.1, fee)).toBe(110);
    expect(bicycleFee(3, fee)).toBe(110);
    expect(bicycleFee(3.4, fee)).toBe(140);
    expect(bicycleFee(3.4, { ...fee, max_fee_lkr: 120 })).toBe(120);
  });

  it('pays a fixed amount, or base + per km with a minimum floor', () => {
    expect(bicycleRiderPay(1.5, BICYCLE.rider_pay)).toBe(50);
    const perKm = { mode: 'PER_KM' as const, fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null };
    expect(bicycleRiderPay(1.5, perKm)).toBe(52.5);
    expect(bicycleRiderPay(1.5, { ...perKm, min_lkr: 60 })).toBe(60);
    expect(bicycleRiderPay(4, { ...perKm, min_lkr: 60 })).toBe(90);
  });

  it('words the example', () => {
    expect(bicycleExampleText(1.5, BICYCLE.fee, BICYCLE.rider_pay)).toBe('A 1.5 km order: customer pays LKR 80, rider earns LKR 50');
  });

  it('reads the boxes into whole sections and names the box of each problem', () => {
    const drafts = bicycleToDrafts(BICYCLE);
    const read = bicycleDraftsToInput({ ...drafts, enabled: true, feeMax: '150' }, BICYCLE);
    expect(read).toEqual({
      input: {
        enabled: true,
        max_km: 3,
        fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: 150 },
        rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null },
      },
    });
    const bad = bicycleDraftsToInput({ ...drafts, maxKm: '11', feeBase: '1001', feePerKm: '', feeBaseKm: '0.1' }, BICYCLE);
    expect(bad).toHaveProperty('errors');
    if ('errors' in bad) expect(Object.keys(bad.errors).sort()).toEqual(['feeBase', 'feeBaseKm', 'feePerKm', 'maxKm']);
  });

  it('a hidden rider-pay box with a bad number does not block the save', () => {
    const drafts = { ...bicycleToDrafts(BICYCLE), payBase: 'abc', payMode: 'FIXED' as const };
    expect(bicycleDraftsToInput(drafts, BICYCLE)).toHaveProperty('input');
    expect(bicycleDraftsToInput({ ...drafts, payMode: 'PER_KM' }, BICYCLE)).toHaveProperty('errors');
  });

  it('works out the motorbike fee from the delivery-fee setting and warns only when bicycle is not lower', () => {
    const flat = { fee_lkr: 150, fee_mode: 'FLAT' as const, updated_at: null };
    expect(motorbikeFeeAt(flat, 2)).toBe(150);
    expect(motorbikeFeeAt({ ...flat, fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40 }, 3)).toBe(160);
    expect(motorbikeFeeAt({ ...flat, fee_mode: 'DISTANCE_TIERS', tiers: [{ km: 1, lkr: 100 }, { km: 2, lkr: 60 }] }, 3)).toBe(220);
    expect(motorbikeFeeAt(null, 3)).toBeNull();
    expect(bicycleFeeWarning(3, BICYCLE.fee, flat)).toBeNull();
    expect(bicycleFeeWarning(3, BICYCLE.fee, { ...flat, fee_lkr: 80 })).toMatch(/not lower than the motorbike fee \(LKR 80\)/);
    expect(bicycleFeeWarning(3, BICYCLE.fee, null)).toBeNull();
  });
});

// ------------------------------------------------------------- the card
const renderSettings = () =>
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>
  );

function settingsApi(extra: (call: Call) => Reply | undefined = () => undefined, opts: { bicycle?: Partial<BicycleDeliverySetting>; fee?: Record<string, unknown> | null } = {}) {
  let bicycle: BicycleDeliverySetting = { ...BICYCLE, ...opts.bicycle };
  return mockApi((c) => {
    const r = extra(c);
    if (r) return r;
    if (c.path === '/admin/settings/bicycle-delivery') {
      if (c.method === 'PUT') bicycle = { ...bicycle, ...c.body, updated_at: '2026-11-05T05:00:00.000Z' };
      return ok(bicycle);
    }
    if (c.path === '/admin/settings/delivery-fee' && c.method === 'GET' && opts.fee !== null) {
      return ok({ fee_lkr: 150, fee_mode: 'FLAT', tiers: [], max_fee_lkr: null, updated_at: null, ...opts.fee });
    }
    return undefined;
  });
}

describe('Settings - Bicycle delivery card', () => {
  it('sits in Deliveries, is off by default and shows the worked example and the plain help', async () => {
    settingsApi();
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    const toggle = await within(panel).findByRole('switch', { name: 'Bicycle delivery' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(panel).getByLabelText(/Bicycle only up to/)).toHaveValue('3');
    expect(within(panel).getByLabelText(/^Base fee \(LKR\)/)).toHaveValue('80');
    expect(within(panel).getByLabelText(/Base fee covers the first/)).toHaveValue('2');
    expect(within(panel).getByLabelText(/Then for each extra started km/)).toHaveValue('30');
    expect(within(panel).getByLabelText(/Maximum fee/)).toHaveValue('');
    expect(within(panel).getByLabelText(/Rider pay per delivery/)).toHaveValue('50');
    expect(within(panel).getByTestId('bicycle-example')).toHaveTextContent('A 1.5 km order: customer pays LKR 80, rider earns LKR 50');
    expect(panel).toHaveTextContent('short, flat trips');
    expect(panel).toHaveTextContent('Staff still assign the rider');
    expect(within(panel).queryByTestId('bicycle-not-ready')).toBeNull();
  });

  it('recomputes the example as the numbers change, for both rider pay modes', async () => {
    const user = userEvent.setup();
    settingsApi();
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    const base = await within(panel).findByLabelText(/^Base fee \(LKR\)/);
    await user.clear(base);
    await user.type(base, '100');
    const fixed = within(panel).getByLabelText(/Rider pay per delivery/);
    await user.clear(fixed);
    await user.type(fixed, '60');
    expect(within(panel).getByTestId('bicycle-example')).toHaveTextContent('A 1.5 km order: customer pays LKR 100, rider earns LKR 60');

    await user.click(within(panel).getByRole('button', { name: 'Base + per km' }));
    expect(within(panel).queryByLabelText(/Rider pay per delivery/)).toBeNull();
    expect(within(panel).getByLabelText(/Rider base pay/)).toHaveValue('30');
    expect(within(panel).getByLabelText(/Rider pay for each km/)).toHaveValue('15');
    expect(within(panel).getByTestId('bicycle-example')).toHaveTextContent('rider earns LKR 52.50');
    await user.type(within(panel).getByLabelText(/Minimum rider pay/), '70');
    expect(within(panel).getByTestId('bicycle-example')).toHaveTextContent('rider earns LKR 70');
  });

  it('saves every section whole with PUT and shows the saved state', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    await user.click(await within(panel).findByRole('switch', { name: 'Bicycle delivery' }));
    const km = within(panel).getByLabelText(/Bicycle only up to/);
    await user.clear(km);
    await user.type(km, '2.5');
    await user.type(within(panel).getByLabelText(/Maximum fee/), '140');
    await user.click(within(panel).getByRole('button', { name: 'Base + per km' }));
    await user.type(within(panel).getByLabelText(/Minimum rider pay/), '45');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.find('PUT', '/admin/settings/bicycle-delivery')[0]?.body).toEqual({
        enabled: true,
        max_km: 2.5,
        fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: 140 },
        rider_pay: { mode: 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: 45 },
      })
    );
    expect(await screen.findByText('Bicycle delivery is on, up to 2.5 km.')).toBeInTheDocument();
    expect(within(panel).getByRole('switch', { name: 'Bicycle delivery' })).toHaveAttribute('aria-checked', 'true');
  });

  it('refuses bad numbers before saving and says which box', async () => {
    const user = userEvent.setup();
    const api = settingsApi();
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    const km = await within(panel).findByLabelText(/Bicycle only up to/);
    await user.clear(km);
    await user.type(km, '12');
    const base = within(panel).getByLabelText(/^Base fee \(LKR\)/);
    await user.clear(base);
    await user.type(base, '2000');
    await user.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('Distances must be between 0.5 and 10 km.')).toBeInTheDocument();
    expect(within(panel).getByText('Amounts must be between LKR 0 and LKR 1,000.')).toBeInTheDocument();
    expect(within(panel).getByText('Fill in every amount to see an example.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/bicycle-delivery')).toHaveLength(0);
  });

  it("shows the server's message when a save is refused", async () => {
    const user = userEvent.setup();
    settingsApi((c) =>
      c.method === 'PUT' ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'fee', message: 'Turn bicycle delivery on only with a valid fee.' }]) : undefined
    );
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    await user.click(await within(panel).findByRole('button', { name: 'Save' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Turn bicycle delivery on only with a valid fee.');

  });

  it('tells staff the owner must run the database update while ready is false', async () => {
    settingsApi(() => undefined, { bicycle: { ready: false } });
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    expect(await within(panel).findByTestId('bicycle-not-ready')).toHaveTextContent('owner must run the database update');
    expect(within(panel).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('warns when the bicycle fee is not lower than the motorbike fee, and not when it is', async () => {
    settingsApi(() => undefined, { fee: { fee_lkr: 80 } });
    const { unmount } = renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    expect(await within(panel).findByTestId('bicycle-warning')).toHaveTextContent('not lower than the motorbike fee (LKR 80)');
    unmount();

    settingsApi(() => undefined, { fee: { fee_lkr: 250 } });
    renderSettings();
    const second = await screen.findByRole('region', { name: 'Bicycle delivery' });
    await within(second).findByTestId('bicycle-example');
    expect(within(second).queryByTestId('bicycle-warning')).toBeNull();
  });

  it('skips the warning when the motorbike fee cannot be read', async () => {
    settingsApi(() => undefined, { fee: null });
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    await within(panel).findByTestId('bicycle-example');
    expect(within(panel).queryByTestId('bicycle-warning')).toBeNull();
  });

  it('says so when the setting cannot be loaded', async () => {
    settingsApi((c) => (c.path === '/admin/settings/bicycle-delivery' ? fail(500, 'INTERNAL', 'Boom') : undefined));
    renderSettings();
    const panel = await screen.findByRole('region', { name: 'Bicycle delivery' });
    expect(await within(panel).findByText('Boom')).toBeInTheDocument();
  });
});

// --------------------------------------------------------------- orders
const board: BoardOrder = {
  id: 'o1',
  order_number: 'BL-20261105-0007',
  order_status: 'PACKED',
  total_amount: 700,
  placed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  scheduled_for: null,
  delivery_recipient_name: 'Nimal Perera',
  delivery_address_line1: 'No. 1, Test Lane',
  delivery_city: 'Dharga Town',
  items_summary: { total: 1, pending: 0, sourced: 0, packed: 1, unavailable: 0, substituted: 0 },
  active_delivery: null,
  payment_method: 'COD',
  payment_status: 'PENDING',
  delivery_method: 'BICYCLE',
};

const detail = (over: Record<string, unknown> = {}) => ({
  ...board,
  subtotal_amount: 600,
  delivery_fee: 100,
  delivery_recipient_phone: '+94771234567',
  delivery_address_line2: null,
  delivery_instructions: null,
  cancellation_reason: null,
  items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 1, item_status: 'PACKED', actual_unit_cost: null }],
  history: [],
  delivery: null,
  ...over,
});

const SWITCH_REFUSAL = "The delivery method can only be changed before the order is picked up.";

function panelApi(opts: { status?: string; method?: 'BICYCLE' | 'MOTORBIKE'; post?: Reply } = {}) {
  const state = { method: opts.method ?? 'BICYCLE' };
  const api = mockApi((c) => {
    if (c.method === 'GET' && c.path === '/admin/orders/o1') {
      return ok({ order: detail({ order_status: opts.status ?? 'PACKED', delivery_method: state.method, delivery_fee: state.method === 'BICYCLE' ? 100 : 150, total_amount: state.method === 'BICYCLE' ? 700 : 750 }) });
    }
    if (c.method === 'POST' && c.path === '/admin/orders/o1/delivery-method') {
      if (opts.post) return opts.post;
      state.method = 'MOTORBIKE';
      return ok({ order: detail({ order_status: opts.status ?? 'PACKED', delivery_method: 'MOTORBIKE', delivery_fee: 150, total_amount: 750 }) });
    }
    return undefined;
  });
  return api;
}

const renderPanel = (role: 'ADMIN' | 'OPERATIONS' | undefined = 'ADMIN', order: BoardOrder = board, onChanged?: () => void) =>
  render(<OrderPanel order={order} role={role} version={0} busy={false} onAction={() => {}} onChanged={onChanged} onClose={() => {}} />);

describe('Bicycle badge', () => {
  it('shows "Bicycle" for a bicycle order only', () => {
    const { rerender } = render(<BicycleTag method="BICYCLE" />);
    expect(screen.getByTestId('bicycle-badge')).toHaveTextContent('Bicycle');
    rerender(<BicycleTag method="MOTORBIKE" />);
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
    rerender(<BicycleTag method={undefined} />);
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
  });

  it('is on the Orders board row and on the order detail, and a motorbike order has none', async () => {
    const user = userEvent.setup();
    const bike = { ...board, id: 'o1', delivery_method: 'BICYCLE' };
    const moto = { ...board, id: 'o2', order_number: 'BL-20261105-0008', delivery_method: 'MOTORBIKE' };
    mockApi((c) => {
      if (c.path === '/auth/me') return ok({ id: 'a1', phone: '+94775551122', full_name: 'Nawaz', email: null, role: 'ADMIN' });
      if (c.path === '/admin/orders' && c.query.get('since')) return ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
      if (c.path === '/admin/orders') return ok({ orders: [bike, moto], pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } });
      if (c.path === '/admin/orders/o1') return ok({ order: detail({ delivery_method: 'BICYCLE' }) });
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    const row = (await screen.findByRole('button', { name: 'Open order #0007' })).closest('li') as HTMLElement;
    expect(within(row).getByTestId('bicycle-badge')).toBeInTheDocument();
    const other = screen.getByRole('button', { name: 'Open order #0008' }).closest('li') as HTMLElement;
    expect(within(other).queryByTestId('bicycle-badge')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'Open order #0007' }));
    const aside = await screen.findByRole('complementary', { name: 'Order #0007' });
    expect(await within(aside).findByTestId('bicycle-badge')).toBeInTheDocument();
  });

  it('is on the order panel header straight from the board row', () => {
    panelApi();
    renderPanel('ADMIN');
    expect(screen.getByTestId('bicycle-badge')).toBeInTheDocument();
  });
});

describe('canSwitchToMotorbike', () => {
  it('only a bicycle order before pick-up, for Admin and Operations', () => {
    const o = { order_status: 'PACKED' as const, delivery_method: 'BICYCLE' as const };
    expect(canSwitchToMotorbike(o, 'ADMIN')).toBe(true);
    expect(canSwitchToMotorbike(o, 'OPERATIONS')).toBe(true);
    expect(canSwitchToMotorbike(o, 'PACKING_STAFF')).toBe(false);
    expect(canSwitchToMotorbike(o, undefined)).toBe(false);
    expect(canSwitchToMotorbike({ ...o, delivery_method: 'MOTORBIKE' }, 'ADMIN')).toBe(false);
    for (const status of ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'] as const) expect(canSwitchToMotorbike({ ...o, order_status: status }, 'ADMIN')).toBe(true);
    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'AWAITING_PAYMENT'] as const) {
      expect(canSwitchToMotorbike({ ...o, order_status: status as never }, 'ADMIN')).toBe(false);
    }
  });
});

describe('Order panel - Switch to motorbike', () => {
  it('confirms in plain words, posts MOTORBIKE, then shows the new total and refreshes', async () => {
    const user = userEvent.setup();
    const api = panelApi();
    const onChanged = vi.fn();
    renderPanel('OPERATIONS', board, onChanged);
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    const confirm = screen.getByRole('group', { name: 'Switch to motorbike' });
    expect(confirm).toHaveTextContent(
      "The customer's delivery fee changes to the motorbike fee and any assigned bicycle rider is released. The customer is sent a text."
    );
    expect(api.find('POST', '/admin/orders/o1/delivery-method')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Yes, switch to motorbike' }));
    expect(await screen.findByTestId('switch-motorbike-done')).toHaveTextContent('The new total is LKR 750');
    expect(api.find('POST', '/admin/orders/o1/delivery-method')[0]?.body).toEqual({ method: 'MOTORBIKE' });
    expect(onChanged).toHaveBeenCalled();
    // Re-read: now a motorbike order, so no badge and no button.
    await waitFor(() => expect(screen.queryByTestId('bicycle-badge')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
    expect(api.find('GET', '/admin/orders/o1').length).toBeGreaterThanOrEqual(2);
  });

  it('Back closes the confirm step without sending anything', async () => {
    const user = userEvent.setup();
    const api = panelApi();
    renderPanel('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    await user.click(within(screen.getByRole('group', { name: 'Switch to motorbike' })).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('group', { name: 'Switch to motorbike' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to motorbike' })).toBeInTheDocument();
    expect(api.find('POST', '/admin/orders/o1/delivery-method')).toHaveLength(0);
  });

  it('shows the server message for a 409 and re-reads the order', async () => {
    const user = userEvent.setup();
    const api = panelApi({ post: fail(409, 'ORDER_NOT_SWITCHABLE', SWITCH_REFUSAL) });
    renderPanel('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    await user.click(screen.getByRole('button', { name: 'Yes, switch to motorbike' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(SWITCH_REFUSAL);
    await waitFor(() => expect(api.find('GET', '/admin/orders/o1').length).toBeGreaterThanOrEqual(2));
  });

  it('shows the paid-online refusal as the server wrote it', async () => {
    const user = userEvent.setup();
    const message =
      "This order was paid online or with the Blynk Wallet, so its delivery fee can't change. Cancel it and ask the customer to order again with motorbike delivery.";
    panelApi({ post: fail(409, 'ORDER_PAID_CANNOT_SWITCH', message) });
    renderPanel('ADMIN');
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    await user.click(screen.getByRole('button', { name: 'Yes, switch to motorbike' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it.each(['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'])('is offered while the order is %s', async (status) => {
    panelApi({ status });
    renderPanel('ADMIN', { ...board, order_status: status as BoardOrder['order_status'] });
    expect(await screen.findByRole('button', { name: 'Switch to motorbike' })).toBeInTheDocument();
  });

  it.each(['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])('is not offered once the order is %s', async (status) => {
    panelApi({ status });
    renderPanel('ADMIN', { ...board, order_status: status as BoardOrder['order_status'] });
    await screen.findByRole('region', { name: 'Items' });
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
  });

  it('is not offered on a motorbike order or to a read-only viewer', async () => {
    panelApi({ method: 'MOTORBIKE' });
    const { unmount } = renderPanel('ADMIN', { ...board, delivery_method: 'MOTORBIKE' });
    await screen.findByRole('region', { name: 'Items' });
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
    unmount();

    panelApi();
    render(<OrderPanel order={board} role={undefined} version={0} busy={false} onAction={() => {}} onClose={() => {}} />);
    await screen.findByRole('region', { name: 'Items' });
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
  });
});

// -------------------------------------------------------------- pickers
describe('Rider pickers', () => {
  const roster = [{ id: 'b1', full_name: 'Cycle Rider', phone: '+94770000001', vehicle_type: 'BICYCLE', vehicle_registration_number: 'CYCLE-1', open_deliveries: 0 }];

  it('asks for the roster of THIS order, so a bicycle order lists only bicycle riders', async () => {
    const api = mockApi((c) => {
      if (c.path === '/admin/riders/suggestions') return fail(500, 'INTERNAL', 'down');
      if (c.path === '/admin/riders') return ok({ riders: roster });
      return undefined;
    });
    render(<AssignRiderDialog order={board} busy={false} onAssign={() => {}} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(await within(dialog).findByRole('radio', { name: /Cycle Rider/ })).toBeInTheDocument();
    expect(api.find('GET', '/admin/riders')[0]?.query.get('order_id')).toBe('o1');
    expect(api.find('GET', '/admin/riders/suggestions')[0]?.query.get('order_id')).toBe('o1');
    expect(within(dialog).getByTestId('bicycle-badge')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('only riders who deliver by bicycle are listed');
  });

  it('a motorbike order shows no bicycle note', async () => {
    mockApi((c) => (c.path === '/admin/riders/suggestions' ? fail(500, 'INTERNAL') : c.path === '/admin/riders' ? ok({ riders: roster }) : undefined));
    render(<AssignRiderDialog order={{ ...board, delivery_method: 'MOTORBIKE' }} busy={false} onAssign={() => {}} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await within(dialog).findByRole('radio', { name: /Cycle Rider/ });
    expect(within(dialog).queryByTestId('bicycle-badge')).toBeNull();
    expect(dialog).not.toHaveTextContent('bicycle');
  });

  it('on the Orders board, assigning a bicycle order to a non-bicycle rider shows the server message', async () => {
    const user = userEvent.setup();
    const refusal = 'This is a bicycle delivery, so it can only be given to a rider who delivers by bicycle.';
    const bike = { ...board, id: 'o1' };
    mockApi((c) => {
      if (c.path === '/auth/me') return ok({ id: 'a1', phone: '+94775551122', full_name: 'Nawaz', email: null, role: 'ADMIN' });
      if (c.path === '/admin/orders' && c.query.get('since')) return ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } });
      if (c.path === '/admin/orders') return ok({ orders: [bike], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } });
      if (c.path === '/admin/riders/suggestions') return fail(500, 'INTERNAL');
      if (c.path === '/admin/riders') return ok({ riders: roster });
      if (c.method === 'POST' && c.path === '/admin/orders/o1/assign-rider') return fail(409, 'RIDER_NOT_BICYCLE', refusal);
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/orders']}>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    await user.click(await screen.findByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await user.click(await within(dialog).findByRole('radio', { name: /Cycle Rider/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText(refusal)).toBeInTheDocument();
  });

  it('the Rider map offers a bicycle order only to bicycle riders (and a bicycle rider still sees motorbike orders)', () => {
    const rider = (id: string, vehicle_type: string) =>
      ({ id, full_name: id, phone: null, vehicle_type, status: 'FREE', open_deliveries: 0, capacity_left: 2, position: null, deliveries: [] }) as never;
    const bikeOrder = { order_id: 'o1', order_number: 'BL-1', order_status: 'PACKED', delivery_method: 'BICYCLE' as const, waiting_seconds: 60, address: 'x', dropoff: null };
    const motoOrder = { ...bikeOrder, order_id: 'o2', order_number: 'BL-2', delivery_method: 'MOTORBIKE' as const };
    expect(ridersForOrder(bikeOrder, [rider('m', 'MOTORCYCLE'), rider('b', 'BICYCLE')]).map((o) => o.rider.id)).toEqual(['b']);
    expect(ridersForOrder(motoOrder, [rider('m', 'MOTORCYCLE'), rider('b', 'BICYCLE')])).toHaveLength(2);
    expect(canRideFor(bikeOrder, rider('m', 'MOTORCYCLE'))).toBe(false);
    expect(canRideFor({}, rider('m', 'MOTORCYCLE'))).toBe(true);
  });
});
