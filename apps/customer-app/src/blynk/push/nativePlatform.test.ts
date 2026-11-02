import { beforeEach, expect, test, vi } from 'vitest';
import { createPushManager } from './manager';
import { createTargetOpener } from './openTarget';
import { pushTargetOf } from './target';

/* The expo-notifications module, mocked: permission state, the FCM token, listeners, the launch tap. */
const N = vi.hoisted(() => {
  const state = {
    perm: { granted: false, status: 'undetermined', canAskAgain: true } as { granted: boolean; status: string; canAskAgain: boolean },
    // what the system prompt answers with
    answer: { granted: true, status: 'granted', canAskAgain: true } as { granted: boolean; status: string; canAskAgain: boolean },
    token: 'fcm-1',
    last: null as unknown,
    tapListener: null as ((r: unknown) => void) | null,
    tokenListener: null as ((t: { type: string; data: unknown }) => void) | null,
    order: [] as string[],
  };
  const mod = {
    DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
    AndroidImportance: { HIGH: 6 },
    setNotificationHandler: vi.fn(),
    setNotificationChannelAsync: vi.fn(async () => { state.order.push('channel'); return null; }),
    getPermissionsAsync: vi.fn(async () => ({ ...state.perm })),
    requestPermissionsAsync: vi.fn(async () => {
      state.order.push('prompt');
      state.perm = { ...state.answer };
      return { ...state.answer };
    }),
    getDevicePushTokenAsync: vi.fn(async () => { state.order.push('token'); return { type: 'android', data: state.token }; }),
    unregisterForNotificationsAsync: vi.fn(async () => undefined),
    addPushTokenListener: vi.fn((cb: (t: { type: string; data: unknown }) => void) => { state.tokenListener = cb; return { remove: vi.fn(() => { state.tokenListener = null; }) }; }),
    addNotificationResponseReceivedListener: vi.fn((cb: (r: unknown) => void) => { state.tapListener = cb; return { remove: vi.fn(() => { state.tapListener = null; }) }; }),
    getLastNotificationResponseAsync: vi.fn(async () => state.last),
    clearLastNotificationResponseAsync: vi.fn(async () => { state.last = null; }),
  };
  return { state, mod };
});
vi.mock('expo-notifications', () => N.mod);

import { createNativePushPlatform, mapPermission, NOTIFICATION_LIGHT, ORDERS_CHANNEL_ID, ORDERS_CHANNEL_NAME, responseData } from './nativePlatform';

const tapOf = (data: Record<string, unknown>, id = 'n1', action = N.mod.DEFAULT_ACTION_IDENTIFIER) => ({
  actionIdentifier: action,
  notification: { request: { identifier: id, content: { data }, trigger: { type: 'push' } } },
});

function setup() {
  const platform = createNativePushPlatform();
  const register = vi.fn(async (_t: string, _p: string) => undefined);
  const unregister = vi.fn(async (_t: string, _a: string) => undefined);
  const onTap = vi.fn();
  const m = createPushManager({ platform: () => platform, register, unregister, onTap });
  return { platform, m, register, unregister, onTap };
}

beforeEach(() => {
  vi.clearAllMocks();
  N.state.perm = { granted: false, status: 'undetermined', canAskAgain: true };
  N.state.answer = { granted: true, status: 'granted', canAskAgain: true };
  N.state.token = 'fcm-1';
  N.state.last = null;
  N.state.tapListener = null;
  N.state.tokenListener = null;
  N.state.order = [];
});

test('the phone permission maps onto the manager states (undetermined / asked once / blocked)', () => {
  expect(mapPermission({ granted: true, status: 'granted', canAskAgain: true })).toBe('granted');
  expect(mapPermission({ granted: false, status: 'undetermined', canAskAgain: true })).toBe('default');
  // denied once: Android still shows the prompt a second time
  expect(mapPermission({ granted: false, status: 'denied', canAskAgain: true })).toBe('default');
  // denied twice, or notifications switched off in system settings
  expect(mapPermission({ granted: false, status: 'denied', canAskAgain: false })).toBe('denied');
  expect(mapPermission(null)).toBe('default');
});

