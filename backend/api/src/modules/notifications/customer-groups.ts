import { revenueOf } from '../reports/revenue-sql.js';
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';

/**
 * Customer groups for offers (owner, 2026-10-24: "push / SMS only to people who haven't ordered in
 * 14 days, new customers, big spenders"). Used by push broadcasts (push/broadcast.ts) and SMS offers
 * (sms-offers/). No migration: every group is a condition over users and orders.
 *
 *   ALL            every active customer (the old behaviour; a missing `audience` means this)
 *   LAPSED         has at least one DELIVERED order, and no order placed in the last `days` (7-90, default 14)
 *   NEW            account created in the last `days` (1-60, default 14)
 *   BIG_SPENDERS   DELIVERED orders placed in the last `days` (30-365, default 90) total >= `min_spend_lkr`
 *                  (default 5000). Spend = total_amount + wallet_amount_used, as in Admin's customer list.
 *   NEVER_ORDERED  signed up, never placed an order
 *   CUSTOM         (owner's brother, 2026-11-03) staff-built filters, all optional and AND-ed - see CustomFilters
 *
 * "Placed" is orders.placed_at, any status (an order that was cancelled was still placed). The caller
 * keeps its own channel rules: active CUSTOMER accounts only, push needs a device, SMS needs a real
 * phone and the opt-out / sending-hours rules.
 */
export const CUSTOMER_GROUPS = ['ALL', 'LAPSED', 'NEW', 'BIG_SPENDERS', 'NEVER_ORDERED', 'CUSTOM'] as const;
export type CustomerGroup = (typeof CUSTOMER_GROUPS)[number];

export const GROUP_LIMITS = {
  LAPSED: { min: 7, max: 90, default: 14 },
  NEW: { min: 1, max: 60, default: 14 },
  BIG_SPENDERS: { min: 30, max: 365, default: 90 },
  MIN_SPEND: { min: 1, max: 10_000_000, default: 5000 },
} as const;

/**
 * The CUSTOM group's filters (all optional; a customer must match every one that is given):
 *  areas              customer has a (not deleted) delivery address whose town/city is one of these (case-insensitive)
 *  min_orders / max_orders   DELIVERED orders, all time (max_orders 0 = never had one delivered)
 *  min_spend_lkr      spend (as BIG_SPENDERS) on DELIVERED orders placed in the last `spend_days` (1-365, default 90)
 *  language           the customer's SMS language: si / ta / en, or 'none' = never picked one
 *  min_points / max_points   Blynk Points held now (unexpired lots)
 *  last_order_days_min / last_order_days_max   days since the customer's latest PLACED order (min: at least that
 *                     long ago, max: at most). A customer with no order at all never matches either of these.
 */
export interface CustomFilters {
  areas?: string[];
  min_orders?: number;
  max_orders?: number;
  min_spend_lkr?: number;
  spend_days?: number;
  language?: 'si' | 'ta' | 'en' | 'none';
  min_points?: number;
  max_points?: number;
  last_order_days_min?: number;
  last_order_days_max?: number;
}

export type CustomerAudience =
  | { group: 'ALL' }
  | { group: 'LAPSED'; days: number }
  | { group: 'NEW'; days: number }
  | { group: 'BIG_SPENDERS'; days: number; min_spend_lkr: number }
  | { group: 'NEVER_ORDERED' }
  | ({ group: 'CUSTOM' } & CustomFilters);

export const ALL_CUSTOMERS: CustomerAudience = { group: 'ALL' };

/** '' (an empty query-string field) counts as not given. */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const days = (limits: { min: number; max: number; default: number }) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: 'Days must be a number' })
      .int('Days must be a whole number')
      .min(limits.min, `Days must be from ${limits.min} to ${limits.max}`)
      .max(limits.max, `Days must be from ${limits.min} to ${limits.max}`)
      .default(limits.default)
  );

const minSpend = z.preprocess(
  blankToUndefined,
  z.coerce
    .number({ invalid_type_error: 'The minimum spend must be a number' })
    .min(GROUP_LIMITS.MIN_SPEND.min, 'The minimum spend must be at least LKR 1')
    .max(GROUP_LIMITS.MIN_SPEND.max, 'The minimum spend is too large')
    .default(GROUP_LIMITS.MIN_SPEND.default)
);

