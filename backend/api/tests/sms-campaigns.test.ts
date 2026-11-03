import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, db } from '../src/database/connection.js';
import { env } from '../src/config/env.js';
import { orderingClock } from '../src/utils/time.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { DEFAULT_BIRTHDAY_OFFER } from '../src/modules/configuration/settings.service.js';
import { DEFAULT_STORED_SCHEDULE } from '../src/modules/configuration/store-schedule.js';
import { runBirthdaySms } from '../src/modules/birthday/birthday.sms.js';
import { runDueCampaigns } from '../src/modules/sms-offers/campaigns.runner.js';
import { nextOccurrence, recurringScheduleSchema, runKeyOf } from '../src/modules/sms-offers/campaign-schedule.js';
import {
  NAME_FALLBACK,
  assertTemplateText,
  firstName,
  renderText,
  unknownPlaceholders,
} from '../src/modules/sms-offers/placeholders.js';
import {
  DEFAULT_SMS_LIMITS,
  DEFAULT_SMS_SENDING,
  monthlyPartsUsed,
  nextSendTime,
  smsSendAllowed,
  smsSendingSettings,
} from '../src/modules/sms-offers/sending-rules.js';
import { customerAudienceSchema } from '../src/modules/notifications/customer-groups.js';
import { tokens, auth, STORE } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * SMS campaigns, templates, sending rules, placeholders and the CUSTOM audience (migration 066;
 * owner's brother, 2026-11-03; contract docs/superpowers/plans/2026-11-03-sms-campaigns.md).
 *
 * The shared database holds other customers too, so every send here is aimed at this file's
 * customers with a CUSTOM `areas` filter (one made-up town per group of tests) and checked on their
 * outbox rows. The checkout clock is pinned by tests/setup/ordering-clock.ts to Tue 6 October 2026,
 * noon Colombo (06:30Z); the runner takes an explicit `now`. Everything made here is removed.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00066', phoneBase: '+947066600', name: 'Zqxcamp Shopper' });
const opsToken = generateAccessToken({ id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'OPERATIONS' });
const customerToken = tokens.customer;
const packingToken = tokens.staff;

const ZONE_Z = 'Zqxcamp Zone'; // customers 1-4 (rendering, previews, filters)
const ZONE_Y = 'Zqxcamp Yard'; // customers 6-7 (caps and budget)
const ZONE_X = 'Zqxcamp Xing'; // customers 8-9 (the runner)
const areaOf = (zone: string) => ({ group: 'CUSTOM', areas: [zone] });

const campaignIds: string[] = [];
const offerIds: string[] = [];
const templateIds: string[] = [];
let testStart: Date;
let savedSettings: { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date }[] = [];
const SETTING_KEYS = ['sms_sending', 'sms_limits'];

type Shopper = Awaited<ReturnType<typeof people.customer>>;
let c1: Shopper, c2: Shopper, c3: Shopper, c4: Shopper, c5: Shopper, c6: Shopper, c7: Shopper, c8: Shopper, c9: Shopper;

const api = (token = tokens.admin) => ({
  get: (path: string) => request(app).get(`/api/v1/admin${path}`).set(auth(token)),
  post: (path: string, body: object = {}) => request(app).post(`/api/v1/admin${path}`).set(auth(token)).send(body),
  put: (path: string, body: object = {}) => request(app).put(`/api/v1/admin${path}`).set(auth(token)).send(body),
  patch: (path: string, body: object = {}) => request(app).patch(`/api/v1/admin${path}`).set(auth(token)).send(body),
  del: (path: string) => request(app).delete(`/api/v1/admin${path}`).set(auth(token)),
});
const admin = api();

const resetSettings = () => pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [SETTING_KEYS]);
const setQuiet = (enabled = true) => admin.put('/settings/sms-sending', { quiet_hours: { enabled, start: '22:00', end: '07:00' } }).expect(200);

const rowsFor = async (userId: string, where = `notification_type = 'SMS_OFFER'`) =>
  (await pool.query(`SELECT idempotency_key, recipient, payload FROM notifications WHERE user_id = $1 AND ${where} ORDER BY created_at`, [userId])).rows;
const campaignRows = async (campaignId: string, userId: string) =>
  (await pool.query(`SELECT idempotency_key, payload FROM notifications WHERE payload->>'campaign_id' = $1 AND user_id = $2`, [campaignId, userId])).rows;
const runsOf = async (campaignId: string) =>
  (await pool.query('SELECT * FROM sms_campaign_runs WHERE campaign_id = $1 ORDER BY created_at', [campaignId])).rows;
const campaignRow = async (id: string) => (await pool.query('SELECT * FROM sms_campaigns WHERE id = $1', [id])).rows[0];

async function createCampaign(body: object, token = tokens.admin) {
  const res = await api(token).post('/sms-campaigns', body);
  if (res.status === 201) campaignIds.push(res.body.data.campaign.id);
  return res;
}
const mustCreate = async (body: object) => {
  const res = await createCampaign(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.campaign as Record<string, any>;
};

let seq = 0;
async function order(customerId: string, status: string, daysAgo: number, total: number) {
  seq += 1;
  await pool.query(
    `INSERT INTO orders (order_number, idempotency_key, customer_id, dark_store_id, order_status, subtotal_amount, delivery_fee, total_amount,
                         wallet_amount_used, delivery_recipient_name, delivery_recipient_phone, delivery_address_line1, delivery_city,
                         delivery_latitude, delivery_longitude, placed_at, created_at)
     VALUES ($1, $1, $2, $3, $4, $5::numeric, 0, $5, 0, 'Camp Test', '+94709660099', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243,
             now() - make_interval(days => $6::int), now() - make_interval(days => $6::int))`,
    [`TST-CMP-${seq}-${Date.now()}`, customerId, STORE, status, total, daysAgo]
  );
}
const joinedDaysAgo = (id: string, days: number) => pool.query(`UPDATE users SET created_at = now() - make_interval(days => $2::int) WHERE id = $1`, [id, days]);

const TEXT = { en: 'Hi {name}, you have {points} points and {wallet}. {app_link}', ta: 'வணக்கம் {name}, {points} புள்ளிகள்', si: 'ආයුබෝවන් {name}' };
const PLAIN = { en: 'Weekend sale: 10% off', ta: 'சலுகை: 10% தள்ளுபடி', si: 'අඩුවට: 10%' };

const launchLanguages = env.SMS_OFFER_LANGUAGES;

beforeAll(async () => {
  env.SMS_OFFER_LANGUAGES = 'si,ta,en';
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  savedSettings = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [SETTING_KEYS])).rows;
  await resetSettings();
  await people.purge(20);
  c1 = await people.customer(1, 'Nimal Perera');
  c2 = await people.customer(2);
  c3 = await people.customer(3);
  c4 = await people.customer(4);
  c5 = await people.customer(5);
  c6 = await people.customer(6);
  c7 = await people.customer(7);
  c8 = await people.customer(8);
  c9 = await people.customer(9);
  const zone = async (shopper: Shopper, town: string) => pool.query('UPDATE customer_addresses SET city = $2 WHERE user_id = $1', [shopper.id, town]);
  for (const s of [c1, c2, c3, c4]) await zone(s, ZONE_Z);
  for (const s of [c6, c7]) await zone(s, ZONE_Y);
  for (const s of [c8, c9]) await zone(s, ZONE_X);
  await zone(c5, 'Zqxcamp Elsewhere');
  await pool.query('UPDATE users SET full_name = NULL, sms_language = $2 WHERE id = $1', [c2.id, 'ta']);
  await pool.query('UPDATE users SET sms_offers_opted_out_at = now() WHERE id = $1', [c3.id]);
  await pool.query(`UPDATE users SET phone = '+94112666604' WHERE id = $1`, [c4.id]); // a landline: no SMS can reach it
  await pool.query(`INSERT INTO points_ledger (customer_id, kind, points, remaining, reason) VALUES ($1, 'ADJUST', 120, 120, 'camp test')`, [c1.id]);
  await pool.query(`INSERT INTO wallet_entries (customer_id, amount, kind, reason) VALUES ($1, 1250, 'ADJUSTMENT', 'camp test')`, [c1.id]);
});

