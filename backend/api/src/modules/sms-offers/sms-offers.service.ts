import crypto from 'crypto';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import type { SmsLanguage } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { isPlaceholderPhone, normalizeSriLankanPhone } from '../../utils/phone.js';
import { orderingClock } from '../../utils/time.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { audienceFromStored, type CustomerAudience } from '../notifications/customer-groups.js';
import {
  SMS_LANGUAGES,
  audienceQuery,
  enabledOfferLanguages,
  languageFor,
  offerColumnAudience,
  smsParts,
  smsRecipient,
  withOptOut,
  type OfferAudience,
  type OfferMessages,
} from './sms-core.js';
import { SAMPLE_CONTEXT, assertTemplateText, renderLongest, renderText } from './placeholders.js';
import {
  assertSmsSendAllowed,
  budgetState,
  currentSendDecision,
  lockBudget,
  smsLimitsSettings,
  type BudgetState,
  type SmsLimitsSetting,
} from './sending-rules.js';
import {
  queueRecipients,
  renderRecipients,
  selectRecipients,
  type TriggerSchedule,
} from './sms-recipients.js';

/**
 * SMS offers to registered customers (migration 027, owner 2026-10-06).
 *
 * Admin and Operations write an offer in Sinhala, Tamil and/or English; each
 * customer gets the version in the language they picked in the app, or the
 * offer's fallback language if they never picked one. Customers who turned
 * "Offers by SMS" off get nothing. Each recipient's SMS is a row in the
 * notifications outbox, so the worker sends it with the usual retries.
 *
 * When offers may go out is decided by the SMS sending rules (sending-rules.ts;
 * 2026-11-03: any time by default, optional quiet hours, optional opening-hours
 * rule), and the optional limits (a cap per customer, a monthly budget) apply.
 * Texts may hold placeholders ({name}, {points}, {wallet}, {app_link};
 * placeholders.ts). Offers that go later or repeat are campaigns (campaigns.service.ts).
 */

// Languages, SMS parts, audiences and the customers they reach live in sms-core.ts.
export * from './sms-core.js';

/**
 * The SMS side of a customer group's preview: `customers` in the group who
 * have not turned offers off, `phones` of them an SMS can reach (a Sri Lankan
 * mobile - what a send queues), and `opted_out` reachable ones who turned
 * offers off.
 */
export async function smsGroupCounts(audience: CustomerAudience) {
  const rows = await audienceQuery(db, audience).select(['u.phone']).execute();
  const optedOutRows = await audienceQuery(db, audience, true).select(['u.phone']).execute();
  return {
    audience,
    customers: rows.length,
    phones: rows.filter((r) => smsRecipient(r.phone)).length,
    opted_out: optedOutRows.filter((r) => smsRecipient(r.phone)).length,
  };
}

export interface AudienceSummary {
  audience: OfferAudience | null;
  recipients: number;
  /** Recipients per language they will be sent, after the fallback. */
  by_language: Record<SmsLanguage, number>;
  /** How many of them get the fallback (never picked a language, or picked one that is off). */
  without_language: number;
  /** Customers this audience would reach but who turned offers off. */
  opted_out: number;
  /** Customers left out because they already got their share of SMS offers (per-customer cap). */
  skipped_capped: number;
  /** Customers left out because no SMS can reach their number. */
  skipped_no_phone: number;
}

const LANGUAGE_NAME: Record<SmsLanguage, string> = { si: 'Sinhala', ta: 'Tamil', en: 'English' };

export interface OfferEstimate extends AudienceSummary {
  /** The languages offers are written in right now (English only at launch). */
  languages: SmsLanguage[];
  /** SMS parts one recipient costs at most, per language (placeholders at their longest). */
  parts_per_sms: Partial<Record<SmsLanguage, number>>;
  /** The cost estimate in SMS parts: recipients x parts_per_sms, per language. */
  sms_parts_total: number;
  /** Languages that have recipients but no text yet. */
  missing_languages: SmsLanguage[];
  /** Up to 3 recipients' real texts (their language, name, points and wallet filled in). */
  samples: { language: SmsLanguage; text: string; parts: number }[];
  /** The monthly budget after this month's sends so far, or null when no budget is set. */
  budget: (BudgetState & { would_exceed: boolean }) | null;
  /** Whether a send right now is allowed by the SMS sending rules. */
  sending: { allowed: boolean; code: string | null; message: string | null; resume_at: string | null };
}

export interface EstimateSpec {
  /** Who: one of the audiences (default ALL), or a trigger's customers (a campaign preview). */
  audience?: OfferAudience;
  trigger?: TriggerSchedule;
  campaignId?: string | null;
  fallback_language: SmsLanguage;
  messages: OfferMessages;
  now?: Date;
}

