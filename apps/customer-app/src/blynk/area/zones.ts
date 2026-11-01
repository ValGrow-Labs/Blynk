import { localized } from '@/blynk/i18n/localized';

/*
 * Extra delivery areas (owner's brother, 2026-11-01: "I don't want the radius to be increased ... we have
 * to include Beruwala only"). The delivery area is the circle around the Blynk store PLUS these circles.
 * GET /store sends the ENABLED ones as `delivery_zones: [{ id, name, lat, lng, radius_km }]`; an older
 * server does not send the field (= none). The server decides in the end (422 DELIVERY_OUTSIDE_RADIUS);
 * this only draws and guides.
 */

export type Zone = { id: string; name: string; lat: number; lng: number; radiusKm: number };

/** The server allows at most 10 zones; so do we, whatever it sends. */
export const MAX_ZONES = 10;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The zones from GET /store, keeping only well-formed, enabled ones (a bad row is dropped, never thrown on). */
export function parseZones(raw: unknown): Zone[] {
  if (!Array.isArray(raw)) return [];
  const out: Zone[] = [];
  for (const z of raw) {
    const r = z as { id?: unknown; name?: unknown; lat?: unknown; lng?: unknown; radius_km?: unknown; enabled?: unknown } | null;
    if (!r || typeof r !== 'object' || r.enabled === false) continue;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || !finite(r.lat) || !finite(r.lng) || !finite(r.radius_km)) continue;
    if (Math.abs(r.lat) > 90 || Math.abs(r.lng) > 180 || r.radius_km <= 0 || r.radius_km > 100) continue;
    out.push({ id: typeof r.id === 'string' && r.id ? r.id : name.toLowerCase(), name, lat: r.lat, lng: r.lng, radiusKm: r.radius_km });
    if (out.length >= MAX_ZONES) break;
  }
  return out;
}

/** "A and B", "A, B and C" in the customer's language (the names themselves stay as the server sends them). */
const JOIN = localized(
  { and: (rest: string, last: string) => `${rest} and ${last}` },
  {
    si: { and: (rest: string, last: string) => `${rest} සහ ${last}` },
    ta: { and: (rest: string, last: string) => `${rest} மற்றும் ${last}` },
  },
  'area.JOIN',
);

export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return JOIN.and(names.slice(0, -1).join(', '), names[names.length - 1]!);
}

/** "Beruwala", "Beruwala and Kalutara", or '' when there is no extra area. */
export const zoneNames = (zones: readonly Pick<Zone, 'name'>[] | null | undefined): string => joinNames((zones ?? []).map((z) => z.name));
