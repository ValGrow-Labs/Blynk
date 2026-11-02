import { referralCodeFromSearch, routeFromHash } from './links';

/*
 * A link that opens the phone app (the blynk:// scheme, or a https://blynk.lk link once Android
 * App Links are set up) -> the route expo-router should open. Pure; src/app/+native-intent.ts is
 * the one-line caller. The web build never runs this.
 *
 *   blynk://order/<id>, blynk://p/<id>      -> /order/<id>, /p/<id>
 *   https://blynk.lk/p/<id>                 -> /p/<id>            (a shared product)
 *   https://blynk.lk/app/p/<id>             -> /p/<id>            (the web app's /app base is dropped)
 *   https://blynk.lk/app/#/p/<id>, #/refer  -> /p/<id>, /refer    (the site's hash routes)
 *   https://blynk.lk/app/?ref=CODE          -> /                  (CODE is kept until sign-in)
 * A link that is none of these opens the app at its start (the launch intro and start gate);
 * a dev-client / Expo URL is passed through untouched.
 */

const URL_PARTS = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/;
const SAFE_PATH = /^\/[A-Za-z0-9_\-./()[\]]*$/;
const OUR_SCHEME = 'blynk';

export function nativeIntentPath(url: string, onReferral: (code: string) => void = () => {}): string {
  try {
    const m = URL_PARTS.exec(String(url ?? '').trim());
    if (!m) {
      // already a path ("/order/1"): the router's own
      return SAFE_PATH.test(String(url)) ? String(url) : '/';
    }
    const scheme = m[1].toLowerCase();
    const host = m[2];
    const rawPath = m[3] ?? '';
    const search = m[4] ?? '';
    const hash = m[5] ?? '';
    if (scheme !== OUR_SCHEME && scheme !== 'https' && scheme !== 'http') return url; // exp://, dev client...
    if (host === 'expo-development-client') return url;

    const code = referralCodeFromSearch(search);
    if (code) { try { onReferral(code); } catch { /* storage blocked: no code */ } }

    const fromHash = routeFromHash(hash);
    if (fromHash) return fromHash;

    // blynk://order/1 puts the first segment in the host; https keeps the host out of the path
    let path = scheme === OUR_SCHEME ? `${host ? `/${host}` : ''}${rawPath}` : rawPath;
    path = path.replace(/\/{2,}/g, '/');
    if (scheme !== OUR_SCHEME && (path === '/app' || path.startsWith('/app/'))) path = path.slice('/app'.length);
    path = path.replace(/\/+$/, '') || '/';
    return SAFE_PATH.test(path) ? path : '/';
  } catch {
    return '/';
  }
}
