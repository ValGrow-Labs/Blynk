import { BANNER_WORDS } from './bannerWords';

/*
 * The slim "active order" banner above the tab bar (owner's brother, 2026-11-03, the PickMe style):
 * which order it is about, what it says, how far along the four-step bar is, and where a tap goes.
 * Pure: the screens only draw what bannerView() answers. Nothing here is ever guessed - the time
 * comes only from the server's road route (GET /orders/:id/route), and without one the banner
 * says "Rider is on the way".
 */

/** What the banner needs of an order (an Order from GET /orders satisfies it). */
export type BannerOrderLike = {
  id?: string;
  order_number?: string;
  order_status: string;
  scheduled_for?: string | null;
  delivery?: { assignment_status: string } | null;
};

/** The order the banner follows, as kept between polls. */
export type BannerOrder = {
  id: string;
  orderNumber: string;
  status: 'PLACED' | 'PACKED' | 'OUT_FOR_DELIVERY';
  scheduled: boolean;
  /** The delivery's handover step when the server sent it (GET /orders/:id does, the list does not). */
  assignment: string | null;
};

/** The server's driving time to the door, with the phone's own clock when it was read. */
export type BannerEta = { orderId: string; durationS: number; fetchedAt: number };

export type BannerStage = 'placed' | 'packing' | 'packed' | 'assigned' | 'onTheWay' | 'nearby' | 'arrived';

export type BannerView = {
  orderId: string;
  stage: BannerStage;
  text: string;
  /** 0-based step of the four (placed, packed, on the way, delivered) the order has reached. */
  step: 0 | 1 | 2;
  steps: 4;
  /** Whole minutes to the door while the time is known and fresh, else null. */
  etaMinutes: number | null;
  /** 'track': the live map (the rider is on the road); 'order': the order screen. */
  opens: 'track' | 'order';
};

export const BANNER_STEPS = 4;

/** A time older than this is not shown (the rider may have stopped being tracked). */
export const ETA_MAX_AGE_MS = 5 * 60_000;

/** At or under this many seconds left the banner says the rider is nearby instead of counting minutes. */
export const NEARBY_S = 60;

const ACTIVE = new Set(['PLACED', 'PACKED', 'OUT_FOR_DELIVERY']);

/** Statuses the banner follows: placed up to out for delivery. Not unpaid, delivered, cancelled or problem orders. */
export const isBannerStatus = (status: string | null | undefined): boolean => !!status && ACTIVE.has(status);

/** The newest order (the list is newest first) the banner follows, or null. */
export function pickActiveOrder(orders: readonly BannerOrderLike[]): BannerOrder | null {
  for (const o of orders) {
    if (!o.id || !isBannerStatus(o.order_status)) continue;
    return {
      id: o.id,
      orderNumber: o.order_number ?? '',
      status: o.order_status as BannerOrder['status'],
      scheduled: !!o.scheduled_for,
      assignment: o.delivery?.assignment_status ?? null,
    };
  }
  return null;
}

/** Same order, same words: lets the store skip a re-render when a poll changed nothing. */
export const sameBannerOrder = (a: BannerOrder | null, b: BannerOrder | null): boolean =>
  a === b || (!!a && !!b && a.id === b.id && a.status === b.status && a.scheduled === b.scheduled && a.assignment === b.assignment && a.orderNumber === b.orderNumber);

/**
 * Minutes left to the door from a route read at `eta.fetchedAt`: the driving time minus the time
 * since, rounded up, never below 1. Null when the time is for another order, the order is not on
 * the road, it is older than ETA_MAX_AGE_MS, or it is not a usable number.
 */
export function etaMinutesLeft(order: BannerOrder, eta: BannerEta | null, now: number): number | null {
  if (!eta || order.status !== 'OUT_FOR_DELIVERY' || eta.orderId !== order.id) return null;
  if (!Number.isFinite(eta.durationS) || eta.durationS < 0 || !Number.isFinite(eta.fetchedAt)) return null;
  const age = Math.max(0, now - eta.fetchedAt);
  if (age > ETA_MAX_AGE_MS) return null;
  const left = eta.durationS - age / 1000;
  return left <= 0 ? 1 : Math.max(1, Math.ceil(left / 60));
}

/**
 * What the banner shows, or null while it is hidden (no order in progress, or the customer is not
 * signed in: pass order = null). Where it may appear (the four tabs, not cart / checkout / tracking
 * screens, not over the keyboard) is the shell's job; see bannerHidden().
 */
export function bannerView(order: BannerOrder | null, eta: BannerEta | null, now: number): BannerView | null {
  if (!order) return null;
  const W = BANNER_WORDS;
  switch (order.status) {
    case 'PLACED':
      // booked for later: not being packed yet
      return order.scheduled
        ? { orderId: order.id, stage: 'placed', text: W.placed, step: 0, steps: BANNER_STEPS, etaMinutes: null, opens: 'order' }
        : { orderId: order.id, stage: 'packing', text: W.packing, step: 0, steps: BANNER_STEPS, etaMinutes: null, opens: 'order' };
    case 'PACKED': {
      const assigned = order.assignment === 'ASSIGNED' || order.assignment === 'ACCEPTED';
      return assigned
        ? { orderId: order.id, stage: 'assigned', text: W.packedAssigned, step: 1, steps: BANNER_STEPS, etaMinutes: null, opens: 'order' }
        : { orderId: order.id, stage: 'packed', text: W.packed, step: 1, steps: BANNER_STEPS, etaMinutes: null, opens: 'order' };
    }
    case 'OUT_FOR_DELIVERY': {
      if (order.assignment === 'ARRIVED_AT_CUSTOMER') {
        return { orderId: order.id, stage: 'arrived', text: W.arrived, step: 2, steps: BANNER_STEPS, etaMinutes: null, opens: 'order' };
      }
      const minutes = etaMinutesLeft(order, eta, now);
      if (minutes === null) {
        return { orderId: order.id, stage: 'onTheWay', text: W.onTheWay, step: 2, steps: BANNER_STEPS, etaMinutes: null, opens: 'track' };
      }
      const left = eta ? eta.durationS - Math.max(0, now - eta.fetchedAt) / 1000 : Infinity;
      return left <= NEARBY_S
        ? { orderId: order.id, stage: 'nearby', text: W.nearby, step: 2, steps: BANNER_STEPS, etaMinutes: minutes, opens: 'track' }
        : { orderId: order.id, stage: 'onTheWay', text: W.arriving(minutes), step: 2, steps: BANNER_STEPS, etaMinutes: minutes, opens: 'track' };
    }
    default:
      return null;
  }
}

/** The four bar segments: filled up to and including the order's step. */
export const barFill = (step: number, steps = BANNER_STEPS): boolean[] => Array.from({ length: steps }, (_, i) => i <= step);

/**
 * Hidden while the keyboard is open (it would sit on top of the field), in the design mock and for
 * a guest. Anything else shows when bannerView() has something to say.
 */
export const bannerHidden = (s: { keyboardOpen: boolean; demo: boolean; signedIn: boolean }): boolean => s.keyboardOpen || s.demo || !s.signedIn;
