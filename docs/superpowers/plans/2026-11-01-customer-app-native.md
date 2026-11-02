# Customer app as a real native Android app (contract)

Owner/brother 2026-11-01: build the customer app natively for the Play Store instead of the TWA wrapper. The app (apps/customer-app) is an Expo SDK 57 / React Native 0.86
app that so far ships only as a web PWA (blynk.lk/app). Package name `lk.blynk.customer`. Release key and Firebase (`blynk-15cd4`, Android app lk.blynk.customer exists) are ready.

**Read first**: `apps/customer-app/AGENTS.md` (Expo has changed: fetch the SDK 57 docs, https://docs.expo.dev/versions/v57.0.0/ and https://docs.expo.dev/llms.txt, before writing code
that touches an Expo / RN API; never answer from memory), then your section.

Native app rules: the web build must keep working exactly as today (every change is `Platform.OS` guarded or lives in `.native.ts(x)` / `.web.ts(x)` siblings, with the web
version unchanged). Keep `localized` en/si/ta for any new text (see docs/superpowers/plans/2026-10-25-translations.md, src/blynk/i18n/complete.test.ts must pass).

The lead already ran `npx expo install expo-sqlite expo-location expo-notifications expo-device expo-build-properties` (do NOT edit `package.json`, `app.json` or any
`android/` folder; if you need a plugin option or another package, say so in your report and the lead adds it). Three builders work in parallel on separate areas; never edit another
builder's files; do not commit or push; preserve each file's line endings (Read then Edit). Run `npx tsc --noEmit` and the whole `npx vitest run --testTimeout=120000` in
apps/customer-app before reporting. Tests are Node/vitest (no device): unit-test the pure logic and mock the native modules. Do NOT start an emulator or run any gradle/expo build.

---------------------------------------------------------------------------------------------------------------------
## S. Storage, location and the web-only audit - builder S

1. `src/blynk/lib/storage.ts` keeps its synchronous API (`get`, `set`; add `remove` only if something needs it) but on native persists with the SDK 57 key-value store of
   `expo-sqlite` (`expo-sqlite/kv-store`, which has synchronous `getItemSync` / `setItemSync`; read its docs). Today native is an in-memory map, so the sign-in session, cart, language
   and address are lost on every restart: find every key the app stores (`storage.get/set`, plus any direct localStorage use) and prove they survive (unit test with the module mocked).
   Web behaviour unchanged; never throws.
2. Device location: `src/app/(tabs)/home.tsx` and `src/blynk/address/maplibre.ts` (and any other caller) use `navigator.geolocation`. Add one small module (e.g. `src/blynk/location/position.ts`
   with a pure interface + a native implementation using `expo-location`: foreground permission, `getCurrentPositionAsync`, balanced accuracy, 10 s timeout, never throws, returns
   `{lat,lng,accuracy}` or a reason `denied | unavailable | timeout`) and make the callers use it on native, leaving the browser path as is. The permission rationale text goes through
   the `expo-location` plugin in app.json: tell the lead the exact string you want.
3. Audit EVERY other web-only use in the app for what a native device does: `document.`, `window.`, `navigator.`, `localStorage`, `Platform.OS === 'web'` branches that have no native
   branch (cutout.ts, visibility.ts, useActive.ts, track.ts analytics, splash.ts, ThemeColor, keyboard, form.ts, legal open, connectivity, catalogLive, share, `_layout.tsx`, login's
   viewport height, the `outlineStyle` inputs, pages that call `fetch` with relative URLs or `location`). Fix what would crash or misbehave on a phone (guarded, tested); list in your
   report anything you found but left (with why). Pay special attention to: back button, deep links (`blynk://`, the `/order/[id]` push target), the status bar, safe areas, the splash,
   fonts loading, and images (remote URLs, cutout canvas) on native.
4. Anything about the sign-in itself (phone OTP via our own API): confirm nothing in `src/blynk/auth` needs the browser (cookies, localStorage-only token) and say how the token is kept.
5. Report: files changed, keys that persist, the location plugin string, the audit list (fixed / left), tests.

---------------------------------------------------------------------------------------------------------------------
## M. Maps on the phone - builder M

