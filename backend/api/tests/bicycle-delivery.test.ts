import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { checkoutSettings } from '../src/modules/configuration/settings.service.js';
import {
  BICYCLE_DELIVERY_KEY,
  bicycleDeliveryFrom,
  DEFAULT_BICYCLE_DELIVERY,
  setBicycleDeliveryReadyForTests,
} from '../src/modules/configuration/bicycle-delivery.js';
import { RIDER_AUTO_ASSIGN_KEY } from '../src/modules/configuration/rider-auto-assign.js';
import { feeDistance, feeDistanceCache } from '../src/modules/orders/delivery-fee.js';
import { bicycleBasePay } from '../src/modules/riders/rider.pay-rules.js';
import { payDistance } from '../src/modules/riders/rider.pay-rules.js';
import { runAutoAssign } from '../src/modules/riders/rider.auto-assign.js';
import { NotificationTemplates } from '../src/modules/notifications/notification.templates.js';
import { setPushSenderForTests } from '../src/modules/notifications/index.js';
import { stockFixtures, tokens, auth, users, STORE, RIDER_A } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Bicycle delivery (2026-11-05; migration 067, setting 'bicycle_delivery'): a separate, cheaper delivery for short
 * routes. Admin and Operations set the longest trip, the customer fee and the rider pay; the customer picks Bicycle
 * or Motorbike at checkout when both are possible; a bicycle order only goes to a rider on a bicycle; staff can
 * switch an unpaid bicycle order to motorbike before pickup; a bicycle delivery pays the rider by the bicycle rule.
 * OSRM is mocked (feeDistance / payDistance); every row and setting this file touched is restored.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BIK-');
const people = customerFixtures(app, { idPrefix: 'c0c00067', phoneBase: '+947096700', name: 'Bicycle Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const startedAt = new Date();

const KEYS = [
  'delivery_fee',
  BICYCLE_DELIVERY_KEY,
  RIDER_AUTO_ASSIGN_KEY,
  'coupons_enabled',
  'new_customer_free_deliveries',
  'show_offer_savings',
  'basket_free_delivery',
  'order_for_someone_else',
  'small_order_fee',
  'rider_commission',
  'rider_pay_model',
  'rider_rain_boost',
  'rider_bonus_rules',
];
type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let otherBicycleRiders: string[] = [];
let productId = '';
let bike: { riderId: string; token: string; userId: string };
let bike2: { riderId: string; token: string; userId: string };
const realFeeRoad = feeDistance.roadMetres;
const realPayRoad = payDistance.roadMetres;
const pinnedCheckout = checkoutSettings.read;
const couponCodes: string[] = [];
let n = 0;

const bicycleSetting = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/bicycle-delivery').set(auth(token));
const putBicycle = (body: object, token = tokens.admin) => request(app).put('/api/v1/admin/settings/bicycle-delivery').set(auth(token)).send(body);
const patchFee = (body: object) => request(app).patch('/api/v1/admin/settings/delivery-fee').set(auth(tokens.admin)).send(body);
const roadIs = (km: number) => {
  feeDistance.roadMetres = async () => Math.round(km * 1000);
  payDistance.roadMetres = async () => Math.round(km * 1000);
  feeDistanceCache.clear();
};
const freeDeliveries = (enabled: boolean) => {
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled, count: 10, since: startedAt.toISOString() },
    show_offer_savings: false,
  });
};
const enable = (over: object = {}) => putBicycle({ enabled: true, ...over });
const disable = () => putBicycle({ enabled: false });
const info = async (token: string, qs = '') => (await request(app).get('/api/v1/orders/checkout-info' + qs).set(auth(token))).body.data;
const orderRow = async (id: string) =>
  (
    await pool.query(
      `SELECT delivery_method, delivery_fee::float AS fee, standard_delivery_fee::float AS standard, total_amount::float AS total,
              subtotal_amount::float AS subtotal, discount_amount::float AS discount, delivery_fee_mode, delivery_distance_km::float AS km,
              free_delivery_reason, payment_status, payment_method
         FROM orders WHERE id = $1`,
      [id]
    )
  ).rows[0];
const payAmount = async (id: string) => Number((await pool.query('SELECT amount FROM payments WHERE order_id = $1', [id])).rows[0].amount);
const switchTo = (id: string, body: object = { method: 'MOTORBIKE' }, token = opsToken) =>
  request(app).post(`/api/v1/orders/${id}/delivery-method`).set(auth(token)).send(body);
const assign = (orderId: string, riderId: string) => fx.assign(orderId, riderId);
const deliveryStatuses = async (orderId: string) =>
  (await pool.query('SELECT assignment_status, failure_reason FROM deliveries WHERE order_id = $1 ORDER BY created_at', [orderId])).rows;

/** A new customer (fresh history), with an order of one item placed by `method` (default: the app's own default). */
async function place(method?: 'BICYCLE' | 'MOTORBIKE' | null, extra: object = {}) {
  n += 1;
  const me = await people.customer(n);
  const res = await me.placeOrder([{ product_id: productId, quantity: 1 }], method ? { delivery_method: method, ...extra } : extra);
  return { me, res };
}
async function placed(method: 'BICYCLE' | 'MOTORBIKE' | null = 'BICYCLE', extra: object = {}) {
  const { me, res } = await place(method, extra);
  return { me, order: await expectCreated(res) };
}
async function packed(method: 'BICYCLE' | 'MOTORBIKE' = 'BICYCLE', extra: object = {}) {
  const p = await placed(method, extra);
  expect((await fx.pack(p.order.id)).status).toBe(200);
  return p;
}

async function bicycleRider(tag: string) {
  const r = await fx.tempRider(tag);
  await pool.query("UPDATE riders SET vehicle_type = 'BICYCLE' WHERE id = $1", [r.riderId]);
  const userId = (await pool.query('SELECT user_id FROM riders WHERE id = $1', [r.riderId])).rows[0].user_id as string;
  return { ...r, userId };
}

beforeAll(async () => {
  checkoutSettings.read = async () => ({
    coupons_enabled: true,
    new_customer_free_deliveries: { enabled: false, count: 10, since: startedAt.toISOString() },
    show_offer_savings: false,
  });
  await people.purge(99);
  await fx.setup();
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  // Bicycle riders that already exist in this database must not decide the "no bicycle rider" cases.
  otherBicycleRiders = (await pool.query("SELECT id FROM riders WHERE vehicle_type = 'BICYCLE' AND is_active = true")).rows.map((r) => r.id as string);
  if (otherBicycleRiders.length) await pool.query('UPDATE riders SET is_active = false WHERE id = ANY($1)', [otherBicycleRiders]);
  productId = (await fx.product({ tracked: false })).productId;
  bike = await bicycleRider('bike-1');
  bike2 = await bicycleRider('bike-2');
  expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status).toBe(200);
  roadIs(2.5);
}, 60_000);

