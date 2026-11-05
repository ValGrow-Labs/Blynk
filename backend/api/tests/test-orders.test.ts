import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/database/connection.js';
import { checkoutSettings } from '../src/modules/configuration/settings.service.js';
import { RIDER_AUTO_ASSIGN_KEY } from '../src/modules/configuration/rider-auto-assign.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { haversineM } from '../src/modules/routing/index.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import { runAutoAssign } from '../src/modules/riders/rider.auto-assign.js';
import { salesReport } from '../src/modules/reports/sales.service.js';
import {
  isReviewCustomer,
  MAX_OPEN_TEST_ORDERS,
  MAX_TEST_ORDERS_PER_DAY,
  setTestOrdersReadyForTests,
  TEST_ORDER_AUTO_CANCEL_MINUTES,
  TEST_ORDER_CANCEL_REASON,
} from '../src/modules/orders/test-orders.js';
import { cancelDueTestOrders } from '../src/modules/orders/test-orders.job.js';
import { orderingClock } from '../src/utils/time.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Test orders for the Google Play review account (owner's brother, 2026-11-05; migration 068; orders/test-orders.ts).
 * The review number (REVIEW_LOGIN_PHONE, set only in Coolify - here a number made up by this file) can place cash on
 * delivery orders at any time from any address; they are marked is_test, make no noise, and are cancelled after 10
 * minutes by the ordinary cancel. Every other customer is untouched. Everything this file made is removed.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-TSO-');
