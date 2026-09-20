# map-tiles

Self-hosted OSM-derived vector tiles for the customer live-delivery map. Full background, licensing and serving requirements: `docs/06-deployment/map-tile-hosting-setup.md`.

- No API key is needed for anything here. No secrets belong in this folder.
- Attribution "© OpenStreetMap contributors" must be shown on every map (ODbL).
- This folder is deliberately outside `src/`. A later task serves it over HTTP with Range support and copies it into the Docker image.

## Current archive

| Field | Value |
|---|---|
| File | `blynk-service-area.pmtiles` |
| Size | 2,037,022 bytes |
| SHA-256 | `673049d27e20f5e67ad36a9a118c8c6ef06c7900685e4255067924e8bc468e45` |
| Source | `https://build.protomaps.com/20260919.pmtiles` (Protomaps basemap 4.15.2, OSM data as of 2026-09-19T04:00:00Z) |
| Extracted | 2026-09-20 with `pmtiles` CLI 1.31.2 |
| Bbox | `79.973,6.384,80.082,6.492` (min_lon,min_lat,max_lon,max_lat) = hub 6.4382,80.0274 + 4 km radius + 2 km margin |
| Zoom | 0-15 (15 is the highest zoom in the Protomaps v4 basemap) |

## Regenerate

1. Get the CLI (single binary; keep it outside the repo): download the asset for your OS from https://github.com/protomaps/go-pmtiles/releases (v1.31.2 was used; Windows x86_64 asset: `go-pmtiles_1.31.2_Windows_x86_64.zip`). Check: `pmtiles version`.
2. Pick a current build date `YYYYMMDD` from https://maps.protomaps.com/builds (Protomaps keeps only about the last week of builds plus the latest of each patch version, so the date above will not remain available).
3. Extract (uses HTTP range requests; transfers about 2 MB):

```
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles blynk-service-area.pmtiles --bbox=79.973,6.384,80.082,6.492 --maxzoom=15
```

   Add `--dry-run` first to see the size without downloading.
4. Check it:

```
pmtiles verify blynk-service-area.pmtiles
pmtiles show blynk-service-area.pmtiles
pmtiles show blynk-service-area.pmtiles --metadata
sha256sum blynk-service-area.pmtiles
```

5. Confirm `tile type: mvt`, zoom `0-15`, layers `boundaries, buildings, earth, landcover, landuse, places, pois, roads, water`, and `version` 4.x (the style `apps/customer/.../Assets/map/blynk_map_style.json` targets the Protomaps v4 schema; re-check it if the major version changes).
6. Replace `backend/api/map-tiles/blynk-service-area.pmtiles` atomically, update the SHA-256, size, source date and extraction date above, and update the recorded values in `docs/06-deployment/map-tile-hosting-setup.md` section 3.5. Suggested cadence: every 3-6 months.
