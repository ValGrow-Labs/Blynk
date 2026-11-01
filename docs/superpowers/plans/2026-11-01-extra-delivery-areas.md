# Extra delivery areas (Beruwala only) instead of a bigger radius (contract)

Owner's brother, 2026-11-01 (voice notes): "I don't want the radius to be increased - if I increase the radius it grows on the whole side, from the
Bentota side too. We have to include Beruwala only."  A bigger circle is wrong. The delivery area must be: **the existing circle around the Blynk
store (radius_km, 4 km, unchanged) PLUS extra zones**, the first one being **Beruwala**.

Decisions of the lead:
* An extra zone is a circle: `{ id, name, lat, lng, radius_km, enabled }`, at most 10, stored as one JSON setting (no migration):
  `system_configurations` key `delivery_zones` = `{ "zones": [ ... ] }`. **Default when no row is stored**:
  `[{ id: 'beruwala', name: 'Beruwala', lat: 6.4759, lng: 79.9842, radius_km: 3, enabled: false }]` (so the owner just switches it on;
  Beruwala town centre from the customer app's own place list; 3 km keeps it clear of Bentota, which is ~7 km south of it).
* An address is deliverable when it is inside the store radius **OR** inside any **enabled** zone. Everything else (fee measured by road distance from the
  pickup point, rider pay, seller pickups) stays exactly as it is; a Beruwala order simply has a longer distance (so a higher fee under the existing rule).
* The store `radius_km` setting stays what it is (4); nothing in this change touches it.

Five builders work in parallel on separate areas; **never edit another builder's area; do not commit or push**. Preserve each file's line endings
(Read then Edit). Run `npx tsc --noEmit` and the whole test suite of each app you touch (`npx vitest run --testTimeout=120000` for the apps;
backend builder: only the relevant test files plus `npx tsc --noEmit`). A failure that passes when that file is re-run alone is a load timeout: say so.
Node modules are installed for backend/api, apps/customer-app, apps/admin, apps/operations.

---------------------------------------------------------------------------------------------------------------------
## B. Backend (`backend/api`) - builder B

* `modules/configuration/delivery-zones.ts` (new; pattern: `delivery-radius.ts` / `cart-rules.ts`): types, zod schema (name 1..40 chars, lat 5..10 and lng 78..83 =
  Sri Lanka box, radius_km 0.5..15 with at most 2 decimals, id = slug of the name unique within the list, max 10 zones, `enabled` boolean), tolerant reader
  (malformed row = the default), `get`, `set` (audited `DELIVERY_ZONES_UPDATED`, old/new values), and a pure `pointInZones(zones, lat, lng)` using the same
  haversine as `utils/geo.ts` (`isWithinDeliveryRadius`).
* `GET /admin/settings/delivery-zones` and `PUT /admin/settings/delivery-zones` (ADMIN, OPERATIONS; body `{ zones: [...] }` replaces the list; response
  `{ zones, updated_at }`; 400 on bad input with the usual `VALIDATION_ERROR` details).
* `GET /store` gains `delivery_zones: [{ id, name, lat, lng, radius_km }]` = the ENABLED zones only (`[]` when none).
* **Enforcement**: `orders/delivery-zone.ts` `assertWithinServiceZone` (used by checkout AND the address book, so an address that saves can order) passes when inside the
  store radius OR inside an enabled zone. The refusal stays 422 `DELIVERY_OUTSIDE_RADIUS` with `details { distance_km, max_radius_km }` as today plus
  `zones: [{ name, distance_km }]` (distance from each enabled zone's centre) and the message "Delivery address is outside our delivery area (X km from the
  store)." Find every other place that decides "inside the delivery area" (grep `isWithinDeliveryRadius`, `radius_km`, `DELIVERY_OUTSIDE_RADIUS`, order map /
  reports `outside`, rider live service, coupons or fees if any) and make them zone-aware or report that they are intentionally unchanged.
* **Order map report** (`reports/order-map.service.ts`, admin and ops `GET /admin/reports/order-map`): `store` additionally carries `zones: [{ name, lat, lng,
  radius_km }]` (enabled), and an order inside a zone is NOT counted as outside / near the edge.
* Tests (real Postgres): setting default / get / put / validation / roles / audit; /store field; deliverable inside store radius, inside Beruwala when enabled,
  refused inside Beruwala when disabled, refused between (e.g. a point on the Bentota side beyond 4 km), address book save and order placement both follow;
  order map counts. Tests that pin the exact /store, order-map or error shapes are updated. Other suites must not change behaviour: the zone default is OFF.

---------------------------------------------------------------------------------------------------------------------
## Q. Customer app (`apps/customer-app`) - builder Q

