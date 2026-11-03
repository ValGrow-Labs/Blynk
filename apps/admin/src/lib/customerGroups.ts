/**
 * Customer groups for push broadcasts and SMS offers (docs/superpowers/plans/
 * 2026-10-24-groups-ratings-requests.md section A). The API counts and sends;
 * these helpers build the `audience` it takes and the words for it.
 *
 * CUSTOM (2026-11-03, SMS offers and campaigns): staff-built filters, all
 * optional and AND-ed (backend notifications/customer-groups.ts).
 */
export type CustomerGroup = 'ALL' | 'LAPSED' | 'NEW' | 'BIG_SPENDERS' | 'NEVER_ORDERED' | 'CUSTOM';

export type CustomLanguage = 'si' | 'ta' | 'en' | 'none';

/** The CUSTOM filters the API takes (each one optional). */
export interface CustomFilters {
  areas?: string[];
  min_orders?: number;
  max_orders?: number;
  min_spend_lkr?: number;
  spend_days?: number;
  language?: CustomLanguage;
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

/** The CUSTOM filters as typed: every number kept as a string, blank = not used. */
export interface CustomDraft {
  areas: string[];
  min_orders: string;
  max_orders: string;
  min_spend_lkr: string;
  spend_days: string;
  /** '' = any. */
  language: '' | CustomLanguage;
  min_points: string;
  max_points: string;
  last_order_days_min: string;
  last_order_days_max: string;
}

/** What the picker edits: every number kept as typed, so switching groups keeps them. */
export interface AudienceDraft {
  group: CustomerGroup;
  /** Days per group, as typed. */
  days: Record<'LAPSED' | 'NEW' | 'BIG_SPENDERS', string>;
  min_spend_lkr: string;
  /** The CUSTOM group's filters (SMS only). */
  custom: CustomDraft;
}

/** The groups push broadcasts offer. */
export const CUSTOMER_GROUPS: readonly CustomerGroup[] = ['ALL', 'LAPSED', 'NEW', 'BIG_SPENDERS', 'NEVER_ORDERED'];

/** The groups SMS offers and campaigns offer: the same plus the custom filters. */
export const SMS_AUDIENCE_GROUPS: readonly CustomerGroup[] = [...CUSTOMER_GROUPS, 'CUSTOM'];

export const GROUP_LABEL: Record<CustomerGroup, string> = {
  ALL: 'All customers',
  LAPSED: "Haven't ordered in N days",
  NEW: 'New customers (last N days)',
  BIG_SPENDERS: 'Big spenders',
  NEVER_ORDERED: 'Signed up, never ordered',
  CUSTOM: 'Custom filters',
};

/** The API's limits and defaults for each group's days. */
export const DAYS_RANGE: Record<'LAPSED' | 'NEW' | 'BIG_SPENDERS', { min: number; max: number; default: number }> = {
  LAPSED: { min: 7, max: 90, default: 14 },
  NEW: { min: 1, max: 60, default: 14 },
  BIG_SPENDERS: { min: 30, max: 365, default: 90 },
};
export const DEFAULT_MIN_SPEND_LKR = 5000;

/** Spend window of the CUSTOM filter when staff set a minimum spend (the API's own default). */
export const DEFAULT_CUSTOM_SPEND_DAYS = 90;

export const blankCustomDraft = (): CustomDraft => ({
  areas: [],
  min_orders: '',
  max_orders: '',
  min_spend_lkr: '',
  spend_days: String(DEFAULT_CUSTOM_SPEND_DAYS),
  language: '',
  min_points: '',
  max_points: '',
  last_order_days_min: '',
  last_order_days_max: '',
});

export const blankAudienceDraft = (): AudienceDraft => ({
  group: 'ALL',
  days: {
    LAPSED: String(DAYS_RANGE.LAPSED.default),
    NEW: String(DAYS_RANGE.NEW.default),
    BIG_SPENDERS: String(DAYS_RANGE.BIG_SPENDERS.default),
  },
  min_spend_lkr: String(DEFAULT_MIN_SPEND_LKR),
  custom: blankCustomDraft(),
});

const wholeNumber = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);

type Built = { audience: CustomerAudience; problem: null } | { audience: null; problem: string };

