import type { DeliveryZone } from '../api/types';
import { parsePastedPoint } from './sellers';

/**
 * Extra delivery areas (owner's brother, 2026-11-01; docs/superpowers/plans/2026-11-01-extra-delivery-areas.md):
 * `GET|PUT /admin/settings/delivery-zones` `{ zones: [{ id, name, lat, lng, radius_km, enabled }] }`. The main delivery
 * area stays the circle around the store (Delivery radius); each zone is a separate circle (Beruwala first) that
 * customers can also order from while it is switched on. The server's rules are mirrored here for inline messages.
 */
export const MAX_ZONES = 10;
export const MAX_ZONE_NAME = 40;
export const MIN_ZONE_RADIUS_KM = 0.5;
export const MAX_ZONE_RADIUS_KM = 15;
/** Sri Lanka box the server accepts. */
export const ZONE_LAT = { min: 5, max: 10 } as const;
export const ZONE_LNG = { min: 78, max: 83 } as const;

/** A row of the card as typed: numbers stay text until saved. */
export interface ZoneDraft {
  /** Stable React key. */
  key: string;
  /** The server's id for a saved zone; '' for one added here (made from the name on save). */
  id: string;
  name: string;
  lat: string;
  lng: string;
  radius: string;
  enabled: boolean;
}

export interface ZoneRowErrors {
  name?: string;
  lat?: string;
  lng?: string;
  radius?: string;
}

const trimNumber = (n: number) => String(Number(n.toFixed(6)));

export function draftFromZone(zone: DeliveryZone, key: string): ZoneDraft {
  return {
    key,
    id: zone.id,
    name: zone.name,
    lat: trimNumber(zone.lat),
    lng: trimNumber(zone.lng),
    radius: String(Number(zone.radius_km.toFixed(2))),
    enabled: zone.enabled,
  };
}

/** A new row, on, with a 3 km circle to start from. */
export const newDraft = (key: string): ZoneDraft => ({ key, id: '', name: '', lat: '', lng: '', radius: '3', enabled: true });

/** "Beruwala Town!" -> "beruwala-town". */
export function zoneSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const plainNumber = /^-?\d+(\.\d+)?$/;

/** Latitude and longitude of a typed pair or pasted Google Maps text/link (the seller location parser). */
export const pointFromText = (text: string) => parsePastedPoint(text);

/** One row's problems (empty object when it is fine). */
export function zoneRowErrors(draft: ZoneDraft): ZoneRowErrors {
  const errors: ZoneRowErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Enter the name of the area, like Beruwala.';
  else if (name.length > MAX_ZONE_NAME) errors.name = `At most ${MAX_ZONE_NAME} characters.`;
  else if (!zoneSlug(name)) errors.name = 'Use letters or numbers in the name.';

  const lat = plainNumber.test(draft.lat.trim()) ? Number(draft.lat.trim()) : NaN;
  if (!Number.isFinite(lat) || lat < ZONE_LAT.min || lat > ZONE_LAT.max) {
    errors.lat = `Latitude is a number from ${ZONE_LAT.min} to ${ZONE_LAT.max}, like 6.4759.`;
  }
  const lng = plainNumber.test(draft.lng.trim()) ? Number(draft.lng.trim()) : NaN;
  if (!Number.isFinite(lng) || lng < ZONE_LNG.min || lng > ZONE_LNG.max) {
    errors.lng = `Longitude is a number from ${ZONE_LNG.min} to ${ZONE_LNG.max}, like 79.9842.`;
  }

  const radiusText = draft.radius.trim().replace(/\s*km$/i, '').trim();
  if (!radiusText) errors.radius = 'Enter the radius in km, like 3.';
  else if (!/^\d+(\.\d+)?$/.test(radiusText)) errors.radius = 'Enter a number, like 3 or 2.5.';
  else if (!/^\d+(\.\d{1,2})?$/.test(radiusText)) errors.radius = 'Use at most 2 decimal places.';
  else if (Number(radiusText) < MIN_ZONE_RADIUS_KM || Number(radiusText) > MAX_ZONE_RADIUS_KM) {
    errors.radius = `The radius must be between ${MIN_ZONE_RADIUS_KM} and ${MAX_ZONE_RADIUS_KM} km.`;
  }
  return errors;
}

/** The ids of the rows: a saved row keeps its id; a new one is the slug of its name, made unique (-2, -3, ...). */
function assignIds(drafts: ZoneDraft[]): string[] {
  const taken = new Set(drafts.map((d) => d.id).filter(Boolean));
  return drafts.map((d) => {
    if (d.id) return d.id;
    const base = zoneSlug(d.name);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return id;
  });
}

/**
 * The card read into the PUT body, or the problems per row (by draft key) plus one list-level problem (too many
 * areas, or two with the same name).
 */
export function zonesBody(
  drafts: ZoneDraft[]
): { body: { zones: DeliveryZone[] } } | { errors: Record<string, ZoneRowErrors>; listError?: string } {
  const errors: Record<string, ZoneRowErrors> = {};
  let listError: string | undefined;
  if (drafts.length > MAX_ZONES) listError = `At most ${MAX_ZONES} extra areas.`;
  const seen = new Map<string, string>();
  for (const d of drafts) {
    const rowErrors = zoneRowErrors(d);
    const slug = zoneSlug(d.name);
    if (!rowErrors.name && slug) {
      const first = seen.get(slug);
      if (first !== undefined) rowErrors.name = 'Another area already has this name.';
      else seen.set(slug, d.key);
    }
    if (Object.keys(rowErrors).length > 0) errors[d.key] = rowErrors;
  }
  if (Object.keys(errors).length > 0 || listError) return { errors, ...(listError ? { listError } : {}) };

  const ids = assignIds(drafts);
  return {
    body: {
      zones: drafts.map((d, i) => ({
        id: ids[i],
        name: d.name.trim(),
        lat: Number(d.lat.trim()),
        lng: Number(d.lng.trim()),
        radius_km: Number(d.radius.trim().replace(/\s*km$/i, '').trim()),
        enabled: d.enabled,
      })),
    },
  };
}

/** The point a row's centre fields hold, when both are valid numbers (for the Google Maps link). */
export function draftPoint(draft: ZoneDraft): { lat: number; lng: number } | null {
  if (!plainNumber.test(draft.lat.trim()) || !plainNumber.test(draft.lng.trim())) return null;
  const lat = Number(draft.lat.trim());
  const lng = Number(draft.lng.trim());
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** How many areas are switched on, for the card's summary line. */
export const enabledCount = (zones: Pick<DeliveryZone, 'enabled'>[]) => zones.filter((z) => z.enabled).length;
