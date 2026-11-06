import { sql, type RawBuilder } from 'kysely';
import { env } from '../../config/env.js';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { CLOSED_ORDER_STATUSES } from './lifecycle/catalogue.js';
import type { DBConnection } from './order.repository.js';
import { isTestCustomer, noTestCustomersConfigured } from '../configuration/test-customers.js';

/*
 * TEST ORDERS - the Google Play review account (owner's brother, 2026-11-05).
 *
 * Play's reviewers sign in with the review number (REVIEW_LOGIN_PHONE / REVIEW_LOGIN_OTP, set only in
 * Coolify) and must be able to place dummy orders at any time - even with the shop closed, from an
 * address abroad. So for THAT customer only:
 *
 *  - the store-closed check, the delivery-radius check (orders and the address book), the delivery
 *    time rules (lead days, slots) and product hours do not apply;
 *  - the order is cash on delivery only (422 TEST_ORDER_CASH_ONLY for wallet, points or online);
 *  - the order is marked orders.is_test (migration 068) and makes no noise: no staff / seller alerts,
 *    no customer SMS, no rider assignment, no coupon / birthday / referral / points / free-delivery use,
 *    and it is left out of the sales, daily-report and dashboard figures;
 *  - at most 5 open test orders at once and 30 in 24 hours (422 TEST_ORDER_LIMIT);
 *  - a worker sweep (test-orders.job.ts) cancels every still-open test order after 10 minutes, through the
 *    ordinary cancel (lifecycle CUSTOMER_CANCEL as the order's own customer), so stock, history and the
 *    customer's status behave exactly like a normal cancel.
 *
 * The same treatment goes to the Google Play TESTERS (owner's brother, 2026-11-06): numbers staff put on the
 * 'Test customers' list (Admin / Ops, configuration/test-customers.ts) - they sign in with their own numbers and real
 * SMS codes. Every other customer is untouched. Until migration 068 has been run, the review number is treated
 * like any other customer (testOrdersReady).
 */
export const TEST_ORDER_AUTO_CANCEL_MINUTES = 10;
export const MAX_OPEN_TEST_ORDERS = 5;
export const MAX_TEST_ORDERS_PER_DAY = 30;
export const TEST_ORDER_CANCEL_REASON = 'Test order (Play review) - cancelled automatically';
export const TEST_ORDER_CASH_ONLY_MESSAGE = 'Only cash on delivery is available for this account.';

/**
 * Whether this phone is the Google Play review customer: only when REVIEW_LOGIN_PHONE is configured AND
 * the phone is exactly that number. Never true while the setting is empty.
 */
export function isReviewCustomer(phone: string | null | undefined, e: { REVIEW_LOGIN_PHONE: string } = env): boolean {
  return !!e.REVIEW_LOGIN_PHONE && !!phone && phone === e.REVIEW_LOGIN_PHONE;
}

let cached: { ok: boolean; at: number } | null = null;
let override: boolean | null = null;

/** Whether migration 068 (orders.is_test) has been run. A "yes" is kept; a "no" is asked again after a minute. */
export async function testOrdersReady(): Promise<boolean> {
  if (override !== null) return override;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  try {
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'is_test'`.execute(db);
    cached = { ok: (r.rows[0]?.n ?? 0) >= 1, at: Date.now() };
  } catch {
    cached = { ok: false, at: Date.now() };
  }
  return cached.ok;
}

/** Tests only: pretend migration 068 is missing (false) or present (true); null = check the database again. */
export function setTestOrdersReadyForTests(value: boolean | null): void {
  override = value;
  cached = null;
}

/**
 * Whether this customer's orders are test orders right now: they are a test customer (the review number in
 * REVIEW_LOGIN_PHONE, or a number on the staff-editable Play testers list - configuration/test-customers.ts) AND
 * migration 068 exists. The one question every rule asks; false for everybody else - without a user lookup at all
 * while there is no review number and the list is empty.
 */
export async function isTestModeCustomer(customerId: string, executor: DBConnection = db): Promise<boolean> {
  if (await noTestCustomersConfigured(executor)) return false;
  const row = await executor.selectFrom('users').select('phone').where('id', '=', customerId).executeTakeFirst();
  return (await isTestCustomer(row?.phone, executor)) && (await testOrdersReady());
}

/**
 * SQL for "this order is not a test order", for reports. Reads the column as JSON from the row, so it
 * works before migration 068 too (a missing column counts as false), like reports/revenue-sql.ts.
 */
export const notTestOrder = (alias = 'orders'): RawBuilder<boolean> =>
  sql<boolean>`coalesce((to_jsonb(${sql.raw(alias)})->>'is_test')::boolean, false) = false`;

/**
 * Refuses (422 TEST_ORDER_LIMIT) when the customer already has 5 open test orders or placed 30 in the last
 * 24 hours. Called inside the order transaction after the customer's row lock, so racing checkouts cannot
 * pass the cap together.
 */
export async function assertTestOrderCaps(executor: DBConnection, customerId: string, now = new Date()): Promise<void> {
  const row = await sql<{ open: number; day: number }>`
    SELECT count(*) FILTER (WHERE order_status NOT IN (${sql.join([...CLOSED_ORDER_STATUSES])}))::int AS open,
           count(*) FILTER (WHERE placed_at > ${new Date(now.getTime() - 24 * 60 * 60_000)})::int AS day
      FROM orders
     WHERE customer_id = ${customerId} AND is_test`.execute(executor);
  const { open, day } = row.rows[0] ?? { open: 0, day: 0 };
  if (open >= MAX_OPEN_TEST_ORDERS) {
    throw new AppError(
      `This test account can have ${MAX_OPEN_TEST_ORDERS} open test orders at a time. They are cancelled automatically after ${TEST_ORDER_AUTO_CANCEL_MINUTES} minutes.`,
      422,
      'TEST_ORDER_LIMIT',
      { open_test_orders: open, max_open: MAX_OPEN_TEST_ORDERS }
    );
  }
  if (day >= MAX_TEST_ORDERS_PER_DAY) {
    throw new AppError(`This test account can place ${MAX_TEST_ORDERS_PER_DAY} test orders a day. Please try again tomorrow.`, 422, 'TEST_ORDER_LIMIT', {
      test_orders_today: day,
      max_per_day: MAX_TEST_ORDERS_PER_DAY,
    });
  }
}
