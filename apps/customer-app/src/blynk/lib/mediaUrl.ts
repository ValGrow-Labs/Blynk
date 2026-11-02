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
