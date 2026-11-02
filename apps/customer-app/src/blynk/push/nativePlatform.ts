import * as Notifications from 'expo-notifications';
import { C } from '@/lib/theme';
import type { PushPermission, PushPlatform } from './manager';

/*
 * Push on the Android app: expo-notifications on the phone's own Firebase (FCM) registration.
 * The backend sends through FCM directly (push.sender.ts), so the token is the FCM token from
 * getDevicePushTokenAsync(), not an Expo push token, and it is registered as platform 'android'.
 *  - Android 13+ asks for POST_NOTIFICATIONS at runtime (requestPermissionsAsync); earlier
 *    versions grant it at install. The manager's permission() is synchronous, so the state is
 *    cached here and re-read by refresh() (the user can also flip it in system settings).
 *  - the "orders" channel (the id push.sender.ts puts on every message) is created before the
 *    permission prompt or a token is asked for - Android 13+ shows no prompt without a channel;
 *    messages for a channel that does not exist land in a generic "Miscellaneous" one.
 *  - while the app is open a push shows as the normal banner (setNotificationHandler); in the
 *    background Android shows it itself. A tap arrives through the response listener (app
 *    running) or getLastNotificationResponseAsync (the tap launched the app).
 *  - sign-out deletes the Firebase token (unregisterForNotificationsAsync); Firebase then mints a
 *    new one, which the manager ignores until someone signs in.
 * Does not touch the browser build: platform.native.ts is the only importer.
 */

/** Matches ORDERS_CHANNEL_ID in backend/api/src/modules/notifications/push/push.sender.ts. */
export const ORDERS_CHANNEL_ID = 'orders';
export const ORDERS_CHANNEL_NAME = 'Orders and offers';
/** Blynk yellow (C.brand) as the notification light. */
export const NOTIFICATION_LIGHT = C.brand;

type PermissionResult = { granted: boolean; status: string; canAskAgain: boolean };

/**
 * The phone's permission as the manager's four states. Not asked yet, or denied once and
 * Android will still show the prompt (it shows it twice) -> 'default' (we may ask); denied and
 * Android will not ask again (blocked, or notifications switched off in settings) -> 'denied'.
 */
export function mapPermission(r: PermissionResult | null | undefined): PushPermission {
  if (!r) return 'default';
  if (r.granted || r.status === 'granted') return 'granted';
  if (r.status === 'undetermined') return 'default';
  return r.canAskAgain ? 'default' : 'denied';
}

/** The data of a tapped notification: the FCM data values (strings), under what the module gives. */
export function responseData(r: Notifications.NotificationResponse): Record<string, unknown> {
  const request = r.notification?.request;
  const trigger = request?.trigger as { type?: string; remoteMessage?: { data?: Record<string, string> } } | null | undefined;
  const fromMessage = trigger?.type === 'push' ? trigger.remoteMessage?.data : undefined;
  const fromContent = request?.content?.data;
  return { ...(fromMessage ?? {}), ...(fromContent && typeof fromContent === 'object' ? fromContent : {}) };
}

export function createNativePushPlatform(): PushPlatform {
  let permission: PushPermission = 'default';
  let channelReady: Promise<void> | null = null;
  let handlerSet = false;

  const ensureChannel = (): Promise<void> => {
    channelReady ??= Notifications.setNotificationChannelAsync(ORDERS_CHANNEL_ID, {
      name: ORDERS_CHANNEL_NAME,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: NOTIFICATION_LIGHT,
      enableLights: true,
      enableVibrate: true,
      showBadge: true,
    }).then(() => undefined).catch(() => { channelReady = null; });
    return channelReady;
  };

  const read = async () => { permission = mapPermission(await Notifications.getPermissionsAsync()); };

  return {
    name: 'android',
    async initialize() {
      if (!handlerSet) {
        handlerSet = true;
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: true,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });
      }
      await ensureChannel();
      await read();
    },
    permission: () => permission,
    refresh: read,
    async requestPermission() {
      await ensureChannel();
      const r = await Notifications.requestPermissionsAsync();
      // an explicit "no" counts as no for this run (the next launch may ask once more if Android allows)
      permission = mapPermission(r) === 'granted' ? 'granted' : 'denied';
      return permission;
    },
    async getToken() {
      if (permission !== 'granted') return null;
      await ensureChannel();
      const t = await Notifications.getDevicePushTokenAsync();
      return typeof t.data === 'string' && t.data ? t.data : null;
    },
    async deleteToken() {
      await Notifications.unregisterForNotificationsAsync();
    },
    onTokenRefresh(cb) {
      const sub = Notifications.addPushTokenListener((t) => {
        if (typeof t.data === 'string' && t.data) cb(t.data);
      });
      return () => sub.remove();
    },
    onTap(cb) {
      // the same tap can reach us twice (the launch response and the listener): open it once
      let lastId: string | null = null;
      const deliver = (r: Notifications.NotificationResponse | null) => {
        if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
        const id = r.notification?.request?.identifier || null;
        if (id && id === lastId) return;
        lastId = id;
        cb(responseData(r));
      };
      const sub = Notifications.addNotificationResponseReceivedListener(deliver);
      // cold start: the tap that launched the app
      void Notifications.getLastNotificationResponseAsync()
        .then((r) => {
          if (!r) return;
          deliver(r);
          return Notifications.clearLastNotificationResponseAsync();
        })
        .catch(() => undefined);
      return () => sub.remove();
    },
  };
}
