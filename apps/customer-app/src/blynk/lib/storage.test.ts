import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStorage, type SyncKv } from './storage';
import { MemoryStorage, milk } from '../test/fixtures';

/** A SQLite file that outlives the app process: the Map is the disk. */
const disk = new Map<string, string>();
const fakeKv = (): SyncKv => ({
  getItemSync: (k) => (disk.has(k) ? (disk.get(k) as string) : null),
  setItemSync: (k, v) => { disk.set(k, v); },
});
const noWeb = () => null;

describe('createStorage', () => {
  test('web: localStorage, unchanged', () => {
    const ls = new MemoryStorage();
    const s = createStorage({ web: () => ls as unknown as Storage, kv: () => null });
    expect(s.get('a')).toBeNull();
    s.set('a', '1');
    expect(ls.getItem('a')).toBe('1');
    expect(s.get('a')).toBe('1');
  });

  test('web: blocked storage falls back to memory and never throws', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } } as unknown as Storage;
    const s = createStorage({ web: () => blocked, kv: () => null });
    expect(() => s.set('a', '1')).not.toThrow();
    expect(s.get('a')).toBe('1');
    const gone = createStorage({ web: () => { throw new Error('no localStorage'); }, kv: () => null });
    gone.set('k', 'v');
    expect(gone.get('k')).toBe('v');
  });

  test('phone: values go to the key-value store and come back after a restart', () => {
    disk.clear();
    const first = createStorage({ web: noWeb, kv: fakeKv });
    first.set('session', '{"t":1}');
    expect(disk.get('session')).toBe('{"t":1}');
    const second = createStorage({ web: noWeb, kv: fakeKv }); // a new process: empty caches
    expect(second.get('session')).toBe('{"t":1}');
    expect(second.get('missing')).toBeNull();
  });

  test('phone: an overwrite and the clear-by-empty-string idiom persist', () => {
    disk.clear();
    const s = createStorage({ web: noWeb, kv: fakeKv });
    s.set('k', 'a');
    s.set('k', 'b');
    expect(createStorage({ web: noWeb, kv: fakeKv }).get('k')).toBe('b');
    s.set('k', '');
    expect(createStorage({ web: noWeb, kv: fakeKv }).get('k')).toBe('');
  });

  test('phone: get and set work as detached functions (initialLang(storage.get))', () => {
    disk.clear();
    const { get, set } = createStorage({ web: noWeb, kv: fakeKv });
    set('x', 'y');
    expect(get('x')).toBe('y');
  });

  test('phone: a failing database falls back to memory and never throws', () => {
    const broken: SyncKv = { getItemSync: () => { throw new Error('db'); }, setItemSync: () => { throw new Error('db'); } };
    const s = createStorage({ web: noWeb, kv: () => broken });
    expect(() => s.set('a', '1')).not.toThrow();
    expect(s.get('a')).toBe('1');
    expect(s.get('other')).toBeNull();
    const opens = createStorage({ web: noWeb, kv: () => { throw new Error('cannot open'); } });
    opens.set('a', '2');
    expect(opens.get('a')).toBe('2');
  });

  test('phone: a write that fails after a good one is still readable this run', () => {
    let fail = false;
    const kv: SyncKv = {
      getItemSync: (k) => disk.get(k) ?? null,
      setItemSync: (k, v) => { if (fail) throw new Error('disk full'); disk.set(k, v); },
    };
    disk.clear();
    const s = createStorage({ web: noWeb, kv: () => kv });
    s.set('k', 'old');
    fail = true;
    s.set('k', 'new');
    expect(s.get('k')).toBe('new');
  });

  test('nothing available at all: memory only', () => {
    const s = createStorage({ web: noWeb, kv: () => null });
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
  });
});

