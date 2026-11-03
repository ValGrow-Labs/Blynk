import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { SmsOffers } from '../pages/SmsOffers';
import { tokenStore } from '../api/client';
import type { SmsCampaign, SmsCampaignRun, SmsLanguage, SmsOfferEstimate, SmsTemplate } from '../api/types';
import { audienceFromDraft, audienceLabel, blankAudienceDraft, draftFromAudience } from '../lib/customerGroups';
import {
  blankRecurringDraft,
  blankTriggerDraft,
  colomboLocalToSendAt,
  insertToken,
  messagesOf,
  recurringFromDraft,
  sendAtToColomboLocal,
  triggerFromDraft,
} from '../lib/smsCampaigns';
import { exampleRendering, longestRendering, offerParts } from '../lib/smsOffers';
import { fail, mockApi, ok, type Call, type Reply } from './mockApi';

/**
 * SMS offers: the Scheduled and automatic tab (campaigns: list, create RECURRING and TRIGGER, pause,
 * resume, edit, cancel, run history) and the Templates tab (backend migration 066, 2026-11-03).
 * What the API does with a campaign is tested against PostgreSQL in backend/api/tests; here, what
 * the page asks for and shows.
 */
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

let languages: SmsLanguage[] = ['en'];
let campaigns: SmsCampaign[] = [];
let templates: SmsTemplate[] = [];

const estimate = (overrides: Partial<SmsOfferEstimate> = {}): SmsOfferEstimate => ({
  audience: 'ALL',
  recipients: 12,
  by_language: { si: 0, ta: 0, en: 12 },
  without_language: 0,
  opted_out: 1,
  parts_per_sms: {},
  sms_parts_total: 12,
  missing_languages: [],
  languages,
  ...overrides,
});

const run = (overrides: Partial<SmsCampaignRun> = {}): SmsCampaignRun => ({
  id: 'r1',
  campaign_id: 'c1',
  scheduled_for: '2026-10-30T12:30:00.000Z',
  ran_at: '2026-10-30T12:30:05.000Z',
  status: 'SENT',
  recipients: 40,
  sms_parts: 44,
  skipped_opted_out: 2,
  skipped_capped: 3,
  skipped_no_phone: 1,
  reason: null,
  ...overrides,
});

const campaign = (overrides: Partial<SmsCampaign> = {}): SmsCampaign => ({
  id: 'c1',
  name: 'Friday reminder',
  kind: 'RECURRING',
  status: 'ACTIVE',
  audience: { group: 'LAPSED', days: 14 },
  audience_label: "Haven't ordered in the last 14 days",
  fallback_language: 'en',
  messages: { si: null, ta: null, en: 'Hi {name}, we miss you' },
  schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'], starts_on: null, ends_on: null },
  schedule_label: 'Every Fri at 18:00',
  next_run_at: '2026-11-06T12:30:00.000Z',
  last_run_at: '2026-10-30T12:30:05.000Z',
  run_count: 3,
  recipients_total: 120,
  sms_parts_total: 132,
  last_run: run(),
  created_by_name: 'Nawaz Mansoor',
  created_at: '2026-10-01T05:00:00.000Z',
  updated_at: '2026-10-01T05:00:00.000Z',
  cancelled_at: null,
  ...overrides,
});

const template = (overrides: Partial<SmsTemplate> = {}): SmsTemplate => ({
  id: 't1',
  name: 'Weekend rice',
  messages: { si: null, ta: null, en: 'Rice 10% off, {name}' },
  created_by_name: 'Nawaz Mansoor',
  ...overrides,
});

/** The offer, campaign and template endpoints; `extra` answers first. */
function setup(extra: (c: Call) => Reply | undefined = () => undefined) {
  tokenStore.save('access', 'refresh');
  const api = mockApi((c) => {
    const custom = extra(c);
    if (custom) return custom;
    if (c.path === '/admin/sms-offers/estimate') return ok({ estimate: estimate() });
    if (c.path === '/admin/sms-campaigns/preview') return ok({ preview: estimate() });
    if (c.path === '/admin/sms-offers/areas') return ok({ areas: [] });
    if (c.method === 'GET' && c.path === '/admin/sms-campaigns') return ok({ campaigns });
    if (c.method === 'GET' && c.path === '/admin/sms-templates') return ok({ templates });
    return undefined;
  });
  render(
    <MemoryRouter>
      <ToastProvider>
        <SmsOffers />
      </ToastProvider>
    </MemoryRouter>
  );
  return api;
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('tab', { name }));
}

const card = (name: string) => screen.findByRole('article', { name });
const formNamed = (name: string) => within(screen.getByRole('form', { name }));

