import { useEffect, useState } from 'react';
import { smsOffers } from '../api/resources';
import type { SmsArea } from '../api/types';
import type { CustomDraft } from '../lib/customerGroups';
import { Field } from './ui';

/**
 * The CUSTOM audience's filters (2026-11-03): all optional, a customer must match every one that
 * is filled in. Areas come from the towns customers have addresses in (GET /admin/sms-offers/areas).
 */
export function CustomAudienceFields({ value, onChange }: { value: CustomDraft; onChange(next: CustomDraft): void }) {
  const [areas, setAreas] = useState<SmsArea[] | null>(null);
  const [areasError, setAreasError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    smsOffers
      .areas()
      .then((list) => !cancelled && setAreas(list))
      .catch(() => !cancelled && setAreasError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<CustomDraft>) => onChange({ ...value, ...patch });
  const text = (key: keyof CustomDraft & string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={label}
        value={value[key] as string}
        onChange={(e) => set({ [key]: e.target.value } as Partial<CustomDraft>)}
      />
    </Field>
  );

  const left = (areas ?? []).filter((a) => !value.areas.some((chosen) => chosen.toLowerCase() === a.name.toLowerCase()));

  return (
    <div className="custom-audience" role="group" aria-label="Custom filters">
      <p className="form__note">Every filter you fill in must match. Leave a filter empty to ignore it.</p>

      <div className="field">
        <span className="field__label">Areas</span>
        {value.areas.length ? (
          <ul className="chip-list" aria-label="Chosen areas">
            {value.areas.map((area) => (
              <li key={area} className="chip">
                {area}
                <button
                  type="button"
                  className="chip__remove"
                  aria-label={`Remove ${area}`}
                  onClick={() => set({ areas: value.areas.filter((a) => a !== area) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <select
          className="input"
          aria-label="Add an area"
          value=""
          disabled={!areas || left.length === 0}
          onChange={(e) => e.target.value && set({ areas: [...value.areas, e.target.value] })}
        >
          <option value="">{areas === null ? (areasError ? 'Could not load the areas' : 'Loading areas…') : left.length ? 'Add an area…' : 'No more areas'}</option>
          {left.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name} ({a.customers} {a.customers === 1 ? 'customer' : 'customers'})
            </option>
          ))}
        </select>
        <span className="field__hint">Customers with a delivery address in one of these towns. None chosen = everywhere.</span>
      </div>

      <div className="form__row">
        {text('min_orders', 'Minimum orders', 'Delivered orders, all time')}
        {text('max_orders', 'Maximum orders', '0 = never had one delivered')}
      </div>
      <div className="form__row">
        {text('min_spend_lkr', 'Spent at least (LKR)', 'Delivered orders in the days below')}
        {text('spend_days', 'Spend counted over the last (days)', '1 to 365, default 90')}
      </div>
      <div className="form__row">
        <Field label="SMS language">
          <select
            className="input"
            aria-label="SMS language"
            value={value.language}
            onChange={(e) => set({ language: e.target.value as CustomDraft['language'] })}
          >
            <option value="">Any</option>
            <option value="si">Sinhala</option>
            <option value="ta">Tamil</option>
            <option value="en">English</option>
            <option value="none">No language picked</option>
          </select>
        </Field>
      </div>
      <div className="form__row">
        {text('min_points', 'Minimum points', 'Blynk Points held now')}
        {text('max_points', 'Maximum points')}
      </div>
      <div className="form__row">
        {text('last_order_days_min', 'Last order at least (days ago)', 'Customers who never ordered do not match')}
        {text('last_order_days_max', 'Last order at most (days ago)')}
      </div>
    </div>
  );
}
