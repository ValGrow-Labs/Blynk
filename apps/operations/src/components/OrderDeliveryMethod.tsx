import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { orders as ordersApi } from '../api/resources';
import type { DeliveryMethod, OrderDetail, OrderStatus } from '../api/types';
import { formatMoney } from '../lib/orders';
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
    <span className="bicycle-tag" data-testid="bicycle-badge" title="Bicycle delivery: only a bicycle rider can take it">
      Bicycle
    </span>
  );
}

/** "Switch to motorbike" is offered on a bicycle order before it is picked up. */
export function canSwitchToMotorbike(order: Pick<OrderDetail, 'order_status' | 'delivery_method'>): boolean {
  return order.delivery_method === 'BICYCLE' && SWITCHABLE_STATUSES.includes(order.order_status);
}

/**
 * Order -> "Switch to motorbike": a confirm step in plain words, then
 * `POST /admin/orders/:id/delivery-method`. Every refusal (409: already motorbike, picked up, paid online) is
 * shown as the server wrote it. `onChanged` re-reads the order after a switch or a refusal.
 */
export function OrderSwitchToMotorbike({ order, onChanged }: { order: OrderDetail; onChanged(): void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setError(null);
    setDone(null);
  }, [order.id]);

  const allowed = canSwitchToMotorbike(order);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const updated = await ordersApi.switchToMotorbike(order.id);
      setOpen(false);
      setDone(`Switched to motorbike delivery. The new total is ${formatMoney(updated.total_amount)}.`);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : 'Something went wrong. Nothing was changed.');
      setOpen(false);
      // The order may have moved on (picked up, already motorbike): show it as it is.
      if (err instanceof ApiError && err.status === 409) onChanged();
    } finally {
      setSaving(false);
    }
  }

  if (!allowed && !error && !done) return null;

  return (
    <section className="order-detail__section" aria-label="Delivery method">
      {done ? (
        <p className="order-detail__meta" role="status" data-testid="switch-motorbike-done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {allowed ? (
        <button type="button" className="button button--ghost button--sm" onClick={() => setOpen(true)}>
          Switch to motorbike
        </button>
      ) : null}
      {open && allowed ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="switch-motorbike-title">
          <div className="modal__panel">
            <h2 className="modal__title" id="switch-motorbike-title">
              Switch to motorbike
            </h2>
            <p className="modal__message">{SWITCH_TO_MOTORBIKE_NOTE}</p>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => setOpen(false)}>
                Back
              </button>
              <button type="button" className="button button--ink" disabled={saving} onClick={() => void submit()}>
                {saving ? 'Saving…' : 'Yes, switch to motorbike'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
