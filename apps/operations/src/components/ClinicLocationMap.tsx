import { useState } from 'react';

/**
 * Single-pin, read-only location display for a dental clinic's fixed
 * address (task F9, plan §21), embedded in `pages/Dental/ClinicDetail.tsx`.
 * Matches the customer app's own `ClinicLocationMap`
 * (`apps/customer/.../lib/UI/Widgets/Organisms/clinic_location_map.dart`)
 * constraint exactly: one static pin, no routing, no ETA, no geocoding, no
 * navigation - a clinic address doesn't move, so there is no live stream, no
 * polling, no freshness caption, no second marker.
 *
 * Operations is a React/web app, not Flutter, so the customer app's
 * `MapProvider` abstraction (`map_provider.dart`) isn't portable (common.md
 * rule 2: never import a sibling app's code, port the *shape* of the idea
 * instead). This is therefore a small, self-contained static image request -
 * no new map library, no SDK dependency, one `<img>` tag - per the brief's
 * explicit "no new map library, no second map provider" constraint.
 *
 * **Disclosed conflict, not silently resolved (task-F9-report.md has the
 * full writeup):** the brief names the Google Static Maps API by example.
 * `docs/06-deployment/google-maps-platform-setup.md` §3 - this repo's own
 * single canonical Google Maps Platform policy doc - explicitly lists
 * "Static Maps" among the APIs to **not** enable project-wide ("This is how
 * the standing rule 'no ETA, no routes, no navigation, no geocoding' is
 * enforced technically as well as in code"). That doc also confirms (§8) no
 * Google Cloud project, billing account or API key exists anywhere in this
 * repository or environment today - for any Maps API, Static or otherwise.
 * So this component is built defensively: the URL-building logic below only
 * ever runs if `VITE_GOOGLE_MAPS_STATIC_KEY` is set, which it never is in
 * any environment this task can see, so the only behaviour actually
 * observable today is the honest "Map unavailable" fallback (matching the
 * customer app's own `MapUnavailableCard` copy) - never a broken image, never
 * a fake placeholder. Whether to actually enable the Static Maps API in
 * production needs the doc's prohibition reconciled first - a decision for
 * whoever owns the Google Cloud project, not something this task decides
 * unilaterally either way.
 */
export interface ClinicLocationMapProps {
  latitude: number;
  longitude: number;
  /** The clinic's name, for the image's accessible alt text. */
  label?: string;
}

function staticMapUrl(latitude: number, longitude: number, key: string): string {
  const center = `${latitude},${longitude}`;
  const params = new URLSearchParams({
    center,
    zoom: '15',
    size: '600x260',
    scale: '2',
    // A single red pin at the clinic's own coordinates - no second marker,
    // no path, no route (the brief's explicit "single static pin" rule).
    markers: `color:red|${center}`,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export function ClinicLocationMap({ latitude, longitude, label }: ClinicLocationMapProps) {
  // Read at render time, not module load, so a test's `vi.stubEnv` (applied
  // before render) takes effect - the same convention `pages/Login.tsx`'s
  // dev-Skip-button check already uses for `VITE_DEV_OPERATOR_PHONE`.
  const key = (import.meta.env?.VITE_GOOGLE_MAPS_STATIC_KEY as string | undefined)?.trim() || '';
  const [imgFailed, setImgFailed] = useState(false);

  if (!key || imgFailed) {
    return (
      <div className="clinic-map clinic-map--unavailable" role="img" aria-label="Map unavailable">
        <p className="empty__title">Map unavailable</p>
      </div>
    );
  }

  return (
    <div className="clinic-map">
      <img
        className="clinic-map__img"
        src={staticMapUrl(latitude, longitude, key)}
        alt={label ? `Map showing ${label}'s location` : "Map showing the clinic's location"}
        onError={() => setImgFailed(true)}
      />
    </div>
  );
}
