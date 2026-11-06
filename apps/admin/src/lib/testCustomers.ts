/**
 * Test customers = Google Play testers (2026-11-06; GET|PUT /admin/settings/test-customers { phones }). Staff paste the
 * testers' numbers; the API keeps them as +947XXXXXXXX (at most 50). The helpers below read what staff typed the same
 * way the API does, so a bad entry is named before anything is sent, and mask a saved number for the screen.
 * Never show a saved number in full: only its last 3 digits.
 */

export const MAX_TEST_CUSTOMERS = 50;

export const TEST_CUSTOMERS_HELP =
  'People on this list can place test orders any time, from any address, cash on delivery only. Their orders are cancelled automatically after about 10 minutes and staff are not alerted. Use it for Google Play testers.';

/** One typed entry as '+947XXXXXXXX', or null when it is not a Sri Lankan mobile number (7X.., 07X.., 947X.., +947X.., spaces and dashes ok). */
export function normaliseTesterPhone(raw: string): string | null {
  const compact = raw.replace(/[\s\-.()]/g, '');
  let digits: string;
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+94')) return null;
    digits = compact.slice(3);
  } else if (compact.startsWith('94') && compact.length === 11) {
    digits = compact.slice(2);
  } else if (compact.startsWith('0')) {
    digits = compact.slice(1);
  } else {
    digits = compact;
  }
  return /^7\d{8}$/.test(digits) ? `+94${digits}` : null;
}

export interface TesterEntries {
  /** Readable numbers, normalised and without repeats, in the order typed. */
  numbers: string[];
  /** Entries that could not be read, as typed. */
  unreadable: string[];
}

/**
 * Reads pasted text: one number per line, or separated by commas, semicolons or spaces. A line or comma part that is
 * one number (even with spaces inside, like "077 123 4567") is one number; otherwise it is split on spaces.
 */
export function readTesterEntries(text: string): TesterEntries {
  const numbers: string[] = [];
  const unreadable: string[] = [];
  const take = (entry: string) => {
    const phone = normaliseTesterPhone(entry);
    if (phone) {
      if (!numbers.includes(phone)) numbers.push(phone);
    } else if (!unreadable.includes(entry)) {
      unreadable.push(entry);
    }
  };
  for (const part of text.split(/[\n\r,;]+/)) {
    const chunk = part.trim();
    if (!chunk) continue;
    const whole = normaliseTesterPhone(chunk);
    if (whole || !/\s/.test(chunk)) take(chunk);
    else for (const token of chunk.split(/\s+/)) take(token);
  }
  return { numbers, unreadable };
}

/** '+94712345839' -> '+94 7X XXX X839' (the last 3 digits only). */
export function maskTesterPhone(phone: string): string {
  const last = phone.replace(/\D/g, '').slice(-3);
  return `+94 7X XXX X${last}`;
}
