/*
 * Uploaded pictures (products, banners, categories) are stored in the database with the address
 * the API had when they were uploaded: a raw server address (…sslip.io/uploads/…) that is not behind
 * Cloudflare, so every picture is a slow first-byte round trip to the server (about 2 s each, measured
 * 2026-11-02, owner: "image downloads are slow"). The same file is also served by the API's own
 * address, which IS behind Cloudflare (cached at the edge: about 0.4 s, and instant from the phone's own
 * cache afterwards). So any picture address ending in /uploads/… on another host is read through the API host.
 */

const UPLOADS = /^(https?:\/\/)([^/?#]+)(\/uploads\/[^\s]*)$/i;

/** The origin (scheme + host) of the API address, or null for a local or unparsable one. */
export function mediaOrigin(apiBaseUrl: string): string | null {
  try {
    const u = new URL(apiBaseUrl);
    if (u.protocol !== 'https:') return null; // local development keeps its own addresses
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** One address: the same /uploads/ path on the API host when it is on another host, else unchanged. */
export function viaApiHost(url: string, origin: string | null): string {
  if (!origin) return url;
  const m = UPLOADS.exec(url);
  if (!m) return url;
  return `${m[1]}${m[2]}`.toLowerCase() === origin.toLowerCase() ? url : `${origin}${m[3]}`;
}

/** Walks an API response and moves every picture address (a string that is only such a URL) to the API host. */
export function rewriteMediaUrls<T>(value: T, origin: string | null): T {
  if (!origin || value === null || typeof value !== 'object') {
    return (typeof value === 'string' ? (viaApiHost(value, origin) as unknown as T) : value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = rewriteMediaUrls(value[i], origin);
    return value;
  }
  const o = value as Record<string, unknown>;
  for (const k of Object.keys(o)) o[k] = rewriteMediaUrls(o[k], origin);
  return value;
}

/*
 * Thumbnails. The API resizes an upload on the fly: GET /uploads/products/<file>?w=<px> answers a WebP at
 * the nearest allowed width at or above `w` (never upscaled). A server that does not know `w` just serves
 * the original, so asking is always safe. A 79 pt tile on a phone then downloads ~10 KB instead of ~400 KB.
 */
export const THUMB_WIDTHS = [96, 160, 240, 320, 480, 640, 960] as const;
/** Beyond 2.5x the extra pixels cannot be seen on a phone but cost bytes. */
const MAX_PIXEL_RATIO = 2.5;

const UPLOAD_PARTS = /^(https?:\/\/[^/?#]+)(\/uploads\/[^?#\s]*)(?:\?([^#\s]*))?(#\S*)?$/i;

/** The smallest allowed width that is at least `px` (the largest one when `px` is beyond them all). */
export function thumbBucket(px: number): number {
  for (const w of THUMB_WIDTHS) if (w >= px) return w;
  return THUMB_WIDTHS[THUMB_WIDTHS.length - 1]!;
}

/**
 * The address of the picture sized for a box `cssPx` wide on a screen of `pixelRatio`: the same upload on
 * the API host with `w=<bucket>` (an existing `w` is replaced, other query parameters are kept). Anything
 * else - another host, a path that is not /uploads/, data: and file: addresses, null, or a size that is not
 * a positive number - comes back unchanged. `origin` is the API host (mediaOrigin(API_BASE_URL)); without
 * one (local development) nothing is touched.
 */
export function thumbUrl(url: string, cssPx: number, pixelRatio: number, origin: string | null): string;
export function thumbUrl(url: null | undefined, cssPx: number, pixelRatio: number, origin: string | null): null;
export function thumbUrl(url: string | null | undefined, cssPx: number, pixelRatio: number, origin: string | null): string | null;
export function thumbUrl(url: string | null | undefined, cssPx: number, pixelRatio: number, origin: string | null): string | null {
  if (!url) return url == null ? null : url;
  if (!origin || !(cssPx > 0) || !Number.isFinite(cssPx)) return url;
  const m = UPLOAD_PARTS.exec(url);
  if (!m || m[1]!.toLowerCase() !== origin.toLowerCase()) return url;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? Math.min(pixelRatio, MAX_PIXEL_RATIO) : 1;
  const w = thumbBucket(Math.ceil(cssPx * ratio));
  const kept = (m[3] ?? '').split('&').filter((p) => p !== '' && !/^w(=|$)/i.test(p));
  kept.push(`w=${w}`);
  return `${m[1]}${m[2]}?${kept.join('&')}${m[4] ?? ''}`;
}
