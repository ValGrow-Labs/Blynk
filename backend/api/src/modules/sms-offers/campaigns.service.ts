import { sql, type Transaction } from 'kysely';
import { DateTime } from 'luxon';
import { db } from '../../database/connection.js';
import type { Database, SmsCampaignKind, SmsCampaignStatus, SmsLanguage } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { STORE_TIMEZONE } from '../../utils/store-hours.js';
import { orderingClock } from '../../utils/time.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { audienceFromStored, audienceLabel } from '../notifications/customer-groups.js';
import {
  MAX_SEND_AHEAD_DAYS,
  nextOccurrence,
  onceScheduleSchema,
  recurringScheduleSchema,
  triggerRunTime,
  triggerScheduleSchema,
  dayKeyOfDate,
  type OnceSchedule,
  type RecurringSchedule,
} from './campaign-schedule.js';
import type { CreateCampaignInput, PatchCampaignInput, PreviewCampaignInput } from './campaigns.schema.js';
import { assertTemplateText } from './placeholders.js';
import { languageFor, type OfferAudience, type OfferMessages } from './sms-core.js';
import { buildEstimate, listOffers, type OfferEstimate } from './sms-offers.service.js';
import type { TriggerSchedule } from './sms-recipients.js';

/**
 * SMS campaigns (migration 066; owner's brother, 2026-11-03): an SMS that is sent later or on its
 * own. Contract docs/superpowers/plans/2026-11-03-sms-campaigns.md.
 *
 *   ONCE       sent once at schedule.send_at (also what "Schedule" on the Send form creates)
 *   RECURRING  every day / chosen weekdays / a day of the month at a time; the audience is looked up
 *              again at every run
 *   TRIGGER    checked once a day: N days after a customer's last order, N days after sign-up, or
 *              no order for N days
 *
 * Status ACTIVE (the runner looks at it at next_run_at), PAUSED (nothing runs; resume picks up from
 * the next time), CANCELLED, COMPLETED (a ONCE that ran, a RECURRING past ends_on). Staff can pause,
 * resume, edit (future runs only - runs already done are history) and cancel. The runner is
 * campaigns.runner.ts.
 */

export const CAMPAIGN_KINDS: readonly SmsCampaignKind[] = ['ONCE', 'RECURRING', 'TRIGGER'];
export const CAMPAIGN_STATUSES: readonly SmsCampaignStatus[] = ['ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'];

const invalid = (field: string, message: string) => new AppError(message, 400, 'VALIDATION_ERROR', [{ field, message, rule: 'custom' }]);

const AUDIENCE_LABELS: Record<string, string> = {
  ALL: 'All customers',
  ORDERED_30D: 'Ordered in the last 30 days',
  ORDERED_90D: 'Ordered in the last 90 days',
  NEVER_ORDERED: 'Never ordered',
};

/** A short line for a stored audience. */
export function labelOfAudience(audience: unknown): string {
  if (typeof audience === 'string') return AUDIENCE_LABELS[audience] ?? audience;
  return audienceLabel(audienceFromStored(audience));
}

const TRIGGER_LABELS: Record<TriggerSchedule['trigger'], (t: TriggerSchedule) => string> = {
  DAYS_AFTER_LAST_ORDER: (t) => `${t.days} day${t.days === 1 ? '' : 's'} after a customer's last order`,
  DAYS_AFTER_SIGNUP: (t) => `${t.days} day${t.days === 1 ? '' : 's'} after sign-up${t.only_if_never_ordered ? ', if they have not ordered' : ''}`,
  NO_ORDER_FOR_DAYS: (t) => `No order for ${t.days} days (again after ${t.cooldown_days ?? 30} days at most)`,
};

const WEEKDAY_NAMES: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** "Every Friday at 18:00", "Daily at 09:00", "On the 5th at 10:00", "Checked daily at 09:00: ...". */
export function describeSchedule(kind: SmsCampaignKind, schedule: unknown): string {
  if (kind === 'ONCE') {
    const at = DateTime.fromISO((schedule as OnceSchedule).send_at).setZone(STORE_TIMEZONE);
    return `Once, ${at.toFormat('d LLL yyyy, h:mm a')}`;
  }
  if (kind === 'TRIGGER') {
    const t = schedule as TriggerSchedule;
    return `Checked daily at ${t.time}: ${TRIGGER_LABELS[t.trigger](t)}`;
  }
  const s = schedule as RecurringSchedule;
  if (s.frequency === 'DAILY') return `Daily at ${s.time}`;
  if (s.frequency === 'WEEKLY') return `Every ${(s.weekdays ?? []).map((d) => WEEKDAY_NAMES[d]).join(', ')} at ${s.time}`;
  return `Monthly on day ${s.month_day} at ${s.time}`;
}

