import { ApiError } from '../api/client';
import { delivery as deliveryApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { browserGeolocationPlugin } from './geolocation-plugin';
import { isTrackable } from './delivery';
import { DeliveryTracker } from './tracking';

/**
 * The one DeliveryTracker for the Operations app. Ported from
 * apps/rider/src/lib/tracker-session.ts's singleton+serialized-queue design
 * (common.md rule 2: the lifecycle logic, not the Capacitor plugin call -
 * see geolocation-plugin.ts for the actual browser adapter).
 *
 * ONE DELIBERATE DIFFERENCE FROM THE RIDER APP, driven by the foreground-only
 * constraint (common.md rule 10; task-F4-brief.md's Rules section):
 *
 * The Rider app's tracker is an APP-LEVEL session that survives navigating
 * away from its Delivery screen back to its Queue - it can do that because
 * the underlying watcher is a native background service that keeps running
 * whether or not any screen is showing it. Operations has no such native
 * component: a `navigator.geolocation.watchPosition()` call only ever runs
 * inside this one browser tab's JS, so nothing would ever stop it once
 * started if this module tried to keep it alive the same way. The brief is
 * explicit that Operations must stop tracking "on ... navigating away from
 * the Delivery Detail screen" - so, unlike Rider's Delivery.tsx (which
 * comments "Unmounting drops the listener, never the tracking"), Operations'
 * `pages/Delivery/Detail.tsx` calls `stopTrackingFor(id)` in its own
 * unmount cleanup. Only the Detail screen ever calls `syncTracking()` here;
 * there is no Queue-driven `syncTrackingFromList` equivalent, because no
 * other Operations screen is responsible for tracking (mirrors the brief's
 * explicit list of build targets - Queue lists deliveries, only Detail
 * tracks one).
 */
/** A refusal after which this delivery can never be shared again by this operator. */
function closesWindow(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 409 || (err.status === 404 && err.code === 'DELIVERY_NOT_FOUND'));
}

function createTracker(): DeliveryTracker {
  const tracker: DeliveryTracker = new DeliveryTracker(browserGeolocationPlugin, async (deliveryId, point) => {
    try {
      await deliveryApi.sendLocation(deliveryId, {
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy,
        captured_at: point.capturedAt.toISOString(),
      });
    } catch (err) {
      // The server is the authority on the window: 409 (not trackable) or
      // 404 DELIVERY_NOT_FOUND (reassigned, never ours) mean stop sharing,
      // not "retry later". Only if it still concerns the delivery being
      // tracked - a late refusal for a previous delivery must not stop its
      // replacement - and through the same queue as every other start/stop
      // so it cannot interleave with one.
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
 * Brings the device in line with what is known about ONE delivery: tracking
 * it only while it is inside the trackable window (`isTrackable`, mirroring
 * the backend's own check exactly - common.md rule 10's central invariant:
 * never start tracking merely because a screen is open). A delivery that is
 * not trackable stops tracking only if it is the one being tracked. A
 * different trackable id is a new tracking identity: the old one is stopped
 * before the new one starts. Idempotent and serialized; may reject if the
 * plugin throws (callers swallow).
 */
export function syncTracking(delivery: DeliverySummary): Promise<void> {
  return enqueue(() => applyDelivery(delivery));
}

/** Stops whatever is being tracked (also retries a stop that failed natively). */
export function stopTracking(): Promise<void> {
  return enqueue(applyStopAny);
}

/** Stops tracking only if it is bound to this delivery (e.g. the API says it
 * is no longer ours, or the Detail screen for it is being left). */
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
