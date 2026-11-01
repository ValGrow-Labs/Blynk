import { parseLatLng } from './sellerShop';

/**
 * Extra delivery areas (2026-11-01, docs/superpowers/plans/2026-11-01-extra-delivery-areas.md): the main delivery
 * area is the circle around the Blynk store (Delivery radius); an extra area is a separate circle, for example
 * Beruwala, that is added to it without making the main circle bigger. `GET|PUT /admin/settings/delivery-zones`.
 * Every limit mirrors the API, which re-checks it. Pure helpers, no React.
 */

export interface DeliveryZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
  enabled: boolean;
}

/** `GET|PUT /admin/settings/delivery-zones`. */
export interface DeliveryZonesSetting {
  zones: DeliveryZone[];
  updated_at: string | null;
}

export const MAX_ZONES = 10;
export const MAX_ZONE_NAME = 40;
export const MIN_ZONE_RADIUS_KM = 0.5;
export const MAX_ZONE_RADIUS_KM = 15;
/** The Sri Lanka box the API accepts. */
export const LAT_RANGE = { min: 5, max: 10 } as const;
export const LNG_RANGE = { min: 78, max: 83 } as const;

/** A zone as it is typed: every number is text until it is saved. `id` is '' until the zone is saved with its name. */
export interface ZoneDraft {
  /** Local row key (never sent). */
  key: string;
  id: string;
  name: string;
  lat: string;
  lng: string;
  radius: string;
  enabled: boolean;
}

export type ZoneField = 'name' | 'lat' | 'lng' | 'radius';
export type ZoneErrors = Partial<Record<ZoneField, string>>;

let counter = 0;
const nextKey = () => `zone-${++counter}`;

export function draftOfZone(z: DeliveryZone): ZoneDraft {
  return { key: nextKey(), id: z.id, name: z.name, lat: String(z.lat), lng: String(z.lng), radius: String(z.radius_km), enabled: z.enabled };
}

/** A new area row: empty, 3 km, switched on (the plan's "Add area ... radius, on"). */
export function newZoneDraft(): ZoneDraft {
  return { key: nextKey(), id: '', name: '', lat: '', lng: '', radius: '3', enabled: true };
}

export const draftsOf = (zones: ReadonlyArray<DeliveryZone>): ZoneDraft[] => zones.map(draftOfZone);

/** A readable id from a name: "Beruwala Town" -> "beruwala-town". */
export function slugOf(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

const NUM = /^-?\d+(?:\.\d+)?$/;

function number(text: string): number | null {
  const t = text.trim();
  if (!NUM.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const decimals = (text: string) => (text.trim().split('.')[1] ?? '').length;

/** What is wrong with one typed area, per field (empty when it is fine). */
export function zoneErrors(d: ZoneDraft): ZoneErrors {
  const errors: ZoneErrors = {};
  const name = d.name.trim();
  if (!name) errors.name = 'Enter the name of the area, like Beruwala.';
  else if (name.length > MAX_ZONE_NAME) errors.name = `At most ${MAX_ZONE_NAME} characters.`;
  else if (!slugOf(name)) errors.name = 'Use letters or numbers in the name.';
  const lat = number(d.lat);
  if (lat === null || lat < LAT_RANGE.min || lat > LAT_RANGE.max) errors.lat = `Enter the latitude, a number from ${LAT_RANGE.min} to ${LAT_RANGE.max} (like 6.4759).`;
  const lng = number(d.lng);
  if (lng === null || lng < LNG_RANGE.min || lng > LNG_RANGE.max) errors.lng = `Enter the longitude, a number from ${LNG_RANGE.min} to ${LNG_RANGE.max} (like 79.9842).`;
  const radius = number(d.radius.trim().replace(/\s*km$/i, ''));
  if (radius === null || radius < MIN_ZONE_RADIUS_KM || radius > MAX_ZONE_RADIUS_KM || decimals(d.radius.trim().replace(/\s*km$/i, '')) > 2) {
    errors.radius = `Radius: enter the km, ${MIN_ZONE_RADIUS_KM} to ${MAX_ZONE_RADIUS_KM}, at most 2 decimals, like 3.`;
  }
  return errors;
}

/** The ids to send: a saved area keeps its id, a new one gets the slug of its name, made unique with -2, -3. */
export function zoneIds(drafts: ReadonlyArray<ZoneDraft>): string[] {
  const used = new Set(drafts.map((d) => d.id).filter(Boolean));
  const ids: string[] = [];
  for (const d of drafts) {
    if (d.id) {
      ids.push(d.id);
      continue;
    }
    const base = slugOf(d.name) || 'area';
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base.slice(0, 37)}-${n++}`;
    used.add(id);
    ids.push(id);
  }
  return ids;
}

export type ZonesBodyResult = { body: { zones: DeliveryZone[] } } | { errors: Record<string, ZoneErrors>; error: string | null };

/**
 * The PUT body from the typed rows, or the problems: per row (by `key`) and one general line (more than 10 areas).
 */
export function zonesBody(drafts: ReadonlyArray<ZoneDraft>): ZonesBodyResult {
  const errors: Record<string, ZoneErrors> = {};
  let error: string | null = null;
  if (drafts.length > MAX_ZONES) error = `At most ${MAX_ZONES} extra areas.`;
  for (const d of drafts) {
    const e = zoneErrors(d);
    if (Object.keys(e).length > 0) errors[d.key] = e;
  }
  if (Object.keys(errors).length > 0 || error) return { errors, error };
  const ids = zoneIds(drafts);
  return {
    body: {
      zones: drafts.map((d, i) => ({
        id: ids[i],
        name: d.name.trim(),
        lat: Number(d.lat.trim()),
        lng: Number(d.lng.trim()),
        radius_km: Number(d.radius.trim().replace(/\s*km$/i, '')),
        enabled: d.enabled,
      })),
    },
  };
}

/** A pasted Google Maps link or "lat, lng" text read into the two coordinate fields, or null (same parser as the seller location sheet). */
export function pasteToCoordinates(text: string): { lat: string; lng: string } | null {
  const p = parseLatLng(text);
  return p ? { lat: String(p.lat), lng: String(p.lng) } : null;
}

export const PASTE_HINT = 'Paste the centre as "6.4759, 79.9842" or a Google Maps link.';

/** The centre of a typed row when both numbers are valid, for the "Open in Google Maps" link. */
export function centreOf(d: Pick<ZoneDraft, 'lat' | 'lng'>): { lat: number; lng: number } | null {
  const lat = number(d.lat);
  const lng = number(d.lng);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** True when the typed rows differ from what is stored (so "not saved yet" can show). */
export function zonesChanged(drafts: ReadonlyArray<ZoneDraft>, stored: ReadonlyArray<DeliveryZone>): boolean {
  if (drafts.length !== stored.length) return true;
  return drafts.some((d, i) => {
    const s = stored[i];
    return (
      d.id !== s.id ||
      d.name.trim() !== s.name ||
      number(d.lat) !== s.lat ||
      number(d.lng) !== s.lng ||
      number(d.radius.trim().replace(/\s*km$/i, '')) !== s.radius_km ||
      d.enabled !== s.enabled
    );
  });
}

/** "Beruwala, Aluthgama are on." / "No extra area is switched on." */
export function zonesSummary(zones: ReadonlyArray<Pick<DeliveryZone, 'name' | 'enabled'>>): string {
  const on = zones.filter((z) => z.enabled).map((z) => z.name);
  if (on.length === 0) return 'No extra area is switched on.';
  return `${on.join(', ')} ${on.length === 1 ? 'is' : 'are'} on.`;
}
