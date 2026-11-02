import { describe, expect, test } from 'vitest';
import { coverageOf } from '@/blynk/area/coverage';
import { buildMapHtml, pageConfig, safeJson } from './html';
import { coverageOverlay, lineOf, routeOverlay } from './overlays';
import { PAGE_SCRIPT } from './pageScript';
import { encodeToPage, PROTOCOL_SRC, PROTOCOL_VERSION, type ToPage } from './protocol';

/*
 * The page script runs inside the phone's WebView, so here it runs against a fake window, document and
 * maplibre-gl: what it draws, what it posts back, and what it refuses.
 */

const STORE = { radius_km: 4, store_location: { lat: 6.441313, lng: 80.011437 }, hub_name: 'Dharga Town' };
const BERUWALA = { id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3 };

type Call = [string, ...unknown[]];

function fakeMapLibre(opts: { failOnSource?: string; throwOnConstruct?: boolean; styleLoaded?: boolean } = {}) {
  const log: Call[] = [];
  const handlers: Record<string, ((e?: unknown) => void)[]> = {};
  const sources = new Map<string, { setData: (d: unknown) => void; data: unknown }>();
  const layers = new Set<string>();
  const state = { center: { lat: 6.44, lng: 80.01 }, zoom: 15, styleLoaded: opts.styleLoaded ?? false };
  const markers: { opts: Record<string, unknown>; lngLat: [number, number]; rotation: number | null; removed: boolean }[] = [];
  let ctorOptions: Record<string, unknown> | null = null;

  class FakeMap {
    constructor(o: Record<string, unknown>) {
      if (opts.throwOnConstruct) throw new Error('no WebGL');
      ctorOptions = o;
    }
    touchZoomRotate = { disableRotation: () => log.push(['touchZoomRotate.disableRotation']) };
    keyboard = { disableRotation: () => log.push(['keyboard.disableRotation']) };
    on(ev: string, fn: (e?: unknown) => void) { (handlers[ev] ??= []).push(fn); }
    once(ev: string, fn: (e?: unknown) => void) { (handlers[ev] ??= []).push(fn); }
    setPadding(p: unknown) { log.push(['setPadding', p]); }
    jumpTo(o: unknown) { log.push(['jumpTo', o]); }
    easeTo(o: unknown) { log.push(['easeTo', o]); }
    fitBounds(b: unknown, o: unknown) { log.push(['fitBounds', b, o]); }
    resize() { log.push(['resize']); }
    getCenter() { return state.center; }
    getZoom() { return state.zoom; }
    isStyleLoaded() { return state.styleLoaded; }
    addSource(id: string, s: { data: unknown }) {
      if (id === opts.failOnSource) throw new Error('bad source');
      sources.set(id, { data: s.data, setData: (d) => { sources.get(id)!.data = d; log.push(['setData', id, d]); } });
      log.push(['addSource', id, s]);
    }
    addLayer(l: { id: string }) { layers.add(l.id); log.push(['addLayer', l]); }
    getSource(id: string) { return sources.get(id); }
    getLayer(id: string) { return layers.has(id) ? { id } : undefined; }
    removeLayer(id: string) { layers.delete(id); log.push(['removeLayer', id]); }
    removeSource(id: string) { sources.delete(id); log.push(['removeSource', id]); }
  }
  class FakeMarker {
    rec: (typeof markers)[number];
    constructor(o: Record<string, unknown>) { this.rec = { opts: o, lngLat: [0, 0], rotation: null, removed: false }; markers.push(this.rec); }
    setLngLat(ll: [number, number]) { this.rec.lngLat = ll; return this; }
    addTo() { return this; }
    setRotation(d: number) { this.rec.rotation = d; return this; }
    remove() { this.rec.removed = true; }
  }
  const fire = (ev: string, e?: unknown) => (handlers[ev] ?? []).forEach((fn) => fn(e));
  return { lib: { Map: FakeMap, Marker: FakeMarker }, log, sources, layers, markers, state, fire, options: () => ctorOptions };
}

