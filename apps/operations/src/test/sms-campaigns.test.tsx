import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type {
  SmsCampaign,
  SmsCampaignRun,
  SmsHistoryItem,
  SmsLanguage,
  SmsLimitRules,
  SmsOfferEstimate,
  SmsSendingRules,
  SmsTemplate,
} from '../api/types';
import { colomboInputValue } from '../lib/smsCampaigns';
import { OPERATIONS_STAFF, moreSettings, ok, renderAs, type Call } from './helpers';

/**
 * More -> SMS offers, 2026-11-03 (owner's brother: no time limits, fully customised text, schedules and
 * automatic SMS): the four tabs (Send, Scheduled and automatic, History, Templates), placeholders,
 * templates, the custom audience, the live preview, schedule, campaigns and the SMS sending rules card.
 * The backend (backend/api/tests) guards the rules; these tests cover what the screens show and send.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

type Handlers = Record<string, (call: Call) => unknown>;

const PLACEHOLDERS = {
  placeholders: [
    { token: '{name}', description: "The customer's first name", example: 'Nimal' },
    { token: '{points}', description: 'Blynk Points the customer holds', example: '120' },
    { token: '{wallet}', description: 'Blynk Wallet balance', example: 'LKR 1,250' },
    { token: '{app_link}', description: 'Link to the Blynk app', example: 'https://blynk.lk/app' },
  ],
  max_chars: 480,
  languages: ['si', 'ta', 'en'],
};

const TEMPLATE: SmsTemplate = {
  id: 't1',
  name: 'Friday vegetables',
  messages: { si: null, ta: null, en: 'Hi {name}, fresh vegetables today. {app_link}' },
  created_by_name: 'Ops Person',
  created_at: '2026-11-01T04:00:00.000Z',
  updated_at: '2026-11-02T04:00:00.000Z',
};

const AREAS = [
  { name: 'Beruwala', customers: 40 },
  { name: 'Colombo', customers: 25 },
  { name: 'Dehiwala', customers: 9 },
];

/** A fake estimate shaped like the backend's, English only unless `languages` says otherwise. */
function estimateFor(call: Call, extra: Partial<SmsOfferEstimate> = {}, languages: SmsLanguage[] = ['en']): { estimate: SmsOfferEstimate } {
  const messages: Partial<Record<SmsLanguage, string>> = call.body.messages ?? {};
  return {
    estimate: {
      audience: call.body.audience ?? 'ALL',
      recipients: 10,
      by_language: { si: 0, ta: 0, en: 10 },
      without_language: 2,
      opted_out: 3,
      parts_per_sms: messages.en ? { en: 1 } : {},
      sms_parts_total: messages.en ? 10 : 0,
      missing_languages: messages.en ? [] : ['en'],
      languages,
      ...extra,
    },
  };
}

const RUN: SmsCampaignRun = {
  id: 'r1',
  campaign_id: 'c1',
  scheduled_for: '2026-10-30T12:30:00.000Z',
  ran_at: '2026-10-30T12:30:05.000Z',
  status: 'SENT',
  recipients: 40,
  sms_parts: 44,
  skipped_opted_out: 3,
  skipped_capped: 2,
  skipped_no_phone: 0,
  reason: null,
};

const WEEKLY: SmsCampaign = {
  id: 'c1',
  name: 'Friday vegetables',
  kind: 'RECURRING',
  status: 'ACTIVE',
  audience: { group: 'LAPSED', days: 14 },
  audience_label: "Haven't ordered in 14 days",
  fallback_language: 'en',
  messages: { si: null, ta: null, en: 'Fresh vegetables today, {name}!' },
  schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri'], starts_on: null, ends_on: null },
  schedule_label: 'Every Fri at 18:00',
  next_run_at: '2026-11-06T12:30:00.000Z',
  last_run_at: '2026-10-30T12:30:05.000Z',
  run_count: 3,
  recipients_total: 120,
  sms_parts_total: 132,
  last_run: RUN,
  created_by: 'u1',
  created_by_name: 'Ops Person',
  created_at: '2026-10-20T04:00:00.000Z',
  updated_at: '2026-10-20T04:00:00.000Z',
  cancelled_at: null,
};

const TRIGGER: SmsCampaign = {
  ...WEEKLY,
  id: 'c2',
  name: 'Come back',
  kind: 'TRIGGER',
  status: 'PAUSED',
  audience: { group: 'ALL' },
  audience_label: null,
  messages: { si: null, ta: null, en: 'We miss you {name}' },
  schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 21, time: '10:00', cooldown_days: 30 },
  schedule_label: 'Checked daily at 10:00: No order for 21 days (again after 30 days at most)',
  next_run_at: null,
  run_count: 0,
  recipients_total: 0,
  sms_parts_total: 0,
  last_run: null,
  last_run_at: null,
};

function open(handlers: Handlers = {}, route = '/more/sms-offers') {
  return renderAs(OPERATIONS_STAFF, route, {
    'GET /admin/sms-offers': () => ok({ offers: [] }),
    'POST /admin/sms-offers/estimate': (call) => ok(estimateFor(call)),
    'GET /admin/sms-placeholders': () => ok(PLACEHOLDERS),
    'GET /admin/sms-templates': () => ok({ templates: [TEMPLATE] }),
    'GET /admin/sms-offers/areas': () => ok({ areas: AREAS }),
    'GET /admin/sms-campaigns/history': () => ok({ items: [] }),
    'GET /admin/sms-campaigns': () => ok({ campaigns: [] }),
    'POST /admin/sms-campaigns/preview': (call) => ok({ preview: estimateFor(call).estimate }),
    ...handlers,
  });
}

const tab = (name: string) => screen.findByRole('tab', { name });
const sendButton = () => screen.getByRole('button', { name: 'Send offer' });
const english = () => screen.getByLabelText(/^English text/, { selector: 'textarea' });
const lastEstimateBody = (api: ReturnType<typeof open>['api']) => api.find('POST', '/admin/sms-offers/estimate').at(-1)?.body;
const aborted = (code: string, message: string, details?: unknown, status = 400) => ({ status, error: { code, message, details } });

