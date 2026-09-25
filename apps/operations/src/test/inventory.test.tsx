import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type {
  LedgerEntry,
  OrderSourcing,
  QueueOrder,
  SourcingItem,
  StockDetail,
  StockRow,
  Supplier,
} from '../api/types';
import { ADMIN_WITH_RIDER, fail, ok, renderAs } from './helpers';

/**
 * Stock/Ledger/Sourcing/Suppliers (task F6, plan §13) against a fake Blynk
 * API shaped exactly like the backend's responses (verified directly against
 * `apps/inventory`'s own working screens and the real route table -
 * `backend/api/src/modules/admin/index.ts` - before writing any type or
 * call, per common.md rule 7 and F5's own "verify the brief against real
 * code" discipline). Every stock number/resulting balance asserted below is
 * exactly what the mocked backend response says - never predicted
 * client-side before the request completes (this task's brief).
 */

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

let seq = 0;

function stockRow(overrides: Partial<StockRow> = {}): StockRow {
  seq += 1;
  return {
    inventory_id: `inv${seq}`,
    product_id: `prod${seq}`,
    product_name: `Product ${seq}`,
    product_sku: `SKU-${100 + seq}`,
    product_unit: '1 L',
    category_name: 'Dairy',
    is_active: true,
    is_available: true,
    tracking_mode: 'TRACKED',
    quantity_on_hand: 40,
    quantity_reserved: 5,
    quantity_available: 35,
    low_stock_threshold: 10,
    is_low_stock: false,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function stockDetail(overrides: Partial<StockDetail> = {}): StockDetail {
  return {
    product_id: 'prod1',
    product_name: 'Fresh Milk',
    product_sku: 'SKU-101',
    tracking_mode: 'TRACKED',
    quantity_on_hand: 40,
    quantity_reserved: 5,
    quantity_available: 35,
    low_stock_threshold: 10,
    is_low_stock: false,
    updated_at: new Date().toISOString(),
    adjustments: [],
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  seq += 1;
  return {
    id: `adj${seq}`,
    adjustment_type: 'PURCHASE_RESTOCK',
    quantity_delta: 20,
    previous_quantity: 20,
    new_quantity: 40,
    reference_order_id: null,
    notes: 'Weekly restock',
    created_by_user_id: 'u-admin-1',
    created_at: new Date().toISOString(),
    actor_name: 'Nawaz Mansoor',
    actor_role: 'ADMIN',
    inventory_id: `inv${seq}`,
    product_id: `prod${seq}`,
    product_name: `Product ${seq}`,
    product_sku: `SKU-${100 + seq}`,
    product_unit: '1 L',
    ...overrides,
  };
}

function queueOrder(overrides: Partial<QueueOrder> = {}): QueueOrder {
  seq += 1;
  return {
    id: `o${seq}`,
    order_number: `BL-2026-000${seq}`,
    order_status: 'PLACED',
    placed_at: new Date().toISOString(),
    ...overrides,
  };
}

function sourcingItem(overrides: Partial<SourcingItem> = {}): SourcingItem {
  seq += 1;
  return {
    id: `item${seq}`,
    order_id: 'o1',
    product_id: `prod${seq}`,
    product_name_snapshot: `Product ${seq}`,
    sku_snapshot: `SKU-${100 + seq}`,
    unit_snapshot: '1 L',
    quantity: 2,
    subtotal: 700,
    estimated_unit_cost: 350,
    actual_unit_cost: null,
    item_status: 'PENDING',
    sourcing_records: [],
    ...overrides,
  };
}

function orderSourcing(order: QueueOrder, items: SourcingItem[]): OrderSourcing {
  const pending = items.filter((i) => i.item_status === 'PENDING').length;
  return {
    order_id: order.id,
    order_number: order.order_number,
    order_status: order.order_status,
    metrics: {
      total_items: items.length,
      sourced_items: items.filter((i) => i.item_status === 'SOURCED').length,
      unavailable_items: items.filter((i) => i.item_status === 'UNAVAILABLE').length,
      pending_items: pending,
      is_sourcing_complete: pending === 0,
    },
    items,
  };
}

function supplier(overrides: Partial<Supplier> = {}): Supplier {
  seq += 1;
  return {
    id: `sup${seq}`,
    name: `Supplier ${seq}`,
    code: null,
    contact_person: null,
    contact_phone: null,
    address: null,
    notes: null,
    is_active: true,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// -------------------------------------------------------------------- Overview
describe('Overview', () => {
  it('renders real "needs stock", "waiting to be sourced" and ledger sections - no fabricated figures', async () => {
    const low = stockRow({ product_name: 'Fresh Milk', quantity_on_hand: 3, quantity_available: 2, low_stock_threshold: 10 });
    const order = queueOrder({ order_number: 'BL-2026-0055' });
    const item = sourcingItem();
    const entry = ledgerEntry({ product_name: 'Butter' });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory', {
      'GET /admin/inventory': (call) =>
        call.query.low_stock_only === 'true' ? ok({ inventory: [low], pagination: { page: 1, limit: 100, total: 1, total_pages: 1 } }) : ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'GET /admin/orders': () => ok({ orders: [order] }),
      'GET /admin/orders/:id/sourcing': () => ok(orderSourcing(order, [item])),
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
      'GET /admin/inventory/adjustments': () => ok({ adjustments: [entry], pagination: { page: 1, limit: 8, total: 1, total_pages: 1 } }),
    });
    expect(await screen.findByText('Fresh Milk')).toBeInTheDocument();
    expect(await screen.findByText('BL-2026-0055')).toBeInTheDocument();
    expect(await screen.findByText('Butter')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------- Stock
describe('Stock', () => {
  it('lists real stock rows with real quantities and state - nothing fabricated', async () => {
    const row = stockRow({ product_name: 'Fresh Milk', quantity_on_hand: 40, quantity_available: 35 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock', {
      'GET /admin/inventory': () => ok({ inventory: [row], pagination: { page: 1, limit: 200, total: 1, total_pages: 1 } }),
    });
    await screen.findByText('Fresh Milk');
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(screen.getByText('35 units')).toBeInTheDocument();
  });

  it('an untracked product reads "Sourced on order", never a bare zero', async () => {
    const row = stockRow({ product_name: 'Ice', tracking_mode: 'UNTRACKED', quantity_on_hand: 0, quantity_available: 0 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock', {
      'GET /admin/inventory': () => ok({ inventory: [row], pagination: { page: 1, limit: 200, total: 1, total_pages: 1 } }),
    });
    await screen.findByText('Ice');
    expect(screen.getByText('Sourced on order')).toBeInTheDocument();
  });

  it('searching sends the trimmed term to the API', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock', {
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
    });
    await screen.findByText('No products in this view');
    await user.type(screen.getByLabelText('Search products by name or SKU'), 'milk');
    await waitFor(() => {
      const calls = api.find('GET', '/admin/inventory');
      expect(calls.some((c) => c.query.search === 'milk')).toBe(true);
    });
  });

  it('the "Low & out" view sends low_stock_only=true', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock', {
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
    });
    await screen.findByText('No products in this view');
    await user.click(screen.getByRole('button', { name: 'Low & out' }));
    await waitFor(() => {
      const calls = api.find('GET', '/admin/inventory');
      expect(calls.some((c) => c.query.low_stock_only === 'true')).toBe(true);
    });
  });

  it('a load failure is a real visible error', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock', {
      'GET /admin/inventory': () => fail(500, 'INTERNAL'),
    });
    expect(await screen.findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
  });
});

