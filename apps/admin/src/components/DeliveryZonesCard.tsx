import { useEffect, useRef, useState, type FormEvent } from 'react';
import { mapsLink } from '../api/addresses';
import { settings as settingsApi } from '../api/resources';
import type { DeliveryZonesSetting } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import {
  MAX_ZONES,
  MAX_ZONE_NAME,
  MAX_ZONE_RADIUS_KM,
  MIN_ZONE_RADIUS_KM,
  draftFromZone,
  draftPoint,
  enabledCount,
  newDraft,
  pointFromText,
  zonesBody,
  type ZoneDraft,
  type ZoneRowErrors,
} from '../lib/deliveryZones';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';
import './deliveryZones.css';

/**
 * Settings -> Extra delivery areas (2026-11-01; docs/superpowers/plans/2026-11-01-extra-delivery-areas.md):
 * `GET|PUT /admin/settings/delivery-zones`. The main delivery area is the circle around the store (the Delivery
 * radius card above); each extra area is a separate circle (Beruwala first, off until switched on) so the main circle
 * does not have to grow. Save sends the whole list.
 */
export function DeliveryZonesCard() {
  const toast = useToast();
  const keys = useRef(0);
  const nextKey = () => `z${(keys.current += 1)}`;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<ZoneDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, ZoneRowErrors>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  function show(setting: DeliveryZonesSetting) {
    setRows(setting.zones.map((z) => draftFromZone(z, nextKey())));
    setErrors({});
    setListError(null);
    setSaveError(null);
    setDirty(false);
    setLoaded(true);
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getDeliveryZones()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the extra delivery areas.')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function change(key: string, patch: Partial<ZoneDraft>, clear?: keyof ZoneRowErrors) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (clear) setErrors((e) => ({ ...e, [key]: { ...e[key], [clear]: undefined } }));
    setDirty(true);
  }

  function fromText(key: string, text: string): boolean {
    const point = pointFromText(text);
    if (!point) return false;
    setRows((list) => list.map((r) => (r.key === key ? { ...r, lat: String(point.lat), lng: String(point.lng) } : r)));
    setErrors((e) => ({ ...e, [key]: { ...e[key], lat: undefined, lng: undefined } }));
    setDirty(true);
    return true;
  }

  function add() {
    setRows((list) => [...list, newDraft(nextKey())]);
    setDirty(true);
  }

  function remove(key: string) {
    setRows((list) => list.filter((r) => r.key !== key));
    setErrors((e) => {
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
    setDirty(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const read = zonesBody(rows);
    if ('errors' in read) {
      setErrors(read.errors);
      setListError(read.listError ?? null);
      return;
    }
    setErrors({});
    setListError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setDeliveryZones(read.body.zones);
      show(updated);
      const on = enabledCount(updated.zones);
      toast.success(on === 0 ? 'Extra delivery areas saved. None is switched on.' : `Extra delivery areas saved. ${on} switched on.`);
    } catch (err) {
      setSaveError(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save the extra delivery areas.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="delivery-zones" aria-label="Extra delivery areas">
      <h2 className="panel__title">Extra delivery areas</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !loaded ? (
        <Spinner label="Loading the extra delivery areas" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            The main delivery area is the circle around the Blynk store (Delivery radius). Extra areas add a separate
            circle, for example Beruwala, without making the main circle bigger. Customers can order from an address
            inside the circle or inside any area that is switched on.
          </p>
          {rows.length === 0 ? <p className="form__note">No extra areas yet.</p> : null}
          <div className="dz-list">
            {rows.map((row, index) => {
              const rowErrors = errors[row.key] ?? {};
              const point = draftPoint(row);
              const title = row.name.trim() || `Area ${index + 1}`;
              return (
                <div key={row.key} className="dz-row" role="group" aria-label={title}>
                  <div className="dz-row__head">
                    <Switch checked={row.enabled} onChange={(next) => change(row.key, { enabled: next })} label={`${title} switched on`}>
                      {row.enabled ? 'On' : 'Off'}
                    </Switch>
                    <button type="button" className="button button--ghost button--sm" aria-label={`Remove ${title}`} onClick={() => remove(row.key)}>
                      Remove
                    </button>
                  </div>
                  <Field label="Name" error={rowErrors.name}>
                    <input
                      className="input"
                      maxLength={MAX_ZONE_NAME + 10}
                      placeholder="Beruwala"
                      value={row.name}
                      onChange={(e) => change(row.key, { name: e.target.value }, 'name')}
                    />
                  </Field>
                  <label className="field">
                    <span className="field__label">Paste from Google Maps</span>
                    <input
                      className="input"
                      aria-label={`Paste coordinates for ${title}`}
                      placeholder="6.4759, 79.9842 or a Google Maps link"
                      defaultValue=""
                      onChange={(e) => fromText(row.key, e.target.value)}
                    />
                    <span className="field__hint">Paste a Google Maps link or the two numbers shown when you press and hold the centre of the area.</span>
                  </label>
                  <div className="dz-grid">
                    <Field label="Latitude" error={rowErrors.lat}>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={row.lat}
                        onChange={(e) => {
                          const v = e.target.value;
                          // A "lat, lng" pair or a maps link pasted into the first box fills both.
                          if (!/^-?\d*\.?\d*$/.test(v.trim()) && fromText(row.key, v)) return;
                          change(row.key, { lat: v }, 'lat');
                        }}
                      />
                    </Field>
                    <Field label="Longitude" error={rowErrors.lng}>
                      <input className="input" inputMode="decimal" value={row.lng} onChange={(e) => change(row.key, { lng: e.target.value }, 'lng')} />
                    </Field>
                    <Field label="Radius (km)" hint={`${MIN_ZONE_RADIUS_KM} to ${MAX_ZONE_RADIUS_KM} km.`} error={rowErrors.radius}>
                      <input className="input rp-num" inputMode="decimal" value={row.radius} onChange={(e) => change(row.key, { radius: e.target.value }, 'radius')} />
                    </Field>
                  </div>
                  {point ? (
                    <a className="button button--ghost button--sm" href={mapsLink(point.lat, point.lng)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} in Google Maps`}>
                      Open in Google Maps
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
          {listError ? <p className="field__error">{listError}</p> : null}
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="button" className="button button--ghost" onClick={add} disabled={rows.length >= MAX_ZONES}>
              Add area
            </button>
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
            <span className="form__note" role="status" data-testid="delivery-zones-state">
              {dirty ? 'Not saved yet.' : 'Saved.'}
            </span>
          </div>
        </form>
      )}
    </section>
  );
}
