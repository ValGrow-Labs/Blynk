import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { TestCustomersSetting } from '../api/types';
import { maskTesterPhone, normaliseTesterPhone, readTesterEntries } from '../lib/testCustomers';
import { OPERATIONS_STAFF, fail, moreSettings, ok, renderAs, type Call } from './helpers';

/**
 * Test customers (Google Play testers, 2026-11-06) in Operations: the More > Customers and rewards card. Staff paste
 * numbers, see how many were read and which cannot be, save; the saved numbers show masked with a Remove that saves at
 * once. Numbers here are made up.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const LIST = (phones: string[]): TestCustomersSetting => ({ phones, count: phones.length, max: 50, updated_at: null });

function handlers(initial: string[] = [], extra: (call: Call) => unknown = () => undefined) {
  let phones = initial;
  return {
    'GET /admin/settings/test-customers': (c: Call) => extra(c) ?? ok(LIST(phones)),
    'PUT /admin/settings/test-customers': (c: Call) => {
      const r = extra(c);
      if (r) return r;
      phones = c.body.phones;
      return ok(LIST(phones));
    },
  };
}

async function openCard(h: Record<string, (c: Call) => unknown>) {
  const rendered = renderAs(OPERATIONS_STAFF, moreSettings('customers'), h);
  const card = (await screen.findByRole('heading', { name: 'Test customers (Play testers)' })).closest('section') as HTMLElement;
  await within(card).findByTestId('test-customers-saved-count');
  return { ...rendered, card };
}

describe('test customers lib', () => {
  it('reads the accepted formats', () => {
    for (const raw of ['712345678', '0712345678', '94712345678', '+94712345678', ' 071 234-5678 ']) {
      expect(normaliseTesterPhone(raw)).toBe('+94712345678');
    }
    for (const raw of ['', 'abc', '0112345678', '07123456', '+44712345678']) expect(normaliseTesterPhone(raw)).toBeNull();
  });

  it('splits pasted text by lines, commas and spaces, de-duplicates and lists what it cannot read', () => {
    const read = readTesterEntries('0700000001, 070 000 0002\n+94700000003 0700000004;700000001\n\nhello 123');
    expect(read.numbers).toEqual(['+94700000001', '+94700000002', '+94700000003', '+94700000004']);
    expect(read.unreadable).toEqual(['hello', '123']);
  });

  it('masks a number to its last 3 digits', () => {
    expect(maskTesterPhone('+94712345839')).toBe('+94 7X XXX X839');
  });
});

describe('More > Customers and rewards > Test customers card', () => {
  it('has the plain help text and loads the saved list masked, never in full', async () => {
    const { card } = await openCard(handlers(['+94700000839', '+94700000112']));
    expect(card).toHaveTextContent(
      'People on this list can place test orders any time, from any address, cash on delivery only. Their orders are cancelled automatically after about 10 minutes and staff are not alerted. Use it for Google Play testers.'
    );
    expect(within(card).getByTestId('test-customers-saved-count')).toHaveTextContent('On the list: 2 of 50');
    expect(within(card).getByText('+94 7X XXX X839')).toBeInTheDocument();
    expect(within(card).getByText('+94 7X XXX X112')).toBeInTheDocument();
    expect(card.textContent).not.toContain('700000839');
    expect(card.textContent).not.toContain('+94700000');
  });

  it('shows a live count and the entries it cannot read, and refuses to save while there are any', async () => {
    const user = userEvent.setup();
    const { card, api } = await openCard(handlers());
    await user.click(within(card).getByLabelText(/Add numbers/));
    await user.paste('0700000001\n+94700000002, nonsense');
    expect(within(card).getByTestId('test-customers-count')).toHaveTextContent('2 numbers read');
    expect(within(card).getByTestId('test-customers-unreadable')).toHaveTextContent('Cannot read: nonsense');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText(/Some entries cannot be read/)).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/test-customers')).toHaveLength(0);
  });

  it('asks for a number when the box is empty', async () => {
    const user = userEvent.setup();
    const { card, api } = await openCard(handlers());
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('Paste at least one phone number.')).toBeInTheDocument();
    expect(api.find('PUT', '/admin/settings/test-customers')).toHaveLength(0);
  });

  it('saves the pasted numbers added to the saved ones (normalised, no repeats), clears the box and shows the new count masked', async () => {
    const user = userEvent.setup();
    const { card, api } = await openCard(handlers(['+94700000111']));
    await user.click(within(card).getByLabelText(/Add numbers/));
    await user.paste('0700000222 700000222\n94700000111, +94700000333');
    expect(within(card).getByTestId('test-customers-count')).toHaveTextContent('3 numbers read');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/test-customers')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/test-customers')[0].body).toEqual({
      phones: ['+94700000111', '+94700000222', '+94700000333'],
    });
    expect(await within(card).findByText('Saved. 3 test customers on the list.')).toBeInTheDocument();
    expect(within(card).getByTestId('test-customers-saved-count')).toHaveTextContent('On the list: 3 of 50');
    expect(within(card).getByLabelText(/Add numbers/)).toHaveValue('');
    expect(within(card).getByText('+94 7X XXX X333')).toBeInTheDocument();
    expect(card.textContent).not.toContain('700000333');
  });

  it('shows the server message when the save is refused, and keeps what was typed', async () => {
    const user = userEvent.setup();
    const { card } = await openCard(
      handlers([], (c) =>
        c.method === 'PUT' ? fail(400, 'INVALID_TEST_NUMBERS', 'These numbers are not Sri Lankan mobile numbers: 0112345678.') : undefined
      )
    );
    await user.click(within(card).getByLabelText(/Add numbers/));
    await user.paste('0700000001');
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByText('These numbers are not Sri Lankan mobile numbers: 0112345678.')).toBeInTheDocument();
    expect(within(card).getByLabelText(/Add numbers/)).toHaveValue('0700000001');
  });

  it('shows the load error when the list cannot be read', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('customers'), handlers([], (c) => (c.method === 'GET' ? fail(400, 'BAD', 'The list is unavailable') : undefined)));
    expect(await screen.findByText('The list is unavailable')).toBeInTheDocument();
  });

  it('removes a number after a confirm and saves at once; Cancel keeps it', async () => {
    const user = userEvent.setup();
    const { card, api } = await openCard(handlers(['+94700000111', '+94700000222']));

    await user.click(within(card).getByRole('button', { name: 'Remove +94 7X XXX X111' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove this number?' });
    expect(dialog).toHaveTextContent('+94 7X XXX X111');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.find('PUT', '/admin/settings/test-customers')).toHaveLength(0);
    expect(within(card).getByText('+94 7X XXX X111')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Remove +94 7X XXX X111' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Remove this number?' })).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.find('PUT', '/admin/settings/test-customers')).toHaveLength(1));
    expect(api.find('PUT', '/admin/settings/test-customers')[0].body).toEqual({ phones: ['+94700000222'] });
    expect(await within(card).findByText('Removed. 1 test customer on the list.')).toBeInTheDocument();
    expect(within(card).queryByText('+94 7X XXX X111')).toBeNull();
    expect(within(card).getByText('+94 7X XXX X222')).toBeInTheDocument();
  });

  it('shows the server message when a remove is refused, and keeps the number', async () => {
    const user = userEvent.setup();
    const { card } = await openCard(handlers(['+94700000111'], (c) => (c.method === 'PUT' ? fail(422, 'REFUSED', 'Could not save the list right now') : undefined)));
    await user.click(within(card).getByRole('button', { name: 'Remove +94 7X XXX X111' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await within(card).findByText('Could not save the list right now')).toBeInTheDocument();
    expect(within(card).getByText('+94 7X XXX X111')).toBeInTheDocument();
  });
});
