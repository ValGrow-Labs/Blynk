import type {
  SmsCampaign,
  SmsCampaignRun,
  SmsCampaignInput,
  SmsCampaignKind,
  SmsCampaignPatch,
  SmsCampaignPreviewInput,
  SmsCampaignStatus,
  SmsFrequency,
  SmsLanguage,
  SmsMessages,
  SmsOnceSchedule,
  SmsRecurringSchedule,
  SmsTemplate,
  SmsTriggerKind,
  SmsTriggerSchedule,
  SmsWeekday,
} from '../api/types';
import { audienceFromState, audienceStateFrom, blankSmsAudience, type SmsAudienceState } from './smsAudience';
import { SMS_LANGUAGES } from './sms';

/**
 * Scheduled and automatic SMS (2026-11-03; backend modules/sms-offers/campaign-schedule.ts). All times
 * are Sri Lanka time (Asia/Colombo, UTC+5:30, no daylight saving). These helpers turn what the
 * operator typed into the request bodies, or say what is wrong.
 */
const COLOMBO_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** The API refuses a send further ahead than this. */
export const MAX_SEND_AHEAD_DAYS = 366;

/** A datetime-local input's value ('2026-12-01T18:30') for an instant, on the Colombo clock. */
export const colomboInputValue = (ms: number): string => new Date(ms + COLOMBO_OFFSET_MS).toISOString().slice(0, 16);

const whenFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Colombo',
});
/** "5 Nov 2026, 18:00" (Sri Lanka time). */
export const formatWhen = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : whenFormat.format(at);
};

/** `send_at` for the API from a datetime-local value (Colombo wall clock), or why it cannot be used. */
export function sendAtFromInput(value: string, now: number = Date.now()): { sendAt: string } | { error: string } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return { error: 'Pick the date and time to send.' };
  const sendAt = `${value}:00+05:30`;
  const at = Date.parse(sendAt);
  if (Number.isNaN(at)) return { error: 'Pick the date and time to send.' };
  if (at <= now) return { error: 'Pick a time in the future.' };
  if (at > now + MAX_SEND_AHEAD_DAYS * DAY_MS) return { error: 'Pick a time within the next year.' };
  return { sendAt };
}

export const WEEKDAYS: ReadonlyArray<{ id: SmsWeekday; label: string; full: string }> = [
  { id: 'mon', label: 'Mon', full: 'Monday' },
  { id: 'tue', label: 'Tue', full: 'Tuesday' },
  { id: 'wed', label: 'Wed', full: 'Wednesday' },
  { id: 'thu', label: 'Thu', full: 'Thursday' },
  { id: 'fri', label: 'Fri', full: 'Friday' },
  { id: 'sat', label: 'Sat', full: 'Saturday' },
  { id: 'sun', label: 'Sun', full: 'Sunday' },
];

export const FREQUENCIES: ReadonlyArray<{ id: SmsFrequency; text: string }> = [
  { id: 'DAILY', text: 'Every day' },
  { id: 'WEEKLY', text: 'Every week' },
  { id: 'MONTHLY', text: 'Every month' },
];

export const TRIGGERS: ReadonlyArray<{ id: SmsTriggerKind; text: string; hint: string }> = [
  {
    id: 'DAYS_AFTER_LAST_ORDER',
    text: 'Days after a customer’s last order',
    hint: 'Texts a customer N days after an order, once for each order.',
  },
  {
    id: 'DAYS_AFTER_SIGNUP',
    text: 'Days after sign-up',
    hint: 'Texts a new customer N days after they made an account, once.',
  },
  {
    id: 'NO_ORDER_FOR_DAYS',
    text: 'No order for N days',
    hint: 'Texts a customer who has not ordered for N days, again after the days you set below at the earliest.',
  },
];

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

export const STATUS_TONE: Record<SmsCampaignStatus, 'ok' | 'warn' | 'muted'> = {
  ACTIVE: 'ok',
  PAUSED: 'warn',
  CANCELLED: 'muted',
  COMPLETED: 'muted',
};

/** A run's status in plain words. */
export const RUN_STATUS_LABEL: Record<string, string> = {
  SENT: 'Sent',
  BLOCKED_BUDGET: 'Skipped: monthly SMS budget used up',
  NO_RECIPIENTS: 'Nobody to text',
  FAILED: 'Failed',
};
export const runStatusText = (status: string) => RUN_STATUS_LABEL[status] ?? status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** "Skipped: 3 turned offers off, 1 already got enough texts" (only what is not zero), or ''. */
export function skippedText(r: Pick<SmsCampaignRun, 'skipped_opted_out' | 'skipped_capped' | 'skipped_no_phone'>): string {
  const bits = [
    r.skipped_opted_out ? `${r.skipped_opted_out} turned offers off` : '',
    r.skipped_capped ? `${r.skipped_capped} already got enough texts` : '',
    r.skipped_no_phone ? `${r.skipped_no_phone} with no phone` : '',
  ].filter(Boolean);
  return bits.length ? `Skipped: ${bits.join(', ')}` : '';
}

