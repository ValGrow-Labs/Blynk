import { z } from 'zod';
import { db } from '../../database/connection.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { DBConnection } from '../orders/order.repository.js';

/**
 * Test customers (Google Play closed-testing testers; owner's brother, 2026-11-06: "for those testers also we need
 * to do the things accordingly"). The 14 testers sign in with THEIR OWN phone numbers (real SMS codes, auth is
 * untouched) and must be able to place test orders at any time, from anywhere. A number on this staff-editable
 * list gets exactly the treatment the single review number (REVIEW_LOGIN_PHONE) gets in orders/test-orders.ts:
 * cash on delivery only, any time, any address, no alerts, auto-cancelled after about 10 minutes, left out of reports.
 *
 * system_configurations 'test_customers' (no migration):  { "phones": ["+94700000001", ...] }   (at most 50)
 *
 * No number is ever hard-coded or seeded: staff paste them in Admin / Ops (Settings > Customers). Each is stored as
 * E.164 Sri Lankan mobile (+947XXXXXXXX). A missing or malformed row reads as an empty list (never throws).
 *
 * GET|PUT /admin/settings/test-customers (ADMIN, OPERATIONS; audited TEST_CUSTOMERS_UPDATED). PUT replaces the whole
 * list. The audit rows hold only the count and the last 3 digits of each number, never a full number.
 *
 * isTestCustomer(phone) is the ONE question the order code asks: the env review number OR a listed number, with a
 * tiny in-process cache (TEST_CUSTOMERS_CACHE_MS) that the PUT clears, so a staff change applies within seconds.
 */
export const TEST_CUSTOMERS_KEY = 'test_customers';
export const MAX_TEST_CUSTOMERS = 50;
/** How long this process remembers the list. A PUT clears it at once (on this process); others catch up within this time. */
export const TEST_CUSTOMERS_CACHE_MS = 20_000;

const SRI_LANKAN_MOBILE = /^\+947\d{8}$/;

/**
 * One typed entry as '+947XXXXXXXX', or null when it is not a Sri Lankan mobile number. Accepts 7XXXXXXXX, 07XXXXXXXX,
 * 947XXXXXXXX and +947XXXXXXXX, with spaces, dashes, dots or brackets anywhere.
 */
export function normaliseTesterPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-.()]/g, '');
  let digits: string;
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+94')) return null;
    digits = compact.slice(3);
  } else if (compact.startsWith('94') && compact.length === 11) {
    digits = compact.slice(2);
  } else if (compact.startsWith('0')) {
    digits = compact.slice(1);
  } else {
    digits = compact;
  }
  const phone = `+94${digits}`;
  return /^\d+$/.test(digits) && SRI_LANKAN_MOBILE.test(phone) ? phone : null;
}

/** The last 3 digits of a number, the only part that is ever written to an audit row. */
const lastThree = (phone: string) => phone.slice(-3);

export interface TestCustomersSetting {
  phones: string[];
}

/** The stored row as a list: anything missing or malformed is an empty list, bad entries are skipped. Never throws. */
export function testCustomersFrom(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  const list = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).phones : null;
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const entry of list) {
    if (typeof entry === 'string' && SRI_LANKAN_MOBILE.test(entry)) out.add(entry);
  }
  return [...out].slice(0, MAX_TEST_CUSTOMERS);
}

/** PUT body: the whole list, as typed. The service reads each entry, so a bad one can be named plainly. */
export const updateTestCustomersSchema = z
  .object({
    phones: z.array(z.string({ invalid_type_error: 'Each number must be text' }).max(40, 'A number is too long'), {
      required_error: 'phones is required',
      invalid_type_error: 'phones must be a list of numbers',
    }).max(500, 'That is far too many numbers'),
  })
  .strict();
export type UpdateTestCustomersInput = z.infer<typeof updateTestCustomersSchema>;

/**
 * The typed entries as a clean list: normalised, de-duplicated, in the order typed. Refuses (400 INVALID_TEST_NUMBERS)
 * with a plain message naming every entry it could not read, and (400 TOO_MANY_TEST_NUMBERS) past 50 numbers.
 * Blank entries are ignored.
 */