afterAll(async () => {
  env.SMS_OFFER_LANGUAGES = launchLanguages;
  const all = [...campaignIds, ...offerIds, ...templateIds];
  await pool.query(`DELETE FROM notifications WHERE payload->>'campaign_id' = ANY($1) OR payload->>'offer_id' = ANY($2)`, [campaignIds, offerIds]);
  await pool.query(`DELETE FROM notifications WHERE idempotency_key LIKE 'sms-offer-test:%' AND created_at >= $1`, [testStart]);
  await pool.query(`DELETE FROM notifications WHERE notification_type = 'BIRTHDAY_OFFER' AND idempotency_key LIKE 'bday:%' AND user_id = $1`, [c5.id]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [[...SETTING_KEYS, 'birthday_sms_days']]);
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1::uuid[]) AND entity_type IN ($2, $3, $4)', [all, 'sms_campaign', 'sms_offer', 'sms_template']);
  await pool.query(`DELETE FROM audit_logs WHERE action IN ('SMS_SENDING_UPDATED', 'SMS_LIMITS_UPDATED') AND created_at >= $1`, [testStart]);
  await pool.query('DELETE FROM sms_campaigns WHERE id = ANY($1::uuid[])', [campaignIds]);
  await pool.query('DELETE FROM sms_offers WHERE id = ANY($1::uuid[])', [offerIds]);
  await pool.query('DELETE FROM sms_templates WHERE id = ANY($1::uuid[])', [templateIds]);
  for (const s of [c1, c2, c3, c4, c5, c6, c7, c8, c9]) {
    await pool.query('DELETE FROM points_ledger WHERE customer_id = $1', [s.id]);
    await pool.query('DELETE FROM wallet_entries WHERE customer_id = $1', [s.id]);
  }
  await people.purge(20);
  for (const r of savedSettings) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
});

afterEach(async () => {
  await resetSettings();
});

// ---------------------------------------------------------------------------
describe('Placeholders (pure)', () => {
  it('finds unknown placeholders and fills the known ones per customer', () => {
    expect(unknownPlaceholders('Hi {name}, {foo} and {Name} {app_link} {}')).toEqual(['{foo}', '{Name}', '{}']);
    expect(firstName('  Nimal Kumar Perera ')).toBe('Nimal');
    expect(firstName('   ')).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName('A'.repeat(40))).toHaveLength(20);
    expect(renderText(TEXT.en, 'en', { name: 'Nimal', points: 120, wallet: 1250 })).toBe('Hi Nimal, you have 120 points and LKR 1,250. https://blynk.lk/app');
    expect(renderText('{wallet}', 'en', { name: null, points: 0, wallet: 99.5 })).toBe('LKR 99.5');
  });

  it('a missing name is "friend" / "මිත්‍රයා" / "நண்பரே" by the text\'s language', () => {
    const ctx = { name: null, points: 0, wallet: 0 };
    expect(renderText('Hi {name}', 'en', ctx)).toBe('Hi friend');
    expect(renderText('Hi {name}', 'si', ctx)).toBe(`Hi ${NAME_FALLBACK.si}`);
    expect(NAME_FALLBACK.si).toBe('මිත්‍රයා');
    expect(renderText('Hi {name}', 'ta', ctx)).toBe('Hi நண்பரே');
  });

  it('refuses unknown placeholders (naming the allowed ones) and texts too long once filled in', () => {
    expect(() => assertTemplateText({ en: 'Hello {name}' })).not.toThrow();
    try {
      assertTemplateText({ en: 'Hello {nmae}', ta: 'x {foo}' });
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400, code: 'UNKNOWN_PLACEHOLDER' });
      const d = (err as { details: { unknown: string[]; allowed: string[] } }).details;
      expect(d.unknown).toEqual(['{foo}', '{nmae}']); // Tamil text first, then English: the order the texts are checked in
      expect(d.allowed).toEqual(['{name}', '{points}', '{wallet}', '{app_link}']);
    }
    // 470 plain characters fit; with a {name} that can grow by 20 they do not.
    expect(() => assertTemplateText({ en: 'a'.repeat(470) })).not.toThrow();
    expect(() => assertTemplateText({ en: `${'a'.repeat(465)}{name}` })).toThrowError(expect.objectContaining({ code: 'TEXT_TOO_LONG' }));
  });
});

// ---------------------------------------------------------------------------
describe('Sending rules (pure)', () => {
  const at = (iso: string) => new Date(iso);
  // Colombo is UTC+5:30: 23:00 = 17:30Z, 03:00 = 21:30Z the evening before, 07:00 = 01:30Z.
  const quiet = { ...DEFAULT_SMS_SENDING, quiet_hours: { enabled: true, start: '22:00', end: '07:00' } };

  it('by default nothing is blocked by the clock', () => {
    for (const iso of ['2026-10-06T17:30:00Z', '2026-10-06T21:30:00Z', '2026-10-07T01:00:00Z']) {
      expect(smsSendAllowed(DEFAULT_SMS_SENDING, at(iso), DEFAULT_STORED_SCHEDULE)).toEqual({ allowed: true });
    }
    expect(DEFAULT_SMS_SENDING).toEqual({ any_time: true, quiet_hours: { enabled: false, start: '22:00', end: '07:00' } });
    expect(DEFAULT_SMS_LIMITS).toEqual({ per_customer: { enabled: false, max: 1, days: 7 }, monthly_budget: { enabled: false, parts: 5000 } });
  });

  it('quiet hours wrap midnight: blocked 22:00-07:00 Colombo, resume at 07:00', () => {
    const late = smsSendAllowed(quiet, at('2026-10-06T17:30:00Z'), DEFAULT_STORED_SCHEDULE); // 23:00
    expect(late).toMatchObject({ allowed: false, code: 'QUIET_HOURS' });
    expect((late as { resume_at: Date }).resume_at.toISOString()).toBe('2026-10-07T01:30:00.000Z'); // next day 07:00
    const early = smsSendAllowed(quiet, at('2026-10-06T21:30:00Z'), DEFAULT_STORED_SCHEDULE); // 03:00 on the 7th
    expect((early as { resume_at: Date }).resume_at.toISOString()).toBe('2026-10-07T01:30:00.000Z'); // the same morning
    expect(smsSendAllowed(quiet, at('2026-10-06T16:29:00Z'), DEFAULT_STORED_SCHEDULE).allowed).toBe(true); // 21:59
    expect(smsSendAllowed(quiet, at('2026-10-06T16:30:00Z'), DEFAULT_STORED_SCHEDULE).allowed).toBe(false); // 22:00
    expect(smsSendAllowed(quiet, at('2026-10-07T01:30:00Z'), DEFAULT_STORED_SCHEDULE).allowed).toBe(true); // 07:00
  });

  it('quiet hours inside one day (13:00-15:00) work too, and any_time off adds the opening hours', () => {
    const lunch = { ...DEFAULT_SMS_SENDING, quiet_hours: { enabled: true, start: '13:00', end: '15:00' } };
    expect(smsSendAllowed(lunch, at('2026-10-06T07:30:00Z'), DEFAULT_STORED_SCHEDULE).allowed).toBe(false); // 13:00
    expect(smsSendAllowed(lunch, at('2026-10-06T09:30:00Z'), DEFAULT_STORED_SCHEDULE).allowed).toBe(true); // 15:00
    // Any time off + quiet hours 22-07: at 06:00 both rules apply; the first moment is 08:00 (opening).
    const both = { any_time: false, quiet_hours: { enabled: true, start: '22:00', end: '07:00' } };
    const sixAm = at('2026-10-06T00:30:00Z');
    expect(smsSendAllowed(both, sixAm, DEFAULT_STORED_SCHEDULE)).toMatchObject({ allowed: false, code: 'QUIET_HOURS' });
    expect(nextSendTime(both, sixAm, DEFAULT_STORED_SCHEDULE)!.toISOString()).toBe('2026-10-06T02:30:00.000Z'); // 08:00
    expect(nextSendTime(DEFAULT_SMS_SENDING, sixAm, DEFAULT_STORED_SCHEDULE)).toEqual(sixAm);
  });
});

