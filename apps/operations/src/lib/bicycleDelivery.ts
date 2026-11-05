import type {
  BicycleDeliveryInput,
  BicycleDeliverySetting,
  BicycleFeeSetting,
  BicycleRiderPayMode,
  BicycleRiderPaySetting,
  DeliveryFeeSetting,
} from '../api/types';

/**
 * Bicycle delivery (2026-11-05; GET|PUT /admin/settings/bicycle-delivery): the numbers staff type, the checks
 * the API repeats, and the worked example. The formulas are the backend's:
 *   customer fee = base_lkr while distance <= base_km, then per_km_lkr for each STARTED km beyond, capped by max_fee_lkr
 *   rider FIXED  = fixed_lkr;  rider PER_KM = base_lkr + per_km_lkr x km, never below min_lkr
 * Placeholder defaults are not business decisions: the switch is off until staff set the real numbers.
 */

export const BICYCLE_MIN_KM = 0.5;
export const BICYCLE_MAX_KM = 10;
export const BICYCLE_MAX_LKR = 1000;

export const DEFAULT_BICYCLE: BicycleDeliverySetting = {
  enabled: false,
  max_km: 3,
  fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },
  rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null },
  updated_at: null,
  ready: true,
};

/** Shown while the owner has not run migration 067 (`ready: false`). */
export const BICYCLE_NOT_READY_NOTICE =
  'The owner must run the database update (migration 067) in Coolify before bicycle orders can be taken. You can save the settings now.';

/** The text boxes of the card. */
export interface BicycleDrafts {
  enabled: boolean;
  maxKm: string;
  feeBase: string;
  feeBaseKm: string;
  feePerKm: string;
  feeMax: string;
  payMode: BicycleRiderPayMode;
  payFixed: string;
  payBase: string;
  payPerKm: string;
  payMin: string;
}

const num = (value: number | null | undefined) => (typeof value === 'number' ? String(Number(value.toFixed(2))) : '');

/** The boxes for a stored setting (defaults for any missing part: an older or odd answer must not crash the card). */
export function bicycleToDrafts(setting: Partial<BicycleDeliverySetting> | null | undefined): BicycleDrafts {
  const fee = { ...DEFAULT_BICYCLE.fee, ...(setting?.fee ?? {}) };
  const pay = { ...DEFAULT_BICYCLE.rider_pay, ...(setting?.rider_pay ?? {}) };
  return {
    enabled: setting?.enabled === true,
    maxKm: num(setting?.max_km ?? DEFAULT_BICYCLE.max_km),
    feeBase: num(fee.base_lkr),
    feeBaseKm: num(fee.base_km),
    feePerKm: num(fee.per_km_lkr),
    feeMax: num(fee.max_fee_lkr),
    payMode: pay.mode === 'PER_KM' ? 'PER_KM' : 'FIXED',
    payFixed: num(pay.fixed_lkr),
    payBase: num(pay.base_lkr),
    payPerKm: num(pay.per_km_lkr),
    payMin: num(pay.min_lkr),
  };
}

const clean = (raw: string) => raw.trim().replace(/^LKR\s*/i, '').replace(/,/g, '').trim();

