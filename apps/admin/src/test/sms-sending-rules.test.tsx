import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../components/ui';
import { SmsSendingRulesCard } from '../components/SmsSendingRulesCard';
import { tokenStore } from '../api/client';
import type { SmsLimitsSetting, SmsSendingSetting } from '../api/types';
import { fail, mockApi, ok } from './mockApi';

/**
 * Settings > Customers and rewards > SMS sending rules (2026-11-03): send at any time or quiet hours
 * (GET|PUT /admin/settings/sms-sending), a cap per customer and a monthly budget
 * (GET|PUT /admin/settings/sms-limits). The API decides what a rule does; here, what the card asks
 * for and says. The category count is in settings-categories.test.tsx.
 */

const sendingSetting = (overrides: Partial<SmsSendingSetting> = {}): SmsSendingSetting => ({
  any_time: true,
  quiet_hours: { enabled: false, start: '22:00', end: '07:00' },
  updated_at: null,
  sending_now: { allowed: true, code: null, message: null, resume_at: null },
  ...overrides,
});

const limitsSetting = (overrides: Partial<SmsLimitsSetting> = {}): SmsLimitsSetting => ({
  per_customer: { enabled: false, max: 1, days: 7 },
  monthly_budget: { enabled: false, parts: 5000 },
  updated_at: null,
  usage: { month: '2026-11', month_starts_at: '2026-10-31T18:30:00.000Z', parts_used: 1250, remaining_parts: null },
  ...overrides,
});

function setup(sending = sendingSetting(), limits = limitsSetting(), extra: Parameters<typeof mockApi>[0] = () => undefined) {
  tokenStore.save('access', 'refresh');
  const state = { sending, limits };
  const api = mockApi((c) => {
    const custom = extra(c);
    if (custom) return custom;
    if (c.method === 'GET' && c.path === '/admin/settings/sms-sending') return ok(state.sending);
    if (c.method === 'GET' && c.path === '/admin/settings/sms-limits') return ok(state.limits);
    if (c.method === 'PUT' && c.path === '/admin/settings/sms-sending') {
      state.sending = sendingSetting({
        any_time: c.body.any_time,
        quiet_hours: c.body.quiet_hours,
        updated_at: '2026-11-03T05:00:00.000Z',
      });
      return ok(state.sending);
    }
    if (c.method === 'PUT' && c.path === '/admin/settings/sms-limits') {
      state.limits = limitsSetting({
        per_customer: c.body.per_customer,
        monthly_budget: c.body.monthly_budget,
        updated_at: '2026-11-03T05:00:00.000Z',
        usage: {
          month: '2026-11',
          month_starts_at: '2026-10-31T18:30:00.000Z',
          parts_used: 1250,
          remaining_parts: c.body.monthly_budget.enabled ? c.body.monthly_budget.parts - 1250 : null,
        },
      });
      return ok(state.limits);
    }
    return undefined;
  });
  render(
    <ToastProvider>
      <SmsSendingRulesCard />
    </ToastProvider>
  );
  return api;
}

const card = () => screen.findByRole('region', { name: 'SMS sending rules' });

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