/** The words for a row of the history list. */
export const HISTORY_TYPE_LABEL = { OFFER: 'Sent now', CAMPAIGN_RUN: 'Scheduled run' } as const;

// ------------------------------------------------------------------ campaign form
export interface CampaignDraft {
  name: string;
  kind: SmsCampaignKind;
  // RECURRING
  frequency: SmsFrequency;
  weekdays: SmsWeekday[];
  monthDay: string;
  time: string;
  startsOn: string;
  endsOn: string;
  // ONCE (editing one only: new ones are scheduled from the Send tab)
  sendAt: string;
  // TRIGGER
  trigger: SmsTriggerKind;
  days: string;
  onlyIfNeverOrdered: boolean;
  cooldown: string;
  fallback: SmsLanguage;
  texts: Record<SmsLanguage, string>;
  audience: SmsAudienceState;
}

export const EMPTY_TEXTS: Record<SmsLanguage, string> = { si: '', ta: '', en: '' };

export const blankCampaignDraft = (kind: SmsCampaignKind = 'RECURRING'): CampaignDraft => ({
  name: '',
  kind,
  frequency: 'WEEKLY',
  weekdays: [],
  monthDay: '1',
  time: '18:00',
  startsOn: '',
  endsOn: '',
  sendAt: '',
  trigger: 'DAYS_AFTER_LAST_ORDER',
  days: '7',
  onlyIfNeverOrdered: false,
  cooldown: '30',
  fallback: 'en',
  texts: { ...EMPTY_TEXTS },
  audience: blankSmsAudience(),
});

/** The form filled with a saved campaign (editing). */
export function draftFromCampaign(c: SmsCampaign): CampaignDraft {
  const draft: CampaignDraft = {
    ...blankCampaignDraft(c.kind),
    name: c.name,
    fallback: c.fallback_language,
    texts: { si: c.messages.si ?? '', ta: c.messages.ta ?? '', en: c.messages.en ?? '' },
    audience: c.kind === 'TRIGGER' ? blankSmsAudience() : audienceStateFrom(c.audience),
  };
  if (c.kind === 'ONCE') {
    draft.sendAt = colomboInputValue(Date.parse((c.schedule as SmsOnceSchedule).send_at));
  } else if (c.kind === 'RECURRING') {
    const s = c.schedule as SmsRecurringSchedule;
    draft.frequency = s.frequency;
    draft.time = s.time;
    draft.weekdays = s.weekdays ?? [];
    draft.monthDay = String(s.month_day ?? 1);
    draft.startsOn = s.starts_on ?? '';
    draft.endsOn = s.ends_on ?? '';
  } else {
    const s = c.schedule as SmsTriggerSchedule;
    draft.trigger = s.trigger;
    draft.days = String(s.days);
    draft.time = s.time;
    draft.onlyIfNeverOrdered = s.only_if_never_ordered === true;
    draft.cooldown = String(s.cooldown_days ?? 30);
  }
  return draft;
}

/** A saved template's texts over the three boxes (a language the template lacks becomes empty). */
export const textsFromTemplate = (t: SmsTemplate): Record<SmsLanguage, string> => ({
  si: t.messages.si ?? '',
  ta: t.messages.ta ?? '',
  en: t.messages.en ?? '',
});

/** The non-empty texts, trimmed, for the API. */
export function messagesOf(texts: Record<SmsLanguage, string>, only: readonly SmsLanguage[] = SMS_LANGUAGES): SmsMessages {
  const out: SmsMessages = {};
  for (const l of SMS_LANGUAGES) if (only.includes(l) && texts[l].trim()) out[l] = texts[l].trim();
  return out;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function wholeIn(raw: string, label: string, min: number, max: number): { value: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) return { error: `${label} must be a whole number from ${min} to ${max}.` };
  return { value: Number(text) };
}

