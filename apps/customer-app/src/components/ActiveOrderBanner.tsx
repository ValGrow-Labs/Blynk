import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { needsRegistration, useSession } from '@/blynk/auth/session';
import { bannerHidden, bannerView, barFill } from '@/blynk/orders/activeBanner';
import { BANNER_WORDS as W } from '@/blynk/orders/bannerWords';
import { useActiveEta, useActiveOrder } from '@/blynk/orders/openOrders';
import { ChevronIcon } from '@/components/icons';
import { DEMO } from '@/demo/mode';
import { useKeyboardInset } from '@/lib/keyboard';
import { C, F } from '@/lib/theme';

/*
 * The slim "active order" strip above the tab bar (owner's brother, 2026-11-03, the PickMe style):
 * the stage in words ("Packing your order", "Rider is on the way", "Arriving in about 12 min"), a
 * thin four-step bar (placed, packed, on the way, delivered) and a tap that opens the live map or
 * the order. It lives inside the shell's tab bar, so it shows on Shop, Orders, Help and Profile and
 * is covered, like the bar, by cart, checkout and tracking screens. It does no polling of its own
 * (the shell's one-minute orders round feeds it: src/app/(tabs)/_layout.tsx) and no animation
 * loop: a plain static bar. Hidden while the keyboard is open.
 */

/** True while the on-screen keyboard is up (web: the visual viewport shrank). */
function useKeyboardOpen(): boolean {
  const inset = useKeyboardInset();
  const [native, setNative] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setNative(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setNative(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return inset > 0 || native;
}

export function ActiveOrderBanner() {
  const session = useSession();
  const order = useActiveOrder();
  const eta = useActiveEta();
  const keyboardOpen = useKeyboardOpen();
  const signedIn = !!session && !needsRegistration(session);
  const view = bannerView(order, eta, Date.now());
  if (!view || bannerHidden({ keyboardOpen, demo: DEMO, signedIn })) return null;

  const open = () => {
    if (view.opens === 'track') router.push({ pathname: '/track/[id]', params: { id: view.orderId } });
    else router.push({ pathname: '/order/[id]', params: { id: view.orderId } });
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${view.text}. ${W.stepOf(view.step + 1, view.steps)}. ${view.opens === 'track' ? W.tapTrack : W.tapView}`}
      style={({ pressed }) => [styles.strip, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.row}>
        <Text style={styles.text} numberOfLines={2}>{view.text}</Text>
        <View style={styles.cta}>
          <Text style={styles.ctaTxt}>{view.opens === 'track' ? W.track : W.view}</Text>
          <View style={{ transform: [{ rotate: '-90deg' }] }}><ChevronIcon size={12} color={C.brandInk} stroke={2.4} /></View>
        </View>
      </View>
      <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {barFill(view.step, view.steps).map((on, i) => <View key={i} style={[styles.seg, on && styles.segOn]} />)}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { backgroundColor: C.brand, borderTopWidth: 1, borderTopColor: C.brandDeep, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  text: { flex: 1, fontFamily: F.semi, fontSize: 14, color: C.brandInk },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctaTxt: { fontFamily: F.bold, fontSize: 12.5, color: C.brandInk },
  bar: { flexDirection: 'row', gap: 4, marginTop: 7 },
  seg: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(26,29,46,0.18)' },
  segOn: { backgroundColor: C.brandInk },
});