describe('SMS offers tabs', () => {
  it('shows Send, Scheduled and automatic, History and Templates as chips; Send is open and the others fetch nothing yet', async () => {
    const { api } = open();
    const list = await screen.findByRole('tablist', { name: 'SMS offers' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Send', 'Scheduled and automatic', 'History', 'Templates']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Send to')).toBeInTheDocument();
    expect(api.find('GET', '/admin/sms-campaigns')).toHaveLength(0);
    expect(api.find('GET', '/admin/sms-campaigns/history')).toHaveLength(0);
    // the Send tab loads the saved templates and placeholders for its pickers
    await waitFor(() => expect(api.find('GET', '/admin/sms-templates')).toHaveLength(1));
    expect(api.find('GET', '/admin/sms-placeholders')).toHaveLength(1);
  });

  it('each tab shows its own content, and the Send form keeps a half-written offer', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'GET /admin/sms-campaigns': () => ok({ campaigns: [WEEKLY] }),
      'GET /admin/sms-campaigns/history': () =>
        ok({
          items: [
            {
              type: 'CAMPAIGN_RUN',
              id: 'r1',
              at: '2026-10-30T12:30:05.000Z',
              name: 'Friday vegetables',
              campaign_id: 'c1',
              campaign_kind: 'RECURRING',
              status: 'SENT',
              recipients: 40,
              sms_parts: 44,
              skipped_opted_out: 3,
              skipped_capped: 2,
              skipped_no_phone: 0,
              reason: null,
              audience_label: null,
              sent_by_name: null,
              messages: null,
            } satisfies SmsHistoryItem,
          ],
        }),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Half written' } });

    await user.click(await tab('Scheduled and automatic'));
    expect(await screen.findByRole('list', { name: 'Scheduled and automatic SMS' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scheduled and automatic' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Send offer' })).toBeNull();

    await user.click(await tab('History'));
    const history = await screen.findByRole('list', { name: 'SMS history' });
    expect(history).toHaveTextContent('Friday vegetables');
    expect(history).toHaveTextContent('Scheduled run');
    expect(history).toHaveTextContent('40 customers · 44 SMS parts');
    expect(history).toHaveTextContent('Skipped: 3 turned offers off, 2 already got enough texts');
    expect(screen.queryByRole('list', { name: 'Scheduled and automatic SMS' })).toBeNull();

    await user.click(await tab('Templates'));
    expect(await screen.findByRole('list', { name: 'Templates' })).toHaveTextContent('Friday vegetables');

    await user.click(await tab('Send'));
    expect(english()).toHaveValue('Half written');
    // opening the other tabs fetched once each, and Send did not refetch its history
    expect(api.find('GET', '/admin/sms-campaigns')).toHaveLength(1);
    expect(api.find('GET', '/admin/sms-campaigns/history')).toHaveLength(1);
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    open();
    const tabs = await screen.findAllByRole('tab');
    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{End}');
    await waitFor(() => expect(tabs[3]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
  });
});

describe('Send: placeholders and templates', () => {
  it('inserts {name} {points} {wallet} {app_link} where the cursor is, and shows an example', async () => {
    const user = userEvent.setup();
    open();
    const box = await screen.findByLabelText(/^English text/, { selector: 'textarea' });
    fireEvent.change(box, { target: { value: 'Hi , you have points' } });
    (box as HTMLTextAreaElement).setSelectionRange(3, 3);
    await user.click(screen.getByRole('button', { name: 'Insert {name} into the English text' }));
    expect(box).toHaveValue('Hi {name}, you have points');
    // the cursor sits after the inserted word, so the next one goes after it
    await user.click(screen.getByRole('button', { name: 'Insert {points} into the English text' }));
    expect(box).toHaveValue('Hi {name}{points}, you have points');
    await user.click(screen.getByRole('button', { name: 'Insert {wallet} into the English text' }));
    await user.click(screen.getByRole('button', { name: 'Insert {app_link} into the English text' }));
    expect(box).toHaveValue('Hi {name}{points}{wallet}{app_link}, you have points');
    expect(screen.getByLabelText('English SMS preview').textContent).toBe('Hi Nimal120LKR 1,250https://blynk.lk/app, you have points');
    expect(screen.getByText(/Example: a customer called Nimal with 120 points/)).toBeInTheDocument();
    // the count is worked out on the longest the text can get once filled in
    expect(screen.getByTestId('sms-count-en')).toHaveTextContent(/up to \d+ characters filled in/);
  });

  it('refuses a placeholder that does not exist: says so, counts nobody and keeps Send off', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const box = await screen.findByLabelText(/^English text/, { selector: 'textarea' });
    await waitFor(() => expect(api.find('POST', '/admin/sms-offers/estimate').length).toBeGreaterThan(0));
    const before = api.find('POST', '/admin/sms-offers/estimate').length;
    fireEvent.change(box, { target: { value: 'Hello {nme}' } });
    expect(await screen.findByText('{nme} is not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 600));
    expect(api.find('POST', '/admin/sms-offers/estimate')).toHaveLength(before);
    await user.clear(box);
    await user.type(box, 'Hello {{name}');
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it('flags a text that is too long once the name, points and wallet are filled in', async () => {
    open();
    const box = await screen.findByLabelText(/^English text/, { selector: 'textarea' });
    // 460 letters is fine on its own, but {app_link} (20 chars) x 3 and {name} (up to 20) push it over 480
    fireEvent.change(box, { target: { value: `${'a'.repeat(440)} {name} {name} {name}` } });
    expect(await screen.findByText(/This can be up to \d+ characters once the name, points and wallet are filled in/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('picks a saved template into the text box', async () => {
    const user = userEvent.setup();
    const { api } = open();
    const picker = await screen.findByLabelText('Use a saved template');
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Friday vegetables' })).toBeInTheDocument());
    await user.selectOptions(picker, 't1');
    expect(english()).toHaveValue('Hi {name}, fresh vegetables today. {app_link}');
    await waitFor(() =>
      expect(lastEstimateBody(api)).toEqual({
        audience: 'ALL',
        fallback_language: 'en',
        messages: { en: 'Hi {name}, fresh vegetables today. {app_link}' },
      })
    );
  });

  it('saves the written texts as a template and refreshes the picker', async () => {
    const user = userEvent.setup();
    let saved = false;
    const created: SmsTemplate = { ...TEMPLATE, id: 't2', name: 'Weekend sale', messages: { si: null, ta: null, en: 'Weekend sale {name}' } };
    const { api } = open({
      'GET /admin/sms-templates': () => ok({ templates: saved ? [TEMPLATE, created] : [TEMPLATE] }),
      'POST /admin/sms-templates': () => {
        saved = true;
        return { status: 201, data: { template: created } };
      },
    });
    expect(await screen.findByRole('button', { name: 'Save as template' })).toBeDisabled();
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: '  Weekend sale {name}  ' } });
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the template a name.');
    await user.type(screen.getByLabelText('Template name'), 'Weekend sale');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Saved as "Weekend sale".')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-templates')[0].body).toEqual({ name: 'Weekend sale', messages: { en: 'Weekend sale {name}' } });
    await waitFor(() => expect(within(screen.getByLabelText('Use a saved template')).getByRole('option', { name: 'Weekend sale' })).toBeInTheDocument());
  });

  it('shows the server reason when a template cannot be saved', async () => {
    const user = userEvent.setup();
    open({ 'POST /admin/sms-templates': () => aborted('TEMPLATE_NAME_TAKEN', 'A template with this name already exists.', undefined, 409) });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Rice 10% off' } });
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    await user.type(screen.getByLabelText('Template name'), 'Friday vegetables');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A template with this name already exists.');
  });
});

describe('Send: custom audience', () => {
  it('builds the CUSTOM audience from every filter, with areas picked from the list', async () => {
    const user = userEvent.setup();
    const { api } = open();
    await user.click(await screen.findByRole('radio', { name: 'Custom filters' }));
    // plain customers count first: nothing is filled in
    await waitFor(() => expect(lastEstimateBody(api).audience).toEqual({ group: 'CUSTOM' }));

    const filters = screen.getByRole('group', { name: 'Custom filters' });
    await user.click(await within(filters).findByRole('checkbox', { name: /^Colombo/ }));
    await user.click(within(filters).getByRole('checkbox', { name: /^Beruwala/ }));
    fireEvent.change(within(filters).getByLabelText('Orders (at least)'), { target: { value: '1' } });
    fireEvent.change(within(filters).getByLabelText('Orders (at most)'), { target: { value: '5' } });
    fireEvent.change(within(filters).getByLabelText('Spent at least (LKR)'), { target: { value: '5000' } });
    fireEvent.change(within(filters).getByLabelText('Spent in the last (days)'), { target: { value: '30' } });
    await user.selectOptions(within(filters).getByLabelText('SMS language'), 'si');
    fireEvent.change(within(filters).getByLabelText('Points (at least)'), { target: { value: '50' } });
    fireEvent.change(within(filters).getByLabelText('Points (at most)'), { target: { value: '900' } });
    fireEvent.change(within(filters).getByLabelText('Last order at least (days ago)'), { target: { value: '14' } });
    fireEvent.change(within(filters).getByLabelText('Last order at most (days ago)'), { target: { value: '60' } });

    await waitFor(() =>
      expect(lastEstimateBody(api)).toEqual({
        audience: {
          group: 'CUSTOM',
          areas: ['Colombo', 'Beruwala'],
          min_orders: 1,
          max_orders: 5,
          min_spend_lkr: 5000,
          spend_days: 30,
          language: 'si',
          min_points: 50,
          max_points: 900,
          last_order_days_min: 14,
          last_order_days_max: 60,
        },
        fallback_language: 'en',
        messages: {},
      })
    );
    expect(within(filters).getByText('Areas (2 picked)')).toBeInTheDocument();
    // the customer count follows
    expect(await screen.findByTestId('group-count')).toHaveTextContent('10 customers can get it');

    // sent with the same audience
    fireEvent.change(english(), { target: { value: 'Hi {name}' } });
    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it('searches the areas list, and unticking removes an area', async () => {
    const user = userEvent.setup();
    const { api } = open();
    await user.click(await screen.findByRole('radio', { name: 'Custom filters' }));
    const filters = screen.getByRole('group', { name: 'Custom filters' });
    await user.click(await within(filters).findByRole('checkbox', { name: /^Dehiwala/ }));
    await user.type(within(filters).getByLabelText('Search areas'), 'colo');
    expect(within(filters).queryByRole('checkbox', { name: /^Beruwala/ })).toBeNull();
    await user.click(within(filters).getByRole('checkbox', { name: /^Colombo/ }));
    await waitFor(() => expect(lastEstimateBody(api).audience).toEqual({ group: 'CUSTOM', areas: ['Dehiwala', 'Colombo'] }));
    await user.click(within(filters).getByRole('checkbox', { name: /^Colombo/ }));
    await waitFor(() => expect(lastEstimateBody(api).audience).toEqual({ group: 'CUSTOM', areas: ['Dehiwala'] }));
  });

  it('stops on a minimum above the maximum and counts nobody until it is fixed', async () => {
    const user = userEvent.setup();
    const { api } = open();
    await user.click(await screen.findByRole('radio', { name: 'Custom filters' }));
    await waitFor(() => expect(lastEstimateBody(api).audience).toEqual({ group: 'CUSTOM' }));
    const before = api.find('POST', '/admin/sms-offers/estimate').length;
    const filters = screen.getByRole('group', { name: 'Custom filters' });
    fireEvent.change(within(filters).getByLabelText('Points (at least)'), { target: { value: '500' } });
    fireEvent.change(within(filters).getByLabelText('Points (at most)'), { target: { value: '100' } });
    expect(await within(filters).findByRole('alert')).toHaveTextContent('Minimum points cannot be more than the maximum.');
    await new Promise((r) => setTimeout(r, 600));
    expect(api.find('POST', '/admin/sms-offers/estimate')).toHaveLength(before);
    fireEvent.change(within(filters).getByLabelText('Points (at most)'), { target: { value: '900' } });
    await waitFor(() => expect(lastEstimateBody(api).audience).toEqual({ group: 'CUSTOM', min_points: 500, max_points: 900 }));
  });

  it('refuses a number that is not whole', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('radio', { name: 'Custom filters' }));
    const filters = screen.getByRole('group', { name: 'Custom filters' });
    fireEvent.change(within(filters).getByLabelText('Orders (at least)'), { target: { value: '2.5' } });
    expect(await within(filters).findByRole('alert')).toHaveTextContent('Minimum orders must be a whole number from 0 to 100000.');
  });
});

describe('Send: live preview', () => {
  it('shows customers, who is left out, SMS parts, the budget and example texts', async () => {
    open({
      'POST /admin/sms-offers/estimate': (call) =>
        ok(
          estimateFor(
            call,
            {
              recipients: 9,
              by_language: { si: 2, ta: 3, en: 4 },
              skipped_capped: 5,
              skipped_no_phone: 1,
              sms_parts_total: 14,
              parts_per_sms: { si: 2, ta: 2, en: 1 },
              missing_languages: [],
              samples: [
                { language: 'en', text: 'Hi Nimal, fresh vegetables today.', parts: 1 },
                { language: 'si', text: 'හෙලෝ නිමල්', parts: 2 },
              ],
              budget: { monthly_parts: 5000, used_parts: 4900, remaining_parts: 100, would_exceed: false },
            },
            ['si', 'ta', 'en']
          )
        ),
    });
    expect(await screen.findByTestId('sms-recipients')).toHaveTextContent('9');
    expect(screen.getByText('In Sinhala').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('In Tamil').nextSibling).toHaveTextContent('3');
    expect(screen.getByText('In English').nextSibling).toHaveTextContent('4');
    expect(screen.getByText('Turned offers off').nextSibling).toHaveTextContent('3');
    expect(screen.getByTestId('sms-skipped-capped')).toHaveTextContent('5');
    expect(screen.getByText('Skipped: already got enough texts')).toBeInTheDocument();
    expect(screen.getByTestId('sms-skipped-no-phone')).toHaveTextContent('1');
    expect(screen.getByTestId('sms-parts-total')).toHaveTextContent('14');
    expect(screen.getByTestId('sms-budget-left')).toHaveTextContent('100 of 5000');
    const samples = screen.getByRole('list', { name: 'Example texts' });
    expect(samples).toHaveTextContent('Hi Nimal, fresh vegetables today.');
    expect(samples).toHaveTextContent('English · 1 SMS');
    expect(samples).toHaveTextContent('Sinhala · 2 SMS parts');
    expect(screen.queryByTestId('sms-budget-warning')).toBeNull();
  });

  it('warns when the send would use more than the budget left and does not allow sending now', async () => {
    open({
      'POST /admin/sms-offers/estimate': (call) =>
        ok(estimateFor(call, { sms_parts_total: 300, budget: { monthly_parts: 5000, used_parts: 4900, remaining_parts: 100, would_exceed: true } })),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Rice 10% off' } });
    const warning = await screen.findByTestId('sms-budget-warning');
    expect(warning).toHaveTextContent('needs about 300 SMS parts but only 100 are left in this month');
    expect(warning).toHaveTextContent('Raise the budget in SMS sending rules');
    expect(sendButton()).toBeDisabled();
  });

  it('shows the quiet hours message and holds Send now, but scheduling stays possible', async () => {
    const user = userEvent.setup();
    open({
      'POST /admin/sms-offers/estimate': (call) =>
        ok(
          estimateFor(call, {
            sending: {
              allowed: false,
              code: 'QUIET_HOURS',
              message: 'SMS are not sent between 10:00 PM and 7:00 AM (quiet hours in SMS sending rules).',
              resume_at: '2026-11-04T01:30:00.000Z',
            },
          })
        ),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Rice 10% off' } });
    const note = await screen.findByTestId('sms-sending-blocked');
    expect(note).toHaveTextContent('SMS are not sent between 10:00 PM and 7:00 AM');
    expect(note).toHaveTextContent('Sending is allowed again at 4 Nov 2026');
    expect(sendButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Schedule for' }));
    fireEvent.change(screen.getByLabelText('Send at (Sri Lanka time)'), { target: { value: colomboInputValue(Date.now() + 5 * 86_400_000) } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Schedule offer' })).toBeEnabled());
  });
});

describe('Send: schedule', () => {
  it('schedules the offer with send_at on the Colombo clock, after a confirmation', async () => {
    const user = userEvent.setup();
    const at = colomboInputValue(Date.now() + 30 * 86_400_000);
    const { api } = open({
      'POST /admin/sms-offers': () => ({
        status: 201,
        data: { campaign: { ...WEEKLY, id: 'c9', kind: 'ONCE', name: 'Scheduled offer', schedule_label: 'Once, 5 Dec 2026, 6:00 PM' } },
      }),
    });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: ' Rice 10% off ' } });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Schedule for' }));
    // no time yet: nothing to schedule
    expect(screen.getByRole('button', { name: 'Schedule offer' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Send at (Sri Lanka time)'), { target: { value: at } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Schedule offer' })).toBeEnabled());
    // the estimate is the same as for an offer now: no send_at in it
    expect(lastEstimateBody(api)).not.toHaveProperty('send_at');
    await user.click(screen.getByRole('button', { name: 'Schedule offer' }));
    const dialog = screen.getByRole('dialog', { name: 'Schedule offer' });
    expect(dialog).toHaveTextContent('(Sri Lanka time)');
    expect(dialog).toHaveTextContent('counted again at send time');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText(/^Scheduled: Once, 5 Dec 2026, 6:00 PM/)).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-offers')[0].body).toEqual({
      audience: 'ALL',
      fallback_language: 'en',
      messages: { en: 'Rice 10% off' },
      send_at: `${at}:00+05:30`,
    });
    expect(english()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeInTheDocument();
  });

  it('does not accept a time in the past or more than a year away', async () => {
    const user = userEvent.setup();
    open();
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Rice 10% off' } });
    await user.click(screen.getByRole('button', { name: 'Schedule for' }));
    const when = screen.getByLabelText('Send at (Sri Lanka time)');
    fireEvent.change(when, { target: { value: '2020-01-01T10:00' } });
    expect(await screen.findByText('Pick a time in the future.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule offer' })).toBeDisabled();
    fireEvent.change(when, { target: { value: colomboInputValue(Date.now() + 400 * 86_400_000) } });
    expect(await screen.findByText('Pick a time within the next year.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schedule offer' })).toBeDisabled();
  });
});

describe('Send: errors', () => {
  async function sendWith(reply: unknown) {
    const user = userEvent.setup();
    open({ 'POST /admin/sms-offers': () => reply });
    fireEvent.change(await screen.findByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Rice 10% off' } });
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    return screen.findByRole('alert');
  }

  it('SMS_BUDGET_EXCEEDED says how many parts are needed and left', async () => {
    const alert = await sendWith(
      aborted('SMS_BUDGET_EXCEEDED', 'x', { needed_parts: 300, remaining_parts: 100, monthly_parts: 5000, used_parts: 4900 }, 422)
    );
    expect(alert).toHaveTextContent("This needs 300 SMS parts but only 100 are left in this month's budget of 5000.");
    expect(alert).toHaveTextContent('Raise the budget in SMS sending rules');
  });

  it('QUIET_HOURS shows the reason and when sending is allowed again', async () => {
    const alert = await sendWith(
      aborted('QUIET_HOURS', 'SMS are not sent between 10:00 PM and 7:00 AM.', { resume_at: '2026-11-04T01:30:00.000Z' }, 422)
    );
    expect(alert).toHaveTextContent('SMS are not sent between 10:00 PM and 7:00 AM.');
    expect(alert).toHaveTextContent('You can send after 04 Nov');
  });

  it('UNKNOWN_PLACEHOLDER names the words and the allowed ones', async () => {
    const alert = await sendWith(
      aborted('UNKNOWN_PLACEHOLDER', 'x', { unknown: ['{nme}', '{foo}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] })
    );
    expect(alert).toHaveTextContent('{nme}, {foo} are not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.');
  });

  it('TEXT_TOO_LONG names the language and the longest length', async () => {
    const alert = await sendWith(aborted('TEXT_TOO_LONG', 'x', { language: 'en', longest: 512, max: 480 }));
    expect(alert).toHaveTextContent('The English text can be up to 512 characters once the name, points and wallet are filled in. Keep it under 480.');
  });

  it('OFFER_NO_RECIPIENTS mentions customers skipped by the per-customer limit', async () => {
    const alert = await sendWith(aborted('OFFER_NO_RECIPIENTS', 'x', { skipped_capped: 7 }));
    expect(alert).toHaveTextContent('No customer in this group can get offers: 7 already got their share of texts');
  });

  it('shows the server message for anything else, and the validation message of a bad field', async () => {
    const alert = await sendWith({
      status: 400,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ field: 'send_at', message: 'Pick a time in the future' }] },
    });
    expect(alert).toHaveTextContent('Pick a time in the future');
  });
});

describe('Scheduled and automatic: the list', () => {
  it('lists each campaign with kind, status, schedule, next run, totals and last run', async () => {
    const user = userEvent.setup();
    open({ 'GET /admin/sms-campaigns': () => ok({ campaigns: [WEEKLY, TRIGGER] }) });
    await user.click(await tab('Scheduled and automatic'));
    const list = await screen.findByRole('list', { name: 'Scheduled and automatic SMS' });
    const weekly = within(list).getByRole('listitem', { name: 'Friday vegetables' });
    expect(weekly).toHaveTextContent('Repeats');
    expect(weekly).toHaveTextContent('Active');
    expect(weekly).toHaveTextContent('Every Fri at 18:00');
    expect(weekly).toHaveTextContent("Haven't ordered in 14 days");
    expect(weekly).toHaveTextContent(/Next run: 6 Nov 2026.*18:00/);
    expect(weekly).toHaveTextContent('3 runs · 120 customers · 132 SMS parts');
    expect(weekly).toHaveTextContent(/Last run: 30 Oct 2026.*18:00.*Sent.*40 customers/);
    expect(weekly).toHaveTextContent('English: Fresh vegetables today, {name}!');
    expect(within(weekly).getByRole('button', { name: 'Pause Friday vegetables' })).toBeInTheDocument();
    expect(within(weekly).getByRole('button', { name: 'Edit Friday vegetables' })).toBeInTheDocument();
    expect(within(weekly).getByRole('button', { name: 'Cancel Friday vegetables' })).toBeInTheDocument();

    const trigger = within(list).getByRole('listitem', { name: 'Come back' });
    expect(trigger).toHaveTextContent('Automatic');
    expect(trigger).toHaveTextContent('Paused');
    expect(trigger).toHaveTextContent('Checked daily at 10:00: No order for 21 days');
    expect(trigger).not.toHaveTextContent('Next run');
    expect(within(trigger).getByRole('button', { name: 'Resume Come back' })).toBeInTheDocument();
    expect(within(trigger).queryByRole('button', { name: 'Pause Come back' })).toBeNull();
  });

  it('shows an empty list, and a finished campaign has only its runs', async () => {
    const user = userEvent.setup();
    const { api } = open();
    await user.click(await tab('Scheduled and automatic'));
    expect(await screen.findByText('Nothing scheduled')).toBeInTheDocument();
    cleanup();
    open({ 'GET /admin/sms-campaigns': () => ok({ campaigns: [{ ...WEEKLY, status: 'CANCELLED', next_run_at: null }] }) });
    await userEvent.setup().click(await tab('Scheduled and automatic'));
    const row = await screen.findByRole('listitem', { name: 'Friday vegetables' });
    expect(row).toHaveTextContent('Cancelled');
    expect(within(row).queryByRole('button', { name: /^Pause|^Resume|^Edit|^Cancel/ })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Runs of Friday vegetables' })).toBeInTheDocument();
    expect(api.find('GET', '/admin/sms-campaigns')).toHaveLength(1);
  });

  it('shows the runs of a campaign on request', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'GET /admin/sms-campaigns': () => ok({ campaigns: [WEEKLY] }),
      'GET /admin/sms-campaigns/:id': () =>
        ok({
          campaign: {
            ...WEEKLY,
            runs: [RUN, { ...RUN, id: 'r0', ran_at: '2026-10-23T12:30:05.000Z', status: 'BLOCKED_BUDGET', recipients: 0, sms_parts: 0, skipped_opted_out: 0, skipped_capped: 0 }],
          },
        }),
    });
    await user.click(await tab('Scheduled and automatic'));
    await user.click(await screen.findByRole('button', { name: 'Runs of Friday vegetables' }));
    const runs = await screen.findByRole('list', { name: 'Runs of Friday vegetables' });
    const items = within(runs).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sent · 40 customers · 44 SMS parts · Skipped: 3 turned offers off, 2 already got enough texts');
    expect(items[1]).toHaveTextContent('Skipped: monthly SMS budget used up');
    expect(api.find('GET', '/admin/sms-campaigns/c1')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Runs of Friday vegetables' }));
    expect(screen.queryByRole('list', { name: 'Runs of Friday vegetables' })).toBeNull();
  });
});

describe('Scheduled and automatic: pause, resume, cancel', () => {
  /** The list the API would answer: `list` is changed by the action handlers a test passes in. */
  async function openList(handlers: (set: (c: SmsCampaign) => void) => Handlers = () => ({})) {
    const user = userEvent.setup();
    let list = [WEEKLY, TRIGGER];
    const set = (c: SmsCampaign) => {
      list = list.map((x) => (x.id === c.id ? c : x));
    };
    const view = open({ 'GET /admin/sms-campaigns': () => ok({ campaigns: list }), ...handlers(set) });
    await user.click(await tab('Scheduled and automatic'));
    await screen.findByRole('list', { name: 'Scheduled and automatic SMS' });
    return { user, ...view };
  }

  it('pauses after a confirmation and shows it paused', async () => {
    const { user, api } = await openList((set) => ({
      'POST /admin/sms-campaigns/:id/pause': () => {
        const paused = { ...WEEKLY, status: 'PAUSED' as const, next_run_at: null };
        set(paused);
        return ok({ campaign: { ...paused, runs: [] } });
      },
    }));
    await user.click(screen.getByRole('button', { name: 'Pause Friday vegetables' }));
    const dialog = screen.getByRole('dialog', { name: 'Pause campaign' });
    expect(dialog).toHaveTextContent('Nothing is sent until you resume it.');
    expect(api.find('POST', '/admin/sms-campaigns/c1/pause')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('"Friday vegetables" paused.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns/c1/pause')).toHaveLength(1);
    expect(api.find('POST', '/admin/sms-campaigns/c1/pause')[0].body).toBeNull();
  });

  it('resumes after a confirmation', async () => {
    const { user, api } = await openList((set) => ({
      'POST /admin/sms-campaigns/:id/resume': () => {
        const active = { ...TRIGGER, status: 'ACTIVE' as const };
        set(active);
        return ok({ campaign: { ...active, runs: [] } });
      },
    }));
    await user.click(screen.getByRole('button', { name: 'Resume Come back' }));
    const dialog = screen.getByRole('dialog', { name: 'Resume campaign' });
    expect(dialog).toHaveTextContent('runs missed while paused are not sent');
    await user.click(within(dialog).getByRole('button', { name: 'Resume' }));
    expect(await screen.findByText('"Come back" resumed.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns/c2/resume')).toHaveLength(1);
    expect(within(screen.getByRole('listitem', { name: 'Come back' })).getByRole('button', { name: 'Pause Come back' })).toBeInTheDocument();
  });

  it('cancels only after a confirmation; backing out calls nothing', async () => {
    const { user, api } = await openList((set) => ({
      'POST /admin/sms-campaigns/:id/cancel': () => {
        const cancelled = { ...WEEKLY, status: 'CANCELLED' as const, next_run_at: null };
        set(cancelled);
        return ok({ campaign: { ...cancelled, runs: [] } });
      },
    }));
    await user.click(screen.getByRole('button', { name: 'Cancel Friday vegetables' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Cancel campaign' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.find('POST', '/admin/sms-campaigns/c1/cancel')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Cancel Friday vegetables' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel campaign' });
    expect(dialog).toHaveTextContent('It will never be sent again.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel campaign' }));
    expect(await screen.findByText('"Friday vegetables" cancelled.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns/c1/cancel')).toHaveLength(1);
    expect(within(screen.getByRole('listitem', { name: 'Friday vegetables' })).getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the server reason when the campaign cannot be changed', async () => {
    const { user } = await openList(() => ({
      'POST /admin/sms-campaigns/:id/pause': () => aborted('CAMPAIGN_FINISHED', 'This campaign has finished.', { status: 'COMPLETED' }, 409),
    }));
    await user.click(screen.getByRole('button', { name: 'Pause Friday vegetables' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Pause campaign' })).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This campaign has finished.');
  });
});

describe('Scheduled and automatic: create', () => {
  async function newCampaign(handlers: Handlers = {}) {
    const user = userEvent.setup();
    const view = open(handlers);
    await user.click(await tab('Scheduled and automatic'));
    await user.click(await screen.findByRole('button', { name: 'New automatic SMS' }));
    const form = await screen.findByRole('form', { name: 'New automatic SMS' });
    return { user, form, ...view };
  }
  const created = (over: Partial<SmsCampaign> = {}) => ({ status: 201, data: { campaign: { ...WEEKLY, ...over } } });
  const text = (form: HTMLElement, value: string) =>
    fireEvent.change(within(form).getByLabelText(/^English text/, { selector: 'textarea' }), { target: { value } });

  it('creates a weekly RECURRING campaign on chosen weekdays', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Friday reminder' }) });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: ' Friday reminder ' } });
    // weekly is the default: no weekday yet
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose at least one weekday.');
    expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(0);

    await user.click(within(form).getByRole('button', { name: 'Friday' }));
    await user.click(within(form).getByRole('button', { name: 'Sunday' }));
    await user.click(within(form).getByRole('button', { name: 'Tuesday' }));
    await user.click(within(form).getByRole('button', { name: 'Sunday' })); // off again
    fireEvent.change(within(form).getByLabelText('Time (Sri Lanka time)'), { target: { value: '17:30' } });
    await user.click(within(form).getByRole('radio', { name: 'Ordered in last 30 days' }));
    text(form, 'Fresh vegetables today, {name}! {app_link}');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));

    expect(await screen.findByText('"Friday reminder" is on: Every Fri at 18:00.')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'RECURRING',
      name: 'Friday reminder',
      audience: 'ORDERED_30D',
      fallback_language: 'en',
      messages: { en: 'Fresh vegetables today, {name}! {app_link}' },
      schedule: { frequency: 'WEEKLY', time: '17:30', weekdays: ['tue', 'fri'] },
    });
    // back on the list, which was loaded again
    expect(await screen.findByRole('button', { name: 'New automatic SMS' })).toBeInTheDocument();
    expect(api.find('GET', '/admin/sms-campaigns')).toHaveLength(2);
  });

  it('creates a daily RECURRING campaign for a group, with start and end dates', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Daily' }) });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Daily' } });
    await user.click(within(form).getByRole('button', { name: 'Every day' }));
    expect(within(form).queryByRole('button', { name: 'Friday' })).toBeNull();
    fireEvent.change(within(form).getByLabelText('Time (Sri Lanka time)'), { target: { value: '09:00' } });
    fireEvent.change(within(form).getByLabelText('Start on'), { target: { value: '2026-12-01' } });
    fireEvent.change(within(form).getByLabelText('End on'), { target: { value: '2026-12-31' } });
    await user.click(within(form).getByRole('radio', { name: "Haven't ordered in N days" }));
    fireEvent.change(within(form).getByRole('textbox', { name: "Days for Haven't ordered in N days" }), { target: { value: '21' } });
    text(form, 'We miss you');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'RECURRING',
      name: 'Daily',
      audience: { group: 'LAPSED', days: 21 },
      fallback_language: 'en',
      messages: { en: 'We miss you' },
      schedule: { frequency: 'DAILY', time: '09:00', starts_on: '2026-12-01', ends_on: '2026-12-31' },
    });
  });

  it('creates a monthly RECURRING campaign with custom filters, and checks the day 1 to 28', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Monthly' }) });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Monthly' } });
    await user.click(within(form).getByRole('button', { name: 'Every month' }));
    fireEvent.change(within(form).getByLabelText('Day of the month'), { target: { value: '31' } });
    text(form, 'Monthly offer');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Day of the month must be a whole number from 1 to 28.');
    fireEvent.change(within(form).getByLabelText('Day of the month'), { target: { value: '5' } });
    await user.click(within(form).getByRole('radio', { name: 'Custom filters' }));
    await user.click(await within(form).findByRole('checkbox', { name: /^Colombo/ }));
    fireEvent.change(within(form).getByLabelText('Orders (at least)'), { target: { value: '3' } });
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'RECURRING',
      name: 'Monthly',
      audience: { group: 'CUSTOM', areas: ['Colombo'], min_orders: 3 },
      fallback_language: 'en',
      messages: { en: 'Monthly offer' },
      schedule: { frequency: 'MONTHLY', time: '18:00', month_day: 5 },
    });
  });

  it('creates a TRIGGER: days after the last order', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Thanks', kind: 'TRIGGER' }) });
    await user.click(within(form).getByRole('button', { name: 'Automatic (trigger)' }));
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Thanks' } });
    // the audience is picked by the trigger: no "Send to"
    expect(within(form).queryByRole('radio', { name: 'All customers' })).toBeNull();
    fireEvent.change(within(form).getByLabelText('Number of days'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Check every day at (Sri Lanka time)'), { target: { value: '10:30' } });
    text(form, 'Thanks for ordering, {name}!');
    // its preview asks who it would text today
    await waitFor(() =>
      expect(api.find('POST', '/admin/sms-campaigns/preview').at(-1)?.body).toEqual({
        kind: 'TRIGGER',
        fallback_language: 'en',
        messages: { en: 'Thanks for ordering, {name}!' },
        schedule: { trigger: 'DAYS_AFTER_LAST_ORDER', days: 3, time: '10:30' },
      })
    );
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'TRIGGER',
      name: 'Thanks',
      fallback_language: 'en',
      messages: { en: 'Thanks for ordering, {name}!' },
      schedule: { trigger: 'DAYS_AFTER_LAST_ORDER', days: 3, time: '10:30' },
    });
  });

  it('creates a TRIGGER: days after sign-up, only if they never ordered', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Welcome', kind: 'TRIGGER' }) });
    await user.click(within(form).getByRole('button', { name: 'Automatic (trigger)' }));
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Welcome' } });
    await user.selectOptions(within(form).getByLabelText('When to text'), 'DAYS_AFTER_SIGNUP');
    fireEvent.change(within(form).getByLabelText('Number of days'), { target: { value: '2' } });
    await user.click(within(form).getByRole('checkbox', { name: /Only if they have not ordered yet/ }));
    text(form, 'Welcome! Your first order: {app_link}');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'TRIGGER',
      name: 'Welcome',
      fallback_language: 'en',
      messages: { en: 'Welcome! Your first order: {app_link}' },
      schedule: { trigger: 'DAYS_AFTER_SIGNUP', days: 2, time: '18:00', only_if_never_ordered: true },
    });
  });

  it('creates a TRIGGER: no order for N days, with its cooldown', async () => {
    const { user, form, api } = await newCampaign({ 'POST /admin/sms-campaigns': () => created({ name: 'Lapsed', kind: 'TRIGGER' }) });
    await user.click(within(form).getByRole('button', { name: 'Automatic (trigger)' }));
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Lapsed' } });
    await user.selectOptions(within(form).getByLabelText('When to text'), 'NO_ORDER_FOR_DAYS');
    expect(within(form).getByLabelText('Days before texting the same customer again')).toHaveValue('30');
    fireEvent.change(within(form).getByLabelText('Number of days'), { target: { value: '21' } });
    fireEvent.change(within(form).getByLabelText('Days before texting the same customer again'), { target: { value: '45' } });
    text(form, 'We miss you');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    await waitFor(() => expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(1));
    expect(api.find('POST', '/admin/sms-campaigns')[0].body).toEqual({
      kind: 'TRIGGER',
      name: 'Lapsed',
      fallback_language: 'en',
      messages: { en: 'We miss you' },
      schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 21, time: '18:00', cooldown_days: 45 },
    });
  });

  it('checks the name and the days before sending anything', async () => {
    const { user, form, api } = await newCampaign();
    await user.click(within(form).getByRole('button', { name: 'Automatic (trigger)' }));
    text(form, 'We miss you');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give it a name.');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.change(within(form).getByLabelText('Number of days'), { target: { value: '0' } });
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Days must be a whole number from 1 to 365.');
    expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(0);
  });

  it('shows the preview for a repeating campaign (who gets it now) and the server error on save', async () => {
    const { user, form, api } = await newCampaign({
      'POST /admin/sms-campaigns/preview': (call) =>
        ok({ preview: { ...estimateFor(call, { recipients: 12, samples: [{ language: 'en', text: 'Hello Nimal', parts: 1 }] }).estimate } }),
      'POST /admin/sms-campaigns': () => aborted('OFFER_TEXT_MISSING', 'x', { missing_languages: ['en'] }),
    });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Needs text' } });
    await user.click(within(form).getByRole('button', { name: 'Friday' }));
    text(form, 'Hello {name}');
    expect(await within(form).findByTestId('sms-recipients')).toHaveTextContent('12');
    expect(within(form).getByText('Who gets it now')).toBeInTheDocument();
    expect(within(form).getByRole('list', { name: 'Example texts' })).toHaveTextContent('Hello Nimal');
    await waitFor(() =>
      expect(api.find('POST', '/admin/sms-campaigns/preview').at(-1)?.body).toEqual({
        kind: 'RECURRING',
        audience: 'ALL',
        fallback_language: 'en',
        messages: { en: 'Hello {name}' },
      })
    );
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Write the English text first.');
  });

  it('shows UNKNOWN_PLACEHOLDER from the server under the form', async () => {
    const { user, form } = await newCampaign({
      'POST /admin/sms-campaigns': () =>
        aborted('UNKNOWN_PLACEHOLDER', 'x', { unknown: ['{foo}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] }),
    });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Bad' } });
    await user.click(within(form).getByRole('button', { name: 'Friday' }));
    text(form, 'Hello');
    await user.click(within(form).getByRole('button', { name: 'Create campaign' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('{foo} is not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.');
  });

  it('cancel goes back to the list without saving', async () => {
    const { user, form, api } = await newCampaign();
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'New automatic SMS' })).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-campaigns')).toHaveLength(0);
  });

  it('puts placeholder chips and the template picker in the form too', async () => {
    const { user, form } = await newCampaign();
    await waitFor(() => expect(within(within(form).getByLabelText('Use a saved template')).getByRole('option', { name: 'Friday vegetables' })).toBeInTheDocument());
    await user.selectOptions(within(form).getByLabelText('Use a saved template'), 't1');
    expect(within(form).getByLabelText(/^English text/, { selector: 'textarea' })).toHaveValue('Hi {name}, fresh vegetables today. {app_link}');
    await user.click(within(form).getByRole('button', { name: 'Insert {wallet} into the English text' }));
    expect(within(form).getByLabelText(/^English text/, { selector: 'textarea' })).toHaveValue('Hi {name}, fresh vegetables today. {app_link}{wallet}');
  });
});

describe('Scheduled and automatic: edit', () => {
  it('edits a repeating campaign: the form is filled and only future runs change (PATCH)', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'GET /admin/sms-campaigns': () => ok({ campaigns: [WEEKLY] }),
      'PATCH /admin/sms-campaigns/:id': () => ok({ campaign: { ...WEEKLY, name: 'Friday veg', runs: [] } }),
    });
    await user.click(await tab('Scheduled and automatic'));
    await user.click(await screen.findByRole('button', { name: 'Edit Friday vegetables' }));
    const form = await screen.findByRole('form', { name: 'Edit Friday vegetables' });
    expect(form).toHaveTextContent('Changes apply to future runs only.');
    expect(within(form).getByLabelText('Name')).toHaveValue('Friday vegetables');
    expect(within(form).getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(form).getByLabelText('Time (Sri Lanka time)')).toHaveValue('18:00');
    expect(within(form).getByRole('radio', { name: "Haven't ordered in N days" })).toBeChecked();
    expect(within(form).getByLabelText(/^English text/, { selector: 'textarea' })).toHaveValue('Fresh vegetables today, {name}!');
    // the type cannot change
    expect(within(form).queryByRole('button', { name: 'Automatic (trigger)' })).toBeNull();

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Friday veg' } });
    await user.click(within(form).getByRole('button', { name: 'Saturday' }));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved changes to "Friday veg".')).toBeInTheDocument();
    expect(api.find('PATCH', '/admin/sms-campaigns/c1')[0].body).toEqual({
      name: 'Friday veg',
      fallback_language: 'en',
      messages: { en: 'Fresh vegetables today, {name}!' },
      audience: { group: 'LAPSED', days: 14 },
      schedule: { frequency: 'WEEKLY', time: '18:00', weekdays: ['fri', 'sat'] },
    });
  });

  it('edits an automatic campaign: no audience is sent', async () => {
    const user = userEvent.setup();
    const { api } = open({
      'GET /admin/sms-campaigns': () => ok({ campaigns: [TRIGGER] }),
      'PATCH /admin/sms-campaigns/:id': () => ok({ campaign: { ...TRIGGER, runs: [] } }),
    });
    await user.click(await tab('Scheduled and automatic'));
    await user.click(await screen.findByRole('button', { name: 'Edit Come back' }));
    const form = await screen.findByRole('form', { name: 'Edit Come back' });
    expect(within(form).getByLabelText('When to text')).toHaveValue('NO_ORDER_FOR_DAYS');
    expect(within(form).getByLabelText('Number of days')).toHaveValue('21');
    fireEvent.change(within(form).getByLabelText('Number of days'), { target: { value: '28' } });
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.find('PATCH', '/admin/sms-campaigns/c2')).toHaveLength(1));
    expect(api.find('PATCH', '/admin/sms-campaigns/c2')[0].body).toEqual({
      name: 'Come back',
      fallback_language: 'en',
      messages: { en: 'We miss you {name}' },
      schedule: { trigger: 'NO_ORDER_FOR_DAYS', days: 28, time: '10:00', cooldown_days: 30 },
    });
  });
});