beforeEach(() => {
  languages = ['en'];
  campaigns = [];
  templates = [];
});
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('SMS campaigns (lib)', () => {
  it('builds the RECURRING schedule for each frequency, and says what is missing', () => {
    expect(recurringFromDraft({ ...blankRecurringDraft(), time: '09:30' })).toEqual({ schedule: { frequency: 'DAILY', time: '09:30' }, problem: null });
    expect(recurringFromDraft({ ...blankRecurringDraft(), frequency: 'WEEKLY', time: '18:00', weekdays: ['fri', 'mon'] }).schedule).toEqual({
      frequency: 'WEEKLY',
      time: '18:00',
      weekdays: ['mon', 'fri'],
    });
    expect(
      recurringFromDraft({ ...blankRecurringDraft(), frequency: 'MONTHLY', month_day: '28', starts_on: '2026-12-01', ends_on: '2027-01-31' }).schedule
    ).toEqual({ frequency: 'MONTHLY', time: '09:00', month_day: 28, starts_on: '2026-12-01', ends_on: '2027-01-31' });
    expect(recurringFromDraft({ ...blankRecurringDraft(), frequency: 'WEEKLY' }).problem).toBe('Choose at least one weekday.');
    expect(recurringFromDraft({ ...blankRecurringDraft(), frequency: 'MONTHLY', month_day: '29' }).problem).toMatch(/1 to 28/);
    expect(recurringFromDraft({ ...blankRecurringDraft(), time: '' }).problem).toMatch(/time/);
    expect(recurringFromDraft({ ...blankRecurringDraft(), starts_on: '2026-12-05', ends_on: '2026-12-01' }).problem).toBe('The end date is before the start date.');
  });

  it('builds the TRIGGER schedule with only the fields its kind uses', () => {
    expect(triggerFromDraft(blankTriggerDraft()).schedule).toEqual({ trigger: 'DAYS_AFTER_LAST_ORDER', days: 7, time: '09:00' });
    expect(triggerFromDraft({ ...blankTriggerDraft(), trigger: 'DAYS_AFTER_SIGNUP', only_if_never_ordered: true }).schedule).toEqual({
      trigger: 'DAYS_AFTER_SIGNUP',
      days: 7,
      time: '09:00',
      only_if_never_ordered: true,
    });
    expect(triggerFromDraft({ ...blankTriggerDraft(), trigger: 'DAYS_AFTER_SIGNUP' }).schedule).toEqual({ trigger: 'DAYS_AFTER_SIGNUP', days: 7, time: '09:00' });
    expect(triggerFromDraft({ ...blankTriggerDraft(), trigger: 'NO_ORDER_FOR_DAYS', days: '45', cooldown_days: '60' }).schedule).toEqual({
      trigger: 'NO_ORDER_FOR_DAYS',
      days: 45,
      time: '09:00',
      cooldown_days: 60,
    });
    expect(triggerFromDraft({ ...blankTriggerDraft(), days: '0' }).problem).toMatch(/1 to 365/);
    expect(triggerFromDraft({ ...blankTriggerDraft(), trigger: 'NO_ORDER_FOR_DAYS', cooldown_days: '' }).problem).toMatch(/cooldown/);
  });

  it('turns a date and time into the instant the API takes (Asia/Colombo, +05:30) and back', () => {
    expect(colomboLocalToSendAt('2026-12-01T18:00')).toBe('2026-12-01T18:00:00+05:30');
    expect(colomboLocalToSendAt('2026-12-01')).toBeNull();
    expect(colomboLocalToSendAt('')).toBeNull();
    expect(sendAtToColomboLocal('2026-12-01T12:30:00.000Z')).toBe('2026-12-01T18:00');
    expect(sendAtToColomboLocal('nonsense')).toBe('');
  });

  it('keeps only the languages that have text, and inserts a word over the selection', () => {
    expect(messagesOf({ si: ' ', ta: 'தமிழ்', en: ' Hello ' })).toEqual({ ta: 'தமிழ்', en: 'Hello' });
    expect(messagesOf({ si: 'සිං', ta: 'தமிழ்', en: 'Hello' }, ['en'])).toEqual({ en: 'Hello' });
    expect(insertToken('Hi , bye', '{name}', 3, 3)).toEqual({ value: 'Hi {name}, bye', caret: 9 });
    expect(insertToken('Hi XX', '{name}', 3, 5)).toEqual({ value: 'Hi {name}', caret: 9 });
    expect(insertToken('Hi', '{points}', null, null)).toEqual({ value: 'Hi{points}', caret: 10 });
  });

  it('renders placeholders at their longest for the parts, and as an example for the preview', () => {
    expect(longestRendering('Hi {name}, {points} points, {wallet}, {app_link}, {other}')).toBe(
      `Hi ${'W'.repeat(20)}, 9999999 points, LKR 9,999,999.99, https://blynk.lk/app, {other}`
    );
    expect(exampleRendering('Hi {name}, {points} points, {wallet}')).toBe('Hi Nimal, 120 points, LKR 1,250');
    // {name} counts as 20 letters: 141 characters of text + 20 for the name is 161, two parts.
    expect(offerParts(`{name}${'a'.repeat(141)}`, 'en')).toBe(2);
    expect(offerParts(`${'a'.repeat(140)}`, 'en')).toBe(1);
  });

  it('builds, reads back and words the custom audience', () => {
    const d = blankAudienceDraft();
    const custom = {
      ...d,
      group: 'CUSTOM' as const,
      custom: {
        ...d.custom,
        areas: ['Kalutara'],
        min_orders: '1',
        min_spend_lkr: '2500',
        spend_days: '60',
        language: 'si' as const,
        last_order_days_max: '45',
      },
    };
    const built = audienceFromDraft(custom);
    expect(built).toEqual({
      audience: { group: 'CUSTOM', areas: ['Kalutara'], min_orders: 1, min_spend_lkr: 2500, spend_days: 60, language: 'si', last_order_days_max: 45 },
      problem: null,
    });
    expect(audienceFromDraft({ ...d, group: 'CUSTOM' })).toEqual({ audience: { group: 'CUSTOM' }, problem: null });
    expect(audienceFromDraft({ ...d, group: 'CUSTOM', custom: { ...d.custom, max_points: '-3' } }).problem).toMatch(/Maximum points/);
    expect(audienceFromDraft({ ...d, group: 'CUSTOM', custom: { ...d.custom, min_spend_lkr: '10', spend_days: '400' } }).problem).toMatch(/Spend days/);
    expect(draftFromAudience(built.audience).custom).toMatchObject({ areas: ['Kalutara'], min_orders: '1', spend_days: '60', language: 'si', last_order_days_max: '45' });
    expect(draftFromAudience({ group: 'LAPSED', days: 21 })).toMatchObject({ group: 'LAPSED', days: { LAPSED: '21' } });
    expect(draftFromAudience('ALL').group).toBe('ALL');
    expect(audienceLabel(built.audience)).toBe('Custom: In Kalutara; 1+ orders; spent LKR 2,500+ in 60 days; language: Sinhala; last order up to 45 days ago');
    expect(audienceLabel({ group: 'CUSTOM' })).toBe('Custom: All customers (no filters)');
  });
});

