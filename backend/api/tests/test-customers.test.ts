import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings } from '../src/modules/configuration/settings.service.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { haversineM } from '../src/modules/routing/index.js';
import { setPushSenderForTests, type PushSender } from '../src/modules/notifications/index.js';
import {
  cleanTesterPhones,
  invalidateTestCustomersCache,
  isTestCustomer,
  MAX_TEST_CUSTOMERS,
  normaliseTesterPhone,
  TEST_CUSTOMERS_KEY,
  testCustomersFrom,
} from '../src/modules/configuration/test-customers.js';
import { setTestOrdersReadyForTests, TEST_ORDER_CANCEL_REASON } from '../src/modules/orders/test-orders.js';
import { cancelDueTestOrders } from '../src/modules/orders/test-orders.job.js';
import { orderingClock } from '../src/utils/time.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Test customers = the Google Play closed-testing testers (2026-11-06; configuration/test-customers.ts). A number on the
 * staff-editable list gets the same treatment as the review number (orders/test-orders.ts): cash on delivery, any time,
 * any address, no alerts, cancelled after 10 minutes. All numbers here are made up (+94700000xxx / +94709770xxx).
 * The setting row, the fee settings and everything this file made are put back.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-TCU-');
const people = customerFixtures(app, { idPrefix: 'c0c00069', phoneBase: '+947097700', name: 'Tester Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const startedAt = new Date();
const DEVICE = `test-customers-device-${Date.now()}`;
const fake: PushSender = { send: async (ts) => ts.map((token) => ({ token, ok: true as const })) };
const CLOSED_NIGHT = new Date('2026-10-06T15:30:00.000Z'); // 9:00 PM in Colombo: the store is closed
const KALUTARA = { latitude: 6.5854, longitude: 79.9607 }; // about 18 km from the store

const KEYS = ['delivery_fee', TEST_CUSTOMERS_KEY];
type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
const pinnedCheckout = checkoutSettings.read;
const realFeeRoad = feeDistance.roadMetres;
const realNow = orderingClock.now;
const savedEnv = { phone: env.REVIEW_LOGIN_PHONE };
const setReviewPhone = (phone: string) => ((env as { REVIEW_LOGIN_PHONE: string }).REVIEW_LOGIN_PHONE = phone);

let tester: Awaited<ReturnType<typeof people.customer>>;
let tester2: Awaited<ReturnType<typeof people.customer>>;
let normal: Awaited<ReturnType<typeof people.customer>>;
let plainProduct = '';

const getList = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/test-customers').set(auth(token));
const putList = (phones: unknown, token = tokens.admin) =>
  request(app).put('/api/v1/admin/settings/test-customers').set(auth(token)).send(phones === undefined ? {} : { phones });
const closeStore = () => (orderingClock.now = () => CLOSED_NIGHT);
const openStore = () => (orderingClock.now = realNow);
const lines = (qty = 1) => [{ product_id: plainProduct, quantity: qty }];
const orderRow = async (id: string) => (await pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0] as Record<string, any>;
const info = async (token: string, qs = '') => (await request(app).get('/api/v1/orders/checkout-info' + qs).set(auth(token))).body.data;
const saveAddress = (token: string, body: object) =>
  request(app)
    .post('/api/v1/me/addresses')
    .set(auth(token))
    .send({ label: 'Abroad', recipient_name: 'Play Tester', recipient_phone: '077 123 4567', address_line1: '1 Test Street', city: 'Far Away', ...body });
async function sweepAll() {
  await pool.query(
    "UPDATE orders SET placed_at = now() - interval '1 hour' WHERE is_test AND customer_id = ANY($1) AND order_status IN ('PLACED', 'PACKED')",
    [[tester.id, tester2.id]]
  );
  return await cancelDueTestOrders(new Date());
}
const fakeNumbers = (n: number) => Array.from({ length: n }, (_, i) => `+94700001${String(i).padStart(3, '0')}`);

beforeAll(async () => {
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled: false, count: 10, since: startedAt.toISOString() },
    show_offer_savings: false,
  });
  await pool.query(fs.readFileSync(path.join(__dirname, '../src/database/migrations/068_test_orders.sql'), 'utf-8'));
  setTestOrdersReadyForTests(null);
  await people.purge(9);
  await fx.setup();
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  expect(
    (await request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin)).send({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status
  ).toBe(200);
  feeDistance.roadMetres = async (from, to) => Math.round(haversineM(from, to));
  feeDistanceCache.clear();
  plainProduct = (await fx.product({ tracked: false })).productId;
  tester = await people.customer(1, 'Play Tester');
  tester2 = await people.customer(2, 'Play Tester Two');
  normal = await people.customer(3, 'Normal Customer');
  setReviewPhone(''); // no review number: only the list can make a test customer
  invalidateTestCustomersCache();
  await pool.query(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android') ON CONFLICT (token) DO UPDATE SET user_id = $1`, [users.admin.id, DEVICE]);
  setPushSenderForTests(fake);
}, 60_000);

afterEach(async () => {
  openStore();
  setReviewPhone('');
  setTestOrdersReadyForTests(null);
  await pool.query('DELETE FROM system_configurations WHERE key = $1', [TEST_CUSTOMERS_KEY]);
  invalidateTestCustomersCache();
});

afterAll(async () => {
  setPushSenderForTests(undefined);
  await pool.query('DELETE FROM device_tokens WHERE token = $1', [DEVICE]);
  openStore();
  setReviewPhone(savedEnv.phone);
  setTestOrdersReadyForTests(null);
  checkoutSettings.read = pinnedCheckout;
  feeDistance.roadMetres = realFeeRoad;
  feeDistanceCache.clear();
  await pool.query("DELETE FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND created_at >= $1", [startedAt]);
  await pool.query("DELETE FROM audit_logs WHERE action IN ('TEST_ORDER_AUTO_CANCELLED', 'DELIVERY_FEE_UPDATED', 'TEST_CUSTOMERS_UPDATED') AND created_at >= $1", [startedAt]);
  await pool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1)', [[tester.id, tester2.id, normal.id]]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  invalidateTestCustomersCache();
  await people.cleanup();
  await fx.cleanup();
});

