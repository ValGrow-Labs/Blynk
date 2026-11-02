/**
 * The intro's logo: the big B mark on its own, full colour (owner's brother, 2026-11-02: "I need the intro to be this big B", as in the
 * Ops and Rider apps), not the stacked mark over the "blynk" wordmark the Flutter intro used. Centred on the whole window.
 */
export const SPLASH_LOGO = require('../../assets/logo-mark.png');
/** Drawn height; the mark's own shape (429 x 512) sets the width. */
export const SPLASH_LOGO_H = 180;
export const SPLASH_LOGO_W = SPLASH_LOGO_H * (429 / 512);

/*
 * The intro's hand-over (owner, 2026-10-14: no colour may show through the launch). When the
 * intro leaves, its last frame (white, the breathed logo) stays over the WHOLE window, the tab
 * bar included, until the next screen (Home, or the start gate's login) has mounted; then it
 * lifts away over that screen (SplashHandoverHost, mounted at the root). Before this the white
 * exit was drawn inside Home's tab scene, so the tab bar's yellow Shop pill showed at once and
 * the logo jumped up by the tab bar's height.
 */
type HandoverState = 'idle' | 'covering' | 'leaving';
let state: HandoverState = 'idle';
let homeRise = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const splashHandover = {
  /** The intro is leaving for `/home` (its page rises into place) or for the login. */
  start(toHome: boolean) {
    homeRise = toHome;
    state = 'covering';
    emit();
  },
  /** The screen under the intro has mounted: the cover lifts away. A no-op otherwise. */
  release() {
    if (state !== 'covering') return;
    state = 'leaving';
    emit();
  },
  /** The cover has lifted away. */
  done() {
    state = 'idle';
    emit();
  },
  /** Home was opened by the intro: its page rises into place under the cover (once). */
  homeRisePending: () => homeRise,
  clearHomeRise() { homeRise = false; },
  get: (): HandoverState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