describe('Scheduled and automatic tab', () => {
  it('lists campaigns with kind, status, schedule, audience, next run, totals and the last run', async () => {
    const user = userEvent.setup();
    campaigns = [
      campaign(),
      campaign({
        id: 'c2',
        name: 'Welcome back',
        kind: 'TRIGGER',
        status: 'PAUSED',
        audience: { group: 'ALL' },
        audience_label: null,
        schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 30, time: '09:00', cooldown_days: 30 },
        schedule_label: 'Checked daily at 09:00: No order for 30 days (again after 30 days at most)',
        next_run_at: null,
        last_run: null,
        last_run_at: null,
        run_count: 0,
        recipients_total: 0,
        sms_parts_total: 0,
      }),
      campaign({ id: 'c3', name: 'Scheduled offer 5 Nov', kind: 'ONCE', status: 'COMPLETED', schedule: { send_at: '2026-11-05T12:30:00.000Z' }, schedule_label: 'Once, 5 Nov 2026, 6:00 PM', next_run_at: null }),
    ];
    setup();
    await openTab(user, 'Scheduled and automatic');

    const first = within(await card('Friday reminder'));
    expect(first.getByText('Repeats')).toBeInTheDocument();
    expect(first.getByText('Active')).toBeInTheDocument();
    expect(first.getByText('Every Fri at 18:00')).toBeInTheDocument();
    expect(first.getByText("Haven't ordered in the last 14 days")).toBeInTheDocument();
    expect(first.getByText('6 Nov 2026 18:00')).toBeInTheDocument();
    expect(first.getByText('3 runs · 120 customers · 132 SMS parts')).toBeInTheDocument();
    expect(first.getByText('30 Oct 2026 18:00: Sent, 40 customers')).toBeInTheDocument();
    expect(first.getByText('English: Hi {name}, we miss you')).toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Pause Friday reminder' })).toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Edit Friday reminder' })).toBeInTheDocument();
    expect(first.getByRole('button', { name: 'Cancel Friday reminder' })).toBeInTheDocument();
    expect(first.queryByRole('button', { name: /^Resume/ })).toBeNull();

    const second = within(await card('Welcome back'));
    expect(second.getByText('Automatic')).toBeInTheDocument();
    expect(second.getByText('Paused')).toBeInTheDocument();
    expect(second.getByText('None while paused')).toBeInTheDocument();
    expect(second.getByText('Chosen by the trigger')).toBeInTheDocument();
    expect(second.getByText('Not run yet')).toBeInTheDocument();
    expect(second.getByRole('button', { name: 'Resume Welcome back' })).toBeInTheDocument();
    expect(second.queryByRole('button', { name: /^Pause/ })).toBeNull();

    // A finished campaign can only show its runs.
    const third = within(await card('Scheduled offer 5 Nov'));
    expect(third.getByText('Scheduled once')).toBeInTheDocument();
    expect(third.getByText('Finished')).toBeInTheDocument();
    expect(third.queryByRole('button', { name: /^(Pause|Resume|Edit|Cancel)/ })).toBeNull();
    expect(third.getByRole('button', { name: 'Show runs of Scheduled offer 5 Nov' })).toBeInTheDocument();
  });

  it('says so when there are no campaigns, and when the list cannot load', async () => {
    const user = userEvent.setup();
    setup();
    await openTab(user, 'Scheduled and automatic');
    expect(await screen.findByText('Nothing scheduled yet')).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    const user = userEvent.setup();
    setup((c) => (c.method === 'GET' && c.path === '/admin/sms-campaigns' ? fail(500, 'SERVER_ERROR', 'The campaigns could not be loaded.') : undefined));
    await openTab(user, 'Scheduled and automatic');
    expect(await screen.findByText('The campaigns could not be loaded.')).toBeInTheDocument();
  });

  it('creates a WEEKLY repeating campaign with the exact request body', async () => {
    const user = userEvent.setup();
    const api = setup((c) => (c.method === 'POST' && c.path === '/admin/sms-campaigns' ? ok({ campaign: campaign({ id: 'new' }) }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'New repeating campaign' }));
    const f = formNamed('New repeating campaign');

    await user.type(f.getByLabelText('Name'), 'Friday reminder');
    await user.selectOptions(f.getByLabelText('Send to'), 'LAPSED');
    await user.selectOptions(f.getByLabelText('Repeat'), 'WEEKLY');
    expect(f.queryByLabelText('Day of the month')).toBeNull();
    await user.click(f.getByRole('button', { name: 'Friday' }));
    await user.click(f.getByRole('button', { name: 'Monday' }));
    expect(f.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(f.getByLabelText('At'), { target: { value: '18:00' } });
    fireEvent.change(f.getByLabelText('Ends on'), { target: { value: '2099-01-31' } });
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Hi , we miss you');
    (f.getByRole('textbox', { name: 'English text' }) as HTMLTextAreaElement).setSelectionRange(3, 3);
    await user.click(f.getByRole('button', { name: 'Insert {name} in the English text' }));

    // The live preview asks the campaign preview with the audience and the text.
    await waitFor(() =>
      expect(api.find('POST', '/admin/sms-campaigns/preview').at(-1)!.body).toEqual({
        kind: 'RECURRING',
        audience: { group: 'LAPSED', days: 14 },
        fallback_language: 'en',
        messages: { en: 'Hi {name}, we miss you' },
      })
    );
    expect(await screen.findByRole('complementary', { name: 'Preview' })).toHaveTextContent('Recipients12');

    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0]!.body).toEqual({
      kind: 'RECURRING',
      name: 'Friday reminder',
      audience: { group: 'LAPSED', days: 14 },
      fallback_language: 'en',
      messages: { en: 'Hi {name}, we miss you' },
      schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['mon', 'fri'], ends_on: '2099-01-31' },
    });
    expect(await screen.findByText('Created "Friday reminder".')).toBeInTheDocument();
    // The form closes and the list is asked again.
    expect(screen.queryByRole('form', { name: 'New repeating campaign' })).toBeNull();
    expect(api.find('GET', '/admin/sms-campaigns').length).toBeGreaterThanOrEqual(2);
  });

  it('creates a MONTHLY and a DAILY repeating campaign, with a custom audience', async () => {
    const user = userEvent.setup();
    const api = setup((c) => (c.method === 'POST' && c.path === '/admin/sms-campaigns' ? ok({ campaign: campaign({ id: 'new' }) }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'New repeating campaign' }));
    let f = formNamed('New repeating campaign');
    await user.type(f.getByLabelText('Name'), 'Payday');
    await user.selectOptions(f.getByLabelText('Send to'), 'CUSTOM');
    await user.type(f.getByLabelText('Minimum orders'), '3');
    await user.selectOptions(f.getByLabelText('Repeat'), 'MONTHLY');
    await user.clear(f.getByLabelText('Day of the month'));
    await user.type(f.getByLabelText('Day of the month'), '25');
    fireEvent.change(f.getByLabelText('At'), { target: { value: '10:15' } });
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Payday offers {app_link}');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0]!.body).toEqual({
      kind: 'RECURRING',
      name: 'Payday',
      audience: { group: 'CUSTOM', min_orders: 3 },
      fallback_language: 'en',
      messages: { en: 'Payday offers {app_link}' },
      schedule: { frequency: 'MONTHLY', time: '10:15', month_day: 25 },
    });

    await user.click(await screen.findByRole('button', { name: 'New repeating campaign' }));
    f = formNamed('New repeating campaign');
    await user.type(f.getByLabelText('Name'), 'Every morning');
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Good morning');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(2));
    expect(api.find('POST', '/admin/sms-campaigns')[1]!.body).toEqual({
      kind: 'RECURRING',
      name: 'Every morning',
      audience: { group: 'ALL' },
      fallback_language: 'en',
      messages: { en: 'Good morning' },
      schedule: { frequency: 'DAILY', time: '09:00' },
    });
  });

  it.each([
    [
      'DAYS_AFTER_LAST_ORDER',
      async (f: ReturnType<typeof formNamed>, user: ReturnType<typeof userEvent.setup>) => {
        await user.clear(f.getByLabelText('Days'));
        await user.type(f.getByLabelText('Days'), '5');
      },
      { trigger: 'DAYS_AFTER_LAST_ORDER', days: 5, time: '10:00' },
    ],
    [
      'DAYS_AFTER_SIGNUP',
      async (f: ReturnType<typeof formNamed>, user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(f.getByLabelText('Send'), 'DAYS_AFTER_SIGNUP');
        await user.clear(f.getByLabelText('Days'));
        await user.type(f.getByLabelText('Days'), '3');
        await user.click(f.getByRole('switch', { name: 'Only if they have not ordered' }));
      },
      { trigger: 'DAYS_AFTER_SIGNUP', days: 3, time: '10:00', only_if_never_ordered: true },
    ],
    [
      'NO_ORDER_FOR_DAYS',
      async (f: ReturnType<typeof formNamed>, user: ReturnType<typeof userEvent.setup>) => {
        await user.selectOptions(f.getByLabelText('Send'), 'NO_ORDER_FOR_DAYS');
        await user.clear(f.getByLabelText('Days'));
        await user.type(f.getByLabelText('Days'), '45');
        await user.clear(f.getByLabelText('Cooldown days'));
        await user.type(f.getByLabelText('Cooldown days'), '60');
      },
      { trigger: 'NO_ORDER_FOR_DAYS', days: 45, time: '10:00', cooldown_days: 60 },
    ],
  ])('creates an automatic %s campaign with the exact request body and previews who it would text today', async (_kind, fill, schedule) => {
    const user = userEvent.setup();
    const api = setup((c) => (c.method === 'POST' && c.path === '/admin/sms-campaigns' ? ok({ campaign: campaign({ id: 'new', kind: 'TRIGGER' }) }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'New automatic campaign' }));
    const f = formNamed('New automatic campaign');
    expect(f.queryByLabelText('Send to')).toBeNull();
    await user.type(f.getByLabelText('Name'), 'Automatic text');
    await fill(f, user);
    fireEvent.change(f.getByLabelText('Check at'), { target: { value: '10:00' } });
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Hello {name}');

    await waitFor(() =>
      expect(api.find('POST', '/admin/sms-campaigns/preview').at(-1)!.body).toEqual({
        kind: 'TRIGGER',
        fallback_language: 'en',
        messages: { en: 'Hello {name}' },
        schedule,
      })
    );
    expect(screen.getByRole('heading', { name: 'Who it would text today' })).toBeInTheDocument();

    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0]!.body).toEqual({
      kind: 'TRIGGER',
      name: 'Automatic text',
      fallback_language: 'en',
      messages: { en: 'Hello {name}' },
      schedule,
    });
  });

  it('writes a text per language when the languages are on, with the fallback language', async () => {
    languages = ['si', 'ta', 'en'];
    const user = userEvent.setup();
    const api = setup((c) => (c.method === 'POST' && c.path === '/admin/sms-campaigns' ? ok({ campaign: campaign({ id: 'new', kind: 'TRIGGER' }) }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'New automatic campaign' }));
    const f = formNamed('New automatic campaign');
    await user.type(f.getByLabelText('Name'), 'Three languages');
    const sinhala = await f.findByRole('textbox', { name: 'Sinhala text' });
    await user.click(sinhala);
    await user.paste('සිංහල {name}');
    await user.click(f.getByRole('textbox', { name: 'Tamil text' }));
    await user.paste('தமிழ் {name}');
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('English {name}');
    await user.selectOptions(f.getByLabelText('Customers without a language get'), 'si');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0]!.body).toMatchObject({
      kind: 'TRIGGER',
      fallback_language: 'si',
      messages: { si: 'සිංහල {name}', ta: 'தமிழ் {name}', en: 'English {name}' },
    });
  });

  it('explains what is missing before sending anything, and shows the API refusal', async () => {
    const user = userEvent.setup();
    const api = setup((c) =>
      c.method === 'POST' && c.path === '/admin/sms-campaigns'
        ? fail(400, 'UNKNOWN_PLACEHOLDER', '{nam} is not a placeholder.', { unknown: ['{nam}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] })
        : undefined
    );
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'New repeating campaign' }));
    const f = formNamed('New repeating campaign');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    expect(await f.findByRole('alert')).toHaveTextContent('Give the campaign a name.');
    await user.type(f.getByLabelText('Name'), 'Weekly');
    await user.selectOptions(f.getByLabelText('Repeat'), 'WEEKLY');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    expect(await f.findByText('Choose at least one weekday.')).toBeInTheDocument();
    await user.click(f.getByRole('button', { name: 'Tuesday' }));
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    expect(await f.findByText('Write the English text: customers who have not picked a language get it.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(0);

    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Hello {nam}');
    await user.click(f.getByRole('button', { name: 'Create campaign' }));
    expect(await f.findByText('{nam} is not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.')).toBeInTheDocument();
    // The form stays open with what was typed.
    expect(f.getByLabelText('Name')).toHaveValue('Weekly');
  });

  it('pauses, resumes and cancels a campaign, each after a confirmation', async () => {
    const user = userEvent.setup();
    campaigns = [campaign(), campaign({ id: 'c2', name: 'Welcome back', status: 'PAUSED', next_run_at: null })];
    const api = setup((c) => {
      const m = /^\/admin\/sms-campaigns\/(c\d)\/(pause|resume|cancel)$/.exec(c.path);
      if (c.method === 'POST' && m) {
        const status = m[2] === 'pause' ? 'PAUSED' : m[2] === 'resume' ? 'ACTIVE' : 'CANCELLED';
        campaigns = campaigns.map((x) => (x.id === m[1] ? { ...x, status: status as SmsCampaign['status'] } : x));
        return ok({ campaign: { ...campaigns.find((x) => x.id === m[1])!, runs: [] } });
      }
      return undefined;
    });
    await openTab(user, 'Scheduled and automatic');

    // Pause: the dialog first; "Cancel" in it changes nothing.
    await user.click(await screen.findByRole('button', { name: 'Pause Friday reminder' }));
    let dialog = screen.getByRole('dialog', { name: 'Pause campaign' });
    expect(dialog).toHaveTextContent('Pause "Friday reminder"? Nothing is sent while it is paused.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('POST', '/admin/sms-campaigns/c1/pause')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Pause Friday reminder' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Pause campaign' })).getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns/c1/pause')).toHaveLength(1));
    expect(await screen.findByText('Paused "Friday reminder".')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume Friday reminder' })).toBeInTheDocument();

    // Resume the other one.
    await user.click(screen.getByRole('button', { name: 'Resume Welcome back' }));
    dialog = screen.getByRole('dialog', { name: 'Resume campaign' });
    expect(dialog).toHaveTextContent('Runs missed while it was paused are not made up.');
    await user.click(within(dialog).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns/c2/resume')).toHaveLength(1));
    expect(await screen.findByText('Resumed "Welcome back".')).toBeInTheDocument();

    // Cancel is final and says so.
    await user.click(screen.getByRole('button', { name: 'Cancel Friday reminder' }));
    dialog = screen.getByRole('dialog', { name: 'Cancel campaign' });
    expect(dialog).toHaveTextContent('It will not run again and cannot be started again.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns/c1/cancel')).toHaveLength(1));
    expect(await screen.findByText('Cancelled "Friday reminder".')).toBeInTheDocument();
    const cancelled = within(await card('Friday reminder'));
    expect(cancelled.getByText('Cancelled')).toBeInTheDocument();
    expect(cancelled.queryByRole('button', { name: /^Cancel/ })).toBeNull();
    // Every change is followed by a fresh list.
    expect(api.find('GET', '/admin/sms-campaigns').length).toBeGreaterThanOrEqual(4);
  });

  it('shows the API refusal when a campaign cannot be paused', async () => {
    const user = userEvent.setup();
    campaigns = [campaign()];
    setup((c) => (c.method === 'POST' && c.path === '/admin/sms-campaigns/c1/pause' ? fail(409, 'CAMPAIGN_NOT_ACTIVE', 'This campaign is already paused.') : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'Pause Friday reminder' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Pause campaign' })).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This campaign is already paused.');
  });

  it('edits a campaign: the form is filled in and the changes go in one PATCH', async () => {
    const user = userEvent.setup();
    campaigns = [campaign()];
    const api = setup((c) => (c.method === 'PATCH' && c.path === '/admin/sms-campaigns/c1' ? ok({ campaign: { ...campaign(), runs: [] } }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'Edit Friday reminder' }));
    const f = formNamed('Edit campaign');
    expect(f.getByLabelText('Name')).toHaveValue('Friday reminder');
    expect(f.getByLabelText('Send to')).toHaveValue('LAPSED');
    expect(f.getByLabelText('Repeat')).toHaveValue('WEEKLY');
    expect(f.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    expect(f.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'false');
    expect(f.getByLabelText('At')).toHaveValue('18:00');
    expect(f.getByRole('textbox', { name: 'English text' })).toHaveValue('Hi {name}, we miss you');

    await user.clear(f.getByLabelText('Name'));
    await user.type(f.getByLabelText('Name'), 'Weekend reminder');
    await user.click(f.getByRole('button', { name: 'Saturday' }));
    await user.click(f.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sms-campaigns/c1')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sms-campaigns/c1')[0]!.body).toEqual({
      name: 'Weekend reminder',
      fallback_language: 'en',
      messages: { en: 'Hi {name}, we miss you' },
      audience: { group: 'LAPSED', days: 14 },
      schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri', 'sat'] },
    });
    expect(await screen.findByText('Saved "Weekend reminder". The changes apply to its next runs.')).toBeInTheDocument();
  });

  it('edits an automatic campaign without an audience, and a scheduled offer with its time', async () => {
    const user = userEvent.setup();
    campaigns = [
      campaign({
        id: 'c2',
        name: 'Welcome',
        kind: 'TRIGGER',
        audience: { group: 'ALL' },
        audience_label: null,
        schedule: { trigger: 'DAYS_AFTER_SIGNUP', days: 3, time: '10:00', only_if_never_ordered: true },
      }),
      campaign({ id: 'c3', name: 'December offer', kind: 'ONCE', audience: { group: 'ALL' }, schedule: { send_at: '2099-12-01T12:30:00.000Z' } }),
    ];
    const api = setup((c) => (c.method === 'PATCH' ? ok({ campaign: { ...campaign(), runs: [] } }) : undefined));
    await openTab(user, 'Scheduled and automatic');
    await user.click(await screen.findByRole('button', { name: 'Edit Welcome' }));
    let f = formNamed('Edit campaign');
    expect(f.queryByLabelText('Send to')).toBeNull();
    expect(f.getByLabelText('Send')).toHaveValue('DAYS_AFTER_SIGNUP');
    expect(f.getByRole('switch', { name: 'Only if they have not ordered' })).toHaveAttribute('aria-checked', 'true');
    await user.clear(f.getByLabelText('Days'));
    await user.type(f.getByLabelText('Days'), '4');
    await user.click(f.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sms-campaigns/c2')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sms-campaigns/c2')[0]!.body).toEqual({
      name: 'Welcome',
      fallback_language: 'en',
      messages: { en: 'Hi {name}, we miss you' },
      schedule: { trigger: 'DAYS_AFTER_SIGNUP', days: 4, time: '10:00', only_if_never_ordered: true },
    });

    await user.click(await screen.findByRole('button', { name: 'Edit December offer' }));
    f = formNamed('Edit campaign');
    expect(f.getByLabelText('Send at')).toHaveValue('2099-12-01T18:00');
    fireEvent.change(f.getByLabelText('Send at'), { target: { value: '2099-12-02T09:15' } });
    await user.click(f.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sms-campaigns/c3')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sms-campaigns/c3')[0]!.body).toMatchObject({
      audience: { group: 'ALL' },
      schedule: { send_at: '2099-12-02T09:15:00+05:30' },
    });
  });

  it('shows the run history of a campaign', async () => {
    const user = userEvent.setup();
    campaigns = [campaign()];
    const api = setup((c) =>
      c.method === 'GET' && c.path === '/admin/sms-campaigns/c1'
        ? ok({
            campaign: {
              ...campaign(),
              runs: [run(), run({ id: 'r2', ran_at: '2026-10-23T12:30:05.000Z', status: 'BLOCKED_BUDGET', recipients: 0, sms_parts: 0, skipped_opted_out: 0, skipped_capped: 0, skipped_no_phone: 0, reason: 'Monthly budget used up' })],
            },
          })
        : undefined
    );
    await openTab(user, 'Scheduled and automatic');
    const c = within(await card('Friday reminder'));
    await user.click(c.getByRole('button', { name: 'Show runs of Friday reminder' }));
    const table = await c.findByRole('table', { name: 'Runs of Friday reminder' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('30 Oct 2026 18:00');
    expect(first).toHaveTextContent('Sent');
    expect(first).toHaveTextContent('40');
    expect(first).toHaveTextContent('44');
    expect(first).toHaveTextContent('3 already got their share, 2 opted out, 1 no usable number');
    expect(second).toHaveTextContent('Skipped: monthly budget used up');
    expect(second).toHaveTextContent('Monthly budget used up');
    expect(api.find('GET', '/admin/sms-campaigns/c1')).toHaveLength(1);
    await user.click(c.getByRole('button', { name: 'Hide runs of Friday reminder' }));
    expect(c.queryByRole('table')).toBeNull();
  });
});

