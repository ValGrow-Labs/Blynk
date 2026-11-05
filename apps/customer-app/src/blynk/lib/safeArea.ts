/*
 * Pure helpers for the web app's safe-area insets (src/lib/SafeAreaRoot.web.tsx). On an iPhone the
 * installed web app can start with env(safe-area-inset-*) still at 0 and only report the notch
 * and home-indicator sizes a moment later (or after the phone was turned); the stock provider
 * measures once, so a screen could sit behind the status bar clock for as long as it stayed open.
 * The web provider measures again, and these two functions decide what it does with a reading.
 */

export type Insets = { top: number; bottom: number; left: number; right: number };

/** '47px' -> 47; '' / 'auto' / garbage -> 0. Never negative. */
export function parseInset(v: string | null | undefined): number {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** True when the two readings are the same on every edge. */
export function sameInsets(a: Insets, b: Insets): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/**
 * The larger of two readings, edge by edge. An inset only ever shrinks by turning the phone, which
 * triggers a fresh reading of both, so taking the larger of the library's and ours means a late
 * "0" can never push a screen under the status bar.
 */
export function mergeInsets(a: Insets, b: Insets): Insets {
  return { top: Math.max(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.max(a.left, b.left), right: Math.max(a.right, b.right) };
}
