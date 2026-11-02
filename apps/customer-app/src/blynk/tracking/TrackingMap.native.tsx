import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MAP_ATTRIBUTION } from '@/blynk/address/maplibre';
import type { MapState } from '@/blynk/map/bridge';
import { fitPoints } from '@/blynk/map/camera';
import { NativeMapView, type NativeMapHandle } from '@/blynk/map/NativeMapView';
import { lineOf, routeOverlay } from '@/blynk/map/overlays';
import { PressScale } from '@/components/ui';
import { C, F } from '@/lib/theme';
import type { RiderPoint } from './model';
import { TRACKING_WORDS } from './words';

/*
 * The tracking map on a phone (the web one is TrackingMap.tsx, MapLibre in the page): the same map in a
 * WebView (src/blynk/map). The door is an ink pin, the rider a yellow disc with an arrow that turns with the
 * heading (grey while STALE) and glides to each new point, the road route an ink line, and the camera keeps
 * both in view until the customer moves the map ("recenter" brings it back). In the small card on the order
 * screen (a scrolling page) the map needs two fingers, so a swipe still scrolls the screen; the "Full map"
 * screen (height 100%) pans with one finger.
 */

type Pt = { lat: number; lng: number };

export function TrackingMap({
  destination, rider, stale, heading, route, height,
}: {
  destination: Pt;
  rider: RiderPoint | null;
  stale: boolean;
  heading: number | null;
  route: [number, number][];
  height: number | '100%';
}) {
  const map = useRef<NativeMapHandle>(null);
  const userMoved = useRef(false);
  const [state, setState] = useState<MapState>('loading');
  const [attempt, setAttempt] = useState(0);
  // the destination of an order never changes, so the page is built once per attempt
  const overlay = useMemo(() => [routeOverlay()], []);

  // the door, once per attempt (the page draws it as soon as it is ready)
  useEffect(() => {
    map.current?.send({ t: 'marker', id: 'door', lat: destination.lat, lng: destination.lng, label: TRACKING_WORDS.doorLabel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // the rider: add, glide to the new point, turn, grey while stale; keep both in view until the map is moved
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!rider) {
      m.send({ t: 'removeMarker', id: 'rider' });
      return;
    }
    m.send({ t: 'marker', id: 'rider', lat: rider.lat, lng: rider.lng, stale, heading, glide: true, label: TRACKING_WORDS.riderLabel });
    if (!userMoved.current) {
      const fit = fitPoints([destination, rider], { padding: 56, maxZoom: 16.5, duration: 700 });
      if (fit) m.send(fit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider?.lat, rider?.lng, rider?.capturedAt, stale, heading, attempt]);

  // the road line
  useEffect(() => {
    map.current?.send({ t: 'setData', id: 'route', data: lineOf(route) });
  }, [route, attempt]);

  const recenter = () => {
    userMoved.current = false;
    const m = map.current;
    if (!m) return;
    const fit = rider ? fitPoints([destination, rider], { padding: 56, maxZoom: 16.5, duration: 500 }) : null;
    if (fit) m.send(fit);
    else m.send({ t: 'camera', mode: 'ease', lat: destination.lat, lng: destination.lng, zoom: 15, duration: 500 });
  };

  const retry = () => {
    userMoved.current = false;
    setState('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <View style={[styles.box, { height }]}>
      <NativeMapView
        key={attempt}
        ref={map}
        initial={{ lat: destination.lat, lng: destination.lng, zoom: 15 }}
        overlay={overlay}
        cooperative={height !== '100%'}
        onState={setState}
        onEvent={(e) => { if (e.t === 'userMove') userMoved.current = true; }}
      />
      {state === 'loading' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color={C.brandInk} /></View>
      )}
      {state === 'failed' && (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.cover]}>
          <Text style={styles.note}>{TRACKING_WORDS.mapFailed}</Text>
          <PressScale onPress={retry} style={styles.retry}>
            <Text style={styles.retryTxt}>{TRACKING_WORDS.tryAgain}</Text>
          </PressScale>
        </View>
      )}
      {state === 'ready' && (
        <Pressable onPress={recenter} style={styles.recenter} accessibilityRole="button" accessibilityLabel={TRACKING_WORDS.recenter}>
          <Text style={styles.recenterTxt}>⌖</Text>
        </Pressable>
      )}
      <Text style={styles.attr} pointerEvents="none">{MAP_ATTRIBUTION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', backgroundColor: '#EFEBE3' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  cover: { backgroundColor: '#EFEBE3' },
  note: { fontFamily: F.medium, fontSize: 13, color: C.sub, textAlign: 'center' },
  retry: { marginTop: 10, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 18, backgroundColor: C.brand },
  retryTxt: { fontFamily: F.semi, fontSize: 13, color: C.brandInk },
  recenter: {
    position: 'absolute', right: 10, top: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line,
  },
  recenterTxt: { fontSize: 20, color: C.brandInk, lineHeight: 22 },
  attr: {
    position: 'absolute', left: 6, bottom: 4, fontFamily: F.regular, fontSize: 9.5, color: '#55555C',
    backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4, borderRadius: 3,
  },
});
