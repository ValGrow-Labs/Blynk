import { useEffect, useId, useState, type FormEvent } from 'react';
import { smsCampaigns } from '../api/resources';
import type { SmsCampaign, SmsCampaignKind, SmsCampaignPreviewInput, SmsLanguage } from '../api/types';
import { LANGUAGE_LABEL, SMS_LANGUAGES } from '../lib/sms';
import { audienceFromState } from '../lib/smsAudience';
import {
  FREQUENCIES,
  KIND_LABEL,
  TRIGGERS,
  WEEKDAYS,
  blankCampaignDraft,
  colomboInputValue,
  createBodyFromDraft,
  draftFromCampaign,
  messagesOf,
  patchBodyFromDraft,
  previewBodyFromDraft,
  textsFromTemplate,
  type CampaignDraft,
} from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';
import { SmsAudiencePicker } from './SmsAudiencePicker';
import { SmsPreviewCard, useLiveEstimate } from './SmsPreviewCard';
import { SmsTemplatePicker, useSmsTemplates } from './SmsTemplatePicker';
import { SmsTextBox, textProblem, useSmsPlaceholders } from './SmsTextBox';
import { Spinner } from './ui';
import './sms.css';

/**
 * Create a repeating (daily / weekly / monthly) or automatic (trigger) SMS campaign, or edit one
 * (future runs only: runs already done stay in the history). Times are Sri Lanka time. The numbers
 * under the form are the live preview of who it would text and what it costs.
 */
