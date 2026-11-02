import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { keyboardCover, scrollDelta } from '@/blynk/lib/keyboardMath';

/**
 * How much of the bottom of the window the on-screen keyboard covers, for screens that keep
 * a form above it.
 * Web: the keyboard shrinks the visual viewport but not the layout one (Chrome's default), so
 * this is the difference. Android 11+ (edge-to-edge) and iOS: the keyboard frame from its events. Older Android resizes the window itself: 0.
 */
export function useKeyboardInset(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv || typeof document === 'undefined') return;
      const on = () => {
        const d = document.documentElement.clientHeight - vv.height * vv.scale;
        setH(d > 80 ? Math.round(d) : 0);
      };
      on();
      vv.addEventListener('resize', on);
      return () => vv.removeEventListener('resize', on);
    }
    // Android 11+ with edge-to-edge (this app, and every app targeting Android 15) no longer shrinks the window for the keyboard,
    // so it covers the bottom of the form: the Did events fire after it is up. Older Android still resizes the window itself.
    if (Platform.OS === 'android' && (typeof Platform.Version !== 'number' || Platform.Version < 30)) return;
    const on = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const off = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(on, (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(off, () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}

/**
 * How much of the window's bottom the keyboard really covers: useKeyboardInset() plus, on Android,
 * the navigation / gesture bar under it (React Native reports the keyboard without that bar, see
 * src/blynk/lib/keyboardMath.ts). Lift a form's container by this (paddingBottom / marginBottom) and
 * the viewport ends exactly at the top of the keyboard.
 */
export function useKeyboardCover(): number {
  const kb = useKeyboardInset();
  const { bottom } = useSafeAreaInsets();
  return keyboardCover(Platform.OS, kb, bottom);
}

/**
 * Keeps the focused field visible: when the keyboard comes up (`cover` goes above 0) the ScrollView
 * is scrolled just enough to bring the focused input above it. Spread the result on the ScrollView:
 * `<ScrollView {...fs.props} ref={fs.ref}>` (the ScrollView must be the one that is shortened to
 * end at the keyboard). `topCover` is the height of anything floating over its top (a header).
 * Moving between fields while the keyboard stays up is handled by Android itself.
 */
export function useFieldScroll(cover: number, topCover = 0) {
  const ref = useRef<ScrollView>(null);
  const y = useRef(0);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { y.current = e.nativeEvent.contentOffset.y; }, []);
  useEffect(() => {
    if (cover <= 0) return;
    // after the lifted container has laid out
    const t = setTimeout(() => {
      const sv = ref.current;
      const view = sv?.getNativeScrollRef?.();
      const field = TextInput.State.currentlyFocusedInput?.();
      if (!sv || !view || !field) return;
      view.measureInWindow((_x, vy, _w, vh) => {
        field.measureInWindow((_fx, fy, _fw, fh) => {
          const d = scrollDelta({ fieldTop: fy, fieldBottom: fy + fh, viewTop: vy + topCover, viewBottom: vy + vh });
          if (d) sv.scrollTo({ y: Math.max(0, y.current + d), animated: true });
        });
      });
    }, 140);
    return () => clearTimeout(t);
  }, [cover, topCover]);
  return { ref, props: { onScroll, scrollEventThrottle: 32 } as const };
}
