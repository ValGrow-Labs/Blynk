import type { SmsCustomAudience, SmsLanguage, SmsOfferTarget } from '../api/types';
import { audienceFromDraft, blankAudienceDraft, type AudienceDraft } from './customerGroups';

/**
 * "Send to" for SMS offers and campaigns: one of the customer groups, the two older choices
 * (ordered in the last 30 / 90 days) or the CUSTOM filters (2026-11-03; backend
 * notifications/customer-groups.ts). Everything the operator typed is kept as typed; this builds
 * the `audience` the API takes, or the problem that stops it.
 */
export type SmsExtraAudience = 'ORDERED_30D' | 'ORDERED_90D' | 'CUSTOM';

export interface CustomDraft {
  /** Town names picked from the areas list. */
  areas: string[];
  minOrders: string;
  maxOrders: string;
  minSpend: string;
  spendDays: string;
  language: '' | SmsLanguage | 'none';
  minPoints: string;
  maxPoints: string;
  lastOrderMin: string;
  lastOrderMax: string;
}

export interface SmsAudienceState {
  draft: AudienceDraft;
  extra: SmsExtraAudience | null;
  custom: CustomDraft;
}

export const DEFAULT_SPEND_DAYS = '90';

export const blankCustomDraft = (): CustomDraft => ({
  areas: [],
  minOrders: '',
  maxOrders: '',
  minSpend: '',
  spendDays: DEFAULT_SPEND_DAYS,
  language: '',
  minPoints: '',
  maxPoints: '',
  lastOrderMin: '',
  lastOrderMax: '',
});

export const blankSmsAudience = (): SmsAudienceState => ({ draft: blankAudienceDraft(), extra: null, custom: blankCustomDraft() });

type Parsed = { value: number | undefined } | { error: string };

function wholeNumber(raw: string, label: string, min: number, max: number): Parsed {
  const text = raw.trim();
  if (!text) return { value: undefined };
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
    return { error: `${label} must be a whole number from ${min} to ${max}.` };
  }
  return { value: Number(text) };
}

/** The CUSTOM audience (empty filters left out), or the first thing wrong. */
export function customAudienceFromDraft(c: CustomDraft): { audience: SmsCustomAudience; problem: null } | { audience: null; problem: string } {
  const fields = {
    min_orders: wholeNumber(c.minOrders, 'Minimum orders', 0, 100_000),
    max_orders: wholeNumber(c.maxOrders, 'Maximum orders', 0, 100_000),
    min_spend_lkr: wholeNumber(c.minSpend, 'Minimum spend', 0, 10_000_000),
    spend_days: wholeNumber(c.spendDays, 'Spend days', 1, 365),
    min_points: wholeNumber(c.minPoints, 'Minimum points', 0, 10_000_000),
    max_points: wholeNumber(c.maxPoints, 'Maximum points', 0, 10_000_000),
    last_order_days_min: wholeNumber(c.lastOrderMin, 'Last order (at least days ago)', 0, 3650),
    last_order_days_max: wholeNumber(c.lastOrderMax, 'Last order (at most days ago)', 0, 3650),
  };
  for (const parsed of Object.values(fields)) if ('error' in parsed) return { audience: null, problem: parsed.error };
  const v = (key: keyof typeof fields) => (fields[key] as { value: number | undefined }).value;
  const ranges: Array<[keyof typeof fields, keyof typeof fields, string]> = [
    ['min_orders', 'max_orders', 'Minimum orders cannot be more than the maximum.'],
    ['min_points', 'max_points', 'Minimum points cannot be more than the maximum.'],
    ['last_order_days_min', 'last_order_days_max', 'Last order: "at least" days cannot be more than "at most" days.'],
  ];
  for (const [lo, hi, message] of ranges) {
    const l = v(lo);
    const h = v(hi);
    if (l !== undefined && h !== undefined && l > h) return { audience: null, problem: message };
  }
  const audience: SmsCustomAudience = { group: 'CUSTOM' };
  if (c.areas.length) audience.areas = c.areas;
  if (v('min_orders') !== undefined) audience.min_orders = v('min_orders');
  if (v('max_orders') !== undefined) audience.max_orders = v('max_orders');
  if (v('min_spend_lkr') !== undefined) {
    audience.min_spend_lkr = v('min_spend_lkr');
    audience.spend_days = v('spend_days') ?? Number(DEFAULT_SPEND_DAYS);
  }
  if (c.language) audience.language = c.language;
  if (v('min_points') !== undefined) audience.min_points = v('min_points');
  if (v('max_points') !== undefined) audience.max_points = v('max_points');
  if (v('last_order_days_min') !== undefined) audience.last_order_days_min = v('last_order_days_min');
  if (v('last_order_days_max') !== undefined) audience.last_order_days_max = v('last_order_days_max');
  return { audience, problem: null };
}

/**
 * The `audience` for the API: a word for the groups without numbers (every API takes it), an object for
 * the others; `target` is null while a number is wrong (nothing is counted or sent) and `problem` says why.
 */
export function audienceFromState(state: SmsAudienceState): { target: SmsOfferTarget | null; problem: string | null } {
  if (state.extra === 'ORDERED_30D' || state.extra === 'ORDERED_90D') return { target: state.extra, problem: null };
  if (state.extra === 'CUSTOM') {
    const built = customAudienceFromDraft(state.custom);
    return { target: built.audience, problem: built.problem };
  }
  const built = audienceFromDraft(state.draft);
  if (!built.audience) return { target: null, problem: built.problem };
  const a = built.audience;
  return { target: a.group === 'ALL' || a.group === 'NEVER_ORDERED' ? a.group : a, problem: null };
}

/**
 * The state for a stored audience (editing a campaign). A CUSTOM audience, a group with numbers or one of
 * the older words fills the matching controls.
 */
export function audienceStateFrom(target: SmsOfferTarget | null | undefined): SmsAudienceState {
  const state = blankSmsAudience();
  if (target === 'ORDERED_30D' || target === 'ORDERED_90D') return { ...state, extra: target };
  if (!target || typeof target === 'string') return state;
  const a = target as Record<string, unknown>;
  if (a.group === 'CUSTOM') {
    const s = (k: string) => (typeof a[k] === 'number' ? String(a[k]) : '');
    return {
      ...state,
      extra: 'CUSTOM',
      custom: {
        areas: Array.isArray(a.areas) ? (a.areas as string[]) : [],
        minOrders: s('min_orders'),
        maxOrders: s('max_orders'),
        minSpend: s('min_spend_lkr'),
        spendDays: typeof a.spend_days === 'number' ? String(a.spend_days) : DEFAULT_SPEND_DAYS,
        language: typeof a.language === 'string' ? (a.language as CustomDraft['language']) : '',
        minPoints: s('min_points'),
        maxPoints: s('max_points'),
        lastOrderMin: s('last_order_days_min'),
        lastOrderMax: s('last_order_days_max'),
      },
    };
  }
  if (a.group === 'LAPSED' || a.group === 'NEW' || a.group === 'BIG_SPENDERS') {
    const draft = state.draft;
    return {
      ...state,
      draft: {
        ...draft,
        group: a.group,
        days: { ...draft.days, [a.group]: String(a.days ?? draft.days[a.group]) },
        min_spend_lkr: a.group === 'BIG_SPENDERS' ? String(a.min_spend_lkr ?? draft.min_spend_lkr) : draft.min_spend_lkr,
      },
    };
  }
  if (a.group === 'NEVER_ORDERED') return { ...state, draft: { ...state.draft, group: 'NEVER_ORDERED' } };
  return state;
}
