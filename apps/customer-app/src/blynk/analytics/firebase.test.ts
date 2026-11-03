import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Product } from '../api/types';
import { storage } from '../lib/storage';
import { nativeFirebase } from './firebaseAnalytics';
import { screenClassOf, screenView, toFirebaseEvent } from './firebaseEvents';
import {
  ANALYTICS_ENABLED_KEY, analyticsEnabled, firebaseActive, initFirebase, reportError, safeError, setAnalyticsEnabled, setFirebaseForTests,
} from './firebaseSink';
import type { FirebaseShim } from './firebaseTypes';
import {
  identify, resetForTests, setAppLanguage, setCatalogIndex, track, trackBeginCheckout, trackCartChange, trackEcommerce, trackLogin,
  trackNotifyMe, trackOutOfZone, trackPageView, trackPurchase, trackSearch, trackSelectItem, trackShare, trackShippingInfo, trackSignUp,
  trackViewCart, trackViewItem, trackViewItemList, trackingActive, PURCHASES_KEY,
} from './track';

/*
 * The phone's Firebase reporting (firebaseSink.ts, firebaseEvents.ts) through an injected shim, and
 * the web path (track.ts's dataLayer push) staying as it was. No React Native, no native module.
 */
type Call = { fn: string; args: unknown[] };
function fakeShim(opts: { throws?: boolean; rejects?: boolean } = {}) {
  const calls: Call[] = [];
  const rec = (fn: string) => (...args: unknown[]) => {
    calls.push({ fn, args });
    if (opts.throws) throw new Error('native module missing');
    return opts.rejects ? Promise.reject(new Error('native failure')) : undefined;
  };
  const shim: FirebaseShim = {
    analytics: {
      logEvent: rec('a.logEvent'), setUserId: rec('a.setUserId'), setUserProperty: rec('a.setUserProperty'), setCollectionEnabled: rec('a.setCollectionEnabled'),
    },
    crashlytics: { log: rec('c.log'), recordError: rec('c.recordError'), setUserId: rec('c.setUserId'), setCollectionEnabled: rec('c.setCollectionEnabled') },
  };
  const of = (fn: string) => calls.filter((c) => c.fn === fn);
  const events = () => of('a.logEvent').map((c) => ({ name: c.args[0] as string, params: (c.args[1] ?? {}) as Record<string, any> }));
  const event = (name: string) => events().filter((e) => e.name === name);
  return { shim, calls, of, events, event };
}

type G = { document?: unknown; dataLayer?: unknown[]; location?: unknown };
const g = globalThis as unknown as G;

const product = (over: Partial<Product> & { sku?: string } = {}): Product & { sku?: string } => ({
  id: 'p1', category_id: 'sub-milk', category_name: 'Milk', name: 'Kotmale Milk 1L', slug: 'kotmale-milk', description: null,
  unit: '1 L', pack_size: null, image_url: null, image_focal_x: 50, image_focal_y: 50, selling_price: 600, offer_price: 540,
  offer_ends_at: null, offer_kind: 'PRODUCT', is_available: true, sku: 'KOT-1L', ...over,
});
const order = (over: Record<string, unknown> = {}) => ({
  order_number: 'BL-20261103-0001', order_status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING', total_amount: 1190, delivery_fee: 150,
  items: [{ product_id: 'p1', product_name_snapshot: 'Kotmale Milk 1L', unit_selling_price: 540, quantity: 2 }], ...over,
});

let t: ReturnType<typeof fakeShim>;
beforeEach(() => {
  delete g.document; delete g.dataLayer; delete g.location;
  storage.set(ANALYTICS_ENABLED_KEY, '1');
  storage.set(PURCHASES_KEY, '');
  resetForTests();
  t = fakeShim();
  setFirebaseForTests(t.shim);
});
afterEach(() => {
  setFirebaseForTests(undefined);
  delete g.document; delete g.dataLayer; delete g.location;
  storage.set(ANALYTICS_ENABLED_KEY, '1');
  storage.set(PURCHASES_KEY, '');
  resetForTests();
});

