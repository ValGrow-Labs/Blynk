import type { SmsLanguage } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { MAX_OFFER_TEXT, SMS_LANGUAGES, type OfferMessages } from './sms-core.js';

/**
 * Placeholders in SMS texts (owner's brother, 2026-11-03: "fully customised"). Written as {name}
 * in any of the three texts and filled in per customer when the SMS is queued:
 *
 *   {name}      the customer's first name (at most 20 characters); a customer with no name gets
 *               'friend' / 'මිත්‍රයා' / 'நண்பரே' - the word of the TEXT's language
 *   {points}    Blynk Points held now, a whole number: 120
 *   {wallet}    Blynk Wallet balance: 'LKR 1,250'
 *   {app_link}  https://blynk.lk/app
 *
 * Anything else in braces is refused when the text is saved (UNKNOWN_PLACEHOLDER, with the list
 * of allowed ones). SMS parts are estimated on the longest plausible rendering.
 */
export const APP_LINK = 'https://blynk.lk/app';
export const NAME_MAX = 20;

export const PLACEHOLDERS = [
  { token: '{name}', key: 'name', description: "The customer's first name", example: 'Nimal' },
  { token: '{points}', key: 'points', description: 'Blynk Points the customer holds', example: '120' },
  { token: '{wallet}', key: 'wallet', description: 'Blynk Wallet balance', example: 'LKR 1,250' },
  { token: '{app_link}', key: 'app_link', description: 'Link to the Blynk app', example: APP_LINK },
] as const;
export const PLACEHOLDER_KEYS: readonly string[] = PLACEHOLDERS.map((p) => p.key);

/** What a customer with no name is called, by the text's language. */
export const NAME_FALLBACK: Record<SmsLanguage, string> = { en: 'friend', si: 'මිත්‍රයා', ta: 'நண்பரே' };

const TOKEN = /\{([^{}]*)\}/g;

/** The braces in `text` that are not an allowed placeholder, as written (without repeats). */
export function unknownPlaceholders(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(TOKEN)) {
    if (!PLACEHOLDER_KEYS.includes(m[1])) bad.add(m[0]);
  }
  return [...bad];
}

export function usesPlaceholder(text: string, key: string): boolean {
  for (const m of text.matchAll(TOKEN)) if (m[1] === key) return true;
  return false;
}

/** The first word of a full name, capped; null when there is no usable name. */
export function firstName(fullName: string | null | undefined): string | null {
  const word = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!word) return null;
  return [...word].slice(0, NAME_MAX).join('');
}

export const formatWallet = (amount: number) =>
  `LKR ${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export interface RenderContext {
  /** First name, or null for the language's fallback word. */
  name: string | null;
  points: number;
  wallet: number;
}

/** `text` for one customer. `language` is the language `text` is written in. */
export function renderText(text: string, language: SmsLanguage, ctx: RenderContext): string {
  return text
    .replace(TOKEN, (whole, key: string) => {
      switch (key) {
        case 'name':
          return ctx.name ?? NAME_FALLBACK[language];
        case 'points':
          return String(Math.max(0, Math.floor(ctx.points)));
        case 'wallet':
          return formatWallet(ctx.wallet);
        case 'app_link':
          return APP_LINK;
        default:
          return whole;
      }
    })
    .trim();
}

/** The longest a rendering plausibly gets: a 20-letter name, 7-digit points, LKR 9,999,999.99. */
export const LONGEST_CONTEXT: RenderContext = { name: 'W'.repeat(NAME_MAX), points: 9_999_999, wallet: 9_999_999.99 };

export function renderLongest(text: string, language: SmsLanguage): string {
  return renderText(text, language, LONGEST_CONTEXT);
}

/** A made-up customer, for test SMS and sample lines. */
export const SAMPLE_CONTEXT: RenderContext = { name: 'Nimal', points: 120, wallet: 1250 };

/**
 * Refuses unknown placeholders (400 UNKNOWN_PLACEHOLDER, naming them and listing the allowed
 * ones) and a text whose longest plausible rendering is over the 480-character limit
 * (400 TEXT_TOO_LONG). Empty texts are skipped.
 */
export function assertTemplateText(messages: OfferMessages): void {
  const unknown = new Set<string>();
  for (const lang of SMS_LANGUAGES) {
    const text = messages[lang];
    if (text) for (const u of unknownPlaceholders(text)) unknown.add(u);
  }
  if (unknown.size) {
    const allowed = PLACEHOLDERS.map((p) => p.token);
    throw new AppError(
      `${[...unknown].join(', ')} ${unknown.size === 1 ? 'is' : 'are'} not a placeholder. You can use ${allowed.join(', ')}.`,
      400,
      'UNKNOWN_PLACEHOLDER',
      { unknown: [...unknown], allowed }
    );
  }
  for (const lang of SMS_LANGUAGES) {
    const text = messages[lang];
    if (!text) continue;
    const longest = [...renderLongest(text, lang)].length;
    if (longest > MAX_OFFER_TEXT) {
      throw new AppError(
        `The ${lang.toUpperCase()} text can be up to ${longest} characters once the name, points and wallet are filled in. Keep it under ${MAX_OFFER_TEXT}.`,
        400,
        'TEXT_TOO_LONG',
        { language: lang, longest, max: MAX_OFFER_TEXT }
      );
    }
  }
}
