import { ApiError } from '../api/client';
import type { SmsLanguage } from '../api/types';
import { errorMessage } from './errors';
import { LANGUAGE_LABEL, languageNames } from './sms';
import { formatDateTime } from './inventory';

/**
 * The operator's words for the SMS screens' error codes (offers, campaigns, templates).
 * Each message says what was refused and what to do; anything not listed falls back to the
 * API's own message. Errors are { code, message, details } (backend modules/sms-offers).
 */
export function smsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const details = (err.details ?? undefined) as Record<string, unknown> | Array<{ message?: string }> | undefined;
    const d = (Array.isArray(details) ? undefined : details) as Record<string, any> | undefined;
    switch (err.code) {
      case 'OUTSIDE_SENDING_HOURS':
        return err.message || 'Offers can be sent during opening hours only.';
      case 'QUIET_HOURS': {
        const resume = typeof d?.resume_at === 'string' ? ` You can send after ${formatDateTime(d.resume_at)}.` : '';
        return `${err.message || 'SMS are not sent during quiet hours.'}${resume}`;
      }
      case 'OFFER_NO_RECIPIENTS': {
        const capped = Number(d?.skipped_capped ?? 0);
        return capped > 0
          ? `No customer in this group can get offers: ${capped} already got their share of texts (limit per customer in SMS sending rules).`
          : 'No customer in this group can get offers.';
      }
      case 'OFFER_TEXT_MISSING': {
        const missing = d?.missing_languages as SmsLanguage[] | undefined;
        return missing?.length ? `Write the ${languageNames(missing)} text first.` : err.message || 'Write the missing text first.';
      }
      case 'UNKNOWN_PLACEHOLDER': {
        const unknown = Array.isArray(d?.unknown) ? (d!.unknown as string[]) : [];
        const allowed = Array.isArray(d?.allowed) ? (d!.allowed as string[]) : [];
        if (!unknown.length) return err.message;
        return `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a placeholder.${allowed.length ? ` You can use ${allowed.join(', ')}.` : ''}`;
      }
      case 'TEXT_TOO_LONG': {
        const language = d?.language as SmsLanguage | undefined;
        if (!language || !d?.longest) return err.message;
        return `The ${LANGUAGE_LABEL[language] ?? language} text can be up to ${d.longest} characters once the name, points and wallet are filled in. Keep it under ${d.max ?? 480}.`;
      }
      case 'SMS_BUDGET_EXCEEDED': {
        if (d?.needed_parts == null) return err.message;
        return `This needs ${d.needed_parts} SMS parts but only ${d.remaining_parts} are left in this month's budget of ${d.monthly_parts}. Raise the budget in SMS sending rules, or send to fewer customers.`;
      }
      case 'VALIDATION_ERROR': {
        const first = Array.isArray(details) ? details[0]?.message : undefined;
        return first ?? err.message ?? fallback;
      }
    }
  }
  return errorMessage(err, fallback);
}