describe('the phone key-value wiring (nativeKv.native.ts)', () => {
  test('wraps expo-sqlite/kv-store', async () => {
    vi.resetModules();
    const store = { getItemSync: vi.fn(() => 'v'), setItemSync: vi.fn() };
    vi.doMock('expo-sqlite/kv-store', () => ({ default: store }));
    const { phoneKv } = await import('./nativeKv.native');
    const kv = phoneKv();
    expect(kv?.getItemSync('k')).toBe('v');
    kv?.setItemSync('k', 'w');
    expect(store.setItemSync).toHaveBeenCalledWith('k', 'w');
    vi.doUnmock('expo-sqlite/kv-store');
  });

  test('the web / Node file has no phone store', async () => {
    vi.resetModules();
    const { phoneKv } = await import('./nativeKv');
    expect(phoneKv()).toBeNull();
  });
});

/*
 * Every key the app stores, through the REAL modules on top of the phone store, "restarting" the
 * app (vi.resetModules, so every module reads its state afresh) between writing and reading.
 */
describe('everything the app remembers survives a restart on a phone', () => {
  beforeEach(() => {
    disk.clear();
    vi.resetModules();
    vi.stubGlobal('localStorage', undefined);
    vi.doMock('./nativeKv', () => ({ phoneKv: () => fakeKv() }));
  });
  afterEach(() => {
    vi.doUnmock('./nativeKv');
    vi.unstubAllGlobals();
  });

  const restart = () => vi.resetModules();

  test('the signed-in session (tokens and user)', async () => {
    const a = await import('../auth/session');
    a.signIn({ access_token: 'acc', refresh_token: 'ref', user: { id: 'u1', phone: '+94771234567', role: 'CUSTOMER', full_name: 'Asha', email: null } });
    restart();
    const b = await import('../auth/session');
    expect(b.getSession()).toMatchObject({ accessToken: 'acc', refreshToken: 'ref', user: { id: 'u1', full_name: 'Asha' } });
    b.endSession('logout');
    restart();
    expect((await import('../auth/session')).getSession()).toBeNull();
  });

  test('the cart', async () => {
    const a = await import('../cart/cartStore');
    a.saveCart({ lines: [{ product: milk, quantity: 3 }] });
    restart();
    const b = await import('../cart/cartStore');
    const cart = b.loadCart();
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ quantity: 3, product: { id: 'p-milk' } });
  });

  test('the language', async () => {
    const a = await import('../i18n/lang');
    a.resetLangForTests();
    a.setLang('ta');
    restart();
    const b = await import('../i18n/lang');
    expect(b.getLang()).toBe('ta');
    b.setLang('en');
  });

  test('the delivery address choice', async () => {
    const a = await import('../address/store');
    a.selectAddress('addr-9');
    restart();
    const b = await import('../address/store');
    expect(b.getLocationState().selected?.id).toBe('addr-9');
    expect(b.getLocationState().sheetDone).toBe(true);
  });

  test('the checkout idempotency key, recent searches, "Skip for now", the pending referral', async () => {
    const co = await import('../orders/checkout');
    const rs = await import('../catalog/recentSearches');
    const gate = await import('../auth/gate');
    const rw = await import('../rewards/api');
    expect(co.checkoutKeyFor('sig-1', () => 'app_fixed')).toBe('app_fixed');
    rs.saveRecentSearches(['milk', 'sugar']);
    gate.rememberSkippedLogin();
    rw.writePendingReferral('FRIEND7');
    restart();
    const co2 = await import('../orders/checkout');
    const rs2 = await import('../catalog/recentSearches');
    const gate2 = await import('../auth/gate');
    const rw2 = await import('../rewards/api');
    expect(co2.checkoutKeyFor('sig-1', () => 'app_other')).toBe('app_fixed');
    expect(rs2.loadRecentSearches()).toEqual(['milk', 'sugar']);
    expect(gate2.hasSkippedLogin()).toBe(true);
    expect(rw2.readPendingReferral()).toBe('FRIEND7');
  });

  test('the remaining keys (rating prompt, analytics, home location sheet) are plain string storage', async () => {
    const { storage } = await import('./storage');
    const keys = [
      'blynk.app.rating-prompted.v1', 'blynk.app.analytics.skus.v1', 'blynk.app.analytics.purchases.v1', 'blynk.home.locSheetClosed',
    ];
    keys.forEach((k, i) => storage.set(k, `value-${i}`));
    restart();
    const again = (await import('./storage')).storage;
    keys.forEach((k, i) => expect(again.get(k)).toBe(`value-${i}`));
  });
});