/** An amount in LKR: 0..1000, at most 2 decimals; `optional` lets it be blank (null). */
export function parseBicycleLkr(raw: string, what: string, optional = false): { value: number | null } | { error: string } {
  const text = clean(raw);
  if (!text) return optional ? { value: null } : { error: `Enter ${what} in LKR.` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 50 or 49.50.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Use at most 2 decimal places.' };
  const value = Number(text);
  if (value > BICYCLE_MAX_LKR) return { error: 'Amounts must be between LKR 0 and LKR 1,000.' };
  return { value };
}

/** A distance: 0.5..10 km, at most 1 decimal. */
export function parseBicycleKm(raw: string, what: string): { value: number } | { error: string } {
  const text = clean(raw);
  if (!text) return { error: `Enter ${what} in km.` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'Enter a number, like 3 or 2.5.' };
  if (!/^\d+(\.\d)?$/.test(text)) return { error: 'Use at most 1 decimal place.' };
  const value = Number(text);
  if (value < BICYCLE_MIN_KM || value > BICYCLE_MAX_KM) return { error: `Distances must be between ${BICYCLE_MIN_KM} and ${BICYCLE_MAX_KM} km.` };
  return { value };
}

/** Which box each problem belongs to. */
export type BicycleErrors = Partial<Record<keyof BicycleDrafts, string>>;

/**
 * The PUT body from the boxes, or the problems per box. Whole sections are sent. A box that is hidden (the
 * rider-pay fields of the other mode) keeps the stored number when it is not valid, so it never blocks a save.
 */
export function bicycleDraftsToInput(
  drafts: BicycleDrafts,
  stored: Partial<BicycleDeliverySetting> | null | undefined
): { input: Required<BicycleDeliveryInput> } | { errors: BicycleErrors } {
  const storedDrafts = bicycleToDrafts(stored);
  const errors: BicycleErrors = {};
  const lkr = (key: keyof BicycleDrafts, what: string, optional = false, visible = true) => {
    const read = parseBicycleLkr(String(drafts[key]), what, optional);
    if ('error' in read) {
      if (visible) errors[key] = read.error;
      const fallback = parseBicycleLkr(String(storedDrafts[key]), what, optional);
      return 'value' in fallback ? fallback.value : null;
    }
    return read.value;
  };
  const km = (key: keyof BicycleDrafts, what: string) => {
    const read = parseBicycleKm(String(drafts[key]), what);
    if ('error' in read) {
      errors[key] = read.error;
      return 0;
    }
    return read.value;
  };
  const perKmMode = drafts.payMode === 'PER_KM';
  const maxKm = km('maxKm', 'the longest bicycle trip');
  const fee: BicycleFeeSetting = {
    base_lkr: lkr('feeBase', 'the base fee') ?? 0,
    base_km: km('feeBaseKm', 'the distance the base fee covers'),
    per_km_lkr: lkr('feePerKm', 'the fee for each extra km') ?? 0,
    max_fee_lkr: lkr('feeMax', 'the maximum fee', true),
  };
  const pay: BicycleRiderPaySetting = {
    mode: drafts.payMode,
    fixed_lkr: lkr('payFixed', 'the rider pay', false, !perKmMode) ?? 0,
    base_lkr: lkr('payBase', 'the rider base pay', false, perKmMode) ?? 0,
    per_km_lkr: lkr('payPerKm', 'the rider pay for each km', false, perKmMode) ?? 0,
    min_lkr: lkr('payMin', 'the minimum rider pay', true, perKmMode),
  };
  if (Object.keys(errors).length > 0) return { errors };
  return { input: { enabled: drafts.enabled, max_km: maxKm, fee, rider_pay: pay } };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The customer's bicycle fee for a trip of `km` (the backend's base + per started km rule, then the cap). */
export function bicycleFee(km: number, fee: BicycleFeeSetting): number {
  const distance = round2(Number.isFinite(km) && km > 0 ? km : 0);
  const extra = distance - fee.base_km;
  const extraKm = extra <= 1e-9 ? 0 : Math.ceil(extra - 1e-9);
  const total = round2(fee.base_lkr + fee.per_km_lkr * extraKm);
  return typeof fee.max_fee_lkr === 'number' ? Math.min(total, fee.max_fee_lkr) : total;
}

/** What a commission rider earns for a bicycle trip of `km`. */
export function bicycleRiderPay(km: number, pay: BicycleRiderPaySetting): number {
  if (pay.mode === 'FIXED') return round2(pay.fixed_lkr);
  const total = round2(pay.base_lkr + pay.per_km_lkr * (Number.isFinite(km) && km > 0 ? km : 0));
  return typeof pay.min_lkr === 'number' ? Math.max(total, pay.min_lkr) : total;
}

const lkrText = (value: number) =>
  `LKR ${value.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(round2(value)) ? 0 : 2, maximumFractionDigits: Number.isInteger(round2(value)) ? 0 : 2 })}`;

/** The distance the example line uses: 1.5 km, or the longest bicycle trip when that is shorter. */
export function exampleKm(maxKm: number): number {
  return Math.min(1.5, maxKm);
}

/** "A 1.5 km order: customer pays LKR 80, rider earns LKR 50". */
export function bicycleExampleText(km: number, fee: BicycleFeeSetting, pay: BicycleRiderPaySetting): string {
  return `A ${km} km order: customer pays ${lkrText(bicycleFee(km, fee))}, rider earns ${lkrText(bicycleRiderPay(km, pay))}`;
}

/** The motorbike delivery fee for `km` from the current delivery-fee setting; null when it cannot be worked out. */
export function motorbikeFeeAt(setting: DeliveryFeeSetting | null | undefined, km: number): number | null {
  if (!setting) return null;
  const cap = typeof setting.max_fee_lkr === 'number' ? setting.max_fee_lkr : null;
  const capped = (value: number) => (cap === null ? value : Math.min(value, cap));
  if (setting.fee_mode === 'BASE_PER_KM') {
    if (typeof setting.base_lkr !== 'number' || typeof setting.base_km !== 'number' || typeof setting.per_km_lkr !== 'number') return null;
    return bicycleFee(km, { base_lkr: setting.base_lkr, base_km: setting.base_km, per_km_lkr: setting.per_km_lkr, max_fee_lkr: cap });
  }
  if (setting.fee_mode === 'DISTANCE_TIERS') {
    const tiers = setting.tiers ?? [];
    if (tiers.length === 0) return null;
    const counted = Math.max(1, Math.ceil(Number.isFinite(km) && km > 0 ? km - 1e-9 : 1));
    let sum = 0;
    for (let i = 0; i < counted; i += 1) sum += tiers[Math.min(i, tiers.length - 1)]!.lkr;
    return capped(round2(sum));
  }
  return typeof setting.fee_lkr === 'number' ? setting.fee_lkr : null;
}

/**
 * A warning (never a block) when the bicycle fee is not lower than the motorbike fee for the example trip or
 * the longest bicycle trip; null when it is lower, or when the motorbike fee is not known.
 */
export function bicycleFeeWarning(maxKm: number, fee: BicycleFeeSetting, motorbike: DeliveryFeeSetting | null | undefined): string | null {
  for (const km of Array.from(new Set([exampleKm(maxKm), maxKm]))) {
    const bike = bicycleFee(km, fee);
    const moto = motorbikeFeeAt(motorbike, km);
    if (moto !== null && bike >= moto) {
      return `For a ${km} km order the bicycle fee (${lkrText(bike)}) is not lower than the motorbike fee (${lkrText(moto)}), so customers have little reason to choose bicycle.`;
    }
  }
  return null;
}

/** "on, up to 3 km" / "off", for the saved toast. */
export function bicycleSummary(setting: Pick<BicycleDeliverySetting, 'enabled' | 'max_km'>): string {
  return setting.enabled ? `on, up to ${setting.max_km} km` : 'off';
}
