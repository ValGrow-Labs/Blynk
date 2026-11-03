import type { SmsLanguage, SmsOfferAudience } from '../api/types';

/**
 * SMS offer helpers for More -> SMS offers. The counting rule and the
 * opt-out lines are copies of the backend's (backend/api/src/modules/
 * sms-offers/sms-offers.service.ts) so the screen can show the cost while
 * the operator types; the backend's own count is what is actually charged.
 */

export const SMS_LANGUAGES: readonly SmsLanguage[] = ['si', 'ta', 'en'];
export const MAX_OFFER_TEXT = 480;

export const LANGUAGE_LABEL: Record<SmsLanguage, string> = { si: 'Sinhala', ta: 'Tamil', en: 'English' };

export const AUDIENCE_LABEL: Record<SmsOfferAudience, string> = {
  ALL: 'All customers',
  ORDERED_30D: 'Ordered in last 30 days',
  ORDERED_90D: 'Ordered in last 90 days',
  NEVER_ORDERED: 'Signed up, never ordered',
};

/** Appended by the backend to every offer SMS, in its own language. */
export const OPT_OUT_LINE: Record<SmsLanguage, string> = {
  en: 'Stop offers: Blynk app > Profile > SMS & offers',
  si: 'දීමනා නවත්වන්න: Blynk app > Profile > SMS & offers',
  ta: 'சலுகைகளை நிறுத்த: Blynk app > Profile > SMS & offers',
};

/** The SMS a customer receives: the text, then the opt-out line. */
// The owner dropped the opt-out line (owner, 2026-10-09: "No need"): offers go out exactly as written.
export const withOptOut = (text: string, _language: SmsLanguage) => text.trim();

// GSM 03.38: the basic set, and the extension set whose characters take two.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';

/**
 * How many SMS parts a text costs. Plain Latin text: 160 characters in one
 * SMS, 153 per part when split. Sinhala, Tamil or any other non-GSM
 * character makes it Unicode: 70 in one SMS, 67 per part.
 */
export function smsParts(text: string): number {
  let gsmLength = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) return gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  const units = text.length; // UTF-16 code units, which is what UCS-2 SMS counts
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/** "1 SMS" / "3 SMS parts" - one wording everywhere on the screen. */
export const partsText = (parts: number) => (parts === 1 ? '1 SMS' : `${parts} SMS parts`);

// ----------------------------------------------------------------- placeholders
// 2026-11-03: {name} {points} {wallet} {app_link} in any text, filled in per customer when the SMS
// is queued (backend modules/sms-offers/placeholders.ts). The screen asks the API for the list
// (GET /admin/sms-placeholders) and falls back to this one.
export const FALLBACK_PLACEHOLDERS: ReadonlyArray<{ token: string; description: string; example: string }> = [
  { token: '{name}', description: "The customer's first name", example: 'Nimal' },
  { token: '{points}', description: 'Blynk Points the customer holds', example: '120' },
  { token: '{wallet}', description: 'Blynk Wallet balance', example: 'LKR 1,250' },
  { token: '{app_link}', description: 'Link to the Blynk app', example: 'https://blynk.lk/app' },
];

const PLACEHOLDER_TOKEN = /\{([^{}]*)\}/g;
const APP_LINK = 'https://blynk.lk/app';

/** The braces in `text` that are not one of `allowed` (tokens like "{name}"), as written, without repeats. */
export function unknownPlaceholders(text: string, allowed: readonly string[] = FALLBACK_PLACEHOLDERS.map((p) => p.token)): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_TOKEN)) if (!allowed.includes(m[0])) bad.add(m[0]);
  return [...bad];
}

const fill = (text: string, values: { name: string; points: string; wallet: string }) =>
  text
    .replace(PLACEHOLDER_TOKEN, (whole, key: string) =>
      key === 'name' ? values.name : key === 'points' ? values.points : key === 'wallet' ? values.wallet : key === 'app_link' ? APP_LINK : whole
    )
    .trim();

/** The text for a made-up customer (the example under a text box). */
export const renderSample = (text: string) => fill(text, { name: 'Nimal', points: '120', wallet: 'LKR 1,250' });

/** The longest the text plausibly gets: a 20-letter name, 7-digit points, LKR 9,999,999.99. */
export const renderLongest = (text: string) => fill(text, { name: 'W'.repeat(20), points: '9999999', wallet: 'LKR 9,999,999.99' });

/** Characters, counting each letter once (as the backend does). */
export const textLength = (text: string) => [...text].length;

/** A list of language names: "Tamil", "Sinhala and Tamil". */
export const languageNames = (languages: readonly SmsLanguage[]) =>
  languages.map((l) => LANGUAGE_LABEL[l]).join(' and ').replace(/ and (?=.* and )/g, ', ');
