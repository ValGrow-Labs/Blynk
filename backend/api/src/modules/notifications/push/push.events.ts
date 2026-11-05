import { db } from '../../../database/connection.js';
import type { Database, OrderStatus } from '../../../database/types.js';
import { sql, type Transaction } from 'kysely';
import { logger } from '../../../utils/logger.js';
import { bestEffort, enqueuePush, PUSH_TYPES } from './push.repository.js';
import { isPushEnabled } from './push.sender.js';
import { orderPickupPoints } from '../../orders/pickup-points.js';

type Trx = Transaction<Database>;

/**
 * The notification tag of an order's pushes (owner's brother, 2026-11-03, PickMe style): every
 * status push of one order carries it, so the phone REPLACES the earlier notification instead of
 * stacking one per stage (FCM android.notification.tag, web push tag, APNs collapse id).
 */
export function orderPushTag(orderId: string): string {
  return `order-${orderId}`;
}

function arrivingBody(orderNumber: string, minutes: number | string): string {
  return `Arriving in about ${minutes} min. Order ${orderNumber}. Your delivery code is in the app.`;
}

/**
 * What the customer's phone shows for each order status. Statuses not
 * listed (PLACED, ITEM_UNAVAILABLE) send no push. The delivery code is never
 * part of a push: it stays in the app. `etaMinutes` (OUT_FOR_DELIVERY only) is the driving time
 * when it is known; without it the text carries no time - one is never guessed.
 */
export function orderStatusPush(
  status: OrderStatus,
  orderNumber: string,
  etaMinutes?: number | null
): { title: string; body: string } | null {
  switch (status) {
    case 'PACKED':
      return { title: 'Your order is packed', body: `Order ${orderNumber} is packed and waiting for a rider.` };
    case 'OUT_FOR_DELIVERY':
      return {
        title: 'Your rider is on the way',
        body:
          typeof etaMinutes === 'number' && Number.isFinite(etaMinutes) && etaMinutes > 0
            ? arrivingBody(orderNumber, Math.round(etaMinutes))
            : `Order ${orderNumber} is on its way. Your delivery code is in the app.`,
      };
    case 'DELIVERED':
      return { title: 'Delivered', body: `Order ${orderNumber} was delivered. Enjoy!` };
    case 'CANCELLED':
      return { title: 'Order cancelled', body: `Order ${orderNumber} was cancelled.` };
    case 'FAILED':
    case 'CUSTOMER_UNAVAILABLE':
      return { title: "We couldn't deliver", body: `We couldn't deliver order ${orderNumber}. We'll contact you.` };
    default:
      return null;
  }
}

/**
 * Queues the customer's push for an order status change, in the status
 * change's own transaction (sent by the worker after commit). Best effort:
 * a failure here is logged and never fails the transition.
 */
export async function enqueueOrderStatusPush(
  trx: Trx,
  order: {
    id: string;
    order_number: string;
    customer_id: string;
    dark_store_id?: string;
    delivery_latitude?: unknown;
    delivery_longitude?: unknown;
  },
  from: OrderStatus,
  to: OrderStatus
): Promise<void> {
  if (from === to || !isPushEnabled()) return;
  const text = orderStatusPush(to, order.order_number);
  if (!text) return;
  await bestEffort(
    trx,
    async () => {
      // The pushes of one order replace each other on the phone (tag). One push per status change:
      // the key is the order, the stage and how often the order has entered it (a re-staged and
      // re-dispatched order is announced again), so a replay of the same change sends nothing twice.
      const entered = await trx
        .selectFrom('order_status_history')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('order_id', '=', order.id)
        .where('new_status', '=', to)
        .executeTakeFirst();
      // A trouble finding the time only costs the time, never the push (own savepoint).
      const extra =
        to === 'OUT_FOR_DELIVERY'
          ? (await bestEffort(
              trx,
              () => etaFields(trx, order),
              (err) => logger.warn({ err, orderId: order.id }, 'Could not prepare the on-the-way time; the push carries none')
            )) ?? {}
          : {};
      await enqueuePush(trx, {
        userId: order.customer_id,
        orderId: order.id,
        type: PUSH_TYPES.ORDER_STATUS,
        idempotencyKey: `push:order-status:${order.id}:${to}:${Number(entered?.n ?? 0)}`,
        payload: { ...text, tag: orderPushTag(order.id), data: { type: 'order', order_id: order.id }, status: to, ...extra },
      });
    },
    (err) => logger.error({ err, orderId: order.id, status: to }, 'Could not queue the order status push; the transition goes ahead')
  );
}

