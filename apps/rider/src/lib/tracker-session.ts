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
/** A refusal after which this delivery can never be shared again by this rider. */
function closesWindow(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.status === 409 || (err.status === 404 && err.code === 'DELIVERY_NOT_FOUND'))
  );
}

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
      // The server is the authority on the window: 409 (cancelled, not on
      // the road) or 404 DELIVERY_NOT_FOUND (reassigned, never ours) mean
      // stop sharing, not "retry later". Only if it still concerns the
      // delivery being tracked - a late refusal for a previous delivery must
      // not stop its replacement - and through the same queue as every other
      // start/stop so it cannot interleave with one.
      if (closesWindow(err)) {
        await enqueue(async () => {
          if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
        });
        return;
      }
      throw err;
    }
  });
  return tracker;
}

let tracker = createTracker();
let queue: Promise<void> = Promise.resolve();

/** Serializes every start/stop so overlapping callers can never interleave them. A failed task does not block the next. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function getTracker(): DeliveryTracker {
  return tracker;
}

/**
 * Brings the device in line with what is known about ONE delivery: tracking it
 * while it is inside the trackable window. A delivery that is not trackable
 * stops tracking only if it is the one being tracked - looking at some other
 * delivery says nothing about the one on the road. A different trackable id is
 * a new tracking identity: the old one is stopped before the new one starts.
 * Idempotent and serialized; may reject if the plugin throws (callers swallow).
 */
export function syncTracking(delivery: DeliverySummary): Promise<void> {
  return enqueue(() => applyDelivery(delivery));
}

/**
 * For screens that see the whole list (the Queue) and so may say "nothing is
 * trackable anywhere". Call it only after a SUCCESSFUL load. Picks the
 * delivery already being tracked if it is still trackable, otherwise the first
 * trackable one in list order (the API's order); none trackable stops.
 */
export function syncTrackingFromList(deliveries: DeliverySummary[]): Promise<void> {
  return enqueue(async () => {
    const trackable = deliveries.filter(isTrackable);
    const current = tracker.getDeliveryId();
    const target = trackable.find((d) => d.delivery_id === current) ?? trackable[0];
    if (target) await applyDelivery(target);
    else await applyStopAny();
  });
}

/** Stops whatever is being tracked (also retries a native stop that failed). */
export function stopTracking(): Promise<void> {
  return enqueue(applyStopAny);
}

/** Stops tracking only if it is bound to this delivery (e.g. the API says it is no longer ours). */
export function stopTrackingFor(deliveryId: string): Promise<void> {
  return enqueue(async () => {
    if (tracker.getDeliveryId() === deliveryId) await tracker.stop();
  });
}

async function applyDelivery(delivery: DeliverySummary): Promise<void> {
  const current = tracker.getDeliveryId();
  if (isTrackable(delivery)) {
    if (current === delivery.delivery_id) return;
    if (current !== null) await tracker.stop();
    await tracker.start(delivery.delivery_id);
  } else if (current === delivery.delivery_id || (current === null && tracker.hasPendingStop())) {
    await tracker.stop();
  }
}

async function applyStopAny(): Promise<void> {
  if (tracker.getDeliveryId() !== null || tracker.hasPendingStop()) await tracker.stop();
}

/** Test-only: drops the singleton so each test starts with an idle tracker. */
export function __resetTrackerSessionForTests(): void {
  tracker = createTracker();
  queue = Promise.resolve();
}
