import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { SmsOffers } from '../pages/SmsOffers';
import { AuthProvider } from '../auth/AuthContext';
import { ApiError, tokenStore } from '../api/client';
import type { SmsHistoryItem, SmsLanguage, SmsOffer, SmsOfferEstimate } from '../api/types';
import { languageList, offerInput, offerParts, smsOfferErrorMessage, smsParts, withOptOut } from '../lib/smsOffers';
import { respond, stubFetch, type Handler } from './fetchStub';

/**
 * SMS offers page (backend migration 027). Who is reached, the fallback,
 * the opt-out line and the sending hours are tested against PostgreSQL in
 * backend/api/tests/sms-offers.test.ts; here, what the page asks for and shows.
 */

/** The backend's SMS_OFFER_LANGUAGES for the current test (['en'] at launch). */
let enabledLanguages: SmsLanguage[] = ['si', 'ta', 'en'];

/**
 * What the API would answer: with one language on, everyone gets it;
 * enabled languages with recipients but no text are missing.
 */
function estimateFor(body: Record<string, unknown> | undefined, overrides: Partial<SmsOfferEstimate> = {}): SmsOfferEstimate {
  const messages = (body?.messages ?? {}) as Partial<Record<SmsLanguage, string>>;
  const byLanguage: Record<SmsLanguage, number> =
    enabledLanguages.length === 1 ? { si: 0, ta: 0, en: 0, [enabledLanguages[0]!]: 35 } : { si: 10, ta: 20, en: 5 };
  return {
    audience: 'ALL',
    recipients: 35,
    by_language: byLanguage,
    without_language: 4,
    opted_out: 3,
    parts_per_sms: {},
    sms_parts_total: 70,
    missing_languages: enabledLanguages.filter((l) => byLanguage[l] > 0 && !messages[l]),
    languages: enabledLanguages,
    ...overrides,
  };
}

/** A row of GET /admin/sms-campaigns/history: an offer sent now. */
function historyOffer(overrides: Partial<SmsHistoryItem> = {}): SmsHistoryItem {
  return {
    type: 'OFFER',
    id: 'so1',
    at: '2026-10-05T05:30:00.000Z',
    name: 'Offer sent now',
    campaign_id: null,
    campaign_kind: null,
    status: 'SENT',
    recipients: 120,
    sms_parts: 240,
    skipped_opted_out: null,
    skipped_capped: null,
    skipped_no_phone: null,
    reason: null,
    audience: { group: 'LAPSED', days: 30 },
    audience_label: 'Ordered in the last 30 days',
    sent_by_name: 'Nawaz Mansoor',
    messages: { si: 'සිංහල දීමනාව', ta: 'தமிழ் சலுகை', en: 'Rice 10% off today only' },
    ...overrides,
  };
}

/** A row of GET /admin/sms-campaigns/history: one run of a campaign. */
function historyRun(overrides: Partial<SmsHistoryItem> = {}): SmsHistoryItem {
  return {
    type: 'CAMPAIGN_RUN',
    id: 'run1',
    at: '2026-10-04T12:30:00.000Z',
    name: 'Friday reminder',
    campaign_id: 'c1',
    campaign_kind: 'RECURRING',
    status: 'SENT',
    recipients: 40,
    sms_parts: 40,
    skipped_opted_out: 2,
    skipped_capped: 3,
    skipped_no_phone: 0,
    reason: null,
    audience: null,
    audience_label: null,
    sent_by_name: null,
    messages: null,
    ...overrides,
  };
}

/** Routes the offer endpoints; `extra` answers anything it returns a response for first. */
function stubOffers(extra: (method: string, path: string, body: Record<string, unknown> | undefined) => Promise<Response> | null = () => null, history: SmsOffer[] = []) {
  const handler: Handler = (method, path, body) => {
    const custom = extra(method, path, body);
    if (custom) return custom;
    if (path === '/admin/sms-offers/estimate') return respond({ estimate: estimateFor(body) });
    if (method === 'GET' && path === '/admin/sms-offers') return respond({ offers: history });
    if (path === '/admin/sms-offers/test') return respond({ sent_to: '+94775****22', sms_parts: 1 }, 202);
    if (method === 'POST' && path === '/admin/sms-offers')
      return respond({ offer: { id: 'new', created_at: '2026-10-06T05:00:00.000Z', recipients: 35, sms_parts_total: 70 } }, 201);
    return respond({});
  };
  return stubFetch(handler);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SmsOffers />
      </ToastProvider>
    </MemoryRouter>
  );
}

