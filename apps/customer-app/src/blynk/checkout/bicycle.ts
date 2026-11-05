import { formatLkr } from '@/blynk/lib/money';
import type { BicycleQuote, CheckoutInfo, DeliveryMethod, Order, PlaceOrderBody } from '@/blynk/orders/types';
import { BICYCLE_WORDS as W } from './bicycleWords';

/*
 * Bicycle delivery at checkout (2026-11-05; contract docs/superpowers/plans/2026-11-05-bicycle-delivery.md).
 * No React in here. GET /orders/checkout-info carries a `bicycle` block; the card shows only while
 * it says `available`. The customer starts on Motorbike every time (nothing is remembered). The
 * chosen method changes the fee the bill shows (quoteForMethod feeds the same checkoutBill as
 * before), and goes out as `delivery_method` when it is BICYCLE (omitted = motorbike, the server's
 * default). The server decides again at placement (400 BICYCLE_UNAVAILABLE).
 */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** What the bicycle card needs, or null while bicycle is not offered (the card is then hidden). */
export interface BicycleOffer {
  /** LKR charged for a bicycle delivery (after the free-delivery rules). */
  fee: number;
  /** The standard bicycle fee (before them). */
  standardFee: number;
  maxKm: number;
  distanceKm: number | null;
  distanceEstimated: boolean;
}

/** The usable offer from a checkout quote; null when the block is missing, unavailable or has no sane numbers. */
export function bicycleOffer(quote: CheckoutInfo | null | undefined): BicycleOffer | null {
  const b = quote?.bicycle;
  if (!b || b.available !== true || !finite(b.charged_fee_lkr) || !finite(b.fee_lkr) || !finite(b.max_km) || b.max_km <= 0) return null;
  return {
    fee: Math.max(0, b.charged_fee_lkr),
    standardFee: Math.max(0, b.fee_lkr),
    maxKm: b.max_km,
    distanceKm: finite(b.distance_km) ? b.distance_km : null,
    distanceEstimated: b.distance_estimated === true,
  };
}

/** Every checkout starts here, whatever was picked before (nothing is remembered). */
export const DEFAULT_METHOD: DeliveryMethod = 'MOTORBIKE';

/** The method that really applies: Bicycle only while the quote offers it, else Motorbike. */
export function activeMethod(chosen: DeliveryMethod, quote: CheckoutInfo | null | undefined): DeliveryMethod {
  return chosen === 'BICYCLE' && bicycleOffer(quote) ? 'BICYCLE' : 'MOTORBIKE';
}

/**
 * The quote as the bill should read it for `method`: for Bicycle the delivery fee (and the "standard"
 * fee before free delivery) become the bicycle ones, and the distance is the bicycle one. Everything
 * else (small-order fee, rewards, wallet, points) is unchanged, so the one bill function serves both.
 */
export function quoteForMethod(quote: CheckoutInfo | null, method: DeliveryMethod): CheckoutInfo | null {
  const offer = method === 'BICYCLE' ? bicycleOffer(quote) : null;
  if (!quote || !offer) return quote;
  return {
    ...quote,
    delivery_fee_lkr: offer.fee,
    standard_delivery_fee_lkr: offer.standardFee,
    ...(offer.distanceKm !== null ? { delivery_fee_mode: 'DISTANCE_TIERS' as const, delivery_distance_km: offer.distanceKm, delivery_distance_estimated: offer.distanceEstimated } : {}),
  };
}

/** The POST /orders / validate-coupon part for a method (motorbike is the server's default, so it is left out). */
export function deliveryMethodBody(method: DeliveryMethod): Pick<PlaceOrderBody, 'delivery_method'> {
  return method === 'BICYCLE' ? { delivery_method: 'BICYCLE' } : {};
}

export interface MethodRow { method: DeliveryMethod; title: string; sub: string }

/** The two choice rows. `motorbikeFee` is what the motorbike delivery costs now (null until it is known). */
export function methodRows(offer: BicycleOffer, motorbikeFee: number | null): MethodRow[] {
  const km = `${Math.round(offer.maxKm * 10) / 10}`;
  return [
    { method: 'BICYCLE', title: W.bicycleTitle, sub: W.bicycleSub(formatLkr(offer.fee), km) },
    { method: 'MOTORBIKE', title: W.motorbikeTitle, sub: motorbikeFee === null ? '' : W.motorbikeSub(formatLkr(motorbikeFee)) },
  ];
}

/** "Bicycle delivery" for a bicycle order; null for a motorbike order (and an older server's order). */
export function deliveryMethodLabel(o: Pick<Order, 'delivery_method'> | null | undefined): string | null {
  return o?.delivery_method === 'BICYCLE' ? W.bicycleLabel : null;
}

/** parseCheckoutInfo: keep a well-formed block (numbers as numbers); a broken one becomes "not available" so the card hides. */
export function parseBicycle(raw: unknown): BicycleQuote | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const x = typeof v === 'string' ? Number(v) : v;
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
  };
  const fee = num(b.fee_lkr);
  const charged = num(b.charged_fee_lkr) ?? fee;
  const maxKm = num(b.max_km);
  if (fee === null || charged === null || maxKm === null) return { available: false, fee_lkr: 0, charged_fee_lkr: 0, max_km: 0, distance_km: null, distance_estimated: null };
  return {
    available: b.available === true,
    ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
    fee_lkr: fee,
    charged_fee_lkr: charged,
    max_km: maxKm,
    distance_km: num(b.distance_km),
    distance_estimated: typeof b.distance_estimated === 'boolean' ? b.distance_estimated : null,
  };
}
