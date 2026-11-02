import { circleRing, zoneRing, type Coverage } from '@/blynk/area/coverage';
import { C } from '@/lib/theme';

/*
 * What is drawn ON the map besides the base tiles, as plain data both the web code (it hands the
 * specs to maplibre-gl) and the phone's WebView page (it receives them as JSON) use: the delivery
 * area (store circle, store point, the extra zone rings and their names) and the road route of the
 * tracking map. Pure: no browser, no React Native.
 */

export type GeoJsonObject = Record<string, unknown>;
export type SourceSpec = { id: string; data: GeoJsonObject };
export type LayerSpec = Record<string, unknown> & { id: string; type: string };
/** Sources and the layers drawn from them. A group is added together; one failing group never stops the next. */
export type OverlayGroup = { sources: SourceSpec[]; layers: LayerSpec[] };

const feature = (geometry: GeoJsonObject, properties: GeoJsonObject = {}): GeoJsonObject => ({ type: 'Feature', properties, geometry });
const collection = (features: GeoJsonObject[]): GeoJsonObject => ({ type: 'FeatureCollection', features });

/**
 * The delivery circle and the store point, then (when GET /store sends extra zones, e.g. Beruwala) a
 * second ring drawn like the store's and a small name label for each. Up to three groups.
 */
export function coverageOverlay(c: Coverage): OverlayGroup[] {
  const groups: OverlayGroup[] = [{
    sources: [
      { id: 'blynk-area', data: feature({ type: 'Polygon', coordinates: [circleRing(c)] }) },
      { id: 'blynk-store', data: feature({ type: 'Point', coordinates: [c.center.lng, c.center.lat] }) },
    ],
    layers: [
      { id: 'blynk-area-fill', type: 'fill', source: 'blynk-area', paint: { 'fill-color': C.brand, 'fill-opacity': 0.12 } },
      { id: 'blynk-area-line', type: 'line', source: 'blynk-area', paint: { 'line-color': C.brandDeep, 'line-width': 2.5, 'line-dasharray': [3, 2] } },
      {
        id: 'blynk-store', type: 'circle', source: 'blynk-store',
        paint: { 'circle-radius': 7, 'circle-color': C.brand, 'circle-stroke-color': C.brandInk, 'circle-stroke-width': 2 },
      },
    ],
  }];
  const zones = c.zones ?? [];
  if (!zones.length) return groups;
  groups.push({
    sources: [{
      id: 'blynk-zones',
      data: collection(zones.map((z) => feature({ type: 'Polygon', coordinates: [zoneRing(z)] }, { name: z.name }))),
    }],
    layers: [
      { id: 'blynk-zones-fill', type: 'fill', source: 'blynk-zones', paint: { 'fill-color': C.brand, 'fill-opacity': 0.12 } },
      { id: 'blynk-zones-line', type: 'line', source: 'blynk-zones', paint: { 'line-color': C.brandDeep, 'line-width': 2.5, 'line-dasharray': [3, 2] } },
    ],
  });
  groups.push({
    sources: [{
      id: 'blynk-zone-names',
      data: collection(zones.map((z) => feature({ type: 'Point', coordinates: [z.lng, z.lat] }, { name: z.name }))),
    }],
    layers: [{
      id: 'blynk-zone-names', type: 'symbol', source: 'blynk-zone-names',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': C.brandText, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
    }],
  });
  return groups;
}

/** A road route ([lat, lng] pairs) as GeoJSON: a line, or nothing for fewer than two points. */
export function lineOf(points: readonly (readonly [number, number])[]): GeoJsonObject {
  return {
    type: 'FeatureCollection',
    features: points.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(([lat, lng]) => [lng, lat]) } }]
      : [],
  };
}

/** The tracking map's route: an empty source (filled with `lineOf`) under a white casing and an ink line. */
export function routeOverlay(): OverlayGroup {
  return {
    sources: [{ id: 'route', data: lineOf([]) }],
    layers: [
      {
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 8 },
      },
      {
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': C.brandInk, 'line-width': 4.5 },
      },
    ],
  };
}