function boot(o: {
  cfg?: unknown; raw?: string; cssFailed?: boolean; noLib?: boolean; lib?: ReturnType<typeof fakeMapLibre>;
} = {}) {
  const ml = o.lib ?? fakeMapLibre();
  const posted: Record<string, unknown>[] = [];
  const frames: ((t: number) => void)[] = [];
  let now = 0;
  const els: { innerHTML: string; style: Record<string, string>; attrs: Record<string, string> }[] = [];
  const win: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (s: string) => posted.push(JSON.parse(s)) },
    __blynkCssFailed: o.cssFailed ? 1 : undefined,
    requestAnimationFrame: (fn: (t: number) => void) => { frames.push(fn); return frames.length; },
    cancelAnimationFrame: () => { frames.length = 0; },
    performance: { now: () => now },
  };
  const doc = {
    getElementById: () => ({ textContent: o.raw ?? safeJson(o.cfg ?? pageConfig({ lat: 6.44, lng: 80.01, zoom: 15, overlay: coverageOverlay(coverageOf({ ...STORE, delivery_zones: [BERUWALA] })) })) }),
    createElement: () => {
      const el = { innerHTML: '', style: {} as Record<string, string>, attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { el.attrs[k] = v; } };
      els.push(el);
      return el;
    },
    addEventListener: () => {},
  };
  new Function('window', 'document', 'maplibregl', PAGE_SCRIPT)(win, doc, o.noLib ? undefined : ml.lib);
  const send = (m: ToPage | Record<string, unknown>) => (win.blynkMapReceive as ((s: unknown) => void) | undefined)?.(JSON.stringify({ src: PROTOCOL_SRC, v: PROTOCOL_VERSION, ...m }));
  const step = (to: number) => { now = to; const f = frames.splice(0); f.forEach((fn) => fn(to)); };
  return { ml, win, posted, send, els, frames, step };
}

describe('starting the page', () => {
  test('no maplibre (the CDN script failed): reports "script"', () => {
    expect(boot({ noLib: true }).posted).toEqual([{ t: 'error', reason: 'script', src: PROTOCOL_SRC, v: PROTOCOL_VERSION }]);
  });
  test('its stylesheet failed: reports "script" too (the map would be drawn broken)', () => {
    expect(boot({ cssFailed: true }).posted.map((p) => p.reason)).toEqual(['script']);
  });
  test('unreadable settings or a map that cannot be created (no WebGL): reports "init"', () => {
    expect(boot({ raw: '{not json' }).posted.map((p) => p.reason)).toEqual(['init']);
    expect(boot({ lib: fakeMapLibre({ throwOnConstruct: true }) }).posted.map((p) => p.reason)).toEqual(['init']);
  });

  test('builds the map like the web code: style, centre, zoom limits, no rotation, no pitch, own attribution', () => {
    const b = boot();
    expect(b.ml.options()).toMatchObject({
      container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [80.01, 6.44], zoom: 15, minZoom: 10, maxZoom: 18,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, attributionControl: false,
    });
    expect(b.ml.options()).not.toHaveProperty('cooperativeGestures');
    expect(b.ml.log.map((c) => c[0])).toEqual(['touchZoomRotate.disableRotation', 'keyboard.disableRotation', 'setPadding', 'jumpTo']);
    expect(b.posted).toEqual([]); // nothing posted until the style has loaded
  });

  test('a small embedded map asks for two fingers, with the words from the settings', () => {
    const b = boot({ cfg: pageConfig({ lat: 6.4, lng: 80, zoom: 15, cooperative: true }) });
    expect(b.ml.options()).toMatchObject({
      cooperativeGestures: true,
      locale: { 'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move the map' },
    });
  });

  test('load: draws the delivery area (zone ring and its name included) and says ready', () => {
    const b = boot();
    b.ml.fire('load');
    expect([...b.ml.sources.keys()]).toEqual(['blynk-area', 'blynk-store', 'blynk-zones', 'blynk-zone-names']);
    expect([...b.ml.layers]).toEqual(['blynk-area-fill', 'blynk-area-line', 'blynk-store', 'blynk-zones-fill', 'blynk-zones-line', 'blynk-zone-names']);
    expect(b.posted).toEqual([{ t: 'ready', src: PROTOCOL_SRC, v: PROTOCOL_VERSION }]);
  });

  test('a delivery-area group that cannot be drawn never stops the map or the next group', () => {
    const b = boot({ lib: fakeMapLibre({ failOnSource: 'blynk-zones' }) });
    b.ml.fire('load');
    expect(b.ml.layers.has('blynk-area-fill')).toBe(true);
    expect(b.ml.layers.has('blynk-zones-fill')).toBe(false);
    expect(b.ml.layers.has('blynk-zone-names')).toBe(true);
    expect(b.posted.map((p) => p.t)).toEqual(['ready']);
  });

  test('only plain drawing layers are accepted (no custom or raster layers from a message)', () => {
    const b = boot({ cfg: { ...pageConfig({ lat: 6.4, lng: 80, zoom: 15 }), overlay: [{ sources: [{ id: 's', data: { type: 'FeatureCollection', features: [] } }], layers: [{ id: 'x', type: 'raster', source: 's' }, { id: 'ok', type: 'line', source: 's' }] }] } });
    b.ml.fire('load');
    expect([...b.ml.layers]).toEqual(['ok']);
  });
});

