import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit } from '../audit/audit.writer.js';
import { CATALOGUE } from './lifecycle/catalogue.js';
import { runTransition } from './lifecycle/engine.js';
import {
  TEST_ORDER_AUTO_CANCEL_MINUTES,
  TEST_ORDER_CANCEL_REASON,
  testOrdersReady,
} from './test-orders.js';

/*
 * The test-order sweep (migration 068; see test-orders.ts): a worker tick that cancels every still-open
 * test order after TEST_ORDER_AUTO_CANCEL_MINUTES, through the ordinary cancel.
 */
export const TEST_ORDER_SWEEP_INTERVAL_MS = 60_000;

/** Cancel codes that mean "someone else already dealt with it" - not an error for the sweep. */
const ALREADY_DONE = new Set(['ORDER_ALREADY_CANCELLED', 'ORDER_CANNOT_BE_CANCELLED', 'ORDER_ALREADY_OUT_FOR_DELIVERY', 'ORDER_NOT_FOUND']);

/** Cancels one test order through the ordinary cancel; false when it was no longer open. */
export async function cancelTestOrder(orderId: string, customerId: string, orderNumber: string): Promise<boolean> {
  try {
    await runTransition('CUSTOMER_CANCEL', {
      actor: { id: customerId, role: 'CUSTOMER' },
      orderId,
      input: { reason: TEST_ORDER_CANCEL_REASON },
    });
  } catch (err) {
    if (err instanceof AppError && ALREADY_DONE.has(err.code ?? '')) return false;
    throw err;
  }
  try {
    await writeAudit(
      db,
      { actorId: customerId },
      {
        action: 'TEST_ORDER_AUTO_CANCELLED',
        entityType: 'order',
        entityId: orderId,
        oldValues: null,
        newValues: { order_number: orderNumber, reason: TEST_ORDER_CANCEL_REASON, after_minutes: TEST_ORDER_AUTO_CANCEL_MINUTES },
      }
    );
  } catch (err) {
    logger.warn({ err, orderId }, 'Test order cancelled, but its audit row could not be written');
  }
  return true;
}

/**
 * The sweep: every still-open test order placed 10 minutes ago or more is cancelled. Idempotent and safe
 * beside a second worker - each cancel re-checks the order under its row lock (lifecycle engine), so the
 * loser finds it CANCELLED and skips it. Returns how many this call cancelled.
 */
export async function cancelDueTestOrders(now = new Date(), limit = 50): Promise<number> {
  if (!(await testOrdersReady())) return 0;
  const cutoff = new Date(now.getTime() - TEST_ORDER_AUTO_CANCEL_MINUTES * 60_000);
  const due = await db
    .selectFrom('orders')
    .select(['id', 'customer_id', 'order_number'])
    .where('is_test', '=', true)
    .where('order_status', 'in', CATALOGUE.CUSTOMER_CANCEL.from)
    .where('placed_at', '<=', cutoff)
    .orderBy('placed_at', 'asc')
    .limit(limit)
    .execute();
  let cancelled = 0;
  for (const o of due) {
    try {
      if (await cancelTestOrder(o.id, o.customer_id, o.order_number)) cancelled++;
    } catch (err) {
      logger.error({ err, orderId: o.id }, 'Could not cancel a test order; it is tried again next minute');
    }
  }
  if (cancelled) logger.info({ cancelled }, 'Cancelled test orders');
  return cancelled;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = cancelDueTestOrders()
    .catch((err) => {
      // Before migration 068 is applied the column does not exist yet.
      if ((err as { code?: string }).code === '42703') return;
      logger.error({ err }, 'Test order sweep failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (migration 068): every minute, cancels test orders older than 10 minutes. */
export const testOrderJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), TEST_ORDER_SWEEP_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
