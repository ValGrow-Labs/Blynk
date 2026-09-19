import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { subscribe, broadcastLocation, subscriberCount, closeAllStreams, type LocationEvent } from '../src/modules/realtime/location-stream.js';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

function fakeRes() {
  return { write: vi.fn(), end: vi.fn() } as unknown as import('express').Response;
}

const EVENT: LocationEvent = { latitude: 6.4, longitude: 80.0, accuracy: 10, captured_at: '2026-09-19T10:00:00.000Z', received_at: '2026-09-19T10:00:01.000Z' };

describe('location-stream broadcaster', () => {
  it('delivers a broadcast to every subscriber of that order, and no other order', () => {
    const a = fakeRes();
    const b = fakeRes();
    const unsubA = subscribe('order-1', a);
    subscribe('order-2', b);
    broadcastLocation('order-1', EVENT);
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('"latitude":6.4'));
    expect(b.write).not.toHaveBeenCalled();
    unsubA();
  });

  it('unsubscribing stops further broadcasts and cleans up empty order entries', () => {
    const a = fakeRes();
    const unsub = subscribe('order-3', a);
    expect(subscriberCount('order-3')).toBe(1);
    unsub();
    expect(subscriberCount('order-3')).toBe(0);
    broadcastLocation('order-3', EVENT);
    expect(a.write).not.toHaveBeenCalled();
  });

  it('broadcasting to an order with no subscribers is a harmless no-op', () => {
    expect(() => broadcastLocation('order-nobody', EVENT)).not.toThrow();
  });

  it('a second subscriber to the same order gets its own broadcasts, independent of the first', () => {
    const a = fakeRes();
    const b = fakeRes();
    subscribe('order-4', a);
    subscribe('order-4', b);
    broadcastLocation('order-4', EVENT);
    expect(a.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('closeAllStreams ends every open connection and clears the registry', () => {
    const a = fakeRes();
    subscribe('order-5', a);
    closeAllStreams();
    expect(a.write).toHaveBeenCalledWith(expect.stringContaining('server_shutdown'));
    expect(a.end).toHaveBeenCalled();
    expect(subscriberCount('order-5')).toBe(0);
  });
});

describe('Customer location stream (HTTP)', () => {
  const app = createApp();
  let server: http.Server;
  let baseUrl: string;
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const customerB = { id: 'a0000005-0000-0000-0000-000000000005', phone: '+94771119999', role: 'CUSTOMER' as const };
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderAUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER_A = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = { customer: generateAccessToken(customer), customerB: generateAccessToken(customerB), admin: generateAccessToken(admin), staff: generateAccessToken(staff), riderA: generateAccessToken(riderAUser) };
  const created: string[] = [];
  let addressId = '';

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const addr = server.address();
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const a = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1,'Stream test','Stream Test','+94771234567','No. 1, Test Lane','Dharga Town',6.4351,80.0243,false) RETURNING id`,
      [customer.id]
    );
    addressId = a.rows[0].id;
  });
  afterAll(async () => {
    server.close();
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  /** Places+sources+packs+assigns+picks up, returns the order id and delivery id, ready to send locations. */
  async function trackableOrder() {
    const request = (await import('supertest')).default;
    const placed = await request(app).post('/api/v1/orders').set('Authorization', `Bearer ${tokens.customer}`).send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
    const orderId = placed.body.data.order.id as string;
    created.push(orderId);
    const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.admin}`);
    for (const item of detail.body.data.order.items) {
      await request(app).post(`/api/v1/admin/orders/${orderId}/items/${item.id}/source`).set('Authorization', `Bearer ${tokens.staff}`).send({ actual_unit_cost: 450 });
    }
    await request(app).patch(`/api/v1/admin/orders/${orderId}/status`).set('Authorization', `Bearer ${tokens.staff}`).send({ status: 'PACKED' });
    const assign = await request(app).post(`/api/v1/admin/orders/${orderId}/assign-rider`).set('Authorization', `Bearer ${tokens.admin}`).send({ rider_id: RIDER_A });
    const deliveryId = assign.body.data.delivery.id as string;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'PICKED_UP' });
    return { orderId, deliveryId };
  }

  /**
   * Opens the stream, reads text frames until `until` returns true or
   * `timeoutMs` elapses, then aborts. Default timeout is short (this route's
   * own checks - ownership, initial trackability - resolve immediately);
   * a test observing the 15s heartbeat re-check passes a longer timeoutMs.
   */
  function readStream(orderId: string, token: string, until: (raw: string) => boolean, timeoutMs = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      let raw = '';
      const req = http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (until(raw)) {
            req.destroy();
            resolve(raw);
          }
        });
        res.on('end', () => resolve(raw));
      });
      req.on('error', (err) => { if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err); else resolve(raw); });
      setTimeout(() => { req.destroy(); resolve(raw); }, timeoutMs);
    });
  }

  it('sends the current location immediately on connect, then a live broadcast', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).post(`/api/v1/riders/deliveries/${deliveryId}/location`).set('Authorization', `Bearer ${tokens.riderA}`).send({ latitude: 6.44, longitude: 80.03, accuracy: 8, captured_at: new Date().toISOString() });

    const raw = await readStream(orderId, tokens.customer, (raw) => raw.includes('event: location'));
    expect(raw).toContain('event: location');
    expect(raw).toContain('"latitude":6.44');
  });

  it('rejects an unauthenticated request (401)', async () => {
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/00000000-0000-0000-0000-000000000000/location/stream`, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(401);
  });

  it('rejects a non-CUSTOMER role (403)', async () => {
    const { orderId } = await trackableOrder();
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${tokens.staff}` } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(403);
  });

  it('a second customer cannot open the first customer\'s stream (404)', async () => {
    const { orderId } = await trackableOrder();
    const res = await new Promise<number>((resolve) => {
      http.get(`${baseUrl}/api/v1/orders/${orderId}/location/stream`, { headers: { Authorization: `Bearer ${tokens.customerB}` } }, (r) => resolve(r.statusCode ?? 0));
    });
    expect(res).toBe(404);
  });

  it('closes the stream once the delivery arrives (no longer trackable)', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    const streamP = readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'), 17_000);
    await new Promise((r) => setTimeout(r, 200));
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await streamP;
    expect(raw).toContain('event: closed');
    expect(raw).toContain('delivery_closed');
  }, 20_000);

  it('an already-arrived order refuses a new stream connection outright', async () => {
    const { orderId, deliveryId } = await trackableOrder();
    const request = (await import('supertest')).default;
    await request(app).patch(`/api/v1/riders/deliveries/${deliveryId}/status`).set('Authorization', `Bearer ${tokens.riderA}`).send({ status: 'ARRIVED_AT_CUSTOMER' });
    const raw = await readStream(orderId, tokens.customer, (raw) => raw.includes('event: closed'));
    expect(raw).toContain('not_trackable');
  });
});
