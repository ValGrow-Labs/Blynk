import { DateTime } from 'luxon';
import { z } from 'zod';
import { DAY_KEYS, STORE_TIMEZONE, toMinutes, type DayKey } from '../../utils/store-hours.js';
import { TRIGGER_KINDS, type TriggerSchedule } from './sms-recipients.js';

/**
 * When campaigns run. All times are Asia/Colombo wall clock (UTC+5:30, no daylight saving), so
 * "18:00" is always 12:30 UTC.
 *
 *   ONCE       { send_at: ISO }
 *   RECURRING  { frequency: 'DAILY'|'WEEKLY'|'MONTHLY', time: 'HH:mm', weekdays?: ['fri', ...] (WEEKLY),
 *                month_day?: 1-28 (MONTHLY), starts_on?: 'YYYY-MM-DD'|null, ends_on?: 'YYYY-MM-DD'|null }
 *   TRIGGER    { trigger, days, time: 'HH:mm', only_if_never_ordered?, cooldown_days? } - checked every day at `time`
 */
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export const FREQUENCIES: readonly Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export interface OnceSchedule {
  send_at: string;
}

export interface RecurringSchedule {
  frequency: Frequency;
  time: string;
  weekdays?: DayKey[];
  month_day?: number;
  starts_on?: string | null;
  ends_on?: string | null;
}

export type CampaignSchedule = OnceSchedule | RecurringSchedule | TriggerSchedule;

export const MAX_SEND_AHEAD_DAYS = 366;

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const hhmm = z.string({ required_error: 'Pick a time', invalid_type_error: 'Use a time like 18:00' }).trim().regex(HH_MM, 'Use a time like 18:00');
const isoDay = z
  .string({ invalid_type_error: 'Use a date like 2026-12-31' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31')
  .refine((s) => DateTime.fromISO(s, { zone: STORE_TIMEZONE }).isValid, 'That date does not exist');

/** An instant with a time zone offset (or Z). */
const instant = z
  .string({ required_error: 'Pick when to send', invalid_type_error: 'Use a date and time' })
  .trim()
  .refine((s) => /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)), 'Use a date and time with its time zone, like 2026-12-01T18:00:00+05:30')
  .transform((s) => new Date(s).toISOString());

export const onceScheduleSchema = z.object({ send_at: instant }).strict();

export const recurringScheduleSchema = z
  .object({
    frequency: z.enum(FREQUENCIES as [Frequency, ...Frequency[]], { errorMap: () => ({ message: 'Choose DAILY, WEEKLY or MONTHLY' }) }),
    time: hhmm,
    weekdays: z
      .array(z.enum(DAY_KEYS, { errorMap: () => ({ message: 'Weekdays are mon, tue, wed, thu, fri, sat, sun' }) }))
      .min(1, 'Choose at least one weekday')
      .max(7)
      .optional(),
    month_day: z.number({ invalid_type_error: 'Month day must be a number' }).int().min(1, 'Choose a day from 1 to 28').max(28, 'Choose a day from 1 to 28').optional(),
    starts_on: isoDay.nullish(),
    ends_on: isoDay.nullish(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.frequency === 'WEEKLY' && !s.weekdays?.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose the weekday(s) to send on' });
    if (s.frequency === 'MONTHLY' && s.month_day === undefined) ctx.addIssue({ code: 'custom', path: ['month_day'], message: 'Choose the day of the month (1-28)' });
    if (s.starts_on && s.ends_on && s.ends_on < s.starts_on) ctx.addIssue({ code: 'custom', path: ['ends_on'], message: 'The end date is before the start date' });
  })
  .transform((s) => ({
    frequency: s.frequency,
    time: s.time,
    ...(s.frequency === 'WEEKLY' ? { weekdays: DAY_KEYS.filter((d) => s.weekdays!.includes(d)) } : {}),
    ...(s.frequency === 'MONTHLY' ? { month_day: s.month_day! } : {}),
    starts_on: s.starts_on ?? null,
    ends_on: s.ends_on ?? null,
  })) as unknown as z.ZodType<RecurringSchedule, z.ZodTypeDef, unknown>;

export const triggerScheduleSchema = z
  .object({
    trigger: z.enum(TRIGGER_KINDS as [string, ...string[]], {
      errorMap: () => ({ message: 'Choose DAYS_AFTER_LAST_ORDER, DAYS_AFTER_SIGNUP or NO_ORDER_FOR_DAYS' }),
    }),
    days: z.number({ required_error: 'Enter the number of days', invalid_type_error: 'Days must be a number' }).int('Days must be a whole number').min(1, 'Days must be from 1 to 365').max(365, 'Days must be from 1 to 365'),
    time: hhmm,
    only_if_never_ordered: z.boolean({ invalid_type_error: 'only_if_never_ordered must be true or false' }).optional(),
    cooldown_days: z.number({ invalid_type_error: 'Cooldown must be a number' }).int().min(1, 'Cooldown must be from 1 to 365 days').max(365, 'Cooldown must be from 1 to 365 days').optional(),
  })
  .strict()
  .transform((s) => {
    const out: TriggerSchedule = { trigger: s.trigger as TriggerSchedule['trigger'], days: s.days, time: s.time };
    if (s.trigger === 'DAYS_AFTER_SIGNUP') out.only_if_never_ordered = s.only_if_never_ordered ?? false;
    if (s.trigger === 'NO_ORDER_FOR_DAYS') out.cooldown_days = s.cooldown_days ?? 30;
    return out;
  });

const local = (d: Date) => DateTime.fromJSDate(d).setZone(STORE_TIMEZONE);

/** The Colombo 'YYYY-MM-DDTHH:mm' of an instant: a run's key. */
export const runKeyOf = (at: Date): string => local(at).toFormat("yyyy-MM-dd'T'HH:mm");

/** The Colombo date of an instant. */
export const dayKeyOfDate = (at: Date): string => local(at).toISODate()!;

/**
 * The first run time strictly after `after` for a DAILY / WEEKLY / MONTHLY schedule, within its
 * starts_on / ends_on days (Colombo dates, both inclusive); null when it has ended. A trigger's
 * daily check is { frequency: 'DAILY', time }.
 */
export function nextOccurrence(
  s: Pick<RecurringSchedule, 'frequency' | 'time' | 'weekdays' | 'month_day' | 'starts_on' | 'ends_on'>,
  after: Date
): Date | null {
  const minutes = toMinutes(s.time) ?? 0;
  const day0 = local(after).startOf('day');
  for (let i = 0; i < 400; i++) {
    const day = day0.plus({ days: i });
    const iso = day.toISODate()!;
    if (s.ends_on && iso > s.ends_on) return null;
    if (s.starts_on && iso < s.starts_on) continue;
    const matches =
      s.frequency === 'DAILY' ||
      (s.frequency === 'WEEKLY' && (s.weekdays ?? []).includes(DAY_KEYS[day.weekday - 1])) ||
      (s.frequency === 'MONTHLY' && day.day === s.month_day);
    if (!matches) continue;
    const at = day.plus({ minutes });
    if (at.toMillis() > after.getTime()) return at.toJSDate();
  }
  return null;
}

export const triggerRunTime = (t: TriggerSchedule, after: Date): Date => nextOccurrence({ frequency: 'DAILY', time: t.time }, after)!;

/** Whether a stored RECURRING schedule has no run left after `after`. */
export const recurringEnded = (s: RecurringSchedule, after: Date): boolean => nextOccurrence(s, after) === null;