/**
 * What lets the worker put a driving time into the "on the way" push: the rider has just collected
 * the order, so the way from the order's ONE pickup point (the store, or the seller when the whole
 * order is theirs) to the customer's door is the trip. Several pickup points, or no coordinates:
 * nothing is added and the push carries no time. The route is asked when the push is sent, not
 * here, so the routing engine never delays the order transition.
 */
async function etaFields(
  trx: Trx,
  order: { id: string; order_number: string; dark_store_id?: string; delivery_latitude?: unknown; delivery_longitude?: unknown }
): Promise<Record<string, unknown>> {
  const to = { lat: Number(order.delivery_latitude), lng: Number(order.delivery_longitude) };
  if (order.delivery_latitude == null || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) return {};
  const points = await orderPickupPoints(order, trx);
  if (points.length !== 1) return {};
  return {
    eta_route: { from: { lat: points[0]!.lat, lng: points[0]!.lng }, to },
    body_with_eta: arrivingBody(order.order_number, '{min}'),
  };
}

/**
 * "New order" on every Admin / Operations staff device (owner, 2026-10-19: "Ops app should send
 * notifications when order received"). Queued when an order becomes PLACED - at checkout for cash
 * on delivery, or when an online payment is confirmed - in that transaction (sent after commit).
 * Best effort: never fails or blocks the order.
 */
