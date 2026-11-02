/// <reference types="vite/client" />
import { afterEach, describe, expect, test } from 'vitest';
import { MAP_STYLE, MAP_ZOOM, MAPLIBRE_CSS, MAPLIBRE_JS } from '@/blynk/address/maplibre';
import { circleRing, coverageOf, zoneRing } from '@/blynk/area/coverage';
import { setLang } from '@/blynk/i18n/lang';
import { C } from '@/lib/theme';
import { createMapBridge, LOAD_TIMEOUT_MS, MAX_QUEUE, type MapState, type Timers } from './bridge';
import { fitPoints } from './camera';
import { buildMapHtml, MAP_BASE_URL, MAPLIBRE_CSS_SRI, MAPLIBRE_JS_SRI, pageConfig, safeJson } from './html';
import { DOOR_SVG, riderSvg } from './markers';
import { coverageOverlay, lineOf, routeOverlay } from './overlays';
import { PAGE_SCRIPT } from './pageScript';
import {
  encodeToPage, isValidToPage, MAX_FROM_PAGE_CHARS, parseFromPage, PROTOCOL_SRC, PROTOCOL_VERSION, type ToPage,
} from './protocol';
import { allowNavigation, BASE_ORIGIN, CDN_ORIGIN, ORIGIN_WHITELIST, TILE_ORIGIN, WEBVIEW_HARDENING } from './webviewProps';

afterEach(() => setLang('en'));

const STORE = { radius_km: 4, store_location: { lat: 6.441313, lng: 80.011437 }, hub_name: 'Dharga Town Central Dark Store' };
const BERUWALA = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3 };
const cov = coverageOf(STORE);
const covZ = coverageOf({ ...STORE, delivery_zones: [BERUWALA] });
const NASTY = '</script><img src=x onerror=alert(1)> & "q"    ';
const covNasty = coverageOf({ ...STORE, delivery_zones: [{ ...BERUWALA, name: NASTY }] });

describe('shared overlays (the web picker and the phone page draw the same data)', () => {
  test('no zones: one group with the delivery circle and the store point, drawn as before', () => {
    const g = coverageOverlay(cov);
    expect(g).toHaveLength(1);
    expect(g[0]!.sources.map((s) => s.id)).toEqual(['blynk-area', 'blynk-store']);
    expect(g[0]!.layers.map((l) => l.id)).toEqual(['blynk-area-fill', 'blynk-area-line', 'blynk-store']);
    expect(g[0]!.sources[0]!.data).toEqual({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(cov)] } });
    expect(g[0]!.sources[1]!.data).toEqual({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [cov.center.lng, cov.center.lat] } });
    expect(g[0]!.layers[0]).toEqual({ id: 'blynk-area-fill', type: 'fill', source: 'blynk-area', paint: { 'fill-color': C.brand, 'fill-opacity': 0.12 } });
    expect(g[0]!.layers[1]!.paint).toEqual({ 'line-color': C.brandDeep, 'line-width': 2.5, 'line-dasharray': [3, 2] });
    expect(g[0]!.layers[2]!.paint).toEqual({ 'circle-radius': 7, 'circle-color': C.brand, 'circle-stroke-color': C.brandInk, 'circle-stroke-width': 2 });
  });

  test('with Beruwala: the zone ring, its outline and a name label follow, each in its own group', () => {
    const g = coverageOverlay(covZ);
    expect(g).toHaveLength(3);
    expect(g[1]!.sources[0]!.id).toBe('blynk-zones');
    expect(g[1]!.sources[0]!.data).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Beruwala' }, geometry: { type: 'Polygon', coordinates: [zoneRing(covZ.zones[0]!)] } }],
    });
    expect(g[1]!.layers.map((l) => l.id)).toEqual(['blynk-zones-fill', 'blynk-zones-line']);
    expect(g[2]!.sources[0]!.data).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Beruwala' }, geometry: { type: 'Point', coordinates: [79.9842, 6.4759] } }],
    });
    expect(g[2]!.layers[0]).toMatchObject({ id: 'blynk-zone-names', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'] } });
  });

  test('a hand-made coverage without zones still works', () => {
    expect(coverageOverlay({ ...cov, zones: undefined as never })).toHaveLength(1);
  });

  test('route: nothing for fewer than two points, a [lng, lat] line otherwise', () => {
    expect(lineOf([])).toEqual({ type: 'FeatureCollection', features: [] });
    expect(lineOf([[6.4, 80.0]])).toEqual({ type: 'FeatureCollection', features: [] });
    expect(lineOf([[6.4, 80.0], [6.5, 80.1]])).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[80.0, 6.4], [80.1, 6.5]] } }],
    });
    const r = routeOverlay();
    expect(r.sources).toEqual([{ id: 'route', data: { type: 'FeatureCollection', features: [] } }]);
    expect(r.layers.map((l) => l.id)).toEqual(['route-casing', 'route-line']);
    expect(r.layers[1]!.paint).toEqual({ 'line-color': C.brandInk, 'line-width': 4.5 });
  });

  test('markers: the door and the rider (grey when stale)', () => {
    expect(DOOR_SVG).toContain('#1A1D2E');
    expect(riderSvg(false)).toContain('fill="#FFE141"');
    expect(riderSvg(true)).toContain('fill="#C9CAD3"');
  });
});

