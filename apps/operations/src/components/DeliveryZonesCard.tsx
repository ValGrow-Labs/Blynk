import { useEffect, useState, type FormEvent } from 'react';
import { mapsLink } from '../api/addresses';
import { settings } from '../api/resources';
import { catalogErrorMessage } from '../lib/catalog';
import {
  MAX_ZONES,
  MAX_ZONE_RADIUS_KM,
  MIN_ZONE_RADIUS_KM,
  PASTE_HINT,
  centreOf,
  draftsOf,
  newZoneDraft,
  pasteToCoordinates,
  zonesBody,
  zonesChanged,
  zonesSummary,
  type DeliveryZone,
  type ZoneDraft,
  type ZoneErrors,
} from '../lib/deliveryZones';
import { Spinner } from './ui';

/**
 * Extra delivery areas (2026-11-01): `GET|PUT /admin/settings/delivery-zones` (ADMIN, OPERATIONS; audited).
 * The main delivery area is the circle around the Blynk store (Delivery radius). An extra area is a separate
 * circle, for example Beruwala, that is added to it without making the main circle bigger. A customer can order
 * from an address inside the main circle or inside any area that is switched on. Save replaces the whole list.
 */
export function DeliveryZonesCard() {
  const [stored, setStored] = useState<DeliveryZone[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<ZoneDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, ZoneErrors>>({});
  const [pasteErrors, setPasteErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(zones: DeliveryZone[]) {
    setStored(zones);
    setRows(draftsOf(zones));
    setErrors({});
    setPasteErrors({});
  }

  useEffect(() => {
    settings.deliveryZones
      .get()
      .then((s) => show(s.zones ?? []))
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  function change(key: string, patch: Partial<ZoneDraft>) {
    setNotice(null);
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function paste(key: string, text: string) {
    if (!text.trim()) {
      setPasteErrors((e) => ({ ...e, [key]: '' }));
      return;
    }
    const p = pasteToCoordinates(text);
    if (!p) {
      setPasteErrors((e) => ({ ...e, [key]: PASTE_HINT }));
      return;
    }
    setPasteErrors((e) => ({ ...e, [key]: '' }));
    change(key, p);
  }

  function add() {
    setNotice(null);
    setFormError(null);
    setRows((list) => (list.length >= MAX_ZONES ? list : [...list, newZoneDraft()]));
  }

  function remove(key: string) {
    setNotice(null);
    setRows((list) => list.filter((r) => r.key !== key));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    const read = zonesBody(rows);
    if ('errors' in read) {
      setErrors(read.errors);
      setFormError(read.error);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const saved = await settings.deliveryZones.update(read.body.zones);
      show(saved.zones ?? []);
      setNotice(`Extra delivery areas saved. ${zonesSummary(saved.zones ?? [])}`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = stored ? zonesChanged(rows, stored) : false;

  return (
    <section className="card" id="delivery-zones" aria-labelledby="delivery-zones-title">
      <h2 className="section-label" id="delivery-zones-title">
        Extra delivery areas
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !stored ? (
        <Spinner label="Loading extra delivery areas" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          {rows.length === 0 ? <p className="quiet">No extra areas yet.</p> : null}
          <ul className="zone-list">
            {rows.map((row, index) => {
              const e = errors[row.key] ?? {};
              const centre = centreOf(row);
              const label = row.name.trim() || `Area ${index + 1}`;
              return (
                <li key={row.key} className="zone-row" aria-label={`Extra area: ${label}`}>
                  <div className="zone-row__head">
                    <label className="field zone-row__name">
                      <span className="field__label">Name</span>
                      <input
                        className="input"
                        value={row.name}
                        maxLength={60}
                        placeholder="Beruwala"
                        onChange={(ev) => change(row.key, { name: ev.target.value })}
                        aria-invalid={e.name ? true : undefined}
                      />
                      {e.name ? <span className="field__error">{e.name}</span> : null}
                    </label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.enabled}
                      aria-label={`${label} on or off`}
                      className="switch"
                      disabled={saving}
                      onClick={() => change(row.key, { enabled: !row.enabled })}
                    >
                      <span className="switch__thumb" aria-hidden="true" />
                    </button>
                  </div>
                  <label className="field">
                    <span className="field__label">Paste a Google Maps link or lat, lng</span>
                    <input
                      className="input"
                      aria-label={`Paste the centre of ${label}`}
                      placeholder="6.4759, 79.9842"
                      onChange={(ev) => paste(row.key, ev.target.value)}
                    />
                    {pasteErrors[row.key] ? <span className="field__error">{pasteErrors[row.key]}</span> : null}
                  </label>
                  <div className="fee-form">
                    <label className="field">
                      <span className="field__label">Latitude</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={row.lat}
                        aria-label={`Latitude of ${label}`}
                        onChange={(ev) => change(row.key, { lat: ev.target.value })}
                        aria-invalid={e.lat ? true : undefined}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Longitude</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={row.lng}
                        aria-label={`Longitude of ${label}`}
                        onChange={(ev) => change(row.key, { lng: ev.target.value })}
                        aria-invalid={e.lng ? true : undefined}
                      />
                    </label>
                    <label className="field">
                      <span className="field__label">Radius (km)</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={row.radius}
                        aria-label={`Radius of ${label} in km`}
                        onChange={(ev) => change(row.key, { radius: ev.target.value })}
                        aria-invalid={e.radius ? true : undefined}
                      />
                    </label>
                  </div>
                  {e.lat ? <span className="field__error">{e.lat}</span> : null}
                  {e.lng ? <span className="field__error">{e.lng}</span> : null}
                  {e.radius ? <span className="field__error">{e.radius}</span> : null}
                  <div className="zone-row__foot">
                    {centre ? (
                      <a className="link" href={mapsLink(centre.lat, centre.lng)} target="_blank" rel="noreferrer">
                        Open in Google Maps
                      </a>
                    ) : (
                      <span className="quiet">Add the centre to open it on the map.</span>
                    )}
                    <button type="button" className="button button--ghost" disabled={saving} onClick={() => remove(row.key)} aria-label={`Remove ${label}`}>
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <span className="field__hint">
            Radius {MIN_ZONE_RADIUS_KM} to {MAX_ZONE_RADIUS_KM} km, at most 2 decimals. Up to {MAX_ZONES} areas.
          </span>
          <div className="zone-actions">
            <button type="button" className="button button--ghost" onClick={add} disabled={saving || rows.length >= MAX_ZONES}>
              Add area
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
          {formError ? <p className="field__error" role="alert">{formError}</p> : null}
          {dirty && !notice ? (
            <p className="quiet" data-testid="zones-unsaved">
              Not saved yet. Tap Save to apply the changes.
            </p>
          ) : null}
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      <p className="page__note">
        The main delivery area is the circle around the Blynk store (Delivery radius). Extra areas add a separate circle, for example Beruwala, without making the main circle bigger. Customers can order from an address inside the circle or inside any area that is switched on.
      </p>
    </section>
  );
}
