# Blynk Live Location & Delivery Tracking — Implementation Report

**Plan:** `docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md` (§0–§17 investigation, §D decisions D1–D6, §N tasks; the map provider was amended on 2026-09-19 from Google Maps to MapLibre + self-hosted PMTiles before any code was written)
**Spec:** the plan itself (there is no separate spec document). Phase brief: the user's live-location tracking instruction of 2026-09-19.
**Device runbook:** [`docs/06-deployment/rider-background-tracking-device-verification.md`](../06-deployment/rider-background-tracking-device-verification.md)
**Map tile setup:** [`docs/06-deployment/map-tile-hosting-setup.md`](../06-deployment/map-tile-hosting-setup.md)
**Customer Android build status:** [`docs/06-deployment/customer-android-build-status.md`](../06-deployment/customer-android-build-status.md)
**Phase range:** `93d7992..952e3f5` (42 commits on `main`, as of `952e3f5`, the last code commit of the final-review fix wave; the docs commit that records it follows; no feature branch, following this repository's convention)

> **STATUS: IMPLEMENTED AND AUTOMATED-TESTED — NOT PRODUCTION-READY. The physical Android background-tracking verification is BLOCKED/PENDING (no physical device or emulator was available); the Customer Android build is BLOCKED by a pre-existing dependency issue (details in §16 Known limitations).**

Nothing in this report claims that any physical-device scenario passed. Every coordinate that passed through the live pipeline test (§12.4) was a synthetic test input POSTed through the real rider API, not a GPS reading.

The evidence base for this report is the phase's implementation ledger and per-task reports (git-ignored workspace `.superpowers/sdd/2026-09-19-blynk-live-location-tracking/`), the git history, and the code itself. Where a ledger statement and the code disagree, the code is followed and the discrepancy is flagged in §16.4.

---

## 1. Scope & what was built

**Goal (plan):** real rider GPS location, captured only while a delivery is on the road, shown to the customer who owns that order on a live map, with no fake movement, no fake ETA and no invented infrastructure.

Built in this phase:

| Surface | What exists now |
|---|---|
| Backend | Migration 006 (five latest-location columns on `deliveries`); a rider location-write endpoint; an in-process SSE broadcaster; a customer SSE stream endpoint; a public, Range-capable route serving one self-hosted PMTiles archive; the archive itself (2,037,022 bytes) and its Docker packaging; two groups of in-process metrics counters (`locationUpdates`, `locationStreams`) |
| Rider app (React) | Capacitor 7.6.9 Android wrapper; a tracking module isolated behind a `TrackingPlugin` interface (the only file that imports the plugin is `tracking-plugin.ts`); an app-level tracker session that follows the delivery window; a passive `TrackingStatus` readout |
| Customer app (Flutter) | `LocationProvider` (SSE client); `RiderLocationPoint` + freshness classification; destination coordinate on `OrderModel`; a provider-neutral map contract with one MapLibre adapter; `OrderTrackingMap` on the order detail screen, gated to the trackable window; a "Use my current location" address picker |
| Docs | Tile hosting setup, device runbook, this report, the customer Android build note |

Not built, by decision (plan §D): no admin live map (D6); no ETA, route line or distance anywhere; no reverse geocoding; no location history (D5); no iOS scope; no push notifications.

**Not done by direction:** the Android toolchain upgrade for the Customer app (plan-external "Task T") was proposed by the controller, rejected by the user and never executed (§15). The physical-device gate (Task RG) could not be run because no device was available (§14).

---

## 2. Architecture

Five parts, each isolated behind one seam:

1. **Rider Capacitor app + `TrackingPlugin` isolation.** The existing React rider app is wrapped by Capacitor (Android only). `@capacitor-community/background-geolocation` is imported by exactly one file, `apps/rider/src/lib/tracking-plugin.ts`; everything else depends on the small `TrackingPlugin` interface (`checkPermission`, `requestPermission`, `start`, `stop`). Confirmed independently by the implementer and the reviewer with a grep, and re-run at Task RG. Test doubles live only in test files.
2. **Backend write endpoint that bypasses the lifecycle engine.** `POST /riders/deliveries/:id/location` validates, checks ownership and the trackable window from the database, throttles, and overwrites the five location columns with one conditional `UPDATE`. It never imports `modules/orders/lifecycle/` (`engine.ts`, `catalogue.ts`, `actions/*`) and cannot change `order_status` or `assignment_status`. Task B5 grep-checked this: zero `import` statements reference the lifecycle directory from `rider.location.service.ts` or `order.location.controller.ts`.
3. **In-process SSE broadcaster.** `modules/realtime/location-stream.ts` keeps `order_id -> Set<Response>` in memory. The write endpoint calls `broadcastLocation`; the customer stream handler calls `subscribe`. Correct only while the API runs as a single container (§16).
4. **Customer `LocationProvider` + `MapProvider`/`TrackingMapView` abstraction.** The provider is a `ChangeNotifier` with an injectable stream opener (the same convention as `OrderProvider`). The map layer is provider-neutral (`GeoPoint`, `MapMarkerSpec`, `TrackingMapView`, `LocationPickerMapView`); exactly one file, `lib/UI/Widgets/Organisms/maplibre_map_view.dart`, imports `maplibre_gl`, and exactly one file, `lib/Services/Location/geolocator_location_source.dart`, imports `geolocator`. Both are enforced by `test/map_isolation_test.dart`.
5. **Self-hosted PMTiles.** One archive built from a Protomaps basemap extract, served by the existing backend at `/map-tiles/blynk-service-area.pmtiles`. No tile SaaS, no API key, no Google.

```
 Rider phone (Capacitor, Android)                     Backend (single API container)                     Customer phone (Flutter)
 +-----------------------------+                     +--------------------------------+                 +-----------------------------+
 | background-geolocation      |                     |                                |                 |  LocationProvider           |
 |  (foreground service)       |                     |  POST /riders/deliveries/:id/  |                 |   GET /orders/:id/          |
 |     |                       |   HTTPS (native     |        location                |                 |       location/stream (SSE) |
 | TrackingPlugin interface    |   HTTP via          |   RIDER auth -> own delivery   |   event:location|   freshness tick, backoff   |
 |     |                       |   CapacitorHttp)    |   -> PICKED_UP+OUT_FOR_DELIVERY|  --------------->   monotonic guard             |
 | DeliveryTracker (throttle)  | ------------------> |   -> future/not_newer/5s floor |   (broadcaster) |        |                    |
 |     |                       |   {lat,lng,acc,     |   -> conditional UPDATE on     |                 |  OrderTrackingMap           |
 | tracker-session (window)    |    captured_at}     |      deliveries (5 columns)    |   : heartbeat   |   -> TrackingMapView        |
 +-----------------------------+                     |   -> broadcastLocation()       |   every 15 s    |   -> MapLibre adapter       |
                                                     |                                | <----- re-check |        |                    |
                                                     |  GET /map-tiles/               |                 |  pmtiles://https://.../     |
                                                     |   blynk-service-area.pmtiles   | <---- Range ----|   map-tiles/...pmtiles      |
                                                     |   (public, Range/206/416/304)  |                 +-----------------------------+
                                                     +--------------------------------+
   Only the latest point is stored; no history table. The write path never calls runTransition / lifecycle/engine.ts.
```

---

## 3. Database changes

Migration `backend/api/src/database/migrations/006_rider_location_tracking.sql` (with `_down.sql`), additive and nullable on `deliveries`:

| Column | Type | Meaning |
|---|---|---|
| `current_latitude` | `NUMERIC(9,6)` | latest reported latitude |
| `current_longitude` | `NUMERIC(9,6)` | latest reported longitude |
| `location_accuracy_m` | `NUMERIC(7,1)` | reported accuracy in metres |
| `location_captured_at` | `TIMESTAMPTZ` | device fix time (as reported by the rider app) |
| `location_received_at` | `TIMESTAMPTZ` | server receipt time |

Constraints (same `chk_<table>_<field>` naming as migration 001): `chk_delivery_lat` (NULL or -90..90), `chk_delivery_lon` (NULL or -180..180), `chk_delivery_location_accuracy` (NULL or > 0).

- **Latest-location only.** Every accepted write overwrites the five columns; no history table, no cleanup job, no index added. Nothing in the API reads anything older than the current value (plan §D.5, §D.8).
- **Precision.** Six decimal places on coordinates (about 0.1 m); accuracy to 0.1 m. All existing coordinate columns in this schema use `NUMERIC(9,6)`.
- **Two timestamps** so freshness is always computable: `captured_at` (device) and `received_at` (server). The write also bumps `updated_at`.
- **Types.** `DeliveriesTable` in `database/types.ts` gained the five fields using the existing `ColumnType` convention. The down migration drops the constraints then the columns, each guarded with `IF EXISTS`.
- **Applying it.** The migration file existed on disk but was not applied to the local dev database when Task B2's tests first ran (`column deliveries.location_captured_at does not exist`); it was applied with `npx tsx src/database/migrate.ts up`. Other environments need the same step. B1 itself only verified by typecheck; the migration was first executed against a real database in B2.

---

## 4. API endpoints

`API_PREFIX` defaults to `/api/v1`. Paths below are relative to it except the tile route.

### 4.1 Rider location write

`POST /riders/deliveries/:id/location` (the riders router is also mounted at `/rider`, so `/rider/deliveries/:id/location` works too).

- **Auth:** bearer JWT, `requireAuth` + `requireRoles('RIDER')`; the caller must have an active rider profile (`RIDER_PROFILE_NOT_FOUND` / `RIDER_INACTIVE`, both 403).
- **Body (Zod):** exactly `{ latitude: -90..90, longitude: -180..180, accuracy: > 0 (metres), captured_at: ISO 8601 datetime string }`. Unknown keys are stripped (Zod default) and never read: no order id, rider id or customer id is ever taken from the body. Authorization comes from `req.user` and the delivery row's own database state.
- **Responses**

| Status | Meaning |
|---|---|
| `202` `{"success":true,"data":{"accepted":true}}` | stored (and broadcast unless the point is older than 5 minutes, see below) |
| `202` `{"accepted":false,"reason":"not_newer"}` | `captured_at` is not newer than the stored point, or a concurrent newer write won. Nothing stored, nothing broadcast |
| `202` `{"accepted":false,"reason":"rate_limited"}` | the previous accepted write for this delivery was received less than 5 s ago. Nothing stored |
| `400 VALIDATION_ERROR` | bad body, non-UUID delivery id, or `captured_at` more than 60 s in the future |
| `401` | no/invalid token |
| `403` | non-RIDER role, or no/inactive rider profile |
| `404 DELIVERY_NOT_FOUND` | no such delivery, or it belongs to another rider (never 403, so existence is not disclosed) |
| `409 DELIVERY_NOT_TRACKABLE` | delivery exists and is this rider's but is outside the trackable window; `details` carries `assignment_status` and `order_status` |

- **Trackable window:** `deliveries.assignment_status = 'PICKED_UP'` **and** `orders.order_status = 'OUT_FOR_DELIVERY'`, read fresh from the database on every request and never cached. The second condition independently covers a cancelled order that left its delivery row `ASSIGNED`.
- **Evaluation order** (`rider.location.service.ts`): rider profile, then ownership (404), then window (409), then 60 s future skew (400), then the not-newer fast path, then the 5 s floor, then the conditional write.
- **5 s floor** (`MIN_LOCATION_INTERVAL_MS = 5_000`): compares `now` with the stored `location_received_at`. It is best-effort by design (a code comment states an occasional over-frequent write slipping through under a race is acceptable abuse mitigation, not a data-integrity guarantee).
- **not_newer is authoritative in the write itself.** The fast path is only an early exit. `writeLocation` is a single-row `UPDATE ... WHERE id = $1 AND (location_captured_at IS NULL OR location_captured_at < $captured)`; a zero-row result is reported as `not_newer`. This closes a check-then-act race found in Task B2's review (an older `captured_at` could otherwise overwrite a newer one under concurrent writes).
- **60 s future skew** (`MAX_FUTURE_SKEW_MS`): a clock-skew guard, not a real-point rule.
- **5 min stale broadcast threshold** (`STALE_BROADCAST_THRESHOLD_MS`): a point older than 5 minutes is stored (returns `accepted:true`) but **not** broadcast live. By code inspection a later connection's initial snapshot would include it; the live pipeline test (S8) observed only store-without-broadcast (202 accepted, not broadcast).
- **Rider client path:** `deliveriesApi.sendLocation` in `apps/rider/src/api/resources.ts`.

### 4.2 Customer SSE stream

`GET /orders/:id/location/stream`

- **Auth:** bearer JWT, `requireAuth` + `requireRoles('CUSTOMER')`; the order must belong to the caller.
- **Before the stream starts (normal JSON errors):** `400` malformed order id; `401` unauthenticated; `403` non-CUSTOMER role; `404 ORDER_NOT_FOUND` for both "no such order" and "not your order".
- **Stream response:** `200`, `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- **Initial snapshot:** if the order is in the window and a stored point exists, one `event: location` is sent immediately.
- **Events**
  - `event: location`, data `{"latitude","longitude","accuracy","captured_at","received_at"}` (numbers; ISO-Z timestamps).
  - `event: closed`, data `{"reason": "not_trackable" | "delivery_closed" | "server_shutdown"}`.
  - Comment line `: heartbeat` every 15 s.
- **Closed reasons**
  - `not_trackable`: sent at connect (HTTP status is still `200`) when the order is not currently in the window (before pickup, after arrival, delivered, failed, cancelled), then the response ends.
  - `delivery_closed`: sent by the heartbeat re-check when an open stream's window has ended (ownership and window are re-checked on every tick).
  - `server_shutdown`: sent by `closeAllStreams()` during graceful shutdown so `server.close()` never waits on a long-lived stream.
  - **Client semantics** (`LocationProvider`): `not_trackable` and `delivery_closed` are the authoritative end (`closed = true`, current point cleared, no reconnect). `server_shutdown`, an unknown reason, or a malformed frame is **not** terminal: the provider keeps its last point and reconnects with backoff. This distinction was a Critical review finding (§15, M3).
- **Auto-close on leaving the window:** bounded by the 15 s heartbeat, so the stream closes within one interval of the state change, not instantly. Observed in the live pipeline test: 2.75 s (arrival), 13.5 s (failed), 11.4 s (customer unavailable).
- **No frames after closure.** The write endpoint refuses points once the window closes (409), so no location frame can follow the state change; the up-to-15 s is only the latency of the `closed` notification.
- **Transient heartbeat errors:** a database error during a heartbeat re-check is logged and retried on the next tick; it does not tear down a healthy stream.
- **Server tuning:** `server.keepAliveTimeout = 65_000`, `server.headersTimeout = 66_000` (`server.ts`).
- **Metrics** (in-process, `utils/metrics.ts`): `locationUpdates {received, rejectedNotNewer, rejectedRateLimited}` and `locationStreams {opened, closedNotTrackable, closedDeliveryClosed}`. No PII. (`server_shutdown` closes are not counted.)

### 4.3 Map tile archive

`GET` and `HEAD {origin}/map-tiles/blynk-service-area.pmtiles` — mounted at the application root (like `/uploads`), **not** under `API_PREFIX`. Full detail is in `map-tile-hosting-setup.md` §8.1; summary:

- **Public**, no authentication, read-only (`405` + `Allow: GET, HEAD` for other methods). Only names ending `.pmtiles` are reachable; the archive directory's README, dotfiles, directory listings and path traversal are 404/403.
- **Range:** `Accept-Ranges: bytes`; `Range: bytes=0-126` gives `206` with `Content-Range: bytes 0-126/2037022` and a 127-byte body; suffix ranges work; an unsatisfiable range gives `416` with `Content-Range: bytes */2037022`; `If-None-Match` gives `304`. Weak `ETag` and `Last-Modified`.
- **`Cache-Control: public, max-age=3600`** (one hour; deliberately not `immutable` because the file name is reused on rebuild).
- **No compression.** There is no compression middleware and none may be added in front of this route: PMTiles offsets refer to the bytes as stored, so a re-encoded body corrupts every range. Tests assert no `Content-Encoding` even with `Accept-Encoding: gzip, deflate, br`.
- `Cross-Origin-Resource-Policy: cross-origin` on this route only.
- Config: `MAP_TILES_DIR` (default `map-tiles`, resolved against the working directory; the Docker image sets `/app/map-tiles`). The Task M0b reviewer ran the real app and observed HEAD / 206 / 416 / 304 with `curl`.

---

## 5. Tracking lifecycle

**Window (plan §2.3, §D.1–D.2):** tracking exists only while the delivery is `PICKED_UP` and its order is `OUT_FOR_DELIVERY`. It never starts earlier. It ends on every way the window can close: arrived (`ARRIVED_AT_CUSTOMER`), delivered, failed, customer unavailable, cancelled.

### 5.1 What starts and what stops device-side tracking (Rider app)

Start: the delivery becomes trackable (`isTrackable(d)` in `lib/delivery.ts`: `assignment_status === 'PICKED_UP' && order_status === 'OUT_FOR_DELIVERY'`) as seen by the app-level session. Stop, from any of:

| Cause | Mechanism |
|---|---|
| Rider taps Arrived / Can't deliver | the step returns new delivery data; `Delivery.tsx` reports it via `syncTracking(data)`; a non-trackable delivery that is the one being tracked stops |
| Admin cancels, customer-unavailable, delivered by another actor | the next 30 s revalidation, foreground return or list load reports the new state; same path |
| Server says 409 to a location POST | the send wrapper in `tracker-session.ts` stops tracking, but only if the tracker is still bound to that delivery id (a late 409 for an old delivery cannot stop its replacement) |
| Server says 404 `DELIVERY_NOT_FOUND` (reassigned / never this rider's) | same as 409; `Delivery.tsx` also calls `stopTrackingFor(id)` when a detail fetch or action returns `DELIVERY_NOT_FOUND` |
| Queue sync | after a **successful** list load, `syncTrackingFromList` keeps the currently tracked delivery if it is still trackable, else follows the first trackable one in API order; none trackable stops. A failed load starts and stops nothing |
| App restart / cold start | the Queue is the landing screen; its list sync resumes tracking for a delivery that is still `PICKED_UP`. The Delivery screen does the same on mount. Resume does not depend on which screen is open |

The tracker is a module-level singleton (`getTracker()`); every start and stop is serialized through one promise queue so overlapping callers can never interleave. Leaving the Delivery screen does not stop tracking; unmounting only drops the UI listener. A failed native `plugin.stop()` is retried (`hasPendingStop()`); `active` only becomes false once the plugin confirms.

### 5.2 Failed, re-stage, new delivery: identity guarantee

A failed delivery that an admin re-stages creates a **new** `deliveries` row; the old row must never accept or serve a location again. This is enforced independently at every layer, with no explicit "current delivery" flag:

| Layer | Enforcement |
|---|---|
| Write (backend) | the trackable predicate is evaluated against the specific delivery row: the old row is `FAILED`, so `409 DELIVERY_NOT_TRACKABLE` (test: "re-stage creates a new delivery; the old FAILED delivery never accepts a location again") |
| Stream (backend) | `findTrackableLocationForCustomer` joins `orders` to `deliveries` requiring `assignment_status = 'PICKED_UP'` and `order_status = 'OUT_FOR_DELIVERY'`. The old `FAILED` row can never match (`uq_deliveries_active_assignment` allows one active row per order) |
| Rider app | tracking identity is the delivery id: a different trackable id is a new identity, the old watcher is stopped before the new one starts; `start()` resets throttle state, `lastSentAt` and `lastError`; a send or 409 that lands after a stop/switch is discarded |
| Customer app | `watch()` bumps a generation counter and clears all state (no point is carried across watches). The order-screen gate hides the map once the order leaves `OUT_FOR_DELIVERY`/`PICKED_UP`; a re-stage cycle triggers a fresh watch |
| Live proof | pipeline scenario S8 (§12.4): point X is shown, the rider fails, the provider closes, the admin re-stages, a new delivery id is created, a new watch holds "no point" until the new delivery's first POST, and X is never shown again. Old-id POSTs return 409 after re-stage, after reassignment and after the new pickup |

One documented gap: the customer stream events carry no delivery id (§16, known limitation).

---

## 6. SSE behaviour detail

**Frames.** `event: <name>\ndata: <json>\n\n`; heartbeats are comment lines `: heartbeat\n\n`. The client normalizes `\r\n`, splits frames on a blank line, ignores comments, joins multi-line `data:`, ignores malformed JSON and frames it does not understand (never throws), and drops a pending buffer larger than 64 KB.

**Transport (customer).** Dio streaming GET through the shared `ApiService.dio`, so the base URL, the auth header and the 401-refresh-retry interceptor all apply and each reconnect re-reads the current token. The request overrides `receiveTimeout` to 45 s (the API's 15 s default would race the 15 s heartbeat and kill a healthy stream). Cancelling the subscription cancels the request's `CancelToken`, including while it is still connecting.

**Reconnect.** A connection that ends without a server `closed` (network loss, timeout, 5xx, restart) keeps the last point (which ages on its own) and reconnects: backoff 1, 2, 4, 8, 16, then 30 s, with ±20 % random jitter (so the effective ceiling is about 36 s). A connection only counts as healthy, and resets the backoff, once it has stayed up for at least 30 s after its first frame; duplicate snapshots and heartbeats do not reset it. Permanent refusals (any 4xx except 408 and 429) set `unavailable = true` and stop retrying; 5xx and network errors are retried. Not calling reconnect a "closed" is deliberate: `closed` is set only by the server's `closed` event.

**Freshness (classified from server timestamps against an injected clock).**

| State | Age of `captured_at` |
|---|---|
| LIVE | up to 18 s |
| STALE | over 18 s, up to 2 minutes |
| OFFLINE | over 2 minutes |

A 5 s periodic tick re-notifies so LIVE moves to STALE to OFFLINE from elapsed time alone; it makes no network call. A `captured_at` in the future (clock skew) is treated as live. A point without `captured_at`, `received_at`, both coordinates in range and `accuracy > 0` is dropped, never fabricated.

**Monotonic guard.** A `location` event whose `captured_at` is not after the current point's is ignored and does not re-notify, so duplicates and out-of-order events never move the marker backwards.

**Unavailable versus closed.** `closed` means the server ended the stream authoritatively. `unavailable` means the server refused the connect with a permanent client error (the last point is dropped too). A dropped connection is neither.

---

## 7. Rider app

**Capacitor scaffolding (Task R1).**
- `@capacitor/core|cli|android` are pinned to **7.6.9** (the `latest-7` dist-tag), not 8.x: `@capacitor/cli@8.5.2` declares `engines.node >=22` and hard-fails on the Node 20.20.2 in this environment (`[fatal] The Capacitor CLI requires NodeJS >=22.0.0`). Changing the machine's Node version was out of scope. 7.6.9 is a maintained line and is the pairing the plugin supports; the plugin does not support Capacitor 8 (upstream issue #156, a crash on backgrounding), so the pin is also the safer choice. Do not upgrade without re-checking.
- `@capacitor-community/background-geolocation` **1.2.26**.
- `appId lk.blynk.rider`, `appName Blynk Rider`, `webDir dist`. `apps/rider/android/` is the generated Capacitor project (53 of the phase's 134 changed files).
- `android.useLegacyBridge: true` in `capacitor.config.ts` — required by the plugin's README, otherwise background updates halt after about 5 minutes (plugin issue #89).
- **`CapacitorHttp` enabled** (`plugins.CapacitorHttp.enabled: true`, Task RG-b). The plugin README states that after 5 minutes in the background Android throttles HTTP requests initiated from the WebView and recommends a native HTTP path (issue #14). The rider app sent locations through WebView `fetch()`, which is exactly the "stops after about 5 minutes with the screen locked" failure. Enabling `CapacitorHttp` patches global `fetch` to native HTTP on Android. This is configuration only and is **unverified on a device** (runbook S20). Side effects recorded: the patched `fetch` ignores `AbortSignal`, so `client.ts`'s 15 s request timeout does not fire on Android; CORS and mixed-content checks no longer apply to API calls; plain `http://` to a LAN address is blocked by Android's cleartext policy, so an HTTPS tunnel is recommended for device testing.

**Manifest and permissions.** The app manifest declares `INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`. The plugin's own library manifest merges in `<service ...BackgroundGeolocationService foregroundServiceType="location">` and `POST_NOTIFICATIONS`; no manual `<service>` block is needed (verified in the built merged manifest). minSdk 23, compileSdk/targetSdk 35.

**Android background requirements and caveats (from the Task RG desk research and the runbook).**
- Android 14+ requires `FOREGROUND_SERVICE_LOCATION`, `foregroundServiceType="location"` and an already-granted location runtime permission before `startForeground()`, otherwise `SecurityException`. Plugin issue #153 (open) reports exactly this on Android 14–16 when the watcher starts while the first permission prompt is pending. The tracker awaits `requestPermission()` before `start()` to avoid it; this needs confirming on a fresh install.
- `ACCESS_BACKGROUND_LOCATION` is declared (plan-mandated) but the foreground-service approach does not need it and the plugin never requests it; Play Store review implications; left in place.
- `POST_NOTIFICATIONS` is never requested at runtime (the plugin does not, upstream issue #141, and the app does not). On Android 13+ the foreground service still runs but its notification may be hidden from the drawer. Requesting it would need a new dependency (for example `@capacitor/local-notifications`), which was not added.
- OEM battery killers (Huawei, Xiaomi, OnePlus, Samsung per dontkillmyapp.com) may stop the service; the plugin has no battery-optimisation exemption prompt (issue #127); issue #126 reports updates stopping after about an hour on some devices.
- The notification icon defaults to `mipmap/ic_launcher` (issue #135 concerns an invalid icon).
- Plugin maintenance: last release 1.2.26 on 2025-08-28; effectively unmaintained.

**Permission bridge.** The installed plugin's `.d.ts` has no `checkPermissions`/`requestPermissions`; `tracking-plugin.ts` calls them through a local `WithAutoPermissions` interface because Capacitor's base `Plugin` class exports them for any plugin declaring `@CapacitorPlugin(permissions=...)`. The reviewer confirmed this against the installed sources; it is not proven at runtime (§14).

**Tracker behaviour.** `DeliveryTracker` sends a point when at least 9 s (`MAX_INTERVAL_MS`) have passed since the last confirmed send **or** the rider has moved at least 25 m (`MIN_DISTANCE_M`, haversine); otherwise the point is skipped. The plugin is also given a native `distanceFilter: 25`, and the server's 5 s floor caps the accepted rate regardless. Sends run only for the delivery id the tracker is bound to. There is no offline queue: while offline nothing is sent and nothing is replayed.

**`TrackingStatus` states** (`components/TrackingStatus.tsx`; it never renders a coordinate, which a mutation test proves). Precedence, first match wins:
1. Permission `denied`, or `lastError = permission_denied`: "Location permission is off — turn it on in your phone's settings so your customer can see you."
2. Permission `unavailable` and not active: "Location isn't available on this device right now — check that location services are on and reopen the app."
3. `lastError = position_unavailable`: "Can't get your location — check GPS is on."
4. Not active, and a send previously succeeded: "Stopped sharing your location." (otherwise nothing)
5. Active with `lastError = network`: "Couldn't send your last location — retrying." plus "Last sent Ns ago".
6. Active: "Sharing your location — updated Ns ago".

Rendered on the Delivery screen while the delivery is trackable or reportable (through `ARRIVED_AT_CUSTOMER`, so the "Stopped sharing" confirmation is reachable).

---

## 8. Customer app

**Order-screen gating.** `isLiveTrackable(order)` (`order_summary_screen.dart`) is true only when `order.status == OrderStatus.outForDelivery` **and** `order.delivery.assignmentStatus == 'PICKED_UP'`. It is the one place both the map section and the stream watch consult. The map never appears before pickup and never after arrival, delivery, failure or cancellation. With no destination coordinates the map section renders nothing at all.

**Watch lifecycle** (owned by the order detail screen).
- `watch()` is called only on the edge not-watching to watching (it clears provider state), never on every refresh.
- The watch stops when the order stops being trackable, when the screen is disposed, and when the app goes to `hidden`, `paused` or `detached`. `inactive` is deliberately ignored (notification shade, system dialog).
- A fetch that lands while backgrounded still updates the screen but opens no connection. On `resumed` the order is refetched and, if still trackable, a fresh watch starts.
- When the stream reports an authoritative `closed`, the screen performs exactly one guarded refetch so the status header stops saying "out for delivery".
- `LocationProvider` is registered in `buildAppProviders()` (extracted from `main()` so a test can check the tree) and opens no connection at construction.
- The screen learns that an order became `PICKED_UP` only through the existing refetch triggers (pull-to-refresh, foreground return, after a cancel attempt). **No polling was added** (decision for the user, §16).

**Map states.** Destination marker whenever coordinates exist. Rider marker only while a point exists, freshness is not OFFLINE, and the stream is neither `closed` nor `unavailable`; STALE draws the rider at half opacity. Caption under the map: "Live" (LIVE), "Last seen N seconds/minutes ago" (STALE; never a coordinate), otherwise "Live location unavailable right now." The camera starts on the destination at zoom 14 and fits both markers once, when the rider first appears (48 px padding, minimum box about 220 m); it never re-fits. No route line, no ETA, no distance.

**Location picker ("Use my current location").** `LiveLocationPickerScreen`, opened from a new button on the address form. Explain-before-prompt: nothing touches the device, not even `checkPermission`, until the customer taps "Allow location". State machine: explain, requesting, locating, ready, denied, deniedForever, servicesOff, error; every state offers "Enter manually" and back, which return null and leave the address form unchanged. The OS permission prompt is requested only when the status is an askable denial; a permanent denial offers "Open settings", location services off offers "Open location settings". One high-accuracy fix with a 15 s time limit plus a 20 s outer bound; a failure shows an error, never a guessed position. The map is a confirmation aid: a fixed centre pin over a panning map (chosen over dragging an annotation, which would need per-feature hit testing and style-reload handling); if the style or tile URL cannot be built the screen shows "Map unavailable" with no pin and Confirm still returns the device fix. A confirmed position writes 6-decimal text into the existing latitude and longitude fields, which remain editable; validation and save are unchanged. There is no reverse geocoding, no distance or radius hint and no ETA. The copy states that seeing the rider is separate and needs no device permission.

**Device location behind an adapter.** `DeviceLocationSource` is the interface; `GeolocatorLocationSource` is the only `geolocator` importer (`geolocator ^14.0.2`, resolved 14.0.2). `geolocator_android` 5.0.3 pulls Google Play services **Location** (`play-services-location` 21.2.0), which is **not** Google Maps and needs no API key or manifest meta-data; `AndroidSettings(forceLocationManager: true)` would avoid Play services entirely and is not used. The merged Android manifest also gains a location-type foreground-service declaration from geolocator, which may matter in a Play Console declaration.

**Permissions.**
- Android (`AndroidManifest.xml`): `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` only, for the address picker. No background location, no foreground service in the app's own manifest, no Maps key.
- iOS (`Info.plist`): `NSLocationWhenInUseUsageDescription` = "Blynk uses your location once to pin your delivery address on the map." No "always" description.
- Watching the rider needs no device permission.

---

## 9. MapLibre integration

- **Package:** `maplibre_gl 0.25.0` (Dart >=3.5, Flutter >=3.22), bundling Android `org.maplibre.gl:android-sdk:12.3.1` and iOS MapLibre 6.19.1.
- **Why not 0.26.x or 0.27.x:** both fail to resolve (`maplibre_gl_web needs image ^4.8.0 -> archive ^4.0.7, but lottie ^2.4.0 needs archive ^3.0.0`). The blocker is the project's existing `lottie ^2.4.0` pin; bumping lottie is a wider change to an unrelated package and was not made. 0.25.0 is the newest that resolves against the untouched dependency set.
- **Native PMTiles support:** present since package version 0.22.0 (its changelog: Android maplibre-native 11.9.0 and iOS 6.14.0 "mainly introduces PMTiles support"). This closed the tile setup document's "minimum `maplibre_gl` version UNVERIFIED" item. An actual PMTiles render has never been observed (no device).
- **Adapter isolation.** `map_provider.dart` (provider-neutral contract, no SDK import), `order_tracking_map.dart` and the picker depend only on it. `maplibre_map_view.dart` is the sole importer of `package:maplibre_gl`, and no file imports a `maplibre_gl_*` platform package. `map_isolation_test.dart` also asserts no `google_maps_flutter`, `com.google.android.geo` or `GMSServices` in `lib/`, `pubspec.yaml`/`pubspec.lock`, the Android manifest and Gradle files, or `ios/Runner` (extended in M5 and proven with an injected-violation check).
- **Style asset:** `Assets/map/blynk_map_style.json` (MapLibre style spec v8, about 17 KB, 25 layers, listed in `pubspec.yaml` as `Assets/map/`). Its only source URL is the placeholder `pmtiles://__TILES_URL__`.
- **Placeholder substitution contract** (`map_tile_config.dart`, pure and unit-tested): the style is decoded, the placeholder in each source `url` is replaced by the resolved absolute archive URL, and it is re-encoded (never string-replaced, so the URL cannot break out of its JSON string). Substitution fails closed (returns null) on an invalid tiles URL, malformed style, a style with no placeholder, or a token still present afterwards. Any failure shows an honest "Map unavailable" box, never a map built from a guessed URL. The result is `pmtiles://https://<host>/map-tiles/blynk-service-area.pmtiles`.
- **Attribution overlay:** "© OpenStreetMap contributors", drawn by Blynk's own widget tree (bottom-left, non-interactive, permanent), so it survives a style or provider swap. `maplibre_gl` 0.25.0 cannot hide its own native attribution button, so a second, native one stays bottom-right; the overlay is not a hyperlink.
- **Label-free style tradeoff:** the style has no `glyphs`, no `sprite` and no `symbol` layers. Protomaps' documented glyph and sprite assets are third-party hosted and there is no documented font self-hosting procedure, so street names and POI icons are intentionally not drawn: the customer sees a destination marker, a rider marker and roads. Adding labels is a separate task (self-host font PBFs; licence and hosting steps UNVERIFIED).
- **Map options:** compass, rotate and tilt off, `myLocationEnabled` false (no location layer or permission), zoom 10 to 18, only the circle annotation manager. Markers: destination violet `#8E24AA`, rider azure `#1E88E5`, stale rider the same azure at 50 % opacity, 9 px radius with a 2.5 px white stroke. Marker updates use one drain loop and `updateCircle` on the existing annotation (no remove/add flicker), and reset on style reload.
- **Not proven:** that the style loads, that `pmtiles://https://...` tiles fetch and draw, that inline style JSON is accepted on both platforms, and how gestures feel inside the scroll view. Runtime tile/style failures (server down, archive 404, cleartext blocked) are not detected: no map-error callback is used, so the user would see the water-blue background with markers instead of "Map unavailable".

---

## 10. PMTiles setup & provider configuration

The full procedure, licensing, recorded facts, HTTP requirements, production notes, the OpenFreeMap fallback and rejected tiers are in [`map-tile-hosting-setup.md`](../06-deployment/map-tile-hosting-setup.md); this section restates only what is needed here. A rebuild procedure is also in `backend/api/map-tiles/README.md`.

| Item | Value |
|---|---|
| Archive | `backend/api/map-tiles/blynk-service-area.pmtiles`, 2,037,022 bytes |
| SHA-256 | `673049d27e20f5e67ad36a9a118c8c6ef06c7900685e4255067924e8bc468e45` (checked by `tests/map-tiles.test.ts` against the README) |
| Source build | `https://build.protomaps.com/20260919.pmtiles` (Protomaps basemap 4.15.2; OSM data as of 2026-09-19T04:00:00Z; built by Planetiler 0.10.2) |
| Extracted | 2026-09-20 with `pmtiles` CLI v1.31.2 |
| Bounding box | `79.973,6.384,80.082,6.492` (min lon, min lat, max lon, max lat): hub 6.4382, 80.0274 plus the 4 km delivery radius plus a 2 km margin (the archive extends at least 1.97 km beyond the radius on every side, re-checked by the M0a reviewer) |
| Zoom | 0 to 15 (z15 is the highest zoom in the Protomaps v4 basemap; the plan's z16 is unattainable from this schema; MapLibre over-zooms vector tiles, so the map stays sharp at z16 to z18) |
| Format | PMTiles v3, MVT tiles, gzip; layers `boundaries, buildings, earth, landcover, landuse, places, pois, roads, water` |

**Configuration**
- Backend: `MAP_TILES_DIR` (default `map-tiles`; the Docker image sets `/app/map-tiles`; `.env.example` documents it). No secrets.
- Customer app `.env` (git-ignored, bundled as an asset): the existing `API_BASE_URL` (locally `http://localhost:4000/api/v1`) is enough: the archive URL is derived as scheme + host + port of that URL plus `/map-tiles/blynk-service-area.pmtiles` (the `/api/v1` path is dropped because the archive is served at the application root). The optional key `MAP_TILES_URL` (absolute http/https URL, for example a CDN) overrides derivation; a **set but invalid** value fails safe to "Map unavailable" and never falls back to another host. There is no customer `.env.example` file and none was created.
- **HTTPS versus cleartext:** production must use HTTPS. A plain `http://` API or archive URL is a development convenience only; the Customer manifest does not enable cleartext traffic, and Android 9+ blocks it by default, so an `http://` URL on a device depends on toolchain and manifest configuration that was not exercised here (the Android build is blocked, §16). Native MapLibre reads the archive over HTTP(S) only (`pmtiles://asset://` is unsupported) and does not cache PMTiles, so every viewer session makes range requests to the API.
- **No API keys** exist anywhere in this setup: no Google Cloud project, no map key in any manifest or `.env`.
- **Fallback:** OpenFreeMap (`https://tiles.openfreemap.org/styles/positron` or `liberty`), free with no key and no stated request limits, requiring the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". It has **no SLA** (its operator says he offers none and its terms allow discontinuation without notice); its schema differs from Protomaps', so a style is never mixed with the other's tiles. Swap procedure: setup document §10.
- **Rejected tiers:** MapTiler's free plan and Stadia Maps' free tier are restricted to non-commercial use, so neither is usable for a delivery service.
- **Cadence:** the archive is a point-in-time snapshot; the setup document suggests a rebuild every 3 to 6 months. Reverse-proxy or CDN Range behaviour and a real `docker build` are unverified.

---

## 11. Files changed

`git diff --stat 93d7992..b11300b` (code and tests, before this documentation pass): **134 files, +14,097 / -70; 98 added, 36 modified.** 37 commits.

| Group | Files | Detail |
|---|---|---|
| Backend | 25 (+1,584 / -0) | migration 006 (up/down); `database/types.ts`; `modules/riders/` (schema, service, repository, controller, index); `modules/orders/` (`order.location.controller.ts`, repository, index); `modules/realtime/location-stream.ts`; `modules/map-tiles/index.ts`; `app.ts`, `server.ts`, `config/env.ts`, `utils/metrics.ts`; `Dockerfile`, `.env.example`; `map-tiles/README.md` and `blynk-service-area.pmtiles` (binary); tests `rider-location.test.ts`, `location-stream.test.ts`, `map-tiles.test.ts`, `deployment.test.ts` (additive) |
| Rider app | 71 (+3,486 / -32) | 53 generated Capacitor Android project files under `apps/rider/android/`; `capacitor.config.ts`; `package.json`/`package-lock.json`; `src/lib/` (`tracking-plugin.ts`, `tracking.ts`, `tracker-session.ts`, `delivery.ts`); `src/components/TrackingStatus.tsx`; `src/pages/Delivery.tsx`, `Queue.tsx`; `src/api/resources.ts`; `src/styles.css`; 6 test files |
| Customer app | 36 (+8,235 / -38) | `Assets/map/blynk_map_style.json`; 14 `lib/` files (models, `location.provider.dart`, 2 location-source files, map contract/adapter/tile-config/marker-logic/order-tracking-map, picker screen, order summary and address form edits, `main.dart`); Android manifest and iOS plist; `pubspec.yaml`/`pubspec.lock`; 3 regenerated desktop plugin registrants (side effect of adding `geolocator`); 12 test files plus a fixtures file; the live integration test |
| Docs | 2 (+792) | `map-tile-hosting-setup.md`, `rider-background-tracking-device-verification.md` (before this pass, which adds this report, the Customer Android build note, and edits to the status document, runbook, tile setup document and plan) |

Not part of this phase's commits, and untouched by it: the five uncommitted `apps/customer/.../android/*.gradle*` files (§16.1) and the `graphify-out/` tool output.

---

## 12. Testing

Backend counts are from the final-review fix wave (as of `952e3f5`); the rider and Customer counts are as recorded by the controller's final regression at Task V1a (after `b11300b`) and Task M7 and were not re-run in the fix wave (no rider `src` or Customer file was changed by it).

| Suite | Result | Baseline at `93d7992` |
|---|---|---|
| Backend `npm test` | **779 tests, 34 files, all passing** (was 767 / 32 before the fix wave: +12 tests, +2 files) | 707 tests, 29 files (+72 tests, +5 files) |
| Backend `npm run test:hygiene` | same 779 / 34 files, then "DB HYGIENE OK - every row of every table is identical to before the run" | — |
| Backend `typecheck` and `build` | clean | — |
| Rider `npm test` | **108 tests, 7 files** | 49 tests, 4 files (+59) |
| Rider `tsc --noEmit`, `npm run build` | clean | — |
| Customer `flutter test` | **524 tests** | 291 (+233); progression 291 to 329 (M1/M2), 398 (M3), 451 (M4), 487 (M5), 524 (M6) |
| Customer `flutter analyze` | **No issues found** | — |

### 12.1 Backend additions
`rider-location.test.ts` (write path: window, ownership, roles, malformed input, future and stale timestamps, duplicate/out-of-order, TOCTOU concurrent write, rate floor, every closed state, cancelled order, re-stage, 5-repetition concurrency), `location-stream.test.ts` (broadcaster units and the HTTP stream: initial snapshot, 401/403/404, close on arrival via the real 15 s heartbeat, refusal of a closed order, heartbeat-versus-disconnect race), `map-tiles.test.ts` (HEAD, 206, suffix range, 416, 304, no compression, 405, traversal, SHA-256), `deployment.test.ts` additions (Dockerfile copies the archive with non-root ownership, `.dockerignore` does not exclude it).

Final-review fix wave additions: `delivery-payload-privacy.test.ts` (6 tests: a deep key scan of every delivery-carrying response while the delivery holds a stored point, plus a test that every `deliveries` column is classified public or location), `request-log.test.ts` (2), three m2 tests in `location-stream.test.ts` (database failure on connect, through the real error middleware, disconnect during the connect query) and one accuracy-bound test in `rider-location.test.ts`.

### 12.2 Existing tests unchanged
In the backend, every pre-existing test file is untouched except `deployment.test.ts`, which only gained lines (`+30 / -0`); across all backend test files the diff has zero deletions. `order-lifecycle.test.ts`, `order-lifecycle-guard.test.ts`, `order-lifecycle-catalogue.test.ts`, `rider-delivery.test.ts`, `security.test.ts` and the rest passed at the same counts as before (B5, then V1a). One pre-existing timing-dependent test was observed to fail once: `order-lifecycle.test.ts`, "pack ∥ customer cancel" (it asserts an interleaving order of two racing promises); the B2 implementer reproduced the identical failure on the untouched baseline after stashing, and it passed in the following full run. On the client apps some existing tests were edited, all recorded in the ledger: rider import lines; the R3 coordinate-secrecy test was rewritten to a stricter condition (tracking genuinely active) and mutation-proven; the RG-a assertion "stops tracking when a failure is reported" now expects `start` once on mount (restart-resume) while still asserting `stop` after the failure. Customer `order_detail_screen_test.dart` and `order_model_test.dart` gained tests; the detail test's pump helper gained an optional `LocationProvider` parameter (its old inline provider wrapper was refactored, existing tests unchanged).

### 12.3 Regression-proof and review checks (attributed)
- **Implementer mutation checks (each made the suite fail, then reverted):** M3 removed the generation guard, monotonic guard, 64 KB buffer cap, `receiveTimeout` override, `cancelToken.cancel()` in the opener, backoff reset, made `closed` always terminal, removed the jitter clamp; M5 re-watch-on-every-refresh, ignoring the background flag, removing the close guard; R3 an injected coordinate leak into `TrackingStatus`; RG-a disabling the `syncTracking` effect (seven delivery tests fail).
- **Reviewer verifications:** B2 (TOCTOU race found and fixed with a test proving the newer point wins regardless of completion order), B4 (heartbeat-versus-disconnect race found and fixed, commit `28fb1e6`), R2 (permission-bridge claim checked against installed plugin sources), R3 (render-gate deviation traced through the state machine), M0a (SHA-256, bbox margin, style bindings, `gl-style-validate` exit 0, three doc claims re-fetched), M0b (ran the real app and observed HEAD/206/416/304 with `curl`), M4 (read `maplibre_gl` 0.25.0 source for the `MapLibreMap` parameters and annotation API), M5 (isolation guard extended and shown to catch an injected violation), M6 (`geolocator` isolation guard mutation-verified).

### 12.4 Live pipeline E2E (no device)
`apps/customer/.../integration_test/live_location_tracking_flow_test.dart`, run on the Windows desktop target against a real backend and real PostgreSQL over real HTTP/SSE, driving the real customer `LocationProvider`.

- **Result of the final re-run (after the review fix round):** 10 scenarios passed, 0 failed, 1 skipped, about 2 minutes. Baseline before/after compared identical on every strict table and inventory row (advisory `refresh_tokens` grew 249 to 252), backend stopped afterwards.
- **Scenarios:** S1 setup; S2 not trackable before pickup; S3 exact coordinate round trip A to B and a fresh watcher's snapshot equals the stored latest; S4 duplicate, out-of-order, older, rate floor, future all leave the provider unchanged; S5 twelve malformed bodies plus non-UUID ids give 400; S6 authorization matrix (second customer's stream is `unavailable` after a raw 404; no token 401; RIDER and ADMIN on the stream 403; CUSTOMER, second customer and ADMIN on the rider POST 403; no token 401); S7 arrival closes the stream, the POST is 409, a new watch closes again with no point served; S8 failed then re-stage then a new delivery id, the old point never re-appears; S9 closed matrix (cancelled after assignment, customer cancel refused on the road with 400 `ORDER_ALREADY_OUT_FOR_DELIVERY`, customer-unavailable closes); S10 an abrupt backend kill and restart is not terminal: the provider keeps its last point, ages LIVE to STALE, reconnects with backoff and receives new points.
- **Skipped:** 6b "a second rider POSTs to the first rider's delivery". The seed has exactly one rider and no API route creates riders, so no second RIDER account can sign in through the real flow. Covered by `rider-location.test.ts` (foreign delivery gives 404, no write, no broadcast).
- **What it proves:** the transport and authorization pipeline end to end: the real rider write API, the real database, the real SSE stream and the real client provider state (`current`, `freshness`, `closed`, `unavailable`), including tokens, close semantics and re-stage identity.
- **What it does NOT prove:** any GPS, background or lock-screen behaviour, permissions, airplane mode, OS location toggles or app-restart recovery on a device; any UI, marker or map rendering (no map or widget is built in this test); the graceful `server_shutdown` frame end to end (Windows cannot deliver SIGTERM to another process, so only an abrupt drop was exercised; the frame is covered by provider unit tests only); the second-rider check; the Android build. Synthetic coordinates were test inputs, not GPS.
- The controller's E2E harness scripts live outside the repository, per the existing convention.

A read-only design audit (task V1c) was dispatched in parallel with this documentation pass. Its findings, and any fix wave that follows, are not reflected in this report.

---

## 13. Security review summary

| Concern | Enforcing code | Tests |
|---|---|---|
| IDOR, cross-rider write | `findTrackableDelivery(deliveryId, rider.id)` joins on the caller's own `rider_id`; not found or not yours gives the same 404, never 403 | `rider-location.test.ts` "rejects another rider submitting to this delivery (404, not 403)"; live S6b skipped (§12.4) |
| Role and auth | `requireAuth` + `requireRoles('RIDER')` on the write, `requireRoles('CUSTOMER')` on the stream; active rider profile check | "rejects a customer or unauthenticated caller"; `location-stream.test.ts` 401 and 403 cases; live S6 |
| Cross-customer leakage | `findOrderById(orderId, req.user.id)` 404 at connect; `findTrackableLocationForCustomer` filters `orders.customer_id` and is re-run, ownership included, every heartbeat; 404 for both "absent" and "not yours" | "a second customer cannot open the first customer's stream (404)"; live S6 |
| Old-delivery leakage (re-stage) | trackable predicate is per delivery row (PICKED_UP + OUT_FOR_DELIVERY, read fresh); `uq_deliveries_active_assignment` | "re-stage creates a new delivery; the old FAILED delivery never accepts a location again"; live S8 |
| Replay and out-of-order | conditional `UPDATE ... location_captured_at < $new` (atomic, serialized by the row lock); `not_newer` never regresses the stored point or broadcasts | duplicate/out-of-order test; "an older write that commits after a newer one ... (TOCTOU)"; live S4 |
| Timestamp abuse | 60 s future rejection (400); ISO 8601 required by Zod; points older than 5 min stored but not broadcast; client monotonic guard | "rejects a captured_at far in the future, accepts one only slightly stale"; live S4, S8 |
| Coordinate injection | Zod range checks, DB `CHECK` constraints, Kysely parameterised queries, `NUMERIC` columns; unknown body keys stripped; client parser drops out-of-range or non-finite values | "rejects malformed and out-of-range coordinates"; live S5 (12 bodies) |
| Rate / flood | per-delivery 5 s floor (soft under a race, by design); client-side 9 s / 25 m throttle | "high-frequency submissions are throttled server-side" |
| Exposure after closure | write refused with 409 on every closed state, including a cancelled order whose delivery row stayed `ASSIGNED`; stream closes within one 15 s heartbeat; no location frames can follow because writes are refused first | "rejects a location once arrived, delivered, or failed - every closed state"; "rejects a location for a cancelled order ..."; "closes the stream once the delivery arrives"; live S7, S9 |
| Concurrency | single conditional `UPDATE`, no explicit transaction; heartbeat re-checks `closed` after its await | "concurrent writes ... (5 reps)"; the B4 race fix |
| Lifecycle integrity | the write path never imports `lifecycle/`; only the five location columns are touched | B5 grep; existing lifecycle/guard tests unchanged and green |
| Rider location secrecy in the rider UI | `TrackingStatus` renders fixed copy and a relative time only | coordinate-secrecy test under active tracking, mutation-proven |
| Public tile route | serves only `.pmtiles`; read-only; no directory listing; traversal 403/404 | `map-tiles.test.ts` |
| Rider location in staff/admin payloads (final review I1, fixed) | `findOrderById` selected `selectAll('deliveries')`, so `GET /admin/orders/:id` and the admin status-update and resolve-item responses carried the five location columns (plan §D.6 has no admin location surface); `assign-rider` returned the whole inserted row with the keys present as null. Fixed with an allow-list, `DELIVERY_PUBLIC_COLUMNS` (`orders/delivery.columns.ts`), used by that query and, through `toPublicDelivery`, by the assign response. Only `writeLocation` and `findTrackableLocationForCustomer` name the location columns. The rider's own queries were already explicit column lists. | `delivery-payload-privacy.test.ts`: deep key scan of admin detail (admin and staff), admin list, packing queue, `/admin/riders`, assign-rider, admin status update (terminal delivery still holding its point), customer detail, list and cancel, the rider's list, detail, status step, COD settlement and the location-write response; and "every deliveries column is classified exactly once", which fails when a new column is added until someone classifies it, so a future column cannot silently leak again |
| Android backup of the rider session (final review I2, fixed) | the rider APK now has `android:allowBackup="false"` and `android:dataExtractionRules` (`res/xml/data_extraction_rules.xml`) excluding cloud backup and device transfer; the Android docs say `allowBackup="false"` alone may leave device-to-device transfer on Android 12+ on some devices, which is why the rules file exists. The 30-day refresh token still lives in WebView localStorage; moving it to secure native storage is a follow-up decision | merged manifest verified (`processDebugMainManifest`): `allowBackup="false"` and `dataExtractionRules="@xml/data_extraction_rules"`; no automated test |
| Accuracy overflow (final review m1, fixed) | `accuracy` is capped at 100,000 m in `rider.location.schema.ts` (the column is NUMERIC(7,1), max 999999.9; an overflow was a Postgres error and a 500, and `1e999` parses to Infinity) | "bounds accuracy": 1e7, 100000.5, 1e21 and raw `1e999` give 400 VALIDATION_ERROR; 100000 is accepted and stored |
| SSE double response on a database error (final review m2, fixed) | the trackable query now runs before the SSE headers are written, so a failure is an ordinary JSON 500 from the error middleware; the close handler is registered before the first await so a client that leaves mid-query is never subscribed; a failure after the headers ends the stream once | `location-stream.test.ts` "database failure on connect" (3 tests) |

Gaps observed in the code and not covered by the ledger's rulings (stated so nobody assumes otherwise): there is no per-IP or per-user HTTP rate limiter on the write endpoint beyond the per-delivery 5 s floor (the only rate limiter in the API is an in-memory limiter in the auth service), and there is no cap on concurrent SSE connections per user or per order (see §16.3, I4).

---

## 14. Physical-device verification: BLOCKED/PENDING

**No physical Android device and no emulator were available** (`adb devices -l` and `emulator -list-avds` were both empty when checked at Tasks R1 and RG). An emulator would in any case not exercise real Doze and OEM battery behaviour and is not an acceptable substitute for this gate. The gate (plan Task RG) therefore has **not** passed. Nothing below is claimed as verified.

The executable checklist is the runbook, [`rider-background-tracking-device-verification.md`](../06-deployment/rider-background-tracking-device-verification.md); every box in it is unticked and its status banner is BLOCKED/PENDING.

**Unrun scenarios (S1 to S21):**

| # | Title in the runbook |
|---|---|
| S1 | Sign-in, order walked to PACKED and assigned |
| S2 | Pick up, tracking starts ("Sharing your location") |
| S3 | Lock the screen |
| S4 | Move for at least 5 continuous minutes (one 60-minute run for OEM risk) |
| S5 | Backend keeps receiving updates the whole time the screen was locked |
| S6 | Customer SSE receives moving coordinates |
| S7 | Arrived, `event: closed`, further POST 409 |
| S8 | App backgrounded (not locked) |
| S9 | Network disconnected (airplane mode) mid-delivery |
| S10 | GPS / location services disabled at OS level mid-delivery |
| S11 | Permission denied at first ask, then revoked mid-session |
| S12 | Stale location (stop sending for several minutes) |
| S13 | Rider app killed and restarted mid-delivery |
| S14 | Failed delivery |
| S15 | Failed, re-stage, new delivery, new tracking session |
| S16 | Out-of-order timestamps (device/manual) |
| S17 | Duplicate updates (device/manual) |
| S18 | Unauthorized rider / customer (device/manual) |
| S19 | Malformed coordinates / IDs (device/manual) |
| S20 | Location POSTs keep arriving beyond 5 minutes in the background with the screen locked (`CapacitorHttp`) |
| S21 | Tracking survives access-token expiry while backgrounded |

Also unrun: the release-build spot-check (release builds are unsigned and need a local throwaway signing key) and runbook open items O-1 and O-2. The API-level rules behind S16 to S19 are covered by the automated suite and the live pipeline test (§12), but the device and network-level versions remain pending.

**Specific device-only open items:**
1. **Implicit permission bridge** (O-1): whether `checkPermissions()` / `requestPermissions()` exist at runtime on the plugin. If absent the adapter swallows the error and reports `unavailable`, and tracking never starts.
2. **Tracker stays bound to the id if `plugin.start` (or `requestPermission`) throws** (O-2, RG-a deferred minor): `deliveryId` stays bound with `active = false`, so syncs skip a restart until the screen remounts.
3. **`POST_NOTIFICATIONS`:** never requested; whether the foreground-service notification is visible on Android 13+ with no manual grant.
4. **Plugin issue #153:** a first-prompt `SecurityException` starting the location foreground service on Android 14 to 16; must be observed on a fresh install.
5. **`CapacitorHttp` beyond 5 minutes locked (S20):** unverified. If updates stall near minute 5 while the service is alive, the mitigation is not effective.
6. **Access-token expiry while backgrounded (S21):** rider access tokens expire after 15 minutes (`JWT_ACCESS_EXPIRY=15m`); updates must cross that expiry and the single-use refresh rotation.
7. **Native `fetch` ignores `AbortSignal`:** a hung request or refresh cannot be cancelled by the client's 15 s timeout on Android; there is no in-flight guard, so this is watched as part of S21.
8. Other risks the runbook records: OEM battery killers, notification icon behaviour (issue #135), the 60-minute stop reported in issue #126.

**Customer-side device verification is also entirely pending, and no customer device runbook exists.** Never seen on a device: the map rendering, the style loading, PMTiles range reads over the network, gestures inside the scroll view, the native attribution button, the address picker with a real permission prompt and a real fix, and whether the `maplibre_gl` and `geolocator` native modules compile at all (§16.1).

---

## 15. Deviations from the approved plan and rulings made during execution

Quoted from the ledger's `Ruling:` lines and task records; each states what changed and why.

1. **Branching.** Work went directly on `main`, no worktree or feature branch, following the repository's established convention (prior phases were committed and pushed straight to `main`).
2. **Execution order B2 and B3 swapped** (order became B1, B3, B2, B4, B5). Task B2's brief imports `broadcastLocation` from the module Task B3 creates, so B2 could not compile first. Pure build-order fix; no content change.
3. **R3 render gate.** The brief rendered `<TrackingStatus>` at `stage(d) === 2`. The implementer used `canReportFailure(d)`, and the reviewer traced `delivery.ts` to confirm it is correct: `stage() === 2` is `ARRIVED_AT_CUSTOMER`, when tracking has already stopped, so "Sharing your location" would have been unreachable, while `canReportFailure` equals the binding window (PICKED_UP or ARRIVED, order OUT_FOR_DELIVERY). RG-a later refined the gate to `isTrackable(d) || canReportFailure(d)` so the "Stopped sharing your location" confirmation stays reachable.
4. **TrackingStatus permission, unavailable and send-failed states added** (R3 fix rounds). The brief's verbatim code rendered nothing on `permission_denied` or a network failure, but plan §13 requires the rider to see "Location permission needed" and the user's must-test list names permission denied/revoked/network loss. The spec is the binding authority, so this was fixed as a real gap (commit `dcf0835`), and the silent `unavailable` permission state was closed in a second round (`3b2cdd3`) as the same class of silent failure.
5. **Task RG-a inserted (session/singleton, `isTrackable`, 409/404 stop, Queue sync).** R3's wiring stopped device tracking only on the rider's own arrive and fail taps and started only on the pickup tap with a per-mount tracker. That violated plan §D.2 (stop on every terminal), the restart-resume requirement (RG step 13) and the "never keep an old delivery id" rule. Fix: an app-level tracker singleton plus `syncTracking(delivery)` on every load and revalidation; a dedicated `isTrackable()` (narrower than `canReportFailure`); a server-authoritative stop on 409. Review round 1 found four Important issues, all fixed: a non-trackable other delivery stopped in-window tracking of the tracked one; no stop on a terminal 404; cold-start on the Queue never resumed; the "Stopped sharing" confirmation became unreachable. The tracker follows ONE delivery at a time (documented limitation).
6. **RG-b: `CapacitorHttp` enabled.** The RG research found that the rider's WebView `fetch()` is throttled after about 5 minutes in the background. Enabling the official Capacitor core setting (no new dependency) was ruled the fix (commits `c72b6b9`, `8fc1930`); the runbook gained S20, cleartext notes and the POST_NOTIFICATIONS caveat, and the controller added S21 (`20feaaa`). Other RG findings were carried to this report rather than fixed.
7. **RG's "stop and request a physical device; do not skip ahead to M0" superseded.** The user's later explicit instruction ("if a physical Android device is unavailable in the environment, do NOT pretend this requirement passed. Mark it clearly as BLOCKED/PENDING and continue with automated tests where appropriate") governs. Physical scenarios stay BLOCKED/PENDING, everything automatable proceeded, and the feature is not declared production-ready.
8. **M0 split into M0a and M0b.** The plan's file structure lists a backend map-tiles route and a `.pmtiles` artifact, and the user's final instruction requires verified PMTiles tooling and Range-capable serving, but no task created either (M0 was documentation only). M0a verified the official tooling, built the extract, chose and bundled a style and wrote the setup document; M0b added the backend route, caching headers, tests and Docker inclusion. As built, the route lives in `backend/api/src/modules/map-tiles/index.ts` and the archive in `backend/api/map-tiles/blynk-service-area.pmtiles`, not at the plan's placeholder paths (`src/routes/map-tiles.ts`, `src/map-tiles/dharga-town.pmtiles`).
9. **Max zoom 15, not 16.** z15 is the highest zoom in the Protomaps v4 basemap, so the plan's z16 was unattainable; over-zoom keeps the map sharp.
10. **M3 additions beyond the plan's interface.** The plan's `LocationProvider` exposed `current`, `freshness`, `closed`, `watch`, `stopWatching`. The implementation added a periodic freshness tick, `unavailable`, a `now` clock, reconnect with backoff, a monotonic guard and reason-aware `closed` handling. The ledger's rulings on the last two are review-driven: the first review found a **Critical** defect (every `event: closed` was treated as terminal, so every deploy's `server_shutdown` would have killed all customer live maps permanently) and an Important one (backoff reset on any frame, allowing a 1 Hz retry loop with no jitter). Both were fixed with jitter, a minimum-healthy-duration reset, abort-on-cancel and re-entrancy fixes (commit `9bf4aa6`). The reconnect-retains-last-point limitation was ruled a known limitation rather than a contract change (§16).
11. **`geolocator` moved from M4 to M6**, so no dependency sits unused between tasks; M4 added only `maplibre_gl`.
12. **Task T (Android toolchain upgrade) inserted, then NOT executed at the user's direction.** The controller proposed a scoped Gradle/AGP/Kotlin upgrade for the Customer app because `maplibre_gl` needs JDK 21, AGP 8.13.2, Kotlin 2.1+ and compileSdk 36 while the app had Gradle 7.5, Kotlin 1.7.10 and Java 8. The user rejected it. Consequently the Customer Android build remains blocked and the map's Android behaviour is unproven. The plan's own M7 says such a gap should be reported, not silently worked around.
13. **M5 additions.** The order screen also stops watching on background and refetches on resume; a one-shot order refetch was added when the stream reports `closed`; M4's style-reload bookkeeping fix and the wider isolation guard were folded in. **No polling** was added (out of plan scope; decision for the user).
14. **Discovery of five uncommitted Customer `android/*.gradle*` modifications** (a migration to the current Flutter Gradle template: Gradle 9.3.1, plugins DSL, JVM 17, `newDsl`/`builtInKotlin` flags), the user's own uncommitted work. Ruled: do not revert, edit or commit them; every later task stages files explicitly; the M7 build check was run without modifying them (sha256 identical before and after).
15. **V1 restructured to a live pipeline test.** The plan requires every location step to come from a real device. None exists, so all device scenarios stay BLOCKED/PENDING and only the pipeline that can honestly run without a device was run (V1a: real backend, real database, real provider; synthetic coordinates labelled as test inputs). The review fix round (I1 exact 400 status, M1 removal of UI/marker wording, M2 error codes, M3 close-latency bound, M4/M5 wire-level counting) left M6, M7 and M9 deferred.
16. **Manual brief extraction.** The controller's task-brief script regex does not match alphanumeric task ids; all 19 briefs were extracted manually with an equivalent pass (no content change).

---

## 16. Known limitations, open items and decisions for the user

### 16.1 Blockers
- **Customer Android build is BLOCKED.** `flutter build apk --debug` (JDK 21 from Android Studio's bundled JBR) fails with `Execution failed for task ':flutter_native_splash:checkDebugAarMetadata'`: `flutter_native_splash` 2.4.4 (a dev dependency, unpinned in `pubspec.yaml`) hard-codes `compileSdkVersion 31` in its `android/build.gradle`, while the AndroidX dependencies on the classpath (fragment 1.7.1, window 1.2.0, core 1.13.1, lifecycle 2.7.0 and more, over twenty items) require compileSdk 33 or higher. Verified with the user's uncommitted Gradle-template migration files present and unmodified (sha256 identical before and after the build). Options: (a) `flutter pub upgrade flutter_native_splash` to a release whose Android module targets a modern compileSdk; (b) a root-level `android/build.gradle` `subprojects { afterEvaluate { ... compileSdk = 36 } }` override. Neither was applied. The release build was not attempted (debug fails first). Details: [`customer-android-build-status.md`](../06-deployment/customer-android-build-status.md).
- **`maplibre_gl` and `geolocator` native modules are not proven to compile**: Gradle stopped at the first failing module.
- **The five uncommitted `android/*.gradle*` files** are the user's own work in progress, are not part of this phase's commits, and their commit is the user's call.
- **Release signing still uses the debug key** (a pre-existing TODO in the Customer `android/app/build.gradle`: "Signing with the debug keys for now"). The Rider release build is unsigned (no signing config exists, no keystore created).
- **Physical-device verification** of everything in §14.

### 16.2 Decisions for the user
1. Approve a dedicated, separately-reviewed Customer Android toolchain and dependency fix (which option in §16.1), and decide whether to commit the five uncommitted Gradle files.
2. Whether the Customer order screen should poll or refresh on a timer to learn that an order became `PICKED_UP`; today it only learns on resume, pull-to-refresh or after a cancel attempt.
3. Whether to add a `POST_NOTIFICATIONS` runtime request in the Rider app (new dependency such as `@capacitor/local-notifications`), and whether to remove the unneeded `ACCESS_BACKGROUND_LOCATION` after a device run.
4. Whether to budget a commercial background-geolocation plugin (Transistorsoft, as in plan §1.3) given the community plugin's maintenance status, once a device run exists.
5. Whether to fix the `CapacitorHttp` abort problem (race `fetch` against an abort promise, or pass timeouts through `CapacitorHttp.request`); suggested follow-up from RG-b.
6. Who owns the tile-archive rebuild cadence (suggested every 3 to 6 months).
7. Whether a customer-side device runbook should be written.
8. **I3, retention of the last real GPS point.** The last accepted point of every delivery stays on `deliveries` indefinitely: nothing clears it on delivery, failure or cancellation. Over time that is a de-facto sparse location history (the final point of every delivery), in tension with the "latest location only" intent. Options: (a) null the five columns on the terminal transition, which touches the lifecycle path and is therefore outside this phase's rule of never touching `modules/orders/lifecycle/*`; (b) a retention job that nulls the columns some days after a delivery closes; (c) accept and document it. Not implemented. DECISION FOR THE USER.
9. **I4, no per-user SSE connection cap.** Recommended: 3 to 5 concurrent streams per user, tracked with a `Map<userId, count>` in `subscribe()`, rejecting the excess with 429. Not implemented because it adds unplanned client-visible semantics (the Customer app would need to handle a 429 on connect).
10. **H2, the address form pre-fills the hub coordinates.** An address saved without tapping "Use my current location" therefore puts the tracking destination pin at the hub. This is a pre-existing default, not a regression of this phase. Needs a product decision: require an explicit location, label the default so the customer sees it is the hub, or keep it.

### 16.3 Known limitations
- **Single-container, in-process SSE fan-out.** The subscriber registry is per process. The documented requirement: before the API is scaled to more than one replica, move to a shared bus (Redis pub/sub or Postgres `LISTEN/NOTIFY`). Not built.
- **No per-user SSE connection cap (I4, see §16.2), and no rate limiter on the write endpoint beyond the 5 s per-delivery floor** (observed in the code; see §13).
- **Last GPS point retained indefinitely (I3, see §16.2).** A sparse location history of one point per delivery accumulates on `deliveries`.
- **Address form defaults to the hub coordinates (H2, see §16.2).**
- **Offline device GPS window.** The rider device stops tracking only on a server 409/404, a screen sync or a queue load. If the network is lost just as the trackable window closes (the delivery arrives, fails or is cancelled), the foreground watcher keeps collecting points, without sending them, until connectivity or a foreground sync returns and the next write is refused. Nothing reaches the server meanwhile.
- **Rider session token still in localStorage.** The APK now opts out of Android backup and device transfer (`allowBackup="false"` and `dataExtractionRules`; see §13), but the 30-day refresh token remains in WebView localStorage. Moving it to secure native storage is a follow-up decision. E2E artifact directories and ops session files also hold refresh tokens and must live outside the repository (runbook §1.5).
- **Admin/staff payload location leak: found in the final review and fixed (I1).** Regression is guarded by `delivery-payload-privacy.test.ts` (see §13): an allow-list of delivery columns, a deep key scan of every delivery-carrying response, and a test that fails until any new `deliveries` column is classified public or location.
- **Address picker uses Google Play services *Location*, not Google Maps.** `geolocator_android` 5.0.3 pulls `play-services-location` 21.2.0; it needs no API key. `AndroidSettings(forceLocationManager: true)` would avoid Play services entirely and is not used. The merged Android manifest also gains a location-type foreground-service declaration, relevant to Play Console declarations. `geolocator_android`'s own buildscript declares AGP 9.0.1, which may interact with the user's Gradle upgrade (§16.1). See §8.
- **The tracker follows ONE delivery at a time.** If a rider ever holds two simultaneous `PICKED_UP` deliveries only one gets live location (the list sync deterministically prefers the one already tracked, else the first in API order). The tracking readout is global state, so a Delivery screen for delivery Y can show "Sharing" while X is tracked.
- **Customer screen learns `PICKED_UP` only on resume, pull-to-refresh or after a cancel** (no polling).
- **Reconnect retains the last point and stream events carry no delivery id.** After a disconnect during a re-stage the retained old point stays only until it ages to OFFLINE (about 2 minutes), dimmed as STALE, and the order-status gate hides the map once the order leaves `OUT_FOR_DELIVERY`/`PICKED_UP`. Fixing it would need a delivery id in the SSE event (a contract change outside the approved plan).
- **Style-load and tile failures are silent at runtime** (no watchdog); "Map unavailable" covers configuration, asset and substitution failures only.
- **Plugin effectively unmaintained** (last release 2025-08-28; upstream issue #156 with Capacitor 8). The 7.6.9 pin is safe today.
- **The tile archive is a point-in-time snapshot** that needs manual rebuilds.
- **Reverse-proxy and CDN Range behaviour and a real `docker build` are unverified.**
- **iOS is not scoped or verified** (no Capacitor iOS project; the Customer app's iOS plist string is present but unexercised).
- **No admin live map**, by design. **No ETA, route or geocoding**, by design.
- **Label-free map style**, by design (§9).
- **Native attribution button cannot be hidden** and duplicates the overlay; the overlay is not a hyperlink.
- **Effective reconnect ceiling is about 36 s** (30 s cap plus 20 % jitter); the plan does not state a number.
- **One unexplained transient backend test failure.** (The fix wave's full `npm test` and `test:hygiene` runs, 779 tests each, both passed with no failure.) The ledger records it verbatim: "1 of 767 backend tests failed once in one `npm test` run during V1a's regression (failing test not recorded; did not recur in two full re-runs nor test:hygiene; vitest fileParallelism is false so the 'parallel files' guess is wrong; timing-sensitive candidates: rider-location (5.1s floor), location-stream, rider-delivery, stock-ledger pg_sleep, notifications/outbox tests) — if it recurs in final verification capture full output." It has not been identified, so it is unexplained; capture the full output if it recurs.

### 16.4 Discrepancies found between the ledger/docs and the code, and other notes
- The V1a report's header says "12 tests incl. 6b", but the raw log and the test file show 11 test cases (10 passed, 1 skipped). This report uses the log.
- A code comment in `apps/rider/src/lib/tracking-plugin.ts` still reads "HIGH RISK, MITIGATED" although the ledger's deferred minor asked for "MITIGATED IN CONFIG (unverified)". Docs-only pass; not edited here. The runbook and this report state that it is unverified.
- The tile setup document's status line still said the Flutter provider "is implemented in a later task", and two passages still called the minimum `maplibre_gl` version UNVERIFIED; both are superseded (update note added in this documentation pass).
- The runbook's S12 said "no customer UI exists yet"; it does now (updated in this pass).
- The plan's file-structure paths for the tile route and archive differ from what was built (§15, item 8).

### 16.5 Deferred minors (see the ledger for full text)
Fixed in the final-review wave: tile range requests are no longer written to the access log on success (`utils/request-log.ts`, `pino-http` `autoLogging.ignore`; errors are still logged by the error middleware; the http metrics middleware only increments counters and never logs, so it did not flood and was not changed). The predicate is unit-tested; the `pino-http` wiring itself is skipped when `NODE_ENV=test`, so it is not exercised end to end.

Categories, not a full list: **Rider** (`@capacitor/cli` in `dependencies`; `watcherId` module-scoped; `mapPermissionState` collapses two prompt states; `canReportFailure` couples two gates); **Backend** (map-tiles error handler labels non-404/416 4xx as `BAD_REQUEST`; a 416 still carries cache headers; no test for a missing `MAP_TILES_DIR`; cwd-relative resolution; weak-ETag `If-Range` returns 206); **Customer provider/model** (date parsing does not range-check seconds; no lat/lng range check in `_optionalDouble`; a bare `\r` SSE terminator is not handled; pause during connect not honoured); **Customer map** (style-reload race with an in-flight marker add; circle removal forgets the entry before awaiting; no `Semantics` label; an order id change on the same widget is unhandled today but unreachable; the SSE watch stays open if another route is pushed over the detail screen); **Picker** (camera-to-callback plumbing untested because it is a platform view; timeout copy shown for generic errors; no auto re-check on return from Settings; accuracy not surfaced; a duplicate attribution chip and an import cycle to `order_tracking_map.dart`); **Live E2E** (equal-`captured_at` different-coordinate, the 59 s future boundary and a concurrent write race are covered by backend tests only; a tiny manifest leak window; `capturedAt` fixed at point construction).

---

STATUS: LIVE LOCATION & DELIVERY TRACKING IMPLEMENTED AND AUTOMATED-TESTED — PHYSICAL ANDROID VERIFICATION PENDING; NOT PRODUCTION-READY