// -------------------------------------------------------------- Stock detail
describe('Stock detail', () => {
  it('renders the real on-hand/reserved/available figures and tracking mode', async () => {
    const detail = stockDetail({ product_name: 'Fresh Milk', quantity_on_hand: 40, quantity_reserved: 5, quantity_available: 35 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail),
    });
    await screen.findByText('Fresh Milk');
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('35')).toBeInTheDocument();
    expect(screen.getByText('TRACKED')).toBeInTheDocument();
  });

  it('adjusting stock (restock) sends exactly the adjustment type, delta and reason - the result comes back from the API, never predicted', async () => {
    const user = userEvent.setup();
    const detail = stockDetail({ quantity_on_hand: 20, quantity_reserved: 0 });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail),
      'POST /admin/inventory/:productId/adjust': () => ok({ inventory: { quantity_on_hand: 45, quantity_available: 45 } }),
    });
    await screen.findByText('Adjust stock');
    await user.click(screen.getByRole('button', { name: 'Adjust stock' }));
    await user.type(screen.getByLabelText('Units received'), '25');
    // `Field`'s hint text lives inside the same <label>, so an exact match
    // against just "Reason" would miss - a leading-anchor regex matches the
    // label's own text without depending on the hint's exact wording.
    await user.type(screen.getByLabelText(/^Reason/), 'Weekly restock from Dharga Town');
    await user.click(screen.getByRole('button', { name: 'Record adjustment' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/inventory/prod1/adjust')[0];
      expect(call?.body).toEqual({
        adjustment_type: 'PURCHASE_RESTOCK',
        quantity_delta: 25,
        notes: 'Weekly restock from Dharga Town',
      });
    });
  });

  it('changing tracking mode sends the target mode and reloads the real detail', async () => {
    const user = userEvent.setup();
    const detail = stockDetail({ tracking_mode: 'TRACKED' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/stock/prod1', {
      'GET /admin/inventory/:productId': () => ok(detail),
      'PATCH /admin/inventory/:productId/mode': () => ok({}),
    });
    await screen.findByText('Stop tracking');
    await user.click(screen.getByRole('button', { name: 'Stop tracking' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Change tracking mode' }));
    await user.click(dialog.getByRole('button', { name: 'Stop tracking' }));

    await waitFor(() => {
      const call = api.find('PATCH', '/admin/inventory/prod1/mode')[0];
      expect(call?.body).toEqual({ tracking_mode: 'UNTRACKED' });
    });
  });
});

// ---------------------------------------------------------------------- Ledger
describe('Ledger', () => {
  it('lists real adjustment records - product, type, signed delta and resulting balance', async () => {
    const entry = ledgerEntry({ product_name: 'Fresh Milk', adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: -5, new_quantity: 35 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/ledger', {
      'GET /admin/inventory/adjustments': () => ok({ adjustments: [entry], pagination: { page: 1, limit: 50, total: 1, total_pages: 1 } }),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
    });
    const row = (await screen.findByText('Fresh Milk')).closest('li')!;
    expect(within(row).getByText('Damage write-off', { exact: false })).toBeInTheDocument();
    expect(within(row).getByText('−5')).toBeInTheDocument();
  });

  it('filtering by product sends product_id to the API', async () => {
    const user = userEvent.setup();
    const row = stockRow({ product_name: 'Fresh Milk' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/ledger', {
      'GET /admin/inventory/adjustments': () => ok({ adjustments: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 1 } }),
      'GET /admin/inventory': () => ok({ inventory: [row], pagination: { page: 1, limit: 200, total: 1, total_pages: 1 } }),
    });
    await screen.findByText('No stock movements yet');
    await user.selectOptions(screen.getByLabelText('Filter by product'), row.product_id);
    await waitFor(() => {
      const calls = api.find('GET', '/admin/inventory/adjustments');
      expect(calls.some((c) => c.query.product_id === row.product_id)).toBe(true);
    });
  });

  it('an empty ledger reads as a real, honest empty state', async () => {
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/ledger', {
      'GET /admin/inventory/adjustments': () => ok({ adjustments: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 1 } }),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
    });
    expect(await screen.findByText('No stock movements yet')).toBeInTheDocument();
  });
});

