import { sql } from 'kysely';
import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { DBConnection } from '../orders/order.repository.js';

/**
 * Bicycle delivery (team meeting 2026-11-04; owner 2026-11-05: "give that option to Ops and Admin, they will
 * decide in future"): a SEPARATE, cheaper delivery for short routes. The customer picks Bicycle or Motorbike at
 * checkout when both are possible; staff then assign the rider as today, and a bicycle order only goes to a rider
 * whose vehicle is a bicycle. Nothing is hardcoded: staff set the distance and the money.
 *
 * system_configurations 'bicycle_delivery' (no migration for the setting; orders.delivery_method is migration 067):
 *   { enabled: false,
 *     max_km: 3,                                                       // 0.5-10, 1 decimal
 *     fee:   { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },   // what the customer pays (same rule as BASE_PER_KM)
 *     rider_pay: { mode: 'FIXED' | 'PER_KM', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null } }
 *
 * The placeholder amounts are NOT business decisions: the switch is OFF by default and staff set the real numbers
 * before switching it on. A bicycle is offered only when the road km (the delivery fee's own measurement) is at
 * most max_km. Orders already placed keep the fee and the delivery method they were placed with.
 *
 * GET|PUT /admin/settings/bicycle-delivery (ADMIN, OPERATIONS; audited BICYCLE_DELIVERY_UPDATED with old and new).
 * PUT takes any of enabled / max_km / fee / rider_pay (a section is replaced whole); the merged setting is validated
 * as a whole, so switching `enabled` on always needs a valid fee and rider_pay.
 */
export const BICYCLE_DELIVERY_KEY = 'bicycle_delivery';
export const BICYCLE_MAX_KM_LIMITS = { min: 0.5, max: 10 } as const;
export const BICYCLE_MAX_LKR = 1000;

export type BicycleRiderPayMode = 'FIXED' | 'PER_KM';
export const BICYCLE_RIDER_PAY_MODES = ['FIXED', 'PER_KM'] as const satisfies readonly BicycleRiderPayMode[];

export interface BicycleFeeRule {
  base_lkr: number;
  base_km: number;
  per_km_lkr: number;
  max_fee_lkr: number | null;
}

export interface BicycleRiderPay {
  mode: BicycleRiderPayMode;
  fixed_lkr: number;
  base_lkr: number;
  per_km_lkr: number;
  min_lkr: number | null;
}

export interface BicycleDeliverySetting {
  enabled: boolean;
  max_km: number;
  fee: BicycleFeeRule;
  rider_pay: BicycleRiderPay;
}

export const DEFAULT_BICYCLE_DELIVERY: BicycleDeliverySetting = {
  enabled: false,
  max_km: 3,
  fee: { base_lkr: 80, base_km: 2, per_km_lkr: 30, max_fee_lkr: null },
  rider_pay: { mode: 'FIXED', fixed_lkr: 50, base_lkr: 30, per_km_lkr: 15, min_lkr: null },
};

const twoDecimals = (v: number) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
const oneDecimal = (v: number) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6;

const lkr = (label: string) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(BICYCLE_MAX_LKR, `${label} can be at most LKR ${BICYCLE_MAX_LKR}`)
    .refine(twoDecimals, `${label} can have at most 2 decimals`);

const km = (label: string, min: number, max: number) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .finite()
    .min(min, `${label} must be at least ${min} km`)
    .max(max, `${label} can be at most ${max} km`)
    .refine(oneDecimal, `${label} can have at most 1 decimal`);

export const bicycleFeeSchema = z
  .object({
    base_lkr: lkr('The base fee'),
    base_km: km('The covered km', BICYCLE_MAX_KM_LIMITS.min, BICYCLE_MAX_KM_LIMITS.max),
    per_km_lkr: lkr('The fee per extra km'),
    max_fee_lkr: lkr('The fee cap').nullable(),
  })
  .strict();

export const bicycleRiderPaySchema = z
  .object({
    mode: z.enum(BICYCLE_RIDER_PAY_MODES, { errorMap: () => ({ message: 'rider_pay mode must be FIXED or PER_KM' }) }),
    fixed_lkr: lkr('The fixed pay'),
    base_lkr: lkr('The base pay'),
    per_km_lkr: lkr('The pay per km'),
    min_lkr: lkr('The minimum pay').nullable(),
  })
  .strict();

/** The whole setting, as stored and as answered. */
export const bicycleDeliverySchema = z
  .object({
    enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
    max_km: km('The distance', BICYCLE_MAX_KM_LIMITS.min, BICYCLE_MAX_KM_LIMITS.max),
    fee: bicycleFeeSchema,
    rider_pay: bicycleRiderPaySchema,
  })
  .strict();

/** PUT body: any of the four; a section is replaced whole. */
export const updateBicycleDeliverySchema = z
  .object({
    enabled: bicycleDeliverySchema.shape.enabled.optional(),
    max_km: bicycleDeliverySchema.shape.max_km.optional(),
    fee: bicycleFeeSchema.optional(),
    rider_pay: bicycleRiderPaySchema.optional(),
  })
  .strict()
  .refine((v) => v.enabled !== undefined || v.max_km !== undefined || v.fee !== undefined || v.rider_pay !== undefined, {
    message: 'Send enabled, max_km, fee or rider_pay',
  });
export type UpdateBicycleDeliveryInput = z.infer<typeof updateBicycleDeliverySchema>;

