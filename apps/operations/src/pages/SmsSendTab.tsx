import { useCallback, useEffect, useId, useState } from 'react';
import { smsOffers } from '../api/resources';
import type { SmsLanguage, SmsOffer, SmsOfferInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SmsAudiencePicker } from '../components/SmsAudiencePicker';
import { SmsPreviewCard, useLiveEstimate } from '../components/SmsPreviewCard';
import { SmsTemplatePicker, useSmsTemplates } from '../components/SmsTemplatePicker';
import { SmsTextBox, textProblem, useSmsPlaceholders } from '../components/SmsTextBox';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { audienceLabel } from '../lib/customerGroups';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/inventory';
import { LANGUAGE_LABEL, MAX_OFFER_TEXT, SMS_LANGUAGES, renderLongest, textLength } from '../lib/sms';
import { audienceFromState, blankSmsAudience } from '../lib/smsAudience';
import { EMPTY_TEXTS, colomboInputValue, formatWhen, messagesOf, sendAtFromInput, textsFromTemplate } from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';

/**
 * SMS offers > Send: write the texts (placeholders and saved templates help), pick who gets them
 * (a group, older choices or custom filters), see the live numbers and then send now or schedule
 * for later (Sri Lanka time). The backend is the real guard for languages, opt-outs, quiet hours,
 * limits and the monthly budget; this screen shows what it would do and asks before sending.
 *
 * Which languages can be written comes from the backend (`estimate.languages`, English only at
 * launch). Only those get a text box, and the fallback choice appears only when there is more than one.
 */

const HISTORY_PREVIEW = 80;
/** Before the first estimate answers: the launch setting. */
const DEFAULT_LANGUAGES: SmsLanguage[] = ['en'];

/** Sri Lankan mobile, as the API's normaliser accepts it (070-078, not 073). */
const PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;
const tidyPhone = (phone: string) => phone.replace(/[\s\-()]/g, '');

const truncate = (text: string) => (text.length > HISTORY_PREVIEW ? `${text.slice(0, HISTORY_PREVIEW - 1)}…` : text);