describe('what the phone sends', () => {
  test('trackingActive is true on the phone while Firebase is there, false without it or with reporting off', () => {
    expect(trackingActive()).toBe(true);
    expect(firebaseActive()).toBe(true);
    setFirebaseForTests(null);
    expect(trackingActive()).toBe(false);
    setFirebaseForTests(t.shim);
    storage.set(ANALYTICS_ENABLED_KEY, '0');
    expect(trackingActive()).toBe(false);
  });

  test('view_item: GA4 name, currency and value flattened out of ecommerce, items kept as an array of objects', () => {
    trackViewItem(product());
    expect(t.event('view_item')).toEqual([{
      name: 'view_item',
      params: { currency: 'LKR', value: 540, items: [{ item_id: 'KOT-1L', item_name: 'Kotmale Milk 1L', item_category: 'Milk', price: 540, quantity: 1 }] },
    }]);
  });

  test('view_item_list and select_item carry the list id and name', () => {
    trackViewItemList('Dairy', [product(), product({ id: 'p2', name: 'Curd', sku: 'C1' })]);
    trackSelectItem(product({ id: 'p2', name: 'Curd', sku: 'C1' }));
    const list = t.event('view_item_list')[0]!.params;
    expect(list).toMatchObject({ item_list_id: 'dairy', item_list_name: 'Dairy', currency: 'LKR' });
    expect(list.items.map((i: any) => [i.item_id, i.index])).toEqual([['KOT-1L', 0], ['C1', 1]]);
    expect(t.event('select_item')[0]!.params).toMatchObject({ item_list_name: 'Dairy', item_list_id: 'dairy' });
  });

  test('add_to_cart / remove_from_cart / view_cart / begin_checkout / add_shipping_info', () => {
    const p = product();
    trackCartChange({ lines: [] }, { lines: [{ product: p, quantity: 2 }] });
    trackCartChange({ lines: [{ product: p, quantity: 2 }] }, { lines: [{ product: p, quantity: 1 }] });
    expect(t.event('add_to_cart')[0]!.params).toMatchObject({ currency: 'LKR', value: 1080, items: [{ item_id: 'KOT-1L', quantity: 2, price: 540 }] });
    expect(t.event('remove_from_cart')[0]!.params).toMatchObject({ value: 540, items: [{ quantity: 1 }] });
    const cart = { lines: [{ product: p, quantity: 2 }] };
    trackViewCart(cart);
    trackBeginCheckout(cart);
    trackShippingInfo(cart, { shipping: 150, distanceKm: 2.34, discount: 0, points: 0 });
    expect(t.event('view_cart')[0]!.params).toMatchObject({ value: 1080 });
    expect(t.event('begin_checkout')[0]!.params).toMatchObject({ value: 1080, items: [{ quantity: 2 }] });
    expect(t.event('add_shipping_info')[0]!.params).toMatchObject({ value: 1080, shipping: 150, distance_km: 2.3 });
  });

  test('purchase: once per order, with transaction id, value, shipping and payment type; points_redeem after it', () => {
    expect(trackPurchase(order({ points_discount_amount: 50, points_redeemed: 50 }) as never)).toBe(true);
    expect(trackPurchase(order() as never)).toBe(false); // same order number: never twice
    const p = t.event('purchase');
    expect(p).toHaveLength(1);
    expect(p[0]!.params).toMatchObject({ transaction_id: 'BL-20261103-0001', currency: 'LKR', value: 1040, shipping: 150, payment_type: 'COD' });
    expect(p[0]!.params.items).toHaveLength(1);
    expect(t.event('points_redeem')[0]!.params).toEqual({ points: 50 });
    // the order number is not mistaken for a phone number
    expect(p[0]!.params.transaction_id).not.toContain('redacted');
  });

  test('an online order not yet paid is not a purchase', () => {
    expect(trackPurchase(order({ payment_method: 'ONLINE', payment_status: 'PENDING' }) as never)).toBe(false);
    expect(t.event('purchase')).toEqual([]);
  });

  test('search, share, out_of_zone, notify_me, login and sign_up', () => {
    trackSearch('  Milk  ');
    trackSearch('milk'); // the same term again is one search
    trackShare('copied', 'product', 'KOT-1L');
    trackShare('failed', 'app');
    trackOutOfZone('Kalutara', 1);
    trackNotifyMe(product());
    trackLogin('cust-1');
    trackSignUp('cust-2');
    expect(t.event('search')).toEqual([{ name: 'search', params: { search_term: 'milk' } }]);
    expect(t.event('share')).toEqual([{ name: 'share', params: { method: 'copy_link', content_type: 'product', item_id: 'KOT-1L' } }]);
    expect(t.event('out_of_zone')).toEqual([{ name: 'out_of_zone', params: { area: 'Kalutara' } }]);
    expect(t.event('notify_me')[0]!.params).toMatchObject({ value: 540 });
    // user_id is Firebase's user id, not an event parameter
    expect(t.event('login')).toEqual([{ name: 'login', params: { method: 'sms' } }]);
    expect(t.event('sign_up')).toEqual([{ name: 'sign_up', params: { method: 'sms' } }]);
  });

  test('a page view is a screen_view (readable title, ids collapsed) plus a Crashlytics breadcrumb; no page_view event; same route twice is one', () => {
    expect(trackPageView('/home')).toBe(true);
    trackPageView('/home');
    trackPageView('/p/123', { from: 'search', phone: '+94771234567' });
    trackPageView('/otp', { phone: '+94771234567' });
    expect(t.event('page_view')).toEqual([]);
    expect(t.event('screen_view')).toEqual([
      { name: 'screen_view', params: { screen_name: 'Home', screen_class: '/home' } },
      { name: 'screen_view', params: { screen_name: 'Product', screen_class: '/p/:id' } },
    ]);
    expect(t.of('c.log').map((c) => c.args[0])).toEqual(['screen: /home', 'screen: /p/123']);
    expect(JSON.stringify(t.calls)).not.toContain('94771234567');
  });

  test('screenView / screenClassOf', () => {
    expect(screenClassOf('/category/abc?x=1')).toBe('/category/:id');
    expect(screenClassOf('/cart')).toBe('/cart');
    expect(screenView('/cart', 'Cart | Blynk')).toEqual({ name: 'screen_view', params: { screen_name: 'Cart', screen_class: '/cart' } });
  });
});

