import { useEffect, useState, type FormEvent } from 'react';
import { smsRules } from '../api/resources';
import type { SmsLimitsSetting, SmsSendingSetting } from '../api/types';
import { formatWhen } from '../lib/smsCampaigns';
import { errorMessage } from '../lib/apiErrors';
import { smsOfferErrorMessage } from '../lib/smsOffers';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const whole = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
const nf = new Intl.NumberFormat('en-US');

/**
 * Settings -> Customers and rewards -> SMS sending rules (2026-11-03, owner's brother: "no time
 * limits"). GET|PUT /admin/settings/sms-sending (send at any time, quiet hours) and
 * GET|PUT /admin/settings/sms-limits (a cap per customer, a monthly budget). The admin decides:
 * nothing is limited unless switched on. Each half saves on its own.
 */
export function SmsSendingRulesCard() {
  const toast = useToast();
  const [sending, setSending] = useState<SmsSendingSetting | null>(null);
  const [limits, setLimits] = useState<SmsLimitsSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // When texts go out.
  const [anyTime, setAnyTime] = useState(true);
  const [quietOn, setQuietOn] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [sendingError, setSendingError] = useState<string | null>(null);
  const [savingSending, setSavingSending] = useState(false);

  // Limits.
  const [capOn, setCapOn] = useState(false);
  const [capMax, setCapMax] = useState('1');
  const [capDays, setCapDays] = useState('7');
  const [budgetOn, setBudgetOn] = useState(false);
  const [budgetParts, setBudgetParts] = useState('5000');
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [savingLimits, setSavingLimits] = useState(false);

  function showSending(s: SmsSendingSetting) {
    setSending(s);
    setAnyTime(s.any_time);
    setQuietOn(s.quiet_hours.enabled);
    setQuietStart(s.quiet_hours.start);
    setQuietEnd(s.quiet_hours.end);
  }

  function showLimits(l: SmsLimitsSetting) {
    setLimits(l);
    setCapOn(l.per_customer.enabled);
    setCapMax(String(l.per_customer.max));
    setCapDays(String(l.per_customer.days));
    setBudgetOn(l.monthly_budget.enabled);
    setBudgetParts(String(l.monthly_budget.parts));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([smsRules.getSending(), smsRules.getLimits()])
      .then(([s, l]) => {
        if (cancelled) return;
        showSending(s);
        showLimits(l);
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the SMS sending rules.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSending(event: FormEvent) {
    event.preventDefault();
    if (quietOn) {
      if (!HH_MM.test(quietStart) || !HH_MM.test(quietEnd)) return setSendingError('Pick the start and end of the quiet hours.');
      if (quietStart === quietEnd) return setSendingError('Quiet hours must start and end at different times.');
    }
    setSavingSending(true);
    setSendingError(null);
    try {
      const body = {
        any_time: anyTime,
        quiet_hours: {
          enabled: quietOn,
          start: HH_MM.test(quietStart) ? quietStart : '22:00',
          end: HH_MM.test(quietEnd) ? quietEnd : '07:00',
        },
      };
      showSending(await smsRules.setSending(body));
      toast.success('SMS sending times saved.');
    } catch (err) {
      setSendingError(smsOfferErrorMessage(err, 'Could not save the sending times.'));
    } finally {
      setSavingSending(false);
    }
  }

  async function saveLimits(event: FormEvent) {
    event.preventDefault();
    const max = whole(capMax);
    const days = whole(capDays);
    const parts = whole(budgetParts);
    if (capOn && (!Number.isInteger(max) || max < 1 || max > 100)) return setLimitsError('Texts per customer must be a whole number from 1 to 100.');
    if (capOn && (!Number.isInteger(days) || days < 1 || days > 365)) return setLimitsError('Days must be a whole number from 1 to 365.');
    if (budgetOn && (!Number.isInteger(parts) || parts < 1 || parts > 10_000_000)) {
      return setLimitsError('The monthly SMS budget must be a whole number of parts from 1 to 10,000,000.');
    }
    setSavingLimits(true);
    setLimitsError(null);
    try {
      const body = {
        per_customer: { enabled: capOn, max: Number.isInteger(max) ? max : (limits?.per_customer.max ?? 1), days: Number.isInteger(days) ? days : (limits?.per_customer.days ?? 7) },
        monthly_budget: { enabled: budgetOn, parts: Number.isInteger(parts) ? parts : (limits?.monthly_budget.parts ?? 5000) },
      };
      showLimits(await smsRules.setLimits(body));
      toast.success('SMS limits saved.');
    } catch (err) {
      setLimitsError(smsOfferErrorMessage(err, 'Could not save the limits.'));
    } finally {
      setSavingLimits(false);
    }
  }

  const usage = limits?.usage;
  const now = sending?.sending_now;

  return (
    <section className="panel" id="sms-sending-rules" aria-label="SMS sending rules">
      <h2 className="panel__title">SMS sending rules</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !sending || !limits ? (
        <Spinner label="Loading the SMS sending rules" />
      ) : (
        <>
          <p className="panel__body">
            The admin decides: nothing is limited unless you switch it on. These rules cover offers, scheduled and automatic texts, tests and
            birthday texts. Order and sign-in texts always go out.
          </p>
          <p className="form__note" data-testid="sms-sending-now">
            {now?.allowed === false
              ? `Right now texts are held: ${now.message ?? 'sending is not allowed at this hour.'}${now.resume_at ? ` They can go out again from ${formatWhen(now.resume_at)}.` : ''}`
              : 'Right now texts can go out.'}
          </p>

          <form className="form" aria-label="When texts go out" onSubmit={saveSending} noValidate>
            <h3 className="sms-rules__heading">When texts go out</h3>
            <p className="panel__body">
              <Switch checked={anyTime} onChange={setAnyTime} label="Send at any time">
                Send at any time ({anyTime ? 'on' : 'off'})
              </Switch>
            </p>
            <p className="form__note">
              On: texts go out at any hour, whether the store is open or closed. Off: they go out only while the store is open (the opening hours,
              and the &quot;texts on closed days&quot; choice in Opening hours).
            </p>
            <p className="panel__body">
              <Switch checked={quietOn} onChange={setQuietOn} label="Quiet hours">
                Quiet hours ({quietOn ? 'on' : 'off'})
              </Switch>
            </p>
            <div className="form__row">
              <Field label="Quiet from" hint="Sri Lanka time">
                <input className="input" type="time" aria-label="Quiet from" value={quietStart} disabled={!quietOn} onChange={(e) => setQuietStart(e.target.value)} />
              </Field>
              <Field label="Quiet until" hint="Can be after midnight">
                <input className="input" type="time" aria-label="Quiet until" value={quietEnd} disabled={!quietOn} onChange={(e) => setQuietEnd(e.target.value)} />
              </Field>
            </div>
            <p className="form__note">
              No texts between these times. A scheduled or automatic text that falls inside is held until quiet hours end; an offer you send right
              now is refused.
            </p>
            {sendingError ? (
              <p className="field__error" role="alert">
                {sendingError}
              </p>
            ) : null}
            {sending.updated_at ? <p className="form__note">Changed {new Date(sending.updated_at).toLocaleString()}.</p> : null}
            <div className="form__actions">
              <button type="submit" className="button" aria-label="Save sending times" disabled={savingSending}>
                {savingSending ? <Spinner label="Saving" /> : 'Save'}
              </button>
            </div>
          </form>

          <form className="form" aria-label="SMS limits" onSubmit={saveLimits} noValidate>
            <h3 className="sms-rules__heading">Limits</h3>
            <p className="panel__body">
              <Switch checked={capOn} onChange={setCapOn} label="Limit texts per customer">
                Limit texts per customer ({capOn ? 'on' : 'off'})
              </Switch>
            </p>
            <div className="form__row">
              <Field label="At most (texts)" hint="1 to 100">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  aria-label="Texts per customer"
                  value={capMax}
                  disabled={!capOn}
                  onChange={(e) => setCapMax(e.target.value)}
                />
              </Field>
              <Field label="In any (days)" hint="1 to 365">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  aria-label="Within days"
                  value={capDays}
                  disabled={!capOn}
                  onChange={(e) => setCapDays(e.target.value)}
                />
              </Field>
            </div>
            <p className="form__note">
              Counts offers and campaign texts, not order or sign-in texts. A customer who has had their share is skipped.
            </p>
            <p className="panel__body">
              <Switch checked={budgetOn} onChange={setBudgetOn} label="Monthly SMS budget">
                Monthly SMS budget ({budgetOn ? 'on' : 'off'})
              </Switch>
            </p>
            <Field label="SMS parts per month" hint="1 to 10,000,000. A long text or a Sinhala or Tamil text uses more parts.">
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                aria-label="SMS parts per month"
                value={budgetParts}
                disabled={!budgetOn}
                onChange={(e) => setBudgetParts(e.target.value)}
              />
            </Field>
            {usage ? (
              <p className="form__note" data-testid="sms-usage">
                This month ({usage.month}): {nf.format(usage.parts_used)} SMS parts used
                {usage.remaining_parts !== null ? `, ${nf.format(usage.remaining_parts)} left of ${nf.format(limits.monthly_budget.parts)}` : ' (no budget set)'}.
              </p>
            ) : null}
            <p className="form__note">
              When a send would go over the budget, an offer is refused and a scheduled or automatic run is skipped for this month.
            </p>
            {limitsError ? (
              <p className="field__error" role="alert">
                {limitsError}
              </p>
            ) : null}
            {limits.updated_at ? <p className="form__note">Changed {new Date(limits.updated_at).toLocaleString()}.</p> : null}
            <div className="form__actions">
              <button type="submit" className="button" aria-label="Save limits" disabled={savingLimits}>
                {savingLimits ? <Spinner label="Saving" /> : 'Save'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
