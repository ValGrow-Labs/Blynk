import type { SmsLanguage, SmsOfferEstimate } from '../api/types';
import { formatWhen } from '../lib/smsCampaigns';
import { LANGUAGE_LABEL, SMS_LANGUAGES, partsLabel } from '../lib/smsOffers';
import { Spinner } from './ui';
import type { Estimate } from './useSmsEstimate';

/**
 * The live numbers of an SMS offer or campaign (the offer estimate and the campaign preview answer
 * with the same shape): recipients, who is left out, parts, the month's budget, sample texts and
 * whether sending is allowed right now.
 */
export function EstimateFigures({
  estimate,
  fallback,
  stale,
  multilingual,
}: {
  estimate: SmsOfferEstimate;
  fallback: SmsLanguage;
  stale: boolean;
  /** With one language on, everyone gets it: no per-language breakdown. */
  multilingual: boolean;
}) {
  return (
    <dl className={stale ? 'sms-offers__figures is-stale' : 'sms-offers__figures'} aria-busy={stale}>
      <div>
        <dt>Recipients</dt>
        <dd className="mono">{estimate.recipients}</dd>
      </div>
      {multilingual ? (
        <>
          {SMS_LANGUAGES.filter((l) => estimate.languages?.includes(l) ?? true).map((l) => (
            <div key={l}>
              <dt>{LANGUAGE_LABEL[l]}</dt>
              <dd className="mono">{estimate.by_language[l]}</dd>
            </div>
          ))}
          <div>
            <dt>No language (get {LANGUAGE_LABEL[fallback]})</dt>
            <dd className="mono">{estimate.without_language}</dd>
          </div>
        </>
      ) : null}
      <div>
        <dt>Opted out</dt>
        <dd className="mono">{estimate.opted_out}</dd>
      </div>
      {estimate.skipped_capped ? (
        <div>
          <dt>Skipped: already got their share</dt>
          <dd className="mono">{estimate.skipped_capped}</dd>
        </div>
      ) : null}
      {estimate.skipped_no_phone ? (
        <div>
          <dt>Skipped: no usable number</dt>
          <dd className="mono">{estimate.skipped_no_phone}</dd>
        </div>
      ) : null}
      <div>
        <dt>SMS parts</dt>
        <dd className="mono">{estimate.sms_parts_total}</dd>
      </div>
      {estimate.budget ? (
        <div>
          <dt>Budget left this month</dt>
          <dd className="mono">
            {estimate.budget.remaining_parts} of {estimate.budget.monthly_parts}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Budget and sending-rule warnings, and the sample texts. */
export function EstimateNotes({ estimate }: { estimate: SmsOfferEstimate }) {
  const samples = estimate.samples ?? [];
  return (
    <>
      {estimate.budget?.would_exceed ? (
        <p className="sms-offers__warning" data-testid="budget-warning">
          This needs {estimate.sms_parts_total} SMS parts but only {estimate.budget.remaining_parts} are left in this month&apos;s budget of{' '}
          {estimate.budget.monthly_parts}. Raise the budget in SMS sending rules, or send to fewer customers.
        </p>
      ) : null}
      {estimate.sending && !estimate.sending.allowed ? (
        <p className="sms-offers__notice" data-testid="sending-notice">
          {estimate.sending.message ?? 'Texts cannot be sent right now.'}
          {estimate.sending.resume_at ? ` They can go out again from ${formatWhen(estimate.sending.resume_at)}.` : ''}
        </p>
      ) : null}
      {samples.length ? (
        <div className="preview" aria-label="Sample texts">
          <p className="preview__label">Sample texts</p>
          {samples.map((s, i) => (
            <p key={i} className="sms-offers__preview sms-offers__sample">
              <span className="sms-offers__sample-meta">
                {LANGUAGE_LABEL[s.language]}, {partsLabel(s.parts)}
              </span>
              {s.text}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Spinner, error or the figures and notes for one estimate. */
export function EstimateBody({
  estimate,
  currentKey,
  fallback,
  multilingual,
  spinnerLabel = 'Counting customers',
}: {
  estimate: Estimate;
  /** The key of the inputs on screen now; an older answer is shown faded. */
  currentKey: string;
  fallback: SmsLanguage;
  multilingual: boolean;
  spinnerLabel?: string;
}) {
  if (estimate === null) return <Spinner label={spinnerLabel} />;
  if ('error' in estimate) return <p className="field__error">{estimate.error}</p>;
  return (
    <>
      <EstimateFigures estimate={estimate.data} fallback={fallback} stale={estimate.key !== currentKey} multilingual={multilingual} />
      <EstimateNotes estimate={estimate.data} />
    </>
  );
}