// -------------------------------------------------------------------- Sourcing
describe('Sourcing queue', () => {
  it('groups pending items by order, oldest first, with real quantities and estimates', async () => {
    const order = queueOrder({ order_number: 'BL-2026-0099' });
    const item = sourcingItem({ product_name_snapshot: 'Coconut Water', quantity: 3, estimated_unit_cost: 250 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/sourcing', {
      'GET /admin/orders': () => ok({ orders: [order] }),
      'GET /admin/orders/:id/sourcing': () => ok(orderSourcing(order, [item])),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
    });
    await screen.findByText('BL-2026-0099');
    expect(screen.getByText('3 × Coconut Water')).toBeInTheDocument();
    expect(screen.getByText('To source')).toBeInTheDocument();
  });

  it('an order with nothing pending is left out of the queue', async () => {
    const order = queueOrder();
    const sourcedItem = sourcingItem({ item_status: 'SOURCED', actual_unit_cost: 300 });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/sourcing', {
      'GET /admin/orders': () => ok({ orders: [order] }),
      'GET /admin/orders/:id/sourcing': () => ok(orderSourcing(order, [sourcedItem])),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
    });
    expect(await screen.findByText('Nothing to source')).toBeInTheDocument();
  });

  it('sourcing an item submits exactly the actual cost, quantity, supplier and note the operator entered', async () => {
    const user = userEvent.setup();
    const order = queueOrder();
    const item = sourcingItem({ product_name_snapshot: 'Coconut Water', quantity: 3 });
    const sup = supplier({ name: 'Dharga Town Central Grocery' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/sourcing', {
      'GET /admin/orders': () => ok({ orders: [order] }),
      'GET /admin/orders/:id/sourcing': () => ok(orderSourcing(order, [item])),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'GET /admin/suppliers': () => ok({ suppliers: [sup] }),
      'POST /admin/orders/:id/items/:itemId/source': () => ok({}),
    });
    await screen.findByText('3 × Coconut Water');
    await user.click(screen.getByRole('button', { name: 'Source' }));
    // These two Fields carry a hint inside the same <label> as the control,
    // so an exact label match would miss - a leading-anchor regex matches on
    // the label text alone (see the AdjustDialog test's own note).
    await user.type(screen.getByLabelText(/^Actual unit cost/), '360');
    await user.selectOptions(screen.getByLabelText(/^Supplier/), sup.id);
    await user.type(screen.getByLabelText('Note (optional)'), 'Bought fresh');
    await user.click(screen.getByRole('button', { name: 'Record sourcing' }));

    await waitFor(() => {
      const call = api.find('POST', `/admin/orders/${order.id}/items/${item.id}/source`)[0];
      expect(call?.body).toEqual({
        actual_unit_cost: 360,
        quantity: 3,
        supplier_id: sup.id,
        notes: 'Bought fresh',
      });
    });
  });

  it('marking an item unavailable submits the exact resolve-item payload', async () => {
    const user = userEvent.setup();
    const order = queueOrder();
    const item = sourcingItem({ product_name_snapshot: 'Coconut Water' });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/sourcing', {
      'GET /admin/orders': () => ok({ orders: [order] }),
      'GET /admin/orders/:id/sourcing': () => ok(orderSourcing(order, [item])),
      'GET /admin/inventory': () => ok({ inventory: [], pagination: { page: 1, limit: 200, total: 0, total_pages: 1 } }),
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
      'POST /admin/orders/:id/resolve-item': () => ok({}),
    });
    await screen.findByText('Coconut Water', { exact: false });
    await user.click(screen.getByRole('button', { name: 'Mark unavailable' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Mark item unavailable' }));
    await user.click(dialog.getByRole('button', { name: 'Mark unavailable' }));

    await waitFor(() => {
      const call = api.find('POST', `/admin/orders/${order.id}/resolve-item`)[0];
      expect(call?.body).toEqual({ item_id: item.id, item_status: 'UNAVAILABLE' });
    });
  });
});

