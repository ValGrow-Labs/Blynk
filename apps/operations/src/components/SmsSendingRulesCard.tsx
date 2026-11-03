import { useEffect, useState, type FormEvent } from 'react';
import { smsSettings } from '../api/resources';
import type { SmsLimitRules, SmsLimitsInput, SmsSendingInput, SmsSendingRules } from '../api/types';
import { formatWhen } from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';
import { Spinner } from './ui';
import './sms.css';

/**
 * SMS sending rules (owner's brother, 2026-11-03: "no time limits"; `GET|PUT /admin/settings/sms-sending`
 * and `/admin/settings/sms-limits`). You decide: nothing is limited unless you switch it on. Offers,
 * scheduled and automatic SMS and the birthday text all follow these rules. Same settings as Admin.
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const num = new Intl.NumberFormat('en-US');

interface Form {
  anyTime: boolean;
  quietOn: boolean;
  quietStart: string;
  quietEnd: string;
  capOn: boolean;
  capMax: string;
  capDays: string;
  budgetOn: boolean;
  budgetParts: string;
}

const formOf = (s: SmsSendingRules, l: SmsLimitRules): Form => ({
  anyTime: s.any_time,
  quietOn: s.quiet_hours.enabled,
  quietStart: s.quiet_hours.start,
  quietEnd: s.quiet_hours.end,
  capOn: l.per_customer.enabled,
  capMax: String(l.per_customer.max),
  capDays: String(l.per_customer.days),
  budgetOn: l.monthly_budget.enabled,
  budgetParts: String(l.monthly_budget.parts),
});

function whole(raw: string, label: string, min: number, max: number): { value: number } | { error: string } {
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < min || Number(text) > max) {
    return { error: `${label} must be a whole number from ${num.format(min)} to ${num.format(max)}.` };
  }
  return { value: Number(text) };
}

function Switch({ label, checked, onToggle }: { label: string; checked: boolean; onToggle(): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={onToggle}>
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}

export function SmsSendingRulesCard() {
  const [sending, setSending] = useState<SmsSendingRules | null>(null);
  const [limits, setLimits] = useState<SmsLimitRules | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: SmsSendingRules, l: SmsLimitRules) {
    setSending(s);
    setLimits(l);
    setForm(formOf(s, l));
  }

  useEffect(() => {
    let live = true;
    Promise.all([smsSettings.sending.get(), smsSettings.limits.get()])
      .then(([s, l]) => live && show(s, l))
      .catch((err) => live && setLoadError(smsErrorMessage(err, 'Could not load the SMS sending rules.')));
    return () => {
      live = false;
    };
  }, []);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || !sending || !limits) return;
    setNotice(null);

    if (form.quietOn) {
      if (!HH_MM.test(form.quietStart) || !HH_MM.test(form.quietEnd)) {
        setError('Pick the start and the end of the quiet hours.');
        return;
      }
      if (form.quietStart === form.quietEnd) {
        setError('Quiet hours must start and end at different times.');
        return;
      }
    }
    const max = whole(form.capMax, 'Texts per customer', 1, 100);
    const days = whole(form.capDays, 'Days', 1, 365);
    const parts = whole(form.budgetParts, 'SMS parts per month', 1, 10_000_000);
    if (form.capOn) {
      if ('error' in max) return setError(max.error);
      if ('error' in days) return setError(days.error);
    }
    if (form.budgetOn && 'error' in parts) return setError(parts.error);

    // Only what changed is sent: the stored value of the other group stays as it is.
    const sendingBody: SmsSendingInput = {
      any_time: form.anyTime,
      quiet_hours: { enabled: form.quietOn, start: form.quietStart, end: form.quietEnd },
    };
    const sendingChanged =
      form.anyTime !== sending.any_time ||
      form.quietOn !== sending.quiet_hours.enabled ||
      form.quietStart !== sending.quiet_hours.start ||
      form.quietEnd !== sending.quiet_hours.end;
    const limitsBody: SmsLimitsInput = {
      per_customer: {
        enabled: form.capOn,
        ...('value' in max ? { max: max.value } : {}),
        ...('value' in days ? { days: days.value } : {}),
      },
      monthly_budget: { enabled: form.budgetOn, ...('value' in parts ? { parts: parts.value } : {}) },
    };
    const limitsChanged =
      form.capOn !== limits.per_customer.enabled ||
      ('value' in max && max.value !== limits.per_customer.max) ||
      ('value' in days && days.value !== limits.per_customer.days) ||
      form.budgetOn !== limits.monthly_budget.enabled ||
      ('value' in parts && parts.value !== limits.monthly_budget.parts);
    if (!sendingChanged && !limitsChanged) {
      setError(null);
      setNotice('Nothing changed.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      let nextSending = sending;
      let nextLimits = limits;
      if (sendingChanged) nextSending = await smsSettings.sending.update(sendingBody);
      if (limitsChanged) nextLimits = await smsSettings.limits.update(limitsBody);
      show(nextSending, nextLimits);
      setNotice('SMS sending rules saved.');
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not save the SMS sending rules.'));
    } finally {
      setSaving(false);
    }
  }

  const updated = [sending?.updated_at, limits?.updated_at].filter(Boolean).sort().at(-1) ?? null;
  const usage = limits?.usage;

  return (
    <section className="card sms-rules" id="sms-sending-rules" aria-labelledby="sms-sending-rules-title">
      <h2 className="section-label" id="sms-sending-rules-title">
        SMS sending rules
      </h2>
      <p className="quiet">You decide: nothing is limited unless you switch it on. These rules cover offers, scheduled and automatic SMS and the birthday text.</p>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !form || !sending ? (
        <Spinner label="Loading the SMS sending rules" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="quiet" data-testid="sms-sending-now">
            {sending.sending_now.allowed
              ? 'Right now: SMS can be sent.'
              : `Right now: ${sending.sending_now.message ?? 'SMS are held.'}${sending.sending_now.resume_at ? ` Sending is allowed again at ${formatWhen(sending.sending_now.resume_at)}.` : ''}`}
          </p>

          <div className="sms-rule">
            <div className="sms-switch-row">
              <span>
                <strong>Send at any time</strong>
                <em>
                  {form.anyTime
                    ? 'SMS go out whenever they are due, day or night.'
                    : 'SMS go out only during opening hours (and on closed days only if Opening hours allows it).'}
                </em>
              </span>
              <Switch label="Send at any time" checked={form.anyTime} onToggle={() => set({ anyTime: !form.anyTime })} />
            </div>
          </div>

          <div className="sms-rule">
            <div className="sms-switch-row">
              <span>
                <strong>Quiet hours</strong>
                <em>No SMS between these times (Sri Lanka time). A scheduled one waits until the quiet hours end; an offer sent now is refused.</em>
              </span>
              <Switch label="Quiet hours" checked={form.quietOn} onToggle={() => set({ quietOn: !form.quietOn })} />
            </div>
            {form.quietOn ? (
              <div className="sms-fields">
                <label className="field">
                  <span className="field__label">Quiet from</span>
                  <input className="input" type="time" aria-label="Quiet hours start" value={form.quietStart} onChange={(e) => set({ quietStart: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">Quiet until</span>
                  <input className="input" type="time" aria-label="Quiet hours end" value={form.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} />
                </label>
              </div>
            ) : null}
          </div>

          <div className="sms-rule">
            <div className="sms-switch-row">
              <span>
                <strong>Limit texts per customer</strong>
                <em>A customer who already got this many offer SMS in the period is skipped. Order and sign-in texts do not count.</em>
              </span>
              <Switch label="Limit texts per customer" checked={form.capOn} onToggle={() => set({ capOn: !form.capOn })} />
            </div>
            {form.capOn ? (
              <div className="sms-fields">
                <label className="field">
                  <span className="field__label">Most texts</span>
                  <input className="input" inputMode="numeric" aria-label="Most texts per customer" value={form.capMax} onChange={(e) => set({ capMax: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field__label">In this many days</span>
                  <input className="input" inputMode="numeric" aria-label="Number of days for the limit" value={form.capDays} onChange={(e) => set({ capDays: e.target.value })} />
                </label>
              </div>
            ) : null}
          </div>

          <div className="sms-rule">
            <div className="sms-switch-row">
              <span>
                <strong>Monthly SMS budget</strong>
                <em>Offers and campaigns stop when this month&rsquo;s SMS parts are used up. A scheduled one is skipped and tries again next time.</em>
              </span>
              <Switch label="Monthly SMS budget" checked={form.budgetOn} onToggle={() => set({ budgetOn: !form.budgetOn })} />
            </div>
            {form.budgetOn ? (
              <label className="field">
                <span className="field__label">SMS parts per month</span>
                <input className="input" inputMode="numeric" aria-label="SMS parts per month" value={form.budgetParts} onChange={(e) => set({ budgetParts: e.target.value })} />
              </label>
            ) : null}
            {usage ? (
              <p className="quiet" data-testid="sms-usage">
                This month ({usage.month}): {num.format(usage.parts_used)} SMS parts used
                {usage.remaining_parts !== null ? `, ${num.format(usage.remaining_parts)} left` : ''}.
              </p>
            ) : null}
          </div>

          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {updated ? <p className="quiet">Last changed {formatWhen(updated)}</p> : null}
    </section>
  );
}
