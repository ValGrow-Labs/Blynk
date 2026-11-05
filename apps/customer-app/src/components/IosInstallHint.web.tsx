import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hintParts, IOS_HINT_WORDS } from '@/blynk/install/iosHintWords';
import { HINT_KEY, parseShownAt, shouldShowIosHint } from '@/blynk/install/iosHint';
import { storage } from '@/blynk/lib/storage';
import { CloseIcon } from '@/components/icons';
import { F } from '@/lib/theme';

/*
 * iPhone Safari has no install prompt, so a small bar points at Share > Add to Home Screen (en / si /
 * ta, the customer's language). Never inside the installed app, never in Chrome / in-app browsers, and
 * not again for two weeks once it was shown (src/blynk/install/iosHint.ts). It waits for the launch
 * intro, fades itself away after 15 seconds, and has a close button. Web only.
 */
const SHOW_AFTER_MS = 3000;
const HIDE_AFTER_MS = 15000;

export function IosInstallHint() {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
    const nav = navigator as Navigator & { standalone?: boolean };
    let displayStandalone = false;
    try { displayStandalone = !!window.matchMedia?.('(display-mode: standalone)').matches; } catch { /* old browser */ }
    const show = shouldShowIosHint({
      userAgent: nav.userAgent || '', platform: nav.platform, maxTouchPoints: nav.maxTouchPoints,
      navigatorStandalone: nav.standalone, displayStandalone,
      lastShownAt: parseShownAt(storage.get(HINT_KEY)), now: Date.now(),
    });
    if (!show) return;
    const t1 = setTimeout(() => { setOpen(true); storage.set(HINT_KEY, String(Date.now())); }, SHOW_AFTER_MS);
    const t2 = setTimeout(() => setOpen(false), SHOW_AFTER_MS + HIDE_AFTER_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (!open) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={styles.bar} accessibilityRole="alert">
        <Text style={styles.text}>
          {hintParts(IOS_HINT_WORDS.line).map((p, i) => (
            <Text key={i} style={p.bold ? styles.bold : undefined}>{p.text}</Text>
          ))}
        </Text>
        <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={IOS_HINT_WORDS.close} style={styles.x}>
          <CloseIcon size={14} color="#C9CDD6" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 100000, alignItems: 'center' },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 420, width: '100%', paddingVertical: 12, paddingLeft: 16, paddingRight: 12,
    borderRadius: 16, backgroundColor: '#12151F',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  text: { flex: 1, color: '#fff', fontFamily: F.semi, fontSize: 14, lineHeight: 19 },
  bold: { color: '#FFE141', fontFamily: F.bold },
  x: { padding: 4 },
});
