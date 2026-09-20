# Map Tile Hosting Setup (Self-Hosted PMTiles + MapLibre)

**Status:** Archive built and committed (2026-09-20). Backend serving route and Docker inclusion implemented in Task M0b (section 8.1, verified by `backend/api/tests/map-tiles.test.ts`). The Flutter `MapProvider` is implemented in a later task.
**Supersedes:** the withdrawn Google Maps setup idea. No Google Maps, no Google Cloud project, no Google API key anywhere.
**Gate for:** Customer app live-delivery map (plan: `docs/superpowers/plans/2026-09-19-blynk-live-location-tracking.md`, section "Map Provider" and section 8).

All external facts below were checked against the official page named next to them on **2026-09-20**. Anything that could not be verified is marked **UNVERIFIED**. No download URL or command in this document is invented; each one was executed or fetched as written.

---

## 1. Decision summary

| Item | Decision |
|---|---|
| Tile source | One self-hosted `.pmtiles` vector archive, `backend/api/map-tiles/blynk-service-area.pmtiles` (2,037,022 bytes) |
| How it was produced | `pmtiles extract` of a Protomaps basemap daily build, bounding box around the delivery zone (section 3) |
| Schema | Protomaps basemap v4 (`version 4.15.2` in archive metadata) |
| Style | `apps/customer/blinkit-clone-Flutter-ecommerce-/Assets/map/blynk_map_style.json`, bundled as a Flutter asset, no text labels (section 5) |
| API key | **None. No API key is required anywhere in this setup, and none must be added** (section 7) |
| Recurring bill | None (section 12) |
| Fallback | OpenFreeMap public instance (section 10) |
| Rejected | MapTiler free plan and Stadia Maps free plan (both non-commercial), Google Maps (out of scope), OSM public `tile.openstreetmap.org` (plan section 8.2) |

Why the extract route rather than the full OSM-to-tiles pipeline: the geography is one small fixed area. The extract route downloads about 2 MB in 41 HTTP range requests and takes under a minute on a laptop, with no Java, no 137 MB OSM download and no RAM sizing. The full pipeline (section 3.4) is documented as the escape hatch if a custom schema or fresher-than-daily data is ever needed.

---

## 2. Service area (from the repository)

Confirmed from the repo, not memory:

| Fact | Value | Source in repo |
|---|---|---|
| Hub `DHARGA-01` latitude, longitude | `6.438200`, `80.027400` | `backend/api/src/database/seeds/dev_seed.ts` lines 31-32; `docs/02-architecture/blynk_database_design.md` |
| Delivery radius | `4.00` km (`radius_km NUMERIC(5,2) NOT NULL DEFAULT 4.00`) | `backend/api/src/database/migrations/001_initial_schema.sql` line 128 |
| Customer address form default | `6.4382`, `80.0274` | `apps/customer/blinkit-clone-Flutter-ecommerce-/lib/Screens/add_edit_address_screen.dart` lines 76-78, 122-123 |

---

## 3. Build the tile archive (verified, reproducible)

### 3.1 Bounding box

- Delivery radius 4 km plus **2 km context margin** = **6 km** half-side, so the archive shows the whole delivery zone plus a little surrounding road network and coastline.
- At latitude 6.44 N, 1 degree of latitude is about 110.6 km and 1 degree of longitude is about 110.6 km (111.32 km x cos 6.44 degrees). 6 km is therefore about 0.054 degrees in both axes.
- Centre 80.0274 E, 6.4382 N gives (rounded to 3 decimals):

```
--bbox=79.973,6.384,80.082,6.492        # min_lon,min_lat,max_lon,max_lat
```

Extract includes every whole tile that intersects the box, so real coverage is a little larger than the box; the archive header records the box as `bounds`.

### 3.2 Install the CLI

