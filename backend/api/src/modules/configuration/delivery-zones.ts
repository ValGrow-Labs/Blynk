import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { calculateHaversineKm } from '../../utils/geo.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { DBConnection } from '../orders/order.repository.js';

/**
 * Extra delivery areas (owner's brother, 2026-11-01: "I don't want the radius increased - it grows on
 * the Bentota side too. We have to include Beruwala only").
 *
 * The delivery area is the circle around the Blynk store (dark_stores.radius_km, unchanged) PLUS these
 * extra circles. system_configurations 'delivery_zones' (no migration):
 *   { "zones": [ { id, name, lat, lng, radius_km, enabled }, ... ] }   at most 10
 *
 * With no stored row the default is Beruwala, switched OFF, so nothing changes until the owner turns it
 * on. An address is deliverable when it is inside the store circle OR inside an ENABLED zone
 * (orders/delivery-zone.ts, used by checkout and the address book). Fees (road distance from the pickup
 * point), rider pay and seller pickups are untouched.
 *
 * GET|PUT /admin/settings/delivery-zones (ADMIN, OPERATIONS; audited DELIVERY_ZONES_UPDATED); GET /store
 * carries the enabled zones as `delivery_zones`; the order map report carries them as `store.zones`.
 */
export const DELIVERY_ZONES_KEY = 'delivery_zones';
export const MAX_DELIVERY_ZONES = 10;
export const MIN_ZONE_RADIUS_KM = 0.5;
export const MAX_ZONE_RADIUS_KM = 15;

export interface DeliveryZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
  enabled: boolean;
}

/** The public face of an enabled zone (GET /store). */
export interface PublicDeliveryZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
}

/** Beruwala town centre (the customer app's own place list); 3 km keeps it clear of Bentota (~7 km south). */
export const DEFAULT_DELIVERY_ZONES: DeliveryZone[] = [
  { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false },
];

const finiteNumber = (label: string) =>
  z.number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` }).finite();

const zoneInputSchema = z
  .object({
    // Optional and not trusted: the stored id is always the slug of the name (see normalizeZones).
    id: z.string().max(60).optional(),
    name: z
      .string({ required_error: 'The area name is required', invalid_type_error: 'The area name must be text' })
      .trim()
      .min(1, 'The area name is required')
      .max(40, 'The area name can be at most 40 characters'),
    lat: finiteNumber('Latitude')
      .min(5, 'Latitude must be between 5 and 10 (Sri Lanka)')
      .max(10, 'Latitude must be between 5 and 10 (Sri Lanka)'),
    lng: finiteNumber('Longitude')
      .min(78, 'Longitude must be between 78 and 83 (Sri Lanka)')
      .max(83, 'Longitude must be between 78 and 83 (Sri Lanka)'),
    radius_km: finiteNumber('The radius')
      .min(MIN_ZONE_RADIUS_KM, `The radius must be at least ${MIN_ZONE_RADIUS_KM} km`)
      .max(MAX_ZONE_RADIUS_KM, `The radius can be at most ${MAX_ZONE_RADIUS_KM} km`)
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'The radius can have at most 2 decimals'),
    enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
  })
  .strict();

export const updateDeliveryZonesSchema = z
  .object({
    zones: z
      .array(zoneInputSchema, { required_error: 'zones is required', invalid_type_error: 'zones must be a list' })
      .max(MAX_DELIVERY_ZONES, `At most ${MAX_DELIVERY_ZONES} extra areas`),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.zones.forEach((zone, index) => {
      const key = zone.name.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['zones', index, 'name'], message: 'Two areas cannot have the same name' });
      }
      seen.add(key);
    });
  });
export type UpdateDeliveryZonesInput = z.infer<typeof updateDeliveryZonesSchema>;

/** "Beruwala Town" -> "beruwala-town"; a name with no latin letters or digits (Sinhala, Tamil) -> "area". */
export function zoneSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'area';
}

const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

/** Validated input as stored zones: trimmed names, rounded numbers, id = slug of the name, unique within the list. */
export function normalizeZones(input: UpdateDeliveryZonesInput['zones']): DeliveryZone[] {
  const used = new Set<string>();
  return input.map((zone) => {
    const base = zoneSlug(zone.name);
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return {
      id,
      name: zone.name.trim(),
      lat: round(zone.lat, 6),
      lng: round(zone.lng, 6),
      radius_km: round(zone.radius_km, 2),
      enabled: zone.enabled,
    };
  });
}

const cloneDefaults = (): DeliveryZone[] => DEFAULT_DELIVERY_ZONES.map((zone) => ({ ...zone }));

/** The stored row as zones; a missing or malformed row is the default (Beruwala, off). */
export function deliveryZonesFrom(value: unknown): DeliveryZone[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return cloneDefaults();
    }
  }
  const result = updateDeliveryZonesSchema.safeParse(parsed);
  if (!result.success) return cloneDefaults();
  return normalizeZones(result.data.zones);
}

/** The enabled zones as GET /store shows them. */
export function publicZones(zones: DeliveryZone[]): PublicDeliveryZone[] {
  return zones
    .filter((zone) => zone.enabled)
    .map((zone) => ({ id: zone.id, name: zone.name, lat: zone.lat, lng: zone.lng, radius_km: zone.radius_km }));
}

/**
 * The enabled zone a point lies in (the nearest centre when several overlap), or null. Pure; the same
 * haversine as utils/geo.ts isWithinDeliveryRadius.
 */
export function pointInZones(zones: DeliveryZone[], lat: number, lng: number): { zone: DeliveryZone; distanceKm: number } | null {
  let best: { zone: DeliveryZone; distanceKm: number } | null = null;
  for (const zone of zones) {
    if (!zone.enabled) continue;
    const distanceKm = calculateHaversineKm(zone.lat, zone.lng, lat, lng);
    if (distanceKm <= zone.radius_km && (!best || distanceKm < best.distanceKm)) best = { zone, distanceKm };
  }
  return best;
}

export class DeliveryZonesService {
  async get(executor: DBConnection = db): Promise<{ zones: DeliveryZone[]; updated_at: Date | null }> {
    const row = await executor
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', DELIVERY_ZONES_KEY)
      .executeTakeFirst();
    return { zones: row ? deliveryZonesFrom(row.value) : cloneDefaults(), updated_at: row?.updated_at ?? null };
  }

  /** The zones alone (what checkout, the address book, GET /store and the order map read). */
  async read(executor: DBConnection = db): Promise<DeliveryZone[]> {
    return (await this.get(executor)).zones;
  }

  /** Replaces the whole list. Audited (DELIVERY_ZONES_UPDATED); orders already placed are untouched. */
  async set(input: UpdateDeliveryZonesInput, actor: AuditActor) {
    const zones = normalizeZones(input.zones);
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', DELIVERY_ZONES_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = before ? deliveryZonesFrom(before.value) : cloneDefaults();
      const value = JSON.stringify({ zones });
      await trx
        .insertInto('system_configurations')
        .values({ key: DELIVERY_ZONES_KEY, value, description: 'Extra delivery areas (circles) beside the store radius' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'DELIVERY_ZONES_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: DELIVERY_ZONES_KEY, zones: previous },
        newValues: { key: DELIVERY_ZONES_KEY, zones },
      });
      logger.info(
        { before: previous.length, after: zones.length, enabled: zones.filter((zone) => zone.enabled).length, actorId: actor.actorId },
        'Delivery zones changed'
      );
    });
    return this.get();
  }
}

export const deliveryZonesService = new DeliveryZonesService();