describe('the map page (html.ts)', () => {
  const html = buildMapHtml({ lat: 6.44, lng: 80.01, zoom: 15, overlay: coverageOverlay(covZ), padding: { top: 0, bottom: 120, left: 12, right: 0 } });
  const cfgOf = (h: string) => {
    const m = /<script id="cfg" type="application\/json">([\s\S]*?)<\/script>/.exec(h);
    return JSON.parse(m![1]!);
  };

  test('loads the same MapLibre build (with integrity) and the same liberty style as the web code', () => {
    expect(html).toContain(`src="${MAPLIBRE_JS}"`);
    expect(html).toContain(`href="${MAPLIBRE_CSS}"`);
    expect(html).toContain(`integrity="${MAPLIBRE_JS_SRI}"`);
    expect(html).toContain(`integrity="${MAPLIBRE_CSS_SRI}"`);
    expect(MAPLIBRE_JS_SRI).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    expect(cfgOf(html).style).toBe(MAP_STYLE);
    expect(MAP_STYLE).toBe('https://tiles.openfreemap.org/styles/liberty');
  });

  test('carries the start spot, zoom limits, padding and the zone ring data', () => {
    const cfg = cfgOf(html);
    expect(cfg).toMatchObject({ lat: 6.44, lng: 80.01, zoom: 15, minZoom: MAP_ZOOM.min, maxZoom: MAP_ZOOM.max, cooperative: false });
    expect(cfg.padding).toEqual({ top: 0, bottom: 120, left: 12, right: 0 });
    expect(cfg.overlay).toEqual(JSON.parse(JSON.stringify(coverageOverlay(covZ))));
    const zoneRingJson = JSON.stringify(zoneRing(covZ.zones[0]!));
    expect(JSON.stringify(cfg.overlay)).toContain(zoneRingJson);
  });

  test('zone names are only text: no script can be closed or opened from them', () => {
    const h = buildMapHtml({ lat: 6.44, lng: 80.01, zoom: 15, overlay: coverageOverlay(covNasty) });
    // exactly the three real script elements (settings, library, page)
    expect(h.match(/<\/script>/g)).toHaveLength(3);
    expect(h).not.toContain('<img');
    expect(h).not.toContain(' ');
    expect(h).not.toContain(' ');
    const names = JSON.stringify(cfgOf(h).overlay);
    expect(names).toContain('onerror=alert(1)'); // still there as data
    const zone = cfgOf(h).overlay[1].sources[0].data.features[0].properties.name;
    expect(zone).toBe(NASTY.trim()); // parseZones trims the ends; everything inside survives as data
    // the other two things that open or close markup
    expect(safeJson({ a: '<>&' })).toBe('{"a":"\\u003c\\u003e\\u0026"}');
  });

  test('the page script itself cannot end its own <script>', () => {
    expect(PAGE_SCRIPT).not.toMatch(/<\/script/i);
    expect(PAGE_SCRIPT).not.toContain('`');
  });

  test('bad numbers fall back to safe ones instead of reaching the map', () => {
    const cfg = pageConfig({ lat: NaN, lng: 999, zoom: -3, padding: { top: -1, bottom: Infinity, left: 5, right: 'x' as never } });
    expect(cfg.lat).toBeCloseTo(6.44, 1);
    expect(cfg.lng).toBeCloseTo(80.01, 1);
    expect(cfg.zoom).toBe(MAP_ZOOM.start);
    expect(cfg.padding).toEqual({ top: 0, bottom: 0, left: 5, right: 0 });
  });

  test('a small map inside a scrolling screen asks for two fingers, in the customer language', () => {
    expect(cfgOf(buildMapHtml({ lat: 6.44, lng: 80.01, zoom: 15, cooperative: true }))).toMatchObject({ cooperative: true, twoFingers: 'Use two fingers to move the map' });
    setLang('si');
    expect(pageConfig({ lat: 6.44, lng: 80.01, zoom: 15 }).twoFingers).toMatch(/[඀-෿]/);
    setLang('ta');
    expect(pageConfig({ lat: 6.44, lng: 80.01, zoom: 15 }).twoFingers).toMatch(/[஀-௿]/);
  });

  test('the markers and a stale rider are in the settings as fixed SVG', () => {
    const cfg = cfgOf(html);
    expect(cfg.svg).toEqual({ door: DOOR_SVG, rider: riderSvg(false), riderStale: riderSvg(true) });
  });

  test('a CSS or script that fails to load is reported by the page (flag set by the link)', () => {
    expect(html).toContain('onerror="window.__blynkCssFailed=1"');
    expect(html).toContain("object-src 'none'; base-uri 'none'; form-action 'none'");
  });
});

