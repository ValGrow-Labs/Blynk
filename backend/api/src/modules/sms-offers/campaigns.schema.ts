import { z } from 'zod';
import { customerAudienceSchema } from '../notifications/customer-groups.js';
import { MAX_OFFER_TEXT, SMS_LANGUAGES, SMS_OFFER_AUDIENCES, type OfferAudience } from './sms-core.js';
import { onceScheduleSchema, recurringScheduleSchema, triggerScheduleSchema } from './campaign-schedule.js';

/** Request bodies shared by the SMS offer, campaign and template routes. */

export const languageSchema = z.enum(SMS_LANGUAGES as unknown as [string, ...string[]], {
  errorMap: () => ({ message: 'Language must be si, ta or en' }),
});
export const textSchema = z.string().trim().max(MAX_OFFER_TEXT, `Keep each text under ${MAX_OFFER_TEXT} characters`);
export const messagesSchema = z.object({ si: textSchema.optional(), ta: textSchema.optional(), en: textSchema.optional() });

/**
 * Who: one of the original audiences (a string, unchanged), a customer group, or a CUSTOM filter
 * object (notifications/customer-groups.ts). Missing = ALL (`audienceSchema`) or "unchanged"
 * (`audienceInputSchema`, for PATCH).
 */
const audienceUnion = z.union([z.enum(SMS_OFFER_AUDIENCES as unknown as [string, ...string[]]), customerAudienceSchema]);
export const audienceInputSchema = audienceUnion.optional() as unknown as z.ZodType<OfferAudience | undefined, z.ZodTypeDef, unknown>;
export const audienceSchema = audienceUnion.optional().transform((a) => a ?? 'ALL') as unknown as z.ZodType<OfferAudience, z.ZodTypeDef, unknown>;

const name = z.string({ required_error: 'Give it a name' }).trim().min(1, 'Give it a name').max(120, 'Keep the name under 120 characters');

const common = { name, fallback_language: languageSchema, messages: messagesSchema };

/** POST /sms-campaigns */
export const createCampaignSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('ONCE'), ...common, audience: audienceSchema, schedule: onceScheduleSchema }),
    z.object({ kind: z.literal('RECURRING'), ...common, audience: audienceSchema, schedule: recurringScheduleSchema }),
    z.object({ kind: z.literal('TRIGGER'), ...common, schedule: triggerScheduleSchema }),
  ],
  { errorMap: () => ({ message: 'kind must be ONCE, RECURRING or TRIGGER' }) }
);
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** PATCH /sms-campaigns/:id - any of these; `schedule` is checked against the campaign's own kind. */
export const patchCampaignSchema = z
  .object({
    name: name.optional(),
    fallback_language: languageSchema.optional(),
    messages: messagesSchema.optional(),
    audience: audienceInputSchema,
    schedule: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Send at least one field to change' });
export type PatchCampaignInput = z.infer<typeof patchCampaignSchema>;

/** POST /sms-campaigns/preview - `schedule` only matters for a TRIGGER (who it would text today). */
export const previewCampaignSchema = z.object({
  kind: z.enum(['ONCE', 'RECURRING', 'TRIGGER']).optional(),
  audience: audienceSchema,
  fallback_language: languageSchema,
  messages: messagesSchema,
  schedule: z.record(z.unknown()).optional(),
});
export type PreviewCampaignInput = z.infer<typeof previewCampaignSchema>;

/** POST /sms-templates, PUT /sms-templates/:id */
export const templateSchema = z.object({
  name: z.string({ required_error: 'Give the template a name' }).trim().min(1, 'Give the template a name').max(80, 'Keep the name under 80 characters'),
  messages: messagesSchema,
});
export type TemplateInput = z.infer<typeof templateSchema>;

export const idParam = z.object({ id: z.string().uuid('Not a valid id') });
