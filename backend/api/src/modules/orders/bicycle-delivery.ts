import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { priceByBaseAndKm } from '../pricing/km-tiers.js';
import {
  bicycleDeliveryReady,
  readBicycleDelivery,
  type BicycleDeliverySetting,
} from '../configuration/bicycle-delivery.js';
import { measureFeeDistance, type DeliveryFeeQuote } from './delivery-fee.js';
import { orderRepository, type DBConnection } from './order.repository.js';
import { farthestPickupDistance, pickupPointsFor } from './pickup-points.js';

/*
 * Bicycle delivery (2026-11-05; setting: configuration/bicycle-delivery.ts, orders.delivery_method: migration 067).
 *
 * THE bicycle quote for one address - GET /orders/checkout-info (`bicycle`) and order placement (authoritative)
 * both come through here.
 *   available = the setting is on (and migration 067 has run)
 *               AND the address is known
 *               AND the road km (the delivery fee's own measurement: the farthest pickup point of the cart -> address,
 *                   OSRM, straight line x 1.3 when OSRM cannot answer) is at most max_km
 *               AND at least one approved, active rider with vehicle_type BICYCLE exists (not necessarily free).
 *   fee       = the BASE_PER_KM rule of the setting's fee (priceByBaseAndKm): base_lkr within base_km, then per_km_lkr per
 *               started km beyond it, then the optional cap. Without an address: the base fee.
 * Free-delivery rules and coupons then apply to this fee exactly as to the motorbike fee.
 */

type Point = { lat: number; lng: number };

export interface BicycleQuote {
  available: boolean;
  /** Why it is not available (plain words for the customer); absent when it is. */
  reason?: string;
  /** The standard bicycle fee for this address, before any free delivery. */
  fee_lkr: number;
  /** The longest bicycle trip, km (the setting). */
  max_km: number;
  /** Road km (the fee's own measurement); null without an address. */
  distance_km: number | null;
  distance_estimated: boolean | null;
}

/** Whether a rider who can take a bicycle order exists: approved, active, account not disabled, vehicle BICYCLE. */
export async function bicycleRiderExists(executor: DBConnection = db): Promise<boolean> {
  const row = await executor
    .selectFrom('riders')
    .innerJoin('users', 'users.id', 'riders.user_id')
    .select('riders.id')
    .where('riders.vehicle_type', '=', 'BICYCLE')
    .where('riders.approval_status', '=', 'APPROVED')
    .where('riders.is_active', '=', true)
    .where('users.is_active', '=', true)
    .where('users.staff_disabled_at', 'is', null)
    .limit(1)
    .executeTakeFirst();
  return !!row;
}

/** What a bicycle delivery of this many road km costs the customer (before any free delivery). */
export function bicycleFeeFor(setting: BicycleDeliverySetting, distanceKm: number | null): number {
  return priceByBaseAndKm(setting.fee, distanceKm ?? 0, setting.fee.max_fee_lkr).total;
}

/**
 * The bicycle quote for `to` (null = no address yet). `motorbike` is the quote already worked out for the same address
 * and cart: when it measured a road distance it is reused (the flat fee mode measures none, so it is measured here).
 */
export async function quoteBicycleDelivery(
  to: Point | null,
  opts: {
    executor?: DBConnection;
    hub?: { latitude: unknown; longitude: unknown } | null;
    productIds?: readonly string[];
    motorbike?: Pick<DeliveryFeeQuote, 'distance_km' | 'distance_estimated'> | null;
  } = {}
): Promise<BicycleQuote> {
  const executor = opts.executor ?? db;
  const setting = await readBicycleDelivery(executor);
  const base = { max_km: setting.max_km };

  // Off (or migration 067 not run): nothing is measured, so a shop with bicycles off pays no extra routing calls.
  const on = setting.enabled && (await bicycleDeliveryReady());
  let distance: { km: number; estimated: boolean } | null = null;
  if (to) {
    if (opts.motorbike?.distance_km !== null && opts.motorbike?.distance_km !== undefined) {
      distance = { km: opts.motorbike.distance_km, estimated: opts.motorbike.distance_estimated === true };
    } else if (on) {
      const hub = opts.hub ?? (await orderRepository.findActiveDarkStore(executor));
      const points = await pickupPointsFor(opts.productIds ?? [], hub ?? null);
      const far = await farthestPickupDistance(points, to, measureFeeDistance);
      distance = far ? { km: far.km, estimated: far.estimated } : null;
    }
  }
  const out = {
    ...base,
    fee_lkr: bicycleFeeFor(setting, distance?.km ?? null),
    distance_km: distance?.km ?? null,
    distance_estimated: distance ? distance.estimated : null,
  };

  if (!on) {
    return { ...out, available: false, reason: 'Bicycle delivery is not available right now.' };
  }
  if (!to) return { ...out, available: false, reason: 'Choose a delivery address to see bicycle delivery.' };
  if (distance === null || distance.km > setting.max_km + 1e-9) {
    return { ...out, available: false, reason: `Bicycle delivery is for trips up to ${setting.max_km} km.` };
  }
  if (!(await bicycleRiderExists(executor))) {
    return { ...out, available: false, reason: 'No bicycle rider is available right now.' };
  }
  return { ...out, available: true };
}

/** Order placement: the bicycle must really be available (400 BICYCLE_UNAVAILABLE, in plain words, otherwise). */
export function assertBicycleAvailable(quote: BicycleQuote): void {
  if (quote.available) return;
  throw new AppError(
    `${quote.reason ?? 'Bicycle delivery is not available right now.'} Please choose motorbike delivery.`,
    400,
    'BICYCLE_UNAVAILABLE',
    { max_km: quote.max_km, distance_km: quote.distance_km }
  );
}
