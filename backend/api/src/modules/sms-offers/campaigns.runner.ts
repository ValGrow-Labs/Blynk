import type { Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database, SmsCampaignKind, SmsCampaignRunStatus, SmsLanguage } from '../../database/types.js';
import { logger } from '../../utils/logger.js';
import { orderingClock } from '../../utils/time.js';
import { storeSchedule } from '../configuration/store-schedule.js';
import {
  dayKeyOfDate,
  nextOccurrence,
  runKeyOf,
  triggerRunTime,
  type RecurringSchedule,
} from './campaign-schedule.js';
import { budgetExceeded } from './sms-offers.service.js';
import {
  budgetState,
  lockBudget,
  nextSendTime,
  smsLimitsSettings,
  smsSendAllowed,
  smsSendingSettings,
} from './sending-rules.js';
import {
  campaignKeyPrefix,
  queueRecipients,
  renderRecipients,
  selectRecipients,
  type TriggerSchedule,
} from './sms-recipients.js';
import type { OfferAudience, OfferMessages } from './sms-core.js';

/**
 * The SMS campaign runner (migration 066; contract docs/superpowers/plans/2026-11-03-sms-campaigns.md).
 * Every 60 seconds each ACTIVE campaign whose next_run_at has come is run, one instance per campaign
 * (claimed with FOR NO KEY UPDATE SKIP LOCKED, the repeat-baskets pattern):
 *
 *   - sending not allowed now (quiet hours; opening hours with "any time" off): the run is DELAYED -
 *     next_run_at moves to the first allowed moment, nothing is dropped and no run row is written;
 *   - otherwise the audience (ONCE / RECURRING) or the trigger's customers are looked up now, opt-outs
 *     and the per-customer cap applied, each text rendered per customer, and one outbox row queued per
 *     customer (notification_type SMS_OFFER, payload.campaign_id) with the key
 *     `sms-campaign:<campaignId>:<runKey>:<userId>` - or, for the DAYS_AFTER_* triggers,
 *     `sms-campaign:<campaignId>:<anchor>:<userId>` (anchor = the order id / 'signup') so a customer is
 *     texted once per anchor, whatever day the check runs;
 *   - the run row (unique per campaign + run key) is written in the same transaction as the outbox rows,
 *     so a crash or a second worker can never queue a customer twice;
 *   - a run that would pass the monthly budget is skipped (BLOCKED_BUDGET) and the campaign goes on
 *     to its next run - a ONCE campaign has no next run, so it is COMPLETED with that run.
 *   - then next_run_at moves on (RECURRING: the next occurrence after now, COMPLETED past ends_on;
 *     TRIGGER: tomorrow's check; ONCE: COMPLETED).
 * A run that throws is written as FAILED and tried again in 10 minutes, at most 3 times per occurrence.
 */
export const CAMPAIGN_RUNNER_INTERVAL_MS = 60_000;
const BATCH = 20;
export const MAX_RUN_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60_000;
const DELAY_FALLBACK_MS = 15 * 60_000;

type Trx = Transaction<Database>;

interface Claimed {
  id: string;
  name: string;
  kind: SmsCampaignKind;
  audience: unknown;
  fallback_language: SmsLanguage;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  schedule: unknown;
  next_run_at: Date;
}

export interface RunCounts {
  sent: number;
  empty: number;
  blocked: number;
  delayed: number;
  failed: number;
}

const runKeyFor = (c: Pick<Claimed, 'kind' | 'next_run_at'>): string =>
  c.kind === 'ONCE' ? 'once' : c.kind === 'TRIGGER' ? dayKeyOfDate(c.next_run_at) : runKeyOf(c.next_run_at);

/** What the campaign becomes after a run (or a give-up) at `now`. */
function advance(c: Pick<Claimed, 'kind' | 'schedule'>, now: Date): { status: 'ACTIVE' | 'COMPLETED'; next_run_at: Date | null } {
  if (c.kind === 'ONCE') return { status: 'COMPLETED', next_run_at: null };
  if (c.kind === 'TRIGGER') return { status: 'ACTIVE', next_run_at: triggerRunTime(c.schedule as TriggerSchedule, now) };
  const next = nextOccurrence(c.schedule as RecurringSchedule, now);
  return next ? { status: 'ACTIVE', next_run_at: next } : { status: 'COMPLETED', next_run_at: null };
}