test('initialize: the "orders" channel (high importance, Blynk yellow light), the foreground banner handler', async () => {
  const { m, platform } = setup();
  expect(platform.name).toBe('android');
  expect(await m.start()).toBe(true);
  expect(N.mod.setNotificationChannelAsync).toHaveBeenCalledWith(ORDERS_CHANNEL_ID, expect.objectContaining({
    name: 'Orders and offers', importance: 6, lightColor: NOTIFICATION_LIGHT,
  }));
  expect(ORDERS_CHANNEL_ID).toBe('orders'); // push.sender.ts ORDERS_CHANNEL_ID
  expect(ORDERS_CHANNEL_NAME).toBe('Orders and offers');
  expect(NOTIFICATION_LIGHT).toBe('#FFE141');
  const handler = N.mod.setNotificationHandler.mock.calls[0][0] as { handleNotification: () => Promise<Record<string, boolean>> };
  expect(await handler.handleNotification()).toEqual({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true });
});

test('not asked yet: signing in neither prompts nor registers; a tap asks (channel first), then registers the FCM token once as android', async () => {
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(N.mod.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(N.mod.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(await m.permission()).toBe('default');

  expect(await m.requestPermission()).toBe('granted');
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith('fcm-1', 'android');
  // the channel exists before the prompt and before the token (Android 13+ needs that)
  expect(N.state.order.indexOf('channel')).toBeLessThan(N.state.order.indexOf('prompt'));
  expect(N.state.order.indexOf('prompt')).toBeLessThan(N.state.order.indexOf('token'));
  // asking again, signing in again: no second prompt, no second registration
  expect(await m.requestPermission()).toBe('granted');
  await m.signedIn();
  expect(N.mod.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledTimes(1);
});

test('already allowed (Android 12 or earlier, or granted before): signing in registers at once', async () => {
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(register).toHaveBeenCalledWith('fcm-1', 'android');
  expect(N.mod.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('permission denied at the prompt: nothing is registered, and it is not asked again in this run', async () => {
  N.state.answer = { granted: false, status: 'denied', canAskAgain: true };
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(await m.requestPermission()).toBe('denied');
  expect(register).not.toHaveBeenCalled();
  expect(N.mod.getDevicePushTokenAsync).not.toHaveBeenCalled();
});

test('blocked (denied, Android will not ask again): no prompt at all, no token, reported as denied', async () => {
  N.state.perm = { granted: false, status: 'denied', canAskAgain: false };
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(await m.requestPermission()).toBe('denied');
  expect(await m.permission()).toBe('denied');
  expect(N.mod.requestPermissionsAsync).not.toHaveBeenCalled();
  expect(N.mod.getDevicePushTokenAsync).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

test('allowed in system settings while the app is closed: the next sign-in re-reads it and registers', async () => {
  N.state.perm = { granted: false, status: 'denied', canAskAgain: false };
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(register).not.toHaveBeenCalled();
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  await m.signedIn();
  expect(register).toHaveBeenCalledWith('fcm-1', 'android');
});

test('token refresh re-registers the new token while signed in; not while signed out', async () => {
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  const { m, register, unregister } = setup();
  await m.start();
  await m.signedIn();
  expect(register).toHaveBeenCalledTimes(1);
  N.state.tokenListener!({ type: 'android', data: 'fcm-2' });
  await vi.waitFor(() => expect(register).toHaveBeenLastCalledWith('fcm-2', 'android'));
  // junk is ignored
  N.state.tokenListener!({ type: 'android', data: { endpoint: 'x' } });
  N.state.tokenListener!({ type: 'android', data: '' });
  // sign-out: DELETE with the old access token, the Firebase token is deleted, the minted new token is not registered
  await m.signedOut('old-access');
  expect(unregister).toHaveBeenCalledWith('fcm-2', 'old-access');
  expect(N.mod.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  N.state.tokenListener!({ type: 'android', data: 'fcm-3' });
  await new Promise((r) => setTimeout(r, 0));
  expect(register).toHaveBeenCalledTimes(2);
});

test('signing in again after sign-out registers the new Firebase token', async () => {
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  await m.signedOut('a');
  N.state.token = 'fcm-new';
  await m.signedIn();
  expect(register).toHaveBeenLastCalledWith('fcm-new', 'android');
});

test('a failing sign-out API call or Firebase delete never throws', async () => {
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  const { m, unregister } = setup();
  unregister.mockRejectedValueOnce(new Error('offline'));
  N.mod.unregisterForNotificationsAsync.mockRejectedValueOnce(new Error('play services'));
  await m.start();
  await m.signedIn();
  await expect(m.signedOut('a')).resolves.toBeUndefined();
});

test('a token that is not a string (a non-FCM device) is never registered', async () => {
  N.state.perm = { granted: true, status: 'granted', canAskAgain: true };
  N.state.token = undefined as unknown as string;
  const { m, register } = setup();
  await m.start();
  await m.signedIn();
  expect(register).not.toHaveBeenCalled();
});

test('a push that cannot start (module throws) turns push off: every call is a no-op', async () => {
  N.mod.getPermissionsAsync.mockRejectedValueOnce(new Error('no module'));
  const { m, register } = setup();
  expect(await m.start()).toBe(false);
  await m.signedIn();
  expect(await m.requestPermission()).toBe('unsupported');
  expect(register).not.toHaveBeenCalled();
});

test('tap while the app runs: the response listener hands over the FCM data', async () => {
  const { m, onTap } = setup();
  await m.start();
  N.state.tapListener!(tapOf({ type: 'order', order_id: 'o1' }));
  expect(onTap).toHaveBeenCalledWith({ type: 'order', order_id: 'o1' });
  // a different action (or a dismiss) is not a tap
  N.state.tapListener!(tapOf({ type: 'order', order_id: 'o2' }, 'n2', 'dismiss'));
  expect(onTap).toHaveBeenCalledTimes(1);
});

test('tap that launched the app (cold start): the last response is delivered once and cleared, not twice', async () => {
  N.state.last = tapOf({ type: 'product', product_id: 'p1' }, 'cold-1');
  const { m, onTap } = setup();
  await m.start();
  await vi.waitFor(() => expect(onTap).toHaveBeenCalledWith({ type: 'product', product_id: 'p1' }));
  expect(N.mod.clearLastNotificationResponseAsync).toHaveBeenCalled();
  // the listener delivering the same notification again is ignored; a different one is not
  N.state.tapListener!(tapOf({ type: 'product', product_id: 'p1' }, 'cold-1'));
  expect(onTap).toHaveBeenCalledTimes(1);
  N.state.tapListener!(tapOf({ type: 'wallet' }, 'n3'));
  expect(onTap).toHaveBeenCalledTimes(2);
});

test('no launch tap: nothing is delivered; a throwing getLastNotificationResponseAsync is ignored', async () => {
  const { m, onTap } = setup();
  await m.start();
  expect(onTap).not.toHaveBeenCalled();
  N.mod.getLastNotificationResponseAsync.mockRejectedValueOnce(new Error('x'));
  const second = setup();
  await expect(second.m.start()).resolves.toBe(true);
});

test('the data falls back to the Firebase message data, content.data wins', () => {
  const r = {
    actionIdentifier: N.mod.DEFAULT_ACTION_IDENTIFIER,
    notification: { request: { identifier: 'x', content: { data: { type: 'order' } }, trigger: { type: 'push', remoteMessage: { data: { type: 'wallet', order_id: 'o7' } } } } },
  };
  expect(responseData(r as never)).toEqual({ type: 'order', order_id: 'o7' });
  expect(responseData({ notification: { request: { content: { data: {} }, trigger: null } } } as never)).toEqual({});
});

test('tap routing end to end: a launch tap waits for the intro, then opens the order; warm taps open at once', () => {
  vi.useFakeTimers();
  try {
    const paths: string[] = [];
    let introDone = false;
    const open = createTargetOpener({ navigate: (p) => { paths.push(p); }, ready: () => introDone, intervalMs: 250, maxTries: 40 });
    open({ type: 'order', order_id: 'o1' });
    expect(paths).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(paths).toEqual([]);
    introDone = true;
    vi.advanceTimersByTime(250);
    expect(paths).toEqual(['/order/o1']);
    vi.advanceTimersByTime(5000);
    expect(paths).toEqual(['/order/o1']); // once
    open({ type: 'product', product_id: 'p1' });
    expect(paths).toEqual(['/order/o1', '/p/p1']);
    open({ kind: 'broadcast' }); // opens the app only
    open({ type: 'staff_order', order_id: 'x' });
    expect(paths).toHaveLength(2);
    expect(pushTargetOf({ type: 'wallet' })?.path).toBe('/wallet');
  } finally {
    vi.useRealTimers();
  }
});

test('the opener retries while the navigator throws, then gives up quietly', () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const open = createTargetOpener({ navigate: () => { calls += 1; if (calls < 3) throw new Error('not mounted'); }, intervalMs: 100, maxTries: 5 });
    open({ type: 'wallet' });
    vi.advanceTimersByTime(1000);
    expect(calls).toBe(3);

    let fails = 0;
    const never = createTargetOpener({ navigate: () => { fails += 1; throw new Error('x'); }, intervalMs: 100, maxTries: 4 });
    expect(() => never({ type: 'wallet' })).not.toThrow();
    vi.advanceTimersByTime(10_000);
    expect(fails).toBe(4);
  } finally {
    vi.useRealTimers();
  }
});
