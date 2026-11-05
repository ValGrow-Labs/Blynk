# Blynk customer app on Google Play: native build checklist (2026-11-02)

The Play app is now the **native Expo app** (`apps/customer-app`, package `lk.blynk.customer`, Expo SDK 57, React Native 0.86), not the TWA wrapper. This file is the working checklist: policy facts, what the built app really declares, every item with a status, the Play Console steps in order, the Data safety answers, release hardening proposals for the lead, and crash visibility. The listing text, graphics and long answers still live in [`play-store-listing.md`](play-store-listing.md) (sections 5 to 8); where this file and that one disagree on the native app, this file wins.

Status words: **DONE** (in the repo or verified), **OWNER** (needs the owner's Google account, money, documents or decision), **LEAD** (needs an `app.json` / code / server change by the lead).

Policy facts were read from the Google pages listed in section 12 on 2026-11-02. Google changes these; the Play Console's own prompts win.

## 1. The five things that decide the launch date

1. **Developer account verified** (OWNER). Nothing can be created in Play Console before it. Personal account: also a **closed test, 12 testers, 14 days in a row** before production (section 6, step 14). Organisation account: no such test but needs a D-U-N-S number.
2. **A fresh AAB** (LEAD). The only AAB on disk is `C:\Users\pc\Downloads\Blynk-release\blynk-customer-1.0.0-code1.aab` (1.0.0, versionCode 1). The app is at 1.0.4 / versionCode 5 with many fixes. Build a new bundle (recipe in section 8).
3. **Review sign-in** (OWNER): set `REVIEW_LOGIN_PHONE` and `REVIEW_LOGIN_OTP` on the production API in Coolify (section 7).
4. **Data safety form** (OWNER, answers in section 5). Two answers are judgment calls (map provider, PayHere page): section 5.2.
5. **Native screenshots** (LEAD or OWNER). The 8 screenshots in `play-store-assets/screenshots/` are of the web PWA, not the native app. Retake them from the native build.

## 2. Policy facts checked on 2026-11-02

| Topic | What Google says now | What it means for Blynk |
|---|---|---|
| Target API level | New apps and updates must target **Android 16 (API 36) from 31 Aug 2026**; the extension to 1 Nov 2026 has also passed. Existing apps need API 35+ to stay visible to new users. | `targetSdk` and `compileSdk` are **36** (React Native 0.86's defaults; seen in the built manifest: `minSdkVersion 24`, `targetSdkVersion 36`). **Correct. DONE.** |
| 16 KB page size | All apps targeting API 35+ must support 16 KB pages **on 64-bit devices**. From **1 Feb 2027** updates that do not are blocked. Needs AGP 8.5.1+ and 16 KB ELF alignment (NDK r28+ does it by default; r27 needs linker flags). | The repo builds with AGP 8.12.0 and NDK 27.1. Checked the built 1.0.4 release APK myself: all 26 native libs of **arm64-v8a and x86_64** have ELF `LOAD` alignment 0x4000 (16 KB) and `zipalign -c -P 16 -v 4` (build-tools 37.0.0) reports success. The `armeabi-v7a` libs are only 4 KB aligned: that is fine, the rule covers 64-bit only and 16 KB devices are 64-bit. See 3.2 for how to re-check the final AAB. **DONE for the APK, LEAD to re-verify the AAB.** |
| Personal accounts | Accounts created after 13 Nov 2023 must run a closed test with **at least 12 testers opted in for 14 consecutive days** before applying for production. | Only if the owner opens a *personal* account (OWNER). |
| Account deletion | Apps with accounts need an **in-app deletion path** and a **web link** (entered in the Data safety form) where users can request deletion without reinstalling the app. The page must name the app/developer as in the listing, be easy to find and work without errors. Retention must be disclosed. | In-app: **Profile tab > Delete account** (confirm sheet, `DELETE /me`, refused with a clear message while an order is open). Web: `https://blynk.lk/delete-account` (served by nginx, page "Delete your Blynk account - Blynk", app steps + email request, what is deleted and kept). **DONE.** Re-open the URL on the day you submit (it was last checked 2026-10-24). |
| Data safety | "Collect" = data sent off the device, **including by SDKs and by a WebView your app controls**. "Share" = to a third party; service providers acting on your behalf are not sharing. Declare encryption in transit only if all data is encrypted. You alone are responsible for accuracy. | Section 5. |
| App access | If login restricts the app, give working credentials; one-time codes go in "any other instructions". Up to 5 instruction sets. | Section 7. |
| Foreground-only location | Preferred scope; no Permissions Declaration Form (that form is for background location). The **location button** becomes the *recommended minimum scope for precise one-time location* with a deadline of **27 Jan 2027**; apps targeting Android 17+ have implementation requirements. | Blynk requests foreground location once ("Use my current location"), no background location, no declaration form. **DONE.** Later (LEAD, not blocking): when the app targets API 37, move that one tap to the system location button. |
| Foreground services | FGS use is reviewed. | The merged manifest has **no** `FOREGROUND_SERVICE*` permission, but `expo-location` leaves a dead `LocationTaskService` (`foregroundServiceType="location"`). The new plugin removes it (3.5). |
| Advertising ID | Apps targeting 13+ must declare `AD_ID` if they use it. | The built manifest has **no** `AD_ID`: Play Console "Advertising ID": **No**. |
| Developer verification | Apps must be registered in Play Console (deadline was 30 Sep 2026); about 99% of Play apps were registered automatically; the Play Console also needs the developer's identity verified. | Creating the app registers it. The staff Ops/Rider APKs are sideloaded: check Google's developer-verification page for outside-Play apps (not verified here). |
| Android vitals | Bad-behaviour thresholds (28-day average): **user-perceived crash rate 1.09%** overall, **ANR rate 0.47%** overall, **8% per phone model** for both; excessive partial wake locks 5%. Exceeding them can lower visibility and show a warning on the listing. | Section 10. |
| DEX optimisation and memory | From **Feb 2027** apps with more than 10 MB of DEX code need at least **25% optimised/obfuscated/shrunk** code; memory and bitmap-memory thresholds also start affecting visibility. | The built release APK has **47.3 MB of DEX** (5 files) and R8 is **off**. Enabling R8 (section 4.1) is needed, not optional. |
| Android 16 behaviour (target 36) | Edge-to-edge cannot be opted out. Predictive-back animations are on by default but `android:enableOnBackInvokedCallback="false"` is still honoured ("temporarily"). **Orientation, resizability and aspect-ratio locks are ignored on screens with smallest width of 600 dp or more** (tablets, foldable inner screens) unless the temporary opt-out property is set. | The app already handles edge-to-edge. Keep predictive back off for now (4.7). The portrait lock will not hold on tablets/foldable inner screens: limit the release to phones in Play Console (section 6, step 11) and test one foldable/tablet if you can. |

## 3. What the built app really declares

Source: the merged **release** manifest of the 1.0.4 build (`android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml`, read-only), plus `app.json`.

### 3.1 Permissions (31 in the merged manifest)

| Permission | Comes from | Needed? | Can go with `blockedPermissions`? |
|---|---|---|---|
| `INTERNET` | app.json | Yes | No |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | app.json + expo-location | Yes: the delivery pin ("Use my current location", foreground only) | No |
| `POST_NOTIFICATIONS` | app.json | Yes: order updates (Android 13+ runtime prompt) | No |
| `VIBRATE` | app.json | Notification vibration | Keep |
| `ACCESS_NETWORK_STATE` | expo-image / connectivity checks | Yes (offline banner) | No |
| `WAKE_LOCK` | FCM / expo-notifications | Yes | No |
| `com.google.android.c2dm.permission.RECEIVE` | Firebase Messaging | Yes (push) | No |
| `lk.blynk.customer.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX (own-package signature permission) | Automatic | No |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | Google Play services | Harmless | Leave |
| `RECEIVE_BOOT_COMPLETED` | expo-notifications | **No.** It re-schedules *local* scheduled notifications after a reboot; Blynk only receives server push (no `scheduleNotificationAsync` in `src/`). | **Yes** |
| 20 launcher-badge permissions: `com.android.launcher.permission.READ_SETTINGS`, `.WRITE_SETTINGS`, `.INSTALL_SHORTCUT`, `.UNINSTALL_SHORTCUT`; `com.sec.android.provider.badge.permission.READ`, `.WRITE`; `com.htc.launcher.permission.READ_SETTINGS`, `.UPDATE_SHORTCUT`; `com.sonyericsson.home.permission.BROADCAST_BADGE`; `com.sonymobile.home.permission.PROVIDER_INSERT_BADGE`; `com.anddoes.launcher.permission.UPDATE_COUNT`; `com.majeur.launcher.permission.UPDATE_BADGE`; `com.huawei.android.launcher.permission.CHANGE_BADGE`, `.READ_SETTINGS`, `.WRITE_SETTINGS`; `android.permission.READ_APP_BADGE`; `com.oppo.launcher.permission.READ_SETTINGS`, `.WRITE_SETTINGS`; `me.everything.badger.permission.BADGE_COUNT_READ`, `.BADGE_COUNT_WRITE` | expo-notifications (app-icon badge counts on old launchers) | **No.** No `setBadgeCount` anywhere in `src/`. Normal-level permissions, so Play does not list or flag them; removing them is tidiness only. | **Yes** (optional) |

Already blocked in `app.json` and correctly gone from the manifest: `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`. Not present (good): `AD_ID`, `FOREGROUND_SERVICE*`, `ACCESS_BACKGROUND_LOCATION`, camera, microphone, contacts, storage, SMS, phone state.

**Foreground-only location justification** (for the store listing / any Play question, and the in-app prompt already says it): "Blynk uses your location only while the app is open, when you tap 'Use my current location', to place the delivery pin at your door. It never tracks you in the background and the pin can be set by hand." `app.json` has `locationWhenInUsePermission: "Blynk uses your location to place the delivery pin on your door."`. That text is English only; the app's own pre-prompt wording should stay in en/si/ta (not touched here).

### 3.2 Other manifest facts

- `usesCleartextTraffic="false"`; `allowBackup="true"` (to fix, 4.2); `supportsRtl="true"`; `enableOnBackInvokedCallback="false"`; `MainActivity` portrait, `singleTask`, `windowSoftInputMode="adjustResize"`; deep links `blynk://` and `https://blynk.lk/app*`, `https://blynk.lk/p/*` with `autoVerify`.
- Firebase: `google-services.json` for project `blynk-15cd4`, FCM channel `orders`, notification icon/colour meta-data set.
- `queries` for `https` VIEW intents (opening policy pages in the browser).
- Re-check the final AAB for 16 KB: unzip it and run the ELF check on the `arm64-v8a` libs, or install `bundletool` and run `bundletool dump config --bundle=app-release.aab | grep -i alignment` (must say `PAGE_ALIGNMENT_16K`), then the APK check `zipalign -c -P 16 -v 4 app.apk` ("Verification successful"). Cheapest real proof: upload to Internal testing; Play Console shows a 16 KB warning on the bundle if any 64-bit lib fails.

## 4. Release hardening: exact proposals for the lead

I did not touch `app.json`, `package.json` or `android/`. `app.json` is also being edited by another builder right now, so merge by hand.

### 4.1 R8 minify and resource shrinking (recommended; needed for the Feb 2027 DEX rule)

Today `android/app/build.gradle` reads `android.enableMinifyInReleaseBuilds` (default `false`) and `android.enableShrinkResourcesInReleaseBuilds` (default `false`), so the release build is unminified (47 MB DEX). `expo-build-properties` writes both properties.

Is it safe with this module set? I read each library's consumer ProGuard rules in `node_modules`:

| Library | Keep rules it ships |
|---|---|
| react-native 0.86 | `DoNotStrip` annotations, `NativeModule`/`JavaScriptModule` implementers, JNI `native` methods, bridge and TurboModule packages |
| react-native-reanimated 4.5 and react-native-worklets 0.10 | `com.swmansion.reanimated.**` / `com.swmansion.worklets.**`, turbomodule and fabric packages (the app's own `proguard-rules.pro` also keeps reanimated) |
| expo-modules-core, expo-sqlite | Expo modules/records/shared objects; expo-sqlite's JNI class is `@DoNotStrip` |
| expo-notifications | `expo.modules.notifications.**` |
| expo-location | `expo.modules.location.taskConsumers.**` |
| expo-image | Glide module rules |
| react-native-webview | none of its own; `@JavascriptInterface` methods are kept by AGP's default `proguard-android.txt` (checked in the generated `default_proguard_files`) |

So **no extra keep rules are needed** as far as static reading can tell. Hermes JS is not touched by R8. Risk: reflection-heavy paths (Firebase component discovery, Glide) are covered by their consumer rules, but only a minified build run on a phone proves it. `shrinkResources` can strip resources looked up by name at runtime: the notification icon and colour are referenced from the manifest (kept), the splash uses a layer drawable (kept); if anything looks wrong turn only `enableShrinkResourcesInReleaseBuilds` off.

Test before uploading (LEAD): build a minified release **APK** the same way as the AAB, then on a phone: intro, login with an SMS code, cold-start push tap, "Use my current location", address map and tracking map, PayHere page, a `https://blynk.lk/p/...` link, and check `adb logcat -d | grep -E "ClassNotFound|NoSuchMethod|NoSuchField|NoClassDef"` is empty. Play receives the R8 mapping file inside the AAB automatically, so Play Console deobfuscates Java crashes.

### 4.2 `allowBackup=false` (recommended)

The session token lives in SQLite inside the app's data directory (expo-sqlite key-value store). With `allowBackup="true"` Android copies that database to the customer's Google Drive and restores it on a new phone, so a restored app could be signed in as someone else's session or with a stale token. `android.allowBackup: false` in `app.json` sets `android:allowBackup="false"`: no cloud backup and no device-transfer copy (nothing needs restoring: the account is on the server and the cart rebuilds). No `dataExtractionRules` file is needed when backup is off.

### 4.3 Network security

`usesCleartextTraffic=false` is already in the manifest (from `expo-build-properties`). Apps targeting 24+ do not trust user-installed CAs by default, and the WebViews only allow `https://blynk.lk`, `https://tiles.openfreemap.org` and `https://unpkg.com` (`src/blynk/map/webviewProps.ts`, with a test). A custom `network_security_config.xml` adds nothing today; skip it. Set `networkInspector: false` so `EX_DEV_CLIENT_NETWORK_INSPECTOR=true` is not written into `gradle.properties` for a store build (it is a development-client tool).

### 4.4 ABIs

The AAB should carry **`arm64-v8a` and `armeabi-v7a`** only (what the 2026-11-02 build does through `ARCHS`): phones only, 32-bit-only budget phones stay supported, `x86`/`x86_64` are emulators/Chromebooks (the release is phones-only). `gradle.properties` currently lists all four ABIs and relies on the `ARCHS` override, which is easy to forget: set `buildArchs` so the default is right (emulator test builds keep overriding with `-PreactNativeArchitectures=arm64-v8a,x86_64`). The armeabi-v7a build still needs the short-path copy (`C:\bca`) because of Windows MAX_PATH.

### 4.5 New plugin `plugins/withBlynkPlayHardening.js` (written, tested)

Created (not yet referenced from `app.json`, LEAD adds it):
- removes expo-location's `LocationTaskService` from the merged manifest with `tools:node="remove"` (a foreground service of type `location` that only background location updates use; Blynk is foreground-only);
- adds `ndk { debugSymbolLevel 'SYMBOL_TABLE' }` to the release build type so the AAB carries native symbol tables (Play shows readable native stacks and stops warning about missing debug symbols). I ran the gradle edit against the real generated `android/app/build.gradle` (it lands inside `buildTypes.release`, after the signing edit of `withBlynkRelease`).
- Test: `src/blynk/lib/withBlynkPlayHardening.test.ts` (10 tests; it is under `src/blynk` because `vitest.config.ts` only collects tests there).
- After the next `expo prebuild`, check `grep LocationTaskService android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml` prints nothing. If the manifest merger does not match the relative name used by the library (`.services.LocationTaskService`), remove the plugin from `app.json`; nothing else depends on it.

### 4.6 The JSON to paste into `app.json`

Inside `expo.android` (keep everything already there; this adds `allowBackup` and extends `blockedPermissions`):

```json
"allowBackup": false,
"blockedPermissions": [
  "RECORD_AUDIO",
  "SYSTEM_ALERT_WINDOW",
  "READ_EXTERNAL_STORAGE",
  "WRITE_EXTERNAL_STORAGE",
  "RECEIVE_BOOT_COMPLETED",
  "READ_APP_BADGE",
  "com.android.launcher.permission.READ_SETTINGS",
  "com.android.launcher.permission.WRITE_SETTINGS",
  "com.android.launcher.permission.INSTALL_SHORTCUT",
  "com.android.launcher.permission.UNINSTALL_SHORTCUT",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE"
]
```

The `expo-build-properties` entry in `plugins` becomes:

```json
[
  "expo-build-properties",
  {
    "android": {
      "usesCleartextTraffic": false,
      "enableMinifyInReleaseBuilds": true,
      "enableShrinkResourcesInReleaseBuilds": true,
      "buildArchs": ["arm64-v8a", "armeabi-v7a"],
      "networkInspector": false
    }
  }
]
```

and the plugin list gets one new line next to `"./plugins/withBlynkRelease"`:

```json
"./plugins/withBlynkPlayHardening",
```

Reduced version if the lead wants the smallest change: only `"allowBackup": false` and the two `enable...` flags. The badge-permission block is optional tidiness; `RECEIVE_BOOT_COMPLETED` is the one worth blocking. Nothing needs `extraProguardRules`.

### 4.7 The other items you asked about

| Item | Finding | Action |
|---|---|---|
| `android:supportsRtl` | `true`. The app ships en/si/ta (none right-to-left). Android only mirrors the layout on an RTL device language (Arabic, Urdu) and that case was never tested. | Left. Low risk. |
| Portrait lock | `orientation: portrait` becomes `screenOrientation="portrait"`. On Android 16 with target 36 it is **ignored on screens of 600 dp or wider** (tablets, foldable inner screen). | Restrict the release to phones in Play Console (device catalog / form factors). If foldables must work, the temporary `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` application `<property>` keeps the old letterboxed behaviour; Google says it will not apply when targeting API 37. Not added. |
| Predictive back | `predictiveBackGestureEnabled: false` writes `enableOnBackInvokedCallback="false"`. Android 16 docs still honour that opt-out. The app's back handling (expo-router, modal/sheet close first) relies on the legacy back path. | **Right for now.** Revisit before targeting API 37. |
| Deep links and assetlinks | Intent filters present with `autoVerify`. `assetlinks.json` lists `lk.blynk.customer` with a debug key (`8F:A2:...:7A`) and the upload key (`B8:F1:...:1C`). Play re-signs with its own key, so links will **not** verify for Play installs until the **Play app signing SHA-256** is added as a third entry (listing doc section 4, keep the list on one line, redeploy the site). `pathPrefix /app` also matches paths such as `/appointments`: harmless today. | OWNER copies the fingerprint (section 6, step 9), LEAD edits the file. Remove the old debug fingerprint after launch. |
| Notification channel and icon | Manifest default channel `orders`; the channel "Orders and offers" is created in code before the permission prompt; icon `assets/notification-icon.png`, colour `#1A1D2E`. | Check on a real phone that the small icon is a white shape, not a white square (not verifiable here). |
| Sideloaded copies | Test APKs 1.0.0 to 1.0.3 were signed with the upload key; Play delivers copies signed with Google's key. | Testers must uninstall the APK before installing from Play (signature conflict). |

## 5. Data safety answers (native app, ready to paste)

The old table in `play-store-listing.md` section 8.6 was written for the web shop (Google Tag Manager, GA4, Google Ads, Meta). **The native app has none of that**: `src/blynk/analytics/track.ts` pushes to `window.dataLayer` on the web only, and there is no analytics or crash SDK in `package.json`. Use the table below for the Play app. If a crash reporter is added later (section 11), add the two rows marked *crash reporter*.

### 5.1 First page

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **Yes** |
| Is all user data encrypted in transit? | **Yes** (HTTPS only to the API; the WebViews only allow HTTPS origins) |
| Account creation methods | **Username and other authentication** (mobile number + SMS code) |
| Delete account URL | `https://blynk.lk/delete-account` |
| Can users ask for some data to be deleted without deleting the account? | **Yes** (email `help@blynk.lk`, privacy policy) |
| Independent security review | No |
| Follows Play Families policy | No (the app is not for children) |
| Advertising ID | **No** (no `AD_ID` permission in the manifest) |

### 5.2 Data types

Collected = sent off the phone to Blynk's API. Riders, SMS, hosting, Firebase push and PayHere work on Blynk's behalf (service providers, not "sharing").

| Play data type | Collected | Shared | Required / optional | Purposes | Notes |
|---|---|---|---|---|---|
| Personal info > Name | Yes | No | Required | App functionality, Account management | Account name, receiver name |
| Personal info > Email address | Yes | No | Optional | Account management | Optional profile field |
| Personal info > Phone number | Yes | No | Required | App functionality, Account management, Fraud prevention and security | Sign-in number; optional second number |
| Personal info > Address | Yes | No | Required (to order) | App functionality | Delivery address, landmarks, notes |
| Personal info > Other info | Yes | No | Optional | App functionality, Personalization | Birthday (day and month) and family birthdays if entered |
| Financial info > Purchase history | Yes | No | Required | App functionality | Orders, items, amounts |
| Financial info > Other financial info | Yes | No | Required | App functionality | Blynk Points and Wallet balance, payment method, transaction reference |
| Location > Precise location | Yes | No | Optional | App functionality | Delivery pin; one GPS fix when the customer taps "Use my current location"; foreground only |
| Health and fitness > Health info | Yes | No | Optional | App functionality | Doctor appointment notes and patient details (only when the doctors section is on; it can be switched on from Admin without an app update, so declare it) |
| App activity > Other user-generated content | Yes | No | Optional | App functionality | Order notes, ratings and comments, feedback, "Ask us" product requests |
| Device or other IDs | Yes | No | Required | App functionality | Firebase (FCM) push token, deleted on sign-out |
| *crash reporter, only if added:* App info and performance > Crash logs | Yes | No | Required | Analytics | Sentry (section 11) |
| *crash reporter, only if added:* App info and performance > Diagnostics | Yes | No | Required | Analytics | Sentry |
| App activity > App interactions / In-app search | **No** | | | | Smart search runs on the phone over the loaded catalogue; no analytics SDK |
| Messages, Photos, Files, Contacts, Calendar, Web browsing, Audio | No | | | | |

**Two judgment calls for the owner and lead:**

1. **Card details and PayHere.** The checkout opens PayHere's hosted page inside an app WebView (`PayHereBrowser.native.tsx`). Card numbers are typed on PayHere's page and never reach Blynk's API or code. Recommendation: do **not** tick "Credit or debit card number" or "User payment info" (the app does not collect them; PayHere's page does), and keep "Other financial info" as above. Play defines collection to include data from a WebView the app controls, so a strict reviewer could ask for "User payment info: collected, not shared (payment processor)". If Play asks, add it; it changes nothing in the app.
2. **Map provider.** The map WebView loads the MapLibre script from `unpkg.com` and tiles from `tiles.openfreemap.org`. Those hosts see the phone's IP address and which map tiles are requested (the area the customer is looking at; zoomed in on a street it is close to the delivery pin). Conservative answer (recommended unless tiles are self-hosted): add **Location > Approximate location: Collected, Shared (map tile provider), Optional, App functionality**. The self-hosting alternative (`docs/06-deployment/map-tile-hosting-setup.md`, PMTiles served by the API) removes the question and the runtime dependency on a free third-party CDN. Also add the map provider to the privacy policy (below).

### 5.3 Privacy policy gaps to fix before submitting (LEAD edits `apps/customer-site/legal/privacy.md`, then runs `node apps/customer-site/scripts/build-legal-pages.mjs`)

- The policy URL for Play is `https://blynk.lk/privacy` (the app opens the same page). The appointments data **is** now covered (section 1 and 4): the old gap in `play-store-listing.md` 8.1 is fixed.
- Add the map provider line: "Map tiles and the map script are loaded from OpenFreeMap and unpkg, which see your IP address and the map area you view." (drop it if tiles are self-hosted).
- Add the crash-reporter line when one is installed (section 11).
- `legal-config.json` still has an empty `registeredAddress` and `businessRegistrationNo` (OWNER fills them in). The Play developer name, the privacy policy business name ("Blynk Quick Commerce") and the upload certificate (`O=Valgrow Labs`) should agree.

## 6. Play Console steps for the owner, in order

Menu names move around; the Dashboard "Set up your app" checklist lists what is missing.

1. **Developer account** (`https://play.google.com/console/signup`): organisation (needs D-U-N-S; skips the closed test) or personal (faster; 12-tester / 14-day closed test, step 14). Pay the USD 25 fee and finish **identity verification** (ID, contact email and phone). Use a business Google account, not a staff member's personal one.
2. **Create app**: name `Blynk` (or `Blynk: Grocery Delivery`), default language English (United Kingdom), **App**, **Free**, accept the declarations. The package name `lk.blynk.customer` is fixed by the first upload.
3. **App access** (Policy and programs > App content): "All or some functionality is restricted". Paste the instructions from section 7.
4. **Ads**: **No**.
5. **Content rating**: questionnaire with the answers in section 9. Category "All other app types". Expected: rated for all ages.
6. **Target audience and content**: **18 and over only**; not appealing to children; not a Families app.
7. **Data safety**: section 5 (answers, delete-account URL `https://blynk.lk/delete-account`).
8. **Other declarations**: Government app **No**; **News app: No**; COVID-19 contact tracing/status **No**; Financial features **none**; **Health apps**: declare appointment booking (listing doc 8.7); Advertising ID **No**; Privacy policy `https://blynk.lk/privacy`.
9. **App signing**: keep **Google-generated key** (Play App Signing) when the first AAB is uploaded. Afterwards: **Test and release > Setup > App signing**, copy the **SHA-256 certificate fingerprint** and **send it to the lead** (the lead adds it to `apps/customer-site/.well-known/assetlinks.json` and redeploys the site; without it web links open the browser instead of the app).
10. **Store settings**: category **Shopping**, tags, contact email `help@blynk.lk`, website `https://blynk.lk`.
11. **Reach and devices / device catalog**: phones only (exclude tablets, Chromebooks, TV, cars, Wear). The portrait lock is not honoured on 600 dp+ screens at API 36.
12. **Main store listing**: name, short and full description, icon 512, feature graphic 1024x500, **phone screenshots** (the native ones, section 8), Sinhala and Tamil translations ([`play-store-listing.md`](play-store-listing.md) section 5; native-speaker check pending).
13. **Countries**: **Sri Lanka only**.
14. **Closed testing** (personal accounts: mandatory; organisation accounts: recommended anyway): **Test and release > Testing > Closed testing**, create a track, upload the AAB, add **12+ testers** (a Google Group is easiest), send the opt-in link, keep them opted in for **14 consecutive days** (add spares), then **Dashboard > Apply for production**. Before that, Internal testing (up to 100 testers) is instant and good for the first smoke test.
15. **Upload the AAB** (`bundleRelease`, release key, `BLYNK_VERSION_CODE` higher than any earlier upload, `EXPO_PUBLIC_DEMO=0`, `EXPO_PUBLIC_API_BASE_URL=https://blynk-api.valgrowlabs.com/api/v1`). **Release notes** (paste each in its language tag; Sinhala and Tamil need a native-speaker check):

   ```
   <en-GB>
   First release of Blynk on Google Play: groceries delivered in Dharga Town, Aluthgama, Bentota and Beruwala. Sign in with your mobile number, set your delivery pin, order and track your delivery.
   </en-GB>
   <si-LK>
   Blynk පළමු නිකුතුව: දර්ගා නගරය, අළුත්ගම, බෙන්තොට සහ බේරුවල ප්‍රදේශවලට සිල්ලර බඩු ගෙදරටම. ඔබේ ජංගම අංකයෙන් පිවිසෙන්න, බෙදාහැරීමේ ස්ථානය සලකුණු කර ඇණවුම් කර ලුහුබඳින්න.
   </si-LK>
   <ta-IN>
   Blynk முதல் வெளியீடு: தர்கா நகர், அளுத்கம, பெந்தோட்டை, பேருவளை பகுதிகளுக்கு மளிகை டெலிவரி. மொபைல் எண்ணுடன் உள்நுழைந்து, டெலிவரி இடத்தைக் குறிக்கவும், ஆர்டர் செய்து கண்காணிக்கவும்.
   </ta-IN>
   ```
16. **Pre-launch report** (appears automatically a few hours after an upload to Internal/Closed testing): open **Testing > Pre-launch report**. First let the robot sign in: in the Pre-launch report **Settings** add login credentials (the menu wording changes), enter the review phone and fixed code from section 7 (the fixed code works for the robot because no SMS is needed). Read: crashes, ANRs, **security** findings, accessibility, and the screenshots per device. Fix anything marked critical before production.
17. **Production, staged rollout**: **Production > Create new release**, add the AAB from the library, release notes, **Review release**, choose a **staged rollout of 10%** and start. Then 50%, then 100% (section 10 for when). Google's first review takes from hours to about 7 days.
18. **Android vitals** (Quality > Android vitals): watch crash rate and ANR rate daily during the rollout (thresholds in section 10). **Halt the rollout** from the release page if either approaches the thresholds.
19. After launch: add the "Get it on Google Play" link on blynk.lk, remove the old debug fingerprint from `assetlinks.json`, and re-read this file every quarter.

## 7. App access: the review sign-in

How it works: the API (`backend/api/src/config/env.ts`, `modules/auth/auth.service.ts` `reviewLoginCode`) accepts **one** configured phone number with a **fixed 6-digit code** and sends no SMS for it. Off when both variables are empty.

- OWNER: in Coolify, on the API service set `REVIEW_LOGIN_PHONE` (format `+94700000001`; a number nobody owns) and `REVIEW_LOGIN_OTP` (6 digits, not guessable), redeploy the API. Then sign in once in the native app with it, add a name and a delivery address inside the delivery area.
- Paste into Play Console > App access > Add instructions (name "Blynk review account"):

  > Blynk signs in with a mobile number and a 6-digit SMS code. For review, use the number and fixed code below: no SMS is sent to this number.
  > Number: <REVIEW_PHONE without +94>   Code: <REVIEW_CODE>
  > 1. Open the app and tap the mobile number field on the Login screen (the +94 prefix is already shown). 2. Enter the number, tap Continue. 3. Enter the code. 4. You are signed in with a saved delivery address, so you can browse, add items to the cart and open checkout.
  > You can also browse without signing in ("Skip for now"). Delivery is only in Dharga Town, Aluthgama, Bentota and Beruwala, Sri Lanka, paid on delivery or by card through PayHere. Outside the shop's opening hours the app shows the shop as closed and orders are not accepted; that is expected. Please do not complete a real order, or cancel it from Orders at once.
- Keep the number and code working for as long as the app is on Play, and keep the same values in the Pre-launch report sign-in settings. If a reviewer deletes the account through "Delete account" the profile and address are gone: sign in again, finish the register screen and re-add the address (check the day before submitting).

## 8. Store listing assets and the build

| Asset | Required by Play | In the repo | Status |
|---|---|---|---|
| App icon 512 x 512, 32-bit PNG | Yes | `docs/06-deployment/play-store-assets/icon-512.png` (512x512 RGBA) | DONE |
| Feature graphic 1024 x 500 | Yes | `.../feature-graphic-1024x500.png` | DONE |
| Phone screenshots (2 to 8, 9:16 or 16:9, 320 to 3840 px per side) | Yes | `.../screenshots/01-home.png` to `08-cart.png` (1080x1920) **but they are screenshots of the web PWA taken with Playwright, not the native app** | **LEAD/OWNER: retake from the native build** (emulator with `-gpu host` so the map draws, or a real phone), signed out or with the review account, same order as the listing |
| Tablet screenshots | Optional | none | Not needed for a phones-only release |
| Short description (80) and full description (4000), English | Yes | `play-store-listing.md` section 5 | DONE (check lines against the live shop on the day) |
| Sinhala and Tamil short descriptions | Optional | section 5 | Written, **OWNER: native-speaker check** |
| Sinhala and Tamil full descriptions | Optional | none | Optional; Play shows English meanwhile |
| Privacy policy URL, delete-account URL | Yes | `https://blynk.lk/privacy`, `https://blynk.lk/delete-account` | DONE (section 5.3 fixes pending) |

**Building the AAB (LEAD):** the 2026-11-02 recipe (`expo prebuild --platform android --no-install` from the short-path copy `C:\bca`, then `bundleRelease` with `ARCHS=arm64-v8a,armeabi-v7a`, release key from `~/.blynk-release/keystore.properties`, never with the emulator up). `BLYNK_VERSION_CODE` must be higher than every earlier **upload**: nothing has been uploaded to Play yet, so 5 (the current `versionCode`) works, but the sideloaded APKs 1.0.0 to 1.0.3 used 1 to 4. Check the result: `keytool -printcert -jarfile app-release.aab` shows the upload key SHA-256 `B8:F1:06:4C:...:1B:AD:1C`; no `LocationTaskService` in the merged manifest; the 16 KB checks in 3.2.

Stale files: `apps/customer-twa/` (the TWA project) is no longer used and shares the package name; delete it or mark it archived so nobody uploads it by mistake. Only one app can have the package `lk.blynk.customer` on Play.

## 9. Content rating answers (IARC questionnaire)

Category **All other app types** (not a game). Email: the contact email.

| Question | Answer |
|---|---|
| Violence, blood, fear, sexual content, profanity, gambling, drugs/alcohol/tobacco depiction | **No** to all (everyday groceries; if the catalogue ever lists alcohol or tobacco, answer the controlled-substances question **Yes**) |
| Users can interact or exchange content | Ratings and comments on orders, feedback and product requests are sent to Blynk staff; they are not chat between users. If the form insists on a user-generated-content answer, answer **Yes** and say staff moderate it. Order notes are seen by the shop and rider only. |
| Shares the user's location with other users | **No.** The customer's address and pin go to the shop and the assigned rider (Blynk staff) for that order; the customer sees the rider's position while the order is out for delivery. No customer-to-customer location sharing. |
| Digital purchases | **No** (physical goods only, paid on delivery or by PayHere card, which Play allows for physical goods) |
| Unrestricted web access | **No** (WebViews only open the map and PayHere; policy pages open in the browser) |
| Expected rating | Everyone / PEGI 3 / possibly a "users interact" note |

## 10. Rollout and what to watch

- **Staged rollout:** 10% for about 2 days with a daily look at Android vitals and the reviews, then 50% for 2 to 3 days, then 100%. Halt if a crash cluster appears.
- **Bad-behaviour thresholds (Android vitals, 28-day average, Play lowers visibility above them):** user-perceived **crash rate 1.09%** overall and **8% per phone model**; user-perceived **ANR rate 0.47%** overall and **8% per phone model**; excessive partial wake locks 5%. Play flags "emerging issues" when a crash or ANR affects devices for more than 7 days. Vitals only show once enough opted-in users exist, so a small first week can look empty: use the crash reporter (section 11) for the first days.
- **Known ANR risk to watch:** the Reanimated update storm fixed in 1.0.3 (see the quality-pass plan). If the ANR rate climbs, check `adb logcat -s Reanimated` on a low-end phone first.
- **Feb 2027 additions:** memory usage, bitmap memory and DEX-optimisation thresholds start affecting visibility (4.1 fixes the DEX one).

## 11. Crash visibility after launch

**Free in Play Console (no code):** Android vitals shows crash and ANR clusters with stack traces and device models for installs from Play whose users opted in to share data; the Pre-launch report runs the uploaded build on Google's test devices (crashes, ANRs, accessibility, security, performance, screenshots) before release; reviews and ratings. Limits: only Play installs and opted-in users, a delay of about a day, and a JavaScript error appears as a Java exception wrapping the Hermes bytecode stack, which is **unreadable without a source map**. Most of Blynk's code is JavaScript, so add a reporter.

**Recommended reporter: Sentry (`@sentry/react-native`)**, because it maps Hermes JS stacks back to source and has a first-class Expo plugin. Firebase Crashlytics also works (the Firebase project exists) but its React Native JS stack traces are weaker and it needs the Crashlytics Gradle plugin plus `@react-native-firebase/*`, so it is the second choice. Do **not** install anything until the owner agrees; steps (checked against Sentry's and Expo's docs on 2026-11-02; Sentry supports Expo SDK 50+; pick the version with `npx expo install`, which resolves the one compatible with SDK 57):

1. Owner creates a free Sentry account, an organisation and a **React Native project** (note the organisation slug, project slug and DSN), and an **organisation auth token** for source-map upload.
2. `npx expo install @sentry/react-native`
3. `app.json` plugins: `["@sentry/react-native/expo", { "url": "https://sentry.io/", "organization": "<org-slug>", "project": "<project-slug>" }]`
4. Create `metro.config.js` (there is none today): `const { getSentryExpoConfig } = require("@sentry/react-native/metro"); module.exports = getSentryExpoConfig(__dirname);`
5. In `src/app/_layout.tsx`, initialise Sentry with only errors on (no tracing, no replay, no PII) and wrap the root: `Sentry.init({ dsn, sendDefaultPii: false, tracesSampleRate: 0, enableLogs: false, beforeBreadcrumb })` and `export default Sentry.wrap(RootLayout)`. **Scrub query strings** in `beforeBreadcrumb` and `beforeSend` (the OTP screen carries `?phone=` in its route; `track.ts` already redacts this for analytics for the same reason). Never attach phone numbers, addresses or tokens. Keep the existing expo-router `ErrorBoundary` export (builder R) so the friendly screen still shows.
6. Build with `SENTRY_AUTH_TOKEN` set in the environment of the build shell (never committed; source maps upload during the release Gradle build). The `C:\bca` short-path build needs the same variable.
7. Verify with one release build: throw a test error from a hidden debug action once, see it in Sentry with a readable stack, then remove the action.
8. Update **Data safety** (two *crash reporter* rows in 5.2) and the **privacy policy**.

**Privacy-policy line to add** (section 1 table and section 4 list of `privacy.md`): "Crash and error reports: if the app crashes, we receive technical information (device model, Android version, app version, the error and what the app was doing) from our error-reporting provider Sentry. These reports do not include your name, phone number, address or order contents, and we use them only to find and fix faults."

## 12. Risks and open points

1. **Unminified release (47 MB DEX).** R8 must be enabled before Feb 2027 and should be before launch; it must be tested on a phone first (4.1). Until then Play may warn at upload.
2. **Account/timeline.** A personal account adds at least 14 days after 12 testers opt in. Decide the account type first.
3. **Judgment calls in Data safety** (map provider, PayHere page), section 5.2. A wrong answer can get an update rejected; the conservative answers cost nothing in the app.
4. **Native screenshots missing**; the PWA shots could be rejected as not showing the real app.
5. **Reviewer login depends on a production env change** and must keep working.
6. **App Links** do not verify for Play installs until the Play signing SHA-256 is in `assetlinks.json`.
7. **Android 16 large screens ignore the portrait lock**; limit to phones and test one foldable/tablet if possible.
8. **16 KB:** verified for the APK in this tree, not yet for the final AAB; Feb 2027 is the enforcement date, but Play already warns.
9. **Not verifiable here:** push on a real phone, App Links, the notification small icon, the location prompt text in si/ta, R8 behaviour, the web delete-account page after the next site deploy, Sinhala/Tamil store text.
10. **Staff APKs (Ops, Rider)** are installed outside Play; check Google's developer-verification page for apps distributed outside Play (not verified here).

## Sources (Google and others, read 2026-11-02)

- Target API level: https://support.google.com/googleplay/android-developer/answer/11926878
- 16 KB page size: https://developer.android.com/guide/practices/page-sizes
- Closed testing, personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- App access: https://support.google.com/googleplay/android-developer/answer/9859455
- Advertising ID: https://support.google.com/googleplay/android-developer/answer/6048248
- Location permissions: https://support.google.com/googleplay/android-developer/answer/9799150
- Policy deadlines and announcements: https://support.google.com/googleplay/android-developer/answer/12253906
- Android 16 behaviour changes: https://developer.android.com/about/versions/16/behavior-changes-16
- Android vitals thresholds: https://developer.android.com/topic/performance/vitals
- Sentry for Expo: https://docs.sentry.io/platforms/react-native/manual-setup/expo/ and https://docs.expo.dev/guides/using-sentry/
