import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { smsTemplates } from '../api/resources';
import type { SmsLanguage, SmsTemplate } from '../api/types';
import { SmsTextBox, textProblem, useSmsPlaceholders } from '../components/SmsTextBox';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import { LANGUAGE_LABEL, SMS_LANGUAGES } from '../lib/sms';
import { EMPTY_TEXTS, formatWhen, messagesOf, textsFromTemplate } from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';

/**
 * SMS offers > Templates: saved texts (a name and a Sinhala, Tamil and English text) that are
 * picked when writing an offer or an automatic SMS. Placeholders work in templates too.
 */
const PREVIEW = 80;
const truncate = (text: string) => (text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1)}…` : text);

export function SmsTemplatesTab({ onChanged }: { onChanged?: () => void }) {
  const [templates, setTemplates] = useState<SmsTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing?: SmsTemplate } | null>(null);
  const [deleting, setDeleting] = useState<SmsTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await smsTemplates.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(smsErrorMessage(err, 'Could not load the templates.'));
      setTemplates((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(template: SmsTemplate) {
    setDeleting(null);
    setError(null);
    setNotice(null);
    try {
      await smsTemplates.remove(template.id);
      setNotice(`Deleted "${template.name}".`);
      onChanged?.();
      await load();
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not delete the template.'));
    }
  }

  if (form) {
    return (
      <div className="sms-tab">
        <TemplateForm
          editing={form.editing}
          onCancel={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            setNotice(`Saved "${saved.name}".`);
            onChanged?.();
            void load();
          }}
        />
      </div>
    );
  }

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
      <button type="button" className="primary" onClick={() => setForm({})}>
        New template
      </button>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {loadError ? (
        <p className="field__error" role="alert">
          {loadError}
        </p>
      ) : null}
      {templates === null ? (
        <Spinner label="Loading templates" />
      ) : templates.length === 0 ? (
        loadError ? null : <EmptyState title="No templates yet" message="Save a text you use often, then pick it when you write an offer." />
      ) : (
        <ul className="cat-list" aria-label="Templates">
          {templates.map((t) => (
            <li key={t.id} className="cat-row cat-row--flat" aria-label={t.name}>
              <div className="cat-row__main">
                <p className="cat-row__title">{t.name}</p>
                <p className="cat-row__meta">
                  Changed {formatWhen(t.updated_at)}
                  {t.created_by_name ? <> &middot; {t.created_by_name}</> : null}
                </p>
                {SMS_LANGUAGES.map((l) =>
                  t.messages[l] ? (
                    <p key={l} className="cat-row__meta sms-history__text">
                      <strong>{LANGUAGE_LABEL[l]}:</strong> {truncate(t.messages[l]!)}
                    </p>
                  ) : null
                )}
                <div className="sms-actions">
                  <button type="button" className="button" aria-label={`Edit ${t.name}`} onClick={() => setForm({ editing: t })}>
                    Edit
                  </button>
                  <button type="button" className="button button--ghost" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting ? (
        <ConfirmDialog
          title="Delete template"
          message={`Delete "${deleting.name}"? Offers and campaigns already made with it are not changed.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </div>
  );
}

function TemplateForm({
  editing,
  onSaved,
  onCancel,
}: {
  editing?: SmsTemplate;
  onSaved(template: SmsTemplate): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(editing ? textsFromTemplate(editing) : { ...EMPTY_TEXTS });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const placeholders = useSmsPlaceholders();

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the template a name.');
      return;
    }
    const messages = messagesOf(texts);
    if (Object.keys(messages).length === 0) {
      setError('Write at least one text.');
      return;
    }
    const wrong = SMS_LANGUAGES.map((l) => (messages[l] ? textProblem(messages[l]!, placeholders) : null)).find(Boolean);
    if (wrong) {
      setError(wrong);
      return;
    }
    setSaving(true);
    try {
      const input = { name: name.trim(), messages };
      onSaved(editing ? await smsTemplates.update(editing.id, input) : await smsTemplates.create(input));
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not save the template.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form sms-tab" onSubmit={save} noValidate aria-label={editing ? `Edit ${editing.name}` : 'New template'}>
      <section className="card">
        <h2 className="section-label">{editing ? 'Edit template' : 'New template'}</h2>
        <label className="field">
          <span className="field__label">Template name</span>
          <input className="input" aria-label="Template name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
      </section>
      {SMS_LANGUAGES.map((language) => (
        <section className="card sms-text" key={language}>
          <SmsTextBox
            language={language}
            label={`${LANGUAGE_LABEL[language]} text${language === 'en' ? '' : ' (optional)'}`}
            value={texts[language]}
            placeholders={placeholders}
            onChange={(value) => setTexts((current) => ({ ...current, [language]: value }))}
          />
        </section>
      ))}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sms-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save template'}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