type Outcome = 'SENT' | 'EMPTY' | 'BLOCKED_BUDGET' | 'DELAYED';

/** One due campaign, inside its claiming transaction. */
async function runCampaign(trx: Trx, c: Claimed, now: Date): Promise<Outcome> {
  const [sending, schedule, limits] = await Promise.all([smsSendingSettings.read(), storeSchedule.read(), smsLimitsSettings.read()]);

  const decision = smsSendAllowed(sending, now, schedule);
  if (!decision.allowed) {
    const resume = nextSendTime(sending, now, schedule) ?? new Date(now.getTime() + DELAY_FALLBACK_MS);
    await trx.updateTable('sms_campaigns').set({ next_run_at: resume, updated_at: new Date() }).where('id', '=', c.id).execute();
    logger.info({ campaignId: c.id, code: decision.code, resumeAt: resume }, 'SMS campaign delayed');
    return 'DELAYED';
  }

  if (limits.monthly_budget.enabled) await lockBudget(trx);
  const runKey = runKeyFor(c);
  const run = await trx
    .insertInto('sms_campaign_runs')
    .values({ campaign_id: c.id, run_key: runKey, scheduled_for: c.next_run_at, status: 'EMPTY' })
    .onConflict((oc) => oc.columns(['campaign_id', 'run_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  const done = advance(c, now);
  if (!run) {
    // This occurrence already ran (a crash after commit cannot leave this, but a changed schedule can repeat a key).
    await trx.updateTable('sms_campaigns').set({ ...done, updated_at: new Date() }).where('id', '=', c.id).execute();
    return 'EMPTY';
  }

  const messages: OfferMessages = { si: c.message_si ?? undefined, ta: c.message_ta ?? undefined, en: c.message_en ?? undefined };
  const trigger = c.kind === 'TRIGGER' ? (c.schedule as TriggerSchedule) : undefined;
  const selection = await selectRecipients(trx, {
    audience: trigger ? undefined : (c.audience as OfferAudience),
    trigger,
    campaignId: c.id,
    limits,
    now,
  });
  const rendered = await renderRecipients(trx, selection.customers, c.fallback_language, messages, now);
  const needed = rendered.reduce((n, r) => n + r.parts, 0);
  const budget = await budgetState(trx, limits, now);

  let status: SmsCampaignRunStatus;
  let reason: string | null = null;
  let recipients = 0;
  let parts = 0;
  if (budget && needed > budget.remaining_parts) {
    status = 'BLOCKED_BUDGET';
    reason = budgetExceeded(needed, budget).message;
  } else {
    const queued = await queueRecipients(trx, rendered, {
      keyOf: (r) =>
        trigger && trigger.trigger !== 'NO_ORDER_FOR_DAYS' && r.anchor
          ? `${campaignKeyPrefix(c.id)}${r.anchor}:${r.id}`
          : `${campaignKeyPrefix(c.id)}${runKey}:${r.id}`,
      payloadOf: (r) => ({ text: r.text, campaign_id: c.id, language: r.language }),
    });
    recipients = queued.length;
    parts = queued.reduce((n, r) => n + r.parts, 0);
    status = recipients > 0 ? 'SENT' : 'EMPTY';
  }

  await trx
    .updateTable('sms_campaign_runs')
    .set({
      status,
      recipients,
      parts,
      skipped_opted_out: selection.opted_out,
      skipped_capped: selection.capped,
      skipped_no_phone: selection.no_phone,
      reason,
    })
    .where('id', '=', run.id)
    .execute();
  await trx
    .updateTable('sms_campaigns')
    .set((eb) => ({
      ...done,
      last_run_at: now,
      run_count: eb('run_count', '+', 1),
      recipients_total: eb('recipients_total', '+', recipients),
      parts_total: eb('parts_total', '+', parts),
      updated_at: new Date(),
    }))
    .where('id', '=', c.id)
    .execute();
  logger.info({ campaignId: c.id, kind: c.kind, runKey, status, recipients, parts }, 'SMS campaign run');
  return status === 'BLOCKED_BUDGET' ? 'BLOCKED_BUDGET' : status === 'SENT' ? 'SENT' : 'EMPTY';
}

/** After a run threw: write FAILED, and try again soon - or give up on this occurrence after MAX_RUN_ATTEMPTS. */
async function recordFailure(c: Claimed, now: Date, err: unknown): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom('sms_campaigns').select(['status', 'next_run_at']).where('id', '=', c.id).forUpdate().executeTakeFirst();
    if (!row || row.status !== 'ACTIVE') return;
    const failed = await trx
      .selectFrom('sms_campaign_runs')
      .select('id')
      .where('campaign_id', '=', c.id)
      .where('scheduled_for', '=', c.next_run_at)
      .where('status', '=', 'FAILED')
      .execute();
    const attempt = failed.length + 1;
    await trx
      .insertInto('sms_campaign_runs')
      .values({
        campaign_id: c.id,
        run_key: `${runKeyFor(c)}:fail:${attempt}`,
        scheduled_for: c.next_run_at,
        status: 'FAILED',
        reason: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      })
      .onConflict((oc) => oc.columns(['campaign_id', 'run_key']).doNothing())
      .execute();
    const next =
      attempt >= MAX_RUN_ATTEMPTS
        ? advance(c, now)
        : { status: 'ACTIVE' as const, next_run_at: new Date(now.getTime() + RETRY_AFTER_MS) };
    await trx.updateTable('sms_campaigns').set({ ...next, last_run_at: now, updated_at: new Date() }).where('id', '=', c.id).execute();
  });
}