describe('privacy', () => {
  test('personal keys never reach Firebase: top level, inside ecommerce and inside items', () => {
    track('anything', { phone: '+94771234567', email: 'a@b.lk', full_name: 'Nimal', address_line1: '1 Main St', latitude: 6.4, area: 'Beruwala' });
    trackEcommerce('view_cart', { value: 1, customer_name: 'Nimal', items: [{ item_id: 'x', item_name: 'Milk', price: 1, quantity: 1, phone: '0771234567', recipient: 'Nimal' }] }, { lng: 79.9 });
    const sent = JSON.stringify(t.calls);
    for (const bad of ['94771234567', '0771234567', 'a@b.lk', 'Nimal', 'Main St', '6.4', '79.9']) expect(sent).not.toContain(bad);
    expect(t.event('anything')[0]!.params).toEqual({ area: 'Beruwala' });
    expect(t.event('view_cart')[0]!.params.items).toEqual([{ item_id: 'x', item_name: 'Milk', price: 1, quantity: 1 }]);
  });

  test('toFirebaseEvent drops personal keys even from an unsanitized entry', () => {
    const e = toFirebaseEvent({ event: 'x', ecommerce: { value: 1, email: 'a@b.lk', items: [{ item_id: 'a', phone: '077' }] }, mobile: '077', ok: 'yes' });
    expect(e).toEqual({ name: 'x', params: { value: 1, items: [{ item_id: 'a' }], ok: 'yes' } });
  });

  test('a search with a phone number or email in it is redacted', () => {
    trackSearch('call 0771234567 or me@x.lk');
    expect(JSON.stringify(t.calls)).not.toMatch(/0771234567|me@x\.lk/);
    expect(t.event('search')[0]!.params.search_term).toContain('[redacted]');
  });

  test('the user id is the customer id; the phone number is never sent as an id', () => {
    identify('cust-9');
    expect(t.of('a.setUserId')[0]!.args).toEqual(['cust-9']);
    expect(t.of('c.setUserId')[0]!.args).toEqual(['cust-9']);
  });

  test('Firebase limits: reserved and bad names dropped, 25 parameters, 100-character values, booleans as text', () => {
    expect(toFirebaseEvent({ event: 'firebase_x' })).toBeNull();
    expect(toFirebaseEvent({ event: 'bad name' })).toBeNull();
    expect(toFirebaseEvent({ event: '1abc' })).toBeNull();
    expect(toFirebaseEvent({})).toBeNull();
    const many: Record<string, unknown> = { event: 'many' };
    for (let i = 0; i < 40; i++) many[`k${i}`] = i;
    expect(Object.keys(toFirebaseEvent(many)!.params)).toHaveLength(25);
    const e = toFirebaseEvent({ event: 'x', long: 'a'.repeat(300), flag: true, nan: NaN, obj: { a: 1 }, 'bad key': 1, google_x: 1, undef: undefined })!;
    expect(e.params).toEqual({ long: 'a'.repeat(100), flag: 'true' });
  });
});

