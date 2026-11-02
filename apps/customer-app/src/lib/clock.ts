import { AppState } from 'react-native';
import { cancelAnimation, Easing, makeMutable, withRepeat, withTiming } from 'react-native-reanimated';
import { createSharedClock, type SharedClock } from '@/blynk/lib/sharedClock';

/*
 * App-wide motion clocks. Instead of every card owning its own JS timer / infinite animation, a
 * handful of shared values loop once on the UI thread and every component just reads them inside
 * useAnimatedStyle. Zero React re-renders.
 *
 * Every clock is ref-counted and runs ONLY while at least one consumer holds it (a mounted, focused
 * screen that is showing something driven by it) AND the app is in the foreground. An infinite
 * Reanimated loop makes the UI thread render every frame, and every animated view that is already
 * gone (a screen just removed) makes Reanimated log a failed update on each of those frames (the
 * "Blynk isn't responding" storm of 2026-11-02), so a clock nobody needs must not exist.
 * Consumers: `useEffect(() => holdX(), [])`, or behind useActive() / useFocusEffect, and not under
 * reduced motion or on a low-end phone (src/lib/lowEnd.ts).
 */
const all: SharedClock[] = [];
let watching = false;
function watchAppState() {
  if (watching) return;
  watching = true;
  // one listener for every clock: they all pause while the app is in the background
  AppState.addEventListener('change', (s) => all.forEach((c) => c.setForeground(s === 'active')));
  const now = AppState.currentState;
  if (now === 'background' || now === 'inactive') all.forEach((c) => c.setForeground(false));
}
function register(c: SharedClock): () => () => void {
  all.push(c);
  return () => {
    watchAppState();
    return c.hold();
  };
}

/** Home's aisle-card corner animation: one linear 0→1 clock every aisle card reads with its own phase (src/components/AisleStamp.tsx). */
export const AISLE_BEAT_MS = 7800; // three items × 2.6 s
export const aisleBeat = makeMutable(0);
/** Keeps the aisle clock running until the returned release is called. */
export const holdAisleBeat = register(createSharedClock(
  () => {
    aisleBeat.value = 0;
    aisleBeat.value = withRepeat(withTiming(1, { duration: AISLE_BEAT_MS, easing: Easing.linear }), -1);
  },
  () => cancelAnimation(aisleBeat),
));

/** The rubber stamps' slow 0↔1 sway (StampBadge). */
export const sway = makeMutable(0);
/** Keeps the sway clock running until the returned release is called. */
export const holdSway = register(createSharedClock(
  () => { sway.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true); },
  () => cancelAnimation(sway),
));

/*
 * The rolling line under product tiles' prices (src/components/PriceRoll.tsx): one linear 0→1
 * clock every rolling tile reads with its own phase (rollPhase), so twenty tiles cost twenty
 * cheap style worklets and no timers or re-renders. It runs while at least one focused screen
 * shows a rolling tile (holdPriceRoll / its release), and resumes where it paused.
 */
export const ROLL_MS = 5600; // ~2.5 s on each line, 0.3 s slides
export const rollBeat = makeMutable(0);
const ROLL_TIMING = { duration: ROLL_MS, easing: Easing.linear };
function startRoll() {
  const from = rollBeat.value % 1;
  rollBeat.value = from;
  rollBeat.value = withTiming(1, { duration: Math.max(1, ROLL_MS * (1 - from)), easing: Easing.linear }, (done) => {
    if (!done) return;
    rollBeat.value = 0;
    rollBeat.value = withRepeat(withTiming(1, ROLL_TIMING), -1);
  });
}
/** Keeps the roll clock running until the returned release is called (ref-counted). */
export const holdPriceRoll = register(createSharedClock(startRoll, () => cancelAnimation(rollBeat)));

/*
 * Home's end-of-list footer (src/components/HomeFooter.tsx): one linear 0→1 clock over 4 s. The
 * rider's bounce reads it 4× (a 1 s bounce), the floating groceries once or twice. Runs only while
 * the footer is on screen and Home is focused.
 */
export const FOOTER_BEAT_MS = 4000;
export const footerBeat = makeMutable(0);
/** Keeps the footer clock running until the returned release is called. */
export const holdFooterBeat = register(createSharedClock(
  () => {
    footerBeat.value = 0;
    footerBeat.value = withRepeat(withTiming(1, { duration: FOOTER_BEAT_MS, easing: Easing.linear }), -1);
  },
  () => cancelAnimation(footerBeat),
));
