import { DateTime } from 'luxon';
import { z } from 'zod';
import { sql } from 'kysely';
import { AppError } from '../../middleware/error.middleware.js';
import { orderingClock } from '../../utils/time.js';
import {
  DAY_KEYS,
  DEFAULT_WEEKLY_HOURS,
  STORE_TIMEZONE,
  dayKeyOf,
  hhmmLabel,
  smsAllowedAt,
  storeStatusAt,
  toMinutes,
} from '../../utils/store-hours.js';
import { programSettings, num } from '../loyalty/program-settings.js';
import { storeSchedule, type StoredSchedule } from '../configuration/store-schedule.js';
import type { Executor } from './sms-core.js';

/**
 * SMS sending rules (owner's brother, 2026-11-03: "no time limits"; contract
 * docs/superpowers/plans/2026-11-03-sms-campaigns.md). Two system_configurations rows, no migration:
 *
 *   sms_sending  { any_time: true, quiet_hours: { enabled: false, start: '22:00', end: '07:00' } }
 *   sms_limits   { per_customer: { enabled: false, max: 1, days: 7 }, monthly_budget: { enabled: false, parts: 5000 } }
 *
 * Defaults send at any time with no limits, so by default nothing is blocked. `smsSendAllowed` is
 * the one question every sender asks (immediate offers, test SMS, scheduled / automatic campaigns,
 * the birthday text):
 *   - quiet hours on  -> never inside them (Asia/Colombo wall clock, may wrap midnight);
 *   - any_time false  -> also only inside the opening hours, the rule that used to be the only one
 *                        (opening hours; closed weekday = 8 AM - 9 PM; "Send offer/birthday texts on
 *                        closed days" in Opening hours, the old `store_sms` row, still applies here);
 *   - any_time true   -> opening hours and `store_sms` are ignored.
 */
export const SMS_SENDING_KEY = 'sms_sending';
export const SMS_LIMITS_KEY = 'sms_limits';

export interface SmsSendingSetting {
  any_time: boolean;
  quiet_hours: { enabled: boolean; start: string; end: string };
}

export const DEFAULT_SMS_SENDING: SmsSendingSetting = {
  any_time: true,
  quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
};

export interface SmsLimitsSetting {
  per_customer: { enabled: boolean; max: number; days: number };
  monthly_budget: { enabled: boolean; parts: number };
}

