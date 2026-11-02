/*
 * Where tapping a push notification goes. What the backend sends to a customer (data values are
 * strings; backend/api/src/modules/**):
 *   {type: 'order', order_id, basket_id?}   order status; a repeat basket that was ordered  -> /order/[id]
 *   {type: 'product', product_id}           "back in stock" and "now available"             -> /p/[id]
 *   {type: 'appointment', appointment_id}   dental / doctor reminder and "rate your visit"  -> /doctors/appointments/[id]
 *   {type: 'wallet'}                        "X added to your Blynk Wallet"                  -> /wallet
 *   {type: 'repeat_basket', basket_id}      a repeat basket that could not be ordered       -> /repeat-baskets
 *   {kind: 'broadcast', broadcast_id}       an offer / announcement from staff              -> just opens the app
 * Everything else (staff_*, rider_*, SELLER_*) is for other apps and opens nothing. Only screens
 * that exist are targeted (Flutter's PushTarget).
 */
export type PushTarget =
  | { kind: 'order'; id: string; path: string }
  | { kind: 'product'; id: string; path: string }
  | { kind: 'appointment'; id: string; path: string }
  | { kind: 'wallet'; path: '/wallet' }
  | { kind: 'repeat_basket'; path: '/repeat-baskets' };

export function pushTargetOf(data: unknown): PushTarget | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  // ids are UUIDs: anything with a path character is not one of ours
  const id = (k: string): string | null => {
    const v = d[k];
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    return s && !/[/?#\\]/.test(s) ? s : null;
  };
  switch (d.type) {
    case 'order': {
      const orderId = id('order_id');
      return orderId ? { kind: 'order', id: orderId, path: `/order/${encodeURIComponent(orderId)}` } : null;
    }
    case 'product': {
      const productId = id('product_id');
      return productId ? { kind: 'product', id: productId, path: `/p/${encodeURIComponent(productId)}` } : null;
    }
    case 'appointment': {
      const appointmentId = id('appointment_id');
      return appointmentId ? { kind: 'appointment', id: appointmentId, path: `/doctors/appointments/${encodeURIComponent(appointmentId)}` } : null;
    }
    case 'wallet':
      return { kind: 'wallet', path: '/wallet' };
    case 'repeat_basket':
      return { kind: 'repeat_basket', path: '/repeat-baskets' };
    default:
      return null;
  }
}

/**
 * A message the Firebase messaging service worker posts to the page when a notification is
 * tapped ({isFirebaseMessaging, messageType: 'notification-clicked', data}). Returns its data.
 */
export function clickedPushData(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (m.isFirebaseMessaging !== true || m.messageType !== 'notification-clicked') return null;
  return m.data && typeof m.data === 'object' ? (m.data as Record<string, unknown>) : null;
}
