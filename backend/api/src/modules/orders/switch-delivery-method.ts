import { db } from '../../database/connection.js';
import type { OrderStatus } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { recomputeOrderDiscount } from '../coupons/coupon.service.js';
import { recomputeOrderRewards } from '../loyalty/order-rewards.js';
import { settleWalletAfterItemChange } from '../wallet/wallet.service.js';
import { quoteDeliveryFee } from './delivery-fee.js';
import { deliveryMethodOf } from './delivery-method.js';
import { enqueueCustomerSms } from './lifecycle/notify.js';
import { updateOrderFields } from './lifecycle/status-writer.js';
import { orderProductIds } from './pickup-points.js';

/**
 * "Switch to motorbike" (2026-11-05; Admin and Operations, POST /orders/:id/delivery-method {"method":"MOTORBIKE"}).
 *
 * A bicycle order the staff cannot serve by bicycle (no bicycle rider, bad weather, a hill) becomes an ordinary motorbike
 * order. Only BICYCLE -> MOTORBIKE, and only before the order is picked up (PLACED, ITEM_UNAVAILABLE or PACKED, with
 * no rider on the road). The same row lock order as the lifecycle: the order's active deliveries, then the order.
 *
 *  - Only while no money has been taken that the new fee would change: a cash-on-delivery order that has not been paid.
 *    An order paid online (PayHere, or waiting for it) or with the Blynk Wallet is refused 409 ORDER_PAID_CANNOT_SWITCH.
 *  - The fee is worked out again with quoteDeliveryFee (the motorbike rule) for the order's own address and store.
 *    delivery_fee / standard_delivery_fee / delivery_fee_mode / distance and the money that follows from the fee (a coupon's
 *    discount, a referral reward, Blynk Points, the total, what is still to collect in payments) are updated together,
 *    the way "Make delivery free" does. An order that was delivered free (a free-delivery rule, or staff made it free)
 *    stays free: its fee is still 0, only the standard fee (the rider-pay basis) becomes the motorbike's.
 *  - A rider already assigned (ASSIGNED / ACCEPTED) is released: the delivery row closes as REJECTED (it shows nowhere,
 *    holds no capacity) and the order is back to "waiting for a rider".
 *  - The customer is texted the new total (SMS DELIVERY_METHOD_CHANGED, English / Sinhala / Tamil like the other order
 *    texts). An audit row (ORDER_DELIVERY_METHOD_SWITCHED, old and new money) is written; the order history only
 *    records status changes, so there is no history row.
 *  - Already MOTORBIKE: 409 ALREADY_MOTORBIKE (so a second tap changes nothing).
 */
export const SWITCH_DELIVERY_METHOD_ACTION = 'ORDER_DELIVERY_METHOD_SWITCHED';

/** Statuses in which the method may still change (AWAITING_PAYMENT is an online order and is refused for its payment). */
export const SWITCHABLE_ORDER_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'PLACED', 'ITEM_UNAVAILABLE', 'PACKED'];

const round2 = (v: number) => Math.round(v * 100) / 100;

