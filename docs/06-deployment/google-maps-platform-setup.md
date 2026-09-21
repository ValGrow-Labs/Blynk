# Google Maps Platform setup (Customer app)

**STATUS: code structure done; Google Cloud project, keys and every device check are NOT done.** Google map rendering has never been verified: there is no device, no emulator and no real key. Nothing in this file is a claim that the map works on a phone.

Source of truth for the decisions: [`docs/superpowers/plans/2026-09-21-blynk-customer-premium-distribution.md`](../superpowers/plans/2026-09-21-blynk-customer-premium-distribution.md) section 11 and decisions D11, D12, D13. No key, project ID, billing account, package name or SHA-1 appears in this repository; the `<PLACEHOLDER>` cells below are for the owner to fill in outside git.

## 1. How the app gets the key

The Dart code reads no key. The Android Maps SDK reads it from the manifest:

```xml
<meta-data android:name="com.google.android.geo.API_KEY" android:value="${MAPS_API_KEY}" />
```

`android/app/build.gradle` resolves `MAPS_API_KEY` at build time, first hit wins:

1. environment variable `MAPS_API_KEY` (use this in CI, from the CI secret store);
2. `android/secrets.properties` (git-ignored; copy `android/secrets.properties.example`);
3. `android/local.properties` (git-ignored);
4. empty string.

An empty key does **not** fail the build. Gradle prints one warning, `MAPS_API_KEY is not set: Google Maps will show an unavailable/blank map`, and the built app contains an empty key, so the native map draws blank or shows Google's own error. The key value is never printed.

Web (Flutter web is a fallback only; the customer PWA is a separate React + Vite build, not started): the Google adapter shows "Map unavailable" on web today. When the PWA is built, the web key is supplied at deploy time (templated into `index.html`) or as a Vite environment variable at build time. It is public in page source by design, so protection is the referrer restriction, the API restriction, the quota cap and the budget alert.

`test/no_secrets_test.dart` fails the test run if a key-shaped string (`AIza...`) appears in `lib`, `test`, `android`, `web` or this folder, if `secrets.properties` stops being git-ignored, if the example file gains a value, or if the manifest holds a literal key.

## 2. Key inventory

Fill this in outside git (password manager or the company secret store). Never paste a key value here.

| Key | Used by | Application restriction | API restriction | Where the value lives | Status |
|---|---|---|---|---|---|
| Android key | Play release builds | Android apps: package name `<D2 not decided>` + **Play app-signing SHA-1** `<PLACEHOLDER>` + upload-key SHA-1 `<PLACEHOLDER>` | Maps SDK for Android only | CI secret `MAPS_API_KEY` | `<PLACEHOLDER>` not created |
| Android dev key | Local debug builds | Android apps: package name `<D2 not decided>` + debug certificate SHA-1 `<PLACEHOLDER>` | Maps SDK for Android only | `android/secrets.properties` on each developer machine | `<PLACEHOLDER>` not created |
| Web key | PWA production | Websites: origin-level referrers `<PLACEHOLDER>` | Maps JavaScript API only | deploy-time `index.html` template or Vite env | `<PLACEHOLDER>` not created |
| Web dev key | PWA local development | Websites: `http://localhost:*` | Maps JavaScript API only | local Vite env | `<PLACEHOLDER>` not created |

Restriction recipe (plan section 11.3):

- Use **two production keys, never one**: an application restriction binds a key to one platform kind.
- The Android application restriction is package name plus SHA-1. Register the **Play app-signing key** SHA-1 (Play Console, Protected with Play, Play app signing). Google re-signs the release, so registering only the upload key leaves the production map blank. Also register the **upload key** so sideloaded and closed-test APKs work. If Google's help page says hybrid (quantum-ready) signing applies to the app, register all three fingerprints it lists.
- The package name is **`<D2 not decided>`**. The app still ships with the template application ID; D2 is open and this task did not change it. The Android key cannot be restricted correctly until D2 is decided.
- Web referrers are origin-level (`https://app.example.com/*`, or a subdomain wildcard); path-level referrers are stripped by the browser referrer policy. Whether a Home-Screen (standalone) iPhone web app sends an authorised `Referer` is **NOT VERIFIED**.
- Production keys never sit on developer machines; developers use the dev keys.

## 3. APIs to enable, and not to enable

Enable **only**:

- Maps SDK for Android
- Maps JavaScript API (when the PWA map is built)

Do **not** enable Places (it also enables the JavaScript API), Directions or Routes, Distance Matrix, Geocoding, Static Maps or any Mobility product. The API restriction on each key blocks them. This is how the standing rule "no ETA, no routes, no navigation, no geocoding" is enforced technically as well as in code.

## 4. Ownership, billing and quotas

