import type { MapState } from './bridge';
import type { OverlayGroup } from './overlays';
import type { FromPage, Padding, ToPage } from './protocol';

/* The props and handle of NativeMapView (the phone's map), shared by its web stub and its phone version. Types only (no React Native import, so the pure-file test and the translation test can load it). */

export type NativeMapHandle = { send(msg: ToPage): void };

export type PageEvent = Exclude<FromPage, { t: 'ready' } | { t: 'error' }>;

export type NativeMapProps = {
  /** Where the map opens (read once, at mount). */
  initial: { lat: number; lng: number; zoom: number; minZoom?: number; maxZoom?: number; padding?: Padding };
  /** Drawn once the style has loaded (read once, at mount). */
  overlay?: OverlayGroup[];
  /** When this changes after mount, `overlay` is sent again (e.g. the delivery area arrived late). */
  overlayKey?: string;
  /** Camera padding in px; changes are sent to the page. */
  padding?: Padding;
  /** A small map in a scrolling screen: one finger scrolls the screen, two move the map (read once). */
  cooperative?: boolean;
  onState?: (state: MapState, why?: string) => void;
  onEvent?: (event: PageEvent) => void;
};