describe('SMS sending rules card', () => {
  it('says the admin decides, and shows the defaults: any time, no quiet hours, no limits', async () => {
    const api = setup();
    const c = within(await card());
    expect(await c.findByText('The admin decides: nothing is limited unless you switch it on.', { exact: false })).toBeInTheDocument();
    expect(c.getByRole('switch', { name: 'Send at any time' })).toHaveAttribute('aria-checked', 'true');
    expect(c.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
    expect(c.getByRole('switch', { name: 'Limit texts per customer' })).toHaveAttribute('aria-checked', 'false');
    expect(c.getByRole('switch', { name: 'Monthly SMS budget' })).toHaveAttribute('aria-checked', 'false');
    // The inputs wait until their switch is on.
    expect(c.getByLabelText('Quiet from')).toBeDisabled();
    expect(c.getByLabelText('Texts per customer')).toBeDisabled();
    expect(c.getByLabelText('SMS parts per month')).toBeDisabled();
    expect(c.getByTestId('sms-sending-now')).toHaveTextContent('Right now texts can go out.');
    expect(c.getByTestId('sms-usage')).toHaveTextContent('This month (2026-11): 1,250 SMS parts used (no budget set).');
    expect(api.find('GET', '/admin/settings/sms-sending')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/sms-limits')).toHaveLength(1);
  });

  it('saves "send at any time" and the quiet hours through PUT /settings/sms-sending', async () => {
    const user = userEvent.setup();
    const api = setup();
    const c = within(await card());
    await c.findByRole('switch', { name: 'Send at any time' });
    await user.click(c.getByRole('switch', { name: 'Send at any time' }));
    await user.click(c.getByRole('switch', { name: 'Quiet hours' }));
    fireEvent.change(c.getByLabelText('Quiet from'), { target: { value: '21:00' } });
    fireEvent.change(c.getByLabelText('Quiet until'), { target: { value: '06:30' } });
    await user.click(c.getByRole('button', { name: 'Save sending times' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-sending')[0]!.body).toEqual({
      any_time: false,
      quiet_hours: { enabled: true, start: '21:00', end: '06:30' },
    });
    expect(await screen.findByText('SMS sending times saved.')).toBeInTheDocument();
    expect(c.getByRole('switch', { name: 'Send at any time' })).toHaveAttribute('aria-checked', 'false');
    expect(c.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'true');
    expect(await c.findByText(/^Changed /)).toBeInTheDocument();
    // The limits are a separate save: nothing was sent for them.
    expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(0);
  });

  it('refuses quiet hours that start and end together, and shows what the API refuses', async () => {
    const user = userEvent.setup();
    const api = setup(sendingSetting(), limitsSetting(), (c) =>
      c.method === 'PUT' && c.path === '/admin/settings/sms-sending' && c.body.quiet_hours.end === '23:00'
        ? fail(400, 'VALIDATION_ERROR', 'Request validation failed', [{ field: 'quiet_hours.end', message: 'Quiet hours must start and end at different times' }])
        : undefined
    );
    const c = within(await card());
    await c.findByRole('switch', { name: 'Quiet hours' });
    await user.click(c.getByRole('switch', { name: 'Quiet hours' }));
    fireEvent.change(c.getByLabelText('Quiet until'), { target: { value: '22:00' } });
    await user.click(c.getByRole('button', { name: 'Save sending times' }));
    expect(await c.findByText('Quiet hours must start and end at different times.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(0);
    fireEvent.change(c.getByLabelText('Quiet until'), { target: { value: '23:00' } });
    await user.click(c.getByRole('button', { name: 'Save sending times' }));
    expect(await c.findByText('Quiet hours must start and end at different times')).toBeInTheDocument();
  });

  it('saves the per-customer cap and the monthly budget through PUT /settings/sms-limits, with this month’s usage', async () => {
    const user = userEvent.setup();
    const api = setup();
    const c = within(await card());
    await c.findByRole('switch', { name: 'Limit texts per customer' });
    await user.click(c.getByRole('switch', { name: 'Limit texts per customer' }));
    await user.clear(c.getByLabelText('Texts per customer'));
    await user.type(c.getByLabelText('Texts per customer'), '2');
    await user.clear(c.getByLabelText('Within days'));
    await user.type(c.getByLabelText('Within days'), '14');
    await user.click(c.getByRole('switch', { name: 'Monthly SMS budget' }));
    await user.clear(c.getByLabelText('SMS parts per month'));
    await user.type(c.getByLabelText('SMS parts per month'), '8000');
    await user.click(c.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-limits')[0]!.body).toEqual({
      per_customer: { enabled: true, max: 2, days: 14 },
      monthly_budget: { enabled: true, parts: 8000 },
    });
    expect(await screen.findByText('SMS limits saved.')).toBeInTheDocument();
    expect(c.getByTestId('sms-usage')).toHaveTextContent('This month (2026-11): 1,250 SMS parts used, 6,750 left of 8,000.');
    expect(c.getByRole('switch', { name: 'Monthly SMS budget' })).toHaveAttribute('aria-checked', 'true');
    expect(c.getByLabelText('Texts per customer')).toHaveValue(2);
    expect(api.find('PUT', '/admin/settings/sms-sending')).toHaveLength(0);
  });

  it('switching a limit off sends it as off and keeps the numbers', async () => {
    const user = userEvent.setup();
    const api = setup(
      sendingSetting(),
      limitsSetting({ per_customer: { enabled: true, max: 3, days: 30 }, monthly_budget: { enabled: true, parts: 9000 }, usage: { month: '2026-11', month_starts_at: '2026-10-31T18:30:00.000Z', parts_used: 100, remaining_parts: 8900 } })
    );
    const c = within(await card());
    await waitFor(() => expect(c.getByRole('switch', { name: 'Limit texts per customer' })).toHaveAttribute('aria-checked', 'true'));
    expect(c.getByTestId('sms-usage')).toHaveTextContent('100 SMS parts used, 8,900 left of 9,000.');
    await user.click(c.getByRole('switch', { name: 'Limit texts per customer' }));
    await user.click(c.getByRole('button', { name: 'Save limits' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/sms-limits')[0]!.body).toEqual({
      per_customer: { enabled: false, max: 3, days: 30 },
      monthly_budget: { enabled: true, parts: 9000 },
    });
  });

  it('checks the limit numbers before saving', async () => {
    const user = userEvent.setup();
    const api = setup();
    const c = within(await card());
    await c.findByRole('switch', { name: 'Limit texts per customer' });
    await user.click(c.getByRole('switch', { name: 'Limit texts per customer' }));
    await user.clear(c.getByLabelText('Texts per customer'));
    await user.type(c.getByLabelText('Texts per customer'), '0');
    await user.click(c.getByRole('button', { name: 'Save limits' }));
    expect(await c.findByText('Texts per customer must be a whole number from 1 to 100.')).toBeInTheDocument();
    await user.clear(c.getByLabelText('Texts per customer'));
    await user.type(c.getByLabelText('Texts per customer'), '2');
    await user.clear(c.getByLabelText('Within days'));
    await user.type(c.getByLabelText('Within days'), '400');
    await user.click(c.getByRole('button', { name: 'Save limits' }));
    expect(await c.findByText('Days must be a whole number from 1 to 365.')).toBeInTheDocument();
    await user.click(c.getByRole('switch', { name: 'Limit texts per customer' }));
    await user.click(c.getByRole('switch', { name: 'Monthly SMS budget' }));
    await user.clear(c.getByLabelText('SMS parts per month'));
    await user.click(c.getByRole('button', { name: 'Save limits' }));
    expect(await c.findByText(/The monthly SMS budget must be a whole number of parts/)).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/sms-limits')).toHaveLength(0);
  });

  it('says when texts are being held right now, and until when', async () => {
    setup(
      sendingSetting({
        quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
        sending_now: {
          allowed: false,
          code: 'QUIET_HOURS',
          message: 'SMS are not sent between 10 PM and 7 AM (quiet hours in SMS sending rules).',
          resume_at: '2026-11-04T01:30:00.000Z',
        },
      })
    );
    const c = within(await card());
    expect(await c.findByTestId('sms-sending-now')).toHaveTextContent(
      'Right now texts are held: SMS are not sent between 10 PM and 7 AM (quiet hours in SMS sending rules). They can go out again from 4 Nov 2026 07:00.'
    );
    expect(c.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'true');
    expect(c.getByLabelText('Quiet from')).toHaveValue('22:00');
    expect(c.getByLabelText('Quiet until')).toHaveValue('07:00');
  });

  it('shows a load error', async () => {
    setup(sendingSetting(), limitsSetting(), (c) => (c.path === '/admin/settings/sms-limits' ? fail(500, 'SERVER_ERROR', 'The limits could not be loaded.') : undefined));
    expect(await screen.findByText('The limits could not be loaded.')).toBeInTheDocument();
  });
});
