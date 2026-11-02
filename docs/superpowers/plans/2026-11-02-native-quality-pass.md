# Native customer app: quality pass before the Play Store (contract)

Owner's brother, 2026-11-02: the app is going to the Play Store and many people will use it: performance, UI and every bug must be right. Real-phone findings so far (all fixed
or being fixed; read the git log of apps/customer-app for 2026-11-02 and docs/superpowers/plans/2026-11-01-customer-app-native.md):
* "Use my current location" crashed (a `.native.ts` file imported its own base name; guard test src/blynk/lib/platformFiles.test.ts).
* "Blynk isn't responding": Reanimated logs a 135-line Java stack for every failed `synchronouslyUpdateUIProps` ("Unable to find SurfaceMountingManager for tag") ON THE MAIN
  THREAD; the Home skeleton shimmers did this thousands of times a second. Measure with: `adb logcat -d -s Reanimated | grep -c "synchronouslyUpdateUIProps failed"` (6,000 per
  first launch before, ~400 now: the rest is a ~60-frame burst per animated view when a screen is removed, plus 12 every ~5 s from some shared-clock views).
* On Android 15 (edge-to-edge) the keyboard no longer resizes the window: forms were covered by it and the address form did not scroll (fixed in src/lib/keyboard.ts and
  LiveAddressScreen; the other forms are in the audit below).
* Launcher icon looked flat white (themed-icon monochrome layer, removed), intro logo should be the big B (done), Home top area sometimes blank on one phone (not reproduced).

Three builders work in parallel on separate concerns. Everyone: read apps/customer-app/AGENTS.md first (Expo SDK 57 changed: check the versioned docs before using an Expo/RN
API), preserve each file's line endings (Read then Edit), another agent is editing other files of the same app at the same time (re-read a file right before you edit it, keep
edits small, never reformat), do NOT edit package.json / app.json / android/ (tell the lead what you need), do not run gradle or an emulator, do not commit or push. Run
`npx tsc --noEmit` and the whole `npx vitest run --testTimeout=120000` before reporting. Tests run in Node only (no React Native): put logic in pure files with tests.
The Metro rule: a platform file (X.native.ts / X.web.ts) must never import its own base name.