/** Who would get it, in which language, how many SMS parts it costs, and a few sample texts. */
export async function buildEstimate(spec: EstimateSpec): Promise<OfferEstimate> {
  const now = spec.now ?? orderingClock.now();
  const limits = await smsLimitsSettings.read();
  const selection = await selectRecipients(db, {
    audience: spec.audience,
    trigger: spec.trigger,
    campaignId: spec.campaignId,
    limits,
    now,
  });
  const enabled = enabledOfferLanguages();
  const by_language: Record<SmsLanguage, number> = { si: 0, ta: 0, en: 0 };
  let without_language = 0;
  for (const c of selection.customers) {
    const lang = languageFor(c.sms_language, spec.fallback_language, enabled);
    by_language[lang] += 1;
    if (lang !== c.sms_language) without_language += 1;
  }
  const parts_per_sms: Partial<Record<SmsLanguage, number>> = {};
  const missing_languages: SmsLanguage[] = [];
  let sms_parts_total = 0;
  for (const lang of SMS_LANGUAGES) {
    const text = spec.messages[lang]?.trim();
    if (text) parts_per_sms[lang] = smsParts(renderLongest(withOptOut(text, lang), lang));
    const count = by_language[lang];
    if (count === 0) continue;
    if (!text) missing_languages.push(lang);
    else sms_parts_total += count * parts_per_sms[lang]!;
  }
  const samples = (await renderRecipients(db, selection.customers.slice(0, 3), spec.fallback_language, spec.messages, now)).map((r) => ({
    language: r.language,
    text: r.text,
    parts: r.parts,
  }));
  const state = await budgetState(db, limits, now);
  const decision = await currentSendDecision(now);
  return {
    audience: spec.audience ?? null,
    recipients: by_language.si + by_language.ta + by_language.en,
    by_language,
    without_language,
    opted_out: selection.opted_out,
    skipped_capped: selection.capped,
    skipped_no_phone: selection.no_phone,
    languages: enabled,
    parts_per_sms,
    sms_parts_total,
    missing_languages,
    samples,
    budget: state ? { ...state, would_exceed: sms_parts_total > state.remaining_parts } : null,
    sending: decision.allowed
      ? { allowed: true, code: null, message: null, resume_at: null }
      : { allowed: false, code: decision.code, message: decision.message, resume_at: decision.resume_at ? decision.resume_at.toISOString() : null },
  };
}

export async function estimateOffer(audience: OfferAudience, fallback: SmsLanguage, messages: OfferMessages): Promise<OfferEstimate> {
  assertTemplateText(messages);
  return buildEstimate({ audience, fallback_language: fallback, messages });
}

/** 422 SMS_BUDGET_EXCEEDED: `needed` parts do not fit what is left of this month's budget. */
export function budgetExceeded(needed: number, state: BudgetState): AppError {
  return new AppError(
    `This needs ${needed} SMS parts but only ${state.remaining_parts} are left in this month's budget of ${state.monthly_parts}. Raise the budget in SMS sending rules, or send to fewer customers.`,
    422,
    'SMS_BUDGET_EXCEEDED',
    { needed_parts: needed, remaining_parts: state.remaining_parts, monthly_parts: state.monthly_parts, used_parts: state.used_parts }
  );
}

/** Sends an offer to its audience right now: one outbox SMS per customer. */
export async function sendOffer(
  actor: AuditActor,
  input: { audience: OfferAudience; fallback_language: SmsLanguage; messages: OfferMessages }
) {
  await assertSmsSendAllowed();
  const estimate = await estimateOffer(input.audience, input.fallback_language, input.messages);
  if (estimate.missing_languages.length) {
    const names = estimate.missing_languages.map((l) => LANGUAGE_NAME[l]).join(' and ');
    throw new AppError(`Write the ${names} text: some customers in this audience get that language.`, 400, 'OFFER_TEXT_MISSING', {
      missing_languages: estimate.missing_languages,
    });
  }
  if (estimate.recipients === 0) {
    throw new AppError('No customer in this audience can receive offers.', 400, 'OFFER_NO_RECIPIENTS', {
      skipped_capped: estimate.skipped_capped,
    });
  }

  return db.transaction().execute(async (trx) => {
    const limits: SmsLimitsSetting = await smsLimitsSettings.read();
    if (limits.monthly_budget.enabled) await lockBudget(trx);
    const now = orderingClock.now();
    const selection = await selectRecipients(trx, { audience: input.audience, limits, now });
    const rendered = await renderRecipients(trx, selection.customers, input.fallback_language, input.messages, now);
    const needed = rendered.reduce((n, r) => n + r.parts, 0);
    const budget = await budgetState(trx, limits, now);
    if (budget && needed > budget.remaining_parts) throw budgetExceeded(needed, budget);

    const offer = await trx
      .insertInto('sms_offers')
      .values({
        created_by: actor.actorId,
        audience: offerColumnAudience(input.audience),
        fallback_language: input.fallback_language,
        message_si: input.messages.si?.trim() || null,
        message_ta: input.messages.ta?.trim() || null,
        message_en: input.messages.en?.trim() || null,
      })
      .returning(['id', 'created_at'])
      .executeTakeFirstOrThrow();

    const queued = await queueRecipients(trx, rendered, {
      keyOf: (r) => `sms-offer:${offer.id}:${r.id}`,
      payloadOf: (r) => ({ text: r.text, offer_id: offer.id, language: r.language }),
    });
    const recipients = queued.length;
    const parts = queued.reduce((n, r) => n + r.parts, 0);
    await trx.updateTable('sms_offers').set({ recipient_count: recipients, sms_parts_total: parts }).where('id', '=', offer.id).execute();
    await writeAudit(trx, actor, {
      action: 'SMS_OFFER_SENT',
      entityType: 'sms_offer',
      entityId: offer.id,
      newValues: {
        audience: input.audience,
        fallback_language: input.fallback_language,
        recipients,
        sms_parts_total: parts,
        ...(selection.capped ? { skipped_capped: selection.capped } : {}),
      },
    });
    return {
      id: offer.id,
      created_at: offer.created_at,
      audience: input.audience,
      recipients,
      sms_parts_total: parts,
      skipped_capped: selection.capped,
    };
  });
}