/** Renders, then waits for the first estimate to switch on all three languages. */
async function renderAll() {
  renderPage();
  await screen.findByRole('textbox', { name: 'Sinhala text' });
}

const textBox = (name: string) => screen.getByRole('textbox', { name: `${name} text` });

/** Fills all three languages (paste, so the debounce sees one change each). */
async function writeAll(user: ReturnType<typeof userEvent.setup>) {
  for (const [name, text] of [
    ['Sinhala', 'සිංහල දීමනාව'],
    ['Tamil', 'தமிழ் சலுகை'],
    ['English', 'Rice 10% off today'],
  ]) {
    await user.click(textBox(name!));
    await user.paste(text!);
  }
}

const estimatePanel = () => screen.getByRole('complementary', { name: 'Estimate' });

describe('SMS parts (lib)', () => {
  it('counts Unicode (Sinhala/Tamil) at 70 per SMS, 67 per part', () => {
    expect(smsParts('த'.repeat(70))).toBe(1);
    expect(smsParts('த'.repeat(71))).toBe(2);
    expect(smsParts('ස'.repeat(134))).toBe(2);
    expect(smsParts('ස'.repeat(135))).toBe(3);
  });

  it('counts plain English at 160 per SMS, 153 per part', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('a'.repeat(306))).toBe(2);
    expect(smsParts('a'.repeat(307))).toBe(3);
    // GSM extension characters take two; one Tamil letter makes it Unicode.
    expect(smsParts('€'.repeat(80))).toBe(1);
    expect(smsParts('€'.repeat(81))).toBe(2);
    expect(smsParts(`${'a'.repeat(70)}த`)).toBe(2);
  });

  it('sends the offer exactly as written (no opt-out line, owner 2026-10-09)', () => {
    expect(withOptOut('  Rice 10% off ', 'en')).toBe('Rice 10% off');
    expect(offerParts('', 'ta')).toBe(0);
    expect(offerParts('Rice 10% off', 'en')).toBe(1);
    expect(offerParts('a'.repeat(160), 'en')).toBe(1);
    expect(offerParts('a'.repeat(161), 'en')).toBe(2);
    expect(offerParts('த'.repeat(10), 'ta')).toBe(smsParts('த'.repeat(10)));
  });

  it('sends only the languages that have text', () => {
    expect(offerInput({ group: 'ALL' }, 'ta', { si: '  ', ta: ' சலுகை ', en: '' })).toEqual({
      audience: { group: 'ALL' },
      fallback_language: 'ta',
      messages: { ta: 'சலுகை' },
    });
    // Languages switched off are never sent, and the fallback is an enabled one.
    expect(offerInput({ group: 'ALL' }, 'ta', { si: 'සිංහල', ta: 'சலுகை', en: ' Rice ' }, ['en'])).toEqual({
      audience: { group: 'ALL' },
      fallback_language: 'en',
      messages: { en: 'Rice' },
    });
    expect(languageList(['si', 'ta', 'en'])).toBe('Sinhala, Tamil and English');
    expect(smsOfferErrorMessage(new ApiError('x', 400, 'OFFER_TEXT_MISSING', { missing_languages: ['si', 'ta'] }), '')).toBe(
      'Write the Sinhala and Tamil text too.'
    );
  });
});

