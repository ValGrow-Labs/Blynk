/*
 * The bookkeeping behind the app's shared animation clocks (src/lib/clock.ts), kept free of React
 * Native so it can be tested in Node. A clock runs only while at least one consumer holds it AND
 * the app is in the foreground: with nobody mounted and focused, or the phone in the background,
 * nothing animates (an infinite Reanimated loop keeps the UI thread rendering every frame, and
 * every animated view that is already gone makes Reanimated log a failed update each frame).
 */

export interface SharedClock {
  /** Keeps the clock running until the returned release is called (ref-counted, release is idempotent). */
  hold(): () => void;
  /** The app moved to the foreground (true) or the background (false). */
  setForeground(fg: boolean): void;
  /** Consumers holding it now. */
  holders(): number;
  /** Is the animation running right now (holders > 0 and foreground). */
  running(): boolean;
}

export function createSharedClock(start: () => void, stop: () => void): SharedClock {
  let count = 0;
  let foreground = true;
  let on = false;
  const sync = () => {
    const want = count > 0 && foreground;
    if (want === on) return;
    on = want;
    if (want) start();
    else stop();
  };
  return {
    hold() {
      count += 1;
      sync();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        count = Math.max(0, count - 1);
        sync();
      };
    },
    setForeground(fg) {
      foreground = fg;
      sync();
    },
    holders: () => count,
    running: () => on,
  };
}
