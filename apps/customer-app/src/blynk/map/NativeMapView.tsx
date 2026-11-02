import { forwardRef } from 'react';
import type { NativeMapHandle, NativeMapProps } from './types';

/*
 * The web build has its own MapLibre map in the page (address/maplibre.ts), so the phone's WebView map is
 * never drawn here: this stub keeps `react-native-webview` out of the web bundle. The phone version is
 * NativeMapView.native.tsx.
 */

export type { NativeMapHandle, NativeMapProps } from './types';

export const NativeMapView = forwardRef<NativeMapHandle, NativeMapProps>(function NativeMapView() {
  return null;
});