const optInt = (label: string, min: number, max: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: `${label} must be a number` })
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be from ${min} to ${max}`)
      .max(max, `${label} must be from ${min} to ${max}`)
      .optional()
  );

const customShape = z.object({
  group: z.literal('CUSTOM'),
  areas: z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.array(z.string().trim().min(1, 'An area name cannot be empty').max(80, 'An area name is too long')).max(50, 'At most 50 areas').optional()
  ),
  min_orders: optInt('Minimum orders', 0, 100_000),
  max_orders: optInt('Maximum orders', 0, 100_000),
  min_spend_lkr: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ invalid_type_error: 'The minimum spend must be a number' })
      .min(0, 'The minimum spend cannot be negative')
      .max(GROUP_LIMITS.MIN_SPEND.max, 'The minimum spend is too large')
      .optional()
  ),
  spend_days: optInt('Spend days', 1, 365),
  language: z.preprocess(
    blankToUndefined,
    z.enum(['si', 'ta', 'en', 'none'], { errorMap: () => ({ message: 'Language must be si, ta, en or none' }) }).optional()
  ),
  min_points: optInt('Minimum points', 0, 10_000_000),
  max_points: optInt('Maximum points', 0, 10_000_000),
  last_order_days_min: optInt('Last order (at least days ago)', 0, 3650),
  last_order_days_max: optInt('Last order (at most days ago)', 0, 3650),
});

const RANGES = [
  ['min_orders', 'max_orders', 'Minimum orders cannot be more than the maximum'],
  ['min_points', 'max_points', 'Minimum points cannot be more than the maximum'],
  ['last_order_days_min', 'last_order_days_max', 'Last order: "at least" days cannot be more than "at most" days'],
] as const;

/** The CUSTOM filters with the empty ones dropped, and spend_days defaulted (90) when a spend is set. */
function cleanCustom(a: z.infer<typeof customShape>): CustomerAudience {
  const out: Record<string, unknown> = { group: 'CUSTOM' };
  const areas = a.areas ? [...new Set(a.areas.map((x) => x.trim()).filter(Boolean))] : [];
  if (areas.length) out.areas = areas;
  for (const k of ['min_orders', 'max_orders', 'min_spend_lkr', 'language', 'min_points', 'max_points', 'last_order_days_min', 'last_order_days_max'] as const) {
    if (a[k] !== undefined) out[k] = a[k];
  }
  if (a.min_spend_lkr !== undefined) out.spend_days = a.spend_days ?? 90;
  return out as CustomerAudience;
}

/** `audience` in a request body. Unknown extra fields (a days on ALL) are dropped. */
export const customerAudienceSchema: z.ZodType<CustomerAudience, z.ZodTypeDef, unknown> = z.discriminatedUnion(
  'group',
  [
    z.object({ group: z.literal('ALL') }),
    z.object({ group: z.literal('LAPSED'), days: days(GROUP_LIMITS.LAPSED) }),
    z.object({ group: z.literal('NEW'), days: days(GROUP_LIMITS.NEW) }),
    z.object({ group: z.literal('BIG_SPENDERS'), days: days(GROUP_LIMITS.BIG_SPENDERS), min_spend_lkr: minSpend }),
    z.object({ group: z.literal('NEVER_ORDERED') }),
    customShape,
  ],
  { errorMap: () => ({ message: `The group must be one of ${CUSTOMER_GROUPS.join(', ')}` }) }
)
  .superRefine((a, ctx) => {
    if (a.group !== 'CUSTOM') return;
    for (const [lo, hi, message] of RANGES) {
      const l = a[lo];
      const h = a[hi];
      if (l !== undefined && h !== undefined && l > h) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [lo] });
    }
  })
  .transform((a) => (a.group === 'CUSTOM' ? cleanCustom(a) : a)) as never;

/**
 * The audience preview's query string (`?group=&days=&min_spend_lkr=`). No group = ALL. Throws a
 * ZodError (400 VALIDATION_ERROR) for a bad group or an out-of-range number.
 */
export function parseAudienceQuery(query: Record<string, unknown>): CustomerAudience {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const group = one(query.group);
  if (group === undefined || group === '') return ALL_CUSTOMERS;
  return customerAudienceSchema.parse({
    group: typeof group === 'string' ? group.trim().toUpperCase() : group,
    days: one(query.days),
    min_spend_lkr: one(query.min_spend_lkr),
  });
}

/**
 * The group as a SQL condition on the customer row aliased `u` (users as u). ALL is `true`, so a
 * query with it is exactly the one before groups existed.
 */
export function audienceCondition(audience: CustomerAudience): RawBuilder<boolean> {
  switch (audience.group) {
    case 'LAPSED':
      return sql<boolean>`(EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id
                        AND o.placed_at >= now() - make_interval(days => ${audience.days}::int)))`;
    case 'NEW':
      return sql<boolean>`(u.created_at >= now() - make_interval(days => ${audience.days}::int))`;
    case 'BIG_SPENDERS':
      return sql<boolean>`((SELECT coalesce(sum(${revenueOf('o')}), 0) FROM orders o
                             WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED'
                               AND o.placed_at >= now() - make_interval(days => ${audience.days}::int))
                           >= ${audience.min_spend_lkr}::numeric)`;
    case 'NEVER_ORDERED':
      return sql<boolean>`(NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id))`;
    case 'CUSTOM':
      return customCondition(audience);
    case 'ALL':
    default:
      return sql<boolean>`true`;
  }
}

/** Blynk Points held now: unexpired lots (as loyalty/points.service.ts pointsBalance), for the user aliased `u`. */
const pointsHeldSql = () =>
  sql<number>`(SELECT coalesce(sum(pl.remaining), 0)::int FROM points_ledger pl
                WHERE pl.customer_id = u.id AND pl.remaining > 0 AND (pl.expires_at IS NULL OR pl.expires_at > now()))`;

/** The CUSTOM filters, AND-ed, as one condition on the customer row aliased `u`. */
function customCondition(f: CustomFilters): RawBuilder<boolean> {
  const parts: RawBuilder<boolean>[] = [];
  if (f.areas?.length) {
    const areas = f.areas.map((a) => a.trim().toLowerCase());
    parts.push(
      sql<boolean>`EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.user_id = u.id AND ca.is_deleted = false
                           AND lower(trim(ca.city)) = ANY(${areas}::text[]))`
    );
  }
  const delivered = sql`(SELECT count(*) FROM orders o WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED')`;
  if (f.min_orders !== undefined) parts.push(sql<boolean>`(${delivered} >= ${f.min_orders}::int)`);
  if (f.max_orders !== undefined) parts.push(sql<boolean>`(${delivered} <= ${f.max_orders}::int)`);
  if (f.min_spend_lkr !== undefined) {
    parts.push(
      sql<boolean>`((SELECT coalesce(sum(${revenueOf('o')}), 0) FROM orders o
                      WHERE o.customer_id = u.id AND o.order_status = 'DELIVERED'
                        AND o.placed_at >= now() - make_interval(days => ${f.spend_days ?? 90}::int))
                    >= ${f.min_spend_lkr}::numeric)`
    );
  }
  if (f.language === 'none') parts.push(sql<boolean>`(u.sms_language IS NULL)`);
  else if (f.language) parts.push(sql<boolean>`(u.sms_language = ${f.language})`);
  if (f.min_points !== undefined) parts.push(sql<boolean>`(${pointsHeldSql()} >= ${f.min_points}::int)`);
  if (f.max_points !== undefined) parts.push(sql<boolean>`(${pointsHeldSql()} <= ${f.max_points}::int)`);
  const lastOrder = sql`(SELECT max(o.placed_at) FROM orders o WHERE o.customer_id = u.id)`;
  if (f.last_order_days_min !== undefined) {
    parts.push(sql<boolean>`(${lastOrder} IS NOT NULL AND ${lastOrder} <= now() - make_interval(days => ${f.last_order_days_min}::int))`);
  }
  if (f.last_order_days_max !== undefined) {
    parts.push(sql<boolean>`(${lastOrder} IS NOT NULL AND ${lastOrder} >= now() - make_interval(days => ${f.last_order_days_max}::int))`);
  }
  if (!parts.length) return sql<boolean>`true`;
  return sql<boolean>`(${sql.join(parts, sql` AND `)})`;
}

