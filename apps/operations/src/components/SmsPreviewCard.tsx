import { useEffect, useId, useRef, useState } from 'react';
import type { SmsLanguage, SmsOfferEstimate } from '../api/types';
import { LANGUAGE_LABEL, languageNames, partsText } from '../lib/sms';
import { formatWhen } from '../lib/smsCampaigns';
import { Spinner } from './ui';
import './sms.css';

const ESTIMATE_DELAY_MS = 400;

/**
 * A live estimate: `fetch` is called shortly after `key` stops changing (a JSON text of what the
 * estimate depends on; '' = not ready, nothing is counted) and only the newest answer is kept.
 */
export function useLiveEstimate(
  key: string,
  fetch: (key: string) => Promise<SmsOfferEstimate>,
  errorText: (err: unknown) => string
): { estimate: SmsOfferEstimate | null; estimating: boolean; error: string | null } {
  const [estimate, setEstimate] = useState<SmsOfferEstimate | null>(null);
  const [estimating, setEstimating] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const call = useRef(fetch);
  call.current = fetch;
  const words = useRef(errorText);
  words.current = errorText;

  useEffect(() => {
    const id = ++latest.current;
    if (!key) {
      setEstimate(null);
      setError(null);
      setEstimating(false);
      return;
    }
    setEstimating(true);
    const timer = setTimeout(() => {
      call
        .current(key)
        .then((result) => {
          if (id !== latest.current) return;
          setEstimate(result);
          setError(null);
        })
        .catch((err) => {
          if (id !== latest.current) return;
          setEstimate(null);
          setError(words.current(err));
        })
        .finally(() => {
          if (id === latest.current) setEstimating(false);
        });
    }, ESTIMATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return { estimate, estimating, error };
}

/**
 * "Who gets it": the live numbers for an audience and its texts - customers (by language), left
 * out (turned offers off, already got their share, no phone), SMS parts, the monthly budget and
 * three real example texts. The warnings the sending rules add (quiet hours, budget) show here too.
 */
export function SmsPreviewCard({
  estimate,
  estimating,
  error,
  enabled,
  fallback,
  title = 'Who gets it',
  emptyText = 'No customer in this group can get offers.',
  idleText = 'Counting starts when who it goes to and the texts are filled in correctly.',
}: {
  estimate: SmsOfferEstimate | null;
  estimating: boolean;
  error: string | null;
  /** The languages offers are written in right now. */
  enabled: readonly SmsLanguage[];
  fallback: SmsLanguage;
  title?: string;
  emptyText?: string;
  /** Shown when nothing can be counted yet (a wrong number or text). */
  idleText?: string;
}) {
  const titleId = useId();
  const multilingual = enabled.length > 1;
  const missing = estimate?.missing_languages ?? [];
  const budget = estimate?.budget ?? null;
  const sending = estimate?.sending;
  return (
    <section className="card" aria-labelledby={titleId} aria-busy={estimating}>
      <h2 className="section-label" id={titleId}>
        {title}
      </h2>
      {estimate ? (
        <>
          <p className="card__row">
            <span className="card__label">Customers</span>
            <span className="card__value mono" data-testid="sms-recipients">
              {estimate.recipients}
            </span>
          </p>
          {multilingual ? (
            <>
              {enabled.map((l) => (
                <p key={l} className="card__row">
                  <span className="card__label">In {LANGUAGE_LABEL[l]}</span>
                  <span className="card__value mono">{estimate.by_language[l]}</span>
                </p>
              ))}
              <p className="card__row">
                <span className="card__label">No language picked (get {LANGUAGE_LABEL[fallback]})</span>
                <span className="card__value mono">{estimate.without_language}</span>
              </p>
            </>
          ) : null}
          <p className="card__row">
            <span className="card__label">Turned offers off</span>
            <span className="card__value mono">{estimate.opted_out}</span>
          </p>
          {estimate.skipped_capped ? (
            <p className="card__row">
              <span className="card__label">Skipped: already got enough texts</span>
              <span className="card__value mono" data-testid="sms-skipped-capped">
                {estimate.skipped_capped}
              </span>
            </p>
          ) : null}
          {estimate.skipped_no_phone ? (
            <p className="card__row">
              <span className="card__label">Skipped: no phone to text</span>
              <span className="card__value mono" data-testid="sms-skipped-no-phone">
                {estimate.skipped_no_phone}
              </span>
            </p>
          ) : null}
          <p className="card__row">
            <span className="card__label">SMS parts in total</span>
            <span className="card__value mono" data-testid="sms-parts-total">
              {estimate.sms_parts_total}
            </span>
          </p>
          {budget ? (
            <p className="card__row">
              <span className="card__label">Left in this month&rsquo;s budget</span>
              <span className="card__value mono" data-testid="sms-budget-left">
                {budget.remaining_parts} of {budget.monthly_parts}
              </span>
            </p>
          ) : null}
          {estimate.samples?.length ? (
            <div>
              <p className="field__label">Examples</p>
              <ul className="sms-samples" aria-label="Example texts">
                {estimate.samples.map((s, i) => (
                  <li key={i}>
                    <div className="sms-preview">{s.text}</div>
                    <span className="field__hint">
                      {LANGUAGE_LABEL[s.language]} &middot; {partsText(s.parts)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : estimating ? (
        <Spinner label="Counting customers" />
      ) : (
        <p className="field__hint">{idleText}</p>
      )}
      {missing.length > 0 ? (
        <p className="banner" role="alert">
          Write the {languageNames(missing)} text: {missing.map((l) => `${estimate!.by_language[l]} customers get ${LANGUAGE_LABEL[l]}`).join(', ')}.
        </p>
      ) : null}
      {budget?.would_exceed ? (
        <p className="banner" role="alert" data-testid="sms-budget-warning">
          This needs about {estimate!.sms_parts_total} SMS parts but only {budget.remaining_parts} are left in this month&rsquo;s budget of{' '}
          {budget.monthly_parts}. Raise the budget in SMS sending rules (More &gt; Customers and rewards), or send to fewer customers.
        </p>
      ) : null}
      {sending && !sending.allowed ? (
        <p className="banner" data-testid="sms-sending-blocked">
          {sending.message ?? 'SMS are not sent right now.'}
          {sending.resume_at ? ` Sending is allowed again at ${formatWhen(sending.resume_at)}.` : ''}
        </p>
      ) : null}
      {estimate && estimate.recipients === 0 ? <p className="banner banner--muted">{emptyText}</p> : null}
    </section>
  );
}