describe('WebView hardening', () => {
  test('only the page, the tile host and the CDN may be loaded; no file access, no extra windows, no storage', () => {
    expect(WEBVIEW_HARDENING).toMatchObject({
      javaScriptEnabled: true, allowFileAccess: false, allowFileAccessFromFileURLs: false, allowUniversalAccessFromFileURLs: false,
      setSupportMultipleWindows: false, javaScriptCanOpenWindowsAutomatically: false, domStorageEnabled: false,
      geolocationEnabled: false, mixedContentMode: 'never', thirdPartyCookiesEnabled: false, scrollEnabled: false,
    });
    expect(ORIGIN_WHITELIST).toEqual(['about:blank', 'https://blynk.lk', 'https://tiles.openfreemap.org', 'https://unpkg.com']);
    expect([BASE_ORIGIN, TILE_ORIGIN, CDN_ORIGIN]).toEqual(['https://blynk.lk', 'https://tiles.openfreemap.org', 'https://unpkg.com']);
    expect(MAP_BASE_URL.startsWith('https://')).toBe(true);
  });

  test('navigation: only the page itself; look-alike hosts, other schemes and links are refused', () => {
    expect(allowNavigation('about:blank')).toBe(true);
    expect(allowNavigation('https://blynk.lk/')).toBe(true);
    expect(allowNavigation('https://blynk.lk')).toBe(true);
    expect(allowNavigation('HTTPS://BLYNK.LK/')).toBe(true);
    for (const bad of [
      'https://blynk.lk.evil.com/', 'https://blynk.lk@evil.com/', 'https://evil.com/', 'https://blynk.lk/app', 'https://blynk.lk/?x=1',
      'http://blynk.lk/', 'https://tiles.openfreemap.org/', 'https://unpkg.com/x.js', 'javascript:alert(1)', 'intent://x#Intent;end',
      'file:///etc/passwd', 'data:text/html,<b>x</b>', 'tel:+94770000000', '', null, undefined, 42,
    ]) expect(allowNavigation(bad)).toBe(false);
  });
});

