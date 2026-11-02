import type { ToPage } from './protocol';

/*
 * Camera helpers shared by the phone maps. Pure.
 */

type Pt = { lat: number; lng: number };

/** The `fit` command that keeps every point in view (the door and the rider), or null when there is nothing valid to fit. */
export function fitPoints(points: readonly Pt[], o: { padding: number; maxZoom: number; duration: number }): Extract<ToPage, { t: 'fit' }> | null {
  const ok = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (ok.length === 0) return null;
  const lats = ok.map((p) => p.lat);
  const lngs = ok.map((p) => p.lng);
  return {
    t: 'fit',
    west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats),
    padding: o.padding, maxZoom: o.maxZoom, duration: o.duration,
  };
}