export function SmsSendTab({ templatesVersion = 0 }: { templatesVersion?: number }) {
  const { user } = useAuth();
  // Tests go to this number; it starts as the operator's own phone (if the
  // account has one) and, left blank, the API falls back to that phone.
  const [testPhone, setTestPhone] = useState(user?.phone ?? '');
  const testPhoneId = useId();
  const [audienceState, setAudienceState] = useState(blankSmsAudience);
  const { target: audience } = audienceFromState(audienceState);
  const [chosenFallback, setFallback] = useState<SmsLanguage>('en');
  const [languages, setLanguages] = useState<SmsLanguage[]>(DEFAULT_LANGUAGES);
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(EMPTY_TEXTS);
  const [when, setWhen] = useState<'NOW' | 'LATER'>('NOW');
  const [sendAtInput, setSendAtInput] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<SmsOffer[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const fallbackId = useId();
  const placeholders = useSmsPlaceholders();
  const { templates, reload: reloadTemplates } = useSmsTemplates(templatesVersion);

  // Keep the backend's order-independent list in our own si/ta/en order.
  const enabled = SMS_LANGUAGES.filter((l) => languages.includes(l));
  const multilingual = enabled.length > 1;
  const fallback: SmsLanguage = enabled.includes(chosenFallback) ? chosenFallback : enabled[0] ?? 'en';

  const input: SmsOfferInput = {
    audience: audience ?? 'ALL',
    fallback_language: fallback,
    messages: messagesOf(texts, enabled),
  };
  const textsWrong = enabled.some((l) => texts[l].trim() && textProblem(texts[l].trim(), placeholders));
  // Empty while the audience's numbers or a text are wrong: no estimate, no send.
  const inputKey = audience && !textsWrong ? JSON.stringify(input) : '';

  const { estimate, estimating, error: estimateError } = useLiveEstimate(
    inputKey,
    (key) => smsOffers.estimate(JSON.parse(key) as SmsOfferInput),
    (err) => smsErrorMessage(err, 'Could not count the customers.')
  );

  // The languages offers are written in follow what the backend says.
  useEffect(() => {
    const offered = estimate?.languages;
    if (!offered?.length) return;
    setLanguages((current) =>
      current.length === offered.length && current.every((l) => offered.includes(l)) ? current : offered
    );
  }, [estimate]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await smsOffers.list());
      setHistoryError(null);
    } catch (err) {
      setHistoryError(errorMessage(err, 'Could not load past offers.'));
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const tooLong = enabled.some((l) => texts[l].length > MAX_OFFER_TEXT);
  const missing = estimate?.missing_languages ?? [];
  const later = when === 'LATER';
  const schedule = later ? sendAtFromInput(sendAtInput) : null;
  // Sending now also needs the sending rules (quiet hours...) and the monthly budget to allow it.
  const blockedNow = !later && (estimate?.sending?.allowed === false || estimate?.budget?.would_exceed === true);
  const canSend =
    !!audience &&
    !!estimate &&
    !estimating &&
    !sending &&
    !tooLong &&
    !textsWrong &&
    missing.length === 0 &&
    estimate.recipients > 0 &&
    !blockedNow &&
    (!later || (schedule !== null && 'sendAt' in schedule));

  async function send() {
    setConfirming(false);
    setSending(true);
    setSendError(null);
    setNotice(null);
    try {
      if (later && schedule && 'sendAt' in schedule) {
        const campaign = await smsOffers.schedule({ ...input, send_at: schedule.sendAt });
        setNotice(`Scheduled: ${campaign.schedule_label}. Pause or cancel it under Scheduled and automatic.`);
        setWhen('NOW');
        setSendAtInput('');
      } else {
        const offer = await smsOffers.send(input);
        setNotice(`Offer sent to ${offer.recipients} customers (${offer.sms_parts_total} SMS parts).`);
        void loadHistory();
      }
      setTexts(EMPTY_TEXTS);
    } catch (err) {
      setSendError(smsErrorMessage(err, later ? 'Could not schedule the offer.' : 'Could not send the offer.'));
    } finally {
      setSending(false);
    }
  }

  const scheduleError = later && sendAtInput && schedule && 'error' in schedule ? schedule.error : null;

  return (
    <div className="sms-tab">
      {notice ? (
        <div className="banner staff-notice" role="status">
          <p>{notice}</p>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="card">
        {/* Customer groups (2026-10-24), the two older choices and custom filters (2026-11-03). */}
        <SmsAudiencePicker
          name="sms-offer-audience"
          state={audienceState}
          onChange={setAudienceState}
          countText={
            !audience ? null : estimating ? 'Counting customers…' : estimate ? `${estimate.recipients} customer${estimate.recipients === 1 ? '' : 's'} can get it` : null
          }
        />

        {multilingual ? (
          <div className="field">
            <span className="field__label" id={fallbackId}>
              Customers without a language get:
            </span>
            <div className="segmented sms-segmented" role="group" aria-labelledby={fallbackId}>
              {enabled.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`segmented__item${fallback === l ? ' is-selected' : ''}`}
                  aria-pressed={fallback === l}
                  onClick={() => setFallback(l)}
                >
                  {LANGUAGE_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <SmsTemplatePicker
        templates={templates}
        messages={messagesOf(texts)}
        onPick={(template) => setTexts(textsFromTemplate(template))}
        onSaved={() => void reloadTemplates()}
      />

      <section className="card">
        <div className="field">
          <label className="field__label" htmlFor={testPhoneId}>
            Send test to
          </label>
          <input
            id={testPhoneId}
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="077 123 4567"
            value={testPhone}
            onChange={(event) => setTestPhone(event.target.value)}
          />
          <span className="field__hint">A mobile number for test texts. Leave it empty to use your own.</span>
        </div>
      </section>

      {enabled.map((language) => (
        <OfferText
          key={language}
          language={language}
          testPhone={testPhone}
          value={texts[language]}
          customers={multilingual ? estimate?.by_language[language] : undefined}
          placeholders={placeholders}
          onChange={(value) => setTexts((current) => ({ ...current, [language]: value }))}
        />
      ))}

      <SmsPreviewCard estimate={estimate} estimating={estimating} error={estimateError} enabled={enabled} fallback={fallback} />

      <section className="card">
        <div className="field">
          <span className="field__label" id={`${fallbackId}-when`}>
            When
          </span>
          <div className="segmented sms-segmented" role="group" aria-labelledby={`${fallbackId}-when`}>
            <button
              type="button"
              className={`segmented__item${!later ? ' is-selected' : ''}`}
              aria-pressed={!later}
              onClick={() => setWhen('NOW')}
            >
              Send now
            </button>
            <button
              type="button"
              className={`segmented__item${later ? ' is-selected' : ''}`}
              aria-pressed={later}
              onClick={() => setWhen('LATER')}
            >
              Schedule for
            </button>
          </div>
        </div>
        {later ? (
          <label className="field">
            <span className="field__label">Send at (Sri Lanka time)</span>
            <input
              className="input"
              type="datetime-local"
              aria-label="Send at (Sri Lanka time)"
              value={sendAtInput}
              min={colomboInputValue(Date.now())}
              onChange={(e) => setSendAtInput(e.target.value)}
            />
            <span className="field__hint">
              Up to a year ahead. The customers are counted again when it is sent, and the sending rules are checked then.
            </span>
            {scheduleError ? <span className="field__error-text">{scheduleError}</span> : null}
          </label>
        ) : null}
      </section>

      {sendError ? (
        <p className="field__error" role="alert">
          {sendError}
        </p>
      ) : null}

      <button type="button" className="primary sms-send" disabled={!canSend} onClick={() => setConfirming(true)}>
        {sending ? <Spinner label={later ? 'Scheduling offer' : 'Sending offer'} /> : later ? 'Schedule offer' : 'Send offer'}
      </button>
      <p className="page__note">
        SMS can go out at any time unless you set quiet hours or limits in SMS sending rules (More &gt; Customers and rewards).
      </p>

      {confirming && estimate ? (
        later && schedule && 'sendAt' in schedule ? (
          <ConfirmDialog
            title="Schedule offer"
            message={`Send on ${formatWhen(schedule.sendAt)} (Sri Lanka time)? About ${estimate.recipients} customers and ${estimate.sms_parts_total} SMS parts now; the customers are counted again at send time.`}
            confirmLabel="Schedule"
            onCancel={() => setConfirming(false)}
            onConfirm={() => void send()}
          />
        ) : (
          <ConfirmDialog
            title="Send offer"
            message={`Send to ${estimate.recipients} customers, about ${estimate.sms_parts_total} SMS parts?`}
            confirmLabel="Send"
            onCancel={() => setConfirming(false)}
            onConfirm={() => void send()}
          />
        )
      ) : null}

      <section className="section" aria-labelledby="sms-history-title">
        <h2 className="section-label" id="sms-history-title">
          Recent offers
        </h2>
        {historyError ? (
          <p className="field__error" role="alert">
            {historyError}
          </p>
        ) : null}
        {history === null ? (
          <Spinner label="Loading past offers" />
        ) : history.length === 0 ? (
          historyError ? null : <EmptyState title="No offers sent yet" />
        ) : (
          <ul className="cat-list" aria-label="Recent offers">
            {history.map((offer) => (
              <li key={offer.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">
                    {audienceLabel(offer.audience_group && typeof offer.audience_group === 'object' ? offer.audience_group : offer.audience)}
                  </p>
                  <p className="cat-row__meta">
                    {formatDateTime(offer.created_at)} &middot; {offer.sent_by_name ?? offer.sent_by_role ?? 'Unknown'}
                  </p>
                  <p className="cat-row__meta">
                    {offer.recipient_count} customers &middot; {offer.sms_parts_total} SMS parts
                  </p>
                  {SMS_LANGUAGES.map((l) => {
                    const text = offer[`message_${l}`];
                    return text ? (
                      <p key={l} className="cat-row__meta sms-history__text">
                        <strong>{LANGUAGE_LABEL[l]}:</strong> {truncate(text)}
                      </p>
                    ) : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One language's text box: placeholders, count, cost, example and a test send. */
function OfferText({
  language,
  testPhone,
  value,
  customers,
  placeholders,
  onChange,
}: {
  language: SmsLanguage;
  /** Where the test goes; blank means the operator's own phone. */
  testPhone: string;
  value: string;
  customers: number | undefined;
  placeholders: ReturnType<typeof useSmsPlaceholders>;
  onChange(value: string): void;
}) {
  const [testing, setTesting] = useState(false);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const name = LANGUAGE_LABEL[language];
  const text = value.trim();
  const tooLong = value.length > MAX_OFFER_TEXT || (!!text && textLength(renderLongest(text)) > MAX_OFFER_TEXT);

  async function sendTest() {
    setTestNotice(null);
    setTestError(null);
    const phone = tidyPhone(testPhone.trim());
    if (phone && !PHONE_PATTERN.test(phone)) {
      setTestError('Enter a Sri Lankan mobile number to send the test to, e.g. 077 123 4567.');
      return;
    }
    setTesting(true);
    try {
      const result = await smsOffers.test(language, text, phone || undefined);
      setTestNotice(`Test sent to ${result.sent_to}`);
    } catch (err) {
      setTestError(smsErrorMessage(err, 'Could not send the test.'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="card sms-text">
      <SmsTextBox
        language={language}
        label={`${name} text${customers !== undefined ? ` · ${customers} customers` : ''}`}
        value={value}
        placeholders={placeholders}
        onChange={(next) => {
          onChange(next);
          setTestNotice(null);
          setTestError(null);
        }}
      >
        <button
          type="button"
          className="button sms-test"
          aria-label={`Send ${name} test`}
          disabled={!text || tooLong || testing}
          onClick={() => void sendTest()}
        >
          {testing ? <Spinner label="Sending test" /> : 'Send test'}
        </button>
        {testNotice ? (
          <p className="quiet quiet--ok" role="status">
            {testNotice}
          </p>
        ) : null}
        {testError ? (
          <p className="field__error" role="alert">
            {testError}
          </p>
        ) : null}
      </SmsTextBox>
    </section>
  );
}
