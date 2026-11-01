import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';
import { orderMap } from '../src/modules/reports/order-map.service.js';
import {
  DEFAULT_DELIVERY_ZONES,
  deliveryZonesFrom,
  normalizeZones,
  pointInZones,
  publicZones,
  zoneSlug,
  type DeliveryZone,
} from '../src/modules/configuration/delivery-zones.js';

/**
 * Extra delivery areas (owner's brother, 2026-11-01): the store circle (radius_km, 4 km, untouched) PLUS
 * extra circles, the first being Beruwala (off by default). An address is deliverable inside the circle
 * or inside an ENABLED zone; checkout, the address book, GET /store and the order map follow.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-DZ-');
const people = customerFixtures(app, { idPrefix: 'c0c00066', phoneBase: '+947096600', name: 'Zones Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

const BERUWALA = { lat: 6.4759, lng: 79.9842 };
// The Bentota side, ~5.6 km south of the store: beyond 4 km and far from Beruwala (~10 km).
const BENTOTA_SIDE = { lat: 6.385, lng: 80.005 };
const MAP_NOW = new Date('2019-03-14T06:00:00Z');

let storeId = '';
let storeLat = 0;
let storeLng = 0;
let storeRadius = 0;
let originalRow: { value: unknown; description: string | null } | null = null;
let testStart: Date;
let seq = 0;
const orderIds: string[] = [];

const getZones = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/delivery-zones').set(auth(token));
const putZones = (body: unknown, token = tokens.admin) => request(app).put('/api/v1/admin/settings/delivery-zones').set(auth(token)).send(body as object);
const beruwala = (patch: Partial<DeliveryZone> = {}) => ({ name: 'Beruwala', lat: BERUWALA.lat, lng: BERUWALA.lng, radius_km: 3, enabled: true, ...patch });
const useZones = async (zones: object[]) => expect((await putZones({ zones })).status).toBe(200);
const saveAddress = (token: string, at: { lat: number; lng: number }) =>
  request(app)
    .post('/api/v1/me/addresses')
    .set(auth(token))
    .send({ label: 'Zone', recipient_name: 'Zone', recipient_phone: '077 123 4567', address_line1: '1 Zone Road', city: 'Beruwala', latitude: at.lat, longitude: at.lng });

async function insertOrder(at: { lat: number; lng: number }, status = 'DELIVERED') {
  seq += 1;
  const id = (
    await pool.query(
      `INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                           delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city, delivery_latitude, delivery_longitude, placed_at)
       VALUES ($1, $2, $3, $4, $5, 200, 100, 300, 'Zone Test', '+94770009998', 'No. 1, Zone Lane', 'Beruwala', $6, $7, '2019-03-14T03:00:00Z') RETURNING id`,
      [`TST-DZ-${seq}-${Date.now()}`, `tst-dz-${seq}-${Date.now()}`, users.customer.id, storeId, status, at.lat.toFixed(6), at.lng.toFixed(6)]
    )
  ).rows[0].id as string;
  orderIds.push(id);
  return id;
}

const kmNorthOfStore = (km: number) => ({ lat: storeLat + km / 111.2, lng: storeLng });

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  const store = (await pool.query('SELECT id, radius_km, latitude, longitude FROM dark_stores WHERE is_active = true ORDER BY created_at ASC LIMIT 1')).rows[0];
  storeId = store.id;
  storeLat = Number(store.latitude);
  storeLng = Number(store.longitude);
  storeRadius = Number(store.radius_km);
  originalRow = (await pool.query("SELECT value, description FROM system_configurations WHERE key = 'delivery_zones'")).rows[0] ?? null;
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_zones'");
});

afterAll(async () => {
  if (orderIds.length) await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orderIds]);
  await pool.query("DELETE FROM system_configurations WHERE key = 'delivery_zones'");
  if (originalRow) {
    await pool.query("INSERT INTO system_configurations (key, value, description) VALUES ('delivery_zones', $1, $2)", [JSON.stringify(originalRow.value), originalRow.description]);
  }
  await people.cleanup();
  await fx.cleanup();
  await pool.query("DELETE FROM audit_logs WHERE action = 'DELIVERY_ZONES_UPDATED' AND created_at >= $1", [testStart]);
});

describe('pure helpers', () => {
  const zones: DeliveryZone[] = [
    { id: 'beruwala', name: 'Beruwala', ...BERUWALA, radius_km: 3, enabled: true },
    { id: 'off', name: 'Off', lat: 7, lng: 80, radius_km: 3, enabled: false },
  ];

  it('pointInZones uses enabled zones only, by the haversine distance to the centre', () => {
    expect(pointInZones(zones, BERUWALA.lat, BERUWALA.lng)?.zone.id).toBe('beruwala');
    expect(pointInZones(zones, BERUWALA.lat + 2.9 / 111.2, BERUWALA.lng)?.zone.id).toBe('beruwala');
    expect(pointInZones(zones, BERUWALA.lat + 3.1 / 111.2, BERUWALA.lng)).toBeNull();
    expect(pointInZones(zones, 7, 80)).toBeNull(); // disabled
    expect(pointInZones([], 7, 80)).toBeNull();
  });

  it('slugs names, makes ids unique, and a malformed stored row is the default', () => {
    expect(zoneSlug('Beruwala Town')).toBe('beruwala-town');
    expect(zoneSlug('බේරුවල')).toBe('area');
    expect(normalizeZones([beruwala({ name: 'A b' }), beruwala({ name: 'A-b' })]).map((z) => z.id)).toEqual(['a-b', 'a-b-2']);
    expect(deliveryZonesFrom(undefined)).toEqual(DEFAULT_DELIVERY_ZONES);
    expect(deliveryZonesFrom('not json')).toEqual(DEFAULT_DELIVERY_ZONES);
    expect(deliveryZonesFrom({ zones: [{ name: 'X' }] })).toEqual(DEFAULT_DELIVERY_ZONES);
    expect(deliveryZonesFrom({ zones: [] })).toEqual([]);
    expect(deliveryZonesFrom(JSON.stringify({ zones: [beruwala()] }))).toEqual([{ id: 'beruwala', ...beruwala() }]);
    expect(publicZones([{ id: 'x', name: 'X', lat: 6, lng: 80, radius_km: 1, enabled: false }])).toEqual([]);
  });
});

describe('Extra delivery areas setting', () => {
  it('is Beruwala, switched off, when nothing is stored', async () => {
    const res = await getZones(opsToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      zones: [{ id: 'beruwala', name: 'Beruwala', lat: 6.465, lng: 79.9857, radius_km: 2.4, enabled: false }],
      updated_at: null,
    });
    expect((await request(app).get('/api/v1/store')).body.data.delivery_zones).toEqual([]);
  });

  it('saves the list with an audit entry; /store carries only the enabled zones', async () => {
    const res = await putZones({ zones: [beruwala({ id: 'ignored' }), { name: ' Panadura ', lat: 6.7133, lng: 79.9026, radius_km: 2.5, enabled: false }] }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.zones).toEqual([
      { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: true },
      { id: 'panadura', name: 'Panadura', lat: 6.7133, lng: 79.9026, radius_km: 2.5, enabled: false },
    ]);
    expect(typeof res.body.data.updated_at).toBe('string');
    expect((await getZones()).body.data.zones).toEqual(res.body.data.zones);

    const store = await request(app).get('/api/v1/store');
    expect(store.body.data.delivery_zones).toEqual([{ id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3 }]);
    expect(store.body.data.radius_km).toBe(storeRadius); // the store circle is untouched

    const audit = (await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'DELIVERY_ZONES_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit.old_values).toEqual({ key: 'delivery_zones', zones: DEFAULT_DELIVERY_ZONES });
    expect(audit.new_values).toEqual({ key: 'delivery_zones', zones: res.body.data.zones });

    // The next change records this one as the old value; an empty list is allowed (no extra area at all).
    expect((await putZones({ zones: [] })).body.data.zones).toEqual([]);
    const second = (await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'DELIVERY_ZONES_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(second.old_values.zones).toEqual(res.body.data.zones);
    expect(second.new_values).toEqual({ key: 'delivery_zones', zones: [] });
    expect((await request(app).get('/api/v1/store')).body.data.delivery_zones).toEqual([]);
  });

  it('validates the body with VALIDATION_ERROR', async () => {
    const bad: [string, unknown][] = [
      ['no body', {}],
      ['zones not a list', { zones: 'x' }],
      ['extra key', { zones: [], extra: 1 }],
      ['empty name', { zones: [beruwala({ name: '  ' })] }],
      ['name too long', { zones: [beruwala({ name: 'x'.repeat(41) })] }],
      ['lat low', { zones: [beruwala({ lat: 4.9 })] }],
      ['lat high', { zones: [beruwala({ lat: 10.1 })] }],
      ['lng low', { zones: [beruwala({ lng: 77.9 })] }],
      ['lng high', { zones: [beruwala({ lng: 83.1 })] }],
      ['radius low', { zones: [beruwala({ radius_km: 0.4 })] }],
      ['radius high', { zones: [beruwala({ radius_km: 15.5 })] }],
      ['radius 3 decimals', { zones: [beruwala({ radius_km: 3.123 })] }],
      ['radius text', { zones: [beruwala({ radius_km: '3' as unknown as number })] }],
      ['enabled missing', { zones: [{ name: 'A', lat: 6.4, lng: 80, radius_km: 3 }] }],
      ['enabled text', { zones: [beruwala({ enabled: 'yes' as unknown as boolean })] }],
      ['unknown zone key', { zones: [{ ...beruwala(), colour: 'red' }] }],
      ['duplicate name', { zones: [beruwala(), beruwala({ name: ' beruwala ' })] }],
      ['11 zones', { zones: Array.from({ length: 11 }, (_, i) => beruwala({ name: `Area ${i}` })) }],
    ];
    for (const [label, body] of bad) {
      const res = await putZones(body);
      expect(res.status, label).toBe(400);
      expect(res.body.error.code, label).toBe('VALIDATION_ERROR');
      expect(Array.isArray(res.body.error.details), label).toBe(true);
    }
    // Boundaries are fine, and 10 zones are fine.
    expect((await putZones({ zones: [beruwala({ radius_km: 0.5, lat: 5, lng: 78 }), beruwala({ name: 'B', radius_km: 15, lat: 10, lng: 83 })] })).status).toBe(200);
    expect((await putZones({ zones: Array.from({ length: 10 }, (_, i) => beruwala({ name: `Area ${i}` })) })).status).toBe(200);
    await useZones([]);
  });

  it('is ADMIN and OPERATIONS only', async () => {
    expect((await putZones({ zones: [] }, opsToken)).status).toBe(200);
    for (const t of [tokens.staff, tokens.customer, tokens.rider]) {
      expect((await getZones(t)).status).toBe(403);
      expect((await putZones({ zones: [] }, t)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/delivery-zones')).status).toBe(401);
    expect((await request(app).put('/api/v1/admin/settings/delivery-zones').send({ zones: [] })).status).toBe(401);
  });
});

describe('Deliverable inside the store circle or an enabled zone', () => {
  it('the address book follows the zones', async () => {
    const me = await people.customer(1);
    await useZones([beruwala({ enabled: false })]);

    // Inside the store circle: always fine.
    expect((await saveAddress(me.token, kmNorthOfStore(1))).status).toBe(201);

    // Beruwala while the zone is off: refused, with no zones listed.
    const off = await saveAddress(me.token, BERUWALA);
    expect(off.status, JSON.stringify(off.body)).toBe(422);
    expect(off.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    expect(off.body.error.details.max_radius_km).toBe(storeRadius);
    expect(off.body.error.details.zones).toEqual([]);
    expect(off.body.error.message).toMatch(/^Delivery address is outside our delivery area \(\d+(\.\d+)? km from the store\)\.$/);

    // Switched on: Beruwala saves.
    await useZones([beruwala()]);
    const on = await saveAddress(me.token, BERUWALA);
    expect(on.status, JSON.stringify(on.body)).toBe(201);

    // Between (the Bentota side beyond 4 km): still refused, naming Beruwala's distance.
    const between = await saveAddress(me.token, BENTOTA_SIDE);
    expect(between.status).toBe(422);
    expect(between.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    expect(between.body.error.details.distance_km).toBeGreaterThan(storeRadius);
    expect(between.body.error.details.zones).toHaveLength(1);
    expect(between.body.error.details.zones[0].name).toBe('Beruwala');
    expect(between.body.error.details.zones[0].distance_km).toBeGreaterThan(3);

    // Just beyond the zone's own radius is refused; just inside is accepted.
    expect((await saveAddress(me.token, { lat: BERUWALA.lat + 3.2 / 111.2, lng: BERUWALA.lng })).status).toBe(422);
    expect((await saveAddress(me.token, { lat: BERUWALA.lat + 2.8 / 111.2, lng: BERUWALA.lng })).status).toBe(201);

    // Moving a saved pin (PATCH) follows the same rule.
    const id = on.body.data.address.id;
    const moved = await request(app).patch(`/api/v1/me/addresses/${id}`).set(auth(me.token)).send({ latitude: BENTOTA_SIDE.lat, longitude: BENTOTA_SIDE.lng });
    expect(moved.status).toBe(422);
    await useZones([]);
  });

  it('order placement follows the zones, and the store circle still works with the zone on', async () => {
    const me = await people.customer(2);
    const product = (await fx.product({ tracked: false })).productId;
    const items = [{ product_id: product, quantity: 1 }];
    const beruwalaAddress = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Beruwala', 'Zone', '+94771234567', '1 Zone Road', 'Beruwala', $2, $3, false) RETURNING id`,
        [me.id, BERUWALA.lat, BERUWALA.lng]
      )
    ).rows[0].id as string;
    const place = (addressId: string) => request(app).post('/api/v1/orders').set(auth(me.token)).send({ address_id: addressId, items });

    // Zone off: the Beruwala address is refused at checkout.
    await useZones([beruwala({ enabled: false })]);
    const refused = await place(beruwalaAddress);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
    expect(refused.body.error.details.zones).toEqual([]);

    // Zone on: the same address orders, and so does the home address.
    await useZones([beruwala()]);
    const placed = await place(beruwalaAddress);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const home = await place(me.addressId);
    expect(home.status, JSON.stringify(home.body)).toBe(201);

    // Switched off again: refused again.
    await useZones([beruwala({ enabled: false })]);
    expect((await place(beruwalaAddress)).status).toBe(422);
    await useZones([]);
  });
});

describe('Order map', () => {
  it('counts an order inside a zone as inside; outside again when the zone is off', async () => {
    await insertOrder(kmNorthOfStore(0.1)); // inside the store circle
    await insertOrder(BERUWALA); // Beruwala centre
    await insertOrder(BENTOTA_SIDE); // outside both
    await insertOrder(kmNorthOfStore(storeRadius - 0.2)); // near the store circle's edge

    await useZones([beruwala({ enabled: false })]);
    const off = await orderMap('this_month', 'all', MAP_NOW);
    expect(off.store.zones).toEqual([]);
    expect(off.totals).toMatchObject({ orders: 4, inside: 1, near_edge: 1, outside: 2 });
    expect(off.cells.map((c) => c.zone).sort()).toEqual(['inside', 'near_edge', 'outside', 'outside']);

    await useZones([beruwala()]);
    const on = await orderMap('this_month', 'all', MAP_NOW);
    expect(on.store.zones).toEqual([{ name: 'Beruwala', lat: BERUWALA.lat, lng: BERUWALA.lng, radius_km: 3 }]);
    expect(on.store.radius_km).toBe(storeRadius);
    expect(on.totals).toMatchObject({ orders: 4, inside: 2, near_edge: 1, outside: 1 });
    expect(on.cells.map((c) => c.zone).sort()).toEqual(['inside', 'inside', 'near_edge', 'outside']);

    const res = await request(app).get('/api/v1/admin/reports/order-map?range=last_90_days&status=all').set(auth(opsToken));
    expect(res.status).toBe(200);
    expect(res.body.data.store.zones).toEqual([{ name: 'Beruwala', lat: BERUWALA.lat, lng: BERUWALA.lng, radius_km: 3 }]);
    await useZones([]);
    expect((await request(app).get('/api/v1/admin/reports/order-map').set(auth(tokens.admin))).body.data.store.zones).toEqual([]);
  });
});
