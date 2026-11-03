import { sql } from 'kysely';
import { DateTime } from 'luxon';
import type { SmsLanguage } from '../../database/types.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { round2 } from '../loyalty/program-settings.js';
import { expiredUnspent } from '../wallet/wallet.rules.js';
import {
  SMS_LANGUAGES,
  audienceQuery,
  languageFor,
  smsParts,
  smsRecipient,
  withOptOut,
  type Executor,
  type OfferAudience,
  type OfferMessages,
} from './sms-core.js';
import { firstName, renderText, usesPlaceholder, type RenderContext } from './placeholders.js';
import type { SmsLimitsSetting } from './sending-rules.js';

/**
 * Who a send reaches and what each of them is sent (offers, scheduled and automatic campaigns, the
 * preview). Opt-outs always apply; a Sri Lankan mobile is needed; with the per-customer cap on,
 * customers who already got their share of SMS offers in the rolling window are skipped.
 */

export type TriggerKind = 'DAYS_AFTER_LAST_ORDER' | 'DAYS_AFTER_SIGNUP' | 'NO_ORDER_FOR_DAYS';
export const TRIGGER_KINDS: readonly TriggerKind[] = ['DAYS_AFTER_LAST_ORDER', 'DAYS_AFTER_SIGNUP', 'NO_ORDER_FOR_DAYS'];

export interface TriggerSchedule {
  trigger: TriggerKind;
  /** N days (since the last order / sign-up, or without an order). */
  days: number;
  /** Colombo 'HH:mm' the daily check runs. */
  time: string;
  /** DAYS_AFTER_SIGNUP: only customers who have not ordered. */
  only_if_never_ordered?: boolean;
  /** NO_ORDER_FOR_DAYS: at most one text every this many days (default 30). */
  cooldown_days?: number;
}

export const DEFAULT_COOLDOWN_DAYS = 30;
/**
 * A DAYS_AFTER_* trigger matches customers whose anchor is exactly N days back, plus this many
 * days more, so a check that was delayed (quiet hours, budget, worker down) still catches them.
 * The per-anchor key means nobody is texted twice for it.
 */
export const TRIGGER_CATCHUP_DAYS = 2;

export const colomboDate = (d: Date): string => DateTime.fromJSDate(d).setZone(STORE_TIMEZONE).toISODate()!;

export const campaignKeyPrefix = (campaignId: string) => `sms-campaign:${campaignId}:`;

export interface Customer {
  id: string;
  phone: string; // normalised
  sms_language: SmsLanguage | null;
  full_name: string | null;
  /** Triggers: what the text is "about" (an order id, 'signup', 'lapse<date>'): part of the idempotency key. */
  anchor: string | null;
}

export interface Selection {
  customers: Customer[];
  /** Customers in the audience who turned offers off (with a reachable number). */
  opted_out: number;
  /** In the audience, opted in, but no SMS can reach their number. */
  no_phone: number;
  /** Skipped by the per-customer cap. */
  capped: number;
}

export interface SelectSpec {
  audience?: OfferAudience;
  trigger?: TriggerSchedule;
  /** Triggers: the campaign (its prefix finds earlier texts); null in a preview. */
  campaignId?: string | null;
  limits: SmsLimitsSetting;
  now: Date;
}

const lastOrderRow = sql`(SELECT o.placed_at FROM orders o WHERE o.customer_id = u.id ORDER BY o.placed_at DESC, o.id DESC LIMIT 1)`;
const lastOrderId = sql<string>`(SELECT o.id::text FROM orders o WHERE o.customer_id = u.id ORDER BY o.placed_at DESC, o.id DESC LIMIT 1)`;
const colomboDay = (col: ReturnType<typeof sql>) => sql`(timezone('Asia/Colombo', ${col}))::date`;

