import type { ReactNode } from 'react';
import {
  CUSTOMER_GROUPS,
  DAYS_RANGE,
  GROUP_LABEL,
  audienceFromDraft,
  type AudienceDraft,
  type CustomerGroup,
} from '../lib/customerGroups';
import { CustomAudienceFields } from './CustomAudienceFields';
import { Field } from './ui';

const DAYS_LABEL: Record<'LAPSED' | 'NEW' | 'BIG_SPENDERS', string> = {
  LAPSED: 'No order for (days)',
  NEW: 'Signed up in the last (days)',
  BIG_SPENDERS: 'Spent in the last (days)',
};

/**
 * "Send to" (owner, 2026-10-24): every customer, or one group - haven't ordered in N days, new
 * customers, big spenders, or signed up but never ordered. The page fetches the live count for the
 * chosen group and passes it in as `count`. Used on Notifications and SMS offers.
 * SMS offers and campaigns pass `groups` with CUSTOM added (2026-11-03): custom filters for
 * areas, orders, spend, language, points and days since the last order.
 */
export function CustomerGroupPicker({
  value,
  onChange,
  count,
  groups = CUSTOMER_GROUPS,
}: {
  value: AudienceDraft;
  onChange(next: AudienceDraft): void;
  /** The live count for the chosen group (or a spinner / error while counting). */
  count?: ReactNode;
  /** Which groups the "Send to" list offers (push broadcasts keep the five without CUSTOM). */
  groups?: readonly CustomerGroup[];
}) {
  const g = value.group;
  const problem = audienceFromDraft(value).problem;
  return (
    <div className="customer-group">
      <div className="form__row">
        <Field label="Send to">
          <select className="input" aria-label="Send to" value={g} onChange={(e) => onChange({ ...value, group: e.target.value as CustomerGroup })}>
            {groups.map((group) => (
              <option key={group} value={group}>
                {GROUP_LABEL[group]}
              </option>
            ))}
          </select>
        </Field>
        {g === 'LAPSED' || g === 'NEW' || g === 'BIG_SPENDERS' ? (
          <Field label={DAYS_LABEL[g]} hint={`${DAYS_RANGE[g].min} to ${DAYS_RANGE[g].max}`}>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              aria-label={DAYS_LABEL[g]}
              min={DAYS_RANGE[g].min}
              max={DAYS_RANGE[g].max}
              value={value.days[g]}
              onChange={(e) => onChange({ ...value, days: { ...value.days, [g]: e.target.value } })}
            />
          </Field>
        ) : null}
        {g === 'BIG_SPENDERS' ? (
          <Field label="Minimum spend (LKR)" hint="Delivered orders in those days">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              aria-label="Minimum spend (LKR)"
              min={1}
              value={value.min_spend_lkr}
              onChange={(e) => onChange({ ...value, min_spend_lkr: e.target.value })}
            />
          </Field>
        ) : null}
      </div>
      {g === 'CUSTOM' ? <CustomAudienceFields value={value.custom} onChange={(custom) => onChange({ ...value, custom })} /> : null}
      {problem ? (
        <p className="field__error" role="alert">
          {problem}
        </p>
      ) : count ? (
        <p className="form__note" data-testid="group-count" aria-live="polite">
          {count}
        </p>
      ) : null}
    </div>
  );
}
