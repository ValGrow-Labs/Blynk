import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { ownsBack } from '@/blynk/lib/backRule';

/*
 * The Android back button. React Native asks the listeners newest first and stops at the first one
 * that returns true, so whatever opened last (a sheet over a screen) closes first, then the screen's
 * own rule, then the navigator (the default). The handler is kept in a ref and the listener is added
 * once, so a re-render never moves it to the front of the line.
 */

/**
 * A sheet, dialog or other overlay: while `active`, back runs `onBack` and goes no further (return
 * false from it to let back carry on). For things that unmount when they close: it does not look at
 * which screen is focused.
 */
export function useBackPress(onBack: (() => boolean | void) | null | undefined, active = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const on = active && !!onBack;
  useEffect(() => {
    if (!on) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current?.() !== false);
    return () => sub.remove();
  }, [on]);
}

/** A screen's own back rule: only while that screen is the focused one (it stays mounted under the next). */
export function useScreenBackPress(onBack: () => boolean | void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => ref.current() !== false);
    return () => sub.remove();
  }, []));
}

/**
 * The hardware back button does what the screen's back arrow does where that differs from the
 * navigator's own back (see ownsBack): `customArrow` for an arrow with its own action, else only when
 * there is nothing to go back to. `arrow` is the arrow's action; `enabled` false (a screen with no arrow) leaves back alone.
 */
export function useBackLikeArrow(arrow: () => void, customArrow = false, enabled = true) {
  useScreenBackPress(() => {
    if (!enabled || !ownsBack({ customArrow, canGoBack: router.canGoBack() })) return false;
    arrow();
  });
}
