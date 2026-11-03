/*
 * What may never leave the app in an analytics event or a crash report. Shared by the web
 * dataLayer (track.ts), the phone's Firebase Analytics events (firebaseEvents.ts) and the crash
 * reports (firebaseSink.ts). Pure.
 */

/** Keys that are personal data whatever their value. `item_name` / `item_list_name` are product and list names, allowed. */
const PII_KEY = /(^|_)(full_?name|first_?name|last_?name|name|phone|mobile|msisdn|email|e_?mail|address|address_line\d?|street|recipient|lat|lng|lon|latitude|longitude|coords?|geo|otp|token|password|birthday|dob|referral_code)($|_)/i;
const ALLOWED_NAME_KEYS = new Set(['item_name', 'item_list_name', 'promotion_name', 'page_title']);
export const isPiiKey = (k: string) => !ALLOWED_NAME_KEYS.has(k) && PII_KEY.test(k);

/** Phone- or email-looking text in free text (a search term, an error message) becomes [redacted]. */
export function redact(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[redacted]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[redacted]');
}

/** Drops personal keys (top level and inside `ecommerce`); undefined values are kept (they clear a key in GTM). */
export function sanitize(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) {
    if (isPiiKey(k)) continue;
    if (k === 'ecommerce' && v && typeof v === 'object') {
      const e: Record<string, unknown> = {};
      for (const [ek, ev] of Object.entries(v as Record<string, unknown>)) if (!isPiiKey(ek)) e[ek] = ev;
      out[k] = e;
    } else out[k] = v;
  }
  return out;
}
