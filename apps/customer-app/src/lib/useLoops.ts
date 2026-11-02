import { useEffect } from 'react';
import { cancelAnimation, type SharedValue, useReducedMotion } from 'react-native-reanimated';
import { LOW_END } from '@/lib/lowEnd';
import { useActive } from '@/lib/useActive';

/*
 * When may an idle (infinite) animation run? Only while its screen is the one in front, the app is
 * in the foreground and the customer has not asked for reduced motion. Every infinite loop in the
 * app goes through these two hooks (or the ref-counted shared clocks in src/lib/clock.ts), so a
 * screen that is left, covered, backgrounded or removed stops its loops first and Reanimated never
 * has to update a view that is gone (a logged exception per frame, ANRs on slow phones).
 */

/** Light idle loops (a pulsing dot, a bobbing tooltip): the screen is in front, app foreground, motion allowed. */
export function useLoops(): boolean {
  const active = useActive();
  const reduced = useReducedMotion();
  return active && !reduced;
}

/** Heavy decorative loops (clouds, sparkles, mascots, idle heroes): as useLoops, and never on a low-end phone. */
export function useDecorLoops(): boolean {
  return useLoops() && !LOW_END;
}

/**
 * Runs `make()` (a withRepeat(...) animation) on `value` while `enabled`; cancels it when `enabled`
 * turns false and when the view unmounts. Paused loops stay where they are. `key` restarts the loop when it changes.
 */
export function useLoop(value: SharedValue<number>, make: () => number, enabled: boolean, key?: unknown): void {
  useEffect(() => {
    if (!enabled) return;
    value.set(make());
    return () => cancelAnimation(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
}
