import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import type { AuditActor } from '../audit/audit.writer.js';
import { normalizeSriLankanPhone } from '../../utils/phone.js';
import { orderingClock } from '../../utils/time.js';
import { estimateOffer, listOffers, sendOffer, sendTestOffer, smsGroupCounts } from './sms-offers.service.js';
import { parseAudienceQuery } from '../notifications/customer-groups.js';
import {
  audienceSchema,
  createCampaignSchema,
  idParam,
  languageSchema,
  messagesSchema,
  patchCampaignSchema,
  previewCampaignSchema,
  templateSchema,
  textSchema,
} from './campaigns.schema.js';
import {
  CAMPAIGN_KINDS,
  CAMPAIGN_STATUSES,
  cancelCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  patchCampaign,
  pauseCampaign,
  previewCampaign,
  resumeCampaign,
  smsHistory,
} from './campaigns.service.js';
import { createTemplate, deleteTemplate, getTemplate, listTemplates, updateTemplate } from './templates.service.js';
import { MAX_OFFER_TEXT, SMS_LANGUAGES } from './sms-core.js';
import { PLACEHOLDERS } from './placeholders.js';
import { onceScheduleSchema } from './campaign-schedule.js';
import {
  currentSendDecision,
  monthStartOf,
  monthlyPartsUsed,
  smsLimitsSettings,
  smsSendingSettings,
  updateSmsLimitsSchema,
  updateSmsSendingSchema,
} from './sending-rules.js';
import { DateTime } from 'luxon';

/*
 * SMS offers (migration 027), campaigns, templates and sending rules (migration 066, 2026-11-03).
 * Mounted under /admin (/api/v1/admin/...); every route is ADMIN and OPERATIONS:
 *
 *   GET  /sms-offers/audience              a customer group's size (?group=&days=&min_spend_lkr=)
 *   GET  /sms-offers/areas                 towns/cities customers have addresses in (for the CUSTOM audience's `areas`)
 *   GET  /sms-placeholders                 the {name} {points} {wallet} {app_link} placeholders
 *   POST /sms-offers/estimate              who/language/parts/samples for an offer's audience and texts
 *   POST /sms-offers/test                  one test SMS
 *   POST /sms-offers                       send now; with `send_at` it is scheduled (a ONCE campaign)
 *   GET  /sms-offers                       offers sent now, newest first
 *   GET|PUT /settings/sms-sending          any time / quiet hours
 *   GET|PUT /settings/sms-limits           per-customer cap / monthly budget
 *   GET|POST /sms-templates, GET|PUT|DELETE /sms-templates/:id
 *   GET|POST /sms-campaigns, POST /sms-campaigns/preview, GET /sms-campaigns/history,
 *   GET|PATCH /sms-campaigns/:id, POST /sms-campaigns/:id/pause|resume|cancel
 */
export const smsOffersRouter = Router();

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
const STAFF = [requireAuth, requireRoles(['ADMIN', 'OPERATIONS'])];
const actorOf = (req: Request): AuditActor => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

const offerSchema = z.object({
  // The original audiences (a string, unchanged), a customer group (owner, 2026-10-24:
  // { group: 'LAPSED', days: 14 } etc., notifications/customer-groups.ts) or CUSTOM filters
  // (2026-11-03). Missing = ALL.
  audience: audienceSchema,
  fallback_language: languageSchema,
  messages: messagesSchema,
  // 2026-11-03: send later (ISO with its time zone, in the future, within a year) - a ONCE campaign.
  send_at: onceScheduleSchema.shape.send_at.optional(),
  /** Name of the scheduled campaign (default "Scheduled offer <date>"). */
  name: z.string().trim().min(1).max(120).optional(),
});
type OfferBody = z.infer<typeof offerSchema>;

/** Optional "Send test to" number: a Sri Lankan mobile, normalised; blank = own phone. */
const testPhone = z
  .string()
  .trim()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return undefined;
    try {
      return normalizeSriLankanPhone(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phone must be a Sri Lankan mobile number, e.g. 077 123 4567' });
      return z.NEVER;
    }
  });

/**
 * A customer group's size for SMS (owner, 2026-10-24): ?group=&days=&min_spend_lkr=
 * -> { audience, customers, phones, opted_out }. No group = all customers.
 */
smsOffersRouter.get(
  '/sms-offers/audience',
  ...STAFF,
  wrap(async (req, res) => {
    const audience = parseAudienceQuery(req.query as Record<string, unknown>);
    res.json({ success: true, data: await smsGroupCounts(audience) });
  })
);