describe('Templates tab', () => {
  it('lists templates, creates one, edits one and deletes one', async () => {
    const user = userEvent.setup();
    templates = [template(), template({ id: 't2', name: 'Fish day', messages: { si: 'මාළු', ta: null, en: 'Fish is fresh' } })];
    const api = setup((c) => {
      if (c.method === 'POST' && c.path === '/admin/sms-templates') return ok({ template: template({ id: 't3' }) });
      if (c.method === 'PUT' && c.path === '/admin/sms-templates/t1') return ok({ template: template() });
      if (c.method === 'DELETE' && c.path === '/admin/sms-templates/t2') return ok({ deleted: true });
      return undefined;
    });
    await openTab(user, 'Templates');
    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('Weekend rice');
    expect(list).toHaveTextContent('EnglishRice 10% off, {name}');
    expect(list).toHaveTextContent('Sinhalaමාළු');
    expect(list).toHaveTextContent('Saved by Nawaz Mansoor.');

    // New.
    await user.click(screen.getByRole('button', { name: 'New template' }));
    const f = formNamed('New template');
    await user.click(f.getByRole('button', { name: 'Save template' }));
    expect(await f.findByRole('alert')).toHaveTextContent('Give the template a name.');
    await user.type(f.getByLabelText('Template name'), 'Poya day');
    await user.click(f.getByRole('button', { name: 'Save template' }));
    expect(await f.findByRole('alert')).toHaveTextContent('Write at least one text.');
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Hello {name}, {app_link}');
    await user.click(f.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-templates')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-templates')[0]!.body).toEqual({ name: 'Poya day', messages: { en: 'Hello {name}, {app_link}' } });
    expect(await screen.findByText('Saved the template "Poya day".')).toBeInTheDocument();

    // Edit.
    await user.click(screen.getByRole('button', { name: 'Edit Weekend rice' }));
    const e = formNamed('Edit template');
    expect(e.getByLabelText('Template name')).toHaveValue('Weekend rice');
    expect(e.getByRole('textbox', { name: 'English text' })).toHaveValue('Rice 10% off, {name}');
    await user.clear(e.getByLabelText('Template name'));
    await user.type(e.getByLabelText('Template name'), 'Weekend offer');
    await user.click(e.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(api.find('PUT', '/admin/sms-templates/t1')).toHaveLength(1));
    expect(api.find('PUT', '/admin/sms-templates/t1')[0]!.body).toEqual({ name: 'Weekend offer', messages: { en: 'Rice 10% off, {name}' } });

    // Delete, after a confirmation.
    await user.click(screen.getByRole('button', { name: 'Delete Fish day' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete template' });
    expect(dialog).toHaveTextContent('Campaigns that already use its text keep their own copy.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.find('DELETE', '/admin/sms-templates/t2')).toHaveLength(1));
    expect(await screen.findByText('Deleted the template "Fish day".')).toBeInTheDocument();
  });

  it('shows the API refusal when a template text has an unknown placeholder', async () => {
    const user = userEvent.setup();
    setup((c) =>
      c.method === 'POST' && c.path === '/admin/sms-templates'
        ? fail(400, 'UNKNOWN_PLACEHOLDER', '{x} is not a placeholder.', { unknown: ['{x}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] })
        : undefined
    );
    await openTab(user, 'Templates');
    await user.click(await screen.findByRole('button', { name: 'New template' }));
    const f = formNamed('New template');
    await user.type(f.getByLabelText('Template name'), 'Bad');
    await user.click(f.getByRole('textbox', { name: 'English text' }));
    await user.paste('Hi {x}');
    await user.click(f.getByRole('button', { name: 'Save template' }));
    expect(await f.findByRole('alert')).toHaveTextContent('{x} is not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.');
  });
});
