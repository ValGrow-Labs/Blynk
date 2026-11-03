import { sql, type Kysely, type Transaction } from 'kysely';
import { env } from '../../config/env.js';
import type { Database, SmsLanguage, SmsOfferAudience } from '../../database/types.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { audienceCondition, type CustomerAudience } from '../notifications/customer-groups.js';

/**
 * The pieces of SMS offers every part of the module shares (moved out of sms-offers.service.ts
 * on 2026-11-03 so campaigns could use them without an import cycle; the service re-exports all
 * of it, so `import ... from './sms-offers.service.js'` keeps working): languages, text length,
 * SMS parts, and the customers an audience reaches.
 */

export const SMS_LANGUAGES: readonly SmsLanguage[] = ['si', 'ta', 'en'];
export const SMS_OFFER_AUDIENCES: readonly SmsOfferAudience[] = ['ALL', 'ORDERED_30D', 'ORDERED_90D', 'NEVER_ORDERED'];
export const MAX_OFFER_TEXT = 480;

/**
 * Appended to every offer SMS in its own language. The Sinhala and Tamil
 * lines should be checked by a native speaker before launch.
 */
export const OPT_OUT_LINE: Record<SmsLanguage, string> = {
  en: 'Stop offers: Blynk app > Profile > SMS & offers',
  si: 'දීමනා නවත්වන්න: Blynk app > Profile > SMS & offers',
  ta: 'சலுகைகளை நிறுத்த: Blynk app > Profile > SMS & offers',
};

// The owner dropped the opt-out line (owner, 2026-10-09: "No need"): offers go out exactly as written.
export const withOptOut = (text: string, _language: SmsLanguage) => text.trim();

/**
 * The languages offers are written and sent in (SMS_OFFER_LANGUAGES; English
 * only at launch). Unknown entries are ignored; nothing valid means English.
 */
export function enabledOfferLanguages(configured: string = env.SMS_OFFER_LANGUAGES ?? 'en'): SmsLanguage[] {
  const wanted = configured.split(',').map((s) => s.trim());
  const picked = SMS_LANGUAGES.filter((l) => wanted.includes(l));
  return picked.length ? picked : ['en'];
}

/**
 * The language one customer is sent: their own if it is switched on, else
 * the offer's fallback if that is switched on, else the first one that is.
 */
export function languageFor(
  customer: SmsLanguage | null,
  fallback: SmsLanguage,
  enabled: SmsLanguage[] = enabledOfferLanguages()
): SmsLanguage {
  if (customer && enabled.includes(customer)) return customer;
  return enabled.includes(fallback) ? fallback : enabled[0];
}

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

export type Executor = Kysely<Database> | Transaction<Database>;

export type OfferMessages = Partial<Record<SmsLanguage, string>>;

/**
 * Who an offer goes to: one of the original audiences ('ALL', 'ORDERED_30D',
 * 'ORDERED_90D', 'NEVER_ORDERED' - unchanged), or a customer group (owner,
 * 2026-10-24; notifications/customer-groups.ts) such as { group: 'LAPSED', days: 14 },
 * or { group: 'CUSTOM', ...filters } (2026-11-03).
 */
export type OfferAudience = SmsOfferAudience | CustomerAudience;

/**
 * sms_offers.audience (a CHECKed column from migration 027): the original
 * value as sent; a group NEVER_ORDERED is the same set as the original one;
 * the other groups are stored as ALL and the group itself is kept in the
 * SMS_OFFER_SENT audit row (listOffers reads it back as `audience_group`).
 */
export function offerColumnAudience(audience: OfferAudience): SmsOfferAudience {
  if (typeof audience === 'string') return audience;
  return audience.group === 'NEVER_ORDERED' ? 'NEVER_ORDERED' : 'ALL';
}

/**
 * Customers an audience reaches: active, registered, not opted out. With
 * `optedOut` it is the same audience's customers who turned offers off.
 */
export function audienceQuery(executor: Executor, audience: OfferAudience, optedOut = false) {
  let q = executor
    .selectFrom('users as u')
    .where('u.role', '=', 'CUSTOMER')
    .where('u.is_active', '=', true)
    .where('u.sms_offers_opted_out_at', optedOut ? 'is not' : 'is', null);
  if (typeof audience === 'object') return q.where(audienceCondition(audience));
  const ordered = (days: number) =>
    sql<boolean>`exists (select 1 from orders o where o.customer_id = u.id and o.created_at >= now() - make_interval(days => ${days}))`;
  if (audience === 'ORDERED_30D') q = q.where(ordered(30));
  if (audience === 'ORDERED_90D') q = q.where(ordered(90));
  if (audience === 'NEVER_ORDERED') q = q.where(sql<boolean>`not exists (select 1 from orders o where o.customer_id = u.id)`);
  return q;
}

/** The number an offer SMS would go to, or null when no SMS can reach it. */
export function smsRecipient(phone: string): string | null {
  try {
    return normalizeSriLankanPhone(phone);
  } catch {
    return null; // not a Sri Lankan mobile (or a deleted account's placeholder)
  }
}