export async function switchDeliveryMethodToMotorbike(orderId: string, method: 'MOTORBIKE', actor: AuditActor) {
  const result = await db.transaction().execute(async (trx) => {
    // Children before the order (the canonical lock order, lifecycle/engine.ts).
    const active = await trx
      .selectFrom('deliveries')
      .selectAll()
      .where('order_id', '=', orderId)
      .where('assignment_status', 'in', ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'ARRIVED_AT_CUSTOMER'])
      .orderBy('id')
      .forUpdate()
      .execute();
    const order = await trx.selectFrom('orders').selectAll().where('id', '=', orderId).forUpdate().executeTakeFirst();
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');

    if (deliveryMethodOf(order) === 'MOTORBIKE') {
      throw new AppError('This order is already a motorbike delivery.', 409, 'ALREADY_MOTORBIKE');
    }
    const onTheRoad = active.some((d) => d.assignment_status === 'PICKED_UP' || d.assignment_status === 'ARRIVED_AT_CUSTOMER');
    if (!SWITCHABLE_ORDER_STATUSES.includes(order.order_status) || onTheRoad) {
      throw new AppError('The delivery method can only be changed before the order is picked up.', 409, 'ORDER_NOT_SWITCHABLE', {
        order_status: order.order_status,
      });
    }
    if (order.payment_method !== 'COD' || order.payment_status === 'PAID' || Number(order.wallet_amount_used ?? 0) > 0) {
      throw new AppError(
        "This order was paid online or with the Blynk Wallet, so its delivery fee can't change. Cancel it and ask the customer to order again with motorbike delivery.",
        409,
        'ORDER_PAID_CANNOT_SWITCH',
        { payment_method: order.payment_method, payment_status: order.payment_status }
      );
    }

    // The motorbike fee for this order's own address and store (quoteDeliveryFee is THE fee).
    const hub = await trx.selectFrom('dark_stores').selectAll().where('id', '=', order.dark_store_id).executeTakeFirst();
    const quote = await quoteDeliveryFee(
      { lat: Number(order.delivery_latitude), lng: Number(order.delivery_longitude) },
      { executor: trx, hub: hub ?? null, productIds: await orderProductIds(order.id, trx) }
    );
    const oldCharged = Number(order.delivery_fee);
    const oldStandard = Number(order.standard_delivery_fee ?? oldCharged);
    // A delivery that went out free (free-delivery rule, or staff made it free) stays free.
    const waived = oldCharged === 0 && oldStandard > 0;
    const newStandard = quote.fee_lkr;
    const newCharged = waived ? 0 : newStandard;

    // The money again with the new fee (as "Make delivery free" and RESOLVE_ITEM do; the subtotal is unchanged).
    const subtotal = Number(order.subtotal_amount);
    const birthday = Number(order.birthday_discount_amount ?? 0);
    const offer =
      birthday > 0
        ? birthday
        : order.coupon_code
          ? await recomputeOrderDiscount(trx, order.id, subtotal, newCharged)
          : Number(order.discount_amount ?? 0);
    const rewards = await recomputeOrderRewards(trx, { ...order, delivery_fee: newCharged }, subtotal, offer);
    const due = round2(subtotal + newCharged + Number(order.small_order_fee ?? 0) - rewards.discount_amount);
    const wallet = await settleWalletAfterItemChange(trx, order, due, 'Delivery method', new Date());
    const total = wallet.total_amount;

    const updated = await updateOrderFields(trx, order, {
      delivery_method: 'MOTORBIKE',
      delivery_fee: newCharged,
      standard_delivery_fee: newStandard,
      delivery_fee_mode: quote.fee_mode,
      delivery_distance_km: quote.distance_km,
      delivery_distance_estimated: quote.distance_estimated,
      discount_amount: rewards.discount_amount,
      ...rewards.fields,
      total_amount: total,
    });
    // What is still to collect (cash on delivery).
    await trx
      .updateTable('payments')
      .set({ amount: total, updated_at: new Date() })
      .where('order_id', '=', order.id)
      .where('payment_status', '!=', 'PAID')
      .execute();

    // Release the bicycle rider: the order is waiting for a rider again.
    const released = active.filter((d) => d.assignment_status === 'ASSIGNED' || d.assignment_status === 'ACCEPTED');
    if (released.length) {
      await trx
        .updateTable('deliveries')
        .set({ assignment_status: 'REJECTED', failure_reason: 'Switched to motorbike delivery by staff', updated_at: new Date() })
        .where('id', 'in', released.map((d) => d.id))
        .execute();
    }

    const money = (o: typeof order) => ({
      delivery_method: deliveryMethodOf(o),
      delivery_fee: Number(o.delivery_fee),
      standard_delivery_fee: o.standard_delivery_fee == null ? null : Number(o.standard_delivery_fee),
      discount_amount: Number(o.discount_amount ?? 0),
      points_redeemed: Number(o.points_redeemed ?? 0),
      total_amount: Number(o.total_amount),
    });
    await writeAudit(trx, actor, {
      action: SWITCH_DELIVERY_METHOD_ACTION,
      entityType: 'ORDER',
      entityId: order.id,
      oldValues: money(order),
      newValues: {
        ...money(updated),
        order_number: order.order_number,
        customer_id: order.customer_id,
        released_rider_ids: released.map((d) => d.rider_id),
      },
    });

    // The customer hears about it (the new total; SMS in their language, like the other order texts).
    await enqueueCustomerSms(trx, order, 'DELIVERY_METHOD_CHANGED', `order_${order.id}_DELIVERY_METHOD_SWITCH_SMS`, {
      order_number: order.order_number,
      new_total_amount: total,
    });
    return { from: 'BICYCLE', to: method, oldTotal: Number(order.total_amount), total, released: released.length };
  });
  logger.info({ orderId, ...result, actorId: actor.actorId }, 'Order delivery method switched to motorbike by staff');
  return result;
}
