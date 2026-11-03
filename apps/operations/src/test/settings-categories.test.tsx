import { cleanup, configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { OPERATIONS_STAFF, moreSettings, renderAs } from './helpers';

/**
 * More -> Settings (owner's brother, 2026-11-03): the settings sit in categories
 * (Deliveries, Riders, Orders and payments, Customers and rewards, App) behind a
 * row of chips. Only the open category is mounted; the category lives in the URL
 * hash; every card's own anchor opens the category that holds it.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NAMES = ['Deliveries', 'Riders', 'Orders and payments', 'Customers and rewards', 'App'] as const;
const COUNTS = [7, 3, 4, 5, 2];

const tabOf = async (name: string) => screen.findByRole('tab', { name: new RegExp(`^${name}`) });
const selectedTab = async () => {
  const tabs = await screen.findAllByRole('tab');
  return tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
};

describe('More settings categories', () => {
  it('shows the five category chips in order, with their counts, Deliveries selected by default', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    const list = await screen.findByRole('tablist', { name: 'Settings categories' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.firstChild?.textContent)).toEqual([...NAMES]);
    tabs.forEach((t, i) => expect(within(t).getByLabelText(`${COUNTS[i]} settings`)).toHaveTextContent(String(COUNTS[i])));
    expect(await selectedTab()).toEqual([tabs[0]]);
    expect(screen.getByRole('heading', { name: 'Settings', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('Everything about getting an order to the customer: hours, fees, areas and riders on the road.')).toBeInTheDocument();
  });

  it('Deliveries holds the delivery cards and nothing from the other categories', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    for (const name of ['Delivery fee', 'Small-order fee', 'Delivery radius', 'Extra delivery areas', 'Rider trips', 'Automatic rider assignment']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Opening hours' })).toHaveAttribute('href', '/more/opening-hours');
    for (const name of ['Checkout', 'Cart rules', 'Rider commission', 'Customer SMS language', 'App updates']) {
      expect(screen.queryByRole('heading', { name, level: 2 })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Rider pay' })).toBeNull();
  });

  it('each other category shows its own cards and link tiles', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');

    await user.click(await tabOf('Riders'));
    expect(await screen.findByRole('heading', { name: 'Rider commission', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rider pay' })).toHaveAttribute('href', '/more/rider-pay');
    expect(screen.getByRole('link', { name: 'Rider documents' })).toHaveAttribute('href', '/more/rider-documents');
    expect(screen.queryByRole('heading', { name: 'Delivery fee' })).toBeNull();

    await user.click(await tabOf('Orders and payments'));
    for (const name of ['Checkout', 'Cart rules', 'Online payments (PayHere)', 'Global default markup']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Rider commission' })).toBeNull();

    await user.click(await tabOf('Customers and rewards'));
    expect(await screen.findByRole('heading', { name: 'Customer SMS language', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Birthday offer' })).toHaveAttribute('href', '/more/birthday-offer');
    expect(screen.getByRole('link', { name: 'Refer a friend' })).toHaveAttribute('href', '/more/refer-a-friend');
    expect(screen.getByRole('link', { name: 'Blynk Points' })).toHaveAttribute('href', '/more/points');
    expect(screen.getByRole('link', { name: 'Blynk Wallet' })).toHaveAttribute('href', '/more/wallet');

    await user.click(await tabOf('App'));
    expect(await screen.findByRole('heading', { name: 'App updates', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'App version', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Customer SMS language' })).toBeNull();
  });

  it('switching a chip selects it, swaps the description and the cards', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    await screen.findByRole('heading', { name: 'Delivery fee' });
    const orders = await tabOf('Orders and payments');
    await user.click(orders);
    await waitFor(() => expect(orders).toHaveAttribute('aria-selected', 'true'));
    expect(await selectedTab()).toEqual([orders]);
    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delivery fee' })).toBeNull();
    expect(screen.queryByText(/^Everything about getting an order to the customer/)).toBeNull();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', orders.id);
    expect(screen.getByText(/How customers check out and pay/)).toBeInTheDocument();
    // and back
    await user.click(await tabOf('Deliveries'));
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
  });

  it('opens a category from /more#settings-<id>; unknown values open Deliveries', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('riders'));
    expect(await screen.findByRole('heading', { name: 'Rider commission' })).toBeInTheDocument();
    expect((await selectedTab())[0]).toHaveTextContent(/^Riders/);
    cleanup();

    renderAs(OPERATIONS_STAFF, '/more#settings-nope');
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
    expect((await selectedTab())[0]).toHaveTextContent(/^Deliveries/);
    cleanup();

    renderAs(OPERATIONS_STAFF, '/more#something-else');
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
    expect((await selectedTab())[0]).toHaveTextContent(/^Deliveries/);
  });

  it('deep links to a card open its category and scroll to it', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll as unknown as typeof Element.prototype.scrollIntoView;
    const cases: Array<[string, RegExp, string]> = [
      ['checkout-settings', /^Orders and payments/, 'Checkout'],
      ['default-markup', /^Orders and payments/, 'Global default markup'],
      ['cart-rules', /^Orders and payments/, 'Cart rules'],
      ['rider-auto-assign', /^Deliveries/, 'Automatic rider assignment'],
      ['delivery-zones', /^Deliveries/, 'Extra delivery areas'],
    ];
    for (const [anchor, tab, heading] of cases) {
      scroll.mockClear();
      renderAs(OPERATIONS_STAFF, `/more#${anchor}`);
      expect(await screen.findByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
      expect((await selectedTab())[0]).toHaveTextContent(tab);
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      const target = scroll.mock.contexts[0] as HTMLElement;
      expect(target.id).toBe(anchor);
      cleanup();
    }
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('keeps the Coupons link and the other hub tiles whatever category is open', async () => {
    renderAs(OPERATIONS_STAFF, moreSettings('app'));
    expect(await screen.findByRole('link', { name: 'Coupons' })).toHaveAttribute('href', '/more/coupons');
    expect(screen.getByRole('link', { name: 'Riders' })).toHaveAttribute('href', '/more/riders');
    expect(screen.getByRole('link', { name: 'Rider earnings' })).toHaveAttribute('href', '/more/earnings');
    expect(screen.getByRole('link', { name: 'SMS offers' })).toHaveAttribute('href', '/more/sms-offers');
  });

  it('a hidden category does not call its settings APIs; opening it does', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more');
    await waitFor(() => expect(api.find('GET', '/admin/settings/delivery-fee').length).toBeGreaterThan(0));
    expect(api.find('GET', '/admin/settings/rider-trips').length).toBeGreaterThan(0);
    expect(api.find('GET', '/admin/settings/delivery-radius').length).toBeGreaterThan(0);
    for (const path of [
      'cart-rules',
      'payment-gateway',
      'default-markup',
      'rider-commission',
      'customer-sms-language',
      'app-updates',
    ]) {
      expect(api.find('GET', `/admin/settings/${path}`)).toHaveLength(0);
    }

    await user.click(await tabOf('Orders and payments'));
    await waitFor(() => expect(api.find('GET', '/admin/settings/cart-rules')).toHaveLength(1));
    expect(api.find('GET', '/admin/settings/payment-gateway')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/default-markup')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/rider-commission')).toHaveLength(0);
    expect(api.find('GET', '/admin/settings/customer-sms-language')).toHaveLength(0);
    expect(api.find('GET', '/admin/settings/app-updates')).toHaveLength(0);
  });

  it('is a keyboard-operable tablist: roving tabindex, arrows, Home and End', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
    tabs.forEach((t) => expect(t).toHaveAttribute('aria-controls', 'settings-panel'));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[1]).toHaveFocus();
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1']);
    expect(await screen.findByRole('heading', { name: 'Rider commission' })).toBeInTheDocument();

    await user.keyboard('{End}');
    await waitFor(() => expect(tabs[4]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[4]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabs[4]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{Home}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[0]).toHaveFocus();
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
  });
});