describe('SMS offers page', () => {
  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    enabledLanguages = ['si', 'ta', 'en'];
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows the live estimate for the chosen audience and fallback', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    const panel = estimatePanel();
    await within(panel).findByText('35');
    expect(panel).toHaveTextContent('Recipients35');
    expect(panel).toHaveTextContent('Sinhala10');
    expect(panel).toHaveTextContent('Tamil20');
    expect(panel).toHaveTextContent('English5');
    expect(panel).toHaveTextContent('No language (get English)4');
    expect(panel).toHaveTextContent('Opted out3');
    expect(panel).toHaveTextContent('SMS parts70');

    // "Send to" customer groups (2026-10-24) replaced the old audience words.
    await user.selectOptions(screen.getByLabelText('Send to'), 'LAPSED');
    await user.selectOptions(screen.getByLabelText('Customers without a language get'), 'ta');
    await waitFor(() =>
      expect(api.sent('POST', '/admin/sms-offers/estimate')).toContainEqual({
        audience: { group: 'LAPSED', days: 14 },
        fallback_language: 'ta',
        messages: {},
      })
    );
    expect(await within(panel).findByText('No language (get Tamil)')).toBeInTheDocument();
  });

  it('warns about missing languages and keeps Send disabled until they are written', async () => {
    const user = userEvent.setup();
    stubOffers();
    await renderAll();
    const warning = await screen.findByText(/Write the Sinhala, Tamil and English text/);
    expect(warning).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    await user.click(textBox('English'));
    await user.paste('Rice 10% off today');
    expect(await screen.findByText(/Write the Sinhala and Tamil text/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();

    await user.click(textBox('Sinhala'));
    await user.paste('සිංහල දීමනාව');
    await user.click(textBox('Tamil'));
    await user.paste('தமிழ் சலுகை');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled());
    expect(screen.queryByText(/Write the .* text/)).toBeNull();
  });

  it('keeps Send disabled when no customer can receive it', async () => {
    const user = userEvent.setup();
    stubOffers((_m, path, body) => (path === '/admin/sms-offers/estimate' ? respond({ estimate: estimateFor(body, { recipients: 0, by_language: { si: 0, ta: 0, en: 0 }, missing_languages: [] }) }) : null));
    await renderAll();
    await user.click(textBox('English'));
    await user.paste('Hello');
    expect(await screen.findByText('No customer in this audience can receive offers.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
  });

  it('confirms and sends', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    await writeAll(user);
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    const dialog = screen.getByRole('dialog', { name: 'Send offer' });
    expect(dialog).toHaveTextContent('Send to 35 customers, about 70 SMS parts?');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Offer sent to 35 customers.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers')).toEqual([
      {
        audience: { group: 'ALL' },
        fallback_language: 'en',
        messages: { si: 'සිංහල දීමනාව', ta: 'தமிழ் சலுகை', en: 'Rice 10% off today' },
      },
    ]);
    // The sent list is on the History tab now (2026-11-03); it is loaded when that tab opens.
    expect(api.paths('GET').filter((p) => p.startsWith('/admin/sms-campaigns/history'))).toHaveLength(0);
    // The texts are cleared so the same offer is not sent twice by accident.
    expect(textBox('English')).toHaveValue('');
  });

  it('says when offers cannot be sent at this hour', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) =>
      method === 'POST' && path === '/admin/sms-offers'
        ? respond({ code: 'OUTSIDE_SENDING_HOURS', message: 'Offers can be sent from 8 AM to 9 PM only.' }, 422)
        : null
    );
    await renderAll();
    await writeAll(user);
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Offers can be sent from 8 AM to 9 PM only.');
    expect(textBox('English')).toHaveValue('Rice 10% off today');
  });

  it('sends a test to the number entered under "Send test to"', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    const tamilTest = screen.getByRole('button', { name: 'Send Tamil test' });
    expect(tamilTest).toBeDisabled();
    await user.type(screen.getByLabelText(/Send test to/), '077 555 1122');
    await user.click(textBox('Tamil'));
    await user.paste(' தமிழ் சலுகை ');
    await user.click(tamilTest);
    expect(await screen.findByText('Test sent to +94775****22')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([
      { language: 'ta', message: 'தமிழ் சலுகை', phone: '077 555 1122' },
    ]);
    expect(screen.getByRole('button', { name: 'Send Sinhala test' })).toBeDisabled();
  });

  it('prefills "Send test to" with the signed-in account’s own phone when it has one', async () => {
    tokenStore.save('access', 'refresh');
    stubOffers((_m, path) =>
      path === '/auth/me'
        ? respond({ id: 'o1', phone: '+94771234567', full_name: 'Ops', email: null, role: 'ADMIN' })
        : null
    );
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <SmsOffers />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByLabelText(/Send test to/)).toHaveValue('+94771234567'));
  });

  it('checks the "Send test to" number before sending', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    await renderAll();
    await user.type(screen.getByLabelText(/Send test to/), '12345');
    await user.click(textBox('English'));
    await user.paste('Hello');
    await user.click(screen.getByRole('button', { name: 'Send English test' }));
    expect(await screen.findByText('Enter a Sri Lankan mobile number, e.g. 077 123 4567.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([]);
  });

  it('asks for a number when none is entered and the account has no phone', async () => {
    const user = userEvent.setup();
    const api = stubOffers((_m, path) =>
      path === '/admin/sms-offers/test' ? respond({ code: 'NO_TEST_PHONE', message: 'Enter the number to send the test to.' }, 400) : null
    );
    await renderAll();
    expect(screen.getByLabelText(/Send test to/)).toHaveValue('');
    await user.click(textBox('English'));
    await user.paste('Hello');
    await user.click(screen.getByRole('button', { name: 'Send English test' }));
    expect(await screen.findByText('Enter the number to send the test to.')).toBeInTheDocument();
    // Blank: no phone is sent, the API falls back to the account's own.
    expect(api.sent('POST', '/admin/sms-offers/test')).toEqual([{ language: 'en', message: 'Hello' }]);
  });

  it('counts characters and SMS parts and previews the SMS', async () => {
    const user = userEvent.setup();
    stubOffers();
    await renderAll();
    expect(screen.getByTestId('count-en')).toHaveTextContent('0 / 480 characters');
    await user.click(textBox('English'));
    await user.paste('a'.repeat(161));
    expect(screen.getByTestId('count-en')).toHaveTextContent('161 / 480 characters · 2 SMS parts');
    await user.click(textBox('Tamil'));
    await user.paste('சலுகை');
    expect(screen.getByTestId('count-ta')).toHaveTextContent('5 / 480 characters · 1 SMS part');
    expect(screen.getByLabelText('Tamil preview').textContent).toBe('சலுகை');
    expect(textBox('Sinhala')).toHaveAttribute('maxLength', '480');
  });

  it('lists sent offers and campaign runs on the History tab with who, audience, counts and the texts', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) =>
      method === 'GET' && path.startsWith('/admin/sms-campaigns/history')
        ? respond({
            items: [
              historyOffer(),
              historyOffer({ id: 'so2', audience_label: 'Signed up, never ordered', messages: { si: null, ta: null, en: 'Rice 10% off today only' }, recipients: 8, sms_parts: 8, sent_by_name: 'Ops Person' }),
              historyRun(),
            ],
          })
        : null
    );
    await renderAll();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    const table = await screen.findByRole('table', { name: 'Sent history' });
    const [, first, second, run] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('5 Oct 2026');
    expect(first).toHaveTextContent('Offer sent now');
    expect(first).toHaveTextContent('Nawaz Mansoor');
    expect(first).toHaveTextContent('Ordered in the last 30 days');
    expect(first).toHaveTextContent('120');
    expect(first).toHaveTextContent('240');
    expect(second).toHaveTextContent('Ops Person');
    expect(second).toHaveTextContent('Signed up, never ordered');
    expect(run).toHaveTextContent('Friday reminder');
    expect(run).toHaveTextContent('Repeats');
    expect(run).toHaveTextContent('Sent');
    expect(run).toHaveTextContent('3 already got their share, 2 opted out');

    await user.click(within(first!).getByRole('button', { name: /^Show details of Offer sent now/ }));
    const rows = within(table).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('Sinhalaසිංහල දීමනාව');
    expect(rows[2]).toHaveTextContent('Tamilதமிழ் சலுகை');
    expect(rows[2]).toHaveTextContent('EnglishRice 10% off today only');
  });

  it('says so when nothing was sent yet, and shows a history error', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) => (method === 'GET' && path.startsWith('/admin/sms-campaigns/history') ? respond({ items: [] }) : null));
    await renderAll();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Nothing sent yet')).toBeInTheDocument();
  });
});