export function cleanTesterPhones(entries: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const entry of entries) {
    if (entry.trim() === '') continue;
    const phone = normaliseTesterPhone(entry);
    if (!phone) {
      bad.push(entry.trim());
      continue;
    }
    if (!seen.has(phone)) {
      seen.add(phone);
      out.push(phone);
    }
  }
  if (bad.length > 0) {
    const shown = bad.slice(0, 10).join(', ') + (bad.length > 10 ? `, and ${bad.length - 10} more` : '');
    throw new AppError(
      `These numbers are not Sri Lankan mobile numbers: ${shown}. Use a number like 0771234567 or +94771234567.`,
      400,
      'INVALID_TEST_NUMBERS',
      { invalid_count: bad.length }
    );
  }
  if (out.length > MAX_TEST_CUSTOMERS) {
    throw new AppError(
      `The list can hold at most ${MAX_TEST_CUSTOMERS} numbers (you sent ${out.length}). Remove some and try again.`,
      400,
      'TOO_MANY_TEST_NUMBERS',
      { count: out.length, max: MAX_TEST_CUSTOMERS }
    );
  }
  return out;
}

let cache: { phones: Set<string>; at: number } | null = null;

/** Forget the remembered list (the PUT calls it; tests call it after writing the row directly). */
export function invalidateTestCustomersCache(): void {
  cache = null;
}

/** The list alone, from the cache while it is fresh. A read that fails counts as an empty list for this call. */
export async function readTestCustomers(executor: DBConnection = db): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TEST_CUSTOMERS_CACHE_MS) return cache.phones;
  try {
    const row = await executor.selectFrom('system_configurations').select('value').where('key', '=', TEST_CUSTOMERS_KEY).executeTakeFirst();
    cache = { phones: new Set(testCustomersFrom(row?.value)), at: Date.now() };
    return cache.phones;
  } catch (err) {
    logger.warn({ err }, 'Test customers list could not be read; treating it as empty');
    return new Set();
  }
}

/**
 * Whether this phone is a test customer: the Google Play review number (REVIEW_LOGIN_PHONE, only when configured)
 * OR a number on the staff list. Never true for an empty phone.
 */
export async function isTestCustomer(phone: string | null | undefined, executor: DBConnection = db): Promise<boolean> {
  if (!phone) return false;
  if (env.REVIEW_LOGIN_PHONE && phone === env.REVIEW_LOGIN_PHONE) return true;
  return (await readTestCustomers(executor)).has(phone);
}

/** True when nobody can be a test customer right now (no review number and an empty list): lets callers skip a lookup. */
export async function noTestCustomersConfigured(executor: DBConnection = db): Promise<boolean> {
  return !env.REVIEW_LOGIN_PHONE && (await readTestCustomers(executor)).size === 0;
}

export class TestCustomersService {
  /** The saved list (full numbers - for the signed-in staff screens, which show them masked) and when it was saved. */
  async get(): Promise<{ phones: string[]; count: number; max: number; updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', TEST_CUSTOMERS_KEY)
      .executeTakeFirst();
    const phones = testCustomersFrom(row?.value);
    return { phones, count: phones.length, max: MAX_TEST_CUSTOMERS, updated_at: row?.updated_at ?? null };
  }

  /** Replaces the whole list. Audited (TEST_CUSTOMERS_UPDATED) with counts and last 3 digits only. */
  async set(input: UpdateTestCustomersInput, actor: AuditActor) {
    const next = cleanTesterPhones(input.phones);
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', TEST_CUSTOMERS_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = testCustomersFrom(before?.value);
      const value = JSON.stringify({ phones: next } satisfies TestCustomersSetting);
      await trx
        .insertInto('system_configurations')
        .values({ key: TEST_CUSTOMERS_KEY, value, description: 'Google Play testers whose orders are test orders (cash only, any time, cancelled after 10 minutes)' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'TEST_CUSTOMERS_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: TEST_CUSTOMERS_KEY, count: previous.length, last_digits: previous.map(lastThree) },
        newValues: { key: TEST_CUSTOMERS_KEY, count: next.length, last_digits: next.map(lastThree) },
      });
      logger.info({ previous: previous.length, next: next.length, actorId: actor.actorId }, 'Test customers list changed');
    });
    invalidateTestCustomersCache();
    return this.get();
  }
}

export const testCustomersService = new TestCustomersService();