---------------------------------------------------------------------------------------------------------------------
## K. Keyboard, insets, back button, small screens - builder K
Audit EVERY screen and component that has a TextInput or a bottom call to action on Android (src/app/**, src/blynk/**): login, otp, register, birthday, address form,
search, checkout/cart (notes, coupon, tip), profile edit, delete account, refer, rating prompt, AskUs, doctors/appointments forms, repeat baskets, feedback.
For each: with the keyboard open the focused field and the primary button must stay visible and reachable (use `useKeyboardInset()` from src/lib/keyboard.ts, which now reports the real
keyboard height on Android 11+ because the window no longer resizes; scroll the focused field into view with the ScrollView ref on focus where the form is long); with it closed the
last field and the button must not sit under the gesture/navigation bar (bottom safe-area inset, `useSafeAreaInsets`); status bar overlap on every screen (edge-to-edge); small
phones (320-360 dp wide, 640-720 dp tall) and large font sizes (system font scale 1.3: text must wrap, not clip; buttons keep their label); the hardware back button on every
screen (modals and sheets close first, no screen traps the user, the cart/checkout/placed flows go where a customer expects, double-back-to-exit is NOT needed); tapping
outside a field dismisses the keyboard where that is the habit. Fix what is wrong with small, safe changes; list every screen you checked with its result (OK / fixed / left and why).
Add pure-logic tests for anything you extract. Report: files changed, the screen-by-screen table, anything that needs a device to confirm.

---------------------------------------------------------------------------------------------------------------------
## R. Runtime errors, animation load and memory - builder R
Goal: nothing makes the main thread block or the phone hot, nothing leaks, no red box or silent failure on a phone.
1. Reanimated update storms. Find every other animated view that can be updated after it is gone or before it is mounted: components with `withRepeat`/`withTiming` loops in
   effects with no `cancelAnimation` cleanup (grep `withRepeat(`; the shared clocks in src/lib/clock.ts: flip, pulse, sway, aisleBeat, rollBeat and anything started with
   `startClocks`), `useAnimatedStyle` on views inside lists that unmount/recycle (FlatList rows, category/search lists, Home rails), the login hero (src/components/LoginHero.tsx:
   ~9 animated views log a ~60-frame burst of failures when the login screen is left), the periodic 12 failures every ~5 s (find which 12 views: price-roll tiles? stamps?). Make every
   loop stop when its view unmounts, when its screen loses focus or the app goes to the background (src/lib/useActive.ts exists; clocks must pause too), and when reduced motion is on
   (`useReducedMotion`). A shared clock must only run while at least one consumer is mounted AND focused. Prefer fewer simultaneous infinite animations: list every animation that
   runs on Home with its cost and propose (and, where safe, make) cuts that keep the look (e.g. one clock for all aisle stamps is fine; per-card infinite loops are not).
2. Low-end phones: add a tiny pure helper (src/lib/lowEnd.ts, uses `expo-device` totalMemory and `Platform.Version`; expo-device is installed) that says "low end" for <= 3 GB RAM or
   Android <= 9, and make the heavy decorative loops (Banner sparkles/clouds, TabHero idle, PromoBand mascot, EmptyCartArt, price roll) check it and render still. Unit-test the helper
   with injected values.
3. Memory and lists: images already go through src/components/RemoteImage.tsx (expo-image); check cart, orders, order detail, product page, search and the category list for anything
   that holds big arrays in state and re-renders on every poll or timer (the catalogue poll is 60 s on the phone and now re-renders only on change); `useEffect` timers/listeners
   without cleanup (grep setInterval/setTimeout/addEventListener/AppState/Keyboard listeners/subscribe), `fetch` without AbortController on screens that unmount.
4. Error handling on a phone: an unhandled promise rejection or a render error must not white-screen the app. Check that a React error boundary wraps the root (expo-router's
   `ErrorBoundary` export in the root layout, with a friendly "Something went wrong, Try again" screen in en/si/ta via the app's `localized` blocks and a restart button that calls
   `router.replace('/home')`), that the network observer / offline banner works, that every `apiRequest` failure path shows a message not a crash (spot-check checkout, orders, address
   save, OTP, tracking), and that the 15 s timeout does not leave a spinner forever.
5. Startup: measure by reading, not guessing: what runs at import time in the root layout and the first screen (src/app/_layout.tsx imports; installConnectivity; analytics; the intro
   timing in src/app/index.tsx = 700 ms). Defer anything non-essential until after the first frame (`InteractionManager.runAfterInteractions` / requestIdleCallback) where safe and
   tested. The launch must show the intro, then Home with the cached catalogue, without waiting for the network.
Report: files changed, each storm source found/fixed (with how you know), the animation list for Home, the low-end rules, what you could not verify without a device.

---------------------------------------------------------------------------------------------------------------------
## P. Play Store readiness and release hardening - builder P
Read docs/06-deployment/play-store-listing.md, docs/06-deployment/ (all), apps/customer-app/app.json, apps/customer-app/plugins/withBlynkRelease.js, src/blynk/legal/*,
apps/customer-site/legal/*.md, apps/customer-site/.well-known/assetlinks.json and the generated android/ folder (read-only; it is generated by `expo prebuild` and gitignored).
1. Policy checklist against Google Play requirements (check the CURRENT policy pages on developer.android.com / support.google.com with the web, do not rely on memory): target API
   level (is targetSdk 36 right for 2026?), permissions declared in app.json (INTERNET, location fine/coarse, POST_NOTIFICATIONS, VIBRATE; the generated manifest also gets
   RECEIVE_BOOT_COMPLETED, WAKE_LOCK, badge permissions from expo-notifications: list every permission in the built manifest and say which can be removed with `blockedPermissions`),
   foreground-only location justification text, in-app account deletion (Play requires an in-app path AND a web URL: confirm src/app has a delete-account flow and the web URL
   https://blynk.lk/delete-account exists), privacy policy URL, Data safety form answers (what the app collects: phone number, name, addresses/location, order history, device token,
   analytics events; shared with PayHere for payments; encrypted in transit; deletable) written as a ready-to-paste table, content rating questionnaire answers (a grocery store; no
   user-generated content except order notes/ratings), ads: none, app access instructions for the reviewer (the reviewer login env/phone: find how it is set in docs and backend:
   `grep -ri reviewer`), the closed-testing requirement for personal accounts (12 testers, 14 days), store listing assets needed (icon 512, feature graphic 1024x500, phone
   screenshots 2-8, short and full description in en/si/ta) with what already exists in the repo.
2. Release hardening via app.json / config plugins only (propose the exact JSON for the lead, you may write a NEW plugin file in apps/customer-app/plugins/ and its test): R8/Proguard
   minify + resource shrinking for release (is it safe with this module set? what keep rules do react-native-reanimated, expo-sqlite, react-native-webview, expo-notifications need? the
   current release build has `minifyEnabled false`: check android/app/build.gradle's `enableMinifyInReleaseBuilds` property and `android.enableShrinkResourcesInReleaseBuilds`), `allowBackup=false`
   (the session token is in SQLite; `fullBackupContent`/`dataExtractionRules`), `usesCleartextTraffic=false` (already), network security config, ABI splits / `reactNativeArchitectures` for the
   AAB (arm64-v8a, armeabi-v7a, x86_64 vs 16 KB page size support: Android 15+ and Play require 16 KB page-size compatible native libs for apps targeting 15+ from Nov 2025: verify every
   .so in the AAB supports it, tell the lead how to check with the Android build-tools `zipalign -c -P 16`), `android:supportsRtl`, screen orientation lock (portrait), predictive back
   (`predictiveBackGestureEnabled` is false: is that right?), deep link intent filters and assetlinks (Play app signing key needs adding after upload), notification channel/icon.
3. Write `docs/06-deployment/play-store-native-checklist.md`: every item with status (done / needs owner / needs lead), exact steps for the owner in Play Console in order (create app,
   app access, ads, content rating, data safety, target audience (not for children), news app: no, COVID: no, government: no, store listing, countries, closed testing track with
   testers, upload the AAB, release notes en/si/ta, App signing key SHA-256 to send to the lead, pre-launch report review, staged rollout 10% -> 50% -> 100%, Android vitals watch for ANR
   and crash rate with the thresholds Play uses). Update docs/06-deployment/play-store-listing.md if anything there is stale (it still mentions the TWA).
4. Crash visibility after launch: say what the owner can see for free in Play Console (Android vitals: crashes and ANRs, pre-launch report) and recommend (with the exact package and
   setup steps, but do NOT install) one crash reporter that works with Expo SDK 57 (Sentry or Firebase Crashlytics) with the native-config steps and the privacy-policy line needed.
Report: files changed/created, the permission list found, items that need the owner, items that need the lead (app.json JSON proposals), anything risky.
