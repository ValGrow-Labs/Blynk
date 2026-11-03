import type {
  SmsCampaignKind,
  SmsCampaignStatus,
  SmsFrequency,
  SmsLanguage,
  SmsMessages,
  SmsRecurringSchedule,
  SmsTriggerKind,
  SmsTriggerSchedule,
  SmsWeekday,
} from '../api/types';
import { formatDay } from './coupons';
import { formatClock } from './orders';
import { SMS_LANGUAGES } from './smsOffers';

/**
 * Scheduled and automatic SMS (backend migration 066, 2026-11-03): the drafts staff type, the
 * request bodies built from them, and the words shown for campaigns. All times are Asia/Colombo.
 */

/** "5 Nov 2026 18:00" for an instant, Colombo time. */
export const formatWhen = (iso: string) => `${formatDay(iso)} ${formatClock(iso)}`;

export const KIND_LABEL: Record<SmsCampaignKind, string> = {
  ONCE: 'Scheduled once',
  RECURRING: 'Repeats',
  TRIGGER: 'Automatic',
};

export const STATUS_LABEL: Record<SmsCampaignStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Finished',
};

/** Run statuses the API writes (SENT, BLOCKED_BUDGET, ...), in plain words. */
export function runStatusLabel(status: string): string {
  switch (status) {
    case 'SENT':
      return 'Sent';
    case 'BLOCKED_BUDGET':
      return 'Skipped: monthly budget used up';
    case 'FAILED':
      return 'Failed';
    case 'SKIPPED':
      return 'Skipped';
    default:
      return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
  }
}

// ----------------------------------------------------------------- schedule drafts

export const WEEKDAYS: ReadonlyArray<{ key: SmsWeekday; short: string; long: string }> = [
  { key: 'mon', short: 'Mon', long: 'Monday' },
  { key: 'tue', short: 'Tue', long: 'Tuesday' },
  { key: 'wed', short: 'Wed', long: 'Wednesday' },
  { key: 'thu', short: 'Thu', long: 'Thursday' },
  { key: 'fri', short: 'Fri', long: 'Friday' },
  { key: 'sat', short: 'Sat', long: 'Saturday' },
  { key: 'sun', short: 'Sun', long: 'Sunday' },
];

export const FREQUENCY_LABEL: Record<SmsFrequency, string> = { DAILY: 'Every day', WEEKLY: 'Every week', MONTHLY: 'Every month' };

export interface RecurringDraft {
  frequency: SmsFrequency;
  time: string;
  weekdays: SmsWeekday[];
  month_day: string;
  starts_on: string;
  ends_on: string;
}

export const blankRecurringDraft = (): RecurringDraft => ({
  frequency: 'DAILY',
  time: '09:00',
  weekdays: [],
  month_day: '1',
  starts_on: '',
  ends_on: '',
});

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The RECURRING `schedule` for the API (starts_on / ends_on only when set), or what is wrong. */
export function recurringFromDraft(d: RecurringDraft): { schedule: SmsRecurringSchedule; problem: null } | { schedule: null; problem: string } {
  if (!HH_MM.test(d.time)) return { schedule: null, problem: 'Pick the time to send, like 18:00.' };
  if (d.starts_on && !ISO_DAY.test(d.starts_on)) return { schedule: null, problem: 'Pick a start date.' };
  if (d.ends_on && !ISO_DAY.test(d.ends_on)) return { schedule: null, problem: 'Pick an end date.' };
  if (d.starts_on && d.ends_on && d.ends_on < d.starts_on) return { schedule: null, problem: 'The end date is before the start date.' };
  const schedule: SmsRecurringSchedule = { frequency: d.frequency, time: d.time };
  if (d.frequency === 'WEEKLY') {
    if (!d.weekdays.length) return { schedule: null, problem: 'Choose at least one weekday.' };
    schedule.weekdays = WEEKDAYS.map((w) => w.key).filter((k) => d.weekdays.includes(k));
  }
  if (d.frequency === 'MONTHLY') {
    const day = /^\d+$/.test(d.month_day.trim()) ? Number(d.month_day.trim()) : NaN;
    if (!Number.isInteger(day) || day < 1 || day > 28) return { schedule: null, problem: 'Choose a day of the month from 1 to 28.' };
    schedule.month_day = day;
  }
  if (d.starts_on) schedule.starts_on = d.starts_on;
  if (d.ends_on) schedule.ends_on = d.ends_on;
  return { schedule, problem: null };
}

export function draftFromRecurring(s: SmsRecurringSchedule): RecurringDraft {
  return {
    frequency: s.frequency,
    time: s.time,
    weekdays: s.weekdays ?? [],
    month_day: s.month_day === undefined ? '1' : String(s.month_day),
    starts_on: s.starts_on ?? '',
    ends_on: s.ends_on ?? '',
  };
}

