import { useGlobalSearchParams, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useSession } from '@/blynk/auth/session';
import { useCatalog } from '@/blynk/catalog/CatalogContext';
import { useLang } from '@/blynk/i18n/useLang';
import { initFirebase } from './firebaseSink';
import { identify, setAppLanguage, setCatalogIndex, trackingActive, trackPageView, trackSearch, trackViewItemList } from './track';

/*
 * The React side of the GTM events and the phone's Firebase reporting (src/blynk/analytics/track.ts
 * holds the events themselves, firebaseSink.ts the phone's Analytics + Crashlytics).
 * AnalyticsHost is mounted once in the root layout; the hooks are one-liners at the screens.
 */

/**
 * Mounted once in the root layout (renders nothing):
 * - who is shopping (user_id = internal customer id, app_language, app_mode) on app start with a
 *   session, on sign-in, and cleared on sign-out;
 * - a page_view for every route change (the launch intro at `/` is skipped: its redirect's
 *   page view carries the ad-click parameters instead);
 * - the catalogue's category names and SKUs for the items in every event;
 * - on the phone: Firebase collection on/off by the consent switch at start, the app's language as
 *   a user property, and (through trackPageView) a `screen_view` + Crashlytics breadcrumb per route.
 */
export function AnalyticsHost() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const path = usePathname();
  const params = useGlobalSearchParams();
  const { data } = useCatalog();
  const lang = useLang();
  const query = JSON.stringify(params);

  // Firebase (phone only, a no-op elsewhere): collection follows the consent switch, Crashlytics also
  // installs its JS error handler here; before the identity so the user id lands on a ready SDK
  useEffect(() => { initFirebase(); }, []);
  useEffect(() => { setAppLanguage(lang); }, [lang]);

  // identity first, so the first page view already carries user_id
  useEffect(() => { identify(userId); }, [userId]);

  useEffect(() => {
    if (!path || path === '/') return;
    trackPageView(path, params as Record<string, unknown>);
    // params is read through `query` (a new object on every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, query]);

  useEffect(() => {
    // nobody listens on the phone: do not index the whole catalogue for events that are never sent
    if (data && trackingActive()) setCatalogIndex({ categories: data.categories, topOf: data.topOf, products: data.products });
  }, [data]);

  return null;
}

/**
 * `view_item_list` once per list name per mount of the screen, once it has products
 * (a null name = not shown, nothing sent).
 */
export function useTrackList(name: string | null | undefined, products: Parameters<typeof trackViewItemList>[1]) {
  const sent = useRef(new Set<string>());
  const ready = !!name && products.length > 0 && trackingActive();
  useEffect(() => {
    if (!ready || !name || sent.current.has(name)) return;
    // after this commit, so the screen's page_view is already out
    const t = setTimeout(() => {
      if (sent.current.has(name)) return;
      sent.current.add(name);
      trackViewItemList(name, products);
    }, 0);
    return () => clearTimeout(t);
    // once per name: a fresh products array on every render must not send it again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, name]);
}

/** Runs `fire` once per `key` per mount of the screen, the first time `when` is true. */
export function useTrackOnce(when: boolean, key: string, fire: () => void) {
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!when || sent.current.has(key) || !trackingActive()) return;
    // after this commit, so the screen's page_view is already out
    const t = setTimeout(() => {
      if (sent.current.has(key)) return;
      sent.current.add(key);
      try { fire(); } catch { /* never in the way */ }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, key]);
}

/** `search` once the typing pauses (1.5 s) on a term; submitting or a recent search sends it at once (trackSearch). */
export function useSearchTracking(term: string) {
  useEffect(() => {
    if (!term) return;
    const t = setTimeout(() => trackSearch(term), 1500);
    return () => clearTimeout(t);
  }, [term]);
}