const people = customerFixtures(app, { idPrefix: 'c0c00068', phoneBase: '+947096800', name: 'Test Order Customer' });
const startedAt = new Date();
const DEVICE = `test-orders-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const CLOSED_NIGHT = new Date('2026-10-06T15:30:00.000Z'); // 9:00 PM in Colombo: the store is closed
const KALUTARA = { latitude: 6.5854, longitude: 79.9607 }; // about 18 km from the store

const KEYS = ['delivery_fee', RIDER_AUTO_ASSIGN_KEY];
type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
const pinnedCheckout = checkoutSettings.read;
const realFeeRoad = feeDistance.roadMetres;
const realNow = orderingClock.now;
const savedEnv = { phone: env.REVIEW_LOGIN_PHONE };
const setReviewPhone = (phone: string) => ((env as { REVIEW_LOGIN_PHONE: string }).REVIEW_LOGIN_PHONE = phone);

let reviewer: Awaited<ReturnType<typeof people.customer>>;
let normal: Awaited<ReturnType<typeof people.customer>>;
let plainProduct = '';
let reviewerFarAddress = '';

const orderRow = async (id: string) =>
  (await pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0] as Record<string, any>;
const closeStore = () => (orderingClock.now = () => CLOSED_NIGHT);
const openStore = () => (orderingClock.now = realNow);
const lines = (qty = 1, product = plainProduct) => [{ product_id: product, quantity: qty }];
const histories = async (id: string) =>
  (await pool.query('SELECT old_status, new_status, reason_or_notes FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id', [id])).rows;
const audits = async (id: string) =>
  (await pool.query("SELECT action, new_values FROM audit_logs WHERE entity_id = $1 AND action = 'TEST_ORDER_AUTO_CANCELLED'", [id])).rows;
const notificationsFor = async (id: string) =>
  (await pool.query('SELECT channel, notification_type, recipient FROM notifications WHERE order_id = $1', [id])).rows;
const inMinutes = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);
const backdate = (id: string, minutes: number) =>
  pool.query("UPDATE orders SET placed_at = now() - make_interval(mins => $2) WHERE id = $1", [id, minutes]);
async function sweepAll() {
  // everything this file placed is older than the window
  await pool.query(
    "UPDATE orders SET placed_at = now() - interval '1 hour' WHERE is_test AND customer_id = $1 AND order_status IN ('PLACED', 'PACKED')",
    [reviewer.id]
  );
  return await cancelDueTestOrders(new Date());
}
const patchFee = (body: object) => request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin)).send(body);
const info = async (token: string, qs = '') => (await request(app).get('/api/v1/orders/checkout-info' + qs).set(auth(token))).body.data;
const saveAddress = (token: string, body: object) =>
  request(app)
    .post('/api/v1/me/addresses')
    .set(auth(token))
    .send({ label: 'Abroad', recipient_name: 'Play Reviewer', recipient_phone: '077 123 4567', address_line1: '1 Test Street', city: 'Far Away', ...body });

beforeAll(async () => {
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled: false, count: 10, since: startedAt.toISOString() },
    show_offer_savings: false,
  });
  // migration 068 (the same file Coolify runs; idempotent) - the local database gets the column the first time
  await pool.query(fs.readFileSync(path.join(__dirname, '../src/database/migrations/068_test_orders.sql'), 'utf-8'));
  setTestOrdersReadyForTests(null);
  await people.purge(9);
  await fx.setup();
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status).toBe(200);
  // no OSRM: the straight line from point to point, so a fee measured from the store is 0 km
  feeDistance.roadMetres = async (from, to) => Math.round(haversineM(from, to));
  feeDistanceCache.clear();
  plainProduct = (await fx.product({ tracked: false })).productId;
  reviewer = await people.customer(1, 'Play Reviewer');
  normal = await people.customer(2, 'Normal Customer');
  setReviewPhone(reviewer.phone);
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [
    users.admin.id,
    DEVICE,
  ]);
  setPushSenderForTests(fake);
}, 60_000);

afterEach(() => {
  openStore();
  setReviewPhone(reviewer.phone);
  setTestOrdersReadyForTests(null);
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  openStore();
  setReviewPhone(savedEnv.phone);
  setTestOrdersReadyForTests(null);
  checkoutSettings.read = pinnedCheckout;
  feeDistance.roadMetres = realFeeRoad;
  feeDistanceCache.clear();
  await pool.query("DELETE FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND created_at >= $1", [startedAt]);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  await pool.query("DELETE FROM audit_logs WHERE action IN ('TEST_ORDER_AUTO_CANCELLED', 'DELIVERY_FEE_UPDATED') AND created_at >= $1", [startedAt]);
  await pool.query('DELETE FROM audit_logs WHERE actor_user_id = $1 OR actor_user_id = $2', [reviewer.id, normal.id]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await people.cleanup();
  await fx.cleanup();
});

// ---------------------------------------------------------------------------------------------------
describe('isReviewCustomer', () => {
  it('is true only for the configured review number, and never while the setting is empty', () => {
    expect(isReviewCustomer('+94700000001', { REVIEW_LOGIN_PHONE: '+94700000001' })).toBe(true);
    expect(isReviewCustomer('+94700000002', { REVIEW_LOGIN_PHONE: '+94700000001' })).toBe(false);
    expect(isReviewCustomer('+94700000001', { REVIEW_LOGIN_PHONE: '' })).toBe(false);
    expect(isReviewCustomer('', { REVIEW_LOGIN_PHONE: '' })).toBe(false);
    expect(isReviewCustomer(null, { REVIEW_LOGIN_PHONE: '+94700000001' })).toBe(false);
    expect(isReviewCustomer(undefined, { REVIEW_LOGIN_PHONE: '+94700000001' })).toBe(false);
  });

  it('uses the live setting: with it empty even the review number is an ordinary customer', async () => {
    setReviewPhone('');
    closeStore();
    const res = await reviewer.placeOrder(lines());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STORE_CLOSED');
    expect((await info(reviewer.token)).test_mode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('placing a test order', () => {
  it('a closed store refuses an ordinary customer (422 STORE_CLOSED) but takes the review customer\'s order', async () => {
    closeStore();
    const refused = await normal.placeOrder(lines());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('STORE_CLOSED');

    const order = await expectCreated(await reviewer.placeOrder(lines()));
    expect(order).toMatchObject({ is_test: true, order_status: 'PLACED', payment_method: 'COD', delivery_fee: expect.any(Number) });
    expect(order.points_earn_preview).toBe(0);
    expect(await orderRow(order.id)).toMatchObject({ is_test: true, order_status: 'PLACED', payment_method: 'COD', scheduled_for: null });
    await sweepAll();
  });

  it('an ordinary customer\'s order is untouched: not a test order, normal alerts, not cancelled', async () => {
    const order = await expectCreated(await normal.placeOrder(lines()));
    expect(order.is_test).toBe(false);
    expect((await orderRow(order.id)).is_test).toBe(false);
    const pushes = await pool.query("SELECT recipient FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND order_id = $1", [order.id]);
    expect(pushes.rows.some((r) => r.recipient === users.admin.id)).toBe(true);
    // the sweep leaves it alone, however old it is
    await backdate(order.id, 600);
    await cancelDueTestOrders(new Date());
    expect((await orderRow(order.id)).order_status).toBe('PLACED');
  });

  it('an address outside the delivery area: refused for an ordinary customer, saved and ordered to for the review customer', async () => {
    const refusedSave = await saveAddress(normal.token, KALUTARA);
    expect(refusedSave.status).toBe(422);
    expect(refusedSave.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    const farForNormal = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Far', 'Far', '+94771234567', 'No. 9', 'Kalutara', $2, $3, false) RETURNING id`,
        [normal.id, KALUTARA.latitude, KALUTARA.longitude]
      )
    ).rows[0].id as string;
    const refusedOrder = await request(app).post('/api/v1/orders').set(auth(normal.token)).send({ address_id: farForNormal, items: lines() });
    expect(refusedOrder.status).toBe(422);
    expect(refusedOrder.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');

    const saved1 = await saveAddress(reviewer.token, KALUTARA);
    expect(saved1.status, JSON.stringify(saved1.body)).toBe(201);
    reviewerFarAddress = saved1.body.data.address.id;
    // moving a saved pin out of the area is accepted too
    const moved = await request(app)
      .patch(`/api/v1/me/addresses/${reviewer.addressId}`)
      .set(auth(reviewer.token))
      .send({ latitude: KALUTARA.latitude, longitude: KALUTARA.longitude });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    await pool.query('UPDATE customer_addresses SET latitude = 6.4351, longitude = 80.0243 WHERE id = $1', [reviewer.addressId]);

    // checkout-info answers test_mode and the fee measured from the store (nothing is delivered)
    const quote = await info(reviewer.token, `?address_id=${reviewerFarAddress}`);
    expect(quote.test_mode).toBe(true);
    expect(quote).toMatchObject({ standard_delivery_fee_lkr: 120, delivery_distance_km: 0 });
    expect((await info(normal.token)).test_mode).toBeUndefined();

    closeStore();
    const res = await request(app).post('/api/v1/orders').set(auth(reviewer.token)).send({ address_id: reviewerFarAddress, items: lines() });
    const order = await expectCreated(res);
    expect(order).toMatchObject({ is_test: true, delivery_fee: 120 });
    // the address on the order is the one they typed
    expect(Number((await orderRow(order.id)).delivery_latitude)).toBeCloseTo(KALUTARA.latitude, 3);
    await sweepAll();
  });

  it('is cash on delivery only: online, wallet and points are refused with 422 and a plain message, and no order is made', async () => {
    const before = Number((await pool.query('SELECT count(*) FROM orders WHERE customer_id = $1', [reviewer.id])).rows[0].count);
    for (const extra of [{ payment_method: 'ONLINE' }, { use_wallet: true }, { use_points: true }]) {
      const res = await reviewer.placeOrder(lines(), extra);
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.body.error.code).toBe('TEST_ORDER_CASH_ONLY');
      expect(res.body.error.message).toBe('Only cash on delivery is available for this account.');
    }
    const after = Number((await pool.query('SELECT count(*) FROM orders WHERE customer_id = $1', [reviewer.id])).rows[0].count);
    expect(after).toBe(before);
    // an explicit COD order is fine
    expect((await reviewer.placeOrder(lines(), { payment_method: 'COD' })).status).toBe(201);
    await sweepAll();
  });

  it('ignores a coupon, a tip and a delivery slot (nothing is used up, nothing refuses)', async () => {
    const order = await expectCreated(
      await reviewer.placeOrder(lines(), { coupon_code: 'NOSUCH10', rider_tip_lkr: 100, delivery_slot_start: '2026-10-07T04:00:00.000Z' })
    );
    expect(await orderRow(order.id)).toMatchObject({ coupon_code: null, rider_tip: expect.anything(), scheduled_for: null });
    expect(Number((await orderRow(order.id)).rider_tip)).toBe(0);
    await sweepAll();
  });

  it('makes no noise: no staff push, no SMS, no rider, no rewards, no seller notice', async () => {
    const order = await expectCreated(await reviewer.placeOrder(lines()));
    expect((await notificationsFor(order.id)).filter((r) => r.notification_type === 'PUSH_NEW_ORDER')).toHaveLength(0);
    expect((await notificationsFor(order.id)).filter((r) => r.channel === 'SMS')).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM deliveries WHERE order_id = $1', [order.id])).rowCount).toBe(0);
    expect(await orderRow(order.id)).toMatchObject({ referral_discount_amount: '0.00', points_redeemed: 0, points_discount_amount: '0.00', free_delivery_reason: null });

    // not in the packing queue
    const queue = await request(app).get('/api/v1/admin/packing-queue').set(auth(tokens.admin));
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).not.toContain(order.id);

    // even if staff pack it, automatic rider assignment never takes it
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RIDER_AUTO_ASSIGN_KEY, JSON.stringify({ enabled: true, wait_seconds: 30, max_distance_km: 25 })]
    );
    expect((await fx.pack(order.id)).status).toBe(200);
    await pool.query("UPDATE order_status_history SET created_at = now() - interval '10 minutes' WHERE order_id = $1 AND new_status = 'PACKED'", [order.id]);
    const run = await runAutoAssign({ now: new Date(), orderIds: [order.id] });
    expect(run.considered).toBe(0);
    expect((await pool.query('SELECT 1 FROM deliveries WHERE order_id = $1', [order.id])).rowCount).toBe(0);

    // the cancel (of a packed one too) sends no SMS and no seller notice
    await sweepAll();
    expect((await orderRow(order.id)).order_status).toBe('CANCELLED');
    expect((await notificationsFor(order.id)).filter((r) => r.channel === 'SMS')).toHaveLength(0);
  });

  it('staff and customer reads expose is_test', async () => {
    const order = await expectCreated(await reviewer.placeOrder(lines()));
    const staff = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin));
    expect(staff.status).toBe(200);
    expect(JSON.stringify(staff.body)).toContain('"is_test":true');
    const list = await request(app).get('/api/v1/admin/orders?status=PLACED').set(auth(tokens.admin));
    expect(list.status).toBe(200);
    expect(list.body.data.orders.find((o: any) => o.id === order.id)).toMatchObject({ is_test: true });
    const mine = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(reviewer.token));
    expect(mine.body.data.order).toMatchObject({ is_test: true, order_status: 'PLACED' });
    await sweepAll();
    const after = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(reviewer.token));
    expect(after.status).toBe(200);
    expect(after.body.data.order).toMatchObject({ is_test: true, order_status: 'CANCELLED', can_cancel: false });
    expect((await request(app).get('/api/v1/orders').set(auth(reviewer.token))).status).toBe(200);
  });

  it('is an ordinary customer until migration 068 has been run', async () => {
    setTestOrdersReadyForTests(false);
    closeStore();
    const res = await reviewer.placeOrder(lines());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STORE_CLOSED');
    expect((await info(reviewer.token)).test_mode).toBeUndefined();
    expect((await saveAddress(reviewer.token, KALUTARA)).status).toBe(422);
    expect(await cancelDueTestOrders(new Date())).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the automatic cancel after 10 minutes', () => {
  it('waits for the 10 minutes, then cancels through the ordinary cancel and gives the stock back; a second run does nothing', async () => {
    expect(TEST_ORDER_AUTO_CANCEL_MINUTES).toBe(10);
    const tracked = await fx.product({ onHand: 2 });
    closeStore();
    const order = await expectCreated(await reviewer.placeOrder(lines(2, tracked.productId)));
    // the two units are held by the test order: an ordinary customer cannot have one
    openStore();
    const held = await normal.placeOrder(lines(1, tracked.productId));
    expect(held.status).toBe(409);
    expect(['OUT_OF_STOCK', 'INSUFFICIENT_STOCK']).toContain(held.body.error.code);

    const placedAt = (await orderRow(order.id)).placed_at as Date;
    // a fake clock: 9 minutes in, nothing happens; 10 minutes in, it is cancelled
    expect(await cancelDueTestOrders(inMinutes(placedAt, 9))).toBe(0);
    expect((await orderRow(order.id)).order_status).toBe('PLACED');
    expect(await cancelDueTestOrders(inMinutes(placedAt, TEST_ORDER_AUTO_CANCEL_MINUTES))).toBeGreaterThanOrEqual(1);

    const row = await orderRow(order.id);
    expect(row).toMatchObject({ order_status: 'CANCELLED', cancellation_reason: TEST_ORDER_CANCEL_REASON, cancelled_by_user_id: reviewer.id, is_test: true });
    expect(row.cancelled_at).toBeTruthy();
    const history = await histories(order.id);
    expect(history.map((h) => h.new_status)).toEqual(['PLACED', 'CANCELLED']);
    expect(history[1].reason_or_notes).toBe(TEST_ORDER_CANCEL_REASON);
    const audit = await audits(order.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ reason: TEST_ORDER_CANCEL_REASON });
    // the stock is free again (the order was reserved, never packed - same as any cancel)
    const again = await normal.placeOrder(lines(2, tracked.productId));
    expect(again.status).toBe(201);
    expect(await fx.onHand(tracked)).toBe(2);

    // idempotent: nothing more is written
    expect(await cancelDueTestOrders(new Date())).toBe(0);
    expect(await histories(order.id)).toHaveLength(2);
    expect(await audits(order.id)).toHaveLength(1);
    expect((await notificationsFor(order.id)).filter((r) => r.channel === 'SMS')).toHaveLength(0);
  });

  it('two sweeps at once cancel the order once', async () => {
    const order = await expectCreated(await reviewer.placeOrder(lines()));
    await backdate(order.id, 30);
    const results = await Promise.all([cancelDueTestOrders(new Date()), cancelDueTestOrders(new Date())]);
    expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    expect(await histories(order.id)).toHaveLength(2);
    expect(await audits(order.id)).toHaveLength(1);
  });

  it('an ordinary customer\'s cancel still sends its SMS (the control for the quiet test cancel)', async () => {
    const order = await expectCreated(await normal.placeOrder(lines()));
    const res = await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(auth(normal.token)).send({ reason: 'Changed my mind' });
    expect(res.status).toBe(200);
    expect((await notificationsFor(order.id)).filter((r) => r.channel === 'SMS' && r.notification_type === 'ORDER_CANCELLED').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('limits for the review customer', () => {
  it('at most 5 open test orders at once; cancelling them frees the room', async () => {
    await sweepAll();
    for (let i = 0; i < MAX_OPEN_TEST_ORDERS; i++) await expectCreated(await reviewer.placeOrder(lines()));
    const sixth = await reviewer.placeOrder(lines());
    expect(sixth.status).toBe(422);
    expect(sixth.body.error.code).toBe('TEST_ORDER_LIMIT');
    expect(sixth.body.error.message).toContain('5 open test orders');
    // an ordinary customer is not counted
    expect((await normal.placeOrder(lines())).status).toBe(201);
    expect(await sweepAll()).toBe(MAX_OPEN_TEST_ORDERS);
    expect((await reviewer.placeOrder(lines())).status).toBe(201);
    await sweepAll();
  });

  it('at most 30 test orders in a day', async () => {
    await sweepAll();
    const placedToday = Number((await pool.query('SELECT count(*) FROM orders WHERE customer_id = $1 AND is_test AND placed_at > now() - interval \'24 hours\'', [reviewer.id])).rows[0].count);
    // sweepAll moves placed_at back one hour: those still count. Place up to 30, a few at a time.
    for (let i = placedToday; i < MAX_TEST_ORDERS_PER_DAY; i++) {
      const res = await reviewer.placeOrder(lines());
      expect(res.status, `order ${i + 1}: ${JSON.stringify(res.body)}`).toBe(201);
      if ((i + 1) % MAX_OPEN_TEST_ORDERS === 0) await sweepAll();
    }
    await sweepAll();
    const thirtyFirst = await reviewer.placeOrder(lines());
    expect(thirtyFirst.status).toBe(422);
    expect(thirtyFirst.body.error.code).toBe('TEST_ORDER_LIMIT');
    expect(thirtyFirst.body.error.message).toContain('30 test orders a day');
    // a day later the cap is open again
    await pool.query("UPDATE orders SET placed_at = now() - interval '25 hours' WHERE is_test AND customer_id = $1", [reviewer.id]);
    expect((await reviewer.placeOrder(lines())).status).toBe(201);
    await sweepAll();
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------
describe('reports', () => {
  it('leave test orders out; cancelled orders are not sales', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
    const range = { from: today, to: today };
    const before = await salesReport(range);
    const order = await expectCreated(await reviewer.placeOrder(lines()));
    expect(order.is_test).toBe(true);
    const during = await salesReport(range);
    expect(during.order_count).toBe(before.order_count);
    expect(during.orders_by_hour).toEqual(before.orders_by_hour);
    await sweepAll();
    const after = await salesReport(range);
    expect(after.cancelled_count).toBe(before.cancelled_count);
    expect(after.delivered_revenue).toBe(before.delivered_revenue);
    // control: an ordinary order does count
    expect((await normal.placeOrder(lines())).status).toBe(201);
    expect((await salesReport(range)).order_count).toBe(before.order_count + 1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('Migration 068', () => {
  const dir = path.join(__dirname, '../src/database/migrations');
  const up = fs.readFileSync(path.join(dir, '068_test_orders.sql'), 'utf-8');
  const down = fs.readFileSync(path.join(dir, '068_test_orders_down.sql'), 'utf-8');

  it('is idempotent, defaults every order to not-a-test and indexes only test orders', async () => {
    await pool.query(up);
    await pool.query(up);
    const col = (await pool.query("SELECT column_default, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'is_test'")).rows[0];
    expect(col).toMatchObject({ is_nullable: 'NO', data_type: 'boolean' });
    expect(String(col.column_default)).toContain('false');
    const idx = (await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_orders_is_test'")).rows[0];
    expect(idx.indexdef).toMatch(/WHERE/);
  });

  it('has a rollback that runs (checked inside a transaction that is rolled back)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(down);
      expect((await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'is_test'")).rowCount).toBe(0);
      await client.query(down); // and is itself idempotent
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'is_test'")).rowCount).toBe(1);
  });
});

