import { useEffect, useRef, useState } from 'react';
import { smsOffers as smsOffersApi } from '../api/resources';
import type { SmsLanguage, SmsPlaceholder } from '../api/types';
import { insertToken } from '../lib/smsCampaigns';
import {
  LANGUAGE_LABEL,
  MAX_OFFER_TEXT,
  exampleRendering,
  hasPlaceholder,
  longestRendering,
  offerParts,
  partsLabel,
  smsOfferErrorMessage,
} from '../lib/smsOffers';
import { Field } from './ui';

/** A Sri Lankan mobile, as the API's normaliser accepts it. */
const TEST_PHONE_PATTERN = /^(?:\+?94|0)?7[0124-8]\d{7}$/;

const DEFAULT_PLACEHOLDERS: SmsPlaceholder[] = [
  { token: '{name}', description: "The customer's first name", example: 'Nimal' },
  { token: '{points}', description: 'Blynk Points the customer holds', example: '120' },
  { token: '{wallet}', description: 'Blynk Wallet balance', example: 'LKR 1,250' },
  { token: '{app_link}', description: 'Link to the Blynk app', example: 'https://blynk.lk/app' },
];

/**
 * The placeholders a text may use. The four words are known up front; the API's list (with its
 * descriptions) replaces them when it answers.
 */
export function useSmsPlaceholders(): SmsPlaceholder[] {
  const [list, setList] = useState<SmsPlaceholder[]>(DEFAULT_PLACEHOLDERS);
  useEffect(() => {
    let cancelled = false;
    smsOffersApi
      .placeholders()
      .then((items) => {
        if (!cancelled && items.length) setList(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}

/**
 * One language's text: placeholder buttons that insert {name} {points} {wallet} {app_link} where the
 * cursor is, a counter, how an example customer gets it, and (when `testPhone` is given) a test send.
 */
export function SmsTextEditor({
  language,
  value,
  onChange,
  placeholders,
  testPhone,
}: {
  language: SmsLanguage;
  value: string;
  onChange(value: string): void;
  placeholders: SmsPlaceholder[];
  /** "Send test to": when given (even blank = the account's own phone) the Send test button shows. */
  testPhone?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);
  const name = LANGUAGE_LABEL[language];
  const parts = offerParts(value, language);
  const longest = [...longestRendering(value)].length;
  const canTest = testPhone !== undefined;

  function insert(token: string) {
    const el = box.current;
    const at = insertToken(value, token, el ? el.selectionStart : null, el ? el.selectionEnd : null);
    onChange(at.value);
    // Put the cursor after the new word once React has written the text.
    requestAnimationFrame(() => {
      const target = box.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(at.caret, at.caret);
    });
  }

  async function sendTest() {
    const phone = (testPhone ?? '').trim();
    if (phone && !TEST_PHONE_PATTERN.test(phone.replace(/[\s\-()]/g, ''))) {
      setTestNote({ ok: false, text: 'Enter a Sri Lankan mobile number, e.g. 077 123 4567.' });
      return;
    }
    setTesting(true);
    setTestNote(null);
    try {
      const result = await smsOffersApi.test(language, value.trim(), phone || undefined);
      setTestNote({ ok: true, text: `Test sent to ${result.sent_to}` });
    } catch (err) {
      setTestNote({ ok: false, text: smsOfferErrorMessage(err, 'Could not send the test.') });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="form__section sms-offers__lang" aria-label={`${name} offer`}>
      <Field label={name}>
        <textarea
          ref={box}
          className="input"
          rows={3}
          aria-label={`${name} text`}
          maxLength={MAX_OFFER_TEXT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <div className="sms-offers__chips" role="group" aria-label={`Add to the ${name} text`}>
        {placeholders.map((p) => (
          <button
            key={p.token}
            type="button"
            className="button button--ghost button--sm sms-offers__chip"
            title={`${p.description}, e.g. ${p.example}`}
            aria-label={`Insert ${p.token} in the ${name} text`}
            onClick={() => insert(p.token)}
          >
            {p.token}
          </button>
        ))}
      </div>
      <p className="form__note" data-testid={`count-${language}`}>
        {value.length} / {MAX_OFFER_TEXT} characters{parts ? ` · ${partsLabel(parts)} with the opt-out line` : ''}
        {hasPlaceholder(value) && longest !== value.length ? ` · up to ${longest} characters once the placeholders are filled in` : ''}
      </p>
      {value.trim() ? (
        <div className="preview">
          <p className="preview__label">Customers receive{hasPlaceholder(value) ? ' (example: Nimal, 120 points)' : ''}</p>
          <p className="sms-offers__preview" aria-label={`${name} preview`}>
            {exampleRendering(value.trim())}
          </p>
        </div>
      ) : null}
      {canTest ? (
        <div className="row-actions sms-offers__test">
          <button
            type="button"
            className="button button--ghost button--sm"
            aria-label={`Send ${name} test`}
            disabled={!value.trim() || testing}
            onClick={() => void sendTest()}
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
          {testNote ? (
            <span className={testNote.ok ? 'form__note' : 'field__error'} role="status">
              {testNote.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