export const DEFAULT_SMS_LIMITS: SmsLimitsSetting = {
  per_customer: { enabled: false, max: 1, days: 7 },
  monthly_budget: { enabled: false, parts: 5000 },
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const time = (v: unknown, d: string) => (typeof v === 'string' && HH_MM.test(v) ? v : d);

/** A stored row as a setting; anything missing or malformed reads as its default. */
export function smsSendingFrom(value: unknown): SmsSendingSetting {
  const v = obj(value);
  const q = obj(v.quiet_hours);
  const d = DEFAULT_SMS_SENDING;
  return {
    any_time: bool(v.any_time, d.any_time),
    quiet_hours: {
      enabled: bool(q.enabled, d.quiet_hours.enabled),
      start: time(q.start, d.quiet_hours.start),
      end: time(q.end, d.quiet_hours.end),
    },
  };
}

export function smsLimitsFrom(value: unknown): SmsLimitsSetting {
  const v = obj(value);
  const p = obj(v.per_customer);
  const b = obj(v.monthly_budget);
  const d = DEFAULT_SMS_LIMITS;
  return {
    per_customer: {
      enabled: bool(p.enabled, d.per_customer.enabled),
      max: num(p.max, d.per_customer.max, 1, 100),
      days: num(p.days, d.per_customer.days, 1, 365),
    },
    monthly_budget: {
      enabled: bool(b.enabled, d.monthly_budget.enabled),
      parts: num(b.parts, d.monthly_budget.parts, 1, 10_000_000),
    },
  };
}

const invalid = (field: string, message: string) => new AppError(message, 400, 'VALIDATION_ERROR', [{ field, message, rule: 'custom' }]);

export const smsSendingSettings = programSettings<SmsSendingSetting>({
  key: SMS_SENDING_KEY,
  description: 'SMS sending rules: send at any time, or quiet hours (Asia/Colombo)',
  auditAction: 'SMS_SENDING_UPDATED',
  parse: smsSendingFrom,
  check: (next) => {
    if (next.quiet_hours.enabled && next.quiet_hours.start === next.quiet_hours.end) {
      throw invalid('quiet_hours.end', 'Quiet hours must start and end at different times');
    }
  },
});

export const smsLimitsSettings = programSettings<SmsLimitsSetting>({
  key: SMS_LIMITS_KEY,
  description: 'SMS limits: texts per customer in a period, monthly SMS parts budget',
  auditAction: 'SMS_LIMITS_UPDATED',
  parse: smsLimitsFrom,
});

const hhmm = z.string({ invalid_type_error: 'Use a time like 22:00' }).trim().regex(HH_MM, 'Use a time like 22:00');
const flag = (label: string) => z.boolean({ invalid_type_error: `${label} must be true or false` });

/** PUT /settings/sms-sending: any of the fields; the others keep their stored value. */
export const updateSmsSendingSchema = z
  .object({
    any_time: flag('any_time').optional(),
    quiet_hours: z.object({ enabled: flag('enabled').optional(), start: hhmm.optional(), end: hhmm.optional() }).strict().optional(),
  })
  .strict()
  .refine((v) => v.any_time !== undefined || (v.quiet_hours && Object.keys(v.quiet_hours).length > 0), {
    message: 'Send any_time or quiet_hours',
  });
export type UpdateSmsSendingInput = z.infer<typeof updateSmsSendingSchema>;

const whole = (label: string, min: number, max: number) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be from ${min} to ${max}`)
    .max(max, `${label} must be from ${min} to ${max}`);

/** PUT /settings/sms-limits: any of the fields; the others keep their stored value. */
export const updateSmsLimitsSchema = z
  .object({
    per_customer: z
      .object({ enabled: flag('enabled').optional(), max: whole('Texts per customer', 1, 100).optional(), days: whole('Days', 1, 365).optional() })
      .strict()
      .optional(),
    monthly_budget: z
      .object({ enabled: flag('enabled').optional(), parts: whole('Monthly SMS parts', 1, 10_000_000).optional() })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => (v.per_customer && Object.keys(v.per_customer).length > 0) || (v.monthly_budget && Object.keys(v.monthly_budget).length > 0), {
    message: 'Send per_customer or monthly_budget',
  });
export type UpdateSmsLimitsInput = z.infer<typeof updateSmsLimitsSchema>;

// ---------------------------------------------------------------------------
// Is it allowed now?
// ---------------------------------------------------------------------------

const local = (d: Date) => DateTime.fromJSDate(d).setZone(STORE_TIMEZONE);

/** Inside quiet hours (start inclusive, end exclusive; start > end wraps midnight). */
export function inQuietHours(q: SmsSendingSetting['quiet_hours'], at: Date): boolean {
  if (!q.enabled) return false;
  const l = local(at);
  const m = l.hour * 60 + l.minute;
  const s = toMinutes(q.start)!;
  const e = toMinutes(q.end)!;
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/** The next time the quiet-hours end clock strikes after `at`. */
export function quietHoursEnd(q: SmsSendingSetting['quiet_hours'], at: Date): Date {
  const e = toMinutes(q.end)!;
  const l = local(at);
  let end = l.startOf('day').plus({ minutes: e });
  if (end.toMillis() <= at.getTime()) end = l.startOf('day').plus({ days: 1 }).plus({ minutes: e });
  return end.toJSDate();
}

export type SendDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'QUIET_HOURS' | 'OUTSIDE_SENDING_HOURS';
      message: string;
      details?: Record<string, unknown>;
      /** When sending is next allowed (null when it cannot be worked out). */
      resume_at: Date | null;
    };

/** The first opening of the (old) opening-hours window after `at`. */
function nextWindowStart(schedule: StoredSchedule, at: Date): Date | null {
  const onClosedDays = schedule.sms.sms_on_closed_days;
  if (!onClosedDays) {
    const next = storeStatusAt(schedule, at).next_open_at;
    return next ? new Date(next) : null;
  }
  const day0 = local(at).startOf('day');
  for (let i = 0; i < 9; i++) {
    const day = day0.plus({ days: i });
    const hours = schedule.hours.days[dayKeyOf(day)];
    const w = hours.closed ? DEFAULT_WEEKLY_HOURS.days[DAY_KEYS[0]] : hours;
    const open = day.plus({ minutes: toMinutes(w.open) ?? 480 });
    if (open.toMillis() > at.getTime()) return open.toJSDate();
  }
  return null;
}

/** The opening-hours rule's refusal (the messages Ops and Admin always saw), or null when inside it. */
function openingHoursRefusal(schedule: StoredSchedule, at: Date): SendDecision | null {
  const onClosedDays = schedule.sms.sms_on_closed_days;
  if (smsAllowedAt(schedule, at, onClosedDays)) return null;
  const resume_at = nextWindowStart(schedule, at);
  const day = schedule.hours.days[dayKeyOf(local(at))];
  if (!onClosedDays) {
    const status = storeStatusAt(schedule, at);
    if (status.closed_kind !== 'OUTSIDE_HOURS') {
      const why =
        status.closed_kind === 'CLOSED_NOW'
          ? 'the store is closed now'
          : status.closed_kind === 'HOLIDAY'
            ? 'today is a holiday'
            : 'the store is closed today';
      return {
        allowed: false,
        code: 'OUTSIDE_SENDING_HOURS',
        message: `Offers are not sent while ${why} ("Send offer/birthday texts on closed days" is off in Opening hours).`,
        details: { closed_kind: status.closed_kind },
        resume_at,
      };
    }
  }
  const window = day.closed ? DEFAULT_WEEKLY_HOURS.days[DAY_KEYS[0]] : day;
  return {
    allowed: false,
    code: 'OUTSIDE_SENDING_HOURS',
    message: `Offers can be sent from ${hhmmLabel(window.open)} to ${hhmmLabel(window.close)} only.`,
    resume_at,
  };
}

/**
 * May an SMS be sent at `now`? See the rules at the top. `schedule` is only read when `any_time`
 * is off. When not allowed, `resume_at` is the first time to try again.
 */
export function smsSendAllowed(settings: SmsSendingSetting, now: Date, schedule: StoredSchedule): SendDecision {
  if (inQuietHours(settings.quiet_hours, now)) {
    const q = settings.quiet_hours;
    return {
      allowed: false,
      code: 'QUIET_HOURS',
      message: `SMS are not sent between ${hhmmLabel(q.start)} and ${hhmmLabel(q.end)} (quiet hours in SMS sending rules). Send after ${hhmmLabel(q.end)}, or schedule it.`,
      details: { quiet_hours: q },
      resume_at: quietHoursEnd(q, now),
    };
  }
  if (!settings.any_time) return openingHoursRefusal(schedule, now) ?? { allowed: true };
  return { allowed: true };
}

/**
 * The first moment at or after `from` an SMS may be sent (quiet hours and, with any_time off, the
 * opening hours can follow each other). `from` itself when allowed now; null if none within a week.
 */
export function nextSendTime(settings: SmsSendingSetting, from: Date, schedule: StoredSchedule): Date | null {
  let at = from;
  for (let i = 0; i < 20; i++) {
    const d = smsSendAllowed(settings, at, schedule);
    if (d.allowed) return at;
    if (!d.resume_at || d.resume_at.getTime() <= at.getTime()) return null;
    at = d.resume_at;
  }
  return null;
}

/** The decision for right now, reading the stored settings and opening hours. */
export async function currentSendDecision(now: Date = orderingClock.now()): Promise<SendDecision> {
  const [settings, schedule] = await Promise.all([smsSendingSettings.read(), storeSchedule.read()]);
  return smsSendAllowed(settings, now, schedule);
}

/**
 * Immediate sends (offer, test SMS): refuse with the reason when not allowed now.
 * 422 QUIET_HOURS or 422 OUTSIDE_SENDING_HOURS (only with "any time" switched off).
 */
export async function assertSmsSendAllowed(now: Date = orderingClock.now()): Promise<void> {
  const d = await currentSendDecision(now);
  if (d.allowed) return;
  throw new AppError(d.message, 422, d.code, { ...(d.details ?? {}), resume_at: d.resume_at ? d.resume_at.toISOString() : null });
}

// ---------------------------------------------------------------------------
// Monthly budget
// ---------------------------------------------------------------------------

/** Start of the current Asia/Colombo calendar month. */
export const monthStartOf = (now: Date): Date => local(now).startOf('month').toJSDate();

/** SMS parts queued for offers and campaigns since the start of the (Colombo) month of `now`. */
export async function monthlyPartsUsed(executor: Executor, now: Date): Promise<number> {
  const start = monthStartOf(now);
  const offers = await executor
    .selectFrom('sms_offers')
    .select(sql<string>`coalesce(sum(sms_parts_total), 0)`.as('n'))
    .where('created_at', '>=', start)
    .executeTakeFirst();
  let campaigns = 0;
  try {
    const row = await executor
      .selectFrom('sms_campaign_runs')
      .select(sql<string>`coalesce(sum(parts), 0)`.as('n'))
      .where('status', '=', 'SENT')
      .where('created_at', '>=', start)
      .executeTakeFirst();
    campaigns = Number(row?.n ?? 0);
  } catch (err) {
    // Migration 066 not run yet: no campaign has ever run. (Inside a transaction this would abort it,
    // but then the campaign tables are needed anyway.)
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  return Number(offers?.n ?? 0) + campaigns;
}

export interface BudgetState {
  monthly_parts: number;
  used_parts: number;
  remaining_parts: number;
}

/** null when the monthly budget is off. */
export async function budgetState(executor: Executor, limits: SmsLimitsSetting, now: Date): Promise<BudgetState | null> {
  if (!limits.monthly_budget.enabled) return null;
  const used = await monthlyPartsUsed(executor, now);
  const monthly = limits.monthly_budget.parts;
  return { monthly_parts: monthly, used_parts: used, remaining_parts: Math.max(0, monthly - used) };
}

/** Serialises budget checks with the inserts that spend it (held until the transaction ends). */
export async function lockBudget(executor: Executor): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext('sms-budget'))`.execute(executor);
}
