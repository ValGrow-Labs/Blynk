import { ApiError } from '../api/client';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { isTrackable } from './delivery';
import { DeliveryTracker } from './tracking';
import { capacitorTrackingPlugin } from './tracking-plugin';

/**
 * The one DeliveryTracker for the whole app. The trackable window belongs to
 * the delivery, not to whichever screen happens to be open: it must resume
 * after a restart, survive navigating to the queue, and be stopped from
 * anywhere once the window closes. So the tracker lives here, and screens only
 * report what they last learned about a delivery via syncTracking().
 */
function createTracker(): DeliveryTracker {
  const tracker: DeliveryTracker = new DeliveryTracker(capacitorTrackingPlugin, async (deliveryId, point) => {
    try {
      await deliveriesApi.sendLocation(deliveryId, {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        captured_at: point.capturedAt.toISOString(),
      });
    } catch (err) {
      // The server is the authority on the window (cancelled, reassigned,
      // arrived elsewhere): a 409 means stop sharing, not "retry later".
      // Only if it still concerns the delivery being tracked - a late refusal
      // for a previous delivery must not stop its replacement.
      if (err instanceof ApiError && err.status === 409) {
        if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
        return;
      }
      throw err;
    }
  });
  return tracker;
}

let tracker = createTracker();
let queue: Promise<void> = Promise.resolve();

export function getTracker(): DeliveryTracker {
  return tracker;
}

/**
 * Brings the device in line with what is known about a delivery: tracking it
 * while it is inside the trackable window, stopped otherwise. Idempotent, and
 * serialized so overlapping calls (a revalidation racing a pickup) can never
 * double-start or interleave a stop with a start. A different delivery id is a
 * new tracking identity: the old one is stopped before the new one starts.
 */
export function syncTracking(delivery: DeliverySummary | null): Promise<void> {
  const run = queue.then(() => apply(delivery));
  queue = run.catch(() => undefined);
  return run;
}

async function apply(delivery: DeliverySummary | null): Promise<void> {
  const current = tracker.getDeliveryId();
  if (delivery && isTrackable(delivery)) {
    if (current === delivery.delivery_id) return;
    if (current !== null) await tracker.stop();
    await tracker.start(delivery.delivery_id);
  } else if (current !== null) {
    await tracker.stop();
  }
}

/** Test-only: drops the singleton so each test starts with an idle tracker. */
export function __resetTrackerSessionForTests(): void {
  tracker = createTracker();
  queue = Promise.resolve();
}
