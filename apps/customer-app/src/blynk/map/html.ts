import { CLOCK_TOWER } from '@/blynk/area/places';
import { MAP_STYLE, MAP_ZOOM, MAPLIBRE_CSS, MAPLIBRE_JS } from '@/blynk/address/maplibre';
import { DOOR_SVG, riderSvg } from './markers';
import type { OverlayGroup } from './overlays';
import { PAGE_SCRIPT } from './pageScript';
import type { Padding } from './protocol';
import { MAP_WORDS } from './words';

/*
 * The HTML page the phone's WebView shows: the same MapLibre GL JS build and OpenFreeMap "liberty" style
 * as the web screens (src/blynk/address/maplibre.ts), with the page's script (./pageScript.ts) and its
 * settings as JSON. Pure: a string in, a string out. Everything that varies (start spot, zoom, the delivery
 * area with the customer-facing zone names) goes into the JSON, never into the markup or the script, and
 * the JSON is escaped so a name like `</script><img onerror=...>` is only text.
 */

/** Subresource Integrity of the pinned (immutable) unpkg files: a changed file does not run. */
export const MAPLIBRE_JS_SRI = 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj';
export const MAPLIBRE_CSS_SRI = 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V';

/** The page's own address (so it has a real https origin for the tile requests); nothing is ever fetched from it. */
export const MAP_BASE_URL = 'https://blynk.lk/';

export type MapHtmlOptions = {
  lat: number;
  lng: number;
  zoom: number;
  padding?: Padding;
  minZoom?: number;
  maxZoom?: number;
  /** Drawn once the style has loaded (the delivery area, the route). */
  overlay?: OverlayGroup[];
  /** A small map inside a scrolling screen: one finger scrolls the screen, two move the map. */
  cooperative?: boolean;
};

const ZERO_PAD: Padding = { top: 0, bottom: 0, left: 0, right: 0 };
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;

/** The settings object the page reads (exported for the tests). Bad numbers fall back to safe ones. */
export function pageConfig(o: MapHtmlOptions) {
  const p = o.padding ?? ZERO_PAD;
  return {
    style: MAP_STYLE,
    lat: num(o.lat, CLOCK_TOWER.lat, -90, 90),
    lng: num(o.lng, CLOCK_TOWER.lng, -180, 180),
    zoom: num(o.zoom, MAP_ZOOM.start, 0, 24),
    minZoom: num(o.minZoom, MAP_ZOOM.min, 0, 24),
    maxZoom: num(o.maxZoom, MAP_ZOOM.max, 0, 24),
    padding: {
      top: num(p.top, 0, 0, 5000), bottom: num(p.bottom, 0, 0, 5000), left: num(p.left, 0, 0, 5000), right: num(p.right, 0, 0, 5000),
    },
    overlay: o.overlay ?? [],
    cooperative: !!o.cooperative,
    twoFingers: MAP_WORDS.twoFingers,
    svg: { door: DOOR_SVG, rider: riderSvg(false), riderStale: riderSvg(true) },
  };
}

const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');

/** JSON that is safe inside <script type="application/json">: no `<`, `>`, `&` or line separators can end or open anything. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
}

export function buildMapHtml(o: MapHtmlOptions): string {
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    // no plugins, no <base>, no form posts; scripts and tiles are limited by the app's WebView settings instead
    '<meta http-equiv="Content-Security-Policy" content="object-src \'none\'; base-uri \'none\'; form-action \'none\'">',
    `<link rel="stylesheet" href="${MAPLIBRE_CSS}" integrity="${MAPLIBRE_CSS_SRI}" crossorigin="anonymous" onerror="window.__blynkCssFailed=1">`,
    '<style>',
    'html,body,#map{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#EFEBE3;}',
    'body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;}',
    '</style>',
    '</head><body>',
    '<div id="map"></div>',
    `<script id="cfg" type="application/json">${safeJson(pageConfig(o))}</script>`,
    `<script src="${MAPLIBRE_JS}" integrity="${MAPLIBRE_JS_SRI}" crossorigin="anonymous"></script>`,
    `<script>${PAGE_SCRIPT}</script>`,
    '</body></html>',
  ].join('\n');
}
