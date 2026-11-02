import type { GeoJsonObject, OverlayGroup } from './overlays';

/*
 * The message protocol between the app and the map page running inside the phone's WebView.
 *
 *  - page -> app: `window.ReactNativeWebView.postMessage(JSON string)`, read by `parseFromPage`;
 *  - app -> page: `injectJavaScript` calling `window.blynkMapReceive(<JSON string>)`, built by
 *    `encodeToPage` (a call is more dependable than the WebView's own postMessage, which reaches
 *    `document` on Android and `window` on iOS).
 *
 * Every message is one JSON object `{ src: 'blynk-map', v: 1, t: <type>, ... }`. Anything else is ignored.
 * Numbers are checked on both sides (finite and in range) before they reach the map. Pure: no React Native.
 */

export const PROTOCOL_SRC = 'blynk-map';
export const PROTOCOL_VERSION = 1;
/** A message longer than this is dropped unread (the biggest legitimate one is a few hundred bytes). */
export const MAX_FROM_PAGE_CHARS = 2000;

export type Padding = { top: number; bottom: number; left: number; right: number };
export type MarkerId = 'door' | 'rider';
export const MARKER_IDS: readonly MarkerId[] = ['door', 'rider'];

/** App -> page. */
export type ToPage =
  | { t: 'camera'; mode: 'ease' | 'jump'; lat?: number; lng?: number; zoom?: number; duration?: number }
  | ({ t: 'padding' } & Padding)
  | { t: 'fit'; west: number; south: number; east: number; north: number; padding: number; maxZoom: number; duration: number }
  | { t: 'overlay'; groups: OverlayGroup[] }
  | { t: 'setData'; id: string; data: GeoJsonObject }
  | { t: 'marker'; id: MarkerId; lat: number; lng: number; stale?: boolean; heading?: number | null; glide?: boolean; label?: string }
  | { t: 'removeMarker'; id: MarkerId }
  | { t: 'resize' };

/** Why the page could not draw a map. */
export type MapFailure = 'script' | 'style' | 'init';

/** Page -> app. */
export type FromPage =
  | { t: 'ready' }
  | { t: 'moveStart'; user: boolean }
  | { t: 'moveEnd'; lat: number; lng: number; zoom: number }
  | { t: 'userMove' }
  | { t: 'error'; reason: MapFailure };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
export const isLat = (v: unknown): v is number => inRange(v, -90, 90);
export const isLng = (v: unknown): v is number => inRange(v, -180, 180);
export const isZoom = (v: unknown): v is number => inRange(v, 0, 24);
const isDuration = (v: unknown): v is number => inRange(v, 0, 10_000);
const isPad = (v: unknown): v is number => inRange(v, 0, 5000);
const optional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);

/** Is this app -> page message well formed (numbers finite and in range, known marker)? */
export function isValidToPage(m: unknown): m is ToPage {
  if (!isObj(m)) return false;
  switch (m.t) {
    case 'camera':
      return (m.mode === 'ease' || m.mode === 'jump')
        && (m.lat === undefined) === (m.lng === undefined)
        && optional(m.lat, isLat) && optional(m.lng, isLng) && optional(m.zoom, isZoom) && optional(m.duration, isDuration);
    case 'padding':
      return isPad(m.top) && isPad(m.bottom) && isPad(m.left) && isPad(m.right);
    case 'fit':
      return isLng(m.west) && isLng(m.east) && isLat(m.south) && isLat(m.north) && m.west <= m.east && m.south <= m.north
        && isPad(m.padding) && isZoom(m.maxZoom) && isDuration(m.duration);
    case 'overlay':
      return Array.isArray(m.groups);
    case 'setData':
      return typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 64 && isObj(m.data);
    case 'marker':
      return MARKER_IDS.includes(m.id as MarkerId) && isLat(m.lat) && isLng(m.lng)
        && optional(m.stale, (x) => typeof x === 'boolean')
        && optional(m.glide, (x) => typeof x === 'boolean')
        && (m.heading === undefined || m.heading === null || inRange(m.heading, -720, 720))
        && optional(m.label, (x) => typeof x === 'string' && (x as string).length <= 80);
    case 'removeMarker':
      return MARKER_IDS.includes(m.id as MarkerId);
    case 'resize':
      return true;
    default:
      return false;
  }
}

/** A JS string literal for `s` that is safe inside injected script (JSON, plus the two line separators). */
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');
const jsLiteral = (s: string) => JSON.stringify(s).replace(LINE_SEP, '\\u2028').replace(PARA_SEP, '\\u2029');

/** The script to hand to `injectJavaScript` so the page receives `msg`. Ends in `true;` as the WebView wants. */
export function encodeToPage(msg: ToPage): string {
  const json = JSON.stringify({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, ...msg });
  return `window.blynkMapReceive&&window.blynkMapReceive(${jsLiteral(json)});true;`;
}

/** What `raw` (the WebView's `nativeEvent.data`) is, if it is one of OUR page -> app messages; else null. Never throws. */
export function parseFromPage(raw: unknown): FromPage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_FROM_PAGE_CHARS) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!isObj(m) || m.src !== PROTOCOL_SRC || m.v !== PROTOCOL_VERSION) return null;
  switch (m.t) {
    case 'ready':
      return { t: 'ready' };
    case 'moveStart':
      return typeof m.user === 'boolean' ? { t: 'moveStart', user: m.user } : null;
    case 'moveEnd':
      return isLat(m.lat) && isLng(m.lng) && isZoom(m.zoom) ? { t: 'moveEnd', lat: m.lat, lng: m.lng, zoom: m.zoom } : null;
    case 'userMove':
      return { t: 'userMove' };
    case 'error':
      return m.reason === 'script' || m.reason === 'style' || m.reason === 'init' ? { t: 'error', reason: m.reason } : null;
    default:
      return null;
  }
}