// ---------------------------------------------------------------------------------------------------
describe('reading a typed number', () => {
  it.each([
    ['712345678', '+94712345678'],
    ['0712345678', '+94712345678'],
    ['94712345678', '+94712345678'],
    ['+94712345678', '+94712345678'],
    [' 071 234-5678 ', '+94712345678'],
    ['+94 (71) 234 5678', '+94712345678'],
    ['071.234.5678', '+94712345678'],
  ])('%s is %s', (raw, expected) => {
    expect(normaliseTesterPhone(raw)).toBe(expected);
  });

  it.each(['', 'abc', '0112345678', '112345678', '07123456', '071234567890', '+9471234567', '+44712345678', '+94212345678', '0712345678x', '+94-7-1234', '1234567890123'])(
    '"%s" is not a Sri Lankan mobile number',
    (raw) => {
      expect(normaliseTesterPhone(raw)).toBeNull();
    }
  );

  it('cleanTesterPhones dedupes (in the order typed), ignores blanks, names every bad entry, and refuses past 50', () => {
    expect(cleanTesterPhones(['0700000001', '+94700000001', '700000002', '  ', '94700000001'])).toEqual(['+94700000001', '+94700000002']);
    let message = '';
    try {
      cleanTesterPhones(['0700000001', 'nope', '12345']);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('nope');
    expect(message).toContain('12345');
    expect(message).not.toContain('0700000001');
    expect(cleanTesterPhones(fakeNumbers(MAX_TEST_CUSTOMERS))).toHaveLength(50);
    expect(() => cleanTesterPhones(fakeNumbers(MAX_TEST_CUSTOMERS + 1))).toThrow(/at most 50/);
  });

  it('a missing or malformed stored row is an empty list, never an error', () => {
    for (const bad of [undefined, null, 'garbage', 5, [], {}, { phones: 'x' }, { phones: null }, '{"phones": 3}']) {
      expect(testCustomersFrom(bad)).toEqual([]);
    }
    expect(testCustomersFrom({ phones: ['+94700000001', 'bad', 7, '+94700000001'] })).toEqual(['+94700000001']);
    expect(testCustomersFrom('{"phones":["+94700000002"]}')).toEqual(['+94700000002']);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('GET / PUT /admin/settings/test-customers', () => {
  it('needs a signed-in Admin or Operations user', async () => {
    expect((await request(app).get('/api/v1/admin/settings/test-customers')).status).toBe(401);
    expect((await request(app).put('/api/v1/admin/settings/test-customers').send({ phones: [] })).status).toBe(401);
    for (const token of [tokens.customer, tokens.rider, tokens.staff]) {
      expect((await getList(token)).status).toBe(403);
      expect((await putList([], token)).status).toBe(403);
    }
    expect((await getList(tokens.admin)).status).toBe(200);
    expect((await getList(opsToken)).status).toBe(200);
    expect((await putList(['0700000001'], opsToken)).status).toBe(200);
  });

  it('reads as an empty list before anything is saved, and when the row is malformed', async () => {
    const empty = await getList();
    expect(empty.body.data).toMatchObject({ phones: [], count: 0, max: 50, updated_at: null });
    await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ($1, '"garbage"'::jsonb, 'x')`, [TEST_CUSTOMERS_KEY]);
    expect((await getList()).body.data).toMatchObject({ phones: [], count: 0 });
    invalidateTestCustomersCache();
    expect(await isTestCustomer(tester.phone)).toBe(false);
  });

  it('PUT replaces the whole list: normalised, de-duplicated, in the order typed', async () => {
    const first = await putList(['0700000001', ' +94 70 000 0002', '700000001', '94700000003']);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toMatchObject({ phones: ['+94700000001', '+94700000002', '+94700000003'], count: 3, max: 50 });
    expect(first.body.data.updated_at).toBeTruthy();
    const second = await putList(['0700000009']);
    expect(second.body.data.phones).toEqual(['+94700000009']);
    expect((await getList()).body.data.phones).toEqual(['+94700000009']);
    expect((await putList([])).body.data).toMatchObject({ phones: [], count: 0 });
  });

  it('refuses a number it cannot read with a plain message naming it, and saves nothing', async () => {
    await putList(['0700000001']);
    const res = await putList(['0700000002', 'hello', '0112345678']);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TEST_NUMBERS');
    expect(res.body.error.message).toContain('hello');
    expect(res.body.error.message).toContain('0112345678');
    expect((await getList()).body.data.phones).toEqual(['+94700000001']);
  });

  it('holds at most 50 numbers', async () => {
    const ok = await putList(fakeNumbers(50));
    expect(ok.status).toBe(200);
    expect(ok.body.data.count).toBe(50);
    const tooMany = await putList(fakeNumbers(51));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('TOO_MANY_TEST_NUMBERS');
    expect(tooMany.body.error.message).toMatch(/at most 50/);
    expect((await getList()).body.data.count).toBe(50);
  });

  it('is strict about the body', async () => {
    expect((await putList(undefined)).status).toBe(400);
    expect((await putList('0700000001')).status).toBe(400);
    expect((await putList([5])).status).toBe(400);
    const extra = await request(app).put('/api/v1/admin/settings/test-customers').set(auth(tokens.admin)).send({ phones: [], enabled: true });
    expect(extra.status).toBe(400);
  });

  it('audits TEST_CUSTOMERS_UPDATED with counts and the last 3 digits only - never a full number', async () => {
    await putList(['0700000001', '0700000002']);
    await putList(['0700000002', '0700000003', '0700000004']);
    const rows = (
      await pool.query("SELECT old_values, new_values, actor_user_id FROM audit_logs WHERE action = 'TEST_CUSTOMERS_UPDATED' AND created_at >= $1 ORDER BY created_at DESC, id DESC LIMIT 2", [startedAt])
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].actor_user_id).toBe(users.admin.id);
    expect(rows[0].old_values).toMatchObject({ count: 2, last_digits: ['001', '002'] });
    expect(rows[0].new_values).toMatchObject({ count: 3, last_digits: ['002', '003', '004'] });
    const text = JSON.stringify(rows);
    expect(text).not.toContain('70000000');
    expect(text).not.toContain('+94');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('isTestCustomer', () => {
  it('is the env review number OR a listed number, and never for an empty phone', async () => {
    expect(await isTestCustomer(tester.phone)).toBe(false);
    expect(await isTestCustomer(null)).toBe(false);
    expect(await isTestCustomer('')).toBe(false);
    await putList([tester.phone]);
    expect(await isTestCustomer(tester.phone)).toBe(true);
    expect(await isTestCustomer(normal.phone)).toBe(false);
    expect(await isTestCustomer(undefined)).toBe(false);
    await putList([]);
    expect(await isTestCustomer(tester.phone)).toBe(false);
    setReviewPhone(normal.phone);
    expect(await isTestCustomer(normal.phone)).toBe(true);
    expect(await isTestCustomer(tester.phone)).toBe(false);
  });

  it('a change written straight to the table is seen once the cache is cleared (and within 30 s anyway)', async () => {
    expect(await isTestCustomer(tester.phone)).toBe(false);
    await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'x')`, [TEST_CUSTOMERS_KEY, JSON.stringify({ phones: [tester.phone] })]);
    invalidateTestCustomersCache();
    expect(await isTestCustomer(tester.phone)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a listed customer\'s orders are test orders', () => {
  it('can order while the store is closed; an unlisted customer still gets STORE_CLOSED', async () => {
    await putList([tester.phone]);
    closeStore();
    const refused = await normal.placeOrder(lines());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('STORE_CLOSED');
    const order = await expectCreated(await tester.placeOrder(lines()));
    expect(order).toMatchObject({ is_test: true, order_status: 'PLACED', payment_method: 'COD' });
    expect(await orderRow(order.id)).toMatchObject({ is_test: true, scheduled_for: null });
    // no staff push, no customer SMS, no rider
    const n = await pool.query('SELECT channel, notification_type FROM notifications WHERE order_id = $1', [order.id]);
    expect(n.rows.filter((r) => r.notification_type === 'PUSH_NEW_ORDER' || r.channel === 'SMS')).toHaveLength(0);
    expect((await pool.query('SELECT 1 FROM deliveries WHERE order_id = $1', [order.id])).rowCount).toBe(0);
    await sweepAll();
  });

  it('is cash on delivery only (422 TEST_ORDER_CASH_ONLY)', async () => {
    await putList([tester.phone]);
    for (const extra of [{ payment_method: 'ONLINE' }, { use_wallet: true }, { use_points: true }]) {
      const res = await tester.placeOrder(lines(), extra);
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.body.error.code).toBe('TEST_ORDER_CASH_ONLY');
    }
  });

  it('can save an address and order to it outside the delivery area; an unlisted customer cannot', async () => {
    const refusedSave = await saveAddress(normal.token, KALUTARA);
    expect(refusedSave.status).toBe(422);
    expect(refusedSave.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    await putList([tester.phone]);
    const saved1 = await saveAddress(tester.token, KALUTARA);
    expect(saved1.status, JSON.stringify(saved1.body)).toBe(201);
    const far = saved1.body.data.address.id as string;
    closeStore();
    const order = await expectCreated(await request(app).post('/api/v1/orders').set(auth(tester.token)).send({ address_id: far, items: lines() }));
    expect(order).toMatchObject({ is_test: true, delivery_fee: 120 });
    await sweepAll();
  });

  it('the existing sweep cancels it after 10 minutes - also after the tester was taken off the list', async () => {
    await putList([tester.phone]);
    const order = await expectCreated(await tester.placeOrder(lines()));
    const placedAt = (await orderRow(order.id)).placed_at as Date;
    expect(await cancelDueTestOrders(new Date(placedAt.getTime() + 9 * 60_000))).toBe(0);
    await putList([]); // removed
    expect((await orderRow(order.id)).is_test).toBe(true);
    expect(await cancelDueTestOrders(new Date(placedAt.getTime() + 10 * 60_000))).toBeGreaterThanOrEqual(1);
    expect(await orderRow(order.id)).toMatchObject({ order_status: 'CANCELLED', cancellation_reason: TEST_ORDER_CANCEL_REASON, is_test: true });
  });

  it('removal takes effect at once: the next order is an ordinary one (STORE_CLOSED when closed)', async () => {
    await putList([tester.phone, tester2.phone]);
    closeStore();
    expect((await tester.placeOrder(lines())).status).toBe(201);
    await putList([tester2.phone]);
    const refused = await tester.placeOrder(lines());
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('STORE_CLOSED');
    expect((await info(tester.token)).test_mode).toBeUndefined();
    expect((await tester2.placeOrder(lines())).status).toBe(201);
    await sweepAll();
  });

  it('an ordinary customer\'s order is untouched while the list has other people on it', async () => {
    await putList([tester.phone]);
    const order = await expectCreated(await normal.placeOrder(lines()));
    expect(order.is_test).toBe(false);
    const pushes = await pool.query("SELECT recipient FROM notifications WHERE notification_type = 'PUSH_NEW_ORDER' AND order_id = $1", [order.id]);
    expect(pushes.rows.length).toBeGreaterThan(0);
    await pool.query("UPDATE orders SET placed_at = now() - interval '1 day' WHERE id = $1", [order.id]);
    await cancelDueTestOrders(new Date());
    expect((await orderRow(order.id)).order_status).toBe('PLACED');
  });

  it('the env review number still works with an empty list', async () => {
    setReviewPhone(tester.phone);
    expect((await getList()).body.data.count).toBe(0);
    closeStore();
    const order = await expectCreated(await tester.placeOrder(lines()));
    expect(order.is_test).toBe(true);
    await sweepAll();
  });

  it('checkout-info says test_mode only for a listed or review customer', async () => {
    expect((await info(tester.token)).test_mode).toBeUndefined();
    await putList([tester.phone]);
    expect((await info(tester.token)).test_mode).toBe(true);
    expect((await info(tester2.token)).test_mode).toBeUndefined();
    expect((await info(normal.token)).test_mode).toBeUndefined();
    await putList([]);
    expect((await info(tester.token)).test_mode).toBeUndefined();
    setReviewPhone(tester2.phone);
    expect((await info(tester2.token)).test_mode).toBe(true);
    expect((await info(tester.token)).test_mode).toBeUndefined();
  });

  it('is an ordinary customer until migration 068 has been run', async () => {
    await putList([tester.phone]);
    setTestOrdersReadyForTests(false);
    closeStore();
    const res = await tester.placeOrder(lines());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STORE_CLOSED');
    expect((await info(tester.token)).test_mode).toBeUndefined();
  });
});