export async function enqueueNewOrderStaffPush(
  trx: Trx,
  order: { id: string; order_number: string; total_amount: number | string; delivery_method?: string },
): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      const staff = await trx
        .selectFrom('users as u')
        .select('u.id')
        .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
        .where('u.is_active', '=', true)
        .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
        .execute();
      const total = Number(order.total_amount);
      const amount = Number.isFinite(total) ? ` · LKR ${total.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '';
      // Bicycle delivery (2026-11-05): staff see at once that this one goes by bicycle.
      const byBicycle = order.delivery_method === 'BICYCLE' ? ' Bicycle delivery.' : '';
      const body = `Order ${order.order_number}${amount}.${byBicycle} Open Blynk Ops to pack it.`;
      for (const s of staff) {
        await enqueuePush(trx, {
          userId: s.id,
          orderId: order.id,
          type: PUSH_TYPES.NEW_ORDER,
          idempotencyKey: `new-order:${order.id}:${s.id}`,
          payload: { title: 'New order received', body, data: { type: 'staff_order', order_id: order.id } },
        });
      }
      if (staff.length) await enqueueOrderMilestonePush(trx, order, staff.map((s) => s.id));
    },
    (err) => logger.error({ err, orderId: order.id }, 'Could not queue the new-order staff push; the order goes ahead')
  );
}

/**
 * "Low rating" on every Admin / Operations staff device (owner, 2026-10-24; migration 055): a
 * customer rated an order 1 or 2 stars ("2-star rating on order X: Late, Missing item"). Queued in
 * the rating's transaction like the new-order alert, once per order and staff member. Best effort:
 * never fails or blocks the rating.
 */
export async function enqueueLowRatingStaffPush(
  trx: Trx,
  input: { order: { id: string; order_number: string }; stars: number; body: string },
): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      const staff = await trx
        .selectFrom('users as u')
        .select('u.id')
        .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
        .where('u.is_active', '=', true)
        .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
        .execute();
      for (const s of staff) {
        await enqueuePush(trx, {
          userId: s.id,
          orderId: input.order.id,
          type: PUSH_TYPES.LOW_RATING,
          idempotencyKey: `low-rating:${input.order.id}:${s.id}`,
          payload: {
            title: `${input.stars}-star rating`,
            body: input.body,
            data: { type: 'staff_rating', order_id: input.order.id },
          },
        });
      }
    },
    (err) => logger.error({ err, orderId: input.order.id }, 'Could not queue the low-rating staff push; the rating stands')
  );
}

/**
 * "No rider for order X" on every Admin / Operations staff device (owner, 2026-10-25): automatic
 * assignment (riders/rider.auto-assign.ts) waited for an order and no rider is close enough, free
 * enough and recently seen, so staff must assign it by hand. Sent once per order (idempotent per
 * order and staff member). Best effort: never blocks anything.
 */
export async function enqueueAutoAssignNoRiderStaffPush(trx: Trx, order: { id: string; order_number: string }): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      const staff = await trx
        .selectFrom('users as u')
        .select('u.id')
        .where('u.role', 'in', ['ADMIN', 'OPERATIONS'])
        .where('u.is_active', '=', true)
        .where((eb) => eb.exists(eb.selectFrom('device_tokens as d').select('d.id').whereRef('d.user_id', '=', 'u.id')))
        .execute();
      for (const s of staff) {
        await enqueuePush(trx, {
          userId: s.id,
          orderId: order.id,
          type: PUSH_TYPES.AUTO_ASSIGN_NO_RIDER,
          idempotencyKey: `auto-assign-none:${order.id}:${s.id}`,
          payload: {
            title: 'No rider for an order',
            body: `Order ${order.order_number} is waiting and no rider is close enough. Assign one by hand.`,
            data: { type: 'staff_order', order_id: order.id },
          },
        });
      }
    },
    (err) => logger.error({ err, orderId: order.id }, 'Could not queue the no-rider staff push')
  );
}

/** "1st", "2nd", "100th", "1,000th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n.toLocaleString('en-US')}${suffix}`;
}

/**
 * The order counts staff hear about, for marketing (owner, 2026-10-21: "notifications like which
 * order is 1st order, 100th order, 1000 order for marketing things"): the 1st, 100th, 500th and
 * 1,000th, then every 1,000th.
 */
export function isOrderMilestone(n: number): boolean {
  return n === 1 || n === 100 || n === 500 || (n >= 1000 && n % 1000 === 0);
}

/**
 * Counts this order among every order ever placed (an online order only once it is paid) and,
 * on a milestone, tells the staff phones. The transaction lock makes two orders placed at the
 * same moment count one after the other, so no milestone is skipped or told twice.
 */
async function enqueueOrderMilestonePush(trx: Trx, order: { id: string; order_number: string }, staffIds: string[]): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext('blynk-order-milestone'))`.execute(trx);
  const row = await trx
    .selectFrom('order_status_history')
    .select((eb) => eb.fn.count<string>('order_id').distinct().as('n'))
    .where('new_status', '=', 'PLACED')
    .executeTakeFirst();
  const n = Number(row?.n ?? 0);
  if (!isOrderMilestone(n)) return;
  const customer = await trx
    .selectFrom('orders as o')
    .innerJoin('users as u', 'u.id', 'o.customer_id')
    .select('u.full_name')
    .where('o.id', '=', order.id)
    .executeTakeFirst();
  const who = customer?.full_name?.trim() ? ` from ${customer.full_name.trim()}` : '';
  const title = n === 1 ? 'Blynk\'s first order!' : `Blynk's ${ordinal(n)} order!`;
  for (const id of staffIds) {
    await enqueuePush(trx, {
      userId: id,
      orderId: order.id,
      type: PUSH_TYPES.ORDER_MILESTONE,
      idempotencyKey: `order-milestone:${n}:${id}`,
      payload: {
        title,
        body: `Order ${order.order_number}${who} is the ${ordinal(n)} order. A good one to celebrate on social media.`,
        data: { type: 'staff_order', order_id: order.id },
      },
    });
  }
  logger.info({ orderId: order.id, milestone: n }, 'Order milestone reached');
}