describe('who is shopping', () => {
  test('sign-in sets the user id on Analytics and Crashlytics, sign-out clears both, once per change', () => {
    identify('cust-1');
    identify('cust-1');
    identify(null);
    identify(null);
    expect(t.of('a.setUserId').map((c) => c.args[0])).toEqual(['cust-1', null]);
    expect(t.of('c.setUserId').map((c) => c.args[0])).toEqual(['cust-1', '']);
  });

  test('a signed-out start clears an id left over from a session that ended while the app was closed', () => {
    identify(null);
    identify(undefined);
    expect(t.of('a.setUserId').map((c) => c.args[0])).toEqual([null]);
    expect(t.of('c.setUserId').map((c) => c.args[0])).toEqual(['']);
  });

  test('the language is a user property, once per change', () => {
    setAppLanguage('si');
    setAppLanguage('si');
    setAppLanguage('ta');
    expect(t.of('a.setUserProperty').map((c) => c.args)).toEqual([['app_language', 'si'], ['app_language', 'ta']]);
  });

  test('a language set while nothing listens goes out once something does', () => {
    setFirebaseForTests(null);
    setAppLanguage('si');
    setFirebaseForTests(t.shim);
    setAppLanguage('si');
    expect(t.of('a.setUserProperty').map((c) => c.args)).toEqual([['app_language', 'si']]);
  });
});

describe('the web is unchanged', () => {
  function web() {
    g.document = {};
    g.dataLayer = [];
    g.location = { origin: 'https://blynk.lk', pathname: '/app/home', search: '', href: 'https://blynk.lk/app/home' };
    resetForTests();
    setFirebaseForTests(null); // the web has no Firebase
    return g.dataLayer as Record<string, unknown>[];
  }

  test('the dataLayer still gets every event, with ecommerce cleared first and page_view as ever', () => {
    const dl = web();
    expect(trackingActive()).toBe(true);
    trackEcommerce('view_cart', { value: 540, items: [] });
    track('search', { search_term: 'milk', phone: '077' });
    trackPageView('/home');
    expect(dl).toEqual([
      { ecommerce: null },
      { event: 'view_cart', ecommerce: { currency: 'LKR', value: 540, items: [] } },
      { event: 'search', search_term: 'milk' },
      { event: 'page_view', page_path: '/app/home', page_location: 'https://blynk.lk/app/home', page_title: 'Home | Blynk' },
    ]);
  });

  test('identify pushes user_id to the dataLayer as before (and clears it on sign-out)', () => {
    const dl = web();
    identify('cust-1');
    identify(null);
    expect(dl).toEqual([{ user_id: 'cust-1', app_language: 'en', app_mode: 'browser' }, { user_id: undefined }]);
  });

  test('with a web dataLayer and Firebase both listening, each gets the event (no ecommerce:null for Firebase)', () => {
    const dl = web();
    setFirebaseForTests(t.shim);
    expect(track('search', { search_term: 'milk' })).toBe(true);
    trackEcommerce('view_cart', { value: 1, items: [] });
    expect(dl.filter((e) => 'event' in e).map((e) => e.event)).toEqual(['search', 'view_cart']);
    expect(t.events().map((e) => e.name)).toEqual(['search', 'view_cart']);
  });

  test('the web ignores the consent switch (its own GTM consent applies)', () => {
    const dl = web();
    storage.set(ANALYTICS_ENABLED_KEY, '0');
    track('search', { search_term: 'milk' });
    expect(dl).toEqual([{ event: 'search', search_term: 'milk' }]);
  });
});

describe('the native module is missing or failing', () => {
  test('the real shim on the web / in Node is none', () => {
    expect(nativeFirebase()).toBeNull();
  });

  test('without a shim nothing is sent and nothing throws', () => {
    setFirebaseForTests(null);
    expect(track('search', { search_term: 'milk' })).toBe(false);
    expect(trackViewItem(product())).toBeUndefined();
    expect(trackPageView('/home')).toBe(false);
    expect(() => { identify('c'); identify(null); setAppLanguage('en'); initFirebase(); setAnalyticsEnabled(true); }).not.toThrow();
    expect(reportError(new Error('x'))).toBe(false);
    setCatalogIndex({ categories: [] });
  });

  test('a shim that throws or rejects never breaks the caller', () => {
    for (const bad of [fakeShim({ throws: true }), fakeShim({ rejects: true })]) {
      resetForTests();
      setFirebaseForTests(bad.shim);
      expect(() => {
        track('search', { search_term: 'milk' });
        trackViewItem(product());
        trackPageView('/home');
        trackLogin('c1');
        identify(null);
        setAppLanguage('si');
        initFirebase();
        reportError(new Error('boom'));
      }).not.toThrow();
      expect(bad.calls.length).toBeGreaterThan(5);
    }
  });
});

