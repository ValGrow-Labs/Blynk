import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { orders as ordersApi } from '../api/resources';
import type { DeliveryMethod, OrderDetail, UserRole } from '../api/types';
import { formatMoney, type OrderStatus } from '../lib/orders';
import { Spinner } from './ui';
import './bicycle.css';

/** Order states in which the API still lets staff switch a bicycle order to motorbike (before pick-up). */
export const SWITCHABLE_STATUSES: readonly OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED'];

/** The plain words of the confirm step (the API's own refusals are shown as they come). */
export const SWITCH_TO_MOTORBIKE_NOTE =
  "The customer's delivery fee changes to the motorbike fee and any assigned bicycle rider is released. The customer is sent a text.";

/** The "Bicycle" badge on a bicycle order; a motorbike order shows nothing, so lists stay quiet. */
export function BicycleTag({ method }: { method: DeliveryMethod | null | undefined }) {
  if (method !== 'BICYCLE') return null;
  return (
    <span className="pay-chip bicycle-chip" data-testid="bicycle-badge" title="Bicycle delivery: only a bicycle rider can take it">
      Bicycle
    </span>
  );
}

/** "Switch to motorbike" is offered to Admin and Operations on a bicycle order before it is picked up. */
export function canSwitchToMotorbike(order: Pick<OrderDetail, 'order_status' | 'delivery_method'>, role: UserRole | undefined): boolean {
  return (
    (role === 'ADMIN' || role === 'OPERATIONS') &&
    order.delivery_method === 'BICYCLE' &&
    SWITCHABLE_STATUSES.includes(order.order_status)
  );
}

/**
 * Order -> "Switch to motorbike": a confirm step in plain words, then
 * POST /admin/orders/:id/delivery-method. Every refusal (409: already motorbike, picked up, paid online) is
 * shown as the server wrote it. `onChanged` re-reads the order and the board after a switch or a refusal.
 */
export function OrderSwitchToMotorbike({
  order,
  role,
  onChanged,
}: {
  order: OrderDetail;
  role: UserRole | undefined;
  onChanged(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Another order in the same panel starts closed.
  useEffect(() => {
    setConfirming(false);
    setError(null);
    setDone(null);
  }, [order.id]);

  const allowed = canSwitchToMotorbike(order, role);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const updated = await ordersApi.switchToMotorbike(order.id);
      setConfirming(false);
      setDone(`Switched to motorbike delivery. The new total is ${formatMoney(updated.total_amount)}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : 'Something went wrong. Nothing was changed.');
      setConfirming(false);
      // The order may have moved on (picked up, already motorbike): show it as it is.
      if (err instanceof ApiError && err.status === 409) onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (!allowed && !error && !done) return null;

  return (
    <div className="switch-motorbike">
      {done ? (
        <p className="order-panel__meta" role="status" data-testid="switch-motorbike-done">
          {done}
        </p>
      ) : null}
      {allowed && !confirming ? (
        <button type="button" className="button button--ghost button--sm" onClick={() => setConfirming(true)}>
          Switch to motorbike
        </button>
      ) : null}
      {allowed && confirming ? (
        <div role="group" aria-label="Switch to motorbike">
          <p className="order-panel__meta">{SWITCH_TO_MOTORBIKE_NOTE}</p>
          <div className="form__actions">
            <button type="button" className="button button--ghost button--sm" disabled={saving} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="button button--sm" disabled={saving} onClick={() => void submit()}>
              {saving ? <Spinner label="Saving" /> : 'Yes, switch to motorbike'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
