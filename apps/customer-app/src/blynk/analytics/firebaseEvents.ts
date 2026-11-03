import { isPiiKey, sanitize } from './privacy';

/*
 * dataLayer entry -> Google Analytics for Firebase event. The app describes what happened once, in
 * GA4 vocabulary (track.ts: view_item, add_to_cart, purchase, search, share, login, ...), and the
 * web pushes it to the dataLayer as is; on the phone this turns the same entry into
 * `logEvent(name, params)`. Pure.
 *
 * - `ecommerce: {currency, value, items, ...}` is flattened into the event's parameters (the
 *   native SDK has no ecommerce object); `items` stay an array of objects.
 * - Personal keys are dropped (privacy.ts) a second time, even though track.ts already sanitized.
 * - Firebase's limits are applied: names and keys 40 characters of [A-Za-z0-9_] starting with a
 *   letter, not `firebase_` / `google_` / `ga_`; values 100 characters; 25 parameters; booleans
 *   become 'true'/'false'.
 * - Not sent as parameters: `event`, `user_id` (set with setUserId), `app_language` / `app_mode`
 *   (user properties) and `page_view` itself (the phone reports `screen_view`, see screenView).
 */

export type FirebaseEvent = { name: string; params: Record<string, unknown> };

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const RESERVED = /^(firebase_|google_|ga_)/i;
const STRING_MAX = 100;
const PARAMS_MAX = 25;
const ITEMS_MAX = 100;
/** Entry keys that are not event parameters. */
const NOT_PARAMS = new Set(['event', 'ecommerce', 'user_id', 'app_language', 'app_mode']);
/** Events the dataLayer has that the phone does not send (or sends differently). */
const NOT_SENT = new Set(['page_view']);

const validKey = (k: string) => NAME.test(k) && !RESERVED.test(k);

/** A parameter value Firebase accepts: a short string or a finite number; anything else is dropped (undefined). */
function scalar(v: unknown): string | number | undefined {
  if (typeof v === 'string') return v.length > STRING_MAX ? v.slice(0, STRING_MAX) : v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return undefined;
}

function cleanItem(item: unknown): Record<string, string | number> | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (!validKey(k) || isPiiKey(k)) continue;
    const s = scalar(v);
    if (s !== undefined) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

function cleanItems(items: unknown): Record<string, string | number>[] | undefined {
  if (!Array.isArray(items)) return undefined;
  return items.slice(0, ITEMS_MAX).map(cleanItem).filter((i): i is Record<string, string | number> => i !== null);
}

/** The Firebase event for a (sanitized) dataLayer entry, or null when the phone does not send it. */
export function toFirebaseEvent(entry: Record<string, unknown>): FirebaseEvent | null {
  const name = entry.event;
  if (typeof name !== 'string' || !validKey(name) || NOT_SENT.has(name)) return null;
  const flat: Record<string, unknown> = {};
  const eco = entry.ecommerce;
  if (eco && typeof eco === 'object' && !Array.isArray(eco)) Object.assign(flat, eco);
  for (const [k, v] of Object.entries(sanitize(entry))) if (!NOT_PARAMS.has(k)) flat[k] = v;

  const params: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(flat)) {
    if (n >= PARAMS_MAX) break;
    if (!validKey(k) || isPiiKey(k) || NOT_PARAMS.has(k)) continue;
    if (k === 'items') {
      const items = cleanItems(v);
      if (items) { params.items = items; n++; }
      continue;
    }
    const s = scalar(v);
    if (s !== undefined) { params[k] = s; n++; }
  }
  return { name, params };
}

/** The route as a screen class: ids collapse (`/p/123` -> `/p/:id`), the rest stays (`/cart`). */
export function screenClassOf(route: string): string {
  const path = route.split('?')[0] || '/';
  const m = /^\/(p|category|order|track|store|doctors)\/[^/]+/.exec(path);
  return m ? `/${m[1]}/:id` : path;
}

/** `screen_view` for a route: the readable screen title (no " | Blynk"), the collapsed route as the class. */
export function screenView(route: string, title: string): FirebaseEvent {
  return {
    name: 'screen_view',
    params: { screen_name: title.replace(/\s*\|\s*Blynk$/, '') || 'Blynk', screen_class: screenClassOf(route) },
  };
}