/** Each optional whole-number CUSTOM filter: its API key, words and range. */
const CUSTOM_NUMBERS: ReadonlyArray<{ key: keyof CustomDraft & string; label: string; min: number; max: number }> = [
  { key: 'min_orders', label: 'Minimum orders', min: 0, max: 100_000 },
  { key: 'max_orders', label: 'Maximum orders', min: 0, max: 100_000 },
  { key: 'min_spend_lkr', label: 'Minimum spend', min: 0, max: 10_000_000 },
  { key: 'min_points', label: 'Minimum points', min: 0, max: 10_000_000 },
  { key: 'max_points', label: 'Maximum points', min: 0, max: 10_000_000 },
  { key: 'last_order_days_min', label: 'Last order at least days ago', min: 0, max: 3650 },
  { key: 'last_order_days_max', label: 'Last order at most days ago', min: 0, max: 3650 },
];

const CUSTOM_RANGES: ReadonlyArray<[keyof CustomFilters, keyof CustomFilters, string]> = [
  ['min_orders', 'max_orders', 'Minimum orders cannot be more than the maximum.'],
  ['min_points', 'max_points', 'Minimum points cannot be more than the maximum.'],
  ['last_order_days_min', 'last_order_days_max', 'Last order: "at least" days cannot be more than "at most" days.'],
];

/** The CUSTOM filters for the API (blank ones left out), or the problem that stops it. */
export function customAudienceFromDraft(draft: CustomDraft): Built {
  const out: CustomFilters = {};
  if (draft.areas.length) out.areas = [...draft.areas];
  for (const n of CUSTOM_NUMBERS) {
    const raw = (draft[n.key] as string).trim();
    if (!raw) continue;
    const value = wholeNumber(raw);
    if (!Number.isInteger(value) || value < n.min || value > n.max) {
      return { audience: null, problem: `${n.label} must be a whole number from ${n.min} to ${n.max}.` };
    }
    (out as Record<string, unknown>)[n.key] = value;
  }
  if (out.min_spend_lkr !== undefined) {
    const raw = draft.spend_days.trim();
    const days = raw ? wholeNumber(raw) : DEFAULT_CUSTOM_SPEND_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > 365) return { audience: null, problem: 'Spend days must be a whole number from 1 to 365.' };
    out.spend_days = days;
  }
  if (draft.language) out.language = draft.language;
  for (const [lo, hi, message] of CUSTOM_RANGES) {
    const l = out[lo] as number | undefined;
    const h = out[hi] as number | undefined;
    if (l !== undefined && h !== undefined && l > h) return { audience: null, problem: message };
  }
  return { audience: { group: 'CUSTOM', ...out }, problem: null };
}

/** The `audience` for the API, or the problem that stops it (shown under the picker). */
export function audienceFromDraft(draft: AudienceDraft): Built {
  const g = draft.group;
  if (g === 'ALL' || g === 'NEVER_ORDERED') return { audience: { group: g }, problem: null };
  if (g === 'CUSTOM') return customAudienceFromDraft(draft.custom);
  const range = DAYS_RANGE[g];
  const days = wholeNumber(draft.days[g]);
  if (!Number.isInteger(days) || days < range.min || days > range.max) {
    return { audience: null, problem: `Days must be a whole number from ${range.min} to ${range.max}.` };
  }
  if (g !== 'BIG_SPENDERS') return { audience: { group: g, days }, problem: null };
  const min = wholeNumber(draft.min_spend_lkr);
  if (!Number.isInteger(min) || min < 1) return { audience: null, problem: 'Minimum spend must be a whole number of rupees, 1 or more.' };
  return { audience: { group: g, days, min_spend_lkr: min }, problem: null };
}

/** An audience read back from the API (a campaign being edited) as a picker draft. */
export function draftFromAudience(audience: unknown): AudienceDraft {
  const draft = blankAudienceDraft();
  if (!audience || typeof audience !== 'object') return draft;
  const a = audience as CustomerAudience;
  switch (a.group) {
    case 'LAPSED':
    case 'NEW':
      return { ...draft, group: a.group, days: { ...draft.days, [a.group]: String(a.days) } };
    case 'BIG_SPENDERS':
      return { ...draft, group: 'BIG_SPENDERS', days: { ...draft.days, BIG_SPENDERS: String(a.days) }, min_spend_lkr: String(a.min_spend_lkr) };
    case 'NEVER_ORDERED':
      return { ...draft, group: 'NEVER_ORDERED' };
    case 'CUSTOM': {
      const s = (n: number | undefined) => (n === undefined ? '' : String(n));
      return {
        ...draft,
        group: 'CUSTOM',
        custom: {
          areas: a.areas ?? [],
          min_orders: s(a.min_orders),
          max_orders: s(a.max_orders),
          min_spend_lkr: s(a.min_spend_lkr),
          spend_days: a.spend_days === undefined ? String(DEFAULT_CUSTOM_SPEND_DAYS) : String(a.spend_days),
          language: a.language ?? '',
          min_points: s(a.min_points),
          max_points: s(a.max_points),
          last_order_days_min: s(a.last_order_days_min),
          last_order_days_max: s(a.last_order_days_max),
        },
      };
    }
    default:
      return draft;
  }
}