/** Towns/cities of customers' saved addresses: [{ name, customers }], most customers first. */
smsOffersRouter.get(
  '/sms-offers/areas',
  ...STAFF,
  wrap(async (_req, res) => {
    const rows = await db
      .selectFrom('customer_addresses as a')
      .innerJoin('users as u', 'u.id', 'a.user_id')
      .select([sql<string>`min(trim(a.city))`.as('name'), sql<string>`count(distinct a.user_id)`.as('customers')])
      .where('a.is_deleted', '=', false)
      .where('u.role', '=', 'CUSTOMER')
      .where('u.is_active', '=', true)
      .where(sql<boolean>`trim(a.city) <> ''`)
      .groupBy(sql`lower(trim(a.city))`)
      .orderBy(sql`count(distinct a.user_id)`, 'desc')
      .orderBy(sql`min(trim(a.city))`)
      .limit(300)
      .execute();
    res.json({ success: true, data: { areas: rows.map((r) => ({ name: r.name, customers: Number(r.customers) })) } });
  })
);

smsOffersRouter.get(
  '/sms-placeholders',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({
      success: true,
      data: { placeholders: PLACEHOLDERS.map((p) => ({ token: p.token, description: p.description, example: p.example })), max_chars: MAX_OFFER_TEXT, languages: SMS_LANGUAGES },
    });
  })
);

/** Who would get it, in which language, how many SMS parts it costs, and sample texts. */
smsOffersRouter.post(
  '/sms-offers/estimate',
  ...STAFF,
  validate({ body: offerSchema }),
  wrap(async (req, res) => {
    const body = req.body as OfferBody;
    const estimate = await estimateOffer(body.audience, body.fallback_language as never, body.messages);
    res.json({ success: true, data: { estimate } });
  })
);

smsOffersRouter.post(
  '/sms-offers/test',
  ...STAFF,
  validate({ body: z.object({ language: languageSchema, message: textSchema.min(1, 'Write the text to test'), phone: testPhone }) }),
  wrap(async (req, res) => {
    const result = await sendTestOffer(actorOf(req), req.body.language, req.body.message, req.body.phone);
    res.status(202).json({ success: true, data: result });
  })
);

smsOffersRouter.post(
  '/sms-offers',
  ...STAFF,
  validate({ body: offerSchema }),
  wrap(async (req, res) => {
    const body = req.body as OfferBody;
    if (body.send_at) {
      // Scheduled: a ONCE campaign (sent by the campaign runner at send_at; the sending rules are checked then).
      const campaign = await createCampaign(actorOf(req), {
        kind: 'ONCE',
        name: body.name ?? `Scheduled offer ${DateTime.fromISO(body.send_at).setZone('Asia/Colombo').toFormat('d LLL, h:mm a')}`,
        audience: body.audience,
        fallback_language: body.fallback_language,
        messages: body.messages,
        schedule: { send_at: body.send_at },
      });
      res.status(201).json({ success: true, data: { campaign } });
      return;
    }
    const offer = await sendOffer(actorOf(req), {
      audience: body.audience,
      fallback_language: body.fallback_language as never,
      messages: body.messages,
    });
    res.status(201).json({ success: true, data: { offer } });
  })
);

smsOffersRouter.get(
  '/sms-offers',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: { offers: await listOffers() } });
  })
);

// ---------------------------------------------------------------------------
// SMS sending rules (settings)
// ---------------------------------------------------------------------------

/** { any_time, quiet_hours: { enabled, start, end }, updated_at, sending_now: { allowed, code, message, resume_at } } */
async function sendingView() {
  const { setting, updated_at } = await smsSendingSettings.view();
  const d = await currentSendDecision();
  return {
    ...setting,
    updated_at,
    sending_now: d.allowed
      ? { allowed: true, code: null, message: null, resume_at: null }
      : { allowed: false, code: d.code, message: d.message, resume_at: d.resume_at ? d.resume_at.toISOString() : null },
  };
}

smsOffersRouter.get(
  '/settings/sms-sending',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: await sendingView() });
  })
);

smsOffersRouter.put(
  '/settings/sms-sending',
  ...STAFF,
  validate({ body: updateSmsSendingSchema }),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof updateSmsSendingSchema>;
    const cur = await smsSendingSettings.read();
    const quiet = Object.fromEntries(Object.entries(body.quiet_hours ?? {}).filter(([, v]) => v !== undefined));
    await smsSendingSettings.update(
      { any_time: body.any_time ?? cur.any_time, quiet_hours: { ...cur.quiet_hours, ...quiet } },
      actorOf(req)
    );
    res.json({ success: true, data: await sendingView() });
  })
);