Today three screens draw maps with MapLibre GL JS loaded from a CDN into a DOM node, web only: the address picker (`src/blynk/address/LiveAddressScreen.tsx` + `maplibre.ts`, shows a
"failed" fallback on native), the order tracking map (`src/blynk/tracking/TrackingMap.tsx`) and anything else that calls `loadMapLibre`. `src/blynk/area/CoverageMap.tsx` is SVG (check
that it renders on native). Build the native versions with **`react-native-webview`** (already installed, 13.16.1) hosting a small HTML page that loads the same MapLibre GL JS build and
OpenFreeMap "liberty" style, with a message bridge (`postMessage` / `onMessage`) - not a new native map library. Requirements:
* One reusable `NativeMapView` (e.g. `src/blynk/map/NativeMapView.tsx` + a pure `html.ts` that builds the page string + a typed message protocol in `protocol.ts`) used by the address
  picker and the tracking map. Features the existing web code has: centre pin / draggable map with `moveend` -> centre callback, `easeTo`/`jumpTo` from React, padding, store point and
  the delivery-area overlay (store circle + the extra zone rings from `/store.delivery_zones`, as the web code now draws), markers (door pin, rider disc with heading, route line),
  attribution text, zoom limits, no rotation. Reuse the existing pure helpers (circle GeoJSON etc.) by sharing them between the web code and the page (move shared logic into a plain
  module both import; the HTML page can embed the function source via `.toString()` or a string template, whichever you can unit test).
* WebView hardening: `originWhitelist` only about:blank/the tile + CDN hosts, no file access, `javaScriptEnabled` only, no `allowUniversalAccessFromFileURLs`, `setSupportMultipleWindows`
  false, ignore messages that are not our JSON protocol, validate numbers before using them. CDN failure or slow tiles -> the same "map failed / try again / pick from list" fallbacks the
  web code has. Also consider bundling nothing new offline; say what happens offline.
* Keep the web path exactly as is; the native branch is selected with `Platform.OS !== 'web'`. Keep `Platform.OS` conditionals out of the pure files.
* Tests: pure html/protocol builders (snapshot-free assertions: contains the style URL, the zone ring data, escapes user text such as zone names), message parsing/validation, and a
  render test where the repo's setup allows (mock `react-native-webview`).
* Do not touch storage/location (builder S owns `src/blynk/location` and `home.tsx`); the picker's GPS button should call whatever `getCurrentPosition` interface builder S defines in
  `src/blynk/location/position.ts` - coordinate by using exactly this signature: `getCurrentPosition(): Promise<{ ok: true; lat: number; lng: number; accuracy: number } | { ok: false; reason: 'denied'|'unavailable'|'timeout' }>`. If the file does not exist yet when you finish, import it anyway (builder S creates it).
* Report: files changed, protocol, what the customer sees on a phone, fallbacks, tests.

---------------------------------------------------------------------------------------------------------------------
## P. Push notifications on the phone - builder P

`src/blynk/push/manager.ts` is a platform-independent state machine driven by a `PushPlatform` (see `webPlatform.ts`, `index.ts` where native currently returns `null`: "native builds
have no Firebase config yet"). Add `nativePlatform.ts` with `expo-notifications` (+ `expo-device`): 
* Android 13+ POST_NOTIFICATIONS runtime permission through `requestPermissionsAsync`; create the default channel (name "Orders and offers", importance high, Blynk yellow `#FFD400`
  light colour - use the app's real theme colour) before registering; obtain the **FCM token** with `getDevicePushTokenAsync()` (not an Expo push token: our backend sends through FCM
  directly), register it with `POST /me/devices { token, platform }` (read `src/blynk/api/push.ts` and `backend/api/src/modules/users` / notifications: confirm `platform: 'android'` is
  accepted, and what the payload `data` looks like for order updates, offers, flash deals, buy-again etc. so taps route correctly; make `pushTargetOf` handle every `type` the server sends
  that has an obvious screen, e.g. order -> `/order/[id]`; do not invent routes). Foreground messages: show as the system banner (`setNotificationHandler`), tap handling for
  warm and cold start (`getLastNotificationResponseAsync`, `addNotificationResponseReceivedListener`), token refresh listener (`addPushTokenListener`) re-registers; sign-out unregisters
  (the manager already does for web: reuse).
* Keep web exactly as is (`Platform.OS === 'web'` -> web platform). `DEMO` mode stays off.
* Do not edit `app.json`: tell the lead the plugin options you need (`expo-notifications` plugin: small icon path, colour, default channel; `googleServicesFile` is the lead's) and which
  assets you need (a monochrome white-on-transparent 96x96 notification icon: you may generate it into `assets/notification-icon.png` from `assets/logo-mark.png` with a node script
  using whatever image tooling is already in node_modules, e.g. sharp, or tell the lead).
* Tests: manager + native platform with the expo modules mocked (permission granted/denied/blocked, token registered once, refresh re-registers, tap routing warm/cold, sign-out
  unregisters), `pushTargetOf` cases.
* Report: files changed, the push `data` types handled, plugin options and assets needed, what could not be tested without a device.
