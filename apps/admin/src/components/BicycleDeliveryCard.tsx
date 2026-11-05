import { useEffect, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { BicycleDeliverySetting, BicycleRiderPayMode, DeliveryFeeSetting } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import {
  BICYCLE_NOT_READY_NOTICE,
  bicycleDraftsToInput,
  bicycleExampleText,
  bicycleFeeWarning,
  bicycleSummary,
  bicycleToDrafts,
  exampleKm,
  type BicycleDrafts,
  type BicycleErrors,
} from '../lib/bicycleDelivery';
import { ModeChoice } from './KmTierEditor';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';

const PAY_MODES: { value: BicycleRiderPayMode; label: string }[] = [
  { value: 'FIXED', label: 'Fixed amount per delivery' },
  { value: 'PER_KM', label: 'Base + per km' },
];

/**
 * Settings -> Bicycle delivery (2026-11-05): `GET|PUT /admin/settings/bicycle-delivery`. A separate, cheaper
 * delivery for short flat trips. Off by default; staff set the distance, the customer fee and what the rider
 * earns. A save sends every section whole. `ready: false` means migration 067 has not been run yet: the card
 * still saves, with a note for the owner. The motorbike warning only appears when the delivery-fee setting loads.
 */
export function BicycleDeliveryCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<BicycleDeliverySetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<BicycleDrafts>(() => bicycleToDrafts(null));
  const [errors, setErrors] = useState<BicycleErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [motorbike, setMotorbike] = useState<DeliveryFeeSetting | null>(null);
  const [saving, setSaving] = useState(false);

  function show(setting: BicycleDeliverySetting) {
    setCurrent(setting);
    setDrafts(bicycleToDrafts(setting));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getBicycleDelivery()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load bicycle delivery.')));
    // Only for the warning: a failure just means no warning.
    settingsApi
      .getDeliveryFee()
      .then((fee) => !cancelled && setMotorbike(fee))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<BicycleDrafts>) => setDrafts((d) => ({ ...d, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    const read = bicycleDraftsToInput(drafts, current);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setBicycleDelivery(read.input);
      show(updated);
      toast.success(`Bicycle delivery is ${bicycleSummary(updated)}.`);
    } catch (err) {
      setSaveError(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save bicycle delivery.'));
    } finally {
      setSaving(false);
    }
  }

  // The live example and warning follow the boxes while they hold valid numbers.
  const live = current ? bicycleDraftsToInput(drafts, current) : null;
  const liveInput = live && 'input' in live ? live.input : null;
  const km = liveInput ? exampleKm(liveInput.max_km) : null;
  const warning = liveInput ? bicycleFeeWarning(liveInput.max_km, liveInput.fee, motorbike) : null;
  const perKm = drafts.payMode === 'PER_KM';

  return (
    <section className="panel" id="bicycle-delivery" aria-label="Bicycle delivery">
      <h2 className="panel__title">Bicycle delivery</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading bicycle delivery" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            <Switch checked={drafts.enabled} onChange={(enabled) => set({ enabled })} label="Bicycle delivery" disabled={saving}>
              Bicycle delivery ({drafts.enabled ? 'on' : 'off'})
            </Switch>
          </p>
          {current.ready === false ? (
            <p className="field__error" data-testid="bicycle-not-ready">
              {BICYCLE_NOT_READY_NOTICE}
            </p>
          ) : null}
          <p className="form__note">
            Bicycle is for short, flat trips: cheaper for the customer and cheaper to pay the rider. When the address is
            within the distance below and a bicycle rider exists, customers can choose it at checkout. Staff still
            assign the rider, and only a bicycle rider can be given a bicycle order.
          </p>
          <Field label="Bicycle only up to (km)" hint="0.5 to 10 km, up to 1 decimal. Road distance, the same as the fee." error={errors.maxKm}>
            <input className="input rp-num" inputMode="decimal" value={drafts.maxKm} onChange={(e) => set({ maxKm: e.target.value })} />
          </Field>

          <h3 className="section-label">Customer pays</h3>
          <Field label="Base fee (LKR)" hint="0 to 1,000, up to 2 decimals." error={errors.feeBase}>
            <input className="input rp-num" inputMode="decimal" value={drafts.feeBase} onChange={(e) => set({ feeBase: e.target.value })} />
          </Field>
          <Field label="Base fee covers the first (km)" hint="0.5 to 10 km." error={errors.feeBaseKm}>
            <input className="input rp-num" inputMode="decimal" value={drafts.feeBaseKm} onChange={(e) => set({ feeBaseKm: e.target.value })} />
          </Field>
          <Field label="Then for each extra started km (LKR)" error={errors.feePerKm}>
            <input className="input rp-num" inputMode="decimal" value={drafts.feePerKm} onChange={(e) => set({ feePerKm: e.target.value })} />
          </Field>
          <Field label="Maximum fee (LKR, optional)" hint="Blank = no maximum." error={errors.feeMax}>
            <input className="input rp-num" inputMode="decimal" value={drafts.feeMax} onChange={(e) => set({ feeMax: e.target.value })} />
          </Field>

          <h3 className="section-label">Rider earns</h3>
          <ModeChoice label="Rider pay for a bicycle delivery" value={drafts.payMode} options={PAY_MODES} onChange={(payMode) => set({ payMode })} />
          {perKm ? (
            <>
              <Field label="Rider base pay (LKR)" error={errors.payBase}>
                <input className="input rp-num" inputMode="decimal" value={drafts.payBase} onChange={(e) => set({ payBase: e.target.value })} />
              </Field>
              <Field label="Rider pay for each km (LKR)" error={errors.payPerKm}>
                <input className="input rp-num" inputMode="decimal" value={drafts.payPerKm} onChange={(e) => set({ payPerKm: e.target.value })} />
              </Field>
              <Field label="Minimum rider pay (LKR, optional)" hint="Blank = no minimum." error={errors.payMin}>
                <input className="input rp-num" inputMode="decimal" value={drafts.payMin} onChange={(e) => set({ payMin: e.target.value })} />
              </Field>
            </>
          ) : (
            <Field label="Rider pay per delivery (LKR)" hint="0 to 1,000, up to 2 decimals." error={errors.payFixed}>
              <input className="input rp-num" inputMode="decimal" value={drafts.payFixed} onChange={(e) => set({ payFixed: e.target.value })} />
            </Field>
          )}
          <p className="form__note">
            This is what a commission rider earns on a bicycle order, instead of the usual share. Company riders stay
            salaried. Bonuses work as before.
          </p>

          {liveInput && km !== null ? (
            <p className="panel__body" data-testid="bicycle-example">
              <strong>{bicycleExampleText(km, liveInput.fee, liveInput.rider_pay)}</strong>
            </p>
          ) : (
            <p className="form__note" data-testid="bicycle-example">
              Fill in every amount to see an example.
            </p>
          )}
          {warning ? (
            <p className="field__error" data-testid="bicycle-warning">
              {warning}
            </p>
          ) : null}
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          {current.updated_at ? <p className="form__note">Changed {new Date(current.updated_at).toLocaleString()}.</p> : null}
          <p className="form__note">Changes apply to orders placed from now on. Orders already placed keep what they were placed with.</p>
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