/** { per_customer, monthly_budget, usage: { month, month_starts_at, parts_used, remaining_parts|null }, updated_at } */
async function limitsView() {
  const { setting, updated_at } = await smsLimitsSettings.view();
  const now = orderingClock.now();
  const used = await monthlyPartsUsed(db, now);
  return {
    ...setting,
    updated_at,
    usage: {
      month: DateTime.fromJSDate(now).setZone('Asia/Colombo').toFormat('yyyy-MM'),
      month_starts_at: monthStartOf(now).toISOString(),
      parts_used: used,
      remaining_parts: setting.monthly_budget.enabled ? Math.max(0, setting.monthly_budget.parts - used) : null,
    },
  };
}

smsOffersRouter.get(
  '/settings/sms-limits',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: await limitsView() });
  })
);

smsOffersRouter.put(
  '/settings/sms-limits',
  ...STAFF,
  validate({ body: updateSmsLimitsSchema }),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof updateSmsLimitsSchema>;
    const cur = await smsLimitsSettings.read();
    const defined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
    await smsLimitsSettings.update(
      {
        per_customer: { ...cur.per_customer, ...defined(body.per_customer) },
        monthly_budget: { ...cur.monthly_budget, ...defined(body.monthly_budget) },
      },
      actorOf(req)
    );
    res.json({ success: true, data: await limitsView() });
  })
);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

smsOffersRouter.get(
  '/sms-templates',
  ...STAFF,
  wrap(async (_req, res) => {
    res.json({ success: true, data: { templates: await listTemplates() } });
  })
);

smsOffersRouter.post(
  '/sms-templates',
  ...STAFF,
  validate({ body: templateSchema }),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: { template: await createTemplate(actorOf(req), req.body) } });
  })
);

smsOffersRouter.get(
  '/sms-templates/:id',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { template: await getTemplate(req.params.id as string) } });
  })
);

smsOffersRouter.put(
  '/sms-templates/:id',
  ...STAFF,
  validate({ params: idParam, body: templateSchema }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { template: await updateTemplate(actorOf(req), req.params.id as string, req.body) } });
  })
);

smsOffersRouter.delete(
  '/sms-templates/:id',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    await deleteTemplate(actorOf(req), req.params.id as string);
    res.json({ success: true, data: { deleted: true } });
  })
);

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const listQuery = z.object({
  status: z.enum(CAMPAIGN_STATUSES as unknown as [string, ...string[]]).optional(),
  kind: z.enum(CAMPAIGN_KINDS as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });

smsOffersRouter.get(
  '/sms-campaigns',
  ...STAFF,
  wrap(async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json({ success: true, data: { campaigns: await listCampaigns(q as never) } });
  })
);

smsOffersRouter.post(
  '/sms-campaigns',
  ...STAFF,
  validate({ body: createCampaignSchema }),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: { campaign: await createCampaign(actorOf(req), req.body) } });
  })
);

smsOffersRouter.post(
  '/sms-campaigns/preview',
  ...STAFF,
  validate({ body: previewCampaignSchema }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { preview: await previewCampaign(req.body) } });
  })
);

smsOffersRouter.get(
  '/sms-campaigns/history',
  ...STAFF,
  wrap(async (req, res) => {
    const q = historyQuery.parse(req.query);
    res.json({ success: true, data: { items: await smsHistory(q.limit) } });
  })
);

smsOffersRouter.get(
  '/sms-campaigns/:id',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { campaign: await getCampaign(req.params.id as string) } });
  })
);

smsOffersRouter.patch(
  '/sms-campaigns/:id',
  ...STAFF,
  validate({ params: idParam, body: patchCampaignSchema }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { campaign: await patchCampaign(actorOf(req), req.params.id as string, req.body) } });
  })
);

smsOffersRouter.post(
  '/sms-campaigns/:id/pause',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { campaign: await pauseCampaign(actorOf(req), req.params.id as string) } });
  })
);

smsOffersRouter.post(
  '/sms-campaigns/:id/resume',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { campaign: await resumeCampaign(actorOf(req), req.params.id as string) } });
  })
);

smsOffersRouter.post(
  '/sms-campaigns/:id/cancel',
  ...STAFF,
  validate({ params: idParam }),
  wrap(async (req, res) => {
    res.json({ success: true, data: { campaign: await cancelCampaign(actorOf(req), req.params.id as string) } });
  })
);