describe('what the customer does', () => {
  test('moves are posted: user or code, then where the centre settled (longitude wrapped)', () => {
    const b = boot();
    b.ml.fire('movestart', { originalEvent: {} });
    b.ml.fire('movestart', {});
    b.ml.fire('movestart');
    b.ml.state.center = { lat: 6.5, lng: 190 };
    b.ml.state.zoom = 16.5;
    b.ml.fire('moveend');
    b.ml.fire('dragstart');
    b.ml.fire('zoomstart', { originalEvent: {} });
    b.ml.fire('zoomstart', {});
    expect(b.posted.map(({ src, v, ...rest }) => rest)).toEqual([
      { t: 'moveStart', user: true }, { t: 'moveStart', user: false }, { t: 'moveStart', user: false },
      { t: 'moveEnd', lat: 6.5, lng: -170, zoom: 16.5 },
      { t: 'userMove' }, { t: 'userMove' },
    ]);
  });

  test('a failing style before the map has drawn is reported; tile errors and later errors are not', () => {
    const a = boot();
    a.ml.fire('error', { tile: {}, sourceId: 'openmaptiles' });
    expect(a.posted).toEqual([]);
    a.ml.fire('error', { error: new Error('Failed to fetch') });
    expect(a.posted.map((p) => p.reason)).toEqual(['style']);

    const b = boot();
    b.ml.fire('load');
    b.ml.fire('error', { error: new Error('Failed to fetch') });
    expect(b.posted.map((p) => p.t)).toEqual(['ready']);

    const c = boot({ lib: fakeMapLibre({ styleLoaded: true }) });
    c.ml.fire('error', { error: new Error('one sprite') });
    expect(c.posted).toEqual([]);
  });
});

