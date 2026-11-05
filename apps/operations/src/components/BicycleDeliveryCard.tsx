import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { BicycleDeliverySetting, BicycleRiderPayMode, DeliveryFeeSetting } from '../api/types';
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
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { TierModeChoice } from './KmTierEditor';
import { Spinner } from './ui';
import './bicycle.css';

const PAY_MODES: ReadonlyArray<{ id: BicycleRiderPayMode; text: string }> = [
  { id: 'FIXED', text: 'Fixed amount per delivery' },
  { id: 'PER_KM', text: 'Base + per km' },
];

/** One labelled number box with its hint and its own error line. */
function NumberField({
  label,
  hint,
  value,
  error,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  error?: string;
  onChange(next: string): void;
}) {
  return (
    <div className="field">
      <label className="field">
        <span className="field__label">{label}</span>
        <input
          className="input"
          inputMode="decimal"
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
    </div>
  );
}

/**
 * Bicycle delivery (2026-11-05): `GET|PUT /admin/settings/bicycle-delivery`. A separate, cheaper delivery for
 * short flat trips. Off by default; staff set the distance, the customer fee and what the rider earns. A save
 * sends every section whole. `ready: false` means migration 067 has not been run yet: the card still saves,
 * with a note for the owner. The motorbike warning only appears when the delivery-fee setting loads.
 */
export function BicycleDeliveryCard() {
  const [current, setCurrent] = useState<BicycleDeliverySetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<BicycleDrafts>(() => bicycleToDrafts(null));
  const [errors, setErrors] = useState<BicycleErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [motorbike, setMotorbike] = useState<DeliveryFeeSetting | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: BicycleDeliverySetting) {
    setCurrent(s);
    setDrafts(bicycleToDrafts(s));
  }

  useEffect(() => {
    let cancelled = false;
    settings.bicycleDelivery
      .get()
      .then((s) => !cancelled && show(s))
      .catch((err) => !cancelled && setLoadError(catalogErrorMessage(err)));
    // Only for the warning: a failure just means no warning.
    settings.deliveryFee
      .get()
      .then((fee) => !cancelled && setMotorbike(fee))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<BicycleDrafts>) => setDrafts((d) => ({ ...d, ...patch }));

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const read = bicycleDraftsToInput(drafts, current);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.bicycleDelivery.update(read.input);
      show(saved);
      setNotice(`Bicycle delivery is ${bicycleSummary(saved)}.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  // The live example and warning follow the boxes while they hold valid numbers.
  const live = current ? bicycleDraftsToInput(drafts, current) : null;
  const liveInput = live && 'input' in live ? live.input : null;
  const warning = liveInput ? bicycleFeeWarning(liveInput.max_km, liveInput.fee, motorbike) : null;
  const perKm = drafts.payMode === 'PER_KM';

  return (
    <section className="card" id="bicycle-delivery" aria-labelledby="bicycle-delivery-title">
      <h2 className="section-label" id="bicycle-delivery-title">
        Bicycle delivery
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading bicycle delivery" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={drafts.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span>
              <strong>Bicycle delivery</strong>
              <em>
                For short, flat trips: cheaper for the customer, cheaper to pay the rider. Customers can choose it at
                checkout when the address is within the distance below and a bicycle rider exists. You still assign the
                rider.
              </em>
            </span>
          </label>
          {current.ready === false ? (
            <p className="field__error" data-testid="bicycle-not-ready">
              {BICYCLE_NOT_READY_NOTICE}
            </p>
          ) : null}
          <NumberField
            label="Bicycle only up to (km)"
            hint="0.5 to 10 km, at most 1 decimal. Road distance, the same as the fee."
            value={drafts.maxKm}
            error={errors.maxKm}
            onChange={(maxKm) => set({ maxKm })}
          />

          <h3 className="section-label">Customer pays</h3>
          <NumberField
            label="Base fee (LKR)"
            hint="0 to 1,000."
            value={drafts.feeBase}
            error={errors.feeBase}
            onChange={(feeBase) => set({ feeBase })}
          />
          <NumberField
            label="Base fee covers the first (km)"
            hint="0.5 to 10 km."
            value={drafts.feeBaseKm}
            error={errors.feeBaseKm}
            onChange={(feeBaseKm) => set({ feeBaseKm })}
          />
          <NumberField
            label="Then for each extra started km (LKR)"
            value={drafts.feePerKm}
            error={errors.feePerKm}
            onChange={(feePerKm) => set({ feePerKm })}
          />
          <NumberField
            label="Maximum fee (LKR, optional)"
            hint="Blank = no maximum."
            value={drafts.feeMax}
            error={errors.feeMax}
            onChange={(feeMax) => set({ feeMax })}
          />

          <h3 className="section-label">Rider earns</h3>
          <TierModeChoice
            label="Rider pay for a bicycle delivery"
            options={PAY_MODES}
            value={drafts.payMode}
            onPick={(payMode) => set({ payMode })}
          />
          {perKm ? (
            <>
              <NumberField label="Rider base pay (LKR)" value={drafts.payBase} error={errors.payBase} onChange={(payBase) => set({ payBase })} />
              <NumberField
                label="Rider pay for each km (LKR)"
                value={drafts.payPerKm}
                error={errors.payPerKm}
                onChange={(payPerKm) => set({ payPerKm })}
              />
              <NumberField
                label="Minimum rider pay (LKR, optional)"
                hint="Blank = no minimum."
                value={drafts.payMin}
                error={errors.payMin}
                onChange={(payMin) => set({ payMin })}
              />
            </>
          ) : (
            <NumberField
              label="Rider pay per delivery (LKR)"
              hint="0 to 1,000."
              value={drafts.payFixed}
              error={errors.payFixed}
              onChange={(payFixed) => set({ payFixed })}
            />
          )}
          <p className="page__note">
            This is what a commission rider earns on a bicycle order, instead of the usual share. Company riders stay
            salaried.
          </p>

          {liveInput ? (
            <p className="bicycle-example" data-testid="bicycle-example">
              {bicycleExampleText(exampleKm(liveInput.max_km), liveInput.fee, liveInput.rider_pay)}
            </p>
          ) : (
            <p className="quiet" data-testid="bicycle-example">
              Fill in every amount to see an example.
            </p>
          )}
          {warning ? (
            <p className="field__error" data-testid="bicycle-warning">
              {warning}
            </p>
          ) : null}
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">Changes apply to orders placed from now on. Orders already placed keep what they were placed with.</p>
    </section>
  );
}