describe('the message protocol', () => {
  /** Run the injected script against a fake window and return what the page would be handed. */
  const received = (msg: ToPage): unknown => {
    const calls: unknown[] = [];
    new Function('window', encodeToPage(msg))({ blynkMapReceive: (s: string) => calls.push(s) });
    expect(calls).toHaveLength(1);
    expect(typeof calls[0]).toBe('string');
    return JSON.parse(calls[0] as string);
  };

  test('encodeToPage hands the page one JSON string, tagged with our name and version', () => {
    expect(received({ t: 'resize' })).toEqual({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, t: 'resize' });
    expect(encodeToPage({ t: 'resize' }).endsWith('true;')).toBe(true);
    const m: ToPage = { t: 'marker', id: 'rider', lat: 6.4, lng: 80, stale: true, heading: 90, glide: true, label: NASTY };
    expect(received(m)).toEqual({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, ...m });
    // a missing bridge in the page is a no-op, not an exception
    expect(() => new Function('window', encodeToPage({ t: 'resize' }))({})).not.toThrow();
  });

  test('app -> page validation', () => {
    const ok: ToPage[] = [
      { t: 'camera', mode: 'ease', lat: 6.4, lng: 80, zoom: 17, duration: 600 },
      { t: 'camera', mode: 'jump', zoom: 15 },
      { t: 'padding', top: 0, bottom: 100, left: 12, right: 0 },
      { t: 'fit', west: 80, south: 6.4, east: 80.1, north: 6.5, padding: 56, maxZoom: 16.5, duration: 700 },
      { t: 'overlay', groups: [] },
      { t: 'setData', id: 'route', data: lineOf([]) },
      { t: 'marker', id: 'door', lat: 6.4, lng: 80 },
      { t: 'marker', id: 'rider', lat: 6.4, lng: 80, heading: null },
      { t: 'removeMarker', id: 'rider' },
      { t: 'resize' },
    ];
    ok.forEach((m) => expect(isValidToPage(m)).toBe(true));
    const bad: unknown[] = [
      null, 'x', [], {}, { t: 'nope' },
      { t: 'camera', mode: 'fly' }, { t: 'camera', mode: 'ease', lat: 6.4 }, { t: 'camera', mode: 'ease', lat: 91, lng: 80 },
      { t: 'camera', mode: 'ease', lat: NaN, lng: 80 }, { t: 'camera', mode: 'ease', zoom: 99 }, { t: 'camera', mode: 'ease', duration: -1 },
      { t: 'padding', top: -1, bottom: 0, left: 0, right: 0 }, { t: 'padding', top: 0, bottom: 0, left: 0 },
      { t: 'fit', west: 81, south: 6.4, east: 80, north: 6.5, padding: 1, maxZoom: 16, duration: 1 },
      { t: 'overlay', groups: 'x' }, { t: 'setData', id: '', data: {} }, { t: 'setData', id: 'route', data: 'x' },
      { t: 'marker', id: 'pin', lat: 6.4, lng: 80 }, { t: 'marker', id: 'door', lat: 6.4, lng: 181 }, { t: 'marker', id: 'door', lat: 6.4, lng: 80, label: 'x'.repeat(200) },
      { t: 'marker', id: 'rider', lat: 6.4, lng: 80, heading: 1e9 }, { t: 'removeMarker', id: 'x' },
    ];
    bad.forEach((m) => expect(isValidToPage(m), JSON.stringify(m)).toBe(false));
  });

  const wire = (o: Record<string, unknown>) => JSON.stringify({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, ...o });

  test('page -> app: our messages parse', () => {
    expect(parseFromPage(wire({ t: 'ready' }))).toEqual({ t: 'ready' });
    expect(parseFromPage(wire({ t: 'moveStart', user: true }))).toEqual({ t: 'moveStart', user: true });
    expect(parseFromPage(wire({ t: 'moveEnd', lat: 6.44, lng: 80.01, zoom: 16.2 }))).toEqual({ t: 'moveEnd', lat: 6.44, lng: 80.01, zoom: 16.2 });
    expect(parseFromPage(wire({ t: 'userMove' }))).toEqual({ t: 'userMove' });
    expect(parseFromPage(wire({ t: 'error', reason: 'script' }))).toEqual({ t: 'error', reason: 'script' });
  });

  test('page -> app: anything else is ignored, never thrown on', () => {
    const bad: unknown[] = [
      undefined, null, 42, {}, [], '', 'hello', '{', 'null', '[]', '"x"',
      JSON.stringify({ t: 'ready' }), // no src
      JSON.stringify({ src: 'other', v: 1, t: 'ready' }), JSON.stringify({ src: PROTOCOL_SRC, v: 2, t: 'ready' }),
      wire({ t: 'nope' }), wire({}), wire({ t: 'moveStart' }), wire({ t: 'moveStart', user: 'yes' }),
      wire({ t: 'moveEnd', lat: 91, lng: 80, zoom: 10 }), wire({ t: 'moveEnd', lat: 6, lng: 181, zoom: 10 }),
      wire({ t: 'moveEnd', lat: 6, lng: 80, zoom: 99 }), wire({ t: 'moveEnd', lat: '6', lng: 80, zoom: 10 }), wire({ t: 'moveEnd', lat: null, lng: 80, zoom: 10 }),
      wire({ t: 'error', reason: 'whatever' }), wire({ t: 'error' }),
      wire({ t: 'ready', pad: 'x'.repeat(MAX_FROM_PAGE_CHARS) }),
    ];
    bad.forEach((m) => expect(parseFromPage(m), String(m)).toBeNull());
    expect(parseFromPage('{"src":"blynk-map","v":1,"t":"moveEnd","lat":1e999,"lng":0,"zoom":1}')).toBeNull();
  });
});