/** `group=LAPSED&days=14` for GET .../audience previews. */
export function audienceQuery(audience: CustomerAudience): string {
  const q = new URLSearchParams({ group: audience.group });
  if ('days' in audience) q.set('days', String(audience.days));
  if ('min_spend_lkr' in audience && audience.group === 'BIG_SPENDERS') q.set('min_spend_lkr', String(audience.min_spend_lkr));
  return q.toString();
}

const lkr = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Older SMS offers carry a word, not a group (backend migration 027). */
const LEGACY_LABEL: Record<string, string> = {
  ALL: 'All customers',
  ORDERED_30D: 'Ordered in last 30 days',
  ORDERED_90D: 'Ordered in last 90 days',
  NEVER_ORDERED: 'Signed up, never ordered',
};

const LANGUAGE_WORD: Record<CustomLanguage, string> = { si: 'Sinhala', ta: 'Tamil', en: 'English', none: 'no language picked' };

/** "5+", "2-5", "up to 5" for an optional range. */
function rangeText(lo: number | undefined, hi: number | undefined): string {
  if (lo !== undefined && hi !== undefined) return `${lo}-${hi}`;
  if (lo !== undefined) return `${lo}+`;
  return `up to ${hi}`;
}

/** The words for a CUSTOM audience: "In Kalutara, Beruwala; 2-5 orders; spent LKR 5,000+ in 90 days". */
export function customLabel(f: CustomFilters): string {
  const bits: string[] = [];
  if (f.areas?.length) bits.push(`In ${f.areas.join(', ')}`);
  if (f.min_orders !== undefined || f.max_orders !== undefined) bits.push(`${rangeText(f.min_orders, f.max_orders)} orders`);
  if (f.min_spend_lkr !== undefined) bits.push(`spent LKR ${lkr.format(f.min_spend_lkr)}+ in ${f.spend_days ?? DEFAULT_CUSTOM_SPEND_DAYS} days`);
  if (f.language) bits.push(`language: ${LANGUAGE_WORD[f.language]}`);
  if (f.min_points !== undefined || f.max_points !== undefined) bits.push(`${rangeText(f.min_points, f.max_points)} points`);
  if (f.last_order_days_min !== undefined || f.last_order_days_max !== undefined) {
    bits.push(`last order ${rangeText(f.last_order_days_min, f.last_order_days_max)} days ago`);
  }
  return bits.length ? bits.join('; ') : 'All customers (no filters)';
}

/** "Haven't ordered in 14 days", "Big spenders: LKR 5,000+ in 90 days", ... for history rows. */
export function audienceLabel(audience: unknown): string {
  if (audience == null) return 'All customers';
  if (typeof audience === 'string') return LEGACY_LABEL[audience] ?? audience;
  if (typeof audience !== 'object') return String(audience);
  const a = audience as { group?: string; days?: number; min_spend_lkr?: number };
  switch (a.group) {
    case 'ALL':
      return 'All customers';
    case 'LAPSED':
      return `Haven't ordered in ${a.days ?? DAYS_RANGE.LAPSED.default} days`;
    case 'NEW':
      return `New customers (last ${a.days ?? DAYS_RANGE.NEW.default} days)`;
    case 'BIG_SPENDERS':
      return `Big spenders: LKR ${lkr.format(a.min_spend_lkr ?? DEFAULT_MIN_SPEND_LKR)}+ in ${a.days ?? DAYS_RANGE.BIG_SPENDERS.default} days`;
    case 'NEVER_ORDERED':
      return 'Signed up, never ordered';
    case 'CUSTOM':
      return `Custom: ${customLabel(audience as CustomFilters)}`;
    default:
      return a.group ? String(a.group) : 'All customers';
  }
}