describe('SMS offers page, English only (launch)', () => {
  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    enabledLanguages = ['en'];
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('shows only the English text, no fallback picker, and sends English with an English fallback', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    renderPage();
    const panel = estimatePanel();
    await within(panel).findByText('35');
    expect(screen.getAllByRole('textbox', { name: / text$/ })).toHaveLength(1);
    expect(textBox('English')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Sinhala text' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Tamil text' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send Tamil test' })).toBeNull();
    expect(screen.queryByLabelText('Customers without a language get')).toBeNull();
    expect(screen.getByTestId('count-en')).toBeInTheDocument();
    expect(screen.queryByTestId('count-si')).toBeNull();

    // Recipients and opted out only: no per-language or "no language" lines.
    expect(panel).toHaveTextContent('Recipients35');
    expect(panel).toHaveTextContent('Opted out3');
    expect(panel).toHaveTextContent('SMS parts70');
    expect(panel).not.toHaveTextContent('Sinhala');
    expect(panel).not.toHaveTextContent('No language');
    expect(screen.getByText(/Write the English text/)).toBeInTheDocument();

    await user.click(textBox('English'));
    await user.paste('Rice 10% off today');
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Offer sent to 35 customers.')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers')).toEqual([
      { audience: { group: 'ALL' }, fallback_language: 'en', messages: { en: 'Rice 10% off today' } },
    ]);
    expect(api.sent('POST', '/admin/sms-offers/estimate').every((b) => b.fallback_language === 'en')).toBe(true);
  });

  it('shows the three texts and the fallback picker once the estimate says all three are on', async () => {
    enabledLanguages = ['si', 'ta', 'en'];
    stubOffers();
    renderPage();
    // Before the first estimate: English only is assumed.
    expect(screen.getAllByRole('textbox', { name: / text$/ })).toHaveLength(1);
    expect(screen.queryByLabelText('Customers without a language get')).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'Sinhala text' })).toBeInTheDocument();
    expect(textBox('Tamil')).toBeInTheDocument();
    expect(textBox('English')).toBeInTheDocument();
    expect(screen.getByLabelText('Customers without a language get')).toHaveValue('en');
    expect(screen.getByRole('button', { name: 'Send Sinhala test' })).toBeInTheDocument();
    expect(estimatePanel()).toHaveTextContent('No language (get English)4');
  });

  it('still shows the Sinhala and Tamil texts of offers sent before', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) =>
      method === 'GET' && path.startsWith('/admin/sms-campaigns/history') ? respond({ items: [historyOffer()] }) : null
    );
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'History' }));
    const table = await screen.findByRole('table', { name: 'Sent history' });
    await user.click(within(table).getByRole('button', { name: /^Show details of Offer sent now/ }));
    const detail = within(table).getAllByRole('row')[2];
    expect(detail).toHaveTextContent('Sinhalaසිංහල දීමනාව');
    expect(detail).toHaveTextContent('Tamilதமிழ் சலுகை');
    expect(detail).toHaveTextContent('EnglishRice 10% off today only');
  });
});

