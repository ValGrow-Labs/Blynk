import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { smsOffers } from '../api/resources';
import type { SmsLanguage, SmsPlaceholder } from '../api/types';
import {
  FALLBACK_PLACEHOLDERS,
  LANGUAGE_LABEL,
  MAX_OFFER_TEXT,
  partsText,
  renderLongest,
  renderSample,
  smsParts,
  textLength,
  unknownPlaceholders,
} from '../lib/sms';
import './sms.css';

/**
 * The placeholders customers' names, points and wallet are filled into (GET /admin/sms-placeholders;
 * the built-in list when the API cannot be reached). Loaded once per screen.
 */
export function useSmsPlaceholders(): readonly SmsPlaceholder[] {
  const [list, setList] = useState<readonly SmsPlaceholder[]>(FALLBACK_PLACEHOLDERS);
  useEffect(() => {
    let live = true;
    smsOffers
      .placeholders()
      .then((r) => live && r.placeholders?.length && setList(r.placeholders))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** What is wrong with one text (shown under its box), or null. */
export function textProblem(text: string, placeholders: readonly SmsPlaceholder[]): string | null {
  const unknown = unknownPlaceholders(text, placeholders.map((p) => p.token));
  if (unknown.length) {
    return `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a placeholder. You can use ${placeholders.map((p) => p.token).join(', ')}.`;
  }
  const longest = textLength(renderLongest(text));
  if (longest > MAX_OFFER_TEXT) {
    return `This can be up to ${longest} characters once the name, points and wallet are filled in. Keep it under ${MAX_OFFER_TEXT}.`;
  }
  return null;
}

/**
 * One language's text: the box, chips that put {name} {points} {wallet} {app_link} where the cursor is,
 * the character and SMS-part count (on the longest the text can get once filled in) and an example as a
 * customer would read it. `children` sit under the example (a test button, ...).
 */
export function SmsTextBox({
  language,
  value,
  onChange,
  placeholders,
  label,
  children,
}: {
  language: SmsLanguage;
  value: string;
  onChange(value: string): void;
  placeholders: readonly SmsPlaceholder[];
  /** The visible label; default "English text". */
  label?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const countId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const name = LANGUAGE_LABEL[language];
  const text = value.trim();
  const longest = text ? renderLongest(text) : '';
  const problem = text ? textProblem(text, placeholders) : null;
  const hasTokens = /\{[^{}]*\}/.test(text);

  // Put the cursor after an inserted placeholder once React has written the new value.
  useEffect(() => {
    if (caret.current !== null && area.current) {
      const at = caret.current;
      caret.current = null;
      area.current.focus();
      area.current.setSelectionRange(at, at);
    }
  }, [value]);

  function insert(token: string) {
    const el = area.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    caret.current = start + token.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label ?? `${name} text`}
      </label>
      <div className="sms-chips" role="group" aria-label={`Add to the ${name} text`}>
        {placeholders.map((p) => (
          <button
            key={p.token}
            type="button"
            className="sms-chip sms-chip--token"
            aria-label={`Insert ${p.token} into the ${name} text`}
            title={`${p.description}, e.g. ${p.example}`}
            onClick={() => insert(p.token)}
          >
            {p.token}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={area}
        className="input"
        rows={4}
        maxLength={MAX_OFFER_TEXT}
        value={value}
        aria-describedby={countId}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={countId} className="field__hint" data-testid={`sms-count-${language}`}>
        {value.length}/{MAX_OFFER_TEXT} characters
        {text ? ` · ${partsText(smsParts(longest))}` : ''}
        {hasTokens && text ? ` · up to ${textLength(longest)} characters filled in` : ''}
      </span>
      {problem ? <span className="field__error-text">{problem}</span> : null}
      {text ? (
        <>
          <div className="sms-preview" aria-label={`${name} SMS preview`}>
            {hasTokens ? renderSample(text) : text}
          </div>
          {hasTokens ? <p className="sms-example">Example: a customer called Nimal with 120 points and LKR 1,250 in the wallet.</p> : null}
        </>
      ) : null}
      {children}
    </div>
  );
}