/** Test SMS one staff member may send per rolling hour. */
export const MAX_TESTS_PER_HOUR = 5;

/**
 * Sends one language's text to a phone, to check it: `toPhone` (already a
 * normalised Sri Lankan mobile) when given, else the staff member's own
 * phone. Admin accounts have no phone (migration 028), so they enter one;
 * with neither, 400 NO_TEST_PHONE. Placeholders are filled in with a made-up
 * customer (Nimal, 120 points, LKR 1,250). Tests count against neither the
 * per-customer cap nor the monthly budget.
 */
export async function sendTestOffer(actor: AuditActor, language: SmsLanguage, message: string, toPhone?: string) {
  // Same sending rules as real offers (quiet hours; opening hours when "any time" is off).
  await assertSmsSendAllowed();
  assertTemplateText({ [language]: message });
  const recent = await db
    .selectFrom('notifications')
    .select(sql<string>`count(*)`.as('n'))
    .where('user_id', '=', actor.actorId)
    .where('notification_type', '=', 'SMS_OFFER')
    .where('idempotency_key', 'like', 'sms-offer-test:%')
    .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
    .executeTakeFirst();
  if (Number(recent?.n ?? 0) >= MAX_TESTS_PER_HOUR) {
    throw new AppError(
      `You can send ${MAX_TESTS_PER_HOUR} test SMS an hour. Try again later.`,
      429,
      'TOO_MANY_TESTS',
      { max_per_hour: MAX_TESTS_PER_HOUR }
    );
  }
  let phone: string;
  try {
    if (toPhone) {
      phone = normalizeSriLankanPhone(toPhone);
    } else {
      const staff = await db.selectFrom('users').select(['phone']).where('id', '=', actor.actorId).executeTakeFirst();
      if (isPlaceholderPhone(staff?.phone)) throw new Error('no phone');
      phone = normalizeSriLankanPhone(staff?.phone ?? '');
    }
  } catch {
    throw new AppError('Enter the number to send the test to.', 400, 'NO_TEST_PHONE');
  }
  const text = renderText(withOptOut(message, language), language, SAMPLE_CONTEXT);
  const now = new Date();
  await db
    .insertInto('notifications')
    .values({
      user_id: actor.actorId,
      order_id: null,
      idempotency_key: `sms-offer-test:${crypto.randomUUID()}`,
      channel: 'SMS',
      notification_type: 'SMS_OFFER',
      recipient: phone,
      payload: JSON.stringify({ text, test: true, language }),
      status: 'QUEUED',
      attempts: 0,
      max_attempts: 3,
      next_attempt_at: now,
      created_at: now,
      updated_at: now,
    } as never)
    .execute();
  return { sent_to: `${phone.slice(0, 6)}****${phone.slice(-2)}`, sms_parts: smsParts(text), text };
}

/**
 * The latest offers, newest first, with who sent them. `audience_group` is the
 * customer group the offer went to (from its audit row), or null for an offer
 * sent to one of the original audiences.
 */
export async function listOffers(limit = 50) {
  const rows = await db
    .selectFrom('sms_offers as o')
    .leftJoin('users as s', 's.id', 'o.created_by')
    .select([
      'o.id',
      'o.audience',
      'o.fallback_language',
      'o.message_si',
      'o.message_ta',
      'o.message_en',
      'o.recipient_count',
      'o.sms_parts_total',
      'o.created_at',
      's.full_name as sent_by_name',
      's.role as sent_by_role',
      sql<unknown>`(SELECT a.new_values->'audience' FROM audit_logs a
                     WHERE a.entity_type = 'sms_offer' AND a.entity_id = o.id AND a.action = 'SMS_OFFER_SENT'
                     ORDER BY a.created_at DESC LIMIT 1)`.as('audit_audience'),
    ])
    .orderBy('o.created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(({ audit_audience, ...row }) => ({
    ...row,
    audience_group: audit_audience && typeof audit_audience === 'object' ? audienceFromStored(audit_audience) : null,
  }));
}
