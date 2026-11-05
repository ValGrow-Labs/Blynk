import type { DeliverySummary } from '../api/types';
import { BICYCLE_DELIVERY_LABEL, isBicycleDelivery } from '../lib/delivery';

/**
 * "Bicycle delivery" on a job (2026-11-05): the customer chose a short trip by
 * bicycle. Nothing is drawn for a motorbike job, so the usual cards stay as they were.
 */
export function BicycleTag({ d, className = '' }: { d: Pick<DeliverySummary, 'delivery_method'>; className?: string }) {
  if (!isBicycleDelivery(d)) return null;
  return (
    <span className={`${className} bike-tag`.trim()} data-testid="bicycle-tag">
      {BICYCLE_DELIVERY_LABEL}
    </span>
  );
}