interface CampaignRow {
  id: string;
  name: string;
  kind: SmsCampaignKind;
  status: SmsCampaignStatus;
  audience: unknown;
  fallback_language: SmsLanguage;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  schedule: unknown;
  next_run_at: Date | null;
  last_run_at: Date | null;
  run_count: number;
  recipients_total: number;
  parts_total: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  created_by_name?: string | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export interface RunView {
  id: string;
  campaign_id: string;
  scheduled_for: string;
  ran_at: string;
  status: string;
  recipients: number;
  sms_parts: number;
  skipped_opted_out: number;
  skipped_capped: number;
  skipped_no_phone: number;
  reason: string | null;
}

interface RunRow {
  id: string;
  campaign_id: string;
  scheduled_for: Date;
  created_at: Date;
  status: string;
  recipients: number;
  parts: number;
  skipped_opted_out: number;
  skipped_capped: number;
  skipped_no_phone: number;
  reason: string | null;
}

const runView = (r: RunRow): RunView => ({
  id: r.id,
  campaign_id: r.campaign_id,
  scheduled_for: new Date(r.scheduled_for).toISOString(),
  ran_at: new Date(r.created_at).toISOString(),
  status: r.status,
  recipients: r.recipients,
  sms_parts: r.parts,
  skipped_opted_out: r.skipped_opted_out,
  skipped_capped: r.skipped_capped,
  skipped_no_phone: r.skipped_no_phone,
  reason: r.reason,
});

/** The campaign as the API returns it. */
export function campaignView(row: CampaignRow, lastRun: RunRow | null = null) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    audience: row.audience,
    audience_label: row.kind === 'TRIGGER' ? null : labelOfAudience(row.audience),
    fallback_language: row.fallback_language,
    messages: { si: row.message_si, ta: row.message_ta, en: row.message_en },
    schedule: row.schedule,
    schedule_label: describeSchedule(row.kind, row.schedule),
    next_run_at: iso(row.next_run_at),
    last_run_at: iso(row.last_run_at),
    run_count: row.run_count,
    recipients_total: row.recipients_total,
    sms_parts_total: row.parts_total,
    last_run: lastRun ? runView(lastRun) : null,
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

const notFound = () => new AppError('That campaign was not found.', 404, 'CAMPAIGN_NOT_FOUND');

/** Writes the fallback language's text: every customer can always be sent something. */
function assertFallbackText(fallback: SmsLanguage, messages: OfferMessages) {
  const effective = languageFor(null, fallback);
  if (!messages[effective]?.trim()) {
    const names: Record<SmsLanguage, string> = { si: 'Sinhala', ta: 'Tamil', en: 'English' };
    throw new AppError(`Write the ${names[effective]} text: customers who have not picked a language get it.`, 400, 'OFFER_TEXT_MISSING', {
      missing_languages: [effective],
    });
  }
}

const cleanMessages = (m: OfferMessages) => ({
  message_si: m.si?.trim() || null,
  message_ta: m.ta?.trim() || null,
  message_en: m.en?.trim() || null,
});

/** The first run time of a new / resumed campaign (strictly after `now`; a past ONCE runs at once). */
function firstRun(kind: SmsCampaignKind, schedule: unknown, now: Date): Date | null {
  if (kind === 'ONCE') {
    const at = new Date((schedule as OnceSchedule).send_at);
    return at.getTime() > now.getTime() ? at : now;
  }
  if (kind === 'RECURRING') return nextOccurrence(schedule as RecurringSchedule, now);
  return triggerRunTime(schedule as TriggerSchedule, now);
}

function assertSendAt(sendAt: string, now: Date) {
  const at = new Date(sendAt).getTime();
  if (at <= now.getTime()) throw invalid('schedule.send_at', 'Pick a time in the future');
  if (at > now.getTime() + MAX_SEND_AHEAD_DAYS * 86_400_000) throw invalid('schedule.send_at', 'Pick a time within the next year');
}

function assertRecurringWindow(s: RecurringSchedule, now: Date) {
  if (s.ends_on && s.ends_on < dayKeyOfDate(now)) throw invalid('schedule.ends_on', 'The end date is in the past');
  if (!nextOccurrence(s, now)) throw invalid('schedule', 'This schedule has no run left');
}

const campaignSelect = () =>
  db
    .selectFrom('sms_campaigns as c')
    .leftJoin('users as s', 's.id', 'c.created_by')
    .selectAll('c')
    .select('s.full_name as created_by_name');

async function lastRuns(ids: string[]): Promise<Map<string, RunRow>> {
  const out = new Map<string, RunRow>();
  if (!ids.length) return out;
  const rows = await db
    .selectFrom('sms_campaign_runs')
    .selectAll()
    .where('campaign_id', 'in', ids)
    .orderBy('created_at', 'desc')
    .execute();
  for (const r of rows as RunRow[]) if (!out.has(r.campaign_id)) out.set(r.campaign_id, r);
  return out;
}

export async function createCampaign(actor: AuditActor, input: CreateCampaignInput, now: Date = orderingClock.now()) {
  assertTemplateText(input.messages);
  assertFallbackText(input.fallback_language as SmsLanguage, input.messages);
  const audience: OfferAudience = input.kind === 'TRIGGER' ? { group: 'ALL' } : input.audience;
  if (input.kind === 'ONCE') assertSendAt(input.schedule.send_at, now);
  if (input.kind === 'RECURRING') assertRecurringWindow(input.schedule, now);
  const next = firstRun(input.kind, input.schedule, now);

  const row = await db.transaction().execute(async (trx) => {
    const created = await trx
      .insertInto('sms_campaigns')
      .values({
        name: input.name,
        kind: input.kind,
        status: 'ACTIVE',
        audience: JSON.stringify(audience),
        fallback_language: input.fallback_language as SmsLanguage,
        ...cleanMessages(input.messages),
        schedule: JSON.stringify(input.schedule),
        next_run_at: next,
        created_by: actor.actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeAudit(trx, actor, {
      action: 'SMS_CAMPAIGN_CREATED',
      entityType: 'sms_campaign',
      entityId: created.id,
      newValues: { name: input.name, kind: input.kind, audience, schedule: input.schedule, fallback_language: input.fallback_language },
    });
    return created;
  });
  return campaignView(row as unknown as CampaignRow);
}

export async function listCampaigns(opts: { status?: SmsCampaignStatus; kind?: SmsCampaignKind; limit?: number } = {}) {
  let q = campaignSelect();
  if (opts.status) q = q.where('c.status', '=', opts.status);
  if (opts.kind) q = q.where('c.kind', '=', opts.kind);
  // Active first, then paused, then finished; soonest next run first within a status.
  const rows = (await q
    .orderBy(sql`CASE c.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END`)
    .orderBy(sql`c.next_run_at NULLS LAST`)
    .orderBy('c.created_at', 'desc')
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 200))
    .execute()) as unknown as CampaignRow[];
  const runs = await lastRuns(rows.map((r) => r.id));
  return rows.map((r) => campaignView(r, runs.get(r.id) ?? null));
}

export async function getCampaign(id: string, runLimit = 50) {
  const row = (await campaignSelect().where('c.id', '=', id).executeTakeFirst()) as unknown as CampaignRow | undefined;
  if (!row) throw notFound();
  const runs = (await db
    .selectFrom('sms_campaign_runs')
    .selectAll()
    .where('campaign_id', '=', id)
    .orderBy('created_at', 'desc')
    .limit(runLimit)
    .execute()) as RunRow[];
  return { ...campaignView(row, runs[0] ?? null), runs: runs.map(runView) };
}

/** Locks one campaign row for a state change. */
async function lockCampaign(trx: Transaction<Database>, id: string): Promise<CampaignRow> {
  const row = (await trx.selectFrom('sms_campaigns').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()) as CampaignRow | undefined;
  if (!row) throw notFound();
  return row;
}

const finished = (row: CampaignRow) =>
  new AppError(
    row.status === 'CANCELLED' ? 'This campaign was cancelled.' : 'This campaign has finished.',
    409,
    'CAMPAIGN_FINISHED',
    { status: row.status }
  );

export async function patchCampaign(actor: AuditActor, id: string, input: PatchCampaignInput, now: Date = orderingClock.now()) {
  await db.transaction().execute(async (trx) => {
    const row = await lockCampaign(trx, id);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') throw finished(row);
    const update: Record<string, unknown> = { updated_at: new Date() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    // A patch's `messages` is the whole set: a language left out (or blank) is cleared.
    const messages: OfferMessages = input.messages ?? {
      si: row.message_si ?? undefined,
      ta: row.message_ta ?? undefined,
      en: row.message_en ?? undefined,
    };
    const fallback = (input.fallback_language ?? row.fallback_language) as SmsLanguage;
    if (input.messages || input.fallback_language) {
      assertTemplateText(messages);
      assertFallbackText(fallback, messages);
      if (input.messages) {
        Object.assign(update, cleanMessages(messages));
        before.messages = { si: row.message_si, ta: row.message_ta, en: row.message_en };
        after.messages = messages;
      }
      if (input.fallback_language) {
        update.fallback_language = fallback;
        before.fallback_language = row.fallback_language;
        after.fallback_language = fallback;
      }
    }
    if (input.name !== undefined) {
      update.name = input.name;
      before.name = row.name;
      after.name = input.name;
    }
    if (input.audience !== undefined) {
      if (row.kind === 'TRIGGER') throw invalid('audience', 'An automatic campaign picks its own customers');
      update.audience = JSON.stringify(input.audience);
      before.audience = row.audience;
      after.audience = input.audience;
    }
    if (input.schedule !== undefined) {
      let schedule: unknown;
      if (row.kind === 'ONCE') {
        const s = onceScheduleSchema.parse(input.schedule);
        assertSendAt(s.send_at, now);
        schedule = s;
      } else if (row.kind === 'RECURRING') {
        const s = recurringScheduleSchema.parse(input.schedule);
        assertRecurringWindow(s, now);
        schedule = s;
      } else {
        schedule = triggerScheduleSchema.parse(input.schedule);
      }
      update.schedule = JSON.stringify(schedule);
      before.schedule = row.schedule;
      after.schedule = schedule;
      // Future runs follow the new schedule; a paused campaign picks it up when resumed.
      if (row.status === 'ACTIVE') update.next_run_at = firstRun(row.kind, schedule, now);
    }
    await trx.updateTable('sms_campaigns').set(update as never).where('id', '=', id).execute();
    await writeAudit(trx, actor, { action: 'SMS_CAMPAIGN_UPDATED', entityType: 'sms_campaign', entityId: id, oldValues: before, newValues: after });
  });
  return getCampaign(id);
}

export async function pauseCampaign(actor: AuditActor, id: string) {
  await db.transaction().execute(async (trx) => {
    const row = await lockCampaign(trx, id);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') throw finished(row);
    if (row.status !== 'ACTIVE') throw new AppError('This campaign is already paused.', 409, 'CAMPAIGN_NOT_ACTIVE', { status: row.status });
    await trx.updateTable('sms_campaigns').set({ status: 'PAUSED', next_run_at: null, updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, actor, {
      action: 'SMS_CAMPAIGN_PAUSED',
      entityType: 'sms_campaign',
      entityId: id,
      oldValues: { status: 'ACTIVE', next_run_at: iso(row.next_run_at) },
      newValues: { status: 'PAUSED' },
    });
  });
  return getCampaign(id);
}

/**
 * Resume: runs pick up from the next time (a recurring campaign does not catch up the runs missed
 * while paused). A paused ONCE whose time has passed is sent right away.
 */
export async function resumeCampaign(actor: AuditActor, id: string, now: Date = orderingClock.now()) {
  await db.transaction().execute(async (trx) => {
    const row = await lockCampaign(trx, id);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') throw finished(row);
    if (row.status !== 'PAUSED') throw new AppError('This campaign is not paused.', 409, 'CAMPAIGN_NOT_PAUSED', { status: row.status });
    const next = firstRun(row.kind, row.schedule, now);
    if (!next) throw new AppError('This campaign has ended: its end date has passed.', 409, 'CAMPAIGN_ENDED');
    await trx.updateTable('sms_campaigns').set({ status: 'ACTIVE', next_run_at: next, updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, actor, {
      action: 'SMS_CAMPAIGN_RESUMED',
      entityType: 'sms_campaign',
      entityId: id,
      oldValues: { status: 'PAUSED' },
      newValues: { status: 'ACTIVE', next_run_at: next.toISOString() },
    });
  });
  return getCampaign(id);
}

export async function cancelCampaign(actor: AuditActor, id: string) {
  await db.transaction().execute(async (trx) => {
    const row = await lockCampaign(trx, id);
    if (row.status === 'CANCELLED' || row.status === 'COMPLETED') throw finished(row);
    await trx
      .updateTable('sms_campaigns')
      .set({ status: 'CANCELLED', next_run_at: null, cancelled_at: new Date(), updated_at: new Date() })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'SMS_CAMPAIGN_CANCELLED',
      entityType: 'sms_campaign',
      entityId: id,
      oldValues: { status: row.status, next_run_at: iso(row.next_run_at) },
      newValues: { status: 'CANCELLED' },
    });
  });
  return getCampaign(id);
}

/**
 * POST /sms-campaigns/preview: the same numbers as the offer estimate for this audience and texts
 * (recipients, SMS parts, languages, 3 sample texts, budget, whether sending is allowed now). A
 * TRIGGER previews who it would text if it ran today.
 */
export async function previewCampaign(input: PreviewCampaignInput, now: Date = orderingClock.now()): Promise<OfferEstimate & { kind: SmsCampaignKind }> {
  assertTemplateText(input.messages);
  const kind: SmsCampaignKind = input.kind ?? 'ONCE';
  let trigger: TriggerSchedule | undefined;
  if (kind === 'TRIGGER') {
    if (!input.schedule) throw invalid('schedule', 'Choose the trigger to preview');
    trigger = triggerScheduleSchema.parse(input.schedule);
  }
  const estimate = await buildEstimate({
    audience: kind === 'TRIGGER' ? undefined : input.audience,
    trigger,
    fallback_language: input.fallback_language as SmsLanguage,
    messages: input.messages,
    now,
  });
  return { ...estimate, kind };
}

/**
 * GET /sms-campaigns/history: one list, newest first, of offers sent right now (`type: 'OFFER'`)
 * and campaign runs (`type: 'CAMPAIGN_RUN'`).
 */
export async function smsHistory(limit = 50) {
  const n = Math.min(Math.max(limit, 1), 200);
  const offers = await listOffers(n);
  let runs: (RunRow & { campaign_name: string; campaign_kind: SmsCampaignKind })[] = [];
  try {
    runs = (await db
      .selectFrom('sms_campaign_runs as r')
      .innerJoin('sms_campaigns as c', 'c.id', 'r.campaign_id')
      .selectAll('r')
      .select(['c.name as campaign_name', 'c.kind as campaign_kind'])
      .orderBy('r.created_at', 'desc')
      .limit(n)
      .execute()) as never;
  } catch (err) {
    if ((err as { code?: string }).code !== '42P01') throw err; // migration 066 not run yet
  }
  const items = [
    ...offers.map((o) => ({
      type: 'OFFER' as const,
      id: o.id,
      at: new Date(o.created_at).toISOString(),
      name: 'Offer sent now',
      campaign_id: null as string | null,
      campaign_kind: null as SmsCampaignKind | null,
      status: 'SENT',
      recipients: o.recipient_count,
      sms_parts: o.sms_parts_total,
      skipped_opted_out: null as number | null,
      skipped_capped: null as number | null,
      skipped_no_phone: null as number | null,
      reason: null as string | null,
      audience: o.audience_group ?? o.audience,
      audience_label: labelOfAudience(o.audience_group ?? o.audience),
      sent_by_name: o.sent_by_name ?? null,
      messages: { si: o.message_si, ta: o.message_ta, en: o.message_en },
    })),
    ...runs.map((r) => ({
      type: 'CAMPAIGN_RUN' as const,
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      name: r.campaign_name,
      campaign_id: r.campaign_id as string | null,
      campaign_kind: r.campaign_kind as SmsCampaignKind | null,
      status: r.status,
      recipients: r.recipients,
      sms_parts: r.parts,
      skipped_opted_out: r.skipped_opted_out as number | null,
      skipped_capped: r.skipped_capped as number | null,
      skipped_no_phone: r.skipped_no_phone as number | null,
      reason: r.reason,
      audience: null as unknown,
      audience_label: null as string | null,
      sent_by_name: null as string | null,
      messages: null as unknown,
    })),
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, n);
}