/**
 * Runs every due campaign (at most BATCH per call). `campaignIds` limits the run to those campaigns
 * (tests, manual runs). Returns the counts.
 */
export async function runDueCampaigns(opts: { now?: Date; campaignIds?: string[] } = {}): Promise<RunCounts> {
  const counts: RunCounts = { sent: 0, empty: 0, blocked: 0, delayed: 0, failed: 0 };
  const now = opts.now ?? orderingClock.now();
  const seen = new Set<string>();
  for (let i = 0; i < BATCH; i++) {
    let claimed: Claimed | null = null;
    try {
      const outcome = await db.transaction().execute(async (trx) => {
        let q = trx
          .selectFrom('sms_campaigns')
          .selectAll()
          .where('status', '=', 'ACTIVE')
          .where('next_run_at', '<=', now);
        if (opts.campaignIds) q = q.where('id', 'in', opts.campaignIds.length ? opts.campaignIds : ['00000000-0000-0000-0000-000000000000']);
        if (seen.size) q = q.where('id', 'not in', [...seen]);
        const row = (await q.orderBy('next_run_at', 'asc').orderBy('id', 'asc').limit(1).forNoKeyUpdate().skipLocked().executeTakeFirst()) as
          | Claimed
          | undefined;
        if (!row) return null;
        claimed = row;
        return runCampaign(trx, row, now);
      });
      if (!outcome) break;
      seen.add((claimed as unknown as Claimed).id);
      if (outcome === 'SENT') counts.sent++;
      else if (outcome === 'EMPTY') counts.empty++;
      else if (outcome === 'BLOCKED_BUDGET') counts.blocked++;
      else counts.delayed++;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '42P01' || code === '42703') return counts; // migration 066 not run yet
      if (!claimed) throw err;
      const c = claimed as Claimed;
      seen.add(c.id);
      logger.error({ err, campaignId: c.id }, 'SMS campaign run failed');
      counts.failed++;
      try {
        await recordFailure(c, now, err);
      } catch (err2) {
        logger.error({ err: err2, campaignId: c.id }, 'Could not record the SMS campaign failure');
        break;
      }
    }
  }
  return counts;
}

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = runDueCampaigns()
    .catch((err) => {
      logger.error({ err }, 'SMS campaign runner failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

/** Worker tick (worker.ts), every minute - same pattern as the repeat basket job. */
export const smsCampaignJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), CAMPAIGN_RUNNER_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
