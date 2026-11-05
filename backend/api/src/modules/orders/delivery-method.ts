import type { DeliveryMethod } from '../../database/types.js';

/*
 * How an order is delivered (migration 067; 2026-11-05): MOTORBIKE (every older order) or BICYCLE.
 * Pure helpers, so any read model can carry `delivery_method` without importing the bicycle module.
 */

export const DELIVERY_METHODS = ['MOTORBIKE', 'BICYCLE'] as const satisfies readonly DeliveryMethod[];

/** The method an order row carries: a row from before migration 067 has none and is a motorbike delivery. */
export function deliveryMethodOf(order: { delivery_method?: unknown }): DeliveryMethod {
  return order.delivery_method === 'BICYCLE' ? 'BICYCLE' : 'MOTORBIKE';
}

/** A read model of an order with `delivery_method` always present (MOTORBIKE before migration 067). */
export function withDeliveryMethod<T extends object>(order: T): T & { delivery_method: DeliveryMethod } {
  return { ...order, delivery_method: deliveryMethodOf(order as { delivery_method?: unknown }) };
}
