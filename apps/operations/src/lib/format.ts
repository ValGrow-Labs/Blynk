/**
 * Small formatters the Delivery screens need that no existing Operations
 * `lib` file already provides (`lib/orders.ts` already has `formatMoney`/
 * `formatClock`/`shortNumber`, reused by Delivery for consistency rather than
 * duplicated here). Ported from apps/rider/src/lib/format.ts's equivalent
 * functions (a fresh implementation, not an import - common.md rule 2).
 */

/** "+94771234567" → "077 123 4567" for reading aloud; the tel: link keeps the raw number. */
export function formatPhone(phone: string): string {
  const local = phone.replace(/^\+94/, '0').replace(/\s+/g, '');
  return /^0\d{9}$/.test(local) ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone;
}

/**
 * How long ago something happened, in the same steps the Rider app uses:
 * seconds under a minute, whole minutes under an hour, whole hours after
 * that. "4s ago", "2 min ago", "1 h ago". A negative age (clock skew) reads
 * as "0s ago" rather than a negative number.
 */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s ago`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min ago`;
  return `${Math.floor(whole / 3600)} h ago`;
}