- **D11 (decided):** the Google Cloud organisation, project and billing account are **Blynk/company-controlled**, never a developer's personal project, with at least two business owners, and transferable. They must be business-owned before the Play launch. Organisation `<PLACEHOLDER>`, project ID `<PLACEHOLDER>`, billing account `<PLACEHOLDER>`: not created.
- **Web quota:** set the Maps JavaScript API cap to **1,000 map loads per day** initially. Tune after real traffic.
- **Billing alerts and a budget alert** must exist before launch. Budgets only alert; only quota caps stop usage.
- **D12 (decided): no Map ID.** Standard Google appearance, legacy `Marker` with generated bitmap icons, no Advanced Markers, no cloud styling. On Android this keeps the native map on the path that Google's price list of 2026-09-17 shows as unlimited free. That is a **current pricing finding to re-verify immediately before launch**, not a permanent guarantee. On Android, adding a Map ID (even a demo one) or cloud styling makes each load a billable Dynamic Maps load.
- **Web cost is an estimate**, not a bill: the JavaScript API bills as Dynamic Maps (10,000 free loads per month, then about $7 per 1,000 as listed on 2026-09-17). Plan section 11.4 has the worked estimate. Payment and tax handling for a Sri Lanka billing account is **NOT VERIFIED**.
- When a cap trips, the app shows its existing "Map unavailable" state and the text status; tracking stays useful without the map. Phones without Google Play services behave the same way.

## 5. Terms constraints that shape the code

- The Google logo and copyright stay visible and unobscured (the Android adapter keeps a small constant bottom padding and nothing is drawn over the map's bottom strip).
- No caching, pre-fetching or storing of Google map content: no offline map, no saved map bitmaps, and the future PWA service worker must not cache Google tiles or scripts.
- No non-Google basemap on or near a Google map: the MapLibre adapter is **never mounted** together with the Google adapter, and the OpenStreetMap credit is drawn only when MapLibre is the selected provider.
- Blynk's terms and privacy policy (D5) must carry the Google Maps End User Additional Terms and Google Privacy Policy statements with links.
- The Play Data safety form must declare what the Maps SDK collects (IP address, device metadata, crash data, a pseudonymous ID).

## 6. Choosing and rolling back the map provider

The provider is a compile-time define. Default is Google:

```
flutter run                                   # google (default)
flutter run --dart-define=MAP_PROVIDER=google
flutter run --dart-define=MAP_PROVIDER=maplibre   # rollback
```

An unknown value falls back to Google. Exactly one adapter is ever built. Rollback needs the MapLibre pieces, which are kept dormant on purpose (D13): `maplibre_map_view.dart`, `map_tile_config.dart`, the style asset, the `maplibre_gl` dependency, and the backend `/map-tiles` route and archive (with `MAP_TILES_URL` supplied). `flutter run -d windows` cannot show a Google map (the plugin has no desktop support) and shows "Map unavailable".

## 7. D13 runtime verification gate

Nothing MapLibre or PMTiles related may be deleted until all eight items pass and are recorded with evidence. **Every item is currently PENDING or BLOCKED.**

| # | Gate item | State |
|---|---|---|
| 1 | Google adapter implemented | Implemented and widget-tested against a fake platform; **rendering not verified** |
| 2 | Android build works (debug APK and release AAB, exit 0) | Debug APK builds (see [`customer-android-build-status.md`](customer-android-build-status.md)); release AAB **not built**; release signing unresolved |
| 3 | Map tested on a real Android device | **BLOCKED** (no device, no key) |
| 4 | Rider marker movement verified from the existing SSE location stream | **BLOCKED** (needs 3) |
| 5 | Customer address and location behaviour verified (picker centre pin, use my location, save) | **BLOCKED** (needs 3) |
| 6 | Google logo and required attribution visible and unobscured | **BLOCKED** (needs 3) |
| 7 | Production key restrictions verified (Play-signed build works, other builds rejected, unused APIs blocked) | **BLOCKED** (needs D2, keys, a Play-signed build) |
| 8 | Web/PWA map tested separately (real iPhone, Home-Screen mode) | **BLOCKED** (PWA not built) |

## 8. What is NOT done

- No Google Cloud project, billing account, budget, quota cap or API key exists.
- The application ID is the template value; D2 is undecided; release signing still uses the debug key and must not be published.
- Google map rendering, marker look, camera fit timing, gestures inside the order screen list and the behaviour with an invalid key or without Google Play services have not been seen on any device.
- No real key has ever been used in a build or a test.
- The web/PWA map does not exist; the Flutter Google adapter deliberately shows "Map unavailable" on web.
- The release AAB was not built with the Google Maps plugin in this task.
- The MapLibre and PMTiles pieces are not removed (D13).
