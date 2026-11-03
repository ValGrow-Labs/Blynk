import { fetchRoute } from '../../routing/index.js';

type Point = { lat: number; lng: number };

/** Injectable for tests: the OSRM call. */
export const pushEtaDeps = {
  fetchRoute: (from: Point, to: Point) => fetchRoute(from, to),
};

/** How long the worker waits for the routing engine before it sends the push without a time. */
export const PUSH_ETA_TIMEOUT_MS = 2_500;

/** Whole minutes (at least 1) for a driving time in seconds, or null when it is not a usable time. */
export function etaMinutesFromSeconds(durationS: unknown): number | null {
  if (typeof durationS !== 'number' || !Number.isFinite(durationS) || durationS <= 0) return null;
  return Math.max(1, Math.round(durationS / 60));
}

function point(v: unknown): Point | null {
  const p = v as { lat?: unknown; lng?: unknown } | null | undefined;
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return { lat: p.lat, lng: p.lng };
}

/**
 * The "on the way" push's driving time, resolved by the outbox worker when it sends (after the
 * order transaction has committed, so a slow routing engine never holds an order lock). The
 * payload carries `eta_route` ({from, to}: the one pickup point and the customer's door) and
 * `body_with_eta` (the text with a `{min}` placeholder). Returns the body to send: the one with
 * the minutes when OSRM answers in time, the plain `body` otherwise - never a guessed time.
 */
export async function bodyWithEta(payload: { body: string; eta_route?: unknown; body_with_eta?: unknown }): Promise<string> {
  const route = payload.eta_route as { from?: unknown; to?: unknown } | null | undefined;
  const template = payload.body_with_eta;
  if (!route || typeof template !== 'string' || !template.includes('{min}')) return payload.body;
  const from = point(route.from);
  const to = point(route.to);
  if (!from || !to) return payload.body;
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('routing timeout')), PUSH_ETA_TIMEOUT_MS);
    });
    const result = await Promise.race([pushEtaDeps.fetchRoute(from, to), timeout]).finally(() => clearTimeout(timer));
    const minutes = etaMinutesFromSeconds(result.duration_s);
    return minutes === null ? payload.body : template.replace('{min}', String(minutes));
  } catch {
    return payload.body;
  }
}
