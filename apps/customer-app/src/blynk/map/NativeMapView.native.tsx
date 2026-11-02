import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { createMapBridge, type MapBridge } from './bridge';
import { buildMapHtml, MAP_BASE_URL } from './html';
import type { NativeMapHandle, NativeMapProps } from './types';
import { allowNavigation, WEBVIEW_HARDENING } from './webviewProps';

/*
 * The map on a phone: a WebView hosting a small MapLibre page (html.ts / pageScript.ts) with the same style
 * as the web screens, driven through the message protocol in protocol.ts. All the logic (state, timer,
 * queue, parsing) lives in bridge.ts; this file only connects it to the WebView.
 *
 * The page is built ONCE when the component mounts, from `initial` / `overlay` / `cooperative`: later
 * changes go through the handle (`send`) or the `padding` / `overlayKey` props. To start over (the
 * "Try again" button) the parent changes this component's `key`.
 *
 * Offline or a slow connection: the page needs maplibre-gl (unpkg) and the style and tiles (OpenFreeMap).
 * If the page has not drawn within 15 s, or any of that fails to load, `onState('failed')` is called and the
 * parent shows its "map did not load / try again" fallback. Nothing is bundled for offline use; what the
 * WebView's own HTTP cache already holds (the script, tiles seen before) is used when it is still valid.
 */

export type { NativeMapHandle, NativeMapProps } from './types';

export const NativeMapView = forwardRef<NativeMapHandle, NativeMapProps>(function NativeMapView(
  { initial, overlay, overlayKey, padding, cooperative, onState, onEvent },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const handlers = useRef({ onState, onEvent });
  handlers.current = { onState, onEvent };

  const [html] = useState(() => buildMapHtml({
    lat: initial.lat, lng: initial.lng, zoom: initial.zoom, minZoom: initial.minZoom, maxZoom: initial.maxZoom,
    padding: initial.padding ?? padding, overlay, cooperative,
  }));
  const [bridge] = useState<MapBridge>(() => createMapBridge({
    inject: (js) => webRef.current?.injectJavaScript(js),
    onState: (s, why) => handlers.current.onState?.(s, why),
    onEvent: (e) => handlers.current.onEvent?.(e),
  }));

  useEffect(() => {
    bridge.start();
    return () => bridge.stop();
  }, [bridge]);

  useImperativeHandle(ref, () => ({ send: bridge.send }), [bridge]);

  const sentPadding = useRef(initial.padding ?? padding);
  useEffect(() => {
    if (!padding || sentPadding.current === padding) return;
    sentPadding.current = padding;
    bridge.send({ t: 'padding', ...padding });
  }, [padding, bridge]);

  const firstKey = useRef(overlayKey);
  useEffect(() => {
    if (overlayKey === firstKey.current || !overlay) return;
    firstKey.current = overlayKey;
    bridge.send({ t: 'overlay', groups: overlay });
  }, [overlayKey, overlay, bridge]);

  return (
    <View style={styles.box}>
      <WebView
        ref={webRef}
        {...WEBVIEW_HARDENING}
        source={{ html, baseUrl: MAP_BASE_URL }}
        style={styles.web}
        containerStyle={styles.web}
        onMessage={(e) => bridge.receive(e.nativeEvent.data)}
        onShouldStartLoadWithRequest={(req) => allowNavigation(req.url)}
        onError={() => bridge.fail('webview')}
        onRenderProcessGone={() => bridge.fail('crashed')}
        onContentProcessDidTerminate={() => bridge.fail('crashed')}
        renderError={() => <View />}
        webviewDebuggingEnabled={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#EFEBE3', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#EFEBE3' },
});