export function SmsCampaignForm({
  editing,
  onSaved,
  onCancel,
}: {
  /** The campaign being edited; none = a new one. */
  editing?: SmsCampaign;
  onSaved(campaign: SmsCampaign): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState<CampaignDraft>(() => (editing ? draftFromCampaign(editing) : blankCampaignDraft('RECURRING')));
  const [languages, setLanguages] = useState<SmsLanguage[]>(['en']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const placeholders = useSmsPlaceholders();
  const { templates, reload: reloadTemplates } = useSmsTemplates();
  const set = (patch: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const enabled = SMS_LANGUAGES.filter((l) => languages.includes(l));
  const multilingual = enabled.length > 1;
  const fallback: SmsLanguage = enabled.includes(draft.fallback) ? draft.fallback : enabled[0] ?? 'en';
  const textsWrong = SMS_LANGUAGES.some((l) => draft.texts[l].trim() && textProblem(draft.texts[l].trim(), placeholders));
  const previewBody = textsWrong ? null : previewBodyFromDraft({ ...draft, fallback });
  const { estimate, estimating, error: previewError } = useLiveEstimate(
    previewBody ? JSON.stringify(previewBody) : '',
    (key) => smsCampaigns.preview(JSON.parse(key) as SmsCampaignPreviewInput),
    (err) => smsErrorMessage(err, 'Could not count the customers.')
  );
  useEffect(() => {
    const offered = estimate?.languages;
    if (!offered?.length) return;
    setLanguages((current) => (current.length === offered.length && current.every((l) => offered.includes(l)) ? current : offered));
  }, [estimate]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const draftToSave = { ...draft, fallback };
    setSaving(true);
    try {
      if (editing) {
        const built = patchBodyFromDraft(draftToSave);
        if ('error' in built) {
          setError(built.error);
          return;
        }
        onSaved(await smsCampaigns.update(editing.id, built.patch));
      } else {
        const built = createBodyFromDraft(draftToSave);
        if ('error' in built) {
          setError(built.error);
          return;
        }
        onSaved(await smsCampaigns.create(built.input));
      }
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not save the campaign.'));
    } finally {
      setSaving(false);
    }
  }

  const kind: SmsCampaignKind = draft.kind;
  const audience = audienceFromState(draft.audience);
  const trigger = TRIGGERS.find((t) => t.id === draft.trigger) ?? TRIGGERS[0];

  return (
    <form className="form sms-tab" onSubmit={save} noValidate aria-label={editing ? `Edit ${editing.name}` : 'New automatic SMS'}>
      <section className="card">
        <h2 className="section-label">{editing ? 'Edit campaign' : 'New automatic SMS'}</h2>
        {editing ? <p className="quiet">Changes apply to future runs only. Runs already done stay in the history.</p> : null}
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            aria-label="Name"
            value={draft.name}
            maxLength={120}
            placeholder="e.g. Friday vegetables reminder"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        {!editing ? (
          <div className="field">
            <span className="field__label" id={`${ids}-kind`}>
              Type
            </span>
            <div className="segmented sms-segmented sms-segmented--wrap" role="group" aria-labelledby={`${ids}-kind`}>
              {(['RECURRING', 'TRIGGER'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`segmented__item${kind === k ? ' is-selected' : ''}`}
                  aria-pressed={kind === k}
                  onClick={() => set({ kind: k })}
                >
                  {k === 'RECURRING' ? 'Repeats on a schedule' : 'Automatic (trigger)'}
                </button>
              ))}
            </div>
            <span className="field__hint">
              {kind === 'RECURRING'
                ? 'Sent again and again, for example every Friday at 6 PM. Who gets it is worked out at every run.'
                : 'Checked once a day: texts customers when something happens, like a few days after an order.'}
            </span>
          </div>
        ) : (
          <p className="quiet">{KIND_LABEL[kind]}</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-label">When (Sri Lanka time)</h2>
        {kind === 'ONCE' ? (
          <label className="field">
            <span className="field__label">Send at (Sri Lanka time)</span>
            <input
              className="input"
              type="datetime-local"
              aria-label="Send at (Sri Lanka time)"
              value={draft.sendAt}
              min={colomboInputValue(Date.now())}
              onChange={(e) => set({ sendAt: e.target.value })}
            />
          </label>
        ) : null}
        {kind === 'RECURRING' ? (
          <>
            <div className="field">
              <span className="field__label" id={`${ids}-freq`}>
                Repeat
              </span>
              <div className="segmented sms-segmented sms-segmented--wrap" role="group" aria-labelledby={`${ids}-freq`}>
                {FREQUENCIES.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`segmented__item${draft.frequency === f.id ? ' is-selected' : ''}`}
                    aria-pressed={draft.frequency === f.id}
                    onClick={() => set({ frequency: f.id })}
                  >
                    {f.text}
                  </button>
                ))}
              </div>
            </div>
            {draft.frequency === 'WEEKLY' ? (
              <div className="field">
                <span className="field__label" id={`${ids}-days`}>
                  On
                </span>
                <div className="sms-chips" role="group" aria-labelledby={`${ids}-days`}>
                  {WEEKDAYS.map((w) => {
                    const on = draft.weekdays.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={`sms-chip${on ? ' is-selected' : ''}`}
                        aria-pressed={on}
                        aria-label={w.full}
                        onClick={() => set({ weekdays: on ? draft.weekdays.filter((d) => d !== w.id) : [...draft.weekdays, w.id] })}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {draft.frequency === 'MONTHLY' ? (
              <label className="field">
                <span className="field__label">Day of the month</span>
                <input
                  className="input"
                  inputMode="numeric"
                  aria-label="Day of the month"
                  value={draft.monthDay}
                  onChange={(e) => set({ monthDay: e.target.value })}
                />
                <span className="field__hint">1 to 28, so every month has it.</span>
              </label>
            ) : null}
            <TimeField value={draft.time} label="Time" onChange={(time) => set({ time })} />
            <div className="sms-fields">
              <label className="field">
                <span className="field__label">Start on (optional)</span>
                <input className="input" type="date" aria-label="Start on" value={draft.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
              </label>
              <label className="field">
                <span className="field__label">End on (optional)</span>
                <input className="input" type="date" aria-label="End on" value={draft.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
              </label>
            </div>
          </>
        ) : null}
        {kind === 'TRIGGER' ? (
          <>
            <label className="field">
              <span className="field__label">Text a customer</span>
              <select
                className="input"
                aria-label="When to text"
                value={draft.trigger}
                onChange={(e) => set({ trigger: e.target.value as CampaignDraft['trigger'] })}
              >
                {TRIGGERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.text}
                  </option>
                ))}
              </select>
              <span className="field__hint">{trigger.hint}</span>
            </label>
            <label className="field">
              <span className="field__label">Number of days</span>
              <input
                className="input"
                inputMode="numeric"
                aria-label="Number of days"
                value={draft.days}
                onChange={(e) => set({ days: e.target.value })}
              />
              <span className="field__hint">1 to 365.</span>
            </label>
            {draft.trigger === 'DAYS_AFTER_SIGNUP' ? (
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.onlyIfNeverOrdered}
                  onChange={(e) => set({ onlyIfNeverOrdered: e.target.checked })}
                />
                <span>
                  <strong>Only if they have not ordered yet</strong>
                  <em>Customers who already ordered are left out.</em>
                </span>
              </label>
            ) : null}
            {draft.trigger === 'NO_ORDER_FOR_DAYS' ? (
              <label className="field">
                <span className="field__label">Do not text the same customer again within (days)</span>
                <input
                  className="input"
                  inputMode="numeric"
                  aria-label="Days before texting the same customer again"
                  value={draft.cooldown}
                  onChange={(e) => set({ cooldown: e.target.value })}
                />
                <span className="field__hint">At most one text every this many days, 1 to 365.</span>
              </label>
            ) : null}
            <TimeField value={draft.time} label="Check every day at" onChange={(time) => set({ time })} />
          </>
        ) : null}
      </section>

      {kind === 'TRIGGER' ? (
        <section className="card">
          <p className="quiet">Automatic messages pick their own customers: each customer is texted once for each order, sign-up or lapse.</p>
        </section>
      ) : (
        <section className="card">
          <SmsAudiencePicker
            name="sms-campaign-audience"
            state={draft.audience}
            onChange={(audienceState) => set({ audience: audienceState })}
            countText={
              !audience.target ? null : estimating ? 'Counting customers…' : estimate ? `${estimate.recipients} customer${estimate.recipients === 1 ? '' : 's'} can get it now` : null
            }
          />
        </section>
      )}

      {multilingual ? (
        <section className="card">
          <div className="field">
            <span className="field__label" id={`${ids}-fb`}>
              Customers without a language get:
            </span>
            <div className="segmented sms-segmented" role="group" aria-labelledby={`${ids}-fb`}>
              {enabled.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`segmented__item${fallback === l ? ' is-selected' : ''}`}
                  aria-pressed={fallback === l}
                  onClick={() => set({ fallback: l })}
                >
                  {LANGUAGE_LABEL[l]}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <SmsTemplatePicker
        templates={templates}
        messages={messagesOf(draft.texts)}
        onPick={(template) => set({ texts: textsFromTemplate(template) })}
        onSaved={() => void reloadTemplates()}
      />

      {enabled.map((language) => (
        <section className="card sms-text" key={language}>
          <SmsTextBox
            language={language}
            value={draft.texts[language]}
            placeholders={placeholders}
            onChange={(value) => set({ texts: { ...draft.texts, [language]: value } })}
          />
        </section>
      ))}

      <SmsPreviewCard
        estimate={estimate}
        estimating={estimating}
        error={previewError}
        enabled={enabled}
        fallback={fallback}
        title={kind === 'TRIGGER' ? 'Who it would text today' : 'Who gets it now'}
        emptyText={kind === 'TRIGGER' ? 'Nobody would be texted today.' : 'No customer in this group can get offers.'}
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sms-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? <Spinner label="Saving" /> : editing ? 'Save changes' : 'Create campaign'}
        </button>
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TimeField({ value, label, onChange }: { value: string; label: string; onChange(value: string): void }) {
  return (
    <label className="field">
      <span className="field__label">{label} (Sri Lanka time)</span>
      <input className="input" type="time" aria-label={`${label} (Sri Lanka time)`} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