/** A short line for logs and lists: "Haven't ordered in 14 days". */
export function audienceLabel(audience: CustomerAudience): string {
  switch (audience.group) {
    case 'LAPSED':
      return `Haven't ordered in ${audience.days} days`;
    case 'NEW':
      return `Joined in the last ${audience.days} days`;
    case 'BIG_SPENDERS':
      return `Spent LKR ${audience.min_spend_lkr} or more in ${audience.days} days`;
    case 'NEVER_ORDERED':
      return 'Never ordered';
    case 'CUSTOM':
      return customLabel(audience);
    default:
      return 'All customers';
  }
}

function customLabel(f: CustomFilters): string {
  const range = (lo?: number, hi?: number) => `${lo ?? 0}${hi !== undefined ? `-${hi}` : '+'}`;
  const bits: string[] = [];
  if (f.areas?.length) bits.push(`in ${f.areas.join(', ')}`);
  if (f.min_orders !== undefined || f.max_orders !== undefined) bits.push(`${range(f.min_orders, f.max_orders)} delivered orders`);
  if (f.min_spend_lkr !== undefined) bits.push(`spent LKR ${f.min_spend_lkr}+ in ${f.spend_days ?? 90} days`);
  if (f.language) bits.push(f.language === 'none' ? 'no SMS language' : `SMS language ${f.language}`);
  if (f.min_points !== undefined || f.max_points !== undefined) bits.push(`${range(f.min_points, f.max_points)} points`);
  if (f.last_order_days_min !== undefined || f.last_order_days_max !== undefined) {
    bits.push(`last order ${range(f.last_order_days_min, f.last_order_days_max)} days ago`);
  }
  return bits.length ? `Custom: ${bits.join('; ')}` : 'Custom: all customers';
}

/** An audience read back from an audit row; anything unreadable (older rows) = ALL. */
export function audienceFromStored(value: unknown): CustomerAudience {
  const r = customerAudienceSchema.safeParse(value);
  return r.success ? r.data : ALL_CUSTOMERS;
}
