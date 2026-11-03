import { useSyncExternalStore } from 'react';
import { pickActiveOrder, sameBannerOrder, type BannerEta, type BannerOrder, type BannerOrderLike } from './activeBanner';

/*
 * The Orders tab's badge (Flutter CustomerShell): shown while the customer has an order that is
 * not finished. Delivered, cancelled and failed orders are finished; anything else - a problem
 * that needs the customer included - is still open. Fed by every orders list the app loads.
 */

const FINISHED = new Set(['DELIVERED', 'CANCELLED', 'FAILED']);

export const isOpenOrder = (status: string | null | undefined): boolean => !!status && !FINISHED.has(status);

export const hasOpenOrder = (orders: { order_status: string }[]): boolean => orders.some((o) => isOpenOrder(o.order_status));

let open = false;
const listeners = new Set<() => void>();

/** The order the "active order" banner follows, and the server's time to the door for it (null = unknown). */
let active: BannerOrder | null = null;
let eta: BannerEta | null = null;

/** Record the latest first page of the customer's orders (or [] when signed out). */
export function setKnownOrders(orders: BannerOrderLike[]) {
  const next = hasOpenOrder(orders);
  const nextActive = pickActiveOrder(orders);
  const activeChanged = !sameBannerOrder(active, nextActive);
  // a time belongs to one order: another order, or none, drops it
  const etaGone = eta !== null && (!nextActive || nextActive.id !== eta.orderId || nextActive.status !== 'OUT_FOR_DELIVERY');
  if (next === open && !activeChanged && !etaGone) return;
  open = next;
  if (activeChanged) active = nextActive;
  if (etaGone) eta = null;
  listeners.forEach((l) => l());
}

/** The server's driving time to the door for the active order (the banner's "Arriving in about N min"); null clears it. */
export function setActiveEta(next: BannerEta | null) {
  if (next === null ? eta === null : eta !== null && eta.orderId === next.orderId && eta.durationS === next.durationS && eta.fetchedAt === next.fetchedAt) return;
  eta = next;
  listeners.forEach((l) => l());
}

export const getActiveOrder = () => active;
export const getActiveEta = () => eta;

export const getHasOpenOrder = () => open;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useHasOpenOrder(): boolean {
  return useSyncExternalStore(subscribe, getHasOpenOrder, getHasOpenOrder);
}

export function useActiveOrder(): BannerOrder | null {
  return useSyncExternalStore(subscribe, getActiveOrder, getActiveOrder);
}

export function useActiveEta(): BannerEta | null {
  return useSyncExternalStore(subscribe, getActiveEta, getActiveEta);
}
