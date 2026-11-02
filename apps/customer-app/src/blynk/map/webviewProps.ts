import { MAPLIBRE_CSS, MAPLIBRE_JS, MAP_STYLE } from '@/blynk/address/maplibre';
import { MAP_BASE_URL } from './html';

/*
 * How locked down the map WebView is. The page needs JavaScript and the network (scripts and tiles from
 * two hosts) and nothing else: no files, no other windows, no storage, no geolocation, no mixed content,
 * and it can never leave its own page (a link the page could ever show is not followed; the attribution
 * text is drawn by the app, not by the page). Pure so the choices are pinned by tests; NativeMapView spreads them.
 */

const originOf = (url: string): string => /^https:\/\/[^/?#]+/i.exec(url)?.[0].toLowerCase() ?? '';
export const BASE_ORIGIN = originOf(MAP_BASE_URL);
export const TILE_ORIGIN = originOf(MAP_STYLE);
export const CDN_ORIGIN = originOf(MAPLIBRE_JS);

/** The WebView's coarse check (a prefix match on scheme + host); `allowNavigation` is the strict one. */
export const ORIGIN_WHITELIST = ['about:blank', BASE_ORIGIN, TILE_ORIGIN, CDN_ORIGIN];

/**
 * May the WebView load this address as a page? Only the page itself (its base address, which iOS asks
 * about) or about:blank. Anything else is refused, and not handed to the system browser either.
 */
export function allowNavigation(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  if (url === 'about:blank') return true;
  const m = /^(https:\/\/[^/?#]+)\/?$/i.exec(url);
  return !!m && m[1]!.toLowerCase() === BASE_ORIGIN;
}

export const WEBVIEW_HARDENING = {
  originWhitelist: ORIGIN_WHITELIST,
  javaScriptEnabled: true,
  domStorageEnabled: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  geolocationEnabled: false,
  setSupportMultipleWindows: false,
  javaScriptCanOpenWindowsAutomatically: false,
  mixedContentMode: 'never',
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  saveFormDataDisabled: true,
  allowsLinkPreview: false,
  allowsInlineMediaPlayback: false,
  // a map, not a document: no zoom bars, no overscroll glow, the page itself never scrolls
  setBuiltInZoomControls: false,
  setDisplayZoomControls: false,
  scalesPageToFit: false,
  scrollEnabled: false,
  bounces: false,
  overScrollMode: 'never',
  nestedScrollEnabled: true,
  textZoom: 100,
  androidLayerType: 'hardware',
  cacheEnabled: true,
} as const;

/** What the page may fetch, for the record and the tests. */
export const MAP_ASSET_URLS = [MAPLIBRE_JS, MAPLIBRE_CSS, MAP_STYLE] as const;