/** The trigger's customers: the audience query plus the trigger's own condition and its anchor. */
function triggerQuery(executor: Executor, t: TriggerSchedule, campaignId: string | null | undefined, now: Date, optedOut: boolean) {
  const base = audienceQuery(executor, { group: 'ALL' }, optedOut);
  const today = colomboDate(now);
  const nowIso = now.toISOString();
  if (t.trigger === 'NO_ORDER_FOR_DAYS') {
    const cooldown = t.cooldown_days ?? DEFAULT_COOLDOWN_DAYS;
    let q = base
      .select(sql<string>`'lapse' || ${today.replace(/-/g, '')}::text`.as('anchor'))
      .where(sql<boolean>`(${lastOrderRow} IS NOT NULL AND ${lastOrderRow} <= ${nowIso}::timestamptz - make_interval(days => ${t.days}::int))`);
    if (campaignId) {
      const prefix = `${campaignKeyPrefix(campaignId)}%`;
      q = q.where(
        sql<boolean>`NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.idempotency_key LIKE ${prefix}
                                 AND n.created_at >= ${nowIso}::timestamptz - make_interval(days => ${cooldown}::int))`
      );
    }
    return q;
  }
  const lo = t.days;
  const hi = t.days + TRIGGER_CATCHUP_DAYS;
  if (t.trigger === 'DAYS_AFTER_SIGNUP') {
    let q = base
      .select(sql<string>`'signup'`.as('anchor'))
      .where(sql<boolean>`${colomboDay(sql`u.created_at`)} BETWEEN ${today}::date - ${hi}::int AND ${today}::date - ${lo}::int`);
    if (t.only_if_never_ordered) q = q.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id)`);
    if (campaignId) {
      const prefix = `${campaignKeyPrefix(campaignId)}signup:`;
      q = q.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM notifications n WHERE n.idempotency_key = ${prefix}::text || u.id::text)`);
    }
    return q;
  }
  // DAYS_AFTER_LAST_ORDER: once per such order (the key carries the order's id).
  let q = base
    .select(lastOrderId.as('anchor'))
    .where(sql<boolean>`(${lastOrderRow} IS NOT NULL AND ${colomboDay(lastOrderRow)} BETWEEN ${today}::date - ${hi}::int AND ${today}::date - ${lo}::int)`);
  if (campaignId) {
    const prefix = campaignKeyPrefix(campaignId);
    q = q.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM notifications n WHERE n.idempotency_key = ${prefix}::text || ${lastOrderId} || ':' || u.id::text)`);
  }
  return q;
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Users in `ids` who already have `max` or more SMS offers (offers and campaigns, not test texts) in the last `days` days. */
export async function cappedUserIds(executor: Executor, ids: string[], limits: SmsLimitsSetting, now: Date): Promise<Set<string>> {
  const capped = new Set<string>();
  if (!limits.per_customer.enabled || ids.length === 0) return capped;
  const since = new Date(now.getTime() - limits.per_customer.days * 86_400_000);
  for (const part of chunks(ids, 2000)) {
    const rows = await executor
      .selectFrom('notifications')
      .select(['user_id', sql<string>`count(*)`.as('n')])
      .where('notification_type', '=', 'SMS_OFFER')
      .where('user_id', 'in', part)
      .where('created_at', '>=', since)
      .where('idempotency_key', 'not like', 'sms-offer-test:%')
      .groupBy('user_id')
      .execute();
    for (const r of rows) if (r.user_id && Number(r.n) >= limits.per_customer.max) capped.add(r.user_id);
  }
  return capped;
}

/** The customers a send reaches, with what was skipped and why. */
export async function selectRecipients(executor: Executor, spec: SelectSpec): Promise<Selection> {
  const cols = ['u.id', 'u.phone', 'u.sms_language', 'u.full_name'] as const;
  type Row = { id: string; phone: string; sms_language: SmsLanguage | null; full_name: string | null; anchor?: string | null };
  let rows: Row[];
  let optedOutRows: { phone: string }[];
  if (spec.trigger) {
    rows = (await triggerQuery(executor, spec.trigger, spec.campaignId, spec.now, false).select([...cols]).execute()) as Row[];
    optedOutRows = await triggerQuery(executor, spec.trigger, spec.campaignId, spec.now, true).select(['u.phone']).execute();
  } else {
    const audience = spec.audience ?? 'ALL';
    rows = (await audienceQuery(executor, audience).select([...cols]).execute()) as Row[];
    optedOutRows = await audienceQuery(executor, audience, true).select(['u.phone']).execute();
  }
  const opted_out = optedOutRows.filter((r) => smsRecipient(r.phone)).length;

  let no_phone = 0;
  const reachable: Customer[] = [];
  for (const r of rows) {
    const phone = smsRecipient(r.phone);
    if (!phone) {
      no_phone += 1;
      continue;
    }
    reachable.push({ id: r.id, phone, sms_language: r.sms_language, full_name: r.full_name, anchor: r.anchor ?? null });
  }
  const cappedIds = await cappedUserIds(
    executor,
    reachable.map((c) => c.id),
    spec.limits,
    spec.now
  );
  const customers = reachable.filter((c) => !cappedIds.has(c.id));
  return { customers, opted_out, no_phone, capped: reachable.length - customers.length };
}

/** Points held (unexpired lots) and wallet balance for these customers, in a few queries. */
export async function balancesFor(
  executor: Executor,
  ids: string[],
  now: Date,
  need: { points: boolean; wallet: boolean }
): Promise<Map<string, { points: number; wallet: number }>> {
  const out = new Map<string, { points: number; wallet: number }>(ids.map((id) => [id, { points: 0, wallet: 0 }]));
  for (const part of chunks(ids, 2000)) {
    if (need.points) {
      const rows = await executor
        .selectFrom('points_ledger')
        .select(['customer_id', sql<number>`coalesce(sum(remaining), 0)::int`.as('n')])
        .where('customer_id', 'in', part)
        .where('remaining', '>', 0)
        .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
        .groupBy('customer_id')
        .execute();
      for (const r of rows) out.get(r.customer_id)!.points = r.n;
    }
    if (need.wallet) {
      const rows = await executor
        .selectFrom('wallet_entries')
        .select([
          'customer_id',
          sql<string>`coalesce(sum(amount), 0)`.as('sum'),
          sql<string>`coalesce(sum(amount) FILTER (WHERE amount > 0 AND expires_at IS NOT NULL AND expires_at <= ${now}), 0)`.as('expired_credits'),
          sql<string>`coalesce(-sum(amount) FILTER (WHERE amount < 0), 0)`.as('debits'),
        ])
        .where('customer_id', 'in', part)
        .groupBy('customer_id')
        .execute();
      for (const r of rows) {
        out.get(r.customer_id)!.wallet = round2(Math.max(0, round2(Number(r.sum)) - expiredUnspent(round2(Number(r.expired_credits)), round2(Number(r.debits)))));
      }
    }
  }
  return out;
}

/**
 * The text one customer is sent. The estimate refuses a send while a
 * language with recipients has no text, but a customer can change language
 * between that check and the send: then the fallback's text, else any
 * written text, is used; null (skip) only if nothing is written at all.
 */
export function offerTextFor(lang: SmsLanguage, fallback: SmsLanguage, messages: OfferMessages): { lang: SmsLanguage; text: string } | null {
  for (const l of [lang, fallback, ...SMS_LANGUAGES]) {
    const t = messages[l]?.trim();
    if (t) return { lang: l, text: withOptOut(t, l) };
  }
  return null;
}

export interface Recipient extends Customer {
  language: SmsLanguage;
  text: string;
  parts: number;
}

/** Each customer's own language, text (placeholders filled in) and SMS parts. Customers with no text at all are left out. */
export async function renderRecipients(
  executor: Executor,
  customers: Customer[],
  fallback: SmsLanguage,
  messages: OfferMessages,
  now: Date
): Promise<Recipient[]> {
  const joined = SMS_LANGUAGES.map((l) => messages[l] ?? '').join('\n');
  const need = { points: usesPlaceholder(joined, 'points'), wallet: usesPlaceholder(joined, 'wallet') };
  const balances = need.points || need.wallet ? await balancesFor(executor, customers.map((c) => c.id), now, need) : new Map();
  const out: Recipient[] = [];
  for (const c of customers) {
    const picked = offerTextFor(languageFor(c.sms_language, fallback), fallback, messages);
    if (!picked) continue;
    const bal = balances.get(c.id) ?? { points: 0, wallet: 0 };
    const ctx: RenderContext = { name: firstName(c.full_name), points: bal.points, wallet: bal.wallet };
    const text = renderText(picked.text, picked.lang, ctx);
    out.push({ ...c, language: picked.lang, text, parts: smsParts(text) });
  }
  return out;
}

/**
 * Queues one outbox SMS (notification_type SMS_OFFER, so the worker's retries and the delivery view
 * work as for offers) per recipient and returns the ones actually queued: a key that already exists
 * (a crash and retry, a second worker) is skipped, never sent twice.
 */
export async function queueRecipients(
  trx: Executor,
  recipients: Recipient[],
  opts: { keyOf: (r: Recipient) => string; payloadOf: (r: Recipient) => Record<string, unknown> }
): Promise<Recipient[]> {
  const queued: Recipient[] = [];
  const now = new Date();
  for (const part of chunks(recipients, 500)) {
    const byKey = new Map(part.map((r) => [opts.keyOf(r), r]));
    const rows = part.map((r) => ({
      user_id: r.id,
      order_id: null,
      idempotency_key: opts.keyOf(r),
      channel: 'SMS' as const,
      notification_type: 'SMS_OFFER',
      recipient: r.phone,
      payload: JSON.stringify(opts.payloadOf(r)),
      status: 'QUEUED' as const,
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: now,
      created_at: now,
      updated_at: now,
    }));
    const inserted = await trx
      .insertInto('notifications')
      .values(rows as never)
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returning('idempotency_key')
      .execute();
    for (const row of inserted) {
      const r = row.idempotency_key ? byKey.get(row.idempotency_key) : undefined;
      if (r) queued.push(r);
    }
  }
  return queued;
}
