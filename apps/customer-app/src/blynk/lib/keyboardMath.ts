/*
 * The sums behind the on-screen keyboard handling (src/lib/keyboard.ts), kept apart from React
 * Native so they are tested in Node.
 *
 * Android 11+ with edge-to-edge (this app): the window does not shrink for the keyboard, it
 * covers the bottom of the screen. React Native's keyboard height there is
 * `ime.bottom - systemBars.bottom` (ReactRootView.checkForKeyboardEvents): the keyboard WITHOUT the
 * navigation / gesture bar under it. What really covers the window is that height plus the bar.
 * iOS reports the full height (home indicator included) and the web visual viewport difference is
 * the full cover, so only Android needs the bar added.
 */

export type KeyboardOs = 'android' | 'ios' | 'web' | string;

/** How much of the window's bottom the keyboard covers, from the height the events report. */
export function keyboardCover(os: KeyboardOs, keyboardHeight: number, bottomInset: number): number {
  if (!(keyboardHeight > 0)) return 0;
  return os === 'android' ? keyboardHeight + Math.max(0, bottomInset) : keyboardHeight;
}

/**
 * Space to keep under the last element of a form. With the keyboard up the container is already
 * lifted above it, so only the breathing room is left; with it down the gesture / navigation bar
 * is cleared as well.
 */
export function bottomRoom(cover: number, bottomInset: number, pad: number): number {
  return cover > 0 ? pad : Math.max(0, bottomInset) + pad;
}

/**
 * How far to scroll so a focused field is fully inside the visible part of its ScrollView
 * (all numbers in window coordinates). 0 when it already is; positive scrolls down (content up).
 * A field taller than the view lines its top up with the view's top instead.
 */
export function scrollDelta(a: { fieldTop: number; fieldBottom: number; viewTop: number; viewBottom: number; margin?: number }): number {
  const m = a.margin ?? 16;
  const top = a.viewTop + m;
  const bottom = a.viewBottom - m;
  if (!(bottom > top)) return 0;
  if (a.fieldBottom - a.fieldTop > bottom - top) return Math.round(a.fieldTop - top);
  if (a.fieldTop < top) return Math.round(a.fieldTop - top);
  if (a.fieldBottom > bottom) return Math.round(a.fieldBottom - bottom);
  return 0;
}

/**
 * The tallest a bottom sheet's scrolling body may be while the keyboard is up: what is left of
 * the window under the status bar and above the keyboard, minus the sheet's own padding, handle
 * and title (`chrome`). Never above `max`, never below a few rows (`min`).
 */
export function sheetRoom(a: { windowHeight: number; cover: number; topInset: number; max: number; chrome?: number; min?: number }): number {
  const room = a.windowHeight - a.cover - a.topInset - (a.chrome ?? 90);
  return Math.round(Math.max(a.min ?? 160, Math.min(a.max, room)));
}

/** One cell of the six-digit code row: 45 wide, narrower on a phone that cannot hold 6 x 45 + 5 gaps. */
export function otpSlotWidth(availableWidth: number, gap = 11, count = 6, max = 45, min = 30): number {
  const w = Math.floor((availableWidth - gap * (count - 1)) / count);
  return Math.max(min, Math.min(max, w));
}

/**
 * True when the keyboard leaves too little of the window (under `needed`, default 440 dp: the
 * header's heading, one field, its error line and the button) for a form with a decorative header:
 * those screens then fold the header down so the field and the button fit above the keyboard.
 */
export function compactForKeyboard(windowHeight: number, cover: number, needed = 440): boolean {
  return cover > 0 && windowHeight - cover < needed;
}
