import { pushTargetOf } from './target';

/*
 * Opens the screen a tapped notification points at (target.ts). Taps arrive in two ways:
 *  - warm: the app is open or in the background - navigate at once;
 *  - cold: the tap launched the app. The launch intro (src/app/index.tsx) is still running and
 *    ends with router.replace('/home'), which would replace a screen pushed under it, so the
 *    open waits until `ready()` says the app has settled, polling for a few seconds.
 * Navigating can also throw while the navigator is still mounting; that is retried the same way.
 * Never throws; gives up quietly (the app is open on its start screen, which is fine).
 */
export interface TargetOpenerDeps {
  navigate: (path: string) => void;
  /** True once the app can take a navigation (the intro has left). Default: always. */
  ready?: () => boolean;
  /** Wait between tries (ms). */
  intervalMs?: number;
  /** Give up after this many tries. */
  maxTries?: number;
}

export function createTargetOpener(deps: TargetOpenerDeps): (data: Record<string, unknown>) => void {
  const interval = deps.intervalMs ?? 250;
  const maxTries = deps.maxTries ?? 40;
  return (data) => {
    const target = pushTargetOf(data);
    if (!target) return;
    let tries = 0;
    const attempt = () => {
      tries += 1;
      let done = false;
      try {
        if (!deps.ready || deps.ready()) {
          deps.navigate(target.path);
          done = true;
        }
      } catch { /* the navigator is not ready yet */ }
      if (!done && tries < maxTries) setTimeout(attempt, interval);
    };
    attempt();
  };
}
