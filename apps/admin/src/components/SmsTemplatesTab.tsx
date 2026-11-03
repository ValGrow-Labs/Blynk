import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { smsTemplates } from '../api/resources';
import type { SmsLanguage, SmsTemplate } from '../api/types';
import { EMPTY_TEXTS, messagesOf, textsFrom } from '../lib/smsCampaigns';
import { LANGUAGE_LABEL, SMS_LANGUAGES, smsOfferErrorMessage } from '../lib/smsOffers';
import { SmsTextEditor, useSmsPlaceholders } from './SmsTextEditor';
import { ConfirmDialog, EmptyState, Field, Spinner, useToast } from './ui';

/** Templates: saved texts (a name and the Sinhala, Tamil and English text) to pick when composing. */
export function SmsTemplatesTab() {
  const toast = useToast();
  const [templates, setTemplates] = useState<SmsTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null = no form; 'new' or a template's id = the form is open for it.
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SmsTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await smsTemplates.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(smsOfferErrorMessage(err, 'Could not load the templates.'));
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(template: SmsTemplate) {
    setDeleting(null);
    try {
      await smsTemplates.remove(template.id);
      toast.success(`Deleted the template "${template.name}".`);
      await load();
    } catch (err) {
      toast.error(smsOfferErrorMessage(err, 'Could not delete the template.'));
    }
  }

  const editingTemplate = editing && editing !== 'new' ? (templates ?? []).find((t) => t.id === editing) : undefined;

  return (
    <section aria-label="SMS templates">
      <div className="sms-offers__toolbar">
        <p className="form__note">A template is a saved text. Pick it on the Send tab or when you set up a scheduled or automatic campaign.</p>
        <button type="button" className="button" disabled={editing !== null} onClick={() => setEditing('new')}>
          New template
        </button>
      </div>

      {editing ? (
        <TemplateForm
          key={editing}
          template={editingTemplate}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {loadError ? <p className="field__error">{loadError}</p> : null}
      {templates === null ? (
        <Spinner label="Loading the templates" />
      ) : templates.length === 0 ? (
        loadError ? null : <EmptyState title="No templates yet" message="Write a text on the Send tab and choose Save as template, or add one here." />
      ) : (
        <ul className="sms-cards" aria-label="Templates">
          {templates.map((t) => (
            <li key={t.id} className="panel sms-card">
              <h3 className="sms-card__title">{t.name}</h3>
              <dl className="sms-offers__texts">
                {SMS_LANGUAGES.filter((l) => t.messages[l]).map((l) => (
                  <div key={l}>
                    <dt>{LANGUAGE_LABEL[l]}</dt>
                    <dd>{t.messages[l]}</dd>
                  </div>
                ))}
              </dl>
              {t.created_by_name ? <p className="form__note">Saved by {t.created_by_name}.</p> : null}
              <div className="row-actions row-actions--wrap">
                <button type="button" className="button button--ghost button--sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setDeleting(t)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleting ? (
        <ConfirmDialog
          title="Delete template"
          message={`Delete the template "${deleting.name}"? Campaigns that already use its text keep their own copy.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </section>
  );
}

function TemplateForm({ template, onCancel, onSaved }: { template?: SmsTemplate; onCancel(): void; onSaved(): void }) {
  const toast = useToast();
  const placeholders = useSmsPlaceholders();
  const [name, setName] = useState(template?.name ?? '');
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(template ? textsFrom(template.messages) : EMPTY_TEXTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const messages = messagesOf(texts);
    if (!trimmed) return setError('Give the template a name.');
    if (!Object.keys(messages).length) return setError('Write at least one text.');
    setSaving(true);
    setError(null);
    try {
      if (template) await smsTemplates.update(template.id, trimmed, messages);
      else await smsTemplates.create(trimmed, messages);
      toast.success(`Saved the template "${trimmed}".`);
      onSaved();
    } catch (err) {
      setError(smsOfferErrorMessage(err, 'Could not save the template.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form panel sms-form" aria-label={template ? 'Edit template' : 'New template'} onSubmit={save} noValidate>
      <h2 className="panel__title">{template ? 'Edit template' : 'New template'}</h2>
      <Field label="Template name">
        <input className="input" aria-label="Template name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {SMS_LANGUAGES.map((lang) => (
        <SmsTextEditor
          key={lang}
          language={lang}
          value={texts[lang]}
          placeholders={placeholders}
          onChange={(value) => setTexts((t) => ({ ...t, [lang]: value }))}
        />
      ))}
      <p className="form__note">Sinhala and Tamil texts are only sent when those languages are switched on for offers.</p>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : 'Save template'}
        </button>
      </div>
    </form>
  );
}