describe('commands from the app', () => {
  test('camera: ease and jump, with the numbers checked', () => {
    const b = boot();
    b.ml.log.length = 0;
    b.send({ t: 'camera', mode: 'ease', lat: 6.45, lng: 80.02, zoom: 17, duration: 600 });
    b.send({ t: 'camera', mode: 'jump', lat: 6.46, lng: 80.03, zoom: 15.5 });
    b.send({ t: 'camera', mode: 'ease', lat: 6.46, lng: 80.03 });
    expect(b.ml.log).toEqual([
      ['easeTo', { center: [80.02, 6.45], zoom: 17, duration: 600 }],
      ['jumpTo', { center: [80.03, 6.46], zoom: 15.5 }],
      ['easeTo', { center: [80.03, 6.46], duration: 500 }],
    ]);
    b.ml.log.length = 0;
    b.send({ t: 'camera', mode: 'ease', lat: 91, lng: 0 });
    b.send({ t: 'camera', mode: 'ease', lat: 6, lng: 'x' });
    b.send({ t: 'camera', mode: 'ease', lat: 6 });
    b.send({ t: 'camera', mode: 'ease', zoom: 99 });
    b.send({ t: 'camera', mode: 'jump', lat: null, lng: null });
    expect(b.ml.log).toEqual([]);
  });

  test('padding and fit and resize', () => {
    const b = boot();
    b.ml.log.length = 0;
    b.send({ t: 'padding', top: 0, bottom: 120, left: 12, right: 0 });
    b.send({ t: 'padding', top: -5, bottom: 0, left: 0, right: 0 });
    b.send({ t: 'fit', west: 80, south: 6.4, east: 80.1, north: 6.5, padding: 56, maxZoom: 16.5, duration: 700 });
    b.send({ t: 'fit', west: 80, south: 6.4, east: 80.1, north: 91, padding: 56, maxZoom: 16.5, duration: 700 });
    b.send({ t: 'resize' });
    expect(b.ml.log).toEqual([
      ['setPadding', { top: 0, bottom: 120, left: 12, right: 0 }],
      ['fitBounds', [[80, 6.4], [80.1, 6.5]], { padding: 56, maxZoom: 16.5, duration: 700 }],
      ['resize'],
    ]);
  });

  test('overlay replaces what it drew before; setData only touches a source that exists', () => {
    const b = boot({ cfg: { ...pageConfig({ lat: 6.4, lng: 80, zoom: 15 }), overlay: [routeOverlay()] } });
    b.ml.fire('load');
    expect([...b.ml.layers]).toEqual(['route-casing', 'route-line']);
    b.send({ t: 'setData', id: 'route', data: lineOf([[6.4, 80], [6.5, 80.1]]) });
    expect((b.ml.sources.get('route')!.data as { features: unknown[] }).features).toHaveLength(1);
    b.send({ t: 'setData', id: 'nope', data: lineOf([]) });
    b.send({ t: 'setData', id: 'route', data: 'x' });
    expect((b.ml.sources.get('route')!.data as { features: unknown[] }).features).toHaveLength(1);
    b.send({ t: 'overlay', groups: coverageOverlay(coverageOf(STORE)) });
    expect([...b.ml.layers]).toEqual(['blynk-area-fill', 'blynk-area-line', 'blynk-store']);
    expect([...b.ml.sources.keys()]).toEqual(['blynk-area', 'blynk-store']);
  });

  test('markers: the door (anchored at its tip) and the rider (turns with the map), only those two', () => {
    const b = boot();
    b.send({ t: 'marker', id: 'door', lat: 6.44, lng: 80.01, label: 'Delivery address' });
    b.send({ t: 'marker', id: 'rider', lat: 6.45, lng: 80.02, heading: 90, label: 'Your rider' });
    b.send({ t: 'marker', id: 'pin', lat: 6.45, lng: 80.02 });
    b.send({ t: 'marker', id: 'rider2', lat: 6.45, lng: 80.02 });
    expect(b.ml.markers).toHaveLength(2);
    expect(b.ml.markers[0]!.opts).toMatchObject({ anchor: 'bottom' });
    expect(b.ml.markers[1]!.opts).toMatchObject({ rotationAlignment: 'map' });
    expect(b.ml.markers[1]!.rotation).toBe(90);
    expect(b.els[0]!.attrs['aria-label']).toBe('Delivery address');
    expect(b.els[0]!.innerHTML).toContain('<svg');
    expect(b.els[1]!.innerHTML).toContain('#FFE141');
  });

  test('a marker with a bad position is ignored; a bad heading leaves the old one', () => {
    const b = boot();
    b.send({ t: 'marker', id: 'rider', lat: 99, lng: 80 });
    b.send({ t: 'marker', id: 'rider', lat: 6, lng: Infinity });
    expect(b.ml.markers).toHaveLength(0);
    b.send({ t: 'marker', id: 'rider', lat: 6.45, lng: 80.02, heading: 45 });
    b.send({ t: 'marker', id: 'rider', lat: 6.45, lng: 80.02, heading: 1e9 });
    b.send({ t: 'marker', id: 'rider', lat: 6.45, lng: 80.02, heading: null });
    expect(b.ml.markers[0]!.rotation).toBe(45);
  });

  test('the rider glides to a new point (cubic ease-out over 0.9 s), turns grey while stale, and can be removed', () => {
    const b = boot();
    b.send({ t: 'marker', id: 'rider', lat: 6.40, lng: 80.00 });
    b.send({ t: 'marker', id: 'rider', lat: 6.50, lng: 80.10, glide: true, stale: true });
    expect(b.els[0]!.innerHTML).toContain('#C9CAD3');
    b.step(0);
    expect(b.ml.markers[0]!.lngLat).toEqual([80.0, 6.4]);
    b.step(450); // k = .5, e = 1 - .125
    expect(b.ml.markers[0]!.lngLat[1]).toBeCloseTo(6.4 + 0.1 * 0.875, 6);
    expect(b.ml.markers[0]!.lngLat[0]).toBeCloseTo(80 + 0.1 * 0.875, 6);
    b.step(900);
    expect(b.ml.markers[0]!.lngLat[1]).toBeCloseTo(6.5, 9);
    expect(b.frames).toHaveLength(0);
    b.send({ t: 'marker', id: 'rider', lat: 6.6, lng: 80.2 }); // no glide: straight there
    expect(b.ml.markers[0]!.lngLat).toEqual([80.2, 6.6]);
    b.send({ t: 'removeMarker', id: 'rider' });
    b.send({ t: 'removeMarker', id: 'rider' });
    expect(b.ml.markers[0]!.removed).toBe(true);
  });

  test('anything that is not our protocol is ignored; one bad command never stops the map', () => {
    const b = boot();
    const recv = b.win.blynkMapReceive as (m: unknown) => void;
    b.ml.log.length = 0;
    recv('not json');
    recv('{"t":"resize"}');
    recv(JSON.stringify({ src: 'other', v: 1, t: 'resize' }));
    recv(JSON.stringify({ src: PROTOCOL_SRC, v: 9, t: 'resize' }));
    recv(JSON.stringify({ src: PROTOCOL_SRC, v: 1, t: 'eval', code: 'alert(1)' }));
    recv(null);
    recv(42);
    recv('x'.repeat(500_000));
    expect(b.ml.log).toEqual([]);
    recv(JSON.stringify({ src: PROTOCOL_SRC, v: 1, t: 'overlay', groups: [null, 5, { sources: 7 }] }));
    recv({ src: PROTOCOL_SRC, v: 1, t: 'resize' }); // an object is fine too
    expect(b.ml.log).toEqual([['resize']]);
  });

  test('what the app really sends (encodeToPage) is understood by the page', () => {
    const b = boot();
    b.ml.log.length = 0;
    new Function('window', encodeToPage({ t: 'camera', mode: 'jump', lat: 6.5, lng: 80.1, zoom: 16 }))(b.win);
    expect(b.ml.log).toEqual([['jumpTo', { center: [80.1, 6.5], zoom: 16 }]]);
  });

  test('the whole page (html) puts the page script after the library, with the settings first', () => {
    const html = buildMapHtml({ lat: 6.44, lng: 80.01, zoom: 15 });
    const cfg = html.indexOf('id="cfg"');
    const lib = html.indexOf('maplibre-gl.js');
    const page = html.indexOf('blynkMapReceive');
    expect(cfg).toBeGreaterThan(0);
    expect(lib).toBeGreaterThan(cfg);
    expect(page).toBeGreaterThan(lib);
  });
});