const num = (x: unknown, min: number, max: number, fallback: number) =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : fallback;
const numOrNull = (x: unknown, min: number, max: number, fallback: number | null) =>
  x === null ? null : typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : fallback;

/** The stored row as a setting: any missing or malformed value takes its default (so a bad row is OFF and harmless). Never throws. */
export function bicycleDeliveryFrom(value: unknown): BicycleDeliverySetting {
  const d = DEFAULT_BICYCLE_DELIVERY;
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const fee = (v.fee && typeof v.fee === 'object' ? v.fee : {}) as Record<string, unknown>;
  const pay = (v.rider_pay && typeof v.rider_pay === 'object' ? v.rider_pay : {}) as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    max_km: num(v.max_km, BICYCLE_MAX_KM_LIMITS.min, BICYCLE_MAX_KM_LIMITS.max, d.max_km),
    fee: {
      base_lkr: num(fee.base_lkr, 0, BICYCLE_MAX_LKR, d.fee.base_lkr),
      base_km: num(fee.base_km, BICYCLE_MAX_KM_LIMITS.min, BICYCLE_MAX_KM_LIMITS.max, d.fee.base_km),
      per_km_lkr: num(fee.per_km_lkr, 0, BICYCLE_MAX_LKR, d.fee.per_km_lkr),
      max_fee_lkr: numOrNull(fee.max_fee_lkr, 0, BICYCLE_MAX_LKR, d.fee.max_fee_lkr),
    },
    rider_pay: {
      mode: pay.mode === 'PER_KM' ? 'PER_KM' : 'FIXED',
      fixed_lkr: num(pay.fixed_lkr, 0, BICYCLE_MAX_LKR, d.rider_pay.fixed_lkr),
      base_lkr: num(pay.base_lkr, 0, BICYCLE_MAX_LKR, d.rider_pay.base_lkr),
      per_km_lkr: num(pay.per_km_lkr, 0, BICYCLE_MAX_LKR, d.rider_pay.per_km_lkr),
      min_lkr: numOrNull(pay.min_lkr, 0, BICYCLE_MAX_LKR, d.rider_pay.min_lkr),
    },
  };
}

/** The setting alone (what checkout, placement and rider-pay settlement read), on any connection or transaction. */
export async function readBicycleDelivery(executor: DBConnection = db): Promise<BicycleDeliverySetting> {
  const row = await executor.selectFrom('system_configurations').select('value').where('key', '=', BICYCLE_DELIVERY_KEY).executeTakeFirst();
  return bicycleDeliveryFrom(row?.value);
}

let readyCache: { ok: boolean; at: number } | null = null;
let readyOverride: boolean | null = null;

/**
 * Whether migration 067 (orders.delivery_method) has been run. Migrations are run by hand in Coolify after the API
 * is deployed, so until then bicycle delivery is treated as unavailable everywhere and every order reads as MOTORBIKE.
 * A "yes" is kept; a "no" is asked again after a minute.
 */
export async function bicycleDeliveryReady(): Promise<boolean> {
  if (readyOverride !== null) return readyOverride;
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 60_000)) return readyCache.ok;
  try {
    const r = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'delivery_method'`.execute(db);
    readyCache = { ok: (r.rows[0]?.n ?? 0) >= 1, at: Date.now() };
  } catch {
    readyCache = { ok: false, at: Date.now() };
  }
  return readyCache.ok;
}

/** Tests only: pretend migration 067 is missing (false) or present (true); null = check the database again. */
export function setBicycleDeliveryReadyForTests(value: boolean | null): void {
  readyOverride = value;
  readyCache = null;
}

export class BicycleDeliveryService {
  /** The setting, when it was last saved (null = never) and whether migration 067 has been run (`ready`). */
  async get(): Promise<BicycleDeliverySetting & { updated_at: Date | null; ready: boolean }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', BICYCLE_DELIVERY_KEY)
      .executeTakeFirst();
    return { ...bicycleDeliveryFrom(row?.value), updated_at: row?.updated_at ?? null, ready: await bicycleDeliveryReady() };
  }

  async read(): Promise<BicycleDeliverySetting> {
    return await readBicycleDelivery();
  }

  /** Audited (BICYCLE_DELIVERY_UPDATED); applies to checkouts and settlements afterwards. */
  async set(input: UpdateBicycleDeliveryInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', BICYCLE_DELIVERY_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = bicycleDeliveryFrom(before?.value);
      // The merged setting is validated as a whole: switching it on needs a valid fee and rider pay.
      const next = bicycleDeliverySchema.parse({
        enabled: input.enabled ?? previous.enabled,
        max_km: input.max_km ?? previous.max_km,
        fee: input.fee ?? previous.fee,
        rider_pay: input.rider_pay ?? previous.rider_pay,
      }) as BicycleDeliverySetting;
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: BICYCLE_DELIVERY_KEY, value, description: 'Bicycle delivery: on/off, longest bicycle trip, customer fee and rider pay (migration 067)' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'BICYCLE_DELIVERY_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: BICYCLE_DELIVERY_KEY, ...(before ? previous : {}) },
        newValues: { key: BICYCLE_DELIVERY_KEY, ...next },
      });
      logger.info({ previous, next, actorId: actor.actorId }, 'Bicycle delivery setting changed');
    });
    return this.get();
  }
}

export const bicycleDeliveryService = new BicycleDeliveryService();