// ------------------------------------------------------------------ Suppliers
describe('Suppliers', () => {
  it('lists real suppliers with contact and status - no delete control anywhere on the screen', async () => {
    const sup = supplier({ name: 'Dharga Town Central Grocery', code: 'SUP-DTC', is_active: true });
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/suppliers', {
      'GET /admin/suppliers': () => ok({ suppliers: [sup] }),
    });
    const row = (await screen.findByText('Dharga Town Central Grocery')).closest('li')!;
    expect(within(row).getByText('SUP-DTC')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    // The backend has no delete endpoint (verified against admin/index.ts) -
    // this screen must not offer one.
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('adding a supplier sends only the fields actually entered', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/suppliers', {
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
      'POST /admin/suppliers': () => ok({ supplier: supplier() }),
    });
    await screen.findByText('No active suppliers');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add supplier' }));
    await user.type(dialog.getByLabelText('Name'), 'Dharga Town Central Grocery');
    await user.click(dialog.getByRole('button', { name: 'Add supplier' }));

    await waitFor(() => {
      const call = api.find('POST', '/admin/suppliers')[0];
      expect(call?.body).toEqual({ name: 'Dharga Town Central Grocery' });
    });
  });

  it('a duplicate supplier code keeps the dialog open with a real inline error', async () => {
    const user = userEvent.setup();
    renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/suppliers', {
      'GET /admin/suppliers': () => ok({ suppliers: [] }),
      'POST /admin/suppliers': () => fail(409, 'SUPPLIER_CODE_TAKEN'),
    });
    await screen.findByText('No active suppliers');
    await user.click(screen.getByRole('button', { name: 'Add supplier' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add supplier' }));
    await user.type(dialog.getByLabelText('Name'), 'Dharga Town Central Grocery');
    await user.type(dialog.getByLabelText(/^Code/), 'SUP-DTC');
    await user.click(dialog.getByRole('button', { name: 'Add supplier' }));

    expect(await screen.findByText('Another supplier already uses this code.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('deactivating sends is_active:false on exactly the chosen supplier', async () => {
    const user = userEvent.setup();
    const sup = supplier({ name: 'Dharga Town Central Grocery', is_active: true });
    const { api } = renderAs(ADMIN_WITH_RIDER, '/catalog/inventory/suppliers', {
      'GET /admin/suppliers': () => ok({ suppliers: [sup] }),
      'PATCH /admin/suppliers/:id': () => ok({ supplier: { ...sup, is_active: false } }),
    });
    await screen.findByText('Dharga Town Central Grocery');
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Deactivate supplier' }));
    await user.click(confirm.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      const call = api.find('PATCH', `/admin/suppliers/${sup.id}`)[0];
      expect(call?.body).toEqual({ is_active: false });
    });
  });
});
