import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { BicycleDeliverySetting, BoardOrder, OrderDetail } from '../api/types';
import { AssignRiderDialog } from '../components/OrderDialogs';
import { BicycleTag, canSwitchToMotorbike } from '../components/OrderDeliveryMethod';
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
import { OPERATIONS_STAFF, fail, moreSettings, ok, renderAs, mockApi, type Call } from './helpers';

/**
 * Bicycle delivery in Operations (2026-11-05; docs/superpowers/plans/2026-11-05-bicycle-delivery-api.md): the
 * More > Deliveries card, the Bicycle badge, "Switch to motorbike" and the rider pickers. The rules are the
 * backend's; here, what the screens show and send.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
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
    expect(bicycleFee(3.4, fee)).toBe(140);
    expect(bicycleFee(3.4, { ...fee, max_fee_lkr: 120 })).toBe(120);
  });

  it('pays a fixed amount, or base + per km with a minimum floor', () => {
    expect(bicycleRiderPay(1.5, BICYCLE.rider_pay)).toBe(50);
    const perKm = { mode: 'PER_KM' as const, fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null };
    expect(bicycleRiderPay(1.5, perKm)).toBe(52.5);
    expect(bicycleRiderPay(1.5, { ...perKm, min_lkr: 60 })).toBe(60);
    expect(bicycleExampleText(1.5, BICYCLE.fee, BICYCLE.rider_pay)).toBe('A 1.5 km order: customer pays LKR 80, rider earns LKR 50');
  });

  it('reads the boxes into whole sections and names the box of each problem', () => {
    const drafts = bicycleToDrafts(BICYCLE);
    expect(bicycleDraftsToInput({ ...drafts, enabled: true }, BICYCLE)).toEqual({
      input: { enabled: true, max_km: 3, fee: BICYCLE.fee, rider_pay: BICYCLE.rider_pay },
    });
    const bad = bicycleDraftsToInput({ ...drafts, maxKm: '11', feeBase: '1001' }, BICYCLE);
    expect(bad).toHaveProperty('errors');
  });

  it('warns only when the bicycle fee is not lower than the motorbike fee', () => {
    const flat = { fee_lkr: 150, fee_mode: 'FLAT' as const, updated_at: null };
    expect(motorbikeFeeAt({ ...flat, fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40 }, 3)).toBe(160);
    expect(bicycleFeeWarning(3, BICYCLE.fee, flat)).toBeNull();
    expect(bicycleFeeWarning(3, BICYCLE.fee, { ...flat, fee_lkr: 80 })).toMatch(/not lower than the motorbike fee \(LKR 80\)/);
    expect(bicycleFeeWarning(3, BICYCLE.fee, null)).toBeNull();
  });
});

// ------------------------------------------------------------- the card
function cardHandlers(
  extra: (call: Call) => unknown = () => undefined,
  opts: { bicycle?: Partial<BicycleDeliverySetting>; fee?: Record<string, unknown> | null } = {}
) {
  let bicycle: BicycleDeliverySetting = { ...BICYCLE, ...opts.bicycle };
  const answer = (call: Call) => extra(call);
  return {
    'GET /admin/settings/bicycle-delivery': (c: Call) => answer(c) ?? ok(bicycle),
    'PUT /admin/settings/bicycle-delivery': (c: Call) => {
      const r = answer(c);
      if (r) return r;
      bicycle = { ...bicycle, ...c.body, updated_at: '2026-11-05T05:00:00.000Z' };
      return ok(bicycle);
    },
    ...(opts.fee === null
      ? {}
      : {
          'GET /admin/settings/delivery-fee': () =>
            ok({ fee_lkr: 150, fee_mode: 'FLAT', tiers: [], max_fee_lkr: null, updated_at: null, ...opts.fee }),
        }),
  };
}

async function openCard(handlers: Record<string, (c: Call) => unknown>) {
  const rendered = renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), handlers);
  const card = (await screen.findByRole('heading', { name: 'Bicycle delivery' })).closest('section') as HTMLElement;
  await within(card).findByLabelText(/Bicycle only up to/);
  return { ...rendered, card };
}

describe('More > Deliveries > Bicycle delivery card', () => {
  it('is off by default, shows the numbers, the worked example and the plain help', async () => {
    const { card } = await openCard(cardHandlers());
    expect(within(card).getByRole('checkbox', { name: /Bicycle delivery/ })).not.toBeChecked();
    expect(within(card).getByLabelText(/Bicycle only up to/)).toHaveValue('3');
    expect(within(card).getByLabelText('Base fee (LKR)')).toHaveValue('80');
    expect(within(card).getByLabelText(/Base fee covers the first/)).toHaveValue('2');
    expect(within(card).getByLabelText(/Then for each extra started km/)).toHaveValue('30');
    expect(within(card).getByLabelText(/Maximum fee/)).toHaveValue('');
    expect(within(card).getByLabelText(/Rider pay per delivery/)).toHaveValue('50');
    expect(within(card).getByTestId('bicycle-example')).toHaveTextContent('A 1.5 km order: customer pays LKR 80, rider earns LKR 50');
    expect(card).toHaveTextContent('short, flat trips');
    expect(card).toHaveTextContent('You still assign the rider');
    expect(within(card).queryByTestId('bicycle-not-ready')).toBeNull();
  });

  it('recomputes the example as the numbers change, for both rider pay modes', async () => {
    const user = userEvent.setup();
    const { card } = await openCard(cardHandlers());
    const base = within(card).getByLabelText('Base fee (LKR)');
    await user.clear(base);
    await user.type(base, '100');
    const fixed = within(card).getByLabelText(/Rider pay per delivery/);
    await user.clear(fixed);
    await user.type(fixed, '60');
    expect(within(card).getByTestId('bicycle-example')).toHaveTextContent('A 1.5 km order: customer pays LKR 100, rider earns LKR 60');

    await user.click(within(card).getByRole('button', { name: 'Base + per km' }));
    expect(within(card).queryByLabelText(/Rider pay per delivery/)).toBeNull();
    expect(within(card).getByLabelText(/Rider base pay/)).toHaveValue('30');
    expect(within(card).getByLabelText(/Rider pay for each km/)).toHaveValue('15');
    expect(within(card).getByTestId('bicycle-example')).toHaveTextContent('rider earns LKR 52.50');
    await user.type(within(card).getByLabelText(/Minimum rider pay/), '70');
    expect(within(card).getByTestId('bicycle-example')).toHaveTextContent('rider earns LKR 70');
  });

  it('saves every section whole with PUT and says what it saved', async () => {
    const user = userEvent.setup();
    const { api, card } = await openCard(cardHandlers());
    await user.click(within(card).getByRole('checkbox', { name: /Bicycle delivery/ }));
    const km = within(card).getByLabelText(/Bicycle only up to/);
    await user.clear(km);
    await user.type(km, '2.5');
    await user.type(within(card).getByLabelText(/Maximum fee/), '140');
    await user.click(within(card).getByRole('button', { name: 'Base + per km' }));
    await user.type(within(card).getByLabelText(/Minimum rider pay/), '45');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/bicycle-delivery')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/bicycle-delivery')[0].body).toEqual({
      enabled: true,
      max_km: 2.5,
      fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: 140 },
      rider_pay: { mode: 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: 45 },
    });
    expect(await within(card).findByRole('status')).toHaveTextContent('Bicycle delivery is on, up to 2.5 km.');
    expect(within(card).getByRole('checkbox', { name: /Bicycle delivery/ })).toBeChecked();
  });

  it('refuses bad numbers before saving and says which box', async () => {
    const user = userEvent.setup();
    const { api, card } = await openCard(cardHandlers());
    const km = within(card).getByLabelText(/Bicycle only up to/);
    await user.clear(km);
    await user.type(km, '12');
    const base = within(card).getByLabelText('Base fee (LKR)');
    await user.clear(base);
    await user.type(base, '2000');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Distances must be between 0.5 and 10 km.')).toBeInTheDocument();
    expect(within(card).getByText('Amounts must be between LKR 0 and LKR 1,000.')).toBeInTheDocument();
    expect(within(card).getByText('Fill in every amount to see an example.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/bicycle-delivery')).toHaveLength(0);
  });

  it("shows the server's message when a save is refused", async () => {
    const user = userEvent.setup();
    const { card } = await openCard(
      cardHandlers((c) => (c.method === 'PUT' ? fail(400, 'VALIDATION_ERROR', 'Turn bicycle delivery on only with a valid fee.') : undefined))
    );
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Turn bicycle delivery on only with a valid fee.');
  });

  it('tells staff the owner must run the database update while ready is false', async () => {
    const { card } = await openCard(cardHandlers(() => undefined, { bicycle: { ready: false } }));
    expect(await within(card).findByTestId('bicycle-not-ready')).toHaveTextContent('owner must run the database update');
    expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('warns when the bicycle fee is not lower than the motorbike fee, and not when it is', async () => {
    const first = await openCard(cardHandlers(() => undefined, { fee: { fee_lkr: 80 } }));
    expect(await within(first.card).findByTestId('bicycle-warning')).toHaveTextContent('not lower than the motorbike fee (LKR 80)');
    first.unmount();
    cleanup();

    const second = await openCard(cardHandlers(() => undefined, { fee: { fee_lkr: 250 } }));
    await within(second.card).findByTestId('bicycle-example');
    expect(within(second.card).queryByTestId('bicycle-warning')).toBeNull();
  });

  it('skips the warning when the motorbike fee cannot be read', async () => {
    const { card } = await openCard(cardHandlers(() => undefined, { fee: null }));
    expect(within(card).queryByTestId('bicycle-warning')).toBeNull();
  });

  it('says so when the setting cannot be loaded', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('deliveries'), cardHandlers((c) => (c.method === 'GET' && c.path === '/admin/settings/bicycle-delivery' ? fail(500, 'INTERNAL', 'Boom') : undefined)));
    const card = (await screen.findByRole('heading', { name: 'Bicycle delivery' })).closest('section') as HTMLElement;
    await waitFor(() => expect(card).toHaveTextContent(/API had a problem|Boom/));
  });
});

// --------------------------------------------------------------- orders
let seq = 0;
function boardOrder(over: Partial<BoardOrder> = {}): BoardOrder {
  seq += 1;
  return {
    id: `o${seq}`,
    order_number: `BL-20261105-000${seq}`,
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
    delivery_method: 'BICYCLE',
    ...over,
  };
}

function detailOf(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    order_number: 'BL-20261105-0001',
    order_status: 'PACKED',
    payment_method: 'COD',
    payment_status: 'PENDING',
    subtotal_amount: 600,
    delivery_fee: 100,
    total_amount: 700,
    placed_at: '2026-11-05T07:00:00.000Z',
    scheduled_for: null,
    delivery_recipient_name: 'Nimal Perera',
    delivery_recipient_phone: '+94771234567',
    delivery_address_line1: 'No. 1, Test Lane',
    delivery_address_line2: null,
    delivery_city: 'Dharga Town',
    delivery_instructions: null,
    cancellation_reason: null,
    items: [{ id: 'i1', product_name_snapshot: 'Milk 1L', quantity: 1, item_status: 'PACKED' }],
    history: [],
    delivery: null,
    delivery_method: 'BICYCLE',
    ...over,
  } as OrderDetail;
}

const MOTORBIKE_DETAIL = detailOf({ delivery_method: 'MOTORBIKE', delivery_fee: 150, total_amount: 750 });

describe('Bicycle badge', () => {
  it('shows "Bicycle" for a bicycle order only', () => {
    const { rerender } = render(<BicycleTag method="BICYCLE" />);
    expect(screen.getByTestId('bicycle-badge')).toHaveTextContent('Bicycle');
    rerender(<BicycleTag method="MOTORBIKE" />);
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
    rerender(<BicycleTag method={undefined} />);
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
  });

  it('is on the Orders board row and on the order detail; a motorbike order has none', async () => {
    const bike = boardOrder({ id: 'o1', order_number: 'BL-20261105-0001' });
    const moto = boardOrder({ id: 'o2', order_number: 'BL-20261105-0002', delivery_method: 'MOTORBIKE' });
    const live = [bike, moto];
    renderAs(OPERATIONS_STAFF, '/orders', {
      'GET /admin/orders': (c) =>
        c.query.since
          ? ok({ orders: [], pagination: { page: 1, limit: 100, total: 0, total_pages: 1 } })
          : ok({ orders: live, pagination: { page: 1, limit: 100, total: 2, total_pages: 1 } }),
      'GET /admin/orders/:id': () => ok({ order: detailOf() }),
    });
    const row = (await screen.findByRole('link', { name: 'Open order #0001' })).closest('li') as HTMLElement;
    expect(within(row).getByTestId('bicycle-badge')).toBeInTheDocument();
    const other = screen.getByRole('link', { name: 'Open order #0002' }).closest('li') as HTMLElement;
    expect(within(other).queryByTestId('bicycle-badge')).toBeNull();
  });

  it('is on the order detail', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: detailOf() }) });
    expect(await screen.findByTestId('bicycle-badge')).toBeInTheDocument();
  });
});

describe('canSwitchToMotorbike', () => {
  it('only a bicycle order before pick-up', () => {
    const o = { order_status: 'PACKED' as const, delivery_method: 'BICYCLE' as const };
    expect(canSwitchToMotorbike(o)).toBe(true);
    expect(canSwitchToMotorbike({ ...o, delivery_method: 'MOTORBIKE' })).toBe(false);
    expect(canSwitchToMotorbike({ order_status: 'PACKED' })).toBe(false);
    for (const status of ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'] as const) expect(canSwitchToMotorbike({ ...o, order_status: status })).toBe(true);
    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED'] as const) expect(canSwitchToMotorbike({ ...o, order_status: status })).toBe(false);
  });
});

describe('Order detail - Switch to motorbike', () => {
  it('confirms in plain words, posts MOTORBIKE, then shows the new total and refreshes the order', async () => {
    const user = userEvent.setup();
    let switched = false;
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: switched ? MOTORBIKE_DETAIL : detailOf() }),
      'POST /admin/orders/:id/delivery-method': () => {
        switched = true;
        return ok({ order: MOTORBIKE_DETAIL });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    const dialog = screen.getByRole('dialog', { name: 'Switch to motorbike' });
    expect(dialog).toHaveTextContent(
      "The customer's delivery fee changes to the motorbike fee and any assigned bicycle rider is released. The customer is sent a text."
    );
    expect(api.find('POST', '/admin/orders/o1/delivery-method')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Yes, switch to motorbike' }));
    expect(await screen.findByTestId('switch-motorbike-done')).toHaveTextContent('The new total is LKR 750');
    expect(api.find('POST', '/admin/orders/o1/delivery-method')[0].body).toEqual({ method: 'MOTORBIKE' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Re-read: a motorbike order now, so no badge and no button.
    await waitFor(() => expect(screen.queryByTestId('bicycle-badge')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
    expect(api.find('GET', '/admin/orders/o1').length).toBeGreaterThanOrEqual(2);
  });

  it('Back closes the confirm step without sending anything', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: detailOf() }) });
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.find('POST', '/admin/orders/o1/delivery-method')).toHaveLength(0);
  });

  it.each([
    ['ORDER_NOT_SWITCHABLE', 'The delivery method can only be changed before the order is picked up.'],
    ['ALREADY_MOTORBIKE', 'This order is already a motorbike delivery.'],
    [
      'ORDER_PAID_CANNOT_SWITCH',
      "This order was paid online or with the Blynk Wallet, so its delivery fee can't change. Cancel it and ask the customer to order again with motorbike delivery.",
    ],
  ])('shows the server message for a 409 %s and re-reads the order', async (code, message) => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: detailOf() }),
      'POST /admin/orders/:id/delivery-method': () => fail(409, code, message),
    });
    await user.click(await screen.findByRole('button', { name: 'Switch to motorbike' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, switch to motorbike' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    await waitFor(() => expect(api.find('GET', '/admin/orders/o1').length).toBeGreaterThanOrEqual(2));
  });

  it.each(['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'] as const)('is offered while the order is %s', async (status) => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: detailOf({ order_status: status }) }) });
    expect(await screen.findByRole('button', { name: 'Switch to motorbike' })).toBeInTheDocument();
  });

  it.each(['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const)('is not offered once the order is %s', async (status) => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: detailOf({ order_status: status }) }) });
    await screen.findByRole('region', { name: 'Items' });
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
  });

  it('is not offered on a motorbike order', async () => {
    renderAs(OPERATIONS_STAFF, '/orders/o1', { 'GET /admin/orders/:id': () => ok({ order: MOTORBIKE_DETAIL }) });
    await screen.findByRole('region', { name: 'Items' });
    expect(screen.queryByRole('button', { name: 'Switch to motorbike' })).toBeNull();
    expect(screen.queryByTestId('bicycle-badge')).toBeNull();
  });
});

// -------------------------------------------------------------- pickers
describe('Rider pickers', () => {
  const roster = [{ id: 'b1', full_name: 'Cycle Rider', phone: '+94770000001', vehicle_type: 'BICYCLE', vehicle_registration_number: 'CYCLE-1', open_deliveries: 0 }];
  const order = { ...boardOrder({ id: 'o1' }) };

  it('asks for the roster of THIS order, so a bicycle order lists only bicycle riders', async () => {
    const api = mockApi({
      'GET /admin/riders/suggestions': () => fail(500, 'INTERNAL', 'down'),
      'GET /admin/riders': () => ok({ riders: roster }),
    });
    render(<AssignRiderDialog order={order} busy={false} onAssign={() => {}} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    expect(await within(dialog).findByRole('radio', { name: /Cycle Rider/ })).toBeInTheDocument();
    expect(api.find('GET', '/admin/riders')[0].query.order_id).toBe('o1');
    expect(api.find('GET', '/admin/riders/suggestions')[0].query.order_id).toBe('o1');
    expect(within(dialog).getByTestId('bicycle-badge')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('only riders who deliver by bicycle are listed');
  });

  it('a motorbike order shows no bicycle note', async () => {
    mockApi({
      'GET /admin/riders/suggestions': () => fail(500, 'INTERNAL', 'down'),
      'GET /admin/riders': () => ok({ riders: roster }),
    });
    render(<AssignRiderDialog order={{ ...order, delivery_method: 'MOTORBIKE' }} busy={false} onAssign={() => {}} onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await within(dialog).findByRole('radio', { name: /Cycle Rider/ });
    expect(within(dialog).queryByTestId('bicycle-badge')).toBeNull();
    expect(dialog).not.toHaveTextContent('bicycle');
  });

  it('on the order detail, assigning a bicycle order to a non-bicycle rider shows the server message', async () => {
    const user = userEvent.setup();
    const refusal = 'This is a bicycle delivery, so it can only be given to a rider who delivers by bicycle.';
    renderAs(OPERATIONS_STAFF, '/orders/o1', {
      'GET /admin/orders/:id': () => ok({ order: detailOf() }),
      'GET /admin/riders/suggestions': () => fail(500, 'INTERNAL', 'down'),
      'GET /admin/riders': () => ok({ riders: roster }),
      'POST /admin/orders/:id/assign-rider': () => fail(409, 'RIDER_NOT_BICYCLE', refusal),
    });
    await user.click(await screen.findByRole('button', { name: /^Assign rider/ }));
    const dialog = await screen.findByRole('dialog', { name: /Assign a rider/ });
    await user.click(await within(dialog).findByRole('radio', { name: /Cycle Rider/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText(refusal)).toBeInTheDocument();
  });

  it('the Rider map offers a bicycle order only to bicycle riders (any rider still sees motorbike orders)', () => {
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
