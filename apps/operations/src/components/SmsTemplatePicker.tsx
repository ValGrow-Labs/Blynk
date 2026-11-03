import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { smsTemplates } from '../api/resources';
import type { SmsMessages, SmsTemplate } from '../api/types';
import { smsErrorMessage } from '../lib/smsErrors';
import { Spinner } from './ui';
import './sms.css';

/** The saved templates (GET /admin/sms-templates). `version` changes when another tab edited them. */
export function useSmsTemplates(version = 0): { templates: SmsTemplate[]; reload(): Promise<void> } {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const reload = useCallback(async () => {
    try {
      setTemplates(await smsTemplates.list());
    } catch {
      // The picker simply stays empty: writing and sending do not depend on it.
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, version]);
  return { templates, reload };
}

/**
 * Pick a saved text, or save what is written as a template. Picking fills the text boxes
 * (`onPick`); "Save as template" asks for a name and posts the texts (`messages`).
 */
export function SmsTemplatePicker({
  templates,
  messages,
  onPick,
  onSaved,
}: {
  templates: SmsTemplate[];
  /** The texts written now (what "Save as template" saves). */
  messages: SmsMessages;
  onPick(template: SmsTemplate): void;
  onSaved(template: SmsTemplate): void;
}) {
  const selectId = useId();
  const nameId = useId();
  const [picked, setPicked] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasText = Object.values(messages).some((t) => t && t.trim());

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!name.trim()) {
      setError('Give the template a name.');
      return;
    }
    setBusy(true);
    try {
      const template = await smsTemplates.create({ name: name.trim(), messages });
      setNotice(`Saved as "${template.name}".`);
      setName('');
      setNaming(false);
      onSaved(template);
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not save the template.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Saved texts">
      <div className="field">
        <label className="field__label" htmlFor={selectId}>
          Saved texts
        </label>
        <select
          id={selectId}
          className="input"
          aria-label="Use a saved template"
          value={picked}
          disabled={templates.length === 0}
          onChange={(e) => {
            const template = templates.find((t) => t.id === e.target.value);
            setPicked('');
            if (template) onPick(template);
          }}
        >
          <option value="">{templates.length === 0 ? 'No saved templates yet' : 'Use a saved template…'}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {naming ? (
        <form className="form" onSubmit={save} noValidate>
          <label className="field" htmlFor={nameId}>
            <span className="field__label">Template name</span>
            <input id={nameId} className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Friday vegetables" />
          </label>
          <div className="sms-actions">
            <button type="submit" className="button" disabled={busy || !hasText}>
              {busy ? <Spinner label="Saving template" /> : 'Save template'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setNaming(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="button button--ghost"
          disabled={!hasText}
          onClick={() => {
            setNaming(true);
            setNotice(null);
          }}
        >
          Save as template
        </button>
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
    </section>
  );
}