afterEach(() => {
  roadIs(2.5);
  freeDeliveries(false);
  setBicycleDeliveryReadyForTests(null);
});

afterAll(async () => {
  checkoutSettings.read = pinnedCheckout;
  feeDistance.roadMetres = realFeeRoad;
  payDistance.roadMetres = realPayRoad;
  feeDistanceCache.clear();
  setBicycleDeliveryReadyForTests(null);
  await people.cleanup();
  const codes = couponCodes.length ? (await pool.query('SELECT id FROM coupons WHERE code = ANY($1)', [couponCodes])).rows.map((r) => r.id as string) : [];
  if (codes.length) {
    await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id = ANY($1)', [codes]);
    await pool.query('DELETE FROM coupons WHERE id = ANY($1)', [codes]);
  }
  await fx.cleanup();
  if (otherBicycleRiders.length) await pool.query('UPDATE riders SET is_active = true WHERE id = ANY($1)', [otherBicycleRiders]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
  await pool.query(
    "DELETE FROM audit_logs WHERE action IN ('BICYCLE_DELIVERY_UPDATED', 'DELIVERY_FEE_UPDATED', 'ORDER_DELIVERY_METHOD_SWITCHED', 'AUTO_ASSIGNED', 'AUTO_ASSIGN_NO_RIDER') AND created_at >= $1",
    [startedAt]
  );
});

// ---------------------------------------------------------------------------------------------------
describe('Migration 067', () => {
  const dir = path.join(__dirname, '../src/database/migrations');
  const up = fs.readFileSync(path.join(dir, '067_bicycle_delivery.sql'), 'utf-8');
  const down = fs.readFileSync(path.join(dir, '067_bicycle_delivery_down.sql'), 'utf-8');

  it('is idempotent, defaults every order to MOTORBIKE and only allows the two methods', async () => {
    await pool.query(up);
    await pool.query(up);
    const col = (await pool.query("SELECT column_default, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivery_method'")).rows[0];
    expect(col.is_nullable).toBe('NO');
    expect(col.data_type).toBe('text');
    expect(String(col.column_default)).toContain('MOTORBIKE');
    const { order } = await placed('MOTORBIKE');
    expect((await orderRow(order.id)).delivery_method).toBe('MOTORBIKE');
    await expect(pool.query("UPDATE orders SET delivery_method = 'TRIKE' WHERE id = $1", [order.id])).rejects.toThrow(/chk_orders_delivery_method/);
  });

  it('has a rollback that runs (checked inside a transaction that is rolled back)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(down);
      const gone = await client.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivery_method'");
      expect(gone.rowCount).toBe(0);
      await client.query(down); // and is itself idempotent
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const back = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivery_method'");
    expect(back.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('The bicycle_delivery setting', () => {
  it('reads defaults before anything is saved: switched off, never throws', async () => {
    const res = await bicycleSetting(opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({
      enabled: false,
      max_km: 3,
      fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },
      rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null },
      updated_at: null,
      ready: true,
    });
  });

  it('reads a malformed stored row as the defaults (pure and through the endpoint)', async () => {
    expect(bicycleDeliveryFrom(undefined)).toEqual(DEFAULT_BICYCLE_DELIVERY);
    expect(bicycleDeliveryFrom('nonsense')).toEqual(DEFAULT_BICYCLE_DELIVERY);
    expect(bicycleDeliveryFrom({ enabled: 'yes', max_km: 99, fee: 5, rider_pay: { mode: 'X', fixed_lkr: -1 } })).toEqual(DEFAULT_BICYCLE_DELIVERY);
    expect(bicycleDeliveryFrom({ enabled: true, max_km: 2.5, fee: { base_lkr: 60, max_fee_lkr: 200 }, rider_pay: { mode: 'PER_KM', min_lkr: 40 } })).toMatchObject({
      enabled: true,
      max_km: 2.5,
      fee: { base_lkr: 60, base_km: 2, per_km_lkr: 30, max_fee_lkr: 200 },
      rider_pay: { mode: 'PER_KM', fixed_lkr: 50, min_lkr: 40 },
    });
    await pool.query("INSERT INTO system_configurations (key, value, description) VALUES ($1, $2, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [
      BICYCLE_DELIVERY_KEY,
      JSON.stringify({ enabled: 'yes', max_km: 99, fee: 5 }),
    ]);
    const res = await bicycleSetting();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, max_km: 3, fee: DEFAULT_BICYCLE_DELIVERY.fee });
    await pool.query('DELETE FROM system_configurations WHERE key = $1', [BICYCLE_DELIVERY_KEY]);
  });

  it('PUT saves any of the four, merges, answers the whole setting and audits old and new', async () => {
    const res = await putBicycle({ max_km: 2.5, fee: { base_lkr: 70, base_km: 1.5, per_km_lkr: 25, max_fee_lkr: 150 } }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      enabled: false,
      max_km: 2.5,
      fee: { base_lkr: 70, base_km: 1.5, per_km_lkr: 25, max_fee_lkr: 150 },
      rider_pay: { mode: 'FIXED', fixed_lkr: 50 },
      ready: true,
    });
    expect(res.body.data.updated_at).not.toBeNull();

    const on = await putBicycle({ enabled: true, rider_pay: { mode: 'PER_KM', fixed_lkr: 50, base_lkr: 20, per_km_lkr: 10, min_lkr: 35 } });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ enabled: true, max_km: 2.5, rider_pay: { mode: 'PER_KM', base_lkr: 20, per_km_lkr: 10, min_lkr: 35 } });

    const audit = (await pool.query("SELECT old_values, new_values, actor_user_id FROM audit_logs WHERE action = 'BICYCLE_DELIVERY_UPDATED' ORDER BY created_at DESC, id DESC LIMIT 1")).rows[0];
    expect(audit.actor_user_id).toBe(users.admin.id);
    expect(audit.old_values).toMatchObject({ key: BICYCLE_DELIVERY_KEY, enabled: false, max_km: 2.5 });
    expect(audit.new_values).toMatchObject({ key: BICYCLE_DELIVERY_KEY, enabled: true, max_km: 2.5, rider_pay: { mode: 'PER_KM' } });
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'BICYCLE_DELIVERY_UPDATED' AND created_at >= $1", [startedAt])).rows[0].n).toBeGreaterThanOrEqual(2);

    // back to the placeholders, off
    const back = await putBicycle({ enabled: false, max_km: 3, fee: DEFAULT_BICYCLE_DELIVERY.fee, rider_pay: DEFAULT_BICYCLE_DELIVERY.rider_pay });
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ enabled: false, max_km: 3, fee: DEFAULT_BICYCLE_DELIVERY.fee, rider_pay: DEFAULT_BICYCLE_DELIVERY.rider_pay });
  });

  it('validates every number, rejects unknown keys and half-sections, and a bad enable changes nothing', async () => {
    const bad: object[] = [
      {},
      { max_km: 0.4 },
      { max_km: 10.5 },
      { max_km: 2.25 },
      { max_km: '3' },
      { enabled: 'yes' },
      { fee: { base_lkr: -1, base_km: 2, per_km_lkr: 30, max_fee_lkr: null } },
      { fee: { base_lkr: 1000.5, base_km: 2, per_km_lkr: 30, max_fee_lkr: null } },
      { fee: { base_lkr: 80, base_km: 0.2, per_km_lkr: 30, max_fee_lkr: null } },
      { fee: { base_lkr: 80, base_km: 2, per_km_lkr: 1001, max_fee_lkr: null } },
      { fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: 1200 } },
      { fee: { base_lkr: 80 } },
      { fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null, extra: 1 } },
      { rider_pay: { mode: 'PERCENT', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } },
      { rider_pay: { mode: 'FIXED', fixed_lkr: 50.123, base_lkr: 30, per_km_lkr: 15, min_lkr: null } },
      { rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15 } },
      { surprise: true },
      { enabled: true, fee: { base_lkr: -5, base_km: 2, per_km_lkr: 30, max_fee_lkr: null } },
    ];
    for (const body of bad) expect((await putBicycle(body)).status, JSON.stringify(body)).toBe(400);
    const after = (await bicycleSetting()).body.data;
    expect(after).toMatchObject({ enabled: false, max_km: 3, fee: DEFAULT_BICYCLE_DELIVERY.fee });
  });

  it('is for Admin and Operations only, on both verbs', async () => {
    expect((await bicycleSetting(opsToken)).status).toBe(200);
    expect((await bicycleSetting(tokens.staff)).status).toBe(403);
    expect((await bicycleSetting(tokens.customer)).status).toBe(403);
    expect((await bicycleSetting(tokens.rider)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/bicycle-delivery')).status).toBe(401);
    expect((await putBicycle({ enabled: false }, opsToken)).status).toBe(200);
    expect((await putBicycle({ enabled: true }, tokens.staff)).status).toBe(403);
    expect((await putBicycle({ enabled: true }, tokens.customer)).status).toBe(403);
    expect((await putBicycle({ enabled: true }, tokens.rider)).status).toBe(403);
    expect((await bicycleSetting()).body.data.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('GET /orders/checkout-info bicycle block', () => {
  it('is unavailable while switched off (the motorbike fields are exactly as before)', async () => {
    expect((await disable()).status).toBe(200);
    const me = await people.customer((n += 1));
    const body = await info(me.token);
    expect(body.bicycle).toMatchObject({ available: false, reason: 'Bicycle delivery is not available right now.', fee_lkr: 80 + 30, max_km: 3, distance_km: 2.5 });
    expect(body).toMatchObject({ delivery_fee_lkr: 160, standard_delivery_fee_lkr: 160, delivery_fee_mode: 'DISTANCE_TIERS', delivery_distance_km: 2.5 });
  });

  it('is available when on, within max_km and a bicycle rider exists: fee by the bicycle rule', async () => {
    expect((await enable()).status).toBe(200);
    const me = await people.customer((n += 1));
    for (const [km, fee] of [
      [1.0, 80],
      [2.0, 80],
      [2.5, 110],
      [3.0, 110],
    ] as const) {
      roadIs(km);
      const body = await info(me.token);
      expect(body.bicycle, `${km} km`).toEqual({
        available: true,
        fee_lkr: fee,
        charged_fee_lkr: fee,
        max_km: 3,
        distance_km: km,
        distance_estimated: false,
      });
    }
    // The motorbike fee still follows its own rule.
    expect((await info(me.token)).delivery_fee_lkr).toBe(160);
  });

  it('is unavailable beyond max_km, with a plain reason', async () => {
    expect((await enable()).status).toBe(200);
    const me = await people.customer((n += 1));
    roadIs(3.5);
    const body = await info(me.token);
    expect(body.bicycle).toMatchObject({ available: false, reason: 'Bicycle delivery is for trips up to 3 km.', max_km: 3, distance_km: 3.5 });
    expect(body.delivery_fee_lkr).toBe(200);
  });

  it('is unavailable with no approved, active bicycle rider, and as soon as one exists again', async () => {
    expect((await enable()).status).toBe(200);
    const me = await people.customer((n += 1));
    await pool.query('UPDATE riders SET is_active = false WHERE id = ANY($1)', [[bike.riderId, bike2.riderId]]);
    try {
      expect((await info(me.token)).bicycle).toMatchObject({ available: false, reason: 'No bicycle rider is available right now.' });
      // pending / rejected / disabled-account bicycle riders do not count either
      await pool.query("UPDATE riders SET is_active = true, approval_status = 'PENDING' WHERE id = $1", [bike.riderId]);
      expect((await info(me.token)).bicycle.available).toBe(false);
      await pool.query("UPDATE riders SET approval_status = 'APPROVED' WHERE id = $1", [bike.riderId]);
      await pool.query('UPDATE users SET staff_disabled_at = now() WHERE id = $1', [bike.userId]);
      expect((await info(me.token)).bicycle.available).toBe(false);
      await pool.query('UPDATE users SET staff_disabled_at = NULL WHERE id = $1', [bike.userId]);
      expect((await info(me.token)).bicycle.available).toBe(true);
    } finally {
      await pool.query("UPDATE riders SET is_active = true, approval_status = 'APPROVED' WHERE id = ANY($1)", [[bike.riderId, bike2.riderId]]);
      await pool.query('UPDATE users SET staff_disabled_at = NULL WHERE id = $1', [bike.userId]);
    }
    // a motorbike rider is not a bicycle rider
    await pool.query("UPDATE riders SET vehicle_type = 'MOTORCYCLE' WHERE id = ANY($1)", [[bike.riderId, bike2.riderId]]);
    try {
      expect((await info(me.token)).bicycle.available).toBe(false);
    } finally {
      await pool.query("UPDATE riders SET vehicle_type = 'BICYCLE' WHERE id = ANY($1)", [[bike.riderId, bike2.riderId]]);
    }
  });

  it('is unavailable without a known address', async () => {
    expect((await enable()).status).toBe(200);
    const me = await people.customer((n += 1));
    await pool.query('UPDATE customer_addresses SET is_deleted = true WHERE user_id = $1', [me.id]);
    const body = await info(me.token);
    expect(body.bicycle).toMatchObject({ available: false, reason: 'Choose a delivery address to see bicycle delivery.', fee_lkr: 80, distance_km: null });
  });

  it('measures the distance itself when the motorbike fee is flat, and leaves the flat fields alone', async () => {
    expect((await enable()).status).toBe(200);
    expect((await patchFee({ fee_mode: 'FLAT', fee_lkr: 100 })).status).toBe(200);
    try {
      const me = await people.customer((n += 1));
      const body = await info(me.token);
      expect(body).toMatchObject({ delivery_fee_lkr: 100, delivery_fee_mode: 'FLAT', delivery_distance_km: null });
      expect(body.bicycle).toMatchObject({ available: true, fee_lkr: 110, distance_km: 2.5 });
    } finally {
      expect((await patchFee({ fee_mode: 'BASE_PER_KM', base_lkr: 120, base_km: 2, per_km_lkr: 40, max_fee_lkr: null })).status).toBe(200);
    }
  });

  it('applies the free-delivery rules to the bicycle fee like the motorbike fee, and honours the cap', async () => {
    expect((await enable({ fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: 90 } })).status).toBe(200);
    freeDeliveries(true);
    const me = await people.customer((n += 1));
    const body = await info(me.token);
    expect(body).toMatchObject({ delivery_fee_lkr: 0, standard_delivery_fee_lkr: 160 });
    expect(body.bicycle).toMatchObject({ available: true, fee_lkr: 90, charged_fee_lkr: 0 });
    expect((await putBicycle({ fee: DEFAULT_BICYCLE_DELIVERY.fee })).status).toBe(200);
  });

  it('treats the bicycle as unavailable until migration 067 has been run', async () => {
    expect((await enable()).status).toBe(200);
    setBicycleDeliveryReadyForTests(false);
    const me = await people.customer((n += 1));
    expect((await info(me.token)).bicycle).toMatchObject({ available: false });
    expect((await bicycleSetting()).body.data.ready).toBe(false);
    const res = await me.placeOrder([{ product_id: productId, quantity: 1 }], { delivery_method: 'BICYCLE' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BICYCLE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('Order placement with delivery_method', () => {
  it('defaults to MOTORBIKE: the motorbike fee, nothing new in the way an order is charged', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await placed(null); // no delivery_method sent at all
    expect(order.delivery_method).toBe('MOTORBIKE');
    expect(order.delivery_fee).toBe(160);
    expect(await orderRow(order.id)).toMatchObject({ delivery_method: 'MOTORBIKE', fee: 160, standard: 160, total: order.subtotal_amount + 160 });
    const explicit = await placed('MOTORBIKE');
    expect(explicit.order).toMatchObject({ delivery_method: 'MOTORBIKE', delivery_fee: 160 });
  });

  it('BICYCLE charges the bicycle fee and snapshots it as the standard fee', async () => {
    expect((await enable()).status).toBe(200);
    roadIs(2.5);
    const { order } = await placed('BICYCLE');
    expect(order).toMatchObject({ delivery_method: 'BICYCLE', delivery_fee: 110 });
    expect(order.total_amount).toBe(order.subtotal_amount + 110);
    const row = await orderRow(order.id);
    expect(row).toMatchObject({ delivery_method: 'BICYCLE', fee: 110, standard: 110, delivery_fee_mode: 'DISTANCE_TIERS', km: 2.5, free_delivery_reason: null });
    expect(await payAmount(order.id)).toBe(order.total_amount);
  });

  it('is re-checked at placement: switched off, too far, no bicycle rider, bad value - each a 400 in plain words', async () => {
    const attempt = async (method: unknown = 'BICYCLE') => {
      n += 1;
      const me = await people.customer(n);
      return me.placeOrder([{ product_id: productId, quantity: 1 }], { delivery_method: method });
    };
    expect((await disable()).status).toBe(200);
    let res = await attempt();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'BICYCLE_UNAVAILABLE', message: 'Bicycle delivery is not available right now. Please choose motorbike delivery.' });

    expect((await enable()).status).toBe(200);
    roadIs(3.4);
    res = await attempt();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'BICYCLE_UNAVAILABLE', message: 'Bicycle delivery is for trips up to 3 km. Please choose motorbike delivery.' });
    roadIs(2.5);

    await pool.query('UPDATE riders SET is_active = false WHERE id = ANY($1)', [[bike.riderId, bike2.riderId]]);
    try {
      res = await attempt();
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'BICYCLE_UNAVAILABLE', message: 'No bicycle rider is available right now. Please choose motorbike delivery.' });
    } finally {
      await pool.query('UPDATE riders SET is_active = true WHERE id = ANY($1)', [[bike.riderId, bike2.riderId]]);
    }

    res = await attempt('TRIKE');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('delivery_method must be MOTORBIKE or BICYCLE');
  });

  it('free delivery (new customer) waives the bicycle fee but keeps it as the standard fee', async () => {
    expect((await enable()).status).toBe(200);
    freeDeliveries(true);
    const { order } = await placed('BICYCLE');
    expect(order).toMatchObject({ delivery_method: 'BICYCLE', delivery_fee: 0 });
    expect(await orderRow(order.id)).toMatchObject({ fee: 0, standard: 110, free_delivery_reason: 'NEW_CUSTOMER', total: order.subtotal_amount });
  });

  it('a FREE_DELIVERY coupon takes the bicycle fee off, exactly as it does the motorbike fee', async () => {
    expect((await enable()).status).toBe(200);
    const code = `TSTBIKE${Date.now() % 100000}`;
    couponCodes.push(code);
    const made = await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code, discount_type: 'FREE_DELIVERY' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const { order } = await placed('BICYCLE', { coupon_code: code });
    expect(await orderRow(order.id)).toMatchObject({ delivery_method: 'BICYCLE', fee: 110, standard: 110, discount: 110, total: order.subtotal_amount });
  });

  it('the coupon preview shows the bicycle fee for delivery_method BICYCLE (and refuses it when unavailable)', async () => {
    expect((await enable()).status).toBe(200);
    const code = `TSTBKP${Date.now() % 100000}`;
    couponCodes.push(code);
    expect((await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code, discount_type: 'FIXED', discount_value: 10 })).status).toBe(201);
    const me = await people.customer((n += 1));
    const preview = (delivery_method?: string) =>
      request(app).post('/api/v1/orders/validate-coupon').set(auth(me.token)).send({ code, subtotal: 500, ...(delivery_method ? { delivery_method } : {}) });
    expect((await preview()).body.data.coupon).toMatchObject({ delivery_fee: 160, total: 500 + 160 - 10 });
    expect((await preview('BICYCLE')).body.data.coupon).toMatchObject({ delivery_fee: 110, total: 500 + 110 - 10 });
    roadIs(4);
    const far = await preview('BICYCLE');
    expect(far.status).toBe(400);
    expect(far.body.error.code).toBe('BICYCLE_UNAVAILABLE');
  });

  it('delivery_method is on every read model: customer detail and list, staff list and detail, rider job', async () => {
    expect((await enable()).status).toBe(200);
    const bikeOrder = await packed('BICYCLE');
    const moto = await packed('MOTORBIKE');

    const detail = await request(app).get(`/api/v1/orders/${bikeOrder.order.id}`).set(auth(bikeOrder.me.token));
    expect(detail.body.data.order.delivery_method).toBe('BICYCLE');
    expect((await request(app).get(`/api/v1/orders/${moto.order.id}`).set(auth(moto.me.token))).body.data.order.delivery_method).toBe('MOTORBIKE');
    const list = await request(app).get('/api/v1/orders').set(auth(bikeOrder.me.token));
    expect(list.body.data.orders.map((o: any) => o.delivery_method)).toEqual(['BICYCLE']);

    const staffDetail = await request(app).get(`/api/v1/admin/orders/${bikeOrder.order.id}`).set(auth(opsToken));
    expect(staffDetail.body.data.order.delivery_method).toBe('BICYCLE');
    const staffList = await request(app).get('/api/v1/admin/orders?status=PACKED&limit=100').set(auth(opsToken));
    const byId = new Map(staffList.body.data.orders.map((o: any) => [o.id, o.delivery_method]));
    expect(byId.get(bikeOrder.order.id)).toBe('BICYCLE');
    expect(byId.get(moto.order.id)).toBe('MOTORBIKE');
    const queue = await request(app).get('/api/v1/admin/packing-queue').set(auth(tokens.staff));
    expect(queue.status).toBe(200);

    const assigned = await assign(bikeOrder.order.id, bike.riderId);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const jobs = await request(app).get('/api/v1/riders/deliveries').set(auth(bike.token));
    expect(jobs.body.data.deliveries.find((d: any) => d.order_id === bikeOrder.order.id).delivery_method).toBe('BICYCLE');
    const job = await request(app).get(`/api/v1/riders/deliveries/${assigned.body.data.delivery.id}`).set(auth(bike.token));
    expect(job.body.data.delivery.delivery_method).toBe('BICYCLE');

    // the live rider map lists a waiting order with its method
    const live = await request(app).get('/api/v1/admin/riders/live').set(auth(opsToken));
    const waiting = live.body.data.unassigned_orders.find((o: any) => o.order_id === moto.order.id);
    expect(waiting.delivery_method).toBe('MOTORBIKE');
  });

  it('puts "Bicycle delivery" in the staff new-order push and the rider assigned push text only for a bicycle order', async () => {
    expect((await enable()).status).toBe(200);
    const tokens2 = [`bicycle-test-staff-${Date.now()}`, `bicycle-test-rider-${Date.now()}`];
    setPushSenderForTests({ send: async (ts) => ts.map((token) => ({ token, ok: true as const })) });
    await pool.query("INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android')", [users.admin.id, tokens2[0]]);
    await pool.query("INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, 'android')", [bike.userId, tokens2[1]]);
    try {
      const bikeOrder = await packed('BICYCLE');
      const moto = await packed('MOTORBIKE');
      const body = async (orderId: string, type: string, userId: string) =>
        ((await pool.query('SELECT payload FROM notifications WHERE order_id = $1 AND channel = $2 AND notification_type = $3 AND user_id = $4', [orderId, 'PUSH', type, userId])).rows[0]?.payload?.body ?? '') as string;
      expect(await body(bikeOrder.order.id, 'PUSH_NEW_ORDER', users.admin.id)).toContain(' Bicycle delivery. Open Blynk Ops to pack it.');
      const motoText = await body(moto.order.id, 'PUSH_NEW_ORDER', users.admin.id);
      expect(motoText).toContain('Open Blynk Ops to pack it.');
      expect(motoText).not.toContain('Bicycle');
      expect((await assign(bikeOrder.order.id, bike.riderId)).status).toBe(200);
      expect((await assign(moto.order.id, bike.riderId)).status).toBe(200);
      expect(await body(bikeOrder.order.id, 'PUSH_RIDER_ASSIGNED', bike.userId)).toBe(`Order ${bikeOrder.order.order_number} is yours. Bicycle delivery. Open Blynk Rider to pick it up.`);
      expect(await body(moto.order.id, 'PUSH_RIDER_ASSIGNED', bike.userId)).toBe(`Order ${moto.order.order_number} is yours. Open Blynk Rider to pick it up.`);
    } finally {
      setPushSenderForTests(undefined);
      await pool.query('DELETE FROM device_tokens WHERE token = ANY($1)', [tokens2]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('Assignment: a bicycle order only goes to a bicycle rider', () => {
  it('refuses a motorbike rider with a plain message, accepts a bicycle rider', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await packed('BICYCLE');
    const refused = await assign(order.id, RIDER_A);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({
      code: 'RIDER_NOT_BICYCLE',
      message: 'This is a bicycle delivery, so it can only be given to a rider who delivers by bicycle.',
    });
    expect(await deliveryStatuses(order.id)).toEqual([]);
    const ok = await assign(order.id, bike.riderId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.delivery.rider_id).toBe(bike.riderId);
  });

  it('a motorbike order still goes to any rider, bicycle riders included', async () => {
    const a = await packed('MOTORBIKE');
    expect((await assign(a.order.id, RIDER_A)).status).toBe(200);
    const b = await packed('MOTORBIKE');
    expect((await assign(b.order.id, bike2.riderId)).status).toBe(200);
  });

  it('the picker and the suggestions list only bicycle riders for a bicycle order', async () => {
    expect((await enable()).status).toBe(200);
    const bikeOrder = await packed('BICYCLE');
    const moto = await packed('MOTORBIKE');

    const forBike = (await request(app).get(`/api/v1/admin/riders?order_id=${bikeOrder.order.id}`).set(auth(opsToken))).body.data.riders;
    expect(forBike.length).toBeGreaterThanOrEqual(2);
    expect(forBike.every((r: any) => r.vehicle_type === 'BICYCLE')).toBe(true);
    expect(forBike.map((r: any) => r.id)).toEqual(expect.arrayContaining([bike.riderId, bike2.riderId]));
    const forMoto = (await request(app).get(`/api/v1/admin/riders?order_id=${moto.order.id}`).set(auth(opsToken))).body.data.riders;
    expect(forMoto.some((r: any) => r.vehicle_type !== 'BICYCLE')).toBe(true);
    const all = (await request(app).get('/api/v1/admin/riders').set(auth(opsToken))).body.data.riders;
    expect(all.some((r: any) => r.vehicle_type !== 'BICYCLE')).toBe(true);
    expect((await request(app).get(`/api/v1/admin/riders?order_id=${'00000000-0000-4000-8000-000000000000'}`).set(auth(opsToken))).status).toBe(404);

    const sugg = (await request(app).get(`/api/v1/admin/riders/suggestions?order_id=${bikeOrder.order.id}`).set(auth(opsToken))).body.data;
    expect(sugg.delivery_method).toBe('BICYCLE');
    expect(sugg.riders.length).toBeGreaterThanOrEqual(2);
    expect(sugg.riders.every((r: any) => r.vehicle_type === 'BICYCLE')).toBe(true);
    const suggMoto = (await request(app).get(`/api/v1/admin/riders/suggestions?order_id=${moto.order.id}`).set(auth(opsToken))).body.data;
    expect(suggMoto.delivery_method).toBe('MOTORBIKE');
    expect(suggMoto.riders.some((r: any) => r.vehicle_type !== 'BICYCLE')).toBe(true);
  });

  it('automatic assignment skips motorbike riders for a bicycle order, even when one is nearer', async () => {
    const NOW = new Date('2026-10-06T06:30:00.000Z');
    expect((await enable()).status).toBe(200);
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ($1, $2::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [RIDER_AUTO_ASSIGN_KEY, JSON.stringify({ enabled: true, wait_seconds: 30, max_distance_km: 25 })]
    );
    const anchor = await placed('MOTORBIKE');
    const hub = (await pool.query('SELECT latitude::float AS lat, longitude::float AS lng FROM dark_stores WHERE id = $1', [STORE])).rows[0];
    const point = async (riderId: string, dLat: number) =>
      pool.query(
        `INSERT INTO deliveries (order_id, rider_id, assignment_status, cod_collected_amount, assigned_at, failed_at, failure_reason,
           current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at)
         VALUES ($1, $2, 'FAILED', 0, $3, $3, 'test fixture', $4, $5, 10, $3, $3)`,
        [anchor.order.id, riderId, new Date(NOW.getTime() - 2 * 60_000), hub.lat + dLat, hub.lng]
      );
    // the motorbike rider is right at the store, the bicycle rider a little away
    await point(RIDER_A, 0.0001);
    await point(bike.riderId, 0.003);
    const { order } = await packed('BICYCLE');
    await pool.query("UPDATE order_status_history SET created_at = $2 WHERE order_id = $1 AND new_status = 'PACKED'", [order.id, new Date(NOW.getTime() - 200_000)]);
    const result = await runAutoAssign({ now: NOW, orderIds: [order.id] });
    expect(result.assigned.map((a) => a.rider_id)).toEqual([bike.riderId]);
    expect((await deliveryStatuses(order.id))[0].assignment_status).toBe('ASSIGNED');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('POST /orders/:id/delivery-method (switch to motorbike)', () => {
  it('is for Admin and Operations only and validates its body', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await placed('BICYCLE');
    for (const t of [tokens.staff, tokens.customer, tokens.rider]) expect((await switchTo(order.id, { method: 'MOTORBIKE' }, t)).status).toBe(403);
    expect((await request(app).post(`/api/v1/orders/${order.id}/delivery-method`).send({ method: 'MOTORBIKE' })).status).toBe(401);
    expect((await switchTo(order.id, { method: 'BICYCLE' })).status).toBe(400);
    expect((await switchTo(order.id, { method: 'CAR' })).status).toBe(400);
    expect((await switchTo(order.id, {})).status).toBe(400);
    expect((await switchTo(order.id, { method: 'MOTORBIKE', extra: 1 })).status).toBe(400);
    expect((await switchTo('not-a-uuid')).status).toBe(400);
    expect((await switchTo('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await orderRow(order.id)).delivery_method).toBe('BICYCLE'); // nothing changed
  });

  it('switches an unpaid COD bicycle order: motorbike fee, consistent total, rider-pay basis, audit, text; a second tap is a 409', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await placed('BICYCLE');
    expect(await orderRow(order.id)).toMatchObject({ fee: 110, standard: 110 });

    const res = await switchTo(order.id, { method: 'MOTORBIKE' }, tokens.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.order).toMatchObject({ id: order.id, delivery_method: 'MOTORBIKE', delivery_fee: 160, total_amount: order.subtotal_amount + 160 });
    const row = await orderRow(order.id);
    expect(row).toMatchObject({ delivery_method: 'MOTORBIKE', fee: 160, standard: 160, total: order.subtotal_amount + 160, delivery_fee_mode: 'DISTANCE_TIERS', km: 2.5 });
    expect(await payAmount(order.id)).toBe(row.total);

    const audit = (await pool.query("SELECT old_values, new_values, actor_user_id FROM audit_logs WHERE action = 'ORDER_DELIVERY_METHOD_SWITCHED' AND entity_id = $1", [order.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].old_values).toMatchObject({ delivery_method: 'BICYCLE', delivery_fee: 110, standard_delivery_fee: 110, total_amount: order.subtotal_amount + 110 });
    expect(audit[0].new_values).toMatchObject({ delivery_method: 'MOTORBIKE', delivery_fee: 160, standard_delivery_fee: 160, total_amount: order.subtotal_amount + 160, order_number: order.order_number });
    expect(audit[0].actor_user_id).toBe(users.admin.id);

    const sms = (await pool.query("SELECT payload, notification_type, channel FROM notifications WHERE order_id = $1 AND notification_type = 'DELIVERY_METHOD_CHANGED'", [order.id])).rows;
    expect(sms).toHaveLength(1);
    expect(sms[0].channel).toBe('SMS');
    expect(sms[0].payload).toMatchObject({ order_number: order.order_number, new_total_amount: row.total });

    const again = await switchTo(order.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'ALREADY_MOTORBIKE', message: 'This order is already a motorbike delivery.' });
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'ORDER_DELIVERY_METHOD_SWITCHED' AND entity_id = $1", [order.id])).rows[0].n).toBe(1);
    // an order that was always a motorbike order says the same
    const moto = await placed('MOTORBIKE');
    expect((await switchTo(moto.order.id)).body.error.code).toBe('ALREADY_MOTORBIKE');
  });

  it('texts the customer the new total in English, Sinhala and Tamil', () => {
    const payload = { order_number: 'BL-20261105-1234', new_total_amount: 1660 };
    const en = NotificationTemplates.render('DELIVERY_METHOD_CHANGED', payload);
    expect(en).toContain('#BL-20261105-1234');
    expect(en).toContain('motorbike');
    expect(en).toContain('LKR 1660.00');
    const si = NotificationTemplates.render('DELIVERY_METHOD_CHANGED', { ...payload, lang: 'si' });
    const ta = NotificationTemplates.render('DELIVERY_METHOD_CHANGED', { ...payload, lang: 'ta' });
    expect(si).toMatch(/[඀-෿]/);
    expect(si).toContain('BL-20261105-1234');
    expect(si).toContain('LKR 1660.00');
    expect(ta).toMatch(/[஀-௿]/);
    expect(ta).toContain('BL-20261105-1234');
    expect(ta).toContain('LKR 1660.00');
  });

  it('releases an assigned bicycle rider back to unassigned, and a motorbike rider can then take it', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await packed('BICYCLE');
    const assigned = await assign(order.id, bike.riderId);
    expect(assigned.status).toBe(200);
    const res = await switchTo(order.id, { method: 'MOTORBIKE' }, tokens.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.order.active_delivery ?? res.body.data.order.delivery).toBeFalsy();
    const rows = await deliveryStatuses(order.id);
    expect(rows).toEqual([{ assignment_status: 'REJECTED', failure_reason: 'Switched to motorbike delivery by staff' }]);
    const audit = (await pool.query("SELECT new_values FROM audit_logs WHERE action = 'ORDER_DELIVERY_METHOD_SWITCHED' AND entity_id = $1", [order.id])).rows[0];
    expect(audit.new_values.released_rider_ids).toEqual([bike.riderId]);
    // the old rider no longer sees it, and it is waiting for a rider again
    const jobs = await request(app).get('/api/v1/riders/deliveries').set(auth(bike.token));
    expect(jobs.body.data.deliveries.find((d: any) => d.order_id === order.id)).toBeUndefined();
    const live = await request(app).get('/api/v1/admin/riders/live').set(auth(opsToken));
    expect(live.body.data.unassigned_orders.find((o: any) => o.order_id === order.id)).toMatchObject({ delivery_method: 'MOTORBIKE' });
    const again = await assign(order.id, RIDER_A);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it('works from the staff prefix too (/admin/orders/:id/delivery-method)', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await placed('BICYCLE');
    const res = await request(app).post(`/api/v1/admin/orders/${order.id}/delivery-method`).set(auth(opsToken)).send({ method: 'MOTORBIKE' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.order.delivery_method).toBe('MOTORBIKE');
  });

  it('is refused once the order is picked up, and for a finished order', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await packed('BICYCLE');
    const assigned = await assign(order.id, bike.riderId);
    expect((await fx.riderStep(assigned.body.data.delivery.id, { status: 'PICKED_UP' }, bike.token)).status).toBe(200);
    const res = await switchTo(order.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ORDER_NOT_SWITCHABLE', message: 'The delivery method can only be changed before the order is picked up.' });
    expect((await orderRow(order.id)).delivery_method).toBe('BICYCLE');
    expect(await deliveryStatuses(order.id)).toEqual([{ assignment_status: 'PICKED_UP', failure_reason: null }]);

    const cancelled = await placed('BICYCLE');
    expect((await fx.adminCancel(cancelled.order.id)).status).toBe(200);
    expect((await switchTo(cancelled.order.id)).body.error.code).toBe('ORDER_NOT_SWITCHABLE');
  });

  it('is refused when money has been taken: online, paid or wallet-paid', async () => {
    expect((await enable()).status).toBe(200);
    const paid = await placed('BICYCLE');
    await pool.query("UPDATE orders SET payment_status = 'PAID' WHERE id = $1", [paid.order.id]);
    const res = await switchTo(paid.order.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_PAID_CANNOT_SWITCH');
    expect(res.body.error.message).toContain("can't change");

    const online = await placed('BICYCLE');
    await pool.query("UPDATE orders SET payment_method = 'ONLINE' WHERE id = $1", [online.order.id]);
    expect((await switchTo(online.order.id)).body.error.code).toBe('ORDER_PAID_CANNOT_SWITCH');

    const wallet = await placed('BICYCLE');
    await pool.query(
      "UPDATE orders SET wallet_amount_used = 10, total_amount = total_amount - 10 WHERE id = $1",
      [wallet.order.id]
    );
    expect((await switchTo(wallet.order.id)).body.error.code).toBe('ORDER_PAID_CANNOT_SWITCH');
    for (const o of [paid, online, wallet]) expect((await orderRow(o.order.id)).delivery_method).toBe('BICYCLE');
  });

  it('keeps a free delivery free: only the standard fee (the rider-pay basis) changes', async () => {
    expect((await enable()).status).toBe(200);
    freeDeliveries(true);
    const { order } = await placed('BICYCLE');
    expect(await orderRow(order.id)).toMatchObject({ fee: 0, standard: 110, total: order.subtotal_amount });
    const res = await switchTo(order.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ delivery_method: 'MOTORBIKE', fee: 0, standard: 160, total: order.subtotal_amount, free_delivery_reason: 'NEW_CUSTOMER' });
  });

  it('recomputes a FREE_DELIVERY coupon on the new fee', async () => {
    expect((await enable()).status).toBe(200);
    const code = `TSTBKS${Date.now() % 100000}`;
    couponCodes.push(code);
    expect((await request(app).post('/api/v1/admin/coupons').set(auth(tokens.admin)).send({ code, discount_type: 'FREE_DELIVERY' })).status).toBe(201);
    const { order } = await placed('BICYCLE', { coupon_code: code });
    expect(await orderRow(order.id)).toMatchObject({ fee: 110, discount: 110, total: order.subtotal_amount });
    expect((await switchTo(order.id)).status).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ delivery_method: 'MOTORBIKE', fee: 160, discount: 160, total: order.subtotal_amount });
    expect(await payAmount(order.id)).toBe(order.subtotal_amount);
  });

  it('uses the motorbike rule for the order\'s own distance and keeps the DB total constraint satisfied for a different distance', async () => {
    expect((await enable()).status).toBe(200);
    roadIs(1.2);
    const { order } = await placed('BICYCLE');
    expect(await orderRow(order.id)).toMatchObject({ fee: 80, km: 1.2 });
    roadIs(2.9); // the road moved; the switch measures again
    feeDistanceCache.clear();
    expect((await switchTo(order.id)).status).toBe(200);
    expect(await orderRow(order.id)).toMatchObject({ fee: 160, standard: 160, km: 2.9 });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('Rider pay for a bicycle delivery', () => {
  const delivery = async (id: string) =>
    (
      await pool.query(
        `SELECT rider_pay_type, rider_pay_model, rider_pay_inputs, rider_distance_km::float AS km, rider_base_earning_lkr::float AS base,
                rider_bonus_lkr::float AS bonus, rider_earning_lkr::float AS earning, rider_commission_percent::float AS pct
           FROM deliveries WHERE id = $1`,
        [id]
      )
    ).rows[0];
  const deliver = async (method: 'BICYCLE' | 'MOTORBIKE', rider: { riderId: string; token: string }) => {
    const { order } = await packed(method);
    return fx.deliver(order.id, rider);
  };
  let commission: { riderId: string; token: string; userId: string };
  let company: { riderId: string; token: string; userId: string };

  beforeAll(async () => {
    commission = await bicycleRider('pay-comm');
    await pool.query("UPDATE riders SET pay_type = 'COMMISSION' WHERE id = $1", [commission.riderId]);
    company = await bicycleRider('pay-company'); // COMPANY by default
  });

  it('pure rule: FIXED is fixed_lkr; PER_KM is base + per km with the floor', () => {
    const rule = { mode: 'FIXED' as const, fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null };
    expect(bicycleBasePay(rule, 4)).toBe(50);
    expect(bicycleBasePay({ ...rule, min_lkr: 90 }, 4)).toBe(50); // the floor is for PER_KM
    expect(bicycleBasePay({ ...rule, mode: 'PER_KM' }, 2.5)).toBe(67.5);
    expect(bicycleBasePay({ ...rule, mode: 'PER_KM' }, null)).toBe(30);
    expect(bicycleBasePay({ ...rule, mode: 'PER_KM', min_lkr: 100 }, 2.5)).toBe(100);
    expect(bicycleBasePay({ ...rule, mode: 'PER_KM', min_lkr: 10 }, 2.5)).toBe(67.5);
  });

  it('FIXED: a commission rider earns fixed_lkr, recorded as FIXED with the bicycle rule in the inputs', async () => {
    expect((await enable({ rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } })).status).toBe(200);
    const d = await delivery(await deliver('BICYCLE', commission));
    expect(d).toMatchObject({ rider_pay_type: 'COMMISSION', rider_pay_model: 'FIXED', base: 50, bonus: 0, earning: 50, pct: null });
    expect(d.rider_pay_inputs).toMatchObject({ model: 'FIXED', delivery_method: 'BICYCLE', rule: 'BICYCLE_FIXED', fixed_lkr: 50, standard_fee: 110 });
  });

  it('PER_KM: base + per km x road km (mapped to DISTANCE), with the minimum floor', async () => {
    roadIs(2.5);
    expect((await enable({ rider_pay: { mode: 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } })).status).toBe(200);
    let d = await delivery(await deliver('BICYCLE', commission));
    expect(d).toMatchObject({ rider_pay_model: 'DISTANCE', km: 2.5, base: 67.5, earning: 67.5 });
    expect(d.rider_pay_inputs).toMatchObject({ model: 'DISTANCE', delivery_method: 'BICYCLE', rule: 'BICYCLE_PER_KM', base_lkr: 30, per_km_lkr: 15 });

    expect((await putBicycle({ rider_pay: { mode: 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: 100 } })).status).toBe(200);
    d = await delivery(await deliver('BICYCLE', commission));
    expect(d).toMatchObject({ rider_pay_model: 'DISTANCE', base: 100, earning: 100 });
  });

  it('bonuses are unchanged and add to the bicycle base; COMPANY riders stay salaried; motorbike orders pay as before', async () => {
    expect((await enable({ rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } })).status).toBe(200);
    // a peak boost all day (+25), as set by Ops
    const peak = {
      company_riders: false,
      peak: { enabled: true, mode: 'FIXED', amount: 25, windows: [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '24:00' }] },
      daily_target: { enabled: false, tiers: [] },
      long_distance: { enabled: false, over_km: 5, amount_lkr: 50 },
    };
    await pool.query("INSERT INTO system_configurations (key, value, description) VALUES ('rider_bonus_rules', $1::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(peak)]);
    try {
      const withBonus = await delivery(await deliver('BICYCLE', commission));
      expect(withBonus).toMatchObject({ base: 50, bonus: 25, earning: 75 });
      const salaried = await delivery(await deliver('BICYCLE', company));
      expect(salaried).toMatchObject({ rider_pay_type: 'COMPANY', base: 0, bonus: 0, earning: 0, rider_pay_model: null });
      // a motorbike order for the same commission rider: the usual share of the standard fee (80% of 160)
      const moto = await delivery(await deliver('MOTORBIKE', commission));
      expect(moto).toMatchObject({ rider_pay_model: 'PERCENT', pct: 80, base: 128, bonus: 25, earning: 153 });
    } finally {
      await pool.query("DELETE FROM system_configurations WHERE key = 'rider_bonus_rules'");
    }
  });

  it('a delivery already settled never changes when the bicycle pay changes', async () => {
    expect((await enable({ rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } })).status).toBe(200);
    const id = await deliver('BICYCLE', commission);
    const before = await delivery(id);
    expect((await putBicycle({ rider_pay: { mode: 'FIXED', fixed_lkr: 999, base_lkr: 30, per_km_lkr: 15, min_lkr: null } })).status).toBe(200);
    expect(await delivery(id)).toEqual(before);
    expect(before.earning).toBe(50);
  });

  it('a bicycle order switched to motorbike before delivery pays by the motorbike rules', async () => {
    expect((await enable()).status).toBe(200);
    const { order } = await packed('BICYCLE');
    expect((await switchTo(order.id)).status).toBe(200);
    const d = await delivery(await fx.deliver(order.id, commission));
    expect(d).toMatchObject({ rider_pay_model: 'PERCENT', base: 128 });
  });
});
