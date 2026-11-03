import { getActiveOrder, setActiveEta } from './openOrders';

/*
 * The banner's "Arriving in about N min": asked once per round of the shell's existing one-minute
 * orders poll (never its own loop), and only while the active order is out for delivery. The time is
 * the server's road route (the same GET /orders/:id/route the tracking map uses, which the server
 * caches); no route, an error or an order that left the road clears it - never a guess.
 */
export async function refreshActiveEta(
  fetcher: (orderId: string) => Promise<{ durationS: number } | null>,
  now: () => number = Date.now,
): Promise<void> {
  const order = getActiveOrder();
  if (!order || order.status !== 'OUT_FOR_DELIVERY') {
    setActiveEta(null);
    return;
  }
  try {
    const route = await fetcher(order.id);
    // the order may have changed (delivered, another order) while the route was on its way
    if (getActiveOrder()?.id !== order.id) return;
    setActiveEta(route && Number.isFinite(route.durationS) && route.durationS >= 0 ? { orderId: order.id, durationS: route.durationS, fetchedAt: now() } : null);
  } catch {
    if (getActiveOrder()?.id === order.id) setActiveEta(null);
  }
}