Official docs (https://docs.protomaps.com/pmtiles/cli, fetched 2026-09-20): the CLI is a single binary with no dependencies, downloadable from GitHub Releases (https://github.com/protomaps/go-pmtiles/releases), or run via Docker image `protomaps/go-pmtiles`.

Version used: **v1.31.2**, published 2026-07-22 (GitHub API `releases/latest`, fetched 2026-09-20). Windows x86_64 asset (URL as listed by the API):

```
https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Windows_x86_64.zip
```

Other assets in the same release: `go-pmtiles_1.31.2_Linux_x86_64.tar.gz`, `go-pmtiles_1.31.2_Linux_arm64.tar.gz`, `go-pmtiles-1.31.2_Darwin_x86_64.zip`, `go-pmtiles-1.31.2_Darwin_arm64.zip`, `go-pmtiles_1.31.2_Windows_arm64.zip` (note the release itself mixes `-` and `_` after `go-pmtiles`; copy the exact name from the releases page).

`pmtiles version` on the downloaded binary printed:

```
pmtiles 1.31.2, commit a3e4951ea6a0477b784c27c1dcbfd9c130878c5a, built at 2026-07-22T18:59:03Z
```

Do not commit the binary; keep it outside the repo.

### 3.3 Source build and exact command

Official basemap downloads page (https://docs.protomaps.com/basemaps/downloads, fetched 2026-09-20) states:

- The Version 4 daily build channel is at `https://maps.protomaps.com/builds`.
- "URLs may change and hotlinking to these downloads are discouraged. Instead, you should copy the tileset to your own Cloud Storage."
- Planet file is roughly 120 GB, zoom 0-15; regional cutouts are made with `pmtiles extract`, with `--maxzoom` to reduce size ("Each additional zoom level roughly doubles the size of the file").
- Retention: the daily builds bucket keeps all builds from the past week and the latest build of each patch version.
- BLAKE3 hashes are published for downloads.

The docs page does not spell out the file URL. The builds page (https://maps.protomaps.com/builds) is a JavaScript app; its own script (`/assets/builds-*.js`) loads the build list from `https://build-metadata.protomaps.dev/builds.json` and links each build as `https://build.protomaps.com/<key>`, where `<key>` is e.g. `20260919.pmtiles`. That pattern was confirmed with a live request on 2026-09-20 (`HEAD https://build.protomaps.com/20260919.pmtiles` returned `200 OK`, `Content-Length: 138139970338`, `Accept-Ranges: bytes`, `ETag`, `Last-Modified: Sat, 19 Sep 2026 09:04:11 GMT`). The build list entry for that file: version `4.15.2`, uploaded `2026-09-19T09:04:11.212Z`, b3sum `60fd23d0766f3955ad2f84dc9694f3a9c698c048d0e68705f75e18e8f837cc32` (recorded as published; not re-verified locally, since the full 138 GB file is never downloaded).

CLI reference for `extract` (https://docs.protomaps.com/pmtiles/cli, and `pmtiles extract --help` on v1.31.2): `pmtiles extract INPUT OUTPUT --bbox=MIN_LON,MIN_LAT,MAX_LON,MAX_LAT [--maxzoom=N] [--minzoom=N] [--region=file.geojson] [--download-threads=4] [--overfetch=0.05] [--dry-run]`. The source "may be local or remote and must be clustered"; a remote source is read with HTTP range requests, so only the requested region is transferred.

Commands actually run:

```
pmtiles extract https://build.protomaps.com/20260919.pmtiles blynk-service-area.pmtiles --bbox=79.973,6.384,80.082,6.492 --maxzoom=15 --dry-run
pmtiles extract https://build.protomaps.com/20260919.pmtiles blynk-service-area.pmtiles --bbox=79.973,6.384,80.082,6.492 --maxzoom=15
pmtiles show   blynk-service-area.pmtiles
pmtiles show   blynk-service-area.pmtiles --header-json
pmtiles show   blynk-service-area.pmtiles --metadata
pmtiles verify blynk-service-area.pmtiles
```

Result of the real run: `fetching 191 tiles, 39 chunks, 30 requests`, `Extract required 41 total requests`, `Extract transferred 2.1 MB (overfetch 0.05) for an archive size of 2.0 MB`, completed in about 17 s. `pmtiles verify` completed with no errors.

### 3.4 Alternative route (documented, not run): full pipeline

1. **OSM regional extract.** Geofabrik Sri Lanka page: https://download.geofabrik.de/asia/sri-lanka.html (fetched 2026-09-20). Current file: `https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf` (137 MB; it answered `302` to `https://download.geofabrik.de/asia/sri-lanka-260919.osm.pbf`, data through 2026-09-19T20:22:34Z). A boundary file `https://download.geofabrik.de/asia/sri-lanka.poly` is also listed. License: ODbL 1.0; the extract has no user names/IDs/changeset IDs. Dated snapshots (`sri-lanka-YYMMDD.osm.pbf`) and `.md5` files are listed on the page.
2. **Tile build.** Protomaps basemaps repo (https://github.com/protomaps/basemaps, fetched 2026-09-20) builds with Planetiler: requires Java 21+ and Maven; `cd tiles && mvn clean package`, then `java -jar target/*-with-deps.jar --download --force --area=monaco` (example area from their README; `--area` selects a Geofabrik extract by name). **UNVERIFIED for Sri Lanka:** I did not run this, so I did not confirm the exact `--area=sri-lanka` invocation or its output size. Planetiler's own quick start (https://github.com/onthegomap/planetiler, fetched 2026-09-20): `java -Xmx1g -jar planetiler.jar --download --area=monaco`, or the `ghcr.io/onthegomap/planetiler:latest` Docker image; needs about 5-10x the `.osm.pbf` size in free SSD plus about 0.5x its size in RAM. Latest Planetiler release seen: v0.10.2 (2026-03-29; GitHub API).
3. **Optional clip** with `pmtiles extract ... --bbox` to keep only the service area.

Why not chosen: needs a JDK/Maven toolchain, roughly 1-2 GB of working disk and RAM for a 137 MB PBF, and produces the same schema and result as the pre-built daily build. Choose it only if data fresher than the daily build or schema changes are required.

### 3.5 Recorded archive facts

| Field | Value |
|---|---|
| File | `backend/api/map-tiles/blynk-service-area.pmtiles` |
| Size | 2,037,022 bytes (about 1.94 MiB, well below the 20 MB target) |
| SHA-256 | `673049d27e20f5e67ad36a9a118c8c6ef06c7900685e4255067924e8bc468e45` |
| Source build | `https://build.protomaps.com/20260919.pmtiles` (Protomaps basemap 4.15.2, uploaded 2026-09-19T09:04:11Z) |
| OSM data timestamp in build | `planetiler:osm:osmosisreplicationtime 2026-09-19T04:00:00Z` |
| Built by | Planetiler 0.10.2 (`planetiler:githash 0e5588c4a6e8c29a270a33afe8df62027d889604`) |
| Extracted | 2026-09-20 with pmtiles CLI 1.31.2 |
| PMTiles spec version | 3 |
| Tile type / compression | `mvt`; tiles gzip; internal (directory/metadata) gzip; clustered `true` |
| Zoom range | 0 to 15 |
| Bounds | 79.973, 6.384, 80.082, 6.492 |
| Header centre | 80.0275, 6.438, centre zoom 0 (the app must set its own camera; do not rely on header zoom) |
| Tiles | 197 addressed, 191 entries, 184 unique contents |
| Vector layers | `boundaries, buildings, earth, landcover, landuse, places, pois, roads, water` |

**Zoom choice.** `z15` is the highest zoom the Protomaps v4 basemap contains (docs: "zoom levels 0-15"), so it is the maximum, not a trade-off. The generic z0-z16 guidance in the original plan cannot be met from this schema and is unnecessary: MapLibre over-zooms vector tiles, so the map stays sharp at z16-z18 (building footprints are individual OSM buildings from z15). At z15 this area is only 2.0 MB, so no margin or zoom reduction was needed.

---

## 4. Licensing and attribution

| Component | License | Source |
|---|---|---|
| Map data (OpenStreetMap) | ODbL 1.0; attribution mandatory | https://docs.protomaps.com/basemaps/downloads ("distributed as an Open Database License Produced Work (OpenStreetMap attribution required)") |
| Protomaps basemap code / design / tilesets | Code BSD-3; map design CC0; "Tilesets are ODbL, attribute OSM" | https://github.com/protomaps/basemaps (fetched 2026-09-20) |
| go-pmtiles CLI | BSD-3-Clause | GitHub license API, 2026-09-20 |
| MapLibre Native | BSD-2-Clause | GitHub license API for `maplibre/maplibre-native`, 2026-09-20 |

**Protomaps terms, exactly as their README states:** "If you distribute a modified fork of these basemap styles or tilesets, or provide a tiles API based on them, you must name your product or service something different from Protomaps." Blynk does neither (it serves one small clipped file for its own app), and this repo's style and archive are named `blynk_*`. The README suggests the attribution "Protomaps © OpenStreetMap"; the archive's own metadata carries `© OpenStreetMap`. Blynk shows "© OpenStreetMap contributors" as required by the project.

**`build.protomaps.com` versus self-hosting.** Their downloads page says the daily-build URLs "may change", "hotlinking to these downloads [is] discouraged", and that you should copy the tileset to your own storage. This project complies: the bucket is hit once, manually, at build time (41 range requests, 2 MB). The running app never touches `build.protomaps.com`; it reads Blynk's own copy. The page states no rate limit, SLA or additional usage terms for the bucket, and the bucket only keeps the last week of builds, so **the committed archive plus its SHA-256 is the record of truth**, not the upstream URL. I found no additional attribution requirement in the fetched pages beyond OSM (and the suggested "Protomaps" credit). The archive metadata also references Natural Earth data ("Basemap layers derived from OpenStreetMap and Natural Earth"); the basemaps README lists Natural Earth as a data source without stating a separate attribution requirement.

**OSM attribution rule (OSM Foundation, https://osmfoundation.org/wiki/Licence/Attribution_Guidelines, fetched 2026-09-20):** credit "should typically appear in a corner of the map", must be visible without requiring interaction, and must link to `openstreetmap.org/copyright`; "OpenStreetMap" is the primary wording, with "© OpenStreetMap contributors" acceptable.

**Where it must render in Blynk (implemented in plan Task M4):** in the single `maplibre_map_view.dart` widget (the only file allowed to import the MapLibre package), as a permanent, non-dismissible overlay in a map corner, text "© OpenStreetMap contributors" linking to `https://www.openstreetmap.org/copyright`, drawn by Blynk's own widget tree so it survives a style swap. The style JSON also carries `"attribution": "© OpenStreetMap contributors"` on its source as a fallback, but the widget overlay is the authoritative one; do not remove it in a redesign.

---

## 5. Style: `blynk_map_style.json`

- File: `apps/customer/blinkit-clone-Flutter-ecommerce-/Assets/map/blynk_map_style.json` (MapLibre style spec v8, about 17 KB, 25 layers). `pubspec.yaml` now lists `- Assets/map/` so it ships with the app.
- Schema-matched: layer names and `kind` values were checked against the docs (https://docs.protomaps.com/basemaps/layers, fetched 2026-09-20) **and against real tiles decoded from the archive** (z15/23668/15796 and z13/5917/3949). Layers used: `earth`, `landcover`, `landuse`, `water`, `buildings`, `roads`.
- **Observed deviation from the docs:** in the actual tiles, `water` line features (canal, stream, river) carry the type in `kind` (e.g. `kind=canal`) with no `kind_detail`, and polygons use `kind=water`/`swimming_pool`. The style therefore filters water by geometry type, not by the documented `kind_detail` list. Re-check if the basemap major version changes.
- Look: light and calm, using the Blynk design tokens from `lib/app_colors.dart`: motorways use a tint of `primaryYellowColor` (#FFE141) with a darker casing, parks/woods use tints of `primaryGreenColor` (#0C831F), built-up land and buildings use greys derived from `greyWhiteColor` (#EDF2F8). Water is a soft blue (also the background, because the ocean is the absence of an `earth` polygon).
- Road widths interpolate to z20, so over-zoomed street views (z16-z18) stay legible.

### Deliberate tradeoff: no text or symbol layers

Protomaps' MapLibre docs (https://docs.protomaps.com/basemaps/maplibre, fetched 2026-09-20) show the glyphs (`https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf`) and sprite (`https://protomaps.github.io/basemaps-assets/sprites/v4/light`) as third-party-hosted assets, and their flavors page (https://docs.protomaps.com/basemaps/flavors) documents building custom sprites but gives **no self-hosting procedure for fonts**. So this style has **no `glyphs`, no `sprite`, and no `symbol` layers**: there is no third-party host dependency and nothing to fetch except tiles. The customer sees a destination marker, a rider marker and roads; street names and POI icons are intentionally not drawn. If labels are ever wanted, that is a separate task: self-host the font PBFs (from `protomaps/basemaps-assets`, **UNVERIFIED** licence/hosting steps) and add `glyphs` plus symbol layers.

### Source URL placeholder contract

The style's only source is:

```json
"sources": { "protomaps": { "type": "vector", "url": "pmtiles://__TILES_URL__", "minzoom": 0, "maxzoom": 15, "bounds": [79.973, 6.384, 80.082, 6.492], "attribution": "© OpenStreetMap contributors" } }
```

The Flutter side (plan Task M4/M-later) must, before handing the style to MapLibre:

1. Load the JSON string from the asset bundle.
2. Replace the literal token `__TILES_URL__` (exactly one occurrence, in `sources.protomaps.url`) with the **absolute** URL of the archive from environment configuration, e.g. `https://api.example.com/map-tiles/blynk-service-area.pmtiles`, yielding `pmtiles://https://api.example.com/map-tiles/blynk-service-area.pmtiles`.
3. Pass the resulting JSON string to the map as inline style JSON (not a file path with an unsubstituted token).

Constraint from MapLibre Native docs (https://maplibre.org/maplibre-native/android/examples/data/PMTiles/, fetched 2026-09-20): "the URL inside `pmtiles://` [must be] fully specified (e.g. `pmtiles://https://example.com/tiles.pmtiles`, not `pmtiles://tiles.pmtiles`)"; `pmtiles://asset://` (files packaged in the app) is **not supported**; supported minimum "MapLibre Android 11.7.0"; and "PMTiles sources do not support offline pack downloads or caching" on native. The archive therefore cannot be shipped inside the app: it must be served over HTTP(S) (or `file://` after a manual download). iOS support was listed in search results (MapLibre iOS changelog, PMTiles `pmtiles://` scheme) but **the iOS page itself was not fetched: UNVERIFIED**. Also **UNVERIFIED:** the minimum `maplibre_gl` Flutter package version that bundles MapLibre Native >= 11.7.0; check its changelog in Task M4 before pinning. The plan's statement that Flutter MapLibre handles `pmtiles://` natively rests on that.

### Validation

`@maplibre/maplibre-gl-style-spec` 26.4.4 via `npx gl-style-validate`: **exit code 0, no messages** on the committed file. Negative control: after pointing one layer at a missing source the same validator printed `layers[3]: source "nope" not found` and exited 1. The style contains no `glyphs`, no `sprite` and no `symbol` layer. It was **not** rendered in a MapLibre engine in this task.

---

## 6. Checklist for whoever wires up the client

- Read the archive URL from ordinary environment configuration (same convention as the existing API base URL); it is not a secret.
- Always render the OSM attribution overlay.
- Substitute `__TILES_URL__` as described in section 5.
- Native MapLibre will not cache PMTiles ranges (section 5), so expect a range request per tile; at this app's scale that is negligible (section 12).

---

## 7. No API key

Neither the self-hosted PMTiles archive nor the OpenFreeMap fallback needs an API key. Do not add key storage, key rotation or key headers for map tiles. The style, archive and this document contain no secret.

---

## 8. HTTP requirements for serving the archive

PMTiles readers use HTTP Range Requests to read only the needed bytes (https://docs.protomaps.com/pmtiles/, fetched 2026-09-20). Cloud-storage guidance (https://docs.protomaps.com/pmtiles/cloud-storage): the host must support HTTP Range Requests; if the map origin differs from the file origin, CORS is required, with allowed methods `GET`, `HEAD`, allowed request headers `range`, `if-match`, and exposed header `etag`.

Requirements for the backend serving task:

| Requirement | Detail | Reference |
|---|---|---|
| Range support | Respond `206 Partial Content` to `Range: bytes=a-b`, with `Content-Range: bytes a-b/total` and correct `Content-Length` of the slice; advertise `Accept-Ranges: bytes`; `416 Range Not Satisfiable` for out-of-range requests | MDN https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests (fetched 2026-09-20) |
| No on-the-fly compression | Do not gzip/brotli the `.pmtiles` response and do not route it through a `compression()` middleware or a proxy `gzip on` rule for this path. The tiles inside are already gzip-compressed (header `tile compression: gzip`). PMTiles offsets refer to bytes of the file as stored, so a re-encoded body would break them. This is my reasoning from the range semantics; the PMTiles/MDN pages I fetched do not state it in so many words | derived |
| Content type | `application/octet-stream` is fine (this is what Express returned in my test) | tested |
| Validators | Send `ETag` and `Last-Modified` (MDN caching guide recommends both). The PMTiles JS reader sends `If-Match` with the ETag, so ranges of an old and a new file are never mixed. Express returned a **weak** ETag (`W/"..."`); `send` accepts `If-Match` against weak tags, but test with the JS reader if a web client is ever added | MDN Caching https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching; tested |
| CORS | Only needed for a browser client on another origin; native Flutter is unaffected. If needed: allow `GET, HEAD`, `Range`, `If-Match`; expose `ETag` (and `Content-Range`, `Accept-Ranges`) | Protomaps cloud-storage doc |
| Auth | None: public map data, same trust level as other static assets |  |

**Recommended `Cache-Control`** (implemented in Task M0b as the first option below):

- With the stable file name planned (`blynk-service-area.pmtiles`, overwritten on each rebuild): `Cache-Control: public, max-age=3600` (or up to a day) plus `ETag`/`Last-Modified`. Reasoning: MDN says to always specify `Cache-Control` to avoid heuristic caching and to use validators; a short freshness window lets a rebuilt archive propagate quickly, and validators let caches revalidate. Do not use `immutable` with a fixed name.
- Alternative: a versioned name (e.g. `blynk-service-area-20260919.pmtiles`) with `public, max-age=31536000, immutable`, which is MDN's documented cache-busting pattern; the app's URL configuration then changes on each rebuild.
- Replace the file **atomically** (write a temp file, then rename) so a client mid-session never reads a half-written archive.
- Native MapLibre does not cache PMTiles sources (section 5), so these headers mostly matter for browsers, CDNs and proxies.

### 8.1 Implemented in Task M0b (verified by `backend/api/tests/map-tiles.test.ts`)

| Item | Value |
|---|---|
| Public URL | `GET|HEAD {origin}/map-tiles/blynk-service-area.pmtiles`, at the app root like `/uploads`, **not** under `API_PREFIX` (it is a static file, not a versioned JSON endpoint). Use `{origin}/map-tiles/blynk-service-area.pmtiles` as the value substituted for `__TILES_URL__` (section 5). |
| Auth | None (public map data, same trust level as `/uploads`) |
| Config | `MAP_TILES_DIR` (default `map-tiles`, resolved against the working directory like `MEDIA_ROOT`; the Docker image sets `/app/map-tiles`) |
| Code | `backend/api/src/modules/map-tiles/index.ts`, mounted in `src/app.ts` |
| Reachable files | Only names ending in `.pmtiles`; anything else in the directory (for example `README.md`) is 404. Dotfiles 404, no directory index or listing, no directory redirect, path traversal 403/404. |
| Methods | GET and HEAD. Other methods: `405` with `Allow: GET, HEAD`. |
| Cache-Control | `public, max-age=3600` (1 hour; no `immutable`, because the file name is reused on every rebuild). Rebuilt archives reach clients within an hour, and ETag/Last-Modified make revalidation a cheap `304`. |
| Validators | Weak `ETag` and `Last-Modified`; `If-None-Match` and `If-Modified-Since` give `304`. |
| Compression | None. No `compression` middleware exists in the app; tests assert no `Content-Encoding` even with `Accept-Encoding: gzip, deflate, br`. |
| CORP | `Cross-Origin-Resource-Policy: cross-origin` on this route only (as for `/uploads`). |

Observed responses (tests run against the real 2,037,022-byte archive):

```
HEAD                    -> 200, Content-Length: 2037022, Accept-Ranges: bytes,
                           Cache-Control: public, max-age=3600, ETag: W/"...", Last-Modified: ...
Range: bytes=0-126      -> 206, Content-Range: bytes 0-126/2037022, Content-Length: 127
                           (body starts with "PMTiles", version byte 3)
Range: bytes=-100       -> 206, Content-Range: bytes 2036922-2037021/2037022, Content-Length: 100
Range: bytes=99999999-  -> 416, Content-Range: bytes */2037022 (small JSON error body)
If-None-Match: <ETag>   -> 304, no body
POST/PUT/DELETE/PATCH   -> 405, Allow: GET, HEAD
```

Guarantee against whole-file responses: a `Range` request returns only the slice (`Content-Length` equals the range length; the test compares the bytes with the same slice read from disk). The archive's SHA-256 is also checked against `backend/api/map-tiles/README.md` by the same test file, so a silently swapped archive fails CI.

Not covered by these tests (still **UNVERIFIED**): any reverse proxy, CDN or platform host in front of Express (see section 9), and browser (cross-origin) clients: the global CORS config does not list `Range`/`If-Match` as allowed request headers or `ETag`/`Content-Range` as exposed headers, which only matters if a web client on another origin is ever added.

---

## 9. Production static-file serving

Express: `express.static` is `serve-static` on top of `send`. The serve-static options page (https://expressjs.com/en/resources/middleware/serve-static.html, fetched 2026-09-20) documents `acceptRanges` (default `true`; "disabling this will not send `Accept-Ranges` and ignore the `Range` request header"), `cacheControl`, `etag` (default true), `lastModified` (default true), `maxAge` (default 0), `immutable`, `setHeaders`, `dotfiles`, and mounting with `app.use('/public', serveStatic('public', { maxAge: '1d' }))`. `pillarjs/send` (https://github.com/pillarjs/send) documents the same range and conditional-GET behaviour.

**Verified locally on 2026-09-20** with the repo's own installed versions (express 4.22.3, serve-static 1.16.3, send 0.19.2), serving a copy of the real archive with `app.use('/map-tiles', express.static(dir, { maxAge: '1h', index: false }))`:

```
HEAD                       -> 200, Accept-Ranges: bytes, Cache-Control: public, max-age=3600,
                              ETag: W/"1f151e-1a0bd9f93ab", Last-Modified: ..., Content-Length: 2037022
Range: bytes=0-126         -> 206 Partial Content, Content-Range: bytes 0-126/2037022, Content-Length: 127
Range + Accept-Encoding: gzip -> 206, same Content-Range, no Content-Encoding (Express alone does not compress)
Range: bytes=999999999-    -> 416, Content-Range: bytes */2037022
```

Notes for the serving/Docker task:

- `backend/api/src/app.ts` uses `helmet` (its default `Cross-Origin-Resource-Policy: same-origin` blocks cross-origin browser use; the existing media route already overrides this, see `app.ts` near line 146 — mirror that if a web client is ever needed) and `cors`. There is no `compression` middleware in `app.ts` or `package.json` as checked today; do not add one for this path.
- Keep the file **outside `src/`** (it is at `backend/api/map-tiles/`) and copy it into the production image explicitly. **Done in Task M0b:** the runtime stage of `backend/api/Dockerfile` has `COPY --chown=node:node map-tiles/ ./map-tiles/` and `ENV MAP_TILES_DIR=/app/map-tiles`; `.dockerignore` does not exclude it. `tests/deployment.test.ts` asserts this statically. No image was built for this task, so the copy is **not exercised by a real `docker build`**.
- Reverse proxy (nginx, a CDN or a platform proxy) in front of Express: it must pass the `Range` header through and return `206`, must not compress this path (nginx's `gzip` is `off` by default and its default `gzip_types` is `text/html`, per https://nginx.org/en/docs/http/ngx_http_gzip_module.html, so `application/octet-stream` is not compressed unless someone widens `gzip_types`), and must not buffer or rewrite the body in a way that drops `Content-Range`. **Reverse proxy rules (documentation only, not tested):** do not buffer this path in a way that drops `Content-Range`, do not enable compression for `/map-tiles/`, and do not strip or rewrite the `Range`, `If-Range`, `If-None-Match` or `If-Modified-Since` request headers or the `ETag`, `Last-Modified`, `Accept-Ranges` and `Content-Range` response headers. If a CDN caches the path, it must be range-aware (cache the whole object and slice, or cache per range) and must honour the 1-hour `Cache-Control`. **UNVERIFIED:** behaviour of the specific production host/CDN, because the production platform is not decided in this task; re-run the four curl checks above against the real public URL after deploy.
- Alternative for later scale: serve the file from object storage or a CDN (Protomaps lists S3-compatible storage, Caddy and nginx as suitable hosts). Not needed at this size.

---

## 10. Documented fallback: OpenFreeMap

Facts from https://openfreemap.org/quick_start/ and https://openfreemap.org/ (fetched 2026-09-20):

- Style URLs: `https://tiles.openfreemap.org/styles/liberty`, `.../styles/bright`, `.../styles/positron`.
- No API key mentioned; the homepage says there are "no limits on the number of map views or requests" and answers "Yes" to commercial use.
- Required attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (links: openfreemap.org, openmaptiles.org, openstreetmap.org/copyright).
- **No SLA:** the homepage, in the words of its maintainer (who introduces himself by name, so it is a one-person operation), says "At the moment, I don't offer SLA guarantees or personalized support." Its terms (https://openfreemap.org/tos/) say the operator "may discontinue [the site] at any time without notice" and provide it "as-is", with no warranties on availability. The service is funded by recurring donations. This is a deliberate tradeoff if exercised.

**Swap procedure** (needs no other code change if the section 8.4 abstraction is followed):

1. Set the map's style to `https://tiles.openfreemap.org/styles/positron` (light, closest to this style) or `liberty`; skip the local style asset and the `__TILES_URL__` substitution. **Re-confirm these URLs on openfreemap.org at swap time**; the structure has changed before.
2. Change the attribution overlay text to "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (OSM credit is contained in it).
3. The archive and the backend static route can stay unused or be removed. Their schema (Protomaps) differs from OpenFreeMap's (OpenMapTiles); never mix one style with the other's tiles.

---

## 11. Rejected free tiers (non-commercial)

- MapTiler free plan, https://www.maptiler.com/cloud/pricing/ (fetched 2026-09-20): "Suitable for testing, personal or non-commercial use"; commercial use only on Flex/Custom plans; requires an account (API key model).
- Stadia Maps free tier, https://stadiamaps.com/pricing/ (fetched 2026-09-20): "Commercial use not allowed"; account required.

Blynk is a commercial delivery service, so neither free tier is usable.

---

## 12. Cost, cadence, risks, and outgrowing this setup

**Cost.** No recurring third-party tile bill. The only cost is bandwidth and storage on the existing `backend/api` hosting: a 2 MB file; a session fetches a handful of range requests. At about 50 orders/day and 1-2 riders this is negligible.

**Rebuild cadence.** The archive is a snapshot (OSM data as of 2026-09-19). Rebuild every 3-6 months, or sooner when a new road/estate affecting the delivery zone appears, using `backend/api/map-tiles/README.md`: pick a current `YYYYMMDD` from https://maps.protomaps.com/builds (only the past week of builds plus the latest of each patch version remain available), re-run the extract, run `pmtiles verify`, replace the file atomically, update the recorded SHA-256/date in the README, redeploy. If the Protomaps basemap major version changes (v5), the style must be re-checked against the layer schema.

**Maintenance risks.**

- Upstream bucket URL "may change" and old builds are deleted (docs); mitigated by committing the archive; the next rebuild needs a fresh URL from the builds page.
- Schema drift between basemap versions can break the style's filters (a real doc-vs-data mismatch was already observed for water, section 5).
- The 2 MB binary lives in git; each rebuild adds another 2 MB to history (acceptable; consider Git LFS only if the area grows a lot).
- Native MapLibre has no PMTiles cache/offline; every viewer session hits the server for ranges.
- Cleartext: a plain `http://` archive URL is fine for local/dev only; production must be HTTPS (the app also has the Android cleartext notes in the device runbook).
- Version support of the Flutter MapLibre package for `pmtiles://` is **UNVERIFIED** (section 5).

**If we outgrow it.**

- Larger area (a second hub or town): re-run the extract with a bigger bbox (roughly doubling per extra zoom level; still small), or extract a whole district or the country.
- More traffic: put a CDN or object storage in front of the same file; nothing in the client changes.
- Need labels: add a self-hosted font/glyph set and symbol layers (section 5).
- Need routing/ETA/geocoding: out of scope here; separate evaluation.
- Want zero self-hosting: swap to OpenFreeMap (section 10) with its no-SLA caveat, or a paid commercial tile plan.

---

## 13. Source index (all fetched 2026-09-20)

- https://docs.protomaps.com/pmtiles/cli
- https://docs.protomaps.com/pmtiles/
- https://docs.protomaps.com/pmtiles/cloud-storage
- https://docs.protomaps.com/pmtiles/maplibre (JS protocol; states nothing about native support)
- https://docs.protomaps.com/basemaps/downloads
- https://docs.protomaps.com/basemaps/layers
- https://docs.protomaps.com/basemaps/maplibre
- https://docs.protomaps.com/basemaps/flavors
- https://maps.protomaps.com/builds (and its script's data endpoint https://build-metadata.protomaps.dev/builds.json; pattern confirmed by `HEAD https://build.protomaps.com/20260919.pmtiles`)
- https://github.com/protomaps/go-pmtiles/releases (API `releases/latest`: v1.31.2)
- https://github.com/protomaps/basemaps
- https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md (header fields only; nothing on HTTP serving)
- https://download.geofabrik.de/asia/sri-lanka.html
- https://github.com/onthegomap/planetiler
- https://maplibre.org/maplibre-native/android/examples/data/PMTiles/
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching
- https://expressjs.com/en/resources/middleware/serve-static.html
- https://github.com/pillarjs/send
- https://nginx.org/en/docs/http/ngx_http_gzip_module.html
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
- https://openfreemap.org/ , https://openfreemap.org/quick_start/ , https://openfreemap.org/tos/
- https://www.maptiler.com/cloud/pricing/ , https://stadiamaps.com/pricing/