export const TRIGGER_LABEL: Record<SmsTriggerKind, string> = {
  DAYS_AFTER_LAST_ORDER: 'Days after a customer’s last order',
  DAYS_AFTER_SIGNUP: 'Days after a customer signs up',
  NO_ORDER_FOR_DAYS: 'Customer has not ordered for days',
};

export const TRIGGER_HELP: Record<SmsTriggerKind, string> = {
  DAYS_AFTER_LAST_ORDER: 'Each order sends one text, this many days after it was placed.',
  DAYS_AFTER_SIGNUP: 'One text per customer, this many days after they signed up.',
  NO_ORDER_FOR_DAYS: 'Texts customers who have not ordered for this many days, and again after the cooldown.',
};

export interface TriggerDraft {
  trigger: SmsTriggerKind;
  days: string;
  time: string;
  only_if_never_ordered: boolean;
  cooldown_days: string;
}

export const blankTriggerDraft = (): TriggerDraft => ({
  trigger: 'DAYS_AFTER_LAST_ORDER',
  days: '7',
  time: '09:00',
  only_if_never_ordered: false,
  cooldown_days: '30',
});

/** The TRIGGER `schedule` for the API, or what is wrong. */
export function triggerFromDraft(d: TriggerDraft): { schedule: SmsTriggerSchedule; problem: null } | { schedule: null; problem: string } {
  const days = /^\d+$/.test(d.days.trim()) ? Number(d.days.trim()) : NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) return { schedule: null, problem: 'Days must be a whole number from 1 to 365.' };
  if (!HH_MM.test(d.time)) return { schedule: null, problem: 'Pick the time of day to check, like 09:00.' };
  const schedule: SmsTriggerSchedule = { trigger: d.trigger, days, time: d.time };
  if (d.trigger === 'DAYS_AFTER_SIGNUP' && d.only_if_never_ordered) schedule.only_if_never_ordered = true;
  if (d.trigger === 'NO_ORDER_FOR_DAYS') {
    const cooldown = /^\d+$/.test(d.cooldown_days.trim()) ? Number(d.cooldown_days.trim()) : NaN;
    if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 365) {
      return { schedule: null, problem: 'The cooldown must be a whole number of days from 1 to 365.' };
    }
    schedule.cooldown_days = cooldown;
  }
  return { schedule, problem: null };
}

export function draftFromTrigger(s: SmsTriggerSchedule): TriggerDraft {
  return {
    trigger: s.trigger,
    days: String(s.days),
    time: s.time,
    only_if_never_ordered: s.only_if_never_ordered === true,
    cooldown_days: s.cooldown_days === undefined ? '30' : String(s.cooldown_days),
  };
}

/**
 * A `datetime-local` value ("2026-12-01T18:00", read as Asia/Colombo) as the ISO instant with its
 * offset the API takes ("2026-12-01T18:00:00+05:30"), or null when it is not a full date and time.
 */
export function colomboLocalToSendAt(local: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(local);
  if (!m) return null;
  const at = `${m[1]}T${m[2]}:${m[3]}:00+05:30`;
  return Number.isNaN(Date.parse(at)) ? null : at;
}

/** An ISO instant as the `datetime-local` value in Asia/Colombo (UTC+5:30, no daylight saving). */
export function sendAtToColomboLocal(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + 330 * 60_000).toISOString().slice(0, 16);
}

// ----------------------------------------------------------------- texts

/** The messages the API takes: only languages that have text. */
export function messagesOf(texts: Record<SmsLanguage, string>, enabled: readonly SmsLanguage[] = SMS_LANGUAGES): SmsMessages {
  const out: SmsMessages = {};
  for (const lang of SMS_LANGUAGES) {
    if (!enabled.includes(lang)) continue;
    const t = texts[lang].trim();
    if (t) out[lang] = t;
  }
  return out;
}

export const EMPTY_TEXTS: Record<SmsLanguage, string> = { si: '', ta: '', en: '' };

/** A campaign's or template's stored texts (null = not written) as editable texts. */
export function textsFrom(messages: Partial<Record<SmsLanguage, string | null>> | null | undefined): Record<SmsLanguage, string> {
  return { si: messages?.si ?? '', ta: messages?.ta ?? '', en: messages?.en ?? '' };
}

/** Text with `token` put in place of the selection (or at the end when there is none). */
export function insertToken(value: string, token: string, start: number | null, end: number | null): { value: string; caret: number } {
  const from = start ?? value.length;
  const to = end ?? from;
  return { value: value.slice(0, from) + token + value.slice(to), caret: from + token.length };
}