/**
 * "New delivery" on the rider's phone when staff assign an order to them (owner, 2026-10-21: "if
 * we assign new delivery to the rider, they don't get any notifications"). Queued in the
 * assignment's transaction, one per assignment (a replacement rider is told too). Best effort:
 * never fails or blocks the assignment.
 */
export async function enqueueRiderAssignedPush(
  trx: Trx,
  input: { riderUserId: string; deliveryId: string; order: { id: string; order_number: string; delivery_method?: string } },
): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    async () => {
      await enqueuePush(trx, {
        userId: input.riderUserId,
        orderId: input.order.id,
        type: PUSH_TYPES.RIDER_ASSIGNED,
        idempotencyKey: `rider-assigned:${input.deliveryId}`,
        payload: {
          title: 'New delivery assigned',
          // Bicycle delivery (2026-11-05): the rider sees the label in the push too.
          body: `Order ${input.order.order_number} is yours.${input.order.delivery_method === 'BICYCLE' ? ' Bicycle delivery.' : ''} Open Blynk Rider to pick it up.`,
          data: { type: 'rider_delivery', order_id: input.order.id, delivery_id: input.deliveryId },
        },
      });
    },
    (err) => logger.error({ err, deliveryId: input.deliveryId }, 'Could not queue the new-delivery rider push; the assignment goes ahead')
  );
}

/**
 * "Back in stock": when a product is available to customers again
 * (is_active and is_available, not deleted), queues one push per pending
 * subscriber and marks each alert notified, so every alert fires once.
 *
 * Runs in the caller's transaction. With push disabled nothing is sent and
 * the alerts stay pending. Returns how many alerts were released.
 */
export async function releaseStockAlerts(trx: Trx, productId: string): Promise<number> {
  if (!isPushEnabled()) return 0;
  const product = await trx
    .selectFrom('products')
    .select(['id', 'name'])
    .where('id', '=', productId)
    .where('is_active', '=', true)
    .where('is_available', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) return 0;

  // The UPDATE claims each pending alert exactly once, even when two
  // releases race: the second finds notified_at already set.
  const alerts = await trx
    .updateTable('stock_alerts')
    .set({ notified_at: new Date() })
    .where('product_id', '=', productId)
    .where('notified_at', 'is', null)
    .returning(['id', 'user_id', 'created_at'])
    .execute();

  for (const alert of alerts) {
    await enqueuePush(trx, {
      userId: alert.user_id,
      type: PUSH_TYPES.BACK_IN_STOCK,
      idempotencyKey: `push:stock:${alert.id}:${new Date(alert.created_at).getTime()}`,
      payload: {
        title: `Back in stock: ${product.name}`,
        body: 'It is available again on Blynk. Tap to add it to your basket.',
        data: { type: 'product', product_id: product.id },
      },
    });
  }
  if (alerts.length) logger.info({ productId, alerts: alerts.length }, 'Back-in-stock alerts released');
  return alerts.length;
}

/** releaseStockAlerts inside a savepoint of a larger transaction (stock movements). */
export async function releaseStockAlertsSafely(trx: Trx, productId: string): Promise<void> {
  if (!isPushEnabled()) return;
  await bestEffort(
    trx,
    () => releaseStockAlerts(trx, productId),
    (err) => logger.error({ err, productId }, 'Could not release back-in-stock alerts; the stock change goes ahead')
  );
}

/** releaseStockAlerts in its own transaction (after an admin edit has committed). */
export async function releaseStockAlertsNow(productId: string): Promise<void> {
  if (!isPushEnabled()) return;
  try {
    await db.transaction().execute((trx) => releaseStockAlerts(trx, productId));
  } catch (err) {
    logger.error({ err, productId }, 'Could not release back-in-stock alerts');
  }
}