/**
 * The 2026-11-03 additions (owner's brother: no time limits, fully customised, schedules): tabs,
 * placeholder chips, saved templates, custom audience filters, the richer preview, Schedule for,
 * and the new refusals in plain words.
 */
describe('SMS offers page, tabs and compose (2026-11-03)', () => {
  beforeEach(() => {
    tokenStore.save('access', 'refresh');
    enabledLanguages = ['en'];
  });
  afterEach(() => {
    tokenStore.clear();
    vi.unstubAllGlobals();
  });

  it('has the four tabs, Send first, as a keyboard tab list; the other tabs load only when opened', async () => {
    const user = userEvent.setup();
    const api = stubOffers((method, path) => {
      if (method === 'GET' && path.startsWith('/admin/sms-campaigns/history')) return respond({ items: [] });
      if (method === 'GET' && path.startsWith('/admin/sms-campaigns')) return respond({ campaigns: [] });
      if (method === 'GET' && path === '/admin/sms-templates') return respond({ templates: [] });
      return null;
    });
    renderPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Send', 'Scheduled and automatic', 'History', 'Templates']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(screen.getByRole('tabpanel', { name: 'Send' })).toBeInTheDocument();
    expect(api.paths('GET').some((p) => p.startsWith('/admin/sms-campaigns'))).toBe(false);

    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Scheduled and automatic' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Scheduled and automatic' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Nothing scheduled yet')).toBeInTheDocument();
    expect(api.paths('GET')).toContain('/admin/sms-campaigns');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveFocus();
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Send' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Send' })).toHaveFocus();
    // The sending rules are one click away.
    expect(screen.getByRole('link', { name: 'SMS sending rules' })).toHaveAttribute('href', '/settings#sms-sending-rules');
  });

  it('keeps a half-written offer when another tab is opened and closed again', async () => {
    const user = userEvent.setup();
    stubOffers((method, path) => (method === 'GET' && path.startsWith('/admin/sms-campaigns') ? respond({ campaigns: [], items: [] }) : null));
    renderPage();
    await user.click(textBox('English'));
    await user.paste('Half written');
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.queryByRole('textbox', { name: 'English text' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Send' }));
    expect(textBox('English')).toHaveValue('Half written');
  });

  it('inserts {name} {points} {wallet} {app_link} at the cursor, shows an example, and sends the words as written', async () => {
    const user = userEvent.setup();
    const api = stubOffers();
    renderPage();
    const box = textBox('English') as HTMLTextAreaElement;
    for (const token of ['{name}', '{points}', '{wallet}', '{app_link}']) {
      expect(screen.getByRole('button', { name: `Insert ${token} in the English text` })).toBeInTheDocument();
    }
    await user.click(box);
    await user.paste('Hi , you have  points');
    box.setSelectionRange(3, 3);
    await user.click(screen.getByRole('button', { name: 'Insert {name} in the English text' }));
    expect(box).toHaveValue('Hi {name}, you have  points');
    // The cursor is put back after the new word on the next frame; let that happen before moving it.
    await waitFor(() => expect(box.selectionStart).toBe('Hi {name}'.length));
    const at = 'Hi {name}, you have '.length;
    box.setSelectionRange(at, at);
    await user.click(screen.getByRole('button', { name: 'Insert {points} in the English text' }));
    expect(box).toHaveValue('Hi {name}, you have {points} points');
    await waitFor(() => expect(box.selectionStart).toBe('Hi {name}, you have {points}'.length));
    box.setSelectionRange(box.value.length, box.value.length);
    await user.click(screen.getByRole('button', { name: 'Insert {app_link} in the English text' }));
    expect(box.value.endsWith('{app_link}')).toBe(true);

    // An example customer (Nimal, 120 points) as the preview.
    expect(screen.getByLabelText('English preview')).toHaveTextContent('Hi Nimal, you have 120 pointshttps://blynk.lk/app');
    expect(screen.getByText(/Customers receive \(example: Nimal, 120 points\)/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.sent('POST', '/admin/sms-offers/estimate').at(-1)).toMatchObject({
        messages: { en: 'Hi {name}, you have {points} points{app_link}' },
      })
    );
  });

  it('picks a saved template into the texts, and saves the written texts as a template', async () => {
    const user = userEvent.setup();
    const saved: Array<Record<string, unknown>> = [];
    const stored = (name: unknown, en: string, id: string) => ({ id, name, messages: { si: null, ta: null, en }, created_by_name: 'Nawaz' });
    const api = stubOffers((method, path, body) => {
      if (method === 'GET' && path === '/admin/sms-templates') {
        return respond({
          templates: [stored('Weekend rice', 'Rice 10% off, {name}', 't1'), ...saved.map((t, i) => stored(t.name, (t.messages as { en: string }).en, `n${i}`))],
        });
      }
      if (method === 'POST' && path === '/admin/sms-templates') {
        saved.push(body!);
        return respond({ template: stored(body!.name, (body!.messages as { en: string }).en, 'n0') }, 201);
      }
      return null;
    });
    renderPage();
    const picker = await screen.findByRole('combobox', { name: 'Saved template' });
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'Weekend rice' })).toBeInTheDocument());
    await user.selectOptions(picker, 't1');
    expect(textBox('English')).toHaveValue('Rice 10% off, {name}');

    // Save what is written under a new name.
    await user.clear(textBox('English'));
    await user.click(textBox('English'));
    await user.paste('Fish today, {name}');
    await user.click(screen.getByRole('button', { name: 'Save as template' }));
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Give the template a name.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Template name' }), 'Fish day');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Saved the template "Fish day".')).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-templates')).toEqual([{ name: 'Fish day', messages: { en: 'Fish today, {name}' } }]);
    expect(within(screen.getByRole('combobox', { name: 'Saved template' })).getByRole('option', { name: 'Fish day' })).toBeInTheDocument();
  });

  it('builds the custom audience: areas, orders, spend with days, language, points and last order days', async () => {
    const user = userEvent.setup();
    const api = stubOffers((method, path) =>
      method === 'GET' && path === '/admin/sms-offers/areas'
        ? respond({ areas: [{ name: 'Kalutara', customers: 40 }, { name: 'Beruwala', customers: 1 }] })
        : null
    );
    renderPage();
    await user.selectOptions(screen.getByLabelText('Send to'), 'CUSTOM');
    const f = within(screen.getByRole('group', { name: 'Custom filters' }));
    // Nothing filled in yet: the same as everyone.
    await waitFor(() =>
      expect(api.sent('POST', '/admin/sms-offers/estimate')).toContainEqual({ audience: { group: 'CUSTOM' }, fallback_language: 'en', messages: {} })
    );

    const add = f.getByRole('combobox', { name: 'Add an area' });
    await waitFor(() => expect(within(add).getByRole('option', { name: 'Kalutara (40 customers)' })).toBeInTheDocument());
    expect(within(add).getByRole('option', { name: 'Beruwala (1 customer)' })).toBeInTheDocument();
    await user.selectOptions(add, 'Kalutara');
    await user.selectOptions(f.getByRole('combobox', { name: 'Add an area' }), 'Beruwala');
    expect(f.getByRole('list', { name: 'Chosen areas' })).toHaveTextContent('Kalutara×Beruwala×');
    await user.click(f.getByRole('button', { name: 'Remove Beruwala' }));
    expect(f.getByRole('list', { name: 'Chosen areas' })).not.toHaveTextContent('Beruwala');

    await user.type(f.getByLabelText('Minimum orders'), '2');
    await user.type(f.getByLabelText('Maximum orders'), '5');
    await user.type(f.getByLabelText('Spent at least (LKR)'), '5000');
    await user.clear(f.getByLabelText('Spend counted over the last (days)'));
    await user.type(f.getByLabelText('Spend counted over the last (days)'), '30');
    await user.selectOptions(f.getByLabelText('SMS language'), 'ta');
    await user.type(f.getByLabelText('Minimum points'), '100');
    await user.type(f.getByLabelText('Maximum points'), '500');
    await user.type(f.getByLabelText('Last order at least (days ago)'), '3');
    await user.type(f.getByLabelText('Last order at most (days ago)'), '30');

    const expected = {
      group: 'CUSTOM',
      areas: ['Kalutara'],
      min_orders: 2,
      max_orders: 5,
      min_spend_lkr: 5000,
      spend_days: 30,
      language: 'ta',
      min_points: 100,
      max_points: 500,
      last_order_days_min: 3,
      last_order_days_max: 30,
    };
    await waitFor(() => expect(api.sent('POST', '/admin/sms-offers/estimate').at(-1)).toEqual({ audience: expected, fallback_language: 'en', messages: {} }));

    // A range the wrong way round is explained and nothing is estimated for it.
    await user.clear(f.getByLabelText('Maximum orders'));
    await user.type(f.getByLabelText('Maximum orders'), '1');
    expect(await screen.findByText('Minimum orders cannot be more than the maximum.')).toBeInTheDocument();
    const before = api.sent('POST', '/admin/sms-offers/estimate').length;
    await new Promise((r) => setTimeout(r, 600));
    expect(api.sent('POST', '/admin/sms-offers/estimate')).toHaveLength(before);
  });

  it('shows the preview: language split, who is left out, parts, budget, samples and a sending warning', async () => {
    enabledLanguages = ['si', 'ta', 'en'];
    stubOffers((_m, path, body) =>
      path === '/admin/sms-offers/estimate'
        ? respond({
            estimate: estimateFor(body, {
              skipped_capped: 6,
              skipped_no_phone: 2,
              budget: { monthly_parts: 5000, used_parts: 4950, remaining_parts: 50, would_exceed: true },
              sending: {
                allowed: false,
                code: 'QUIET_HOURS',
                message: 'SMS are not sent between 10 PM and 7 AM (quiet hours in SMS sending rules).',
                resume_at: '2026-11-04T01:30:00.000Z',
              },
              samples: [
                { language: 'en', text: 'Hi Nimal, rice is 10% off', parts: 1 },
                { language: 'ta', text: 'வணக்கம் Nimal', parts: 1 },
              ],
            }),
          })
        : null
    );
    renderPage();
    const panel = estimatePanel();
    await within(panel).findByText('Skipped: already got their share');
    expect(panel).toHaveTextContent('Skipped: already got their share6');
    expect(panel).toHaveTextContent('Skipped: no usable number2');
    expect(panel).toHaveTextContent('Budget left this month50 of 5000');
    expect(within(panel).getByTestId('budget-warning')).toHaveTextContent('This needs 70 SMS parts but only 50 are left in this month');
    expect(within(panel).getByTestId('sending-notice')).toHaveTextContent('quiet hours in SMS sending rules');
    expect(within(panel).getByTestId('sending-notice')).toHaveTextContent('They can go out again from 4 Nov 2026 07:00.');
    const samples = within(panel).getByLabelText('Sample texts');
    expect(samples).toHaveTextContent('English, 1 SMS partHi Nimal, rice is 10% off');
    expect(samples).toHaveTextContent('Tamil, 1 SMS partவணக்கம் Nimal');
  });

  it('schedules the offer for a date and time (Sri Lanka time) with send_at, and refuses a time in the past', async () => {
    const user = userEvent.setup();
    const api = stubOffers((method, path) =>
      method === 'POST' && path === '/admin/sms-offers'
        ? respond({ campaign: { id: 'c9', name: 'Scheduled offer', kind: 'ONCE', status: 'ACTIVE' } }, 201)
        : null
    );
    renderPage();
    await user.click(textBox('English'));
    await user.paste('Rice 10% off today');
    expect(screen.getByRole('button', { name: 'Send now' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Schedule for' }));
    const schedule = screen.getByRole('button', { name: 'Schedule offer' });
    // No time yet.
    expect(schedule).toBeDisabled();
    const at = screen.getByLabelText('Send at');
    fireEvent.change(at, { target: { value: '2020-01-01T09:00' } });
    expect(await screen.findByText('Pick a time in the future.')).toBeInTheDocument();
    expect(schedule).toBeDisabled();
    fireEvent.change(at, { target: { value: '2099-12-01T18:30' } });
    await user.type(screen.getByLabelText('Name'), 'December rice');
    await waitFor(() => expect(schedule).toBeEnabled());
    await user.click(schedule);
    const dialog = screen.getByRole('dialog', { name: 'Schedule offer' });
    expect(dialog).toHaveTextContent('Send on 1 Dec 2099 18:30 (Sri Lanka time)');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByText(/Offer scheduled for 1 Dec 2099 18:30 \(Sri Lanka time\)/)).toBeInTheDocument();
    expect(api.sent('POST', '/admin/sms-offers')).toEqual([
      {
        audience: { group: 'ALL' },
        fallback_language: 'en',
        messages: { en: 'Rice 10% off today' },
        send_at: '2099-12-01T18:30:00+05:30',
        name: 'December rice',
      },
    ]);
    // The estimate never carries the schedule.
    expect(api.sent('POST', '/admin/sms-offers/estimate').every((b) => !('send_at' in b))).toBe(true);
    expect(textBox('English')).toHaveValue('');
  });

  it.each([
    [
      'UNKNOWN_PLACEHOLDER',
      400,
      { unknown: ['{nam}', '{x}'], allowed: ['{name}', '{points}', '{wallet}', '{app_link}'] },
      '{nam}, {x} are not a placeholder. You can use {name}, {points}, {wallet}, {app_link}.',
    ],
    [
      'TEXT_TOO_LONG',
      400,
      { language: 'en', longest: 512, max: 480 },
      'The English text can be up to 512 characters once the name, points and wallet are filled in. Keep it under 480.',
    ],
    [
      'SMS_BUDGET_EXCEEDED',
      422,
      { needed_parts: 90, remaining_parts: 40, monthly_parts: 5000 },
      "This needs 90 SMS parts but only 40 are left in this month's budget of 5000. Raise the budget in SMS sending rules, or send to fewer customers.",
    ],
    ['QUIET_HOURS', 422, { resume_at: '2026-11-04T01:30:00.000Z' }, 'SMS are not sent between 10 PM and 7 AM. Sending is allowed again from 07:00.'],
    [
      'OFFER_NO_RECIPIENTS',
      400,
      { skipped_capped: 4 },
      'No customer in this audience can receive offers. 4 customers were left out because they already got their share of SMS',
    ],
  ])('shows %s from the API in plain words when sending', async (code, status, details, text) => {
    const user = userEvent.setup();
    stubOffers((method, path) =>
      method === 'POST' && path === '/admin/sms-offers' ? respond({ code, message: 'SMS are not sent between 10 PM and 7 AM.', details }, status as number) : null
    );
    renderPage();
    await user.click(textBox('English'));
    await user.paste('Hello {nam}');
    const send = screen.getByRole('button', { name: 'Send offer' });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);
    await user.click(within(screen.getByRole('dialog', { name: 'Send offer' })).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(text as string);
    expect(textBox('English')).toHaveValue('Hello {nam}');
  });

  it('shows a schedule problem (a past time) from the API as its own words', () => {
    const err = new ApiError('Request validation failed', 400, 'VALIDATION_ERROR', [{ field: 'schedule.send_at', message: 'Pick a time in the future' }]);
    expect(smsOfferErrorMessage(err, 'x')).toBe('Pick a time in the future');
    expect(smsOfferErrorMessage(new ApiError('bad', 400, 'VALIDATION_ERROR', [{ field: 'messages.en', message: 'too long' }]), 'x')).toBe(
      'Check the texts: each can be up to 480 characters.'
    );
  });
});
