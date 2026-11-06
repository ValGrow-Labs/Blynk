import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import { SettingsCategories, type SettingsCategory } from '../components/SettingsCategories';
import { OPERATIONS_STAFF, ok, moreSettings, renderAs } from './helpers';

/**
 * More (owner's brother, 2026-11-03: "everything should be categorised"): every
 * tile and every settings card sits in a category (Deliveries, Riders, Orders and
 * payments, Customers and rewards, Sellers, Team and app) behind one row of chips.
 * Each category shows its tiles first, then its cards. Only the open category is
 * mounted; the category lives in the URL hash and is remembered per session.
 */

configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

const NAMES = ['Deliveries', 'Riders', 'Orders and payments', 'Customers and rewards', 'Sellers', 'Team and app'] as const;
// tiles + cards
const COUNTS = [11, 7, 7, 12, 3, 3];

/** Every link tile of More: category -> [title, href]. 26 tiles, each in exactly one category. */
const TILES: Record<(typeof NAMES)[number], Array<[string, string]>> = {
  Deliveries: [
    ['Rider map', '/more/rider-map'],
    ['Deliver orders myself', '/more/deliver'],
    ['Customer addresses', '/more/customers'],
    ['Opening hours', '/more/opening-hours'],
  ],
  Riders: [
    ['Riders', '/more/riders'],
    ['Rider requests', '/more/rider-requests'],
    ['Cash', '/more/cash'],
    ['Rider earnings', '/more/earnings'],
    ['Rider pay', '/more/rider-pay'],
    ['Rider documents', '/more/rider-documents'],
  ],
  'Orders and payments': [
    ['Daily report', '/more/daily-report'],
    ['Purchasing', '/more/purchasing'],
    ['Expiry', '/more/expiry'],
  ],
  'Customers and rewards': [
    ['Coupons', '/more/coupons'],
    ['SMS offers', '/more/sms-offers'],
    ['Notifications', '/more/notifications'],
    ['Repeat baskets', '/more/repeat-baskets'],
    ['Ratings', '/more/ratings'],
    ['Birthday offer', '/more/birthday-offer'],
    ['Refer a friend', '/more/refer-a-friend'],
    ['Blynk Points', '/more/points'],
    ['Blynk Wallet', '/more/wallet'],
  ],
  Sellers: [
    ['Sellers', '/more/sellers'],
    ['Seller applications', '/more/seller-applications'],
    ['Seller products', '/more/seller-products'],
  ],
  'Team and app': [['Staff accounts', '/more/staff']],
};
const ID_OF: Record<(typeof NAMES)[number], Parameters<typeof moreSettings>[0]> = {
  Deliveries: 'deliveries',
  Riders: 'riders',
  'Orders and payments': 'orders',
  'Customers and rewards': 'customers',
  Sellers: 'sellers',
  'Team and app': 'app',
};

const tabOf = async (name: string) => screen.findByRole('tab', { name: new RegExp(`^${name}`) });
const selectedTab = async () => {
  const tabs = await screen.findAllByRole('tab');
  return tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
};
/** [title, href] of the tiles in the open category, in page order. */
const openTiles = () =>
  Array.from(screen.getByRole('tabpanel').querySelectorAll<HTMLAnchorElement>('a.cat-hub__card')).map((a) => [
    a.querySelector('.cat-hub__title')?.textContent,
    a.getAttribute('href'),
  ]);

