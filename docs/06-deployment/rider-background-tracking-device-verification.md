# Rider Background Tracking - Physical Device Verification Runbook

**STATUS: BLOCKED/PENDING - not yet executed on a physical Android device. No scenario in this document has been run.**

This is the executable checklist for Task RG (the background-tracking gate that blocks every Customer-app task). It exists because the automated suite (108 rider tests, backend tests) proves the *logic* against a fake plugin and a fake clock; it cannot prove that the real plugin survives a locked screen on a real Android build. An emulator does not exercise real Doze / OEM battery behaviour and is **not** an acceptable substitute. If any scenario in section 5 fails in a way that shows the plugin cannot track reliably in the background, stop, do not proceed to Task M0, and escalate (the documented fallback is a commercial plugin such as Transistorsoft; do not weaken this gate).

No box in this document is ticked. A tester fills in the `Observed / PASS|FAIL / date / tester` line for each scenario.

**Note (2026-09-20):** Tasks M0 to V1 (map tiles, Customer app, live pipeline test) were executed under the user's instruction to continue with automated tests while this gate is BLOCKED/PENDING. That does not satisfy the gate: nothing here has been run, and the feature is not production-ready until it is. The live pipeline test that was run (a real backend and database, a real customer `LocationProvider`, synthetic coordinates POSTed through the real rider API) proves API and stream behaviour only; it is not GPS or background-tracking verification. See `docs/05-implementation/blynk-live-location-tracking-report.md`.

---

## 0. Read this first: known risks from the desk research (2026-09-20)

Full sources are in `.superpowers/sdd/2026-09-19-blynk-live-location-tracking/task-RG-report.md`. Summary of what can invalidate a result:

| # | Risk | Why it matters here | What to do |
|---|------|---------------------|------------|
| R-A | **WebView HTTP throttling (HIGH) - mitigated in config, unverified on device.** The plugin README says: "after 5 minutes in the background Android will throttle HTTP requests initiated from the WebView. The solution is to use a native HTTP plugin such as CapacitorHttp" (plugin issue #14). `apps/rider/capacitor.config.ts` now sets `plugins: { CapacitorHttp: { enabled: true } }`, which patches global `fetch` to native HTTP on Android so `apps/rider/src/api/client.ts` is no longer subject to WebView throttling. | If updates still stall around minute 5, the patch is not active in the installed build or something else is throttling. | Confirm `apps/rider/android/app/src/main/assets/capacitor.config.json` contains `"CapacitorHttp": {"enabled": true}` after `npx cap sync android`, then run scenario S20. Known side effects: with native HTTP the WebView's CORS/mixed-content checks do not apply to API calls (see 1.4), and the patched `fetch` ignores `AbortSignal` so the client's 15 s request timeout does not fire on Android. |
| R-B | **`android.useLegacyBridge`** must be `true` (already set in `apps/rider/capacitor.config.ts`) or updates halt after ~5 min in the background (plugin issue #89, closed). | Confirm it made it into the installed build (section 1.3). | After `npx cap sync android`, confirm `apps/rider/android/app/src/main/assets/capacitor.config.json` contains `"useLegacyBridge": true` (the assets copy is what ships in the APK). |
| R-C | **Android 14+ foreground service.** A `location` FGS needs `FOREGROUND_SERVICE_LOCATION`, `foregroundServiceType="location"` and an already-granted location runtime permission, otherwise `SecurityException` on `startForeground()` (Android docs: fgs-types-required). Plugin issue #153 (open, Mar 2026) reports exactly this on Android 14-16 when the watcher starts during the first permission prompt. | The app awaits `requestPermission()` before `start()`, which should avoid it. Must be observed on the first ever launch of a fresh install, not just later runs. | Scenario 2 must be done on a fresh install (`adb uninstall lk.blynk.rider` first). Look for `Failed to foreground service` in logcat. |
| R-D | **POST_NOTIFICATIONS (Android 13+).** The plugin does not request it (issue #141) and the app does not either. Per Android docs the service still runs without it but the notification is not shown in the drawer (only in the Task Manager). | The "Sharing your location" notification may be invisible. Behavioural gap to report even if tracking works. | Record whether the notification is visible on a fresh install with no manual grant, then grant it in Settings and compare. Plugin README (Android section): on Android 13+ the app needs the `POST_NOTIFICATIONS` runtime permission to show the persistent notification, and the app "may need to request this permission" itself (e.g. via `@capacitor/local-notifications`). The rider app does not request it yet; do not treat a hidden notification as a plugin bug. |
| R-E | **OEM battery killers** (Huawei, Xiaomi, OnePlus, Samsung; dontkillmyapp.com). The plugin has no battery-optimization exemption prompt (issue #127). Issue #126 reports updates stopping after ~1 hour in background (open, unresolved). | Real-world Sri Lankan devices are frequently Xiaomi/Samsung/Huawei class. | Record make/model/Android version. Run the 5-minute gate on a stock/Pixel-like device AND on the OEM device the riders will actually use. Optionally repeat with the app set to "Unrestricted" battery. Extend one run to 60+ minutes. |
| R-F | **Notification icon** (issue #135, open). A non-transparent/incorrect icon makes the notification misbehave (dismissible, default text). The app uses the default `mipmap/ic_launcher`. | May cause the FGS notification to be dismissible or show default text. | Observe the notification in scenario 2; record title/text and whether it can be swiped away. |
| R-G | **Capacitor 8** is unsupported by the plugin (issue #156, open: crash when app goes to background). | The project is pinned to Capacitor 7.6.9. Do not upgrade. | Nothing to run; keep the pin. |
| R-H | **Undocumented bridge methods.** `checkPermissions()` / `requestPermissions()` are not in the plugin's `.d.ts`; `tracking-plugin.ts` relies on Capacitor's inherited base-class methods. Plugin issue #148 asks for an official API. | If they do not exist at runtime, `checkPermission`/`requestPermission` silently return `'unavailable'` (the code catches all errors). | Open item O-1 below. |

Plugin maintenance: last release 1.2.26 on 2025-08-28; the repo has had no push since. Treat as low-activity.

---

## 1. Prerequisites and setup

### 1.1 Equipment
- A **physical** Android phone (record make / model / Android version / patch level below), a USB cable, a laptop on the same Wi-Fi as (or tunnel to) the dev backend.
- Recommended: a second phone or laptop to run the customer SSE `curl`.

```
Device make/model: ______________  Android version/API: ______  Security patch: ______
Battery-optimization setting for the app (Optimized / Unrestricted): ______
Tester: ______________  Date: ______________
```

### 1.2 Environment variables used below (bash)
```bash
export SDK="/c/Users/pc/AppData/Local/Android/Sdk"          # adjust
export ADB="$SDK/platform-tools/adb.exe"
export API="https://<your-tunnel-host>/api/v1"               # see 1.4
export PKG=lk.blynk.rider
export DB="postgresql://postgres:postgres@localhost:5432/blynk_db"   # from backend/api/.env.example; use your real value
```

### 1.3 Build and install
```bash
cd apps/rider
VITE_API_BASE_URL="$API" npm run build        # the API URL is baked in at build time (src/api/client.ts)
npx cap sync android
cd android
export JAVA_HOME="C:\\Program Files\\Android\\Android Studio\\jbr"
export ANDROID_HOME="C:\\Users\\pc\\AppData\\Local\\Android\\Sdk"
./gradlew.bat assembleDebug
# APK (relative to apps/rider/android, where this shell now is): app/build/outputs/apk/debug/app-debug.apk
```
Enable Developer options + USB debugging on the phone, then:
```bash
"$ADB" devices -l                 # MUST list the phone as "device" (not "unauthorized")
"$ADB" uninstall $PKG || true     # fresh install so first-permission behaviour is exercised (risk R-C)
# Run from apps/rider/android, the directory the build step above left the shell in:
"$ADB" install -r app/build/outputs/apk/debug/app-debug.apk
# (from the repository root the same file is apps/rider/android/app/build/outputs/apk/debug/app-debug.apk)
```
Expected: `Success`. If `adb devices -l` is empty the whole runbook stays BLOCKED.

Verify the installed manifest (risk R-B/R-C/R-D):
```bash
"$ADB" shell dumpsys package $PKG | grep -E "permission|foregroundServiceType|BackgroundGeolocationService"
```
Expected: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, and the `BackgroundGeolocationService` service listed.

**Battery testing note.** Doze and most OEM killers do not engage while the phone is charging / on USB. For scenarios 3-5, 8, 12: after install, **unplug USB** (use wireless debugging, `adb pair` / `adb connect <ip>:<port>`, or simply do not use adb during the walk and rely on DB/SSE observation from the laptop).

### 1.4 Pointing the phone at the dev backend (not `localhost`)
The Capacitor Android WebView serves the app from origin `https://localhost` (Capacitor 7 default `androidScheme: https`). The committed `capacitor.config.ts` enables `CapacitorHttp`, which patches global `fetch` so API calls use native Android HTTP instead of the WebView (see risk R-A and scenario S20). That decides which network rules apply, so read this section with `CapacitorHttp` in mind:

- **With `CapacitorHttp` active (the committed config, and what S20 tests):** API calls do not go through the WebView, so the WebView's **mixed-content and CORS checks do not apply to them**, and the backend's `CORS_ORIGINS` list does not matter for API calls. What applies instead is Android's **native cleartext policy**: plain `http://` (for example `http://<LAN-IP>:3000`) is blocked on Android 9+ unless cleartext is explicitly allowed. So an `https` endpoint is still required for a normal run, for a different reason than mixed content.
- **Only if `CapacitorHttp` is not active** (an older build, or the setting was removed while debugging): API calls go through WebView `fetch()`, an `http://` API is blocked as mixed content from the `https://localhost` origin, and `CORS_ORIGINS` must include the WebView origin.

Preferred setup for the device test, in either case, is an HTTPS tunnel:
```bash
cloudflared tunnel --url http://localhost:3000        # or: ngrok http 3000
export API="https://<printed-host>/api/v1"
```
If the WebView `fetch()` path is in play (see above), add the WebView origin to `CORS_ORIGINS` and restart the API (harmless to add regardless):
```
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://localhost,capacitor://localhost
```
Check with: `curl -i -X OPTIONS "$API/auth/status" -H "Origin: https://localhost" -H "Access-Control-Request-Method: GET"` -> `Access-Control-Allow-Origin: https://localhost`.

LAN alternative (only if no tunnel; not recommended): build with `VITE_API_BASE_URL=http://<LAN-IP>:3000/api/v1`, open the API port in the Windows firewall, and allow cleartext only in an **uncommitted, debug-only** override (for example `server: { androidScheme: 'http', cleartext: true }` in `capacitor.config.ts` and, because native HTTP follows Android's own cleartext rules, a debug-only network security config). If you turn `CapacitorHttp` off for such a run, also allow `http://localhost` in `CORS_ORIGINS`. Note the API listens on `PORT` (default 3000), whereas the rider client's fallback default is `:4000`; always set `VITE_API_BASE_URL` explicitly.

**Android cleartext / base URL notes (2026-09-20).**
- `apps/rider/.env.example` sets `VITE_API_BASE_URL=http://localhost:4000/api/v1`, which is also the client's built-in fallback. On a physical phone `localhost` is the phone itself, so the build MUST bake in a reachable absolute `VITE_API_BASE_URL` at build time (see 1.3).
- With `CapacitorHttp` enabled, API calls go through native `HttpURLConnection`. Plain `http://` to a LAN IP is then blocked by Android 9+ (targetSdk 28+) unless cleartext is explicitly allowed, and the WebView-only workaround of `server.cleartext` may not be the only gate. Use an `https` tunnel (above) for the device test. Do NOT enable cleartext traffic (`usesCleartextTraffic`, a network security config, or `server.cleartext`) in the committed production config.
- Because the native path bypasses the WebView origin, the `CORS_ORIGINS` step is not needed for API calls once `CapacitorHttp` is active (harmless to keep). The patched `fetch` also ignores `AbortSignal`, so the client's 15 s request timeout does not fire on Android (risk R-A, scenario S21).

Sanity check from the phone's browser: `https://<tunnel-host>/api/v1/auth/status` returns JSON.

### 1.5 Tokens and IDs
Get bearer tokens via OTP (`POST $API/auth/otp/request {"phone":"..."}`, then `POST $API/auth/otp/verify {"phone":"...","otp":"123456"}`; outside production the request response returns the dev code). Seed users (from the backend tests): rider `+94779876543`, customer `+94771234567`, staff `+94774443322`, admin `+94775551122`.
```bash
export CUSTOMER_TOKEN=...   ADMIN_TOKEN=...   STAFF_TOKEN=...   RIDER_TOKEN=...
export ORDER_ID=...   DELIVERY_ID=...   # filled in during scenario 1
```
Backend must be running and migrated through `006_rider_location_tracking.sql`.

### 1.6 Reusable observation commands
**DB row (the truth source; no history table exists, so poll it):**
```bash
psql "$DB" -c "SELECT id, assignment_status, current_latitude, current_longitude, location_accuracy_m, location_captured_at, location_received_at, now() - location_received_at AS age FROM deliveries WHERE id = '$DELIVERY_ID';"
```
Continuous gap logger (leave running on the laptop during the walk, then find the largest gap):
```bash
while true; do psql "$DB" -At -F ' | ' -c "SELECT now(), location_received_at, current_latitude, current_longitude FROM deliveries WHERE id='$DELIVERY_ID';" >> /tmp/rg-poll.log; sleep 10; done
# afterwards: rows where location_received_at stops changing = gaps
```
**Customer SSE stream** (route verified in `backend/api/src/app.ts` mount `/api/v1/orders` + `orders/index.ts` `GET /:id/location/stream`, role CUSTOMER, customer must own the order):
```bash
curl -N -H "Authorization: Bearer $CUSTOMER_TOKEN" -H "Accept: text/event-stream" "$API/orders/$ORDER_ID/location/stream"
```
Frames: `event: location` + JSON data; `event: closed` (reasons `not_trackable`, `delivery_closed`, `server_shutdown`); comment lines `: heartbeat`.
**Post a location by hand (rider token):**
```bash
curl -i -X POST "$API/riders/deliveries/$DELIVERY_ID/location" -H "Authorization: Bearer $RIDER_TOKEN" -H "Content-Type: application/json" \
  -d '{"latitude":6.436,"longitude":80.026,"accuracy":12.5,"captured_at":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
```
202 accepted; 409 `DELIVERY_NOT_TRACKABLE` once closed.
**Logcat (filter to the app):**
```bash
"$ADB" logcat -c
"$ADB" logcat --pid=$("$ADB" shell pidof $PKG) | grep -i -E "BackgroundGeolocation|Capacitor|foreground|SecurityException|Failed to"
```
**Is the foreground service alive?**
```bash
"$ADB" shell dumpsys activity services $PKG | grep -A6 BackgroundGeolocationService
"$ADB" shell dumpsys notification --noredact | grep -A8 $PKG
```
**Location permission state (appops):**
```bash
"$ADB" shell dumpsys package $PKG | grep -E "ACCESS_(FINE|COARSE)_LOCATION"
"$ADB" shell cmd appops get $PKG COARSE_LOCATION ; "$ADB" shell cmd appops get $PKG FINE_LOCATION
```
**Doze / standby state:**
```bash
"$ADB" shell dumpsys deviceidle | grep -E "mState|mLightState|mScreenOn|mCharging"
"$ADB" shell dumpsys battery | grep -E "AC powered|USB powered|status"
"$ADB" shell am get-standby-bucket $PKG
```

---

## 2. Open items flagged by review - observe and record

**O-1: implicit permission bridge methods.** `tracking-plugin.ts` calls `BackgroundGeolocation.checkPermissions()` / `requestPermissions()`, which are not in the plugin's `.d.ts`; they exist only via Capacitor's inherited `Plugin` base class. Verify at runtime on the device:
1. Fresh install, open the app, sign in, reach a PICKED_UP delivery.
2. `adb logcat | grep -i "not implemented\|Capacitor"` while picking up. A `"BackgroundGeolocation.requestPermissions" ... not implemented` style error (UNIMPLEMENTED) means the bridge methods are absent; the adapter would swallow it and report `unavailable` (TrackingStatus shows the unavailable state, and tracking never starts).
3. Expected: the Android system location prompt appears, `TrackingStatus` moves to "granted"/"Sharing your location".
```
Observed: ______________________________  PASS | FAIL   date: ______  tester: ______
```

**O-2: `plugin.start` / `requestPermission` throws mid-session -> tracker stays bound to the delivery id until remount.** `DeliveryTracker.start()` sets `deliveryId` before awaiting the plugin; if `start()` throws, the id stays bound and `active` stays false. Try to provoke it (for example: start a delivery while OS location services are switched off and observe; or deny the permission dialog then re-open the delivery screen). Record: does the UI show an honest state, does a later re-pickup/remount recover, is anything sent while `active=false`?
```
Observed: ______________________________  PASS | FAIL   date: ______  tester: ______
```

---

## 3. Automated coverage of the API-level scenarios (reference, not a substitute for device runs)

Run from `backend/api`: `npx vitest run tests/rider-location.test.ts tests/location-stream.test.ts` (needs the test database).

| Concern | Automated test (file: test name) |
|---|---|
| Location accepted only after pickup | `rider-location.test.ts`: "accepts a location once the rider has picked up, not before" |
| Unauthorized rider | `rider-location.test.ts`: "rejects another rider submitting to this delivery (404, not 403)" |
| Customer / unauthenticated caller posting | `rider-location.test.ts`: "rejects a customer or unauthenticated caller" |
| Malformed / out-of-range coordinates or IDs | `rider-location.test.ts`: "rejects malformed and out-of-range coordinates" |
| Future / slightly stale `captured_at` | `rider-location.test.ts`: "rejects a captured_at far in the future, accepts one only slightly stale" |
| Duplicate and out-of-order updates | `rider-location.test.ts`: "a point no newer than the last accepted one is ignored, never regresses the stored position (duplicate/out-of-order)"; "an older write that commits after a newer one is already stored can never regress the position (TOCTOU)" |
| Server-side rate limit | `rider-location.test.ts`: "high-frequency submissions are throttled server-side, independent of the client" |
| Closed states (arrived/delivered/failed/cancelled) | `rider-location.test.ts`: "rejects a location once arrived, delivered, or failed - every closed state"; "rejects a location for a cancelled order even though the delivery row is still ASSIGNED" |
| Re-stage creates a new delivery, old one refused | `rider-location.test.ts`: "re-stage creates a new delivery; the old FAILED delivery never accepts a location again" |
| Concurrent writes | `rider-location.test.ts`: "concurrent writes to the same delivery do not corrupt or deadlock (5 reps)" |
| SSE: unauthenticated 401 / wrong role 403 / other customer 404 | `location-stream.test.ts`: "rejects an unauthenticated request (401)"; "rejects a non-CUSTOMER role (403)"; "a second customer cannot open the first customer's stream (404)" |
| SSE initial frame + live broadcast; closes on arrival; refuses closed order | `location-stream.test.ts`: "sends the current location immediately on connect, then a live broadcast"; "closes the stream once the delivery arrives"; "an already-arrived order refuses a new stream connection outright" |
| SSE heartbeat race, per-order fan-out, cleanup | `location-stream.test.ts` broadcaster + heartbeat unit tests |

Device-side manual checks for these (S16-S19) are still listed below because the real device and real network must be exercised at least once.

---

## 4. Scenario template

Every scenario records:
```
Observed: ____________________________________________________
PASS | FAIL   date: ____________   tester: ____________
```
Re-run any failed scenario at least once before concluding it is systemic (brief Step 4).

---

## 5. Scenarios (brief Step 3, items 1-15)

### S1. Sign-in, order walked to PACKED and assigned
- **Setup:** backend + tunnel up, app installed fresh (1.3). Rider phone number known.
- **Actions:** on the phone, sign in as the rider via OTP. On the laptop, create the order as a customer, source items and mark PACKED as staff, then assign to the rider as admin (same calls as `assignedOrder()` in `backend/api/tests/rider-location.test.ts`):
  ```bash
  curl -s -X POST "$API/orders" -H "Authorization: Bearer $CUSTOMER_TOKEN" -H 'Content-Type: application/json' -d '{"address_id":"<addr>","items":[{"product_id":"b0000001-0000-0000-0000-000000000001","quantity":1}]}'
  curl -s -X POST "$API/admin/orders/$ORDER_ID/items/<item_id>/source" -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' -d '{"actual_unit_cost":450}'
  curl -s -X PATCH "$API/admin/orders/$ORDER_ID/status" -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' -d '{"status":"PACKED"}'
  curl -s -X POST "$API/admin/orders/$ORDER_ID/assign-rider" -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"rider_id":"<riders.id>"}'   # response has delivery.id
  ```
- **Observe:** the delivery appears in the rider app queue; `psql "$DB" -c "SELECT assignment_status FROM deliveries WHERE id='$DELIVERY_ID'"` -> `ASSIGNED`.
- **Expected:** delivery visible; no location fields yet (`location_received_at` NULL).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S2. Pick up -> tracking starts ("Sharing your location")
- **Setup:** S1 done, fresh install (first-permission path, risk R-C). Screen on, app in foreground, logcat running (1.6).
- **Actions:** tap "Picked up". Accept the location permission prompt. On Android 13+, note whether any notification-permission prompt appears (it should not; risk R-D).
- **Observe:** `TrackingStatus` text; `dumpsys activity services` shows `BackgroundGeolocationService` `isForeground=true`; `dumpsys notification` shows the notification ("Sharing your location"); DB row starts filling; logcat has NO `Failed to foreground service` / `SecurityException`.
- **Expected:** "Sharing your location"; foreground service running; a persistent notification (record whether it is visible in the drawer and whether it can be swiped away - risks R-D, R-F); DB `location_received_at` set within ~10 s; `assignment_status = PICKED_UP`.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S3. Lock the screen
- **Setup:** S2 active, phone **unplugged** (see battery note in 1.3), gap logger and SSE `curl` running on the laptop.
- **Actions:** press the power button; leave the phone locked for the entire S4 walk.
- **Observe:** `dumpsys deviceidle | grep -E "mScreenOn|mState"` before the walk if adb is still connected.
- **Expected:** the notification remains; process not killed (`adb shell pidof lk.blynk.rider` still returns a PID when reconnected).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S4. Move for at least 5 continuous minutes (target 10+; do one 60-minute run for risk R-E)
- **Setup:** S3.
- **Actions:** walk (or drive) continuously with the phone locked in a pocket. Note start/end wall-clock times. Stay outdoors for GPS.
- **Observe:** see S5 and S6; the crucial moment is minute 5 (risk R-A) and, on long runs, minute ~60 (risk R-E).
- **Expected:** no interruption of updates across the whole walk.
```
Start: ____ End: ____  Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S5. Backend keeps receiving updates the whole time the screen was locked
- **Actions:** during/after S4 review `/tmp/rg-poll.log` and the DB row.
- **Observe:**
  ```bash
  psql "$DB" -c "SELECT location_captured_at, location_received_at, now()-location_received_at AS age FROM deliveries WHERE id='$DELIVERY_ID';"
  awk -F' \\| ' '{print $2}' /tmp/rg-poll.log | uniq -c | sort -k1 -n -r | head    # long runs of an identical value = a gap
  ```
- **Expected:** `location_received_at` advances continuously, gaps no longer than about 10-30 s while moving (client sends at most every ~9 s or after >=25 m; server throttles at 5 s), and specifically **no stall around minute 5 or after**. Coordinates in the DB change while moving.
```
Largest gap observed: ______  Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S6. Customer SSE receives moving coordinates
- **Actions:** on the laptop, keep the S1.6 `curl -N` stream open from before the walk.
- **Expected:** an initial `event: location` frame, then continuing `event: location` frames with changing `latitude`/`longitude` during the locked walk; `: heartbeat` comments between.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S7. Arrived -> `event: closed`, further POST -> 409
- **Actions:** unlock, tap "Arrived". Then, with the rider token:
  ```bash
  curl -i -X POST "$API/riders/deliveries/$DELIVERY_ID/location" -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' -d '{"latitude":6.436,"longitude":80.026,"accuracy":12.5,"captured_at":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
  ```
- **Expected:** SSE shows `event: closed` (`delivery_closed`) and ends; curl returns `409` `DELIVERY_NOT_TRACKABLE`; the app stops tracking (foreground service/notification gone: `dumpsys activity services` no longer lists it).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S8. App backgrounded (not locked)
- **Setup:** a fresh delivery (repeat S1-S2) with tracking active.
- **Actions:** press Home, open another app, keep the screen ON for >= 5 minutes while moving.
- **Observe:** gap logger + SSE as in S5/S6.
- **Expected:** updates continue exactly as in S5 (including past minute 5).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S20. Location POSTs keep arriving beyond 5 minutes in the background with the screen locked (CapacitorHttp)
- **Purpose:** proves the native-HTTP mitigation for the WebView throttling risk R-A (plugin issue #14). This is the specific check for `plugins.CapacitorHttp.enabled` in `capacitor.config.ts`.
- **Setup:** debug build installed from a `cap sync` that includes CapacitorHttp (confirm `apps/rider/android/app/src/main/assets/capacitor.config.json` contains `"CapacitorHttp": {"enabled": true}` before building); fresh delivery in PICKED_UP with tracking active (S2); phone **unplugged**; gap logger from 1.6 running on the laptop.
- **Actions:** lock the screen and keep the phone moving (or at least in a pocket with GPS fixes changing) for **at least 10 minutes**, i.e. well past the 5-minute WebView throttling point. Note the wall-clock time the screen was locked.
- **Observe (SQL):**
  ```bash
  psql "$DB" -c "SELECT location_received_at, now()-location_received_at AS age FROM deliveries WHERE id='$DELIVERY_ID';"
  awk -F' \\| ' '{print $2}' /tmp/rg-poll.log | uniq -c | sort -k1 -n -r | head   # a long run of one value = a gap
  ```
  Compare the timestamps after lock+5 min with those before: `location_received_at` must keep advancing, with no gap longer than about 30 s beyond minute 5.
- **Observe (adb, if still connected or after reconnecting):** `"$ADB" logcat -d | grep -i -E "CapacitorHttp|Capacitor/Console"` shows native `CapacitorHttp fetch` timing lines from the patched fetch (proof the native path is in use rather than the WebView), and no repeated `Could not reach the Blynk API` failures.
- **Expected:** POSTs keep arriving at the normal cadence past minute 5 and until unlock. If they stall near minute 5 while `dumpsys activity services` still shows `BackgroundGeolocationService` running, CapacitorHttp is not effective; record it and escalate.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S9. Network disconnected (airplane mode) mid-delivery
- **Actions:** with tracking active: enable airplane mode (Quick Settings toggle; or `adb shell cmd connectivity airplane-mode enable` on Android 11+ where permitted), keep moving 2+ minutes, then disable it and note the time.
- **Observe:** rider UI `TrackingStatus` during the outage; DB `location_received_at` (must not advance while offline); after reconnect, the SSE frames and DB rows.
- **Expected:** during the outage the UI shows an honest send-failed/offline state, never a fake "success"; nothing advances server-side; after reconnect sending resumes on its own within one throttle interval, and the customer stream shows the **current** position, **not** a burst of stale queued points (no offline queue by design).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S10. GPS / location services disabled at OS level mid-delivery
- **Actions:** with tracking active, turn Location off in Quick Settings (or `adb shell cmd location set-location-enabled false`), wait 1-2 min, then turn it back on.
- **Observe:** rider UI; `adb logcat` for the plugin error; DB row.
- **Expected:** UI shows the GPS-unavailable state (not a silent failure, not a crash); the app does not crash; updates resume after re-enabling (record whether they resume automatically or need an app action).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S11. Permission denied at first ask, then revoked mid-session
- **Actions (a):** fresh install (`adb uninstall`/`install`), pick up, **deny** the location prompt. **(b)** From Settings grant it, pick up a delivery again so tracking is active, then in Settings > Apps > Blynk Rider > Permissions > Location set **Don't allow** (or `adb shell pm revoke lk.blynk.rider android.permission.ACCESS_FINE_LOCATION` and `...ACCESS_COARSE_LOCATION`) while tracking runs.
- **Observe:** `TrackingStatus` after (a) and (b); `adb shell dumpsys package $PKG | grep ACCESS_FINE_LOCATION` (granted=false); DB `location_received_at` after revocation; note that revoking may kill the app process on some Android versions.
- **Expected:** (a) the permission-denied UI state, no tracking; (b) the permission-denied/revoked state, and **no location is stored after the revocation time** (`location_received_at` stops advancing).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S12. Stale location (stop sending for several minutes)
- **Actions:** with tracking active, either stand still with location off/airplane mode or use S9, for more than 2 minutes and again for more than 5 minutes, without closing the delivery.
- **Observe:** the raw timestamp age:
  ```bash
  psql "$DB" -c "SELECT now()-location_captured_at AS captured_age, now()-location_received_at AS received_age FROM deliveries WHERE id='$DELIVERY_ID';"
  ```
  and the SSE stream (no `location` frames, only heartbeats). Server broadcast staleness threshold is 5 min (`STALE_BROADCAST_THRESHOLD_MS` in `rider.location.service.ts`); the plan's freshness states are LIVE (about 1.5-2x the update interval), STALE (up to about 2 min), OFFLINE beyond that.
- **Expected:** the age keeps growing and crosses the plan section 10 thresholds: `captured_age` roughly under 20 s = LIVE, up to about 2 min = STALE, beyond = OFFLINE. (The Customer app now classifies with the same thresholds, LIVE up to 18 s, STALE up to 2 minutes, OFFLINE beyond, but it has never been run on a device; this scenario checks that the raw server data supports that classification.)
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S13. Rider app killed and restarted mid-delivery
- **Actions:** with tracking active, swipe the app away from Recents (and, separately, `adb shell am force-stop lk.blynk.rider`). Reopen the app.
- **Observe:** whether the foreground service/notification survived the swipe (`dumpsys activity services`); the app's queue/detail reload; `TrackingStatus`; DB row advancing again; logcat for a duplicate watcher (only one `BackgroundGeolocationService` instance, no doubled updates: two rows per second-interval would show as `location_received_at` advancing faster than the throttle allows).
- **Expected:** on restart the delivery is recovered from the API and tracking resumes exactly once (not silently off, not double-started).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S14. Failed delivery
- **Actions:** rider taps "Can't deliver" with a reason.
- **Observe:** UI; `dumpsys activity services` / notification gone; DB row stops advancing; SSE `closed`; manual POST as in S7.
- **Expected:** device-side tracking stops (no more updates from the phone even though the app is open and the phone still moving) AND a hand-crafted POST returns `409`. The notification disappears.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S15. Failed -> re-stage -> new delivery -> new tracking session
- **Actions:** after S14, as admin re-stage the order to PACKED and reassign a rider (`PATCH /admin/orders/$ORDER_ID/status {"status":"PACKED","notes":"restage"}`, then `POST /admin/orders/$ORDER_ID/assign-rider`). Note the **new** delivery id. Rider picks up.
- **Observe:**
  ```bash
  psql "$DB" -c "SELECT id, assignment_status, location_received_at FROM deliveries WHERE order_id='$ORDER_ID' ORDER BY created_at;"
  curl -i -X POST "$API/riders/deliveries/<OLD_DELIVERY_ID>/location" -H "Authorization: Bearer $RIDER_TOKEN" -H 'Content-Type: application/json' -d '{"latitude":6.4,"longitude":80.0,"accuracy":10,"captured_at":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}'
  ```
- **Expected:** updates now land on the NEW delivery row and never on the old one (`location_received_at` of the old FAILED row stays frozen); the old id POST returns `409`; no crossover of positions between the two rows.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

---

## 6. Additional scenarios (final requirements)

The API rules are covered by automated tests (section 3). Run the device/network-level versions once.

### S16. Out-of-order timestamps
- **Automated:** `rider-location.test.ts` duplicate/out-of-order + TOCTOU tests.
- **Device/manual:** with a live delivery, POST a newer point then an older `captured_at` (5 minutes earlier) by hand:
  ```bash
  NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); OLD=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S.000Z)
  ```
  (wait at least 6 s between POSTs because of the server rate limit; post `$NOW` first, then `$OLD`).
- **Expected:** both return `202`; the older one returns `accepted:false, reason:"not_newer"`; `SELECT location_captured_at FROM deliveries ...` still shows the newer value; SSE shows no regression.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S17. Duplicate updates
- **Device/manual:** POST the identical payload twice, >5 s apart, then twice within 1 s.
- **Expected:** `202` each time; stored position unchanged by the duplicate (`accepted:false`, `reason:"not_newer"`); the within-1-s one returns `accepted:false`, `reason:"rate_limited"`; SSE emits no extra frame for ignored points. While the phone is stationary, confirm the app itself does not flood the server (rows change at most about every 9 s).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S18. Unauthorized rider / customer
- **Device/manual:** POST a location to `$DELIVERY_ID` with (a) another rider's token, (b) the customer's token, (c) no token; open the SSE stream (d) with a different customer's token, (e) with a rider token, (f) without a token.
- **Expected:** (a) 404 (not 403); (b) 403; (c) 401; (d) 404; (e) 403; (f) 401. Nothing written to the DB row.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

### S19. Malformed coordinates / IDs
- **Device/manual:** POST `{"latitude":91,"longitude":80,...}`, `{"latitude":"abc",...}`, `{"accuracy":-5,...}`, `{"captured_at":"not-a-date"}`, and a captured_at 10 minutes in the future; also POST to `/riders/deliveries/not-a-uuid/location` and to a random valid UUID.
- **Expected:** `400` for bad coordinates/accuracy/timestamps and a `captured_at` more than 60 s in the future (a slightly stale one is accepted); `400`/`404` for a malformed / unknown delivery id; never `500`; the DB row unchanged (check constraints `chk_delivery_lat`, `chk_delivery_lon`, `chk_delivery_location_accuracy` never trip).
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

---

### S21. Tracking survives access-token expiry while backgrounded (added by the controller during implementation)

Rider access tokens expire after 15 minutes (`JWT_ACCESS_EXPIRY=15m`); the rider client refreshes on a 401 using the single-use rotated refresh token. With the screen locked, the location POSTs must cross that expiry and keep being accepted.

- **Setup:** an active `PICKED_UP` delivery, phone locked and moving, started with a freshly signed-in rider (so the access token's age is known).
- **Actions:** keep the phone locked and moving for at least **20 minutes** (i.e. past the 15-minute access-token expiry) without opening the app.
- **Observe:** `SELECT location_received_at, location_captured_at FROM deliveries WHERE id = '<delivery id>';` re-run every minute — `location_received_at` must keep advancing across minute 15-16 with no gap larger than the normal send interval plus one refresh round-trip. Also `refresh_tokens` should show one new rotated row for that rider around minute 15.
- **Expected:** no permanent stop at token expiry. A brief gap is acceptable only if updates resume by themselves within one send interval.
- **Note (from the CapacitorHttp task):** the patched native `fetch` ignores `AbortSignal`/timeouts, so a hung refresh or send cannot be cancelled by the client's 15 s timeout — watch for a case where updates stop and never resume after a network blip; if seen, record it (suggested follow-up: race fetch against an abort promise).
- **Observed / PASS|FAIL / date / tester:** _______________ (NOT RUN)

## 7. Release build spot-check (brief Step 5)
`./gradlew.bat assembleRelease` produces an **unsigned** APK (`app/build/outputs/apk/release/app-release-unsigned.apk`; `minifyEnabled false` so ProGuard/R8 is not in play). It cannot be installed until signed. For a local spot-check only, sign it with your own throwaway key (never commit a keystore):
```bash
BT="$SDK/build-tools/35.0.0"
"$BT/zipalign" -p -f 4 app-release-unsigned.apk app-release-aligned.apk
"$BT/apksigner.bat" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --out app-release-signed.apk app-release-aligned.apk
"$ADB" install -r app-release-signed.apk
```
Then repeat S2-S6 (at least the 5-minute locked walk) on the release build.
```
Observed: ______________  PASS | FAIL   date: ______  tester: ______
```

## 8. Verdict (fill after the run)
```
All of S1-S15 PASS on debug build?  ______   Additional S16-S19?  ______   Release spot-check?  ______
S20 (CapacitorHttp >5 min locked)?  ______   S21 (token expiry while backgrounded)?  ______
Open items O-1 ____  O-2 ____   Risk R-A observed? ____  R-D notification visible? ____
Device(s) used: ______________________   Verdict (fill in; leave blank until run): PASS — gate satisfied | FAIL — escalate
Signed: ______________  Date: ______________
```
Note: Tasks M0 to V1 were executed earlier, under the user's instruction, while this gate is still pending; the verdict above concerns only whether the gate itself is now satisfied.
