import { useEffect, useState, type ReactNode } from 'react';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { mergeInsets, parseInset, sameInsets, type Insets } from '@/blynk/lib/safeArea';

/*
 * Web only. react-native-safe-area-context's web provider reads env(safe-area-inset-*) once when it
 * mounts (plus when a CSS transition on its probe ends). On an iPhone, the installed web app can
 * report 0 at that moment and the real notch / home-indicator sizes a moment later; then a screen
 * kept sitting behind the status bar clock (owner's brother's video, 2026-11-05). This layer reads
 * the same CSS values again - on load, resize, rotation, coming back to the app, a touch,
 * every 300 ms for the first 8 seconds and every 2 seconds after - and gives the screens the larger of the two readings.
 * It needs <meta name="viewport" content="..., viewport-fit=cover"> (public/index.html).
 */

const ZERO: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

function makeProbe(): HTMLElement {
  const el = document.createElement('div');
  const s = el.style;
  s.position = 'fixed'; s.left = '0'; s.top = '0'; s.width = '0'; s.height = '0'; s.zIndex = '-1';
  s.overflow = 'hidden'; s.visibility = 'hidden'; s.pointerEvents = 'none';
  s.paddingTop = 'env(safe-area-inset-top, 0px)';
  s.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  s.paddingLeft = 'env(safe-area-inset-left, 0px)';
  s.paddingRight = 'env(safe-area-inset-right, 0px)';
  return el;
}

function read(el: HTMLElement): Insets {
  const c = window.getComputedStyle(el);
  return { top: parseInset(c.paddingTop), bottom: parseInset(c.paddingBottom), left: parseInset(c.paddingLeft), right: parseInset(c.paddingRight) };
}

function Remeasure({ children }: { children: ReactNode }) {
  const lib = useSafeAreaInsets();
  const [mine, setMine] = useState<Insets>(ZERO);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const probe = makeProbe();
    document.body.appendChild(probe);
    const measure = () => setMine((cur) => { const next = read(probe); return sameInsets(cur, next) ? cur : next; });
    measure();
    const events: [EventTarget, string][] = [
      [window, 'resize'], [window, 'orientationchange'], [window, 'pageshow'], [window, 'focus'], [window, 'load'],
      [document, 'visibilitychange'], [document, 'touchstart'],
    ];
    events.forEach(([t, n]) => t.addEventListener(n, measure, { passive: true }));
    // every 300 ms while the app is starting (when iOS is most likely to still say 0), then every 2 s: one tiny style read
    let timer = setInterval(measure, 300);
    const slow = setTimeout(() => { clearInterval(timer); timer = setInterval(measure, 2000); }, 8000);
    return () => {
      events.forEach(([t, n]) => t.removeEventListener(n, measure));
      clearInterval(timer); clearTimeout(slow);
      probe.remove();
    };
  }, []);
  return <SafeAreaInsetsContext.Provider value={mergeInsets(lib, mine)}>{children}</SafeAreaInsetsContext.Provider>;
}

export function SafeAreaRoot({ children }: { children?: ReactNode }) {
  return (
    <SafeAreaProvider>
      <Remeasure>{children}</Remeasure>
    </SafeAreaProvider>
  );
}