// ---------------------------------------------------------------------------
describe('Campaign schedules (pure)', () => {
  const weekly = recurringScheduleSchema.parse({ frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'] });
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it('DAILY / WEEKLY / MONTHLY run times are Colombo wall clock and strictly after "now"', () => {
    const daily = { frequency: 'DAILY' as const, time: '18:00' };
    expect(iso(nextOccurrence(daily, new Date('2026-10-06T06:30:00Z')))).toBe('2026-10-06T12:30:00.000Z'); // today 18:00
    expect(iso(nextOccurrence(daily, new Date('2026-10-06T12:30:00Z')))).toBe('2026-10-07T12:30:00.000Z'); // not "now" itself
    // 23:30 Colombo on the 6th: the next 18:00 is the 7th's.
    expect(iso(nextOccurrence(daily, new Date('2026-10-06T18:00:00Z')))).toBe('2026-10-07T12:30:00.000Z');
    expect(iso(nextOccurrence(weekly, new Date('2026-10-06T06:30:00Z')))).toBe('2026-10-09T12:30:00.000Z'); // Friday
    expect(iso(nextOccurrence(weekly, new Date('2026-10-09T12:29:00Z')))).toBe('2026-10-09T12:30:00.000Z');
    expect(iso(nextOccurrence(weekly, new Date('2026-10-09T12:30:00Z')))).toBe('2026-10-16T12:30:00.000Z');
    const two = recurringScheduleSchema.parse({ frequency: 'WEEKLY', time: '09:00', weekdays: ['sun', 'mon'] });
    expect(two.weekdays).toEqual(['mon', 'sun']);
    expect(iso(nextOccurrence(two, new Date('2026-10-06T06:30:00Z')))).toBe('2026-10-11T03:30:00.000Z'); // Sunday
  });

  it('MONTHLY on day 28, including February, and starts_on / ends_on', () => {
    const monthly = { frequency: 'MONTHLY' as const, time: '10:00', month_day: 28 };
    expect(iso(nextOccurrence(monthly, new Date('2026-10-06T06:30:00Z')))).toBe('2026-10-28T04:30:00.000Z');
    expect(iso(nextOccurrence(monthly, new Date('2026-10-28T04:30:00Z')))).toBe('2026-11-28T04:30:00.000Z');
    expect(iso(nextOccurrence(monthly, new Date('2027-02-28T05:00:00Z')))).toBe('2027-03-28T04:30:00.000Z'); // 28 Feb 10:30 Colombo is after 10:00
    expect(iso(nextOccurrence(monthly, new Date('2027-02-01T00:00:00Z')))).toBe('2027-02-28T04:30:00.000Z');
    const window = { frequency: 'DAILY' as const, time: '09:00', starts_on: '2026-11-01', ends_on: '2026-11-02' };
    expect(iso(nextOccurrence(window, new Date('2026-10-06T06:30:00Z')))).toBe('2026-11-01T03:30:00.000Z');
    expect(iso(nextOccurrence(window, new Date('2026-11-01T03:30:00Z')))).toBe('2026-11-02T03:30:00.000Z');
    expect(nextOccurrence(window, new Date('2026-11-02T03:30:00Z'))).toBeNull();
    expect(runKeyOf(new Date('2026-10-09T12:30:00Z'))).toBe('2026-10-09T18:00');
  });

  it('refuses a schedule that cannot work', () => {
    expect(recurringScheduleSchema.safeParse({ frequency: 'WEEKLY', time: '18:00' }).success).toBe(false);
    expect(recurringScheduleSchema.safeParse({ frequency: 'MONTHLY', time: '18:00', month_day: 29 }).success).toBe(false);
    expect(recurringScheduleSchema.safeParse({ frequency: 'DAILY', time: '25:00' }).success).toBe(false);
    expect(recurringScheduleSchema.safeParse({ frequency: 'DAILY', time: '09:00', starts_on: '2026-11-05', ends_on: '2026-11-01' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('CUSTOM audience (schema)', () => {
  it('keeps the given filters, drops blanks, defaults spend_days, checks ranges', () => {
    const ok = customerAudienceSchema.parse({ group: 'CUSTOM', areas: [' Beruwala ', 'beruwala'], min_orders: '2', language: '', min_spend_lkr: 5000, max_points: null });
    expect(ok).toEqual({ group: 'CUSTOM', areas: ['Beruwala', 'beruwala'], min_orders: 2, min_spend_lkr: 5000, spend_days: 90 });
    expect(customerAudienceSchema.parse({ group: 'CUSTOM' })).toEqual({ group: 'CUSTOM' });
    expect(customerAudienceSchema.safeParse({ group: 'CUSTOM', min_points: 10, max_points: 5 }).success).toBe(false);
    expect(customerAudienceSchema.safeParse({ group: 'CUSTOM', language: 'fr' }).success).toBe(false);
    expect(customerAudienceSchema.safeParse({ group: 'CUSTOM', last_order_days_min: 9, last_order_days_max: 3 }).success).toBe(false);
    // The other groups are unchanged.
    expect(customerAudienceSchema.parse({ group: 'LAPSED' })).toEqual({ group: 'LAPSED', days: 14 });
  });
});

// ---------------------------------------------------------------------------
describe('Settings routes (SMS sending rules and limits)', () => {
  it('start at the defaults: any time, no quiet hours, no limits', async () => {
    const sending = (await admin.get('/settings/sms-sending').expect(200)).body.data;
    expect(sending).toMatchObject({ any_time: true, quiet_hours: { enabled: false, start: '22:00', end: '07:00' }, updated_at: null, sending_now: { allowed: true } });
    const limits = (await admin.get('/settings/sms-limits').expect(200)).body.data;
    expect(limits).toMatchObject({ per_customer: { enabled: false, max: 1, days: 7 }, monthly_budget: { enabled: false, parts: 5000 }, updated_at: null });
    expect(limits.usage).toMatchObject({ month: '2026-10', remaining_parts: null });
    expect(typeof limits.usage.parts_used).toBe('number');
  });

  it('PUT merges what is sent, is audited, and GET shows it (Operations too)', async () => {
    const res = await api(opsToken).put('/settings/sms-sending', { quiet_hours: { enabled: true, start: '21:30' } }).expect(200);
    expect(res.body.data).toMatchObject({ any_time: true, quiet_hours: { enabled: true, start: '21:30', end: '07:00' } });
    expect(res.body.data.updated_at).not.toBeNull();
    const off = await admin.put('/settings/sms-sending', { any_time: false }).expect(200);
    expect(off.body.data).toMatchObject({ any_time: false, quiet_hours: { enabled: true, start: '21:30', end: '07:00' } });
    const limits = await admin.put('/settings/sms-limits', { per_customer: { enabled: true, max: 2, days: 14 }, monthly_budget: { parts: 900 } }).expect(200);
    expect(limits.body.data).toMatchObject({ per_customer: { enabled: true, max: 2, days: 14 }, monthly_budget: { enabled: false, parts: 900 } });
    const again = await admin.put('/settings/sms-limits', { monthly_budget: { enabled: true } }).expect(200);
    expect(again.body.data).toMatchObject({ per_customer: { enabled: true, max: 2, days: 14 }, monthly_budget: { enabled: true, parts: 900 } });
    expect(again.body.data.usage.remaining_parts).toBeLessThanOrEqual(900);
    const audit = (await pool.query(`SELECT action, old_values, new_values FROM audit_logs WHERE action IN ('SMS_SENDING_UPDATED', 'SMS_LIMITS_UPDATED') AND created_at >= $1 ORDER BY created_at`, [testStart])).rows;
    expect(audit.map((a) => a.action)).toEqual(['SMS_SENDING_UPDATED', 'SMS_SENDING_UPDATED', 'SMS_LIMITS_UPDATED', 'SMS_LIMITS_UPDATED']);
    expect(audit[0].new_values).toMatchObject({ key: 'sms_sending', quiet_hours: { enabled: true, start: '21:30' } });
  });

  it('refuses bad values, and customers and packing staff cannot change or read them', async () => {
    expect((await admin.put('/settings/sms-sending', {})).status).toBe(400);
    expect((await admin.put('/settings/sms-sending', { any_time: 'yes' })).status).toBe(400);
    expect((await admin.put('/settings/sms-sending', { quiet_hours: { enabled: true, start: '9pm' } })).status).toBe(400);
    expect((await admin.put('/settings/sms-sending', { extra: 1, any_time: true })).status).toBe(400);
    const same = await admin.put('/settings/sms-sending', { quiet_hours: { enabled: true, start: '08:00', end: '08:00' } });
    expect(same.status).toBe(400);
    expect((await admin.put('/settings/sms-limits', { per_customer: { max: 0 } })).status).toBe(400);
    expect((await admin.put('/settings/sms-limits', { monthly_budget: { parts: 1.5 } })).status).toBe(400);
    expect((await admin.put('/settings/sms-limits', {})).status).toBe(400);
    for (const token of [customerToken, packingToken]) {
      expect((await api(token).get('/settings/sms-sending')).status).toBe(403);
      expect((await api(token).put('/settings/sms-sending', { any_time: false })).status).toBe(403);
      expect((await api(token).put('/settings/sms-limits', { per_customer: { enabled: true } })).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/sms-sending')).status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('Templates', () => {
  it('create, read, edit and delete (Operations too); names are unique ignoring case', async () => {
    const created = await admin.post('/sms-templates', { name: 'Zqxcamp weekend', messages: { en: 'Hi {name}, 10% off', ta: PLAIN.ta } }).expect(201);
    const t = created.body.data.template;
    templateIds.push(t.id);
    expect(t).toMatchObject({ name: 'Zqxcamp weekend', messages: { en: 'Hi {name}, 10% off', ta: PLAIN.ta, si: null } });
    expect((await admin.post('/sms-templates', { name: 'ZQXCAMP WEEKEND', messages: { en: 'x' } })).body.error.code).toBe('TEMPLATE_NAME_TAKEN');

    const list = (await api(opsToken).get('/sms-templates').expect(200)).body.data.templates as { id: string }[];
    expect(list.map((x) => x.id)).toContain(t.id);
    const edited = await api(opsToken).put(`/sms-templates/${t.id}`, { name: 'Zqxcamp weekend 2', messages: { en: 'Hello {name} {points}' } }).expect(200);
    expect(edited.body.data.template).toMatchObject({ name: 'Zqxcamp weekend 2', messages: { en: 'Hello {name} {points}', ta: null, si: null } });
    expect((await admin.get(`/sms-templates/${t.id}`).expect(200)).body.data.template.name).toBe('Zqxcamp weekend 2');
    await admin.del(`/sms-templates/${t.id}`).expect(200);
    expect((await admin.get(`/sms-templates/${t.id}`)).body.error.code).toBe('TEMPLATE_NOT_FOUND');
    expect((await admin.del(`/sms-templates/${t.id}`)).status).toBe(404);
    const actions = (await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [t.id])).rows.map((r) => r.action);
    expect(actions).toEqual(['SMS_TEMPLATE_CREATED', 'SMS_TEMPLATE_UPDATED', 'SMS_TEMPLATE_DELETED']);
  });

  it('refuses unknown placeholders, an empty template and a missing name; roles are checked', async () => {
    const bad = await admin.post('/sms-templates', { name: 'Zqxcamp bad', messages: { en: 'Hi {firstname}' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'UNKNOWN_PLACEHOLDER', details: { unknown: ['{firstname}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] } });
    expect((await admin.post('/sms-templates', { name: 'Zqxcamp empty', messages: {} })).body.error.code).toBe('OFFER_TEXT_MISSING');
    expect((await admin.post('/sms-templates', { messages: { en: 'x' } })).status).toBe(400);
    expect((await api(customerToken).post('/sms-templates', { name: 'Zqxcamp no', messages: { en: 'x' } })).status).toBe(403);
    expect((await api(packingToken).get('/sms-templates')).status).toBe(403);
    expect((await admin.get('/sms-templates/not-a-uuid')).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Placeholders and areas lists', () => {
  it('lists the four placeholders and the towns customers have addresses in', async () => {
    const p = (await admin.get('/sms-placeholders').expect(200)).body.data;
    expect(p.placeholders.map((x: { token: string }) => x.token)).toEqual(['{name}', '{points}', '{wallet}', '{app_link}']);
    expect(p.max_chars).toBe(480);
    const areas = (await admin.get('/sms-offers/areas').expect(200)).body.data.areas as { name: string; customers: number }[];
    expect(areas.find((a) => a.name === ZONE_Z)).toEqual({ name: ZONE_Z, customers: 4 });
    expect(areas.find((a) => a.name === ZONE_Y)).toEqual({ name: ZONE_Y, customers: 2 });
  });
});

// ---------------------------------------------------------------------------
describe('Custom text in an offer sent now', () => {
  it('renders {name} {points} {wallet} {app_link} per customer, with the missing-name word of their language', async () => {
    const res = await admin.post('/sms-offers', { audience: areaOf(ZONE_Z), fallback_language: 'en', messages: TEXT }).expect(201);
    const offer = res.body.data.offer;
    offerIds.push(offer.id);
    expect(offer.recipients).toBe(2); // c1 and c2: c3 opted out, c4 is a landline, c5 is in another town
    const [one] = await rowsFor(c1.id);
    expect(one.payload.text).toBe('Hi Nimal, you have 120 points and LKR 1,250. https://blynk.lk/app');
    expect(one.payload.offer_id).toBe(offer.id);
    const [two] = await rowsFor(c2.id);
    expect(two.payload).toMatchObject({ text: 'வணக்கம் நண்பரே, 0 புள்ளிகள்', language: 'ta' });
    expect(await rowsFor(c3.id)).toHaveLength(0);
    expect(await rowsFor(c4.id)).toHaveLength(0);
    expect(await rowsFor(c5.id)).toHaveLength(0);
    expect(offer.sms_parts_total).toBe(2);
  });

  it('refuses unknown placeholders in an offer, an estimate and a test SMS', async () => {
    const body = { audience: areaOf(ZONE_Z), fallback_language: 'en', messages: { en: 'Hi {firstname}' } };
    expect((await admin.post('/sms-offers', body)).body.error.code).toBe('UNKNOWN_PLACEHOLDER');
    expect((await admin.post('/sms-offers/estimate', body)).body.error.code).toBe('UNKNOWN_PLACEHOLDER');
    const test = await admin.post('/sms-offers/test', { language: 'en', message: 'Hi {firstname}', phone: '0770666601' });
    expect(test.body.error.code).toBe('UNKNOWN_PLACEHOLDER');
  });

  it('a test SMS fills the placeholders with a made-up customer', async () => {
    const res = await admin.post('/sms-offers/test', { language: 'en', message: 'Hi {name}: {points} points, {wallet}', phone: '0770666601' }).expect(202);
    expect(res.body.data.text).toBe('Hi Nimal: 120 points, LKR 1,250');
  });
});

// ---------------------------------------------------------------------------
describe('Quiet hours', () => {
  it('refuse an offer and a test SMS inside them (422 QUIET_HOURS, with when it can go), but not outside', async () => {
    await setQuiet();
    const pinned = orderingClock.now;
    try {
      orderingClock.now = () => new Date('2026-10-06T17:30:00.000Z'); // 23:00 Colombo
      const offer = await admin.post('/sms-offers', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN });
      expect(offer.status).toBe(422);
      expect(offer.body.error).toMatchObject({ code: 'QUIET_HOURS', details: { resume_at: '2026-10-07T01:30:00.000Z' } });
      expect(offer.body.error.message).toContain('10 PM');
      const test = await admin.post('/sms-offers/test', { language: 'en', message: 'Hello', phone: '0770666601' });
      expect(test.body.error.code).toBe('QUIET_HOURS');
      const view = (await admin.get('/settings/sms-sending').expect(200)).body.data;
      expect(view.sending_now).toMatchObject({ allowed: false, code: 'QUIET_HOURS', resume_at: '2026-10-07T01:30:00.000Z' });
      const preview = (await admin.post('/sms-offers/estimate', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN }).expect(200)).body.data.estimate;
      expect(preview.sending).toMatchObject({ allowed: false, code: 'QUIET_HOURS' });
      expect(await rowsFor(c6.id)).toHaveLength(0);

      orderingClock.now = () => new Date('2026-10-06T06:30:00.000Z'); // noon
      const ok = await admin.post('/sms-offers', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN }).expect(201);
      offerIds.push(ok.body.data.offer.id);
    } finally {
      orderingClock.now = pinned;
    }
  });

  it('the birthday text waits for them to end (same day)', async () => {
    await pool.query(`UPDATE users SET date_of_birth = '1990-10-06' WHERE id = $1`, [c5.id]);
    const ON = { ...DEFAULT_BIRTHDAY_OFFER, enabled: true, percent: 10, sms_enabled: true };
    const pinned = smsSendingSettings.read;
    smsSendingSettings.read = async () => ({ any_time: true, quiet_hours: { enabled: true, start: '22:00', end: '07:00' } });
    try {
      expect(await runBirthdaySms({ now: new Date('2026-10-06T17:30:00Z'), setting: ON, userIds: [c5.id] })).toEqual([]); // 23:00
      expect(await runBirthdaySms({ now: new Date('2026-10-06T01:00:00Z'), setting: ON, userIds: [c5.id] })).toEqual([]); // 06:30
      expect(await runBirthdaySms({ now: new Date('2026-10-06T01:30:00Z'), setting: ON, userIds: [c5.id] })).toEqual([c5.id]); // 07:00
    } finally {
      smsSendingSettings.read = pinned;
    }
    expect(await rowsFor(c5.id, `notification_type = 'BIRTHDAY_OFFER'`)).toHaveLength(1);
  });

  it('with quiet hours off (default) the birthday text goes out at 23:00 as well', async () => {
    await pool.query(`DELETE FROM notifications WHERE user_id = $1 AND notification_type = 'BIRTHDAY_OFFER'`, [c5.id]);
    const ON = { ...DEFAULT_BIRTHDAY_OFFER, enabled: true, percent: 10, sms_enabled: true };
    expect(await runBirthdaySms({ now: new Date('2026-10-06T17:30:00Z'), setting: ON, userIds: [c5.id] })).toEqual([c5.id]);
  });
});

// ---------------------------------------------------------------------------
describe('Per-customer cap and monthly budget', () => {
  const offer = (messages = PLAIN) => admin.post('/sms-offers', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages });

  it('cap off by default; with a cap of 1 in 7 days capped customers are skipped and counted', async () => {
    const first = await offer().expect(201);
    offerIds.push(first.body.data.offer.id);
    expect(first.body.data.offer).toMatchObject({ recipients: 2, skipped_capped: 0 });
    await admin.put('/settings/sms-limits', { per_customer: { enabled: true, max: 1, days: 7 } }).expect(200);
    const estimate = (await admin.post('/sms-offers/estimate', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN }).expect(200)).body.data.estimate;
    expect(estimate).toMatchObject({ recipients: 0, skipped_capped: 2 });
    const refused = await offer();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ code: 'OFFER_NO_RECIPIENTS', details: { skipped_capped: 2 } });
    // These customers have had 2 offers so far: a cap of 3 lets one more through, and then they are capped.
    await admin.put('/settings/sms-limits', { per_customer: { max: 3 } }).expect(200);
    const second = await offer().expect(201);
    offerIds.push(second.body.data.offer.id);
    expect(second.body.data.offer.recipients).toBe(2);
    expect((await offer()).body.error.code).toBe('OFFER_NO_RECIPIENTS');
    // Order and OTP texts do not count: only SMS_OFFER rows.
    expect((await rowsFor(c6.id)).length).toBe(3);
  });

  it('a campaign run skips capped customers too (skipped_capped on the run)', async () => {
    await admin.put('/settings/sms-limits', { per_customer: { enabled: true, max: 1, days: 7 } }).expect(200);
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp capped', audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN, schedule: { send_at: '2026-10-07T18:00:00+05:30' } });
    await runDueCampaigns({ now: new Date('2026-10-07T12:30:00Z'), campaignIds: [c.id] });
    const [run] = await runsOf(c.id);
    expect(run).toMatchObject({ status: 'EMPTY', recipients: 0, skipped_capped: 2 });
    expect(await campaignRows(c.id, c6.id)).toHaveLength(0);
  });

  it('the monthly budget refuses an offer that does not fit, naming what is left', async () => {
    const used = await monthlyPartsUsed(db, orderingClock.now());
    await admin.put('/settings/sms-limits', { monthly_budget: { enabled: true, parts: used + 1 } }).expect(200);
    const refused = await offer();
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: 'SMS_BUDGET_EXCEEDED', details: { needed_parts: 2, remaining_parts: 1, monthly_parts: used + 1 } });
    const preview = (await admin.post('/sms-campaigns/preview', { audience: areaOf(ZONE_Y), fallback_language: 'en', messages: PLAIN }).expect(200)).body.data.preview;
    expect(preview.budget).toMatchObject({ monthly_parts: used + 1, remaining_parts: 1, would_exceed: true });
    expect((await admin.get('/settings/sms-limits')).body.data.usage).toMatchObject({ parts_used: used, remaining_parts: 1 });
    await admin.put('/settings/sms-limits', { monthly_budget: { enabled: true, parts: used + 100 } }).expect(200);
    const ok = await offer().expect(201);
    offerIds.push(ok.body.data.offer.id);
  });

  it('a campaign run that would pass the budget is BLOCKED_BUDGET: a ONCE completes, a RECURRING stays active', async () => {
    const now = new Date('2026-10-07T12:30:00Z');
    const used = await monthlyPartsUsed(db, now);
    await admin.put('/settings/sms-limits', { monthly_budget: { enabled: true, parts: used + 1 } }).expect(200);
    const once = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp blocked once', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { send_at: '2026-10-07T18:00:00+05:30' } });
    const daily = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp blocked daily', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'DAILY', time: '18:00' } });
    const counts = await runDueCampaigns({ now, campaignIds: [once.id, daily.id] });
    expect(counts.blocked).toBe(2);
    const [r1] = await runsOf(once.id);
    expect(r1).toMatchObject({ status: 'BLOCKED_BUDGET', recipients: 0 });
    expect(r1.reason).toContain('budget');
    expect(await campaignRow(once.id)).toMatchObject({ status: 'COMPLETED', next_run_at: null });
    expect(await campaignRow(daily.id)).toMatchObject({ status: 'ACTIVE' });
    expect(new Date((await campaignRow(daily.id)).next_run_at).toISOString()).toBe('2026-10-08T12:30:00.000Z');
    expect(await campaignRows(daily.id, c8.id)).toHaveLength(0);
    await admin.post(`/sms-campaigns/${daily.id}/cancel`).expect(200);
  });
});

// ---------------------------------------------------------------------------
describe('Preview and CUSTOM filters', () => {
  const estimate = async (audience: object, messages: object = PLAIN) =>
    (await admin.post('/sms-offers/estimate', { audience, fallback_language: 'en', messages }).expect(200)).body.data.estimate;

  it('the preview gives recipients, language split, parts, skipped counts and 3 sample texts', async () => {
    const res = await admin.post('/sms-campaigns/preview', { kind: 'ONCE', audience: areaOf(ZONE_Z), fallback_language: 'en', messages: TEXT }).expect(200);
    const p = res.body.data.preview;
    expect(p).toMatchObject({
      kind: 'ONCE',
      recipients: 2,
      by_language: { si: 0, ta: 1, en: 1 },
      without_language: 1,
      opted_out: 1,
      skipped_no_phone: 1,
      skipped_capped: 0,
      sms_parts_total: 2,
      missing_languages: [],
      budget: null,
      sending: { allowed: true },
    });
    expect(p.parts_per_sms).toEqual({ en: 1, ta: 1, si: 1 });
    expect(p.samples).toHaveLength(2);
    expect(p.samples.map((s: { text: string }) => s.text).sort()).toEqual(['Hi Nimal, you have 120 points and LKR 1,250. https://blynk.lk/app', 'வணக்கம் நண்பரே, 0 புள்ளிகள்'].sort());
    // Nothing was queued by a preview.
    expect((await rowsFor(c2.id)).filter((r) => !r.payload.offer_id)).toHaveLength(0);
    const missing = await admin.post('/sms-campaigns/preview', { audience: areaOf(ZONE_Z), fallback_language: 'en', messages: { en: 'English only' } }).expect(200);
    expect(missing.body.data.preview.missing_languages).toEqual(['ta']);
  });

  it('parts are counted on the longest plausible rendering', async () => {
    // 150 characters + {name}: a 20-letter name makes it 170 characters = 2 parts.
    const est = await estimate(areaOf(ZONE_Z), { en: `${'a'.repeat(150)}{name}`, ta: 'த' });
    expect(est.parts_per_sms.en).toBe(2);
  });

  it('CUSTOM filters are AND-ed: areas, language, points, orders, spend, last order', async () => {
    await order(c1.id, 'DELIVERED', 10, 1500);
    const count = async (filters: object) => (await estimate({ group: 'CUSTOM', areas: [ZONE_Z], ...filters })).recipients;
    expect(await count({})).toBe(2);
    expect((await estimate({ group: 'CUSTOM', areas: [ZONE_Z.toUpperCase()] })).recipients).toBe(2); // case-insensitive
    expect((await estimate({ group: 'CUSTOM', areas: ['Zqxcamp Nowhere'] })).recipients).toBe(0);
    expect(await count({ language: 'ta' })).toBe(1);
    expect(await count({ language: 'none' })).toBe(1);
    expect(await count({ language: 'si' })).toBe(0);
    expect(await count({ min_points: 100 })).toBe(1);
    expect(await count({ max_points: 50 })).toBe(1);
    expect(await count({ min_points: 100, max_points: 150 })).toBe(1);
    expect(await count({ min_orders: 1 })).toBe(1);
    expect(await count({ max_orders: 0 })).toBe(1);
    expect(await count({ min_orders: 2 })).toBe(0);
    expect(await count({ min_spend_lkr: 1000, spend_days: 30 })).toBe(1);
    expect(await count({ min_spend_lkr: 2000, spend_days: 30 })).toBe(0);
    expect(await count({ min_spend_lkr: 1000, spend_days: 5 })).toBe(0); // the order is 10 days old
    expect(await count({ last_order_days_min: 5 })).toBe(1);
    expect(await count({ last_order_days_min: 20 })).toBe(0);
    expect(await count({ last_order_days_max: 20 })).toBe(1);
    expect(await count({ last_order_days_max: 5 })).toBe(0);
    expect(await count({ language: 'none', min_orders: 1, last_order_days_max: 20, min_points: 1 })).toBe(1);
    expect(await count({ language: 'ta', min_orders: 1 })).toBe(0); // AND, not OR
    const bad = await admin.post('/sms-offers/estimate', { audience: { group: 'CUSTOM', min_points: 9, max_points: 1 }, fallback_language: 'en', messages: PLAIN });
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Scheduled offers and campaigns (ONCE)', () => {
  it('a scheduled offer is a ONCE campaign: refused in the past or beyond a year, sent once and only after send_at', async () => {
    const body = { audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN };
    expect((await admin.post('/sms-offers', { ...body, send_at: '2026-10-06T10:00:00+05:30' })).status).toBe(400); // before the pinned "now" (noon)
    expect((await admin.post('/sms-offers', { ...body, send_at: '2028-01-01T10:00:00+05:30' })).status).toBe(400);
    expect((await admin.post('/sms-offers', { ...body, send_at: 'tomorrow' })).status).toBe(400);
    expect((await admin.post('/sms-offers', { ...body, send_at: '2026-10-07T18:00:00' })).status).toBe(400); // no time zone

    const res = await admin.post('/sms-offers', { ...body, send_at: '2026-10-07T18:00:00+05:30', name: 'Zqxcamp scheduled' }).expect(201);
    const c = res.body.data.campaign;
    campaignIds.push(c.id);
    expect(c).toMatchObject({ kind: 'ONCE', status: 'ACTIVE', name: 'Zqxcamp scheduled', run_count: 0, next_run_at: '2026-10-07T12:30:00.000Z', schedule: { send_at: '2026-10-07T12:30:00.000Z' } });
    expect(res.body.data.offer).toBeUndefined();

    // Before send_at: nothing. At send_at: once. After: nothing more.
    expect(await runDueCampaigns({ now: new Date('2026-10-07T12:29:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 0, delayed: 0 });
    expect(await campaignRows(c.id, c8.id)).toHaveLength(0);
    expect(await runDueCampaigns({ now: new Date('2026-10-07T12:30:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 1 });
    expect(await runDueCampaigns({ now: new Date('2026-10-07T12:31:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 0, empty: 0 });
    for (const who of [c8, c9]) {
      const rows = await campaignRows(c.id, who.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].idempotency_key).toBe(`sms-campaign:${c.id}:once:${who.id}`);
      expect(rows[0].payload).toMatchObject({ text: PLAIN.en, campaign_id: c.id, language: 'en' });
    }
    const runs = await runsOf(c.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'SENT', recipients: 2, parts: 2, run_key: 'once', skipped_opted_out: 0, skipped_capped: 0, skipped_no_phone: 0 });
    expect(await campaignRow(c.id)).toMatchObject({ status: 'COMPLETED', next_run_at: null, run_count: 1, recipients_total: 2, parts_total: 2 });
    const detail = (await admin.get(`/sms-campaigns/${c.id}`).expect(200)).body.data.campaign;
    expect(detail).toMatchObject({ status: 'COMPLETED', recipients_total: 2, sms_parts_total: 2, last_run: { status: 'SENT', recipients: 2 } });
    expect(detail.runs).toHaveLength(1);
  });

  it('inside quiet hours the run is DELAYED to their end, not dropped', async () => {
    await setQuiet();
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp late', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'Late offer' }, schedule: { send_at: '2026-10-07T23:00:00+05:30' } });
    const counts = await runDueCampaigns({ now: new Date('2026-10-07T17:30:00Z'), campaignIds: [c.id] });
    expect(counts).toMatchObject({ delayed: 1, sent: 0 });
    expect(await runsOf(c.id)).toHaveLength(0);
    const row = await campaignRow(c.id);
    expect(row.status).toBe('ACTIVE');
    expect(new Date(row.next_run_at).toISOString()).toBe('2026-10-08T01:30:00.000Z'); // 07:00 next morning
    expect(await runDueCampaigns({ now: new Date('2026-10-08T01:29:00Z'), campaignIds: [c.id] })).toMatchObject({ delayed: 0, sent: 0 });
    expect(await runDueCampaigns({ now: new Date('2026-10-08T01:30:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 1 });
    expect(await campaignRows(c.id, c8.id)).toHaveLength(1);
  });

  it('two runners at once queue each customer once', async () => {
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp race', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'Race offer' }, schedule: { send_at: '2026-10-07T18:00:00+05:30' } });
    const now = new Date('2026-10-07T12:30:00Z');
    const [a, b] = await Promise.all([runDueCampaigns({ now, campaignIds: [c.id] }), runDueCampaigns({ now, campaignIds: [c.id] })]);
    expect(a.sent + b.sent).toBe(1);
    expect(await campaignRows(c.id, c8.id)).toHaveLength(1);
    expect(await campaignRows(c.id, c9.id)).toHaveLength(1);
    expect(await runsOf(c.id)).toHaveLength(1);
    expect((await campaignRow(c.id)).run_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('Automatic repeats (RECURRING)', () => {
  it('next_run_at follows the schedule (Colombo): daily, weekly, monthly day 28', async () => {
    const daily = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp daily', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'DAILY', time: '18:00' } });
    expect(daily.next_run_at).toBe('2026-10-06T12:30:00.000Z');
    const weekly = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp weekly', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'] } });
    expect(weekly).toMatchObject({ next_run_at: '2026-10-09T12:30:00.000Z', schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'], starts_on: null, ends_on: null } });
    expect(weekly.schedule_label).toBe('Every Fri at 18:00');
    const monthly = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp monthly', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'MONTHLY', time: '10:00', month_day: 28 } });
    expect(monthly.next_run_at).toBe('2026-10-28T04:30:00.000Z');
    const later = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp later', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'DAILY', time: '09:00', starts_on: '2026-11-01' } });
    expect(later.next_run_at).toBe('2026-11-01T03:30:00.000Z');
    for (const c of [daily, weekly, monthly, later]) await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
    const bad = await createCampaign({ kind: 'RECURRING', name: 'Zqxcamp bad', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'WEEKLY', time: '18:00' } });
    expect(bad.status).toBe(400);
    expect((await createCampaign({ kind: 'RECURRING', name: 'Zqxcamp past', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { frequency: 'DAILY', time: '18:00', ends_on: '2026-10-01' } })).status).toBe(400);
  });

  it('every run looks the audience up again, keeps its own totals and stops after ends_on', async () => {
    const c = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp friday', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'Friday offer' }, schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'], ends_on: '2026-10-16' } });
    expect(await runDueCampaigns({ now: new Date('2026-10-09T12:29:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 0 });
    expect(await runDueCampaigns({ now: new Date('2026-10-09T12:30:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 1 });
    expect(await campaignRows(c.id, c8.id)).toHaveLength(1);
    let row = await campaignRow(c.id);
    expect(row).toMatchObject({ status: 'ACTIVE', run_count: 1, recipients_total: 2 });
    expect(new Date(row.next_run_at).toISOString()).toBe('2026-10-16T12:30:00.000Z');

    // Between runs one of them turns offers off: the second run reaches one customer.
    await pool.query('UPDATE users SET sms_offers_opted_out_at = now() WHERE id = $1', [c9.id]);
    expect(await runDueCampaigns({ now: new Date('2026-10-16T12:30:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 1 });
    const runs = await runsOf(c.id);
    expect(runs.map((r) => [r.run_key, r.recipients, r.skipped_opted_out])).toEqual([
      ['2026-10-09T18:00', 2, 0],
      ['2026-10-16T18:00', 1, 1],
    ]);
    expect(await campaignRows(c.id, c8.id)).toHaveLength(2);
    expect(await campaignRows(c.id, c9.id)).toHaveLength(1);
    row = await campaignRow(c.id);
    expect(row).toMatchObject({ status: 'COMPLETED', next_run_at: null, run_count: 2, recipients_total: 3 }); // ends_on was the 16th
    await pool.query('UPDATE users SET sms_offers_opted_out_at = NULL WHERE id = $1', [c9.id]);
  });

  it('a missed time is run once, late, and the next run is the next occurrence', async () => {
    const c = await mustCreate({ kind: 'RECURRING', name: 'Zqxcamp catch-up', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'Catch-up offer' }, schedule: { frequency: 'DAILY', time: '18:00' } });
    // The worker was down for three days.
    expect(await runDueCampaigns({ now: new Date('2026-10-09T05:00:00Z'), campaignIds: [c.id] })).toMatchObject({ sent: 1 });
    expect(await runsOf(c.id)).toHaveLength(1);
    expect(new Date((await campaignRow(c.id)).next_run_at).toISOString()).toBe('2026-10-09T12:30:00.000Z');
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
  });
});

// ---------------------------------------------------------------------------
describe('Automatic triggers (TRIGGER)', () => {
  // Customers 10-16 are made here; every send uses the real clock (the data is "N days ago" in SQL).
  let t10: Shopper, t11: Shopper, t12: Shopper, t13: Shopper, t14: Shopper, t15: Shopper;
  const run = (id: string) => runDueCampaigns({ now: new Date(), campaignIds: [id] });
  const rerun = async (id: string) => {
    await pool.query(`UPDATE sms_campaigns SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    return run(id);
  };
  const triggerRows = async (id: string, who: Shopper) => campaignRows(id, who.id);

  beforeAll(async () => {
    [t10, t11, t12, t13, t14, t15] = await Promise.all([10, 11, 12, 13, 14, 15].map((n) => people.customer(n)));
    await pool.query('UPDATE users SET full_name = NULL WHERE id = $1', [t10.id]);
    // Sign-ups 300 days ago: t10 never ordered, t11 ordered. Everyone else joined recently.
    await joinedDaysAgo(t10.id, 300);
    await joinedDaysAgo(t11.id, 300);
    await order(t11.id, 'DELIVERED', 299, 900);
    // Last orders: t12 250 days ago (after an older one), t13 240 days ago (not the day), t14 lapsed 120 days, t15 50 days.
    await order(t12.id, 'DELIVERED', 270, 500);
    await order(t12.id, 'DELIVERED', 250, 500);
    await order(t13.id, 'DELIVERED', 240, 500);
    await order(t14.id, 'DELIVERED', 120, 500);
    await order(t15.id, 'DELIVERED', 50, 500);
    for (const s of [t10, t11, t12, t13, t14, t15]) await joinedDaysAgo(s.id, s.id === t10.id || s.id === t11.id ? 300 : 400);
  });

  const trigger = (schedule: object, text = 'Trigger text for {name}') =>
    mustCreate({ kind: 'TRIGGER', name: `Zqxcamp trigger ${JSON.stringify(schedule).length}`, fallback_language: 'en', messages: { en: text }, schedule });

  it('is created with a daily check time and its own text, and the audience is its own', async () => {
    const c = await trigger({ trigger: 'DAYS_AFTER_SIGNUP', days: 300, time: '09:00' });
    expect(c).toMatchObject({ kind: 'TRIGGER', status: 'ACTIVE', audience_label: null, schedule: { trigger: 'DAYS_AFTER_SIGNUP', days: 300, time: '09:00', only_if_never_ordered: false } });
    expect(c.next_run_at).toBe('2026-10-07T03:30:00.000Z');
    expect(c.schedule_label).toContain('300 days after sign-up');
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
    expect((await createCampaign({ kind: 'TRIGGER', name: 'x', fallback_language: 'en', messages: PLAIN, schedule: { trigger: 'SOMETHING', days: 3, time: '09:00' } })).status).toBe(400);
    expect((await createCampaign({ kind: 'TRIGGER', name: 'x', fallback_language: 'en', messages: PLAIN, schedule: { trigger: 'DAYS_AFTER_SIGNUP', days: 0, time: '09:00' } })).status).toBe(400);
    expect((await createCampaign({ kind: 'TRIGGER', name: 'x', fallback_language: 'en', messages: PLAIN, schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 5, time: '9am' } })).status).toBe(400);
  });

  it('DAYS_AFTER_SIGNUP (only if they never ordered): once per customer, however many days it runs', async () => {
    const c = await trigger({ trigger: 'DAYS_AFTER_SIGNUP', days: 300, time: '09:00', only_if_never_ordered: true });
    await run(c.id);
    const mine = await triggerRows(c.id, t10);
    expect(mine).toHaveLength(1);
    expect(mine[0].idempotency_key).toBe(`sms-campaign:${c.id}:signup:${t10.id}`);
    expect(mine[0].payload.text).toBe('Trigger text for friend'); // t10 has no name
    expect(await triggerRows(c.id, t11)).toHaveLength(0); // ordered
    expect(await triggerRows(c.id, t12)).toHaveLength(0); // joined 400 days ago
    await rerun(c.id); // the next day's check
    expect(await triggerRows(c.id, t10)).toHaveLength(1);
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);

    // Without the "never ordered" condition t11 is included too.
    const all = await trigger({ trigger: 'DAYS_AFTER_SIGNUP', days: 300, time: '09:30' });
    await run(all.id);
    expect(await triggerRows(all.id, t10)).toHaveLength(1);
    expect(await triggerRows(all.id, t11)).toHaveLength(1);
    await admin.post(`/sms-campaigns/${all.id}/cancel`).expect(200);
  });

  it('DAYS_AFTER_LAST_ORDER: the customer whose LAST order was that many days ago, once per order', async () => {
    const c = await trigger({ trigger: 'DAYS_AFTER_LAST_ORDER', days: 250, time: '09:00' });
    await run(c.id);
    const mine = await triggerRows(c.id, t12);
    expect(mine).toHaveLength(1);
    const lastOrder = (await pool.query('SELECT id FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC LIMIT 1', [t12.id])).rows[0].id;
    expect(mine[0].idempotency_key).toBe(`sms-campaign:${c.id}:${lastOrder}:${t12.id}`);
    expect(await triggerRows(c.id, t13)).toHaveLength(0);
    expect(await triggerRows(c.id, t14)).toHaveLength(0);
    await rerun(c.id);
    expect(await triggerRows(c.id, t12)).toHaveLength(1);
    // A newer order is a new anchor: after 250 more days it would text again - here, simulated by moving the order back.
    await pool.query(`UPDATE orders SET placed_at = now() - interval '251 days' WHERE id = $1`, [lastOrder]);
    await rerun(c.id);
    expect(await triggerRows(c.id, t12)).toHaveLength(1); // same anchor (same order): never twice
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
  });

  it('NO_ORDER_FOR_DAYS: lapsed customers, at most once every cooldown_days', async () => {
    const c = await trigger({ trigger: 'NO_ORDER_FOR_DAYS', days: 100, time: '09:00', cooldown_days: 30 });
    expect(c.schedule.cooldown_days).toBe(30);
    await run(c.id);
    expect(await triggerRows(c.id, t14)).toHaveLength(1);
    expect(await triggerRows(c.id, t15)).toHaveLength(0); // ordered 50 days ago
    expect(await triggerRows(c.id, c8.id)).toHaveLength(0); // never ordered: that is DAYS_AFTER_SIGNUP's
    await rerun(c.id);
    expect(await triggerRows(c.id, t14)).toHaveLength(1); // inside the cooldown
    // After the cooldown (the earlier text is 31 days old) the customer is texted again.
    // (Its key is moved too: a real second text would be on another day, so it would have another key.)
    await pool.query(`UPDATE notifications SET created_at = now() - interval '31 days', idempotency_key = idempotency_key || ':old' WHERE payload->>'campaign_id' = $1 AND user_id = $2`, [c.id, t14.id]);
    await pool.query('DELETE FROM sms_campaign_runs WHERE campaign_id = $1', [c.id]); // (the check "ran today" already in this test)
    await rerun(c.id);
    expect(await triggerRows(c.id, t14)).toHaveLength(2);
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
  });

  it('a trigger preview shows who it would text today, and the default cooldown is 30 days', async () => {
    const p = (await admin.post('/sms-campaigns/preview', { kind: 'TRIGGER', fallback_language: 'en', messages: PLAIN, schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 100, time: '09:00' } }).expect(200)).body.data.preview;
    expect(p.kind).toBe('TRIGGER');
    expect(p.recipients).toBeGreaterThanOrEqual(1);
    expect((await admin.post('/sms-campaigns/preview', { kind: 'TRIGGER', fallback_language: 'en', messages: PLAIN })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Pause, resume, edit and cancel', () => {
  it('walks a campaign through its states with clear errors (audited)', async () => {
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp states', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'State offer' }, schedule: { send_at: '2026-10-20T10:00:00+05:30' } });
    const id = c.id;
    const paused = (await admin.post(`/sms-campaigns/${id}/pause`).expect(200)).body.data.campaign;
    expect(paused).toMatchObject({ status: 'PAUSED', next_run_at: null });
    expect((await admin.post(`/sms-campaigns/${id}/pause`)).body.error.code).toBe('CAMPAIGN_NOT_ACTIVE');
    // A paused campaign does not run, even when its time has come.
    expect(await runDueCampaigns({ now: new Date('2026-10-21T00:00:00Z'), campaignIds: [id] })).toMatchObject({ sent: 0, delayed: 0 });
    expect(await campaignRows(id, c8.id)).toHaveLength(0);

    // Edit while paused: texts, name, audience and the schedule (future runs only).
    const edited = (
      await api(opsToken)
        .patch(`/sms-campaigns/${id}`, { name: 'Zqxcamp states 2', messages: { en: 'Edited {name}' }, schedule: { send_at: '2026-10-22T10:00:00+05:30' }, audience: areaOf(ZONE_X) })
        .expect(200)
    ).body.data.campaign;
    expect(edited).toMatchObject({ name: 'Zqxcamp states 2', status: 'PAUSED', messages: { en: 'Edited {name}', si: null, ta: null }, schedule: { send_at: '2026-10-22T04:30:00.000Z' } });
    expect((await admin.patch(`/sms-campaigns/${id}`, { messages: { en: 'Hi {nope}' } })).body.error.code).toBe('UNKNOWN_PLACEHOLDER');
    expect((await admin.patch(`/sms-campaigns/${id}`, { schedule: { send_at: '2026-10-01T10:00:00+05:30' } })).status).toBe(400);
    expect((await admin.patch(`/sms-campaigns/${id}`, { messages: { ta: 'only tamil' }, fallback_language: 'en' })).body.error.code).toBe('OFFER_TEXT_MISSING');
    expect((await admin.patch(`/sms-campaigns/${id}`, {})).status).toBe(400);
    expect((await admin.patch(`/sms-campaigns/${id}`, { kind: 'TRIGGER' })).status).toBe(400);

    const resumed = (await admin.post(`/sms-campaigns/${id}/resume`).expect(200)).body.data.campaign;
    expect(resumed).toMatchObject({ status: 'ACTIVE', next_run_at: '2026-10-22T04:30:00.000Z' });
    expect((await admin.post(`/sms-campaigns/${id}/resume`)).body.error.code).toBe('CAMPAIGN_NOT_PAUSED');
    // Editing an active campaign's schedule moves its next run.
    const moved = (await admin.patch(`/sms-campaigns/${id}`, { schedule: { send_at: '2026-10-25T12:00:00+05:30' } }).expect(200)).body.data.campaign;
    expect(moved.next_run_at).toBe('2026-10-25T06:30:00.000Z');

    const cancelled = (await admin.post(`/sms-campaigns/${id}/cancel`).expect(200)).body.data.campaign;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', next_run_at: null });
    expect(cancelled.cancelled_at).not.toBeNull();
    for (const action of ['pause', 'resume', 'cancel']) expect((await admin.post(`/sms-campaigns/${id}/${action}`)).body.error.code).toBe('CAMPAIGN_FINISHED');
    expect((await admin.patch(`/sms-campaigns/${id}`, { name: 'nope' })).body.error.code).toBe('CAMPAIGN_FINISHED');
    expect(await runDueCampaigns({ now: new Date('2026-10-26T00:00:00Z'), campaignIds: [id] })).toMatchObject({ sent: 0 });
    expect(await campaignRows(id, c8.id)).toHaveLength(0);

    const actions = (await pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`, [id])).rows.map((r) => r.action);
    expect(actions).toEqual(['SMS_CAMPAIGN_CREATED', 'SMS_CAMPAIGN_PAUSED', 'SMS_CAMPAIGN_UPDATED', 'SMS_CAMPAIGN_RESUMED', 'SMS_CAMPAIGN_UPDATED', 'SMS_CAMPAIGN_CANCELLED']);
  });

  it('a campaign that does not exist is 404; a paused ONCE past its time is sent when resumed', async () => {
    expect((await admin.get('/sms-campaigns/00000000-0000-4000-8000-000000000066')).body.error.code).toBe('CAMPAIGN_NOT_FOUND');
    expect((await admin.post('/sms-campaigns/00000000-0000-4000-8000-000000000066/pause')).status).toBe(404);
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp stale', audience: areaOf(ZONE_X), fallback_language: 'en', messages: { en: 'Stale offer' }, schedule: { send_at: '2026-10-07T10:00:00+05:30' } });
    await admin.post(`/sms-campaigns/${c.id}/pause`).expect(200);
    await pool.query(`UPDATE sms_campaigns SET schedule = jsonb_set(schedule, '{send_at}', '"2026-10-01T00:00:00.000Z"') WHERE id = $1`, [c.id]);
    const resumed = (await admin.post(`/sms-campaigns/${c.id}/resume`).expect(200)).body.data.campaign;
    expect(new Date(resumed.next_run_at).toISOString()).toBe('2026-10-06T06:30:00.000Z'); // the pinned "now"
    await admin.post(`/sms-campaigns/${c.id}/cancel`).expect(200);
  });

  it('the campaign needs the fallback language text, a name and a valid kind', async () => {
    const base = { kind: 'ONCE', name: 'Zqxcamp x', audience: areaOf(ZONE_X), schedule: { send_at: '2026-10-20T10:00:00+05:30' } };
    expect((await createCampaign({ ...base, fallback_language: 'si', messages: { en: 'English only' } })).body.error.code).toBe('OFFER_TEXT_MISSING'); // si is on in this file
    expect((await createCampaign({ ...base, fallback_language: 'en', messages: { en: 'Hi {x}' } })).body.error.code).toBe('UNKNOWN_PLACEHOLDER');
    expect((await createCampaign({ ...base, name: '', fallback_language: 'en', messages: PLAIN })).status).toBe(400);
    expect((await createCampaign({ ...base, kind: 'WEEKLY', fallback_language: 'en', messages: PLAIN })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('Lists and history', () => {
  it('lists campaigns (filters, active first) and one history of offers sent now and campaign runs', async () => {
    const all = (await admin.get('/sms-campaigns').expect(200)).body.data.campaigns as Record<string, any>[];
    const mine = all.filter((c) => c.name.startsWith('Zqxcamp'));
    expect(mine.length).toBeGreaterThan(5);
    const ranks = all.map((c) => ({ ACTIVE: 0, PAUSED: 1, CANCELLED: 2, COMPLETED: 2 })[c.status as string]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a! - b!));
    const cancelled = (await admin.get('/sms-campaigns?status=CANCELLED&kind=RECURRING').expect(200)).body.data.campaigns as Record<string, any>[];
    expect(cancelled.every((c) => c.status === 'CANCELLED' && c.kind === 'RECURRING')).toBe(true);
    expect((await admin.get('/sms-campaigns?status=NOPE')).status).toBe(400);

    const history = (await admin.get('/sms-campaigns/history?limit=200').expect(200)).body.data.items as Record<string, any>[];
    const types = new Set(history.map((h) => h.type));
    expect(types).toEqual(new Set(['OFFER', 'CAMPAIGN_RUN']));
    const run = history.find((h) => h.type === 'CAMPAIGN_RUN' && h.name === 'Zqxcamp scheduled')!;
    expect(run).toMatchObject({ status: 'SENT', recipients: 2, sms_parts: 2, campaign_kind: 'ONCE' });
    const offer = history.find((h) => h.type === 'OFFER' && offerIds.includes(h.id))!;
    expect(offer).toMatchObject({ status: 'SENT', campaign_id: null });
    const times = history.map((h) => h.at);
    expect(times).toEqual([...times].sort().reverse());
  });
});

// ---------------------------------------------------------------------------
describe('Roles', () => {
  it('Admin and Operations can use every campaign route; customers, packing staff and signed-out callers cannot', async () => {
    const c = await mustCreate({ kind: 'ONCE', name: 'Zqxcamp roles', audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN, schedule: { send_at: '2026-10-20T10:00:00+05:30' } });
    for (const token of [customerToken, packingToken]) {
      const a = api(token);
      expect((await a.get('/sms-campaigns')).status).toBe(403);
      expect((await a.get('/sms-campaigns/history')).status).toBe(403);
      expect((await a.get(`/sms-campaigns/${c.id}`)).status).toBe(403);
      expect((await a.post('/sms-campaigns', { kind: 'ONCE' })).status).toBe(403);
      expect((await a.post('/sms-campaigns/preview', {})).status).toBe(403);
      expect((await a.patch(`/sms-campaigns/${c.id}`, { name: 'x' })).status).toBe(403);
      for (const action of ['pause', 'resume', 'cancel']) expect((await a.post(`/sms-campaigns/${c.id}/${action}`)).status).toBe(403);
      expect((await a.get('/sms-placeholders')).status).toBe(403);
      expect((await a.get('/sms-offers/areas')).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/sms-campaigns')).status).toBe(401);
    const ops = api(opsToken);
    expect((await ops.get('/sms-campaigns')).status).toBe(200);
    expect((await ops.post(`/sms-campaigns/${c.id}/pause`)).status).toBe(200);
    expect((await ops.post(`/sms-campaigns/${c.id}/resume`)).status).toBe(200);
    expect((await ops.post('/sms-campaigns/preview', { audience: areaOf(ZONE_X), fallback_language: 'en', messages: PLAIN })).status).toBe(200);
    expect((await ops.post(`/sms-campaigns/${c.id}/cancel`)).status).toBe(200);
  });
});
