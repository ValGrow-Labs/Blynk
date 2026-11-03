import { useEffect, useId, useMemo, useState } from 'react';
import { smsOffers } from '../api/resources';
import type { SmsArea } from '../api/types';
import { AUDIENCE_LABEL } from '../lib/sms';
import { audienceFromState, type CustomDraft, type SmsAudienceState, type SmsExtraAudience } from '../lib/smsAudience';
import { CustomerGroupPicker } from './CustomerGroupPicker';
import './sms.css';

/** Kept from before customer groups (2026-10-24), plus the CUSTOM filters (2026-11-03). */
const EXTRAS: ReadonlyArray<{ id: SmsExtraAudience; label: string }> = [
  { id: 'ORDERED_30D', label: AUDIENCE_LABEL.ORDERED_30D },
  { id: 'ORDERED_90D', label: AUDIENCE_LABEL.ORDERED_90D },
  { id: 'CUSTOM', label: 'Custom filters' },
];

const MAX_AREAS_SHOWN = 100;

/**
 * "Send to" for SMS: the customer groups, the two older choices and "Custom filters" (areas, orders,
 * spend, language, points, last order). `countText` is the live count the page gets from the API.
 */
export function SmsAudiencePicker({
  name,
  state,
  onChange,
  countText,
}: {
  name: string;
  state: SmsAudienceState;
  onChange(next: SmsAudienceState): void;
  countText?: string | null;
}) {
  const custom = state.extra === 'CUSTOM';
  const problem = custom ? audienceFromState(state).problem : null;
  return (
    <>
      <CustomerGroupPicker
        name={name}
        draft={state.draft}
        onChange={(draft) => onChange({ ...state, draft, extra: null })}
        extras={EXTRAS}
        extraSelected={state.extra}
        onExtra={(id) => onChange({ ...state, extra: id as SmsExtraAudience })}
        countText={countText}
      />
      {custom ? (
        <CustomFilters value={state.custom} onChange={(next) => onChange({ ...state, custom: next })} problem={problem} />
      ) : null}
    </>
  );
}

function CustomFilters({ value, onChange, problem }: { value: CustomDraft; onChange(next: CustomDraft): void; problem: string | null }) {
  const set = (patch: Partial<CustomDraft>) => onChange({ ...value, ...patch });
  const num = (label: string, key: keyof CustomDraft, hint?: string) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="input"
        inputMode="numeric"
        aria-label={label}
        value={value[key] as string}
        onChange={(e) => set({ [key]: e.target.value } as Partial<CustomDraft>)}
      />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
  return (
    <fieldset className="choice sms-custom" aria-label="Custom filters">
      <p className="field__hint">Every filter you fill in must match. Leave a filter empty to ignore it.</p>
      <AreaPicker selected={value.areas} onChange={(areas) => set({ areas })} />
      <div className="sms-fields">
        {num('Orders (at least)', 'minOrders')}
        {num('Orders (at most)', 'maxOrders')}
      </div>
      <p className="field__hint">Orders means delivered orders, all time. At most 0 = never had one delivered.</p>
      <div className="sms-fields">
        {num('Spent at least (LKR)', 'minSpend')}
        {num('Spent in the last (days)', 'spendDays')}
      </div>
      <label className="field">
        <span className="field__label">SMS language</span>
        <select className="input" aria-label="SMS language" value={value.language} onChange={(e) => set({ language: e.target.value as CustomDraft['language'] })}>
          <option value="">Any</option>
          <option value="si">Sinhala</option>
          <option value="ta">Tamil</option>
          <option value="en">English</option>
          <option value="none">Not picked yet</option>
        </select>
      </label>
      <div className="sms-fields">
        {num('Points (at least)', 'minPoints')}
        {num('Points (at most)', 'maxPoints')}
      </div>
      <div className="sms-fields">
        {num('Last order at least (days ago)', 'lastOrderMin')}
        {num('Last order at most (days ago)', 'lastOrderMax')}
      </div>
      <p className="field__hint">A customer who never ordered does not match the last order filters.</p>
      {problem ? (
        <p className="field__error-text" role="alert">
          {problem}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Towns customers have saved addresses in (GET /admin/sms-offers/areas): tick the ones to send to. */
function AreaPicker({ selected, onChange }: { selected: string[]; onChange(next: string[]): void }) {
  const searchId = useId();
  const [areas, setAreas] = useState<SmsArea[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    smsOffers
      .areas()
      .then((list) => live && setAreas(list))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = (areas ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
    return list;
  }, [areas, q]);
  const toggle = (areaName: string) =>
    onChange(selected.includes(areaName) ? selected.filter((a) => a !== areaName) : [...selected, areaName]);

  return (
    <div className="sms-areas" role="group" aria-label="Areas">
      <label className="field__label" htmlFor={searchId}>
        Areas{selected.length ? ` (${selected.length} picked)` : ''}
      </label>
      <input
        id={searchId}
        className="input"
        type="search"
        placeholder="Search towns"
        aria-label="Search areas"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {areas === null && !failed ? <p className="field__hint">Loading areas&hellip;</p> : null}
      {failed ? <p className="field__hint">Could not load the list of areas.</p> : null}
      {areas && areas.length === 0 ? <p className="field__hint">No customer has a saved address yet.</p> : null}
      {areas && areas.length > 0 ? (
        <div className="sms-areas__list">
          {shown.slice(0, MAX_AREAS_SHOWN).map((a) => (
            <label key={a.name} className="sms-area">
              <input type="checkbox" checked={selected.includes(a.name)} onChange={() => toggle(a.name)} />
              <span className="sms-area__name">{a.name}</span>
              <span className="sms-area__count">{a.customers} customers</span>
            </label>
          ))}
          {shown.length === 0 ? <p className="field__hint sms-area">No town matches.</p> : null}
        </div>
      ) : null}
      {shown.length > MAX_AREAS_SHOWN ? <p className="field__hint">Showing the first {MAX_AREAS_SHOWN}: type to find the others.</p> : null}
      {selected.some((s) => !(areas ?? []).some((a) => a.name === s)) && areas ? (
        <p className="field__hint">Also picked: {selected.filter((s) => !areas.some((a) => a.name === s)).join(', ')}</p>
      ) : null}
    </div>
  );
}