/** The recurring schedule the form describes. */
export function recurringFromDraft(d: CampaignDraft): { schedule: SmsRecurringSchedule } | { error: string } {
  if (!HH_MM.test(d.time)) return { error: 'Pick the time to send.' };
  const schedule: SmsRecurringSchedule = { frequency: d.frequency, time: d.time };
  if (d.frequency === 'WEEKLY') {
    if (d.weekdays.length === 0) return { error: 'Choose at least one weekday.' };
    schedule.weekdays = WEEKDAYS.map((w) => w.id).filter((id) => d.weekdays.includes(id));
  }
  if (d.frequency === 'MONTHLY') {
    const day = wholeIn(d.monthDay, 'Day of the month', 1, 28);
    if ('error' in day) return day;
    schedule.month_day = day.value;
  }
  if (d.startsOn) {
    if (!DAY.test(d.startsOn)) return { error: 'Use a start date like 2026-12-01.' };
    schedule.starts_on = d.startsOn;
  }
  if (d.endsOn) {
    if (!DAY.test(d.endsOn)) return { error: 'Use an end date like 2026-12-31.' };
    if (d.startsOn && d.endsOn < d.startsOn) return { error: 'The end date is before the start date.' };
    schedule.ends_on = d.endsOn;
  }
  return { schedule };
}

/** The trigger the form describes. */
export function triggerFromDraft(d: CampaignDraft): { schedule: SmsTriggerSchedule } | { error: string } {
  const days = wholeIn(d.days, 'Days', 1, 365);
  if ('error' in days) return days;
  if (!HH_MM.test(d.time)) return { error: 'Pick the time of the daily check.' };
  const schedule: SmsTriggerSchedule = { trigger: d.trigger, days: days.value, time: d.time };
  if (d.trigger === 'DAYS_AFTER_SIGNUP') schedule.only_if_never_ordered = d.onlyIfNeverOrdered;
  if (d.trigger === 'NO_ORDER_FOR_DAYS') {
    const cooldown = wholeIn(d.cooldown, 'Days before texting the same customer again', 1, 365);
    if ('error' in cooldown) return cooldown;
    schedule.cooldown_days = cooldown.value;
  }
  return { schedule };
}

/** `POST /sms-campaigns` for a new RECURRING or TRIGGER campaign, or what is wrong. */
export function createBodyFromDraft(d: CampaignDraft, only?: readonly SmsLanguage[]): { input: SmsCampaignInput } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: 'Give it a name.' };
  const messages = messagesOf(d.texts, only);
  if (d.kind === 'TRIGGER') {
    const s = triggerFromDraft(d);
    if ('error' in s) return s;
    return { input: { kind: 'TRIGGER', name, fallback_language: d.fallback, messages, schedule: s.schedule } };
  }
  const s = recurringFromDraft(d);
  if ('error' in s) return s;
  const a = audienceFromState(d.audience);
  if (!a.target) return { error: a.problem ?? 'Check who it is sent to.' };
  return { input: { kind: 'RECURRING', name, audience: a.target, fallback_language: d.fallback, messages, schedule: s.schedule } };
}

/** `PATCH /sms-campaigns/:id`: every editable part (future runs only), or what is wrong. */
export function patchBodyFromDraft(d: CampaignDraft, only?: readonly SmsLanguage[]): { patch: SmsCampaignPatch } | { error: string } {
  const name = d.name.trim();
  if (!name) return { error: 'Give it a name.' };
  const patch: SmsCampaignPatch = { name, fallback_language: d.fallback, messages: messagesOf(d.texts, only) };
  if (d.kind === 'TRIGGER') {
    const s = triggerFromDraft(d);
    if ('error' in s) return s;
    patch.schedule = s.schedule;
    return { patch };
  }
  const a = audienceFromState(d.audience);
  if (!a.target) return { error: a.problem ?? 'Check who it is sent to.' };
  patch.audience = a.target;
  if (d.kind === 'ONCE') {
    const at = sendAtFromInput(d.sendAt);
    if ('error' in at) return at;
    patch.schedule = { send_at: at.sendAt };
  } else {
    const s = recurringFromDraft(d);
    if ('error' in s) return s;
    patch.schedule = s.schedule;
  }
  return { patch };
}

/** `POST /sms-campaigns/preview` for the form, or null while it is not complete enough to count. */
export function previewBodyFromDraft(d: CampaignDraft, only?: readonly SmsLanguage[]): SmsCampaignPreviewInput | null {
  const messages = messagesOf(d.texts, only);
  if (d.kind === 'TRIGGER') {
    const s = triggerFromDraft(d);
    if ('error' in s) return null;
    return { kind: 'TRIGGER', fallback_language: d.fallback, messages, schedule: s.schedule };
  }
  const a = audienceFromState(d.audience);
  if (!a.target) return null;
  return { kind: d.kind, audience: a.target, fallback_language: d.fallback, messages };
}