describe('History tab', () => {
  it('lists offers sent now and campaign runs, newest first', async () => {
    const user = userEvent.setup();
    open({
      'GET /admin/sms-campaigns/history': () =>
        ok({
          items: [
            {
              type: 'OFFER',
              id: 'o1',
              at: '2026-11-02T04:00:00.000Z',
              name: 'Offer sent now',
              campaign_id: null,
              campaign_kind: null,
              status: 'SENT',
              recipients: 42,
              sms_parts: 63,
              skipped_opted_out: null,
              skipped_capped: null,
              skipped_no_phone: null,
              reason: null,
              audience_label: 'Custom: in Colombo; 1-5 delivered orders',
              sent_by_name: 'Ops Person',
              messages: { si: null, ta: null, en: 'Fresh vegetables 10% off today' },
            },
            {
              type: 'CAMPAIGN_RUN',
              id: 'r5',
              at: '2026-11-01T04:00:00.000Z',
              name: 'Friday vegetables',
              campaign_id: 'c1',
              campaign_kind: 'RECURRING',
              status: 'BLOCKED_BUDGET',
              recipients: 0,
              sms_parts: 0,
              skipped_opted_out: 0,
              skipped_capped: 0,
              skipped_no_phone: 0,
              reason: 'Needs 300 parts, 100 left',
              audience_label: null,
              sent_by_name: null,
              messages: null,
            },
          ],
        }),
    });
    await user.click(await tab('History'));
    const rows = within(await screen.findByRole('list', { name: 'SMS history' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Offer sent now');
    expect(rows[0]).toHaveTextContent('Sent now');
    expect(rows[0]).toHaveTextContent('Ops Person');
    expect(rows[0]).toHaveTextContent('Custom: in Colombo; 1-5 delivered orders');
    expect(rows[0]).toHaveTextContent('42 customers · 63 SMS parts');
    expect(rows[0]).toHaveTextContent('English: Fresh vegetables 10% off today');
    expect(rows[1]).toHaveTextContent('Friday vegetables');
    expect(rows[1]).toHaveTextContent('Scheduled run');
    expect(rows[1]).toHaveTextContent('Skipped: monthly SMS budget used up');
    expect(rows[1]).toHaveTextContent('Needs 300 parts, 100 left');
  });

  it('shows an empty history and a load error', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await tab('History'));
    expect(await screen.findByText('Nothing sent yet')).toBeInTheDocument();
    cleanup();
    open({ 'GET /admin/sms-campaigns/history': () => aborted('INTERNAL', 'boom', undefined, 500) });
    await userEvent.setup().click(await tab('History'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The Blynk API had a problem.');
  });
});

describe('Templates tab', () => {
  it('lists templates, creates one in all three languages, edits and deletes', async () => {
    const user = userEvent.setup();
    let templates: SmsTemplate[] = [TEMPLATE];
    const { api } = open({
      'GET /admin/sms-templates': () => ok({ templates }),
      'POST /admin/sms-templates': (call) => {
        const t: SmsTemplate = { ...TEMPLATE, id: 't2', name: call.body.name, messages: { si: call.body.messages.si ?? null, ta: null, en: call.body.messages.en ?? null } };
        templates = [...templates, t];
        return { status: 201, data: { template: t } };
      },
      'PUT /admin/sms-templates/:id': (call) => {
        templates = templates.map((t) => (t.id === 't1' ? { ...t, name: call.body.name, messages: { si: null, ta: null, en: call.body.messages.en } } : t));
        return ok({ template: templates[0] });
      },
      'DELETE /admin/sms-templates/:id': () => {
        templates = templates.filter((t) => t.id !== 't2');
        return ok({ deleted: true });
      },
    });
    await user.click(await tab('Templates'));
    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(within(list).getByRole('listitem', { name: 'Friday vegetables' })).toHaveTextContent('English: Hi {name}, fresh vegetables today. {app_link}');

    // create
    await user.click(screen.getByRole('button', { name: 'New template' }));
    let form = await screen.findByRole('form', { name: 'New template' });
    await user.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give the template a name.');
    fireEvent.change(within(form).getByLabelText('Template name'), { target: { value: ' Weekend ' } });
    await user.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Write at least one text.');
    fireEvent.change(within(form).getByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Weekend sale {name}' } });
    fireEvent.change(within(form).getByLabelText(/^Sinhala text/, { selector: 'textarea' }), { target: { value: 'සති අන්ත' } });
    await user.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Saved "Weekend".')).toBeInTheDocument();
    expect(api.find('POST', '/admin/sms-templates')[0].body).toEqual({ name: 'Weekend', messages: { si: 'සති අන්ත', en: 'Weekend sale {name}' } });
    expect(await screen.findByRole('listitem', { name: 'Weekend' })).toBeInTheDocument();

    // edit
    await user.click(screen.getByRole('button', { name: 'Edit Friday vegetables' }));
    form = await screen.findByRole('form', { name: 'Edit Friday vegetables' });
    expect(within(form).getByLabelText('Template name')).toHaveValue('Friday vegetables');
    fireEvent.change(within(form).getByLabelText('Template name'), { target: { value: 'Friday veg' } });
    fireEvent.change(within(form).getByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Veg {name}' } });
    await user.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Saved "Friday veg".')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/sms-templates/t1')[0].body).toEqual({ name: 'Friday veg', messages: { en: 'Veg {name}' } });

    // delete, after a confirmation
    await user.click(await screen.findByRole('button', { name: 'Delete Weekend' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete template' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('DELETE', '/admin/sms-templates/t2')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete Weekend' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete template' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Deleted "Weekend".')).toBeInTheDocument();
    expect(api.find('DELETE', '/admin/sms-templates/t2')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Weekend' })).toBeNull());
  });

  it('shows the server reason, and the Send tab picker sees a change made here', async () => {
    const user = userEvent.setup();
    let templates: SmsTemplate[] = [TEMPLATE];
    open({
      'GET /admin/sms-templates': () => ok({ templates }),
      'POST /admin/sms-templates': () => aborted('UNKNOWN_PLACEHOLDER', 'x', { unknown: ['{bad}'], allowed: ['{name}'] }),
      'DELETE /admin/sms-templates/:id': () => {
        templates = [];
        return ok({ deleted: true });
      },
    });
    await user.click(await tab('Templates'));
    await user.click(await screen.findByRole('button', { name: 'New template' }));
    const form = await screen.findByRole('form', { name: 'New template' });
    fireEvent.change(within(form).getByLabelText('Template name'), { target: { value: 'Bad' } });
    fireEvent.change(within(form).getByLabelText(/^English text/, { selector: 'textarea' }), { target: { value: 'Hello {name}' } });
    await user.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('{bad} is not a placeholder. You can use {name}.');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Friday vegetables' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Delete template' })).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Deleted "Friday vegetables".');
    await user.click(await tab('Send'));
    await waitFor(() => expect(within(screen.getByLabelText('Use a saved template')).queryByRole('option', { name: 'Friday vegetables' })).toBeNull());
  });
});

describe('SMS sending rules card (More > Customers and rewards)', () => {
  const SENDING: SmsSendingRules = {
    any_time: true,
    quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
    updated_at: null,
    sending_now: { allowed: true, code: null, message: null, resume_at: null },
  };
  const LIMITS: SmsLimitRules = {
    per_customer: { enabled: false, max: 1, days: 7 },
    monthly_budget: { enabled: false, parts: 5000 },
    updated_at: null,
    usage: { month: '2026-11', month_starts_at: '2026-10-31T18:30:00.000Z', parts_used: 1240, remaining_parts: null },
  };

  function card(handlers: Handlers = {}) {
    const view = renderAs(OPERATIONS_STAFF, moreSettings('customers'), {
      'GET /admin/settings/sms-sending': () => ok(SENDING),
      'GET /admin/settings/sms-limits': () => ok(LIMITS),
      ...handlers,
    });
    return { ...view, region: () => screen.findByRole('region', { name: 'SMS sending rules' }) };
  }

  it('is a card of Customers and rewards, with plain wording; defaults: any time on, nothing limited, usage shown', async () => {
    const { region, api } = card();
    const box = await region();
    expect(await within(box).findByRole('switch', { name: 'Send at any time' })).toHaveAttribute('aria-checked', 'true');
    expect(box).toHaveTextContent('You decide: nothing is limited unless you switch it on.');
    expect(within(box).getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
    expect(within(box).getByRole('switch', { name: 'Limit texts per customer' })).toHaveAttribute('aria-checked', 'false');
    expect(within(box).getByRole('switch', { name: 'Monthly SMS budget' })).toHaveAttribute('aria-checked', 'false');
    expect(within(box).queryByLabelText('Quiet hours start')).toBeNull();
    expect(within(box).getByTestId('sms-usage')).toHaveTextContent('This month (2026-11): 1,240 SMS parts used.');
    expect(within(box).getByTestId('sms-sending-now')).toHaveTextContent('Right now: SMS can be sent.');
    expect(api.find('GET', '/admin/settings/sms-sending')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/sms-limits')).toHaveLength(1);
  });

  it('is only mounted (and loaded) with its category', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/settings/sms-sending': () => ok(SENDING),
      'GET /admin/settings/sms-limits': () => ok(LIMITS),
    });
    await screen.findByRole('heading', { name: 'Delivery fee' });
    expect(api.find('GET', '/admin/settings/sms-sending')).toHaveLength(0);
    expect(api.find('GET', '/admin/settings/sms-limits')).toHaveLength(0);
    await user.click(await screen.findByRole('tab', { name: /^Customers and rewards/ }));
    expect(await screen.findByRole('heading', { name: 'SMS sending rules', level: 2 })).toBeInTheDocument();
    await waitFor(() => expect(api.find('GET', '/admin/settings/sms-sending')).toHaveLength(1));
  });

  it('shows why sending is held right now', async () => {
    const { region } = card({
      'GET /admin/settings/sms-sending': () =>
        ok({
          ...SENDING,
          quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
          sending_now: { allowed: false, code: 'QUIET_HOURS', message: 'SMS are not sent between 10:00 PM and 7:00 AM.', resume_at: '2026-11-04T01:30:00.000Z' },
        }),
    });
    const box = await region();
    expect(await within(box).findByTestId('sms-sending-now')).toHaveTextContent('Right now: SMS are not sent between 10:00 PM and 7:00 AM.');
    expect(within(box).getByLabelText('Quiet hours start')).toHaveValue('22:00');
    expect(within(box).getByLabelText('Quiet hours end')).toHaveValue('07:00');
  });

  it('turning "Send at any time" off saves only the sending rule', async () => {
    const user = userEvent.setup();
    const { region, api } = card({
      'PUT /admin/settings/sms-sending': () => ok({ ...SENDING, any_time: false, updated_at: '2026-11-03T05:00:00.000Z' }),
    });
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Send at any time' }));
    expect(box).toHaveTextContent('SMS go out only during opening hours');
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByText('SMS sending rules saved.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/sms-sending')[0].body).toEqual({
      any_time: false,
      quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
    });
    expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(0);
    expect(within(box).getByRole('switch', { name: 'Send at any time' })).toHaveAttribute('aria-checked', 'false');
    expect(within(box).getByText(/Last changed/)).toBeInTheDocument();
  });

  it('quiet hours: switch on, pick start and end, save', async () => {
    const user = userEvent.setup();
    const { region, api } = card({
      'PUT /admin/settings/sms-sending': (call) => ok({ ...SENDING, quiet_hours: call.body.quiet_hours }),
    });
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Quiet hours' }));
    fireEvent.change(within(box).getByLabelText('Quiet hours start'), { target: { value: '21:00' } });
    fireEvent.change(within(box).getByLabelText('Quiet hours end'), { target: { value: '06:30' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-sending')[0].body).toEqual({
      any_time: true,
      quiet_hours: { enabled: true, start: '21:00', end: '06:30' },
    });
    expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(0);
  });

  it('refuses quiet hours that start and end together, and does not send', async () => {
    const user = userEvent.setup();
    const { region, api } = card();
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Quiet hours' }));
    fireEvent.change(within(box).getByLabelText('Quiet hours start'), { target: { value: '07:00' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Quiet hours must start and end at different times.');
    expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(0);
  });

  it('per-customer limit: most texts in this many days', async () => {
    const user = userEvent.setup();
    const { region, api } = card({
      'PUT /admin/settings/sms-limits': (call) => ok({ ...LIMITS, per_customer: call.body.per_customer }),
    });
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Limit texts per customer' }));
    expect(within(box).getByLabelText('Most texts per customer')).toHaveValue('1');
    expect(within(box).getByLabelText('Number of days for the limit')).toHaveValue('7');
    fireEvent.change(within(box).getByLabelText('Most texts per customer'), { target: { value: '2' } });
    fireEvent.change(within(box).getByLabelText('Number of days for the limit'), { target: { value: '14' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-limits')[0].body).toEqual({
      per_customer: { enabled: true, max: 2, days: 14 },
      monthly_budget: { enabled: false, parts: 5000 },
    });
    expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(0);
  });

  it('monthly budget: SMS parts per month, with this month usage and what is left', async () => {
    const user = userEvent.setup();
    const { region, api } = card({
      'PUT /admin/settings/sms-limits': (call) =>
        ok({
          ...LIMITS,
          monthly_budget: call.body.monthly_budget,
          usage: { ...LIMITS.usage, remaining_parts: call.body.monthly_budget.parts - LIMITS.usage.parts_used },
        }),
    });
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Monthly SMS budget' }));
    expect(within(box).getByLabelText('SMS parts per month')).toHaveValue('5000');
    fireEvent.change(within(box).getByLabelText('SMS parts per month'), { target: { value: '3000' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-limits')[0].body).toEqual({
      per_customer: { enabled: false, max: 1, days: 7 },
      monthly_budget: { enabled: true, parts: 3000 },
    });
    expect(await within(box).findByTestId('sms-usage')).toHaveTextContent('This month (2026-11): 1,240 SMS parts used, 1,760 left.');
  });

  it('checks the numbers before sending, and says nothing changed when nothing did', async () => {
    const user = userEvent.setup();
    const { region, api } = card();
    const box = await region();
    await user.click(await within(box).findByRole('button', { name: 'Save' }));
    expect(await within(box).findByText('Nothing changed.')).toBeInTheDocument();
    await user.click(within(box).getByRole('switch', { name: 'Monthly SMS budget' }));
    fireEvent.change(within(box).getByLabelText('SMS parts per month'), { target: { value: '0' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('SMS parts per month must be a whole number from 1 to 10,000,000.');
    await user.click(within(box).getByRole('switch', { name: 'Monthly SMS budget' }));
    await user.click(within(box).getByRole('switch', { name: 'Limit texts per customer' }));
    fireEvent.change(within(box).getByLabelText('Most texts per customer'), { target: { value: '500' } });
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Texts per customer must be a whole number from 1 to 100.');
    expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(0);
    expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(0);
  });

  it('shows the server reason when saving fails, and a load error', async () => {
    const user = userEvent.setup();
    const { region } = card({
      'PUT /admin/settings/sms-sending': () => ({
        status: 400,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: [{ field: 'quiet_hours.end', message: 'Quiet hours must start and end at different times' }] },
      }),
    });
    const box = await region();
    await user.click(await within(box).findByRole('switch', { name: 'Send at any time' }));
    await user.click(within(box).getByRole('button', { name: 'Save' }));
    expect(await within(box).findByRole('alert')).toHaveTextContent('Quiet hours must start and end at different times');
    cleanup();
    const view = card({ 'GET /admin/settings/sms-limits': () => aborted('INTERNAL', 'boom', undefined, 500) });
    expect(await within(await view.region()).findByText('The Blynk API had a problem. Try again in a moment.')).toBeInTheDocument();
  });
});
