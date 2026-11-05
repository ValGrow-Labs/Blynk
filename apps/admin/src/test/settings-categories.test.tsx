import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ToastProvider } from '../components/ui';
import { Settings } from '../pages/Settings';
import { tokenStore } from '../api/client';
import { mockApi } from './mockApi';

/**
 * Settings categories (owner's brother, 2026-11-03): the page is a row of
 * category tabs (Deliveries, Riders, Orders and payments, Customers and
 * rewards, App) kept in the URL hash. Only the open category renders, so a
 * hidden one never fetches its settings. The cards keep their own tests.
 */

function Where() {
  const { pathname, hash } = useLocation();
  return <output data-testid="where">{pathname + hash}</output>;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Settings />
        <Where />
      </ToastProvider>
    </MemoryRouter>
  );

const NAMES = ['Deliveries', 'Riders', 'Orders and payments', 'Customers and rewards', 'App'];
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
const region = (name: string) => screen.queryByRole('region', { name });
const regionNow = (name: string) => screen.findByRole('region', { name });

beforeEach(() => tokenStore.save('access', 'refresh'));
afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Settings categories', () => {
  it('shows the five tabs in order, each with how many cards it holds', () => {
    mockApi(() => undefined);
    renderAt('/settings');
    expect(screen.getByRole('tablist', { name: 'Settings categories' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Deliveries8', 'Riders2', 'Orders and payments4', 'Customers and rewards6', 'App1']);
    expect(NAMES.every((n, i) => tabs[i].textContent?.startsWith(n))).toBe(true);
  });

  it('opens Deliveries by default, with its one-line description and its eight cards, and no other category', async () => {
    mockApi(() => undefined);
    renderAt('/settings');
    expect(selectedTab()).toBe(tab('Deliveries'));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab('Deliveries').id);
    expect(screen.getByRole('heading', { level: 2, name: 'Deliveries' })).toBeInTheDocument();
    expect(
      screen.getByText('Everything about getting an order to the customer: hours, fees, areas and riders on the road.')
    ).toBeInTheDocument();
    for (const name of [
      'Store schedule',
      'Delivery fee',
      'Small-order fee',
      'Delivery radius',
      'Extra delivery areas',
      'Bicycle delivery',
      'Rider trips',
      'Automatic rider assignment',
    ]) {
      expect(await regionNow(name)).toBeInTheDocument();
    }
    for (const name of ['Rider documents', 'Checkout', 'Birthday offer', 'App updates']) expect(region(name)).toBeNull();
  });

  it('switches category on a click, puts it in the URL hash, and shows only that category', async () => {
    const user = userEvent.setup();
    mockApi(() => undefined);
    renderAt('/settings');
    await regionNow('Delivery fee');

    await user.click(tab('Riders'));
    expect(selectedTab()).toBe(tab('Riders'));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#riders');
    expect(await regionNow('Rider documents')).toBeInTheDocument();
    expect(region('Delivery fee')).toBeNull();

    await user.click(tab('Orders and payments'));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#orders');
    for (const name of ['Checkout', 'Cart rules', 'Online payments (PayHere)', 'Global default markup']) {
      expect(await regionNow(name)).toBeInTheDocument();
    }
    expect(region('Rider documents')).toBeNull();

    await user.click(tab('Customers and rewards'));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#customers');
    for (const name of ['Birthday offer', 'Refer a friend', 'Blynk Points', 'Blynk Wallet', 'Customer SMS language', 'SMS sending rules']) {
      expect(await regionNow(name)).toBeInTheDocument();
    }

    await user.click(tab('App'));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#app');
    expect(await regionNow('App updates')).toBeInTheDocument();
    expect(region('Birthday offer')).toBeNull();

    await user.click(tab('Deliveries'));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#deliveries');
    expect(await regionNow('Delivery fee')).toBeInTheDocument();
  });

  it.each([
    ['#deliveries', 'Deliveries'],
    ['#riders', 'Riders'],
    ['#orders', 'Orders and payments'],
    ['#customers', 'Customers and rewards'],
    ['#app', 'App'],
  ])('a link to /settings%s opens %s', (hash, name) => {
    mockApi(() => undefined);
    renderAt(`/settings${hash}`);
    expect(selectedTab()).toBe(tab(name));
    expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
  });

  it('opens Deliveries for an unknown or empty hash', () => {
    mockApi(() => undefined);
    const first = renderAt('/settings#nonsense');
    expect(selectedTab()).toBe(tab('Deliveries'));
    first.unmount();
    renderAt('/settings#');
    expect(selectedTab()).toBe(tab('Deliveries'));
  });

  it('/settings#checkout (the Coupons page link) opens Orders and payments, then scrolls to the Checkout panel', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    mockApi(() => undefined);
    renderAt('/settings#checkout');
    expect(selectedTab()).toBe(tab('Orders and payments'));
    expect(await regionNow('Checkout')).toHaveAttribute('id', 'checkout');
    await waitFor(() => expect(scrolled).toContain('checkout'));
    expect(region('Delivery fee')).toBeNull();
  });

  it('other card links open the category that holds the card (default markup, SMS sending rules, automatic assignment)', async () => {
    mockApi(() => undefined);
    const first = renderAt('/settings#default-markup');
    expect(selectedTab()).toBe(tab('Orders and payments'));
    expect(await regionNow('Global default markup')).toHaveAttribute('id', 'default-markup');
    first.unmount();
    const rules = renderAt('/settings#sms-sending-rules');
    expect(selectedTab()).toBe(tab('Customers and rewards'));
    expect(await regionNow('SMS sending rules')).toHaveAttribute('id', 'sms-sending-rules');
    rules.unmount();
    renderAt('/settings#rider-auto-assign');
    expect(selectedTab()).toBe(tab('Deliveries'));
    expect(await regionNow('Automatic rider assignment')).toHaveAttribute('id', 'rider-auto-assign');
  });

  it('does not scroll when the hash is just a category', async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    mockApi(() => undefined);
    renderAt('/settings#riders');
    await regionNow('Rider documents');
    await new Promise((r) => setTimeout(r, 250));
    expect(scrolled).toEqual([]);
  });

  it('a hidden category does not call its settings APIs', async () => {
    const user = userEvent.setup();
    const api = mockApi(() => undefined);
    renderAt('/settings#app');
    await regionNow('App updates');
    const paths = () => api.calls.map((c) => c.path);
    expect(paths()).toContain('/admin/settings/app-updates');
    for (const hidden of [
      '/admin/settings/delivery-fee',
      '/admin/settings/delivery-radius',
      '/admin/settings/rider-trips',
      '/admin/settings/rider-pay',
      '/admin/settings/checkout',
      '/admin/settings/cart-rules',
      '/admin/settings/payment-gateway',
      '/admin/settings/default-markup',
      '/admin/settings/birthday-offer',
      '/admin/settings/customer-sms-language',
      '/admin/settings/wallet',
      '/admin/settings/sms-sending',
      '/admin/settings/sms-limits',
    ]) {
      expect(paths()).not.toContain(hidden);
    }

    // Opening a category is what starts its fetches.
    await user.click(tab('Customers and rewards'));
    await regionNow('Birthday offer');
    await waitFor(() => expect(paths()).toContain('/admin/settings/birthday-offer'));
    expect(paths()).toContain('/admin/settings/wallet');
    await waitFor(() => expect(paths()).toContain('/admin/settings/sms-sending'));
    expect(paths()).toContain('/admin/settings/sms-limits');
    expect(paths()).not.toContain('/admin/settings/delivery-fee');
    expect(paths()).not.toContain('/admin/settings/rider-pay');
  });

  it('is a keyboard tab list: one tab stop, arrows move and select, Home and End jump, both ends wrap', async () => {
    const user = userEvent.setup();
    mockApi(() => undefined);
    renderAt('/settings');
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(tab('Deliveries')).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id);

    await user.tab();
    expect(tab('Deliveries')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Riders')).toHaveFocus();
    expect(selectedTab()).toBe(tab('Riders'));
    expect(tab('Riders')).toHaveAttribute('tabindex', '0');
    expect(tab('Deliveries')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#riders');
    expect(await regionNow('Rider documents')).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(tab('App')).toHaveFocus();
    expect(selectedTab()).toBe(tab('App'));
    await user.keyboard('{ArrowRight}');
    expect(tab('Deliveries')).toHaveFocus();
    expect(selectedTab()).toBe(tab('Deliveries'));
    await user.keyboard('{ArrowLeft}');
    expect(tab('App')).toHaveFocus();
    expect(selectedTab()).toBe(tab('App'));
    await user.keyboard('{Home}');
    expect(tab('Deliveries')).toHaveFocus();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#deliveries');
    expect(await regionNow('Delivery fee')).toBeInTheDocument();
  });

  it('keeps its header and says the categories in the description', () => {
    mockApi(() => undefined);
    renderAt('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const description = screen.getByText(/grouped by category/);
    for (const name of NAMES) expect(description).toHaveTextContent(name);
  });
});