describe('consent: the analyticsEnabled switch', () => {
  test('on by default (nothing stored)', () => {
    storage.set(ANALYTICS_ENABLED_KEY, '');
    expect(analyticsEnabled()).toBe(true);
    expect(trackingActive()).toBe(true);
  });

  test('off: no event, no screen, no user id, no error report leaves the phone', () => {
    storage.set(ANALYTICS_ENABLED_KEY, '0');
    expect(analyticsEnabled()).toBe(false);
    track('search', { search_term: 'milk' });
    trackViewItem(product());
    trackPageView('/home');
    identify('cust-1');
    setAppLanguage('si');
    expect(reportError(new Error('x'))).toBe(false);
    expect(t.calls).toEqual([]);
  });

  test('setAnalyticsEnabled remembers the choice and switches both SDKs at once', () => {
    setAnalyticsEnabled(false);
    expect(storage.get(ANALYTICS_ENABLED_KEY)).toBe('0');
    expect(t.of('a.setCollectionEnabled').map((c) => c.args[0])).toEqual([false]);
    expect(t.of('c.setCollectionEnabled').map((c) => c.args[0])).toEqual([false]);
    setAnalyticsEnabled(true);
    expect(analyticsEnabled()).toBe(true);
    expect(t.of('a.setCollectionEnabled').map((c) => c.args[0])).toEqual([false, true]);
  });

  test('initFirebase: collection follows the switch; Crashlytics stays off in a development build', () => {
    initFirebase();
    expect(t.of('a.setCollectionEnabled')[0]!.args).toEqual([true]);
    expect(t.of('c.setCollectionEnabled')[0]!.args).toEqual([true]); // not dev (vitest has no __DEV__)
    const d = fakeShim();
    setFirebaseForTests(d.shim, { dev: true });
    initFirebase();
    expect(d.of('a.setCollectionEnabled')[0]!.args).toEqual([true]);
    expect(d.of('c.setCollectionEnabled')[0]!.args).toEqual([false]);
    storage.set(ANALYTICS_ENABLED_KEY, '0');
    const off = fakeShim();
    setFirebaseForTests(off.shim);
    initFirebase();
    expect(off.of('a.setCollectionEnabled')[0]!.args).toEqual([false]);
    expect(off.of('c.setCollectionEnabled')[0]!.args).toEqual([false]);
  });
});

describe('reportError (Crashlytics non-fatal)', () => {
  test('records an Error with its name and stack', () => {
    const e = new TypeError('cart exploded');
    expect(reportError(e)).toBe(true);
    const sent = t.of('c.recordError')[0]!.args[0] as Error;
    expect(sent).toBeInstanceOf(Error);
    expect(sent.name).toBe('TypeError');
    expect(sent.message).toBe('cart exploded');
    expect(sent.stack).toContain('firebase.test');
  });

  test('phone numbers and emails in the message and stack are redacted', () => {
    const e = new Error('OTP failed for +94771234567 / nimal@example.lk');
    reportError(e);
    const sent = t.of('c.recordError')[0]!.args[0] as Error;
    expect(sent.message).toBe('OTP failed for [redacted] / [redacted]');
    expect(sent.stack).not.toMatch(/94771234567|nimal@example/);
  });

  test('strings, plain objects and nonsense become Errors; nothing throws', () => {
    expect(safeError('plain text').message).toBe('plain text');
    expect(safeError({ code: 'NETWORK', name: 'ApiError' })).toMatchObject({ message: 'NETWORK', name: 'ApiError' });
    expect(safeError(undefined).message).toBe('undefined');
    expect(safeError(null).message).toBe('null');
    expect(safeError(new Error('x'.repeat(900))).message).toHaveLength(500);
    expect(() => reportError(Symbol('s'))).not.toThrow();
  });

  test('the same error again within 10 seconds is one report', () => {
    expect(reportError(new Error('loop'), 1_000)).toBe(true);
    expect(reportError(new Error('loop'), 5_000)).toBe(false);
    expect(reportError(new Error('loop'), 12_000)).toBe(true);
    expect(reportError(new Error('other'), 12_001)).toBe(true);
    expect(t.of('c.recordError')).toHaveLength(3);
  });
});