describe('More categories', () => {
  it('shows the six category chips in order with tiles + cards counts, Deliveries selected, no separate Settings block', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    const list = await screen.findByRole('tablist', { name: 'More categories' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.firstChild?.textContent)).toEqual([...NAMES]);
    tabs.forEach((t, i) => expect(within(t).getByLabelText(`${COUNTS[i]} items`)).toHaveTextContent(String(COUNTS[i])));
    expect(await selectedTab()).toEqual([tabs[0]]);
    expect(screen.queryByRole('heading', { name: 'Settings', level: 2 })).toBeNull();
    expect(screen.getByRole('heading', { name: 'More', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Everything in one place, grouped by what it is for.')).toBeInTheDocument();
    expect(screen.getByText('Signed in as')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('Everything about getting an order to the customer: hours, fees, areas and riders on the road.')).toBeInTheDocument();
  });

  it('nothing sits outside the categories: no tile list above the chips', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    const tabs = await screen.findByRole('tablist');
    const lists = document.querySelectorAll('ul.cat-hub');
    expect(lists).toHaveLength(1);
    // the only tile list is inside the open category's panel, after the chips
    expect(screen.getByRole('tabpanel').contains(lists[0])).toBe(true);
    expect(tabs.compareDocumentPosition(lists[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // and the old hub tiles of other categories are not on the page
    expect(screen.queryByRole('link', { name: 'Staff accounts' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Coupons' })).toBeNull();
  });

  it('every former hub and settings tile appears in exactly one category, with its route, tiles before cards', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    const seen = new Map<string, string>();
    for (const name of NAMES) {
      await user.click(await tabOf(name));
      await waitFor(() => expect(screen.getByRole('tab', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-selected', 'true'));
      expect(openTiles()).toEqual(TILES[name]);
      for (const [title, href] of TILES[name]) {
        expect(seen.has(href)).toBe(false);
        seen.set(href, name);
        expect(screen.getByRole('link', { name: new RegExp(`^${title}`) })).toHaveAttribute('href', href);
      }
      // tiles come before the first card in the panel
      const panel = screen.getByRole('tabpanel');
      const lastTile = panel.querySelector('ul.cat-hub');
      const firstCard = panel.querySelector('section.card');
      if (lastTile && firstCard) expect(lastTile.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(seen.size).toBe(26);
  });

  it('Deliveries holds the delivery tiles and cards and nothing from the other categories', async () => {
    renderAs(OPERATIONS_STAFF, '/more');
    for (const name of ['Delivery fee', 'Small-order fee', 'Delivery radius', 'Extra delivery areas', 'Rider trips', 'Automatic rider assignment']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Opening hours' })).toHaveAttribute('href', '/more/opening-hours');
    for (const name of ['Checkout', 'Cart rules', 'Rider commission', 'Customer SMS language', 'App updates']) {
      expect(screen.queryByRole('heading', { name, level: 2 })).toBeNull();
    }
    expect(screen.queryByRole('link', { name: 'Rider pay' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Riders' })).toBeNull();
  });

  it('each other category shows its own cards after its tiles', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');

    await user.click(await tabOf('Riders'));
    expect(await screen.findByRole('heading', { name: 'Rider commission', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delivery fee' })).toBeNull();

    await user.click(await tabOf('Orders and payments'));
    for (const name of ['Checkout', 'Cart rules', 'Online payments (PayHere)', 'Global default markup']) {
      expect(await screen.findByRole('heading', { name, level: 2 })).toBeInTheDocument();
    }
    expect(screen.queryByRole('heading', { name: 'Rider commission' })).toBeNull();

    await user.click(await tabOf('Customers and rewards'));
    expect(await screen.findByRole('heading', { name: 'Customer SMS language', level: 2 })).toBeInTheDocument();
    // SMS sending rules (2026-11-03) sits after the SMS language card
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Customer SMS language', 'SMS sending rules', 'Test customers (Play testers)']);

    await user.click(await tabOf('Sellers'));
    expect(await screen.findByRole('link', { name: /^Sellers/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Customer SMS language' })).toBeNull();

    await user.click(await tabOf('Team and app'));
    expect(await screen.findByRole('heading', { name: 'App updates', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'App version', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff accounts' })).toHaveAttribute('href', '/more/staff');
  });

  it('switching a chip selects it, swaps the description and the content', async () => {
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
    expect(screen.getByText('Checkout, carts, online payments, prices, stock buying and the daily report.')).toBeInTheDocument();
    await user.click(await tabOf('Deliveries'));
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
  });

  it('shows each category description', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    const texts: Record<string, string> = {
      Riders: 'Your riders: who they are, what they earn and what they are paid.',
      'Customers and rewards': 'Coupons, offers, messages and rewards for customers.',
      Sellers: 'Sellers, their applications and their products.',
      'Team and app': 'Staff accounts, app updates and the app version.',
    };
    for (const [name, text] of Object.entries(texts)) {
      await user.click(await tabOf(name));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it('opens a category from /more#settings-<id> (all six); unknown values open Deliveries', async () => {
    for (const name of NAMES) {
      renderAs(OPERATIONS_STAFF, moreSettings(ID_OF[name]));
      await waitFor(async () => expect((await selectedTab())[0]).toHaveTextContent(new RegExp(`^${name}`)));
      expect(openTiles()).toEqual(TILES[name]);
      cleanup();
    }

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
      ['delivery-radius', /^Deliveries/, 'Delivery radius'],
      ['small-order-fee', /^Deliveries/, 'Small-order fee'],
      ['sms-sending-rules', /^Customers and rewards/, 'SMS sending rules'],
      ['sms-sending-rules-title', /^Customers and rewards/, 'SMS sending rules'],
      ['rider-commission-title', /^Riders/, 'Rider commission'],
      ['app-version-title', /^Team and app/, 'App version'],
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

  it('a hidden category makes no API calls (settings and tile badges); opening it does', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(OPERATIONS_STAFF, '/more', {
      'GET /admin/sellers': () => ok({ sellers: [] }),
      'GET /admin/seller-submissions': () => ok({ submissions: [] }),
      'GET /admin/seller-applications': () => ok({ applications: [], new_count: 0 }),
      'GET /admin/rider-applications/count': () => ok({ pending: 0 }),
    });
    await waitFor(() => expect(api.find('GET', '/admin/settings/delivery-fee').length).toBeGreaterThan(0));
    expect(api.find('GET', '/admin/settings/rider-trips').length).toBeGreaterThan(0);
    expect(api.find('GET', '/admin/settings/delivery-radius').length).toBeGreaterThan(0);
    for (const path of ['cart-rules', 'payment-gateway', 'default-markup', 'rider-commission', 'customer-sms-language', 'app-updates', 'sms-sending', 'sms-limits']) {
      expect(api.find('GET', `/admin/settings/${path}`)).toHaveLength(0);
    }
    // tile badges load only with their category
    expect(api.find('GET', '/admin/rider-applications/count')).toHaveLength(0);
    expect(api.find('GET', '/admin/sellers')).toHaveLength(0);
    expect(api.find('GET', '/admin/seller-submissions')).toHaveLength(0);
    expect(api.find('GET', '/admin/seller-applications')).toHaveLength(0);

    await user.click(await tabOf('Orders and payments'));
    await waitFor(() => expect(api.find('GET', '/admin/settings/cart-rules')).toHaveLength(1));
    expect(api.find('GET', '/admin/settings/payment-gateway')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/default-markup')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/rider-commission')).toHaveLength(0);
    expect(api.find('GET', '/admin/settings/customer-sms-language')).toHaveLength(0);
    expect(api.find('GET', '/admin/settings/app-updates')).toHaveLength(0);
    expect(api.find('GET', '/admin/sellers')).toHaveLength(0);

    await user.click(await tabOf('Customers and rewards'));
    await waitFor(() => expect(api.find('GET', '/admin/settings/sms-sending')).toHaveLength(1));
    expect(api.find('GET', '/admin/settings/sms-limits')).toHaveLength(1);
    expect(api.find('GET', '/admin/settings/customer-sms-language')).toHaveLength(1);

    await user.click(await tabOf('Sellers'));
    await waitFor(() => expect(api.find('GET', '/admin/sellers')).toHaveLength(1));
    expect(api.find('GET', '/admin/seller-submissions')).toHaveLength(1);
    expect(api.find('GET', '/admin/seller-applications')).toHaveLength(1);
    expect(api.find('GET', '/admin/rider-applications/count')).toHaveLength(0);

    await user.click(await tabOf('Riders'));
    await waitFor(() => expect(api.find('GET', '/admin/rider-applications/count')).toHaveLength(1));
  });

  it('keeps the tile badges: Sellers and Rider requests show their counts in their categories', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, moreSettings('sellers'), {
      'GET /admin/sellers': () => ok({ sellers: [{ id: 's1' }, { id: 's2' }] }),
      'GET /admin/seller-submissions': () => ok({ submissions: [{ id: 'a' }] }),
      'GET /admin/seller-applications': () => ok({ applications: [], new_count: 4 }),
      'GET /admin/rider-applications/count': () => ok({ pending: 3 }),
    });
    const sellers = await screen.findByRole('link', { name: /^Sellers/ });
    expect(await within(sellers).findByLabelText('2 sellers waiting')).toBeInTheDocument();
    expect(await within(screen.getByRole('link', { name: /^Seller applications/ })).findByLabelText('4 new applications')).toBeInTheDocument();
    expect(await within(screen.getByRole('link', { name: /^Seller products/ })).findByLabelText('1 products waiting')).toBeInTheDocument();
    await user.click(await tabOf('Riders'));
    expect(await within(await screen.findByRole('link', { name: /^Rider requests/ })).findByLabelText('3 waiting')).toBeInTheDocument();
  });

  it('is a keyboard-operable tablist: roving tabindex, arrows, Home and End', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
    tabs.forEach((t) => expect(t).toHaveAttribute('aria-controls', 'settings-panel'));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel');

    tabs[0].focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[1]).toHaveFocus();
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1', '-1']);
    expect(await screen.findByRole('heading', { name: 'Rider commission' })).toBeInTheDocument();

    await user.keyboard('{End}');
    await waitFor(() => expect(tabs[5]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[5]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tabs[5]).toHaveAttribute('aria-selected', 'true'));
    await user.keyboard('{Home}');
    await waitFor(() => expect(tabs[0]).toHaveAttribute('aria-selected', 'true'));
    expect(tabs[0]).toHaveFocus();
    expect(await screen.findByRole('heading', { name: 'Delivery fee' })).toBeInTheDocument();
  });

  it('the bottom More tab returns to the category last opened this session (after visiting a tile)', async () => {
    const user = userEvent.setup();
    renderAs(OPERATIONS_STAFF, '/more');
    await user.click(await tabOf('Customers and rewards'));
    await user.click(await screen.findByRole('link', { name: 'Ratings' }));
    await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull());
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(primary).getByRole('link', { name: 'More' }));
    await waitFor(async () => expect((await selectedTab())[0]).toHaveTextContent(/^Customers and rewards/));
    expect(screen.getByRole('link', { name: 'Ratings' })).toBeInTheDocument();
  });
});

describe('SettingsCategories (the component)', () => {
  const tile = (key: string, visible?: boolean) => ({ key, node: <Link to={`/more/${key}`}>{key}</Link>, visible });
  const card = (key: string, anchors?: string[], visible?: boolean) => ({
    key,
    anchors,
    visible,
    node: <section className="card"><h2>{key}</h2></section>,
  });

  function Back() {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back</button>;
  }
  function harness(categories: SettingsCategory[], route = '/more') {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/more" element={<SettingsCategories categories={categories} />} />
          <Route path="/more/:page" element={<Back />} />
        </Routes>
      </MemoryRouter>
    );
  }

  const CATS: SettingsCategory[] = [
    { id: 'one', label: 'One', description: 'First.', tiles: [tile('a'), tile('b')], cards: [card('card-a', ['anchor-a'])] },
    { id: 'two', label: 'Two', description: 'Second.', tiles: [tile('c')], cards: [card('card-c')] },
    { id: 'three', label: 'Three', description: 'Third.', tiles: [tile('d')] },
  ];

  it('hides items that are not allowed, drops them from the count, and hides a category with nothing left', async () => {
    const user = userEvent.setup();
    harness([
      { id: 'one', label: 'One', description: 'First.', tiles: [tile('a'), tile('b', false)], cards: [card('card-a', ['anchor-a'], false)] },
      { id: 'sellers', label: 'Sellers', description: 'S.', tiles: [tile('s1', false), tile('s2', false)] },
      { id: 'three', label: 'Three', description: 'Third.', tiles: [tile('d')] },
    ]);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.firstChild?.textContent)).toEqual(['One', 'Three']);
    expect(within(tabs[0]).getByLabelText('1 items')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'a' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'b' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'card-a' })).toBeNull();
    await user.click(tabs[1]);
    expect(await screen.findByRole('link', { name: 'd' })).toBeInTheDocument();
  });

  it('a hidden category cannot be opened by its hash or by an anchor; it falls back to the first category', async () => {
    harness(
      [
        { id: 'one', label: 'One', description: 'First.', tiles: [tile('a')] },
        { id: 'gone', label: 'Gone', description: 'G.', tiles: [tile('g', false)], cards: [card('hidden-card', ['hidden-anchor'], false)] },
      ],
      '/more#settings-gone'
    );
    expect((await screen.findAllByRole('tab'))).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'a' })).toBeInTheDocument();
    cleanup();
    harness(
      [
        { id: 'one', label: 'One', description: 'First.', tiles: [tile('a')] },
        { id: 'gone', label: 'Gone', description: 'G.', cards: [card('hidden-card', ['hidden-anchor'], false)] },
      ],
      '/more#hidden-anchor'
    );
    expect((await screen.findAllByRole('tab'))).toHaveLength(1);
  });

  it('renders nothing when no category has a visible item', () => {
    harness([{ id: 'x', label: 'X', description: 'x', tiles: [tile('a', false)] }]);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('Back from a tile page returns to the same category (chips replace history, tiles push)', async () => {
    const user = userEvent.setup();
    harness(CATS);
    await user.click(await screen.findByRole('tab', { name: /^Two/ }));
    await user.click(await screen.findByRole('link', { name: 'c' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    const tabs = await screen.findAllByRole('tab');
    await waitFor(() => expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')[0]).toHaveTextContent(/^Two/));
    expect(screen.getByRole('link', { name: 'c' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'a' })).toBeNull();
  });

  it('with no hash it reopens the category remembered in sessionStorage', async () => {
    window.sessionStorage.setItem('blynk.ops.more.category', 'three');
    harness(CATS);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')[0]).toHaveTextContent(/^Three/);
    cleanup();
    // an explicit hash wins over the remembered category
    harness(CATS, '/more#settings-one');
    const again = await screen.findAllByRole('tab');
    expect(again.filter((t) => t.getAttribute('aria-selected') === 'true')[0]).toHaveTextContent(/^One/);
    cleanup();
    // a remembered id that no longer exists is ignored
    window.sessionStorage.setItem('blynk.ops.more.category', 'removed');
    harness(CATS);
    const first = await screen.findAllByRole('tab');
    expect(first.filter((t) => t.getAttribute('aria-selected') === 'true')[0]).toHaveTextContent(/^One/);
  });
});