Code against section B's `/store.delivery_zones` (`[{ id, name, lat, lng, radius_km }]`, absent on an older server = none) and mock it in tests.
* `StoreInfo.delivery_zones?`; `coverageOf` (src/blynk/area/coverage.ts) carries `zones`; `insideCoverage`, `areaOfPin`, `areaChoices`, `deliveryAreas`,
  `nearestPlace`, the "outside" decisions and the map **use the union**: a point is inside when it is inside the store circle or any zone circle; a place
  (e.g. "Beruwala town") is inside when it is inside the union. Revert nothing else: `places.ts` keeps Beruwala town `listed: true`; the frame/zoom of the delivery-area map
  must fit the store circle AND the zone circles; the zone circle is drawn like the store circle (dashed ring, same colours, its name as a small label); the legend/
  list shows "We deliver within 4 km of the Clock Tower, Dharga Town, and in Beruwala." (one clause per enabled zone: ", and in A and B" style; English, Sinhala and
  Tamil in the `localized` blocks under `src/blynk/area/`, read `docs/superpowers/plans/2026-10-25-translations.md` and `src/blynk/i18n/**`; the completeness test must pass).
* The tests I added earlier named "Beruwala at a 6 km radius" in `src/blynk/area/area.test.ts` encode the wrong idea (a bigger radius): replace them with zone tests:
  with radius 4 and an enabled Beruwala zone (6.4759, 79.9842, 3 km) a pin in Beruwala town is inside and named "Beruwala", a pin 6 km south (Bentota side beyond
  4 km, e.g. lat 6.385, lng 80.005) is still outside, a disabled/absent zone changes nothing, an older server without the field behaves as today.
* The out-of-area refusal screen (DELIVERY_OUTSIDE_RADIUS) uses the same helpers; keep its text but make sure it does not claim a radius that ignores zones.
* Run `npx tsc --noEmit` and the whole `npx vitest run --testTimeout=120000` in apps/customer-app.

---------------------------------------------------------------------------------------------------------------------
## A. Admin (`apps/admin`) and O. Operations (`apps/operations`) - one builder each

* A new card **"Extra delivery areas"** (Admin: Settings, next to the Delivery radius card; Ops: More, next to the Delivery radius card), same patterns as that card (api
  file, lib helpers with tests, card component). It loads `GET /admin/settings/delivery-zones` and shows each zone as a row: name, an on/off switch, centre (lat, lng),
  radius km, an "Open in Google Maps" link for the centre, and a remove button; **Add area** adds a row (name, centre by lat/lng or by pasting a Google Maps link or "lat, lng"
  text - reuse the paste parser the seller location sheet already has in each app (`parsePastedPoint` / `pasteToPoint` in `lib/sellers.ts`, `lib/sellerShop.ts`), radius, on).
  Save sends `PUT /admin/settings/delivery-zones { zones }`. Explanatory text: "The main delivery area is the circle around the Blynk store (Delivery radius). Extra areas
  add a separate circle, for example Beruwala, without making the main circle bigger. Customers can order from an address inside the circle or inside any area that is switched on."
  Validation (name, lat/lng ranges, radius 0.5 to 15, at most 10) inline; the API error shown; a saved/not-saved state like the neighbouring cards.
* The order map pages (Admin `pages/OrderMap.tsx`, Ops `pages/OrderMap.tsx`) draw each enabled zone's circle (from `data.store.zones`, optional: absent = none) the same way as the
  main service circle (second dashed ring + label), and the "outside" wording stays as the API counts it.
* Tests for each (card: render with the Beruwala default switched off, switch on and save with the exact PUT body, add a zone from a pasted link, remove, validation, API error;
  order map: zone ring present / absent).

---------------------------------------------------------------------------------------------------------------------
## W. Website (`apps/customer-site`) - builder W

Last time the site was written for a **6 km** radius (marker default `6`, terms sentence, `{km}` token output, Beruwala copy). The radius stays **4 km** and Beruwala is an extra area.
* Marker defaults and the plain-text places (meta descriptions, JSON-LD, manifest, titles, play listing doc text) go back to **4** (find the `6`s the previous change added: `data-radius`,
  `{km}` default, `terms.md` `{{radius}}` default, the Sinhala/Tamil descriptions, `docs/06-deployment/play-store-listing.md`). The live `data-radius` filling from `/store` `radius_km` stays.
* `legal/terms.md` service-area sentence becomes: "We currently deliver within about {{radius}} km of the Dharga Town Clock Tower (Dharga Town, Aluthgama, Kande Vihara, Kaluwamodara,
  Bentota and Moragalla) and in Beruwala town." (keep the token mechanism; regenerate). Do not describe Beruwala as part of the radius anywhere.
* `/beruwala` pages (en, si, ta) and the area lists: keep, but make sure no sentence implies a distance or "within X km" for Beruwala; say "Beruwala town" is served and "the app
  checks your pin on the map".
* Update every test that pinned the 6s or the old terms sentence; run `node --test "tests/*.test.mjs"` in apps/customer-site (74 tests today).
