import { useEffect, useState } from 'react';
import { smsTemplates } from '../api/resources';
import type { SmsLanguage, SmsTemplate } from '../api/types';
import { messagesOf, textsFrom } from '../lib/smsCampaigns';
import { smsOfferErrorMessage } from '../lib/smsOffers';
import { Field, useToast } from './ui';

/**
 * Saved texts (templates) in a compose screen: pick one to fill the texts, or save what is written
 * as a template. `enabled` are the languages the screen shows; only those are saved.
 */
export function SmsTemplateBar({
  texts,
  enabled,
  onPick,
}: {
  texts: Record<SmsLanguage, string>;
  enabled: readonly SmsLanguage[];
  onPick(texts: Record<SmsLanguage, string>): void;
}) {
  const toast = useToast();
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [picked, setPicked] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    smsTemplates
      .list()
      .then((list) => !cancelled && setTemplates(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const messages = messagesOf(texts, enabled);
  const hasText = Object.keys(messages).length > 0;

  function pick(id: string) {
    setPicked(id);
    const template = templates.find((t) => t.id === id);
    if (template) onPick(textsFrom(template.messages));
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the template a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await smsTemplates.create(trimmed, messages);
      setTemplates((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
      setPicked(created.id);
      setNaming(false);
      setName('');
      toast.success(`Saved the template "${created.name}".`);
    } catch (err) {
      setError(smsOfferErrorMessage(err, 'Could not save the template.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sms-template-bar">
      <div className="form__row">
        <Field label="Saved template" hint={templates.length ? 'Fills the texts below with a saved one.' : 'No saved templates yet.'}>
          <select className="input" aria-label="Saved template" value={picked} disabled={!templates.length} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="sms-template-bar__save">
          {naming ? null : (
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={!hasText}
              onClick={() => setNaming(true)}
            >
              Save as template
            </button>
          )}
        </div>
      </div>
      {naming ? (
        // A div, not a form: this bar also sits inside the campaign form, and forms do not nest.
        <div
          className="sms-template-bar__name"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
              e.preventDefault();
              void save();
            }
          }}
        >
          <Field label="Template name" error={error ?? undefined}>
            <input className="input" aria-label="Template name" maxLength={80} value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="row-actions">
            <button type="button" className="button button--sm" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save template'}
            </button>
            <button
              type="button"
              className="button button--ghost button--sm"
              onClick={() => {
                setNaming(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