describe('the bridge (state, timer, queue, parsing)', () => {
  const wire = (o: Record<string, unknown>) => JSON.stringify({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, ...o });

  function setup(timeoutMs = LOAD_TIMEOUT_MS) {
    const injected: string[] = [];
    const states: [MapState, string | undefined][] = [];
    const events: unknown[] = [];
    const pending = new Map<number, { fn: () => void; ms: number }>();
    let next = 1;
    const timers: Timers = {
      set: (fn, ms) => { pending.set(next, { fn, ms }); return next++; },
      clear: (h) => { pending.delete(h as number); },
    };
    const bridge = createMapBridge({
      inject: (js) => injected.push(js),
      onState: (s, why) => states.push([s, why]),
      onEvent: (e) => events.push(e),
      timeoutMs,
      timers,
    });
    return { bridge, injected, states, events, pending };
  }
  const sentTypes = (injected: string[]) => injected.map((js) => JSON.parse(JSON.parse(/blynkMapReceive\((.*)\);true;$/.exec(js)![1]!)).t);

  test('commands wait for ready (newest of each kind wins), then go out in order', () => {
    const { bridge, injected, states } = setup();
    bridge.start();
    bridge.send({ t: 'marker', id: 'door', lat: 6.4, lng: 80 });
    bridge.send({ t: 'camera', mode: 'jump', lat: 6.4, lng: 80 });
    bridge.send({ t: 'camera', mode: 'jump', lat: 6.5, lng: 80.1 });
    bridge.send({ t: 'setData', id: 'route', data: lineOf([]) });
    bridge.send({ t: 'setData', id: 'route', data: lineOf([[6.4, 80], [6.5, 80.1]]) });
    expect(injected).toEqual([]);
    expect(bridge.state()).toBe('loading');
    bridge.receive(wire({ t: 'ready' }));
    expect(states).toEqual([['ready', undefined]]);
    expect(sentTypes(injected)).toEqual(['marker', 'camera', 'setData']);
    expect(injected[1]).toContain('6.5'); // the second camera move replaced the first
    bridge.send({ t: 'resize' });
    expect(sentTypes(injected)).toEqual(['marker', 'camera', 'setData', 'resize']);
  });

  test('the queue is capped and invalid commands are dropped', () => {
    const { bridge, injected } = setup();
    for (let i = 0; i < MAX_QUEUE + 20; i++) bridge.send({ t: 'overlay', groups: [] });
    bridge.send({ t: 'camera', mode: 'jump', lat: 999, lng: 0 });
    bridge.send({ t: 'nope' } as never);
    bridge.receive(wire({ t: 'ready' }));
    expect(injected).toHaveLength(1); // same kind: one left
    // a queue of different kinds is capped too
    const b2 = setup();
    for (let i = 0; i < MAX_QUEUE + 5; i++) b2.bridge.send({ t: 'setData', id: `s${i}`, data: {} });
    b2.bridge.receive(wire({ t: 'ready' }));
    expect(b2.injected).toHaveLength(MAX_QUEUE);
  });

  test('no ready within 15 s: failed (the retry fallback); the timer is cleared by ready', () => {
    const a = setup();
    a.bridge.start();
    expect([...a.pending.values()].map((p) => p.ms)).toEqual([15_000]);
    [...a.pending.values()][0]!.fn();
    expect(a.states).toEqual([['failed', 'timeout']]);
    a.bridge.send({ t: 'resize' });
    a.bridge.receive(wire({ t: 'ready' }));
    expect(a.injected).toEqual([]);
    expect(a.bridge.state()).toBe('failed');

    const b = setup();
    b.bridge.start();
    b.bridge.receive(wire({ t: 'ready' }));
    expect(b.pending.size).toBe(0);
  });

  test('a page that reports it could not draw fails at once; a later error does not undo a ready map', () => {
    const a = setup();
    a.bridge.start();
    a.bridge.receive(wire({ t: 'error', reason: 'script' }));
    expect(a.states).toEqual([['failed', 'script']]);
    expect(a.pending.size).toBe(0);

    const b = setup();
    b.bridge.start();
    b.bridge.receive(wire({ t: 'ready' }));
    b.bridge.receive(wire({ t: 'error', reason: 'style' }));
    expect(b.bridge.state()).toBe('ready');
  });

  test('the WebView failing (page error, render process gone) fails the map once', () => {
    const { bridge, states } = setup();
    bridge.start();
    bridge.fail('crashed');
    bridge.fail('webview');
    expect(states).toEqual([['failed', 'crashed']]);
  });

  test('map events reach the screen; foreign messages are ignored; stop silences everything', () => {
    const { bridge, events, injected, states } = setup();
    bridge.start();
    bridge.receive(wire({ t: 'moveStart', user: true }));
    bridge.receive(wire({ t: 'moveEnd', lat: 6.4, lng: 80, zoom: 16 }));
    bridge.receive(wire({ t: 'userMove' }));
    bridge.receive('garbage');
    bridge.receive(wire({ t: 'moveEnd', lat: 100, lng: 80, zoom: 16 }));
    expect(events).toEqual([{ t: 'moveStart', user: true }, { t: 'moveEnd', lat: 6.4, lng: 80, zoom: 16 }, { t: 'userMove' }]);
    bridge.stop();
    bridge.receive(wire({ t: 'ready' }));
    bridge.send({ t: 'resize' });
    expect(states).toEqual([]);
    expect(injected).toEqual([]);
    expect(events).toHaveLength(3);
    // restart (strict-mode effects run twice): the timer comes back
    bridge.start();
    bridge.receive(wire({ t: 'ready' }));
    expect(states).toEqual([['ready', undefined]]);
  });

  test('a WebView that throws on inject never breaks the screen', () => {
    const b = createMapBridge({ inject: () => { throw new Error('gone'); }, onState: () => {}, onEvent: () => {}, timers: { set: () => 0, clear: () => {} } });
    b.start();
    b.receive(wire({ t: 'ready' }));
    expect(() => b.send({ t: 'resize' })).not.toThrow();
  });
});

describe('camera', () => {
  test('fitPoints keeps the door and the rider in view', () => {
    expect(fitPoints([{ lat: 6.4, lng: 80.0 }, { lat: 6.5, lng: 80.2 }], { padding: 56, maxZoom: 16.5, duration: 700 })).toEqual({
      t: 'fit', west: 80.0, south: 6.4, east: 80.2, north: 6.5, padding: 56, maxZoom: 16.5, duration: 700,
    });
    expect(fitPoints([{ lat: NaN, lng: 1 }], { padding: 1, maxZoom: 1, duration: 1 })).toBeNull();
    expect(fitPoints([], { padding: 1, maxZoom: 1, duration: 1 })).toBeNull();
  });
});

describe('the pure map files stay free of React Native and Platform checks', () => {
  const files = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  test.each(Object.keys(files).filter((f) => !f.endsWith('.test.ts')))('%s', (f) => {
    expect(files[f]).not.toMatch(/from 'react-native/);
    expect(files[f]).not.toContain('Platform.OS');
  });
});

