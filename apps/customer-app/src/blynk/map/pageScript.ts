/*
 * The script that runs INSIDE the map page in the phone's WebView, as plain old JavaScript text (the
 * page cannot import anything). It reads its settings from <script id="cfg" type="application/json">,
 * draws the same MapLibre map the web code draws, and speaks the protocol of ./protocol.ts:
 *   app -> page  window.blynkMapReceive(<JSON string>)   (called through injectJavaScript)
 *   page -> app  window.ReactNativeWebView.postMessage(<JSON string>)
 * Every number is checked before it reaches the map; unknown messages are ignored. Kept as ES5 style
 * code with no template literals so it is easy to run in the Node tests (pageScript.test.ts), which feed it
 * a fake `window`, `document` and `maplibregl`.
 */
export const PAGE_SCRIPT = String.raw`
(function () {
  'use strict';
  var SRC = 'blynk-map';
  var VERSION = 1;
  var GLIDE_MS = 900;

  function post(o) {
    try {
      o.src = SRC;
      o.v = VERSION;
      window.ReactNativeWebView.postMessage(JSON.stringify(o));
    } catch (e) { /* no bridge: nothing to tell */ }
  }
  function inRange(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; }
  function isLat(v) { return inRange(v, -90, 90); }
  function isLng(v) { return inRange(v, -180, 180); }
  function wrapLng(v) { return ((((v + 180) % 360) + 360) % 360) - 180; }

  var cfg;
  try {
    cfg = JSON.parse(document.getElementById('cfg').textContent);
  } catch (e) {
    post({ t: 'error', reason: 'init' });
    return;
  }
  if (typeof maplibregl === 'undefined' || window.__blynkCssFailed) {
    post({ t: 'error', reason: 'script' });
    return;
  }

  var map;
  try {
    var opts = {
      container: 'map',
      style: cfg.style,
      center: [cfg.lng, cfg.lat],
      zoom: cfg.zoom,
      minZoom: cfg.minZoom,
      maxZoom: cfg.maxZoom,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      attributionControl: false
    };
    if (cfg.cooperative) {
      opts.cooperativeGestures = true;
      opts.locale = {
        'CooperativeGesturesHandler.MobileHelpText': cfg.twoFingers,
        'CooperativeGesturesHandler.WindowsHelpText': cfg.twoFingers,
        'CooperativeGesturesHandler.MacHelpText': cfg.twoFingers
      };
    }
    map = new maplibregl.Map(opts);
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.setPadding(cfg.padding);
    map.jumpTo({ center: [cfg.lng, cfg.lat] });
  } catch (e) {
    post({ t: 'error', reason: 'init' });
    return;
  }

  var loaded = false;

  /* --- what the customer does to the map --- */
  map.on('movestart', function (e) { post({ t: 'moveStart', user: !!(e && e.originalEvent) }); });
  map.on('moveend', function () {
    var c = map.getCenter();
    post({ t: 'moveEnd', lat: c.lat, lng: wrapLng(c.lng), zoom: map.getZoom() });
  });
  map.on('dragstart', function () { post({ t: 'userMove' }); });
  map.on('zoomstart', function (e) { if (e && e.originalEvent) post({ t: 'userMove' }); });

  /* --- the overlay: delivery area, route ... (sources and layers the app sends as data) --- */
  var LAYER_TYPES = { fill: 1, line: 1, circle: 1, symbol: 1 };
  var owned = { sources: [], layers: [] };
  function clearOverlay() {
    owned.layers.forEach(function (id) { if (map.getLayer(id)) map.removeLayer(id); });
    owned.sources.forEach(function (id) { if (map.getSource(id)) map.removeSource(id); });
    owned = { sources: [], layers: [] };
  }
  function applyOverlay(groups) {
    if (!Array.isArray(groups)) return;
    clearOverlay();
    groups.forEach(function (g) {
      try {
        (g.sources || []).forEach(function (s) {
          if (!s || typeof s.id !== 'string' || !s.data || typeof s.data !== 'object') return;
          map.addSource(s.id, { type: 'geojson', data: s.data });
          owned.sources.push(s.id);
        });
        (g.layers || []).forEach(function (l) {
          if (!l || typeof l.id !== 'string' || !LAYER_TYPES[l.type]) return;
          map.addLayer(l);
          owned.layers.push(l.id);
        });
      } catch (e) { /* a guide only: the map works without this group */ }
    });
  }

  /* --- markers: the door and the rider --- */
  var markers = {};
  function svgFor(id, stale) {
    if (id === 'door') return cfg.svg.door;
    return stale ? cfg.svg.riderStale : cfg.svg.rider;
  }
  function cancelGlide(rec) {
    if (rec.raf) window.cancelAnimationFrame(rec.raf);
    rec.raf = 0;
  }
  function glide(rec, lat, lng) {
    var from = { lat: rec.at.lat, lng: rec.at.lng };
    var start = window.performance.now();
    cancelGlide(rec);
    var step = function (t) {
      var k = Math.min(1, (t - start) / GLIDE_MS);
      var e = 1 - Math.pow(1 - k, 3);
      rec.at = { lat: from.lat + (lat - from.lat) * e, lng: from.lng + (lng - from.lng) * e };
      rec.marker.setLngLat([rec.at.lng, rec.at.lat]);
      rec.raf = k < 1 ? window.requestAnimationFrame(step) : 0;
    };
    rec.raf = window.requestAnimationFrame(step);
  }
  function setMarker(m) {
    if ((m.id !== 'door' && m.id !== 'rider') || !isLat(m.lat) || !isLng(m.lng)) return;
    var stale = m.stale === true;
    var rec = markers[m.id];
    if (!rec) {
      var el = document.createElement('div');
      el.innerHTML = svgFor(m.id, stale);
      el.style.lineHeight = '0';
      if (typeof m.label === 'string') el.setAttribute('aria-label', m.label);
      var o = m.id === 'door' ? { element: el, anchor: 'bottom' } : { element: el, rotationAlignment: 'map' };
      var marker = new maplibregl.Marker(o).setLngLat([m.lng, m.lat]).addTo(map);
      rec = markers[m.id] = { marker: marker, el: el, at: { lat: m.lat, lng: m.lng }, raf: 0 };
    } else {
      rec.el.innerHTML = svgFor(m.id, stale);
      if (m.glide === true) {
        glide(rec, m.lat, m.lng);
      } else {
        cancelGlide(rec);
        rec.at = { lat: m.lat, lng: m.lng };
        rec.marker.setLngLat([m.lng, m.lat]);
      }
    }
    if (typeof m.heading === 'number' && inRange(m.heading, -720, 720)) rec.marker.setRotation(m.heading);
  }
  function removeMarker(m) {
    var rec = markers[m.id];
    if (!rec) return;
    cancelGlide(rec);
    rec.marker.remove();
    delete markers[m.id];
  }

  /* --- the camera --- */
  function camera(m) {
    var o = {};
    if (m.lat !== undefined || m.lng !== undefined) {
      if (!isLat(m.lat) || !isLng(m.lng)) return;
      o.center = [m.lng, m.lat];
    }
    if (m.zoom !== undefined) {
      if (!inRange(m.zoom, 0, 24)) return;
      o.zoom = m.zoom;
    }
    if (m.mode === 'jump') {
      map.jumpTo(o);
    } else {
      o.duration = inRange(m.duration, 0, 10000) ? m.duration : 500;
      map.easeTo(o);
    }
  }
  function fit(m) {
    if (!isLng(m.west) || !isLng(m.east) || !isLat(m.south) || !isLat(m.north)) return;
    if (!inRange(m.padding, 0, 5000) || !inRange(m.maxZoom, 0, 24) || !inRange(m.duration, 0, 10000)) return;
    map.fitBounds([[m.west, m.south], [m.east, m.north]], { padding: m.padding, maxZoom: m.maxZoom, duration: m.duration });
  }

  function handle(m) {
    switch (m.t) {
      case 'camera': camera(m); break;
      case 'fit': fit(m); break;
      case 'padding':
        if (inRange(m.top, 0, 5000) && inRange(m.bottom, 0, 5000) && inRange(m.left, 0, 5000) && inRange(m.right, 0, 5000)) {
          map.setPadding({ top: m.top, bottom: m.bottom, left: m.left, right: m.right });
        }
        break;
      case 'overlay': applyOverlay(m.groups); break;
      case 'setData': {
        var s = typeof m.id === 'string' ? map.getSource(m.id) : null;
        if (s && m.data && typeof m.data === 'object') s.setData(m.data);
        break;
      }
      case 'marker': setMarker(m); break;
      case 'removeMarker': removeMarker(m); break;
      case 'resize': map.resize(); break;
      default: break;
    }
  }

  window.blynkMapReceive = function (raw) {
    var m = raw;
    if (typeof raw === 'string') {
      if (raw.length > 400000) return;
      try { m = JSON.parse(raw); } catch (e) { return; }
    }
    if (!m || typeof m !== 'object' || m.src !== SRC || m.v !== VERSION) return;
    try { handle(m); } catch (e) { /* one bad command never stops the map */ }
  };

  /* --- loading --- */
  map.on('error', function (e) {
    if (loaded) return; /* a tile or label that fails later leaves the map as it is */
    var fromTiles = !!(e && (e.tile || e.sourceId));
    if (!fromTiles && !map.isStyleLoaded()) post({ t: 'error', reason: 'style' });
  });
  map.once('load', function () {
    loaded = true;
    applyOverlay(cfg.overlay);
    post({ t: 'ready' });
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
})();
`;
