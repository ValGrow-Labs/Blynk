import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { smsCampaigns } from '../api/resources';
import type {
  SmsCampaign,
  SmsCampaignInput,
  SmsCampaignKind,
  SmsCampaignPatch,
  SmsCampaignRun,
  SmsFrequency,
  SmsLanguage,
  SmsTriggerKind,
} from '../api/types';
import {
  SMS_AUDIENCE_GROUPS,
  audienceFromDraft,
  blankAudienceDraft,
  draftFromAudience,
} from '../lib/customerGroups';
import {
  EMPTY_TEXTS,
  FREQUENCY_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
  TRIGGER_HELP,
  TRIGGER_LABEL,
  WEEKDAYS,
  blankRecurringDraft,
  blankTriggerDraft,
  colomboLocalToSendAt,
  draftFromRecurring,
  draftFromTrigger,
  formatWhen,
  messagesOf,
  recurringFromDraft,
  runStatusLabel,
  sendAtToColomboLocal,
  textsFrom,
  triggerFromDraft,
  type RecurringDraft,
  type TriggerDraft,
} from '../lib/smsCampaigns';
import { LANGUAGE_LABEL, LAUNCH_LANGUAGES, SMS_LANGUAGES, smsOfferErrorMessage } from '../lib/smsOffers';
import { CustomerGroupPicker } from './CustomerGroupPicker';
import { EstimateBody } from './SmsEstimateFigures';
import { SmsTemplateBar } from './SmsTemplateBar';
import { SmsTextEditor, useSmsPlaceholders } from './SmsTextEditor';
import { Switch } from './Switch';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from './ui';
import { useSmsEstimate } from './useSmsEstimate';

type Form = { mode: 'create'; kind: 'RECURRING' | 'TRIGGER' } | { mode: 'edit'; campaign: SmsCampaign };
type Action = { what: 'pause' | 'resume' | 'cancel'; campaign: SmsCampaign };

const TONE: Record<SmsCampaign['status'], 'active' | 'inactive' | 'muted' | 'offer'> = {
  ACTIVE: 'active',
  PAUSED: 'muted',
  CANCELLED: 'inactive',
  COMPLETED: 'muted',
};

/**
 * Scheduled and automatic: campaigns that run later (a ONCE offer from "Schedule for"), repeat
 * (daily, weekly, monthly) or fire on a trigger (days after an order or sign-up, or a lapsed
 * customer). Pause, resume, edit (future runs only), cancel, and every run's history.
 */
export function SmsCampaignsTab() {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState<SmsCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns((await smsCampaigns.list()) ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(smsOfferErrorMessage(err, 'Could not load the campaigns.'));
      setCampaigns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmAction(a: Action) {
    setAction(null);
    setActionError(null);
    try {
      if (a.what === 'pause') await smsCampaigns.pause(a.campaign.id);
      else if (a.what === 'resume') await smsCampaigns.resume(a.campaign.id);
      else await smsCampaigns.cancel(a.campaign.id);
      toast.success(`${a.what === 'pause' ? 'Paused' : a.what === 'resume' ? 'Resumed' : 'Cancelled'} "${a.campaign.name}".`);
    } catch (err) {
      setActionError(smsOfferErrorMessage(err, `Could not ${a.what} the campaign.`));
    }
    await load();
  }

  return (
    <section aria-label="Scheduled and automatic SMS">
      <div className="sms-offers__toolbar">
        <p className="form__note">
          To send an offer once at a set time, choose Schedule for on the Send tab. Here you can make an offer repeat, or have it go out by itself.
        </p>
        <div className="row-actions row-actions--wrap">
          <button type="button" className="button" disabled={form !== null} onClick={() => setForm({ mode: 'create', kind: 'RECURRING' })}>
            New repeating campaign
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={form !== null}
            onClick={() => setForm({ mode: 'create', kind: 'TRIGGER' })}
          >
            New automatic campaign
          </button>
        </div>
      </div>

      {form ? (
        <CampaignForm
          key={form.mode === 'edit' ? form.campaign.id : form.kind}
          form={form}
          onCancel={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            void load();
          }}
        />
      ) : null}

      {actionError ? (
        <p className="field__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {loadError ? <p className="field__error">{loadError}</p> : null}
      {campaigns === null ? (
        <Spinner label="Loading the campaigns" />
      ) : campaigns.length === 0 ? (
        loadError ? null : (
          <EmptyState title="Nothing scheduled yet" message="Scheduled offers, repeating campaigns and automatic texts show here." />
        )
      ) : (
        <ul className="sms-cards" aria-label="Campaigns">
          {campaigns.map((c) => (
            <li key={c.id}>
              <CampaignCard
                campaign={c}
                onEdit={() => setForm({ mode: 'edit', campaign: c })}
                onAction={(what) => setAction({ what, campaign: c })}
              />
            </li>
          ))}
        </ul>
      )}

      {action ? <ActionDialog action={action} onCancel={() => setAction(null)} onConfirm={() => void confirmAction(action)} /> : null}
    </section>
  );
}

function ActionDialog({ action, onCancel, onConfirm }: { action: Action; onCancel(): void; onConfirm(): void }) {
  const name = action.campaign.name;
  if (action.what === 'pause') {
    return (
      <ConfirmDialog
        title="Pause campaign"
        message={`Pause "${name}"? Nothing is sent while it is paused. You can resume it any time.`}
        confirmLabel="Pause"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  if (action.what === 'resume') {
    return (
      <ConfirmDialog
        title="Resume campaign"
        message={`Resume "${name}"? It runs again from its next time. Runs missed while it was paused are not made up.`}
        confirmLabel="Resume"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
  }
  return (
    <ConfirmDialog
      title="Cancel campaign"
      message={`Cancel "${name}"? It will not run again and cannot be started again. Runs already done stay in the history.`}
      confirmLabel="Cancel campaign"
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function CampaignCard({
  campaign: c,
  onEdit,
  onAction,
}: {
  campaign: SmsCampaign;
  onEdit(): void;
  onAction(what: Action['what']): void;
}) {
  const [runs, setRuns] = useState<SmsCampaignRun[] | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const live = c.status === 'ACTIVE' || c.status === 'PAUSED';
  const written = SMS_LANGUAGES.find((l) => c.messages?.[l]);
  const last = c.last_run;

  async function toggleRuns() {
    if (runsOpen) {
      setRunsOpen(false);
      return;
    }
    setRunsOpen(true);
    setRunsError(null);
    try {
      setRuns((await smsCampaigns.get(c.id)).runs ?? []);
    } catch (err) {
      setRunsError(smsOfferErrorMessage(err, 'Could not load the runs.'));
    }
  }

  return (
    <article className="panel sms-card" aria-label={c.name}>
      <header className="sms-card__head">
        <h3 className="sms-card__title">{c.name}</h3>
        <span className="sms-card__badges">
          <span className="sms-card__kind">{KIND_LABEL[c.kind]}</span>
          <Badge tone={TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
        </span>
      </header>
      <dl className="sms-card__facts">
        <div>
          <dt>When</dt>
          <dd>{c.schedule_label}</dd>
        </div>
        <div>
          <dt>Audience</dt>
          <dd>{c.audience_label ?? 'Chosen by the trigger'}</dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd>{c.next_run_at ? formatWhen(c.next_run_at) : c.status === 'PAUSED' ? 'None while paused' : '—'}</dd>
        </div>
        <div>
          <dt>Totals</dt>
          <dd>
            {c.run_count} {c.run_count === 1 ? 'run' : 'runs'} · {c.recipients_total} {c.recipients_total === 1 ? 'customer' : 'customers'} ·{' '}
            {c.sms_parts_total} SMS parts
          </dd>
        </div>
        <div>
          <dt>Last run</dt>
          <dd>
            {last
              ? `${formatWhen(last.ran_at)}: ${runStatusLabel(last.status)}, ${last.recipients} ${last.recipients === 1 ? 'customer' : 'customers'}`
              : c.last_run_at
                ? formatWhen(c.last_run_at)
                : 'Not run yet'}
          </dd>
        </div>
        {written ? (
          <div>
            <dt>Text</dt>
            <dd className="sms-card__text">
              {LANGUAGE_LABEL[written]}: {c.messages[written]}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="row-actions row-actions--wrap">
        {c.status === 'ACTIVE' ? (
          <button type="button" className="button button--ghost button--sm" aria-label={`Pause ${c.name}`} onClick={() => onAction('pause')}>
            Pause
          </button>
        ) : null}
        {c.status === 'PAUSED' ? (
          <button type="button" className="button button--ghost button--sm" aria-label={`Resume ${c.name}`} onClick={() => onAction('resume')}>
            Resume
          </button>
        ) : null}
        {live ? (
          <button type="button" className="button button--ghost button--sm" aria-label={`Edit ${c.name}`} onClick={onEdit}>
            Edit
          </button>
        ) : null}
        {live ? (
          <button type="button" className="button button--ghost button--sm" aria-label={`Cancel ${c.name}`} onClick={() => onAction('cancel')}>
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="button button--ghost button--sm"
          aria-expanded={runsOpen}
          aria-label={`${runsOpen ? 'Hide' : 'Show'} runs of ${c.name}`}
          onClick={() => void toggleRuns()}
        >
          {runsOpen ? 'Hide runs' : 'Run history'}
        </button>
      </div>
      {runsOpen ? (
        runsError ? (
          <p className="field__error">{runsError}</p>
        ) : runs === null ? (
          <Spinner label="Loading the runs" />
        ) : runs.length === 0 ? (
          <p className="form__note">No runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label={`Runs of ${c.name}`}>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="num">
                    Recipients
                  </th>
                  <th scope="col" className="num">
                    SMS parts
                  </th>
                  <th scope="col">Left out</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const left = [
                    r.skipped_capped ? `${r.skipped_capped} already got their share` : null,
                    r.skipped_opted_out ? `${r.skipped_opted_out} opted out` : null,
                    r.skipped_no_phone ? `${r.skipped_no_phone} no usable number` : null,
                  ].filter(Boolean);
                  return (
                    <tr key={r.id}>
                      <td className="cell__secondary">{formatWhen(r.ran_at)}</td>
                      <td>
                        {runStatusLabel(r.status)}
                        {r.reason ? <span className="cell__secondary"> · {r.reason}</span> : null}
                      </td>
                      <td className="num mono">{r.recipients}</td>
                      <td className="num mono">{r.sms_parts}</td>
                      <td className="cell__secondary">{left.length ? left.join(', ') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </article>
  );
}

const TRIGGER_KINDS: readonly SmsTriggerKind[] = ['DAYS_AFTER_LAST_ORDER', 'DAYS_AFTER_SIGNUP', 'NO_ORDER_FOR_DAYS'];
const FREQUENCIES: readonly SmsFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

/** Create or edit one campaign: name, audience, schedule, texts, and the live preview. */
function CampaignForm({ form, onCancel, onSaved }: { form: Form; onCancel(): void; onSaved(): void }) {
  const toast = useToast();
  const placeholders = useSmsPlaceholders();
  const formRef = useRef<HTMLFormElement>(null);
  // The form opens above the list: bring it into view (an edit starts from a card further down).
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'start' });
  }, []);
  const editing = form.mode === 'edit' ? form.campaign : null;
  const kind: SmsCampaignKind = editing ? editing.kind : form.mode === 'create' ? form.kind : 'RECURRING';

  const [name, setName] = useState(editing?.name ?? '');
  const [groupDraft, setGroupDraft] = useState(() => (editing && kind !== 'TRIGGER' ? draftFromAudience(editing.audience) : blankAudienceDraft()));
  const [recurring, setRecurring] = useState<RecurringDraft>(() =>
    editing?.kind === 'RECURRING' ? draftFromRecurring(editing.schedule as never) : blankRecurringDraft()
  );
  const [trigger, setTrigger] = useState<TriggerDraft>(() =>
    editing?.kind === 'TRIGGER' ? draftFromTrigger(editing.schedule as never) : blankTriggerDraft()
  );
  const [onceLocal, setOnceLocal] = useState(() =>
    editing?.kind === 'ONCE' ? sendAtToColomboLocal((editing.schedule as { send_at: string }).send_at) : ''
  );
  const [fallback, setFallback] = useState<SmsLanguage>(editing?.fallback_language ?? 'en');
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(editing ? textsFrom(editing.messages) : EMPTY_TEXTS);
  const [languages, setLanguages] = useState<readonly SmsLanguage[]>(LAUNCH_LANGUAGES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The languages the API writes offers in, plus any the campaign already has text for.
  const shown = useMemo(() => SMS_LANGUAGES.filter((l) => languages.includes(l) || texts[l].trim()), [languages, texts]);
  const multilingual = shown.length > 1;
  const fallbackLanguage = shown.includes(fallback) ? fallback : (shown[0] ?? fallback);

  const built = useMemo(() => audienceFromDraft(groupDraft), [groupDraft]);
  const recurringBuilt = useMemo(() => recurringFromDraft(recurring), [recurring]);
  const triggerBuilt = useMemo(() => triggerFromDraft(trigger), [trigger]);
  const onceAt = colomboLocalToSendAt(onceLocal);
  const messages = useMemo(() => messagesOf(texts, shown), [texts, shown]);

  // What the preview asks (a trigger previews who it would text today); '' = nothing valid yet.
  const previewKey = useMemo(() => {
    if (kind === 'TRIGGER') {
      return triggerBuilt.schedule
        ? JSON.stringify({ kind, fallback_language: fallbackLanguage, messages, schedule: triggerBuilt.schedule })
        : '';
    }
    return built.audience ? JSON.stringify({ kind, audience: built.audience, fallback_language: fallbackLanguage, messages }) : '';
  }, [kind, triggerBuilt, built, fallbackLanguage, messages]);
  const preview = useSmsEstimate(previewKey, smsCampaigns.preview, 'Could not work out who would get it.');
  useEffect(() => {
    if (preview && 'data' in preview && preview.data.languages?.length) {
      const next = preview.data.languages;
      setLanguages((now) => (now.join() === next.join() ? now : next));
    }
  }, [preview]);

  function problem(): string | null {
    if (!name.trim()) return 'Give the campaign a name.';
    if (kind !== 'TRIGGER' && built.problem) return built.problem;
    if (kind === 'RECURRING' && recurringBuilt.problem) return recurringBuilt.problem;
    if (kind === 'TRIGGER' && triggerBuilt.problem) return triggerBuilt.problem;
    if (kind === 'ONCE') {
      if (!onceAt) return 'Pick the date and time to send.';
      if (Date.parse(onceAt) <= Date.now()) return 'Pick a time in the future.';
    }
    if (!messages[fallbackLanguage]) {
      return `Write the ${LANGUAGE_LABEL[fallbackLanguage]} text: customers who have not picked a language get it.`;
    }
    return null;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const stop = problem();
    if (stop) {
      setError(stop);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const patch: SmsCampaignPatch = {
          name: name.trim(),
          fallback_language: fallbackLanguage,
          messages,
          ...(kind !== 'TRIGGER' && built.audience ? { audience: built.audience } : {}),
          schedule: kind === 'RECURRING' ? recurringBuilt.schedule! : kind === 'TRIGGER' ? triggerBuilt.schedule! : { send_at: onceAt! },
        };
        await smsCampaigns.update(editing.id, patch);
        toast.success(`Saved "${name.trim()}". The changes apply to its next runs.`);
      } else if (kind === 'TRIGGER') {
        const body: SmsCampaignInput = {
          kind: 'TRIGGER',
          name: name.trim(),
          fallback_language: fallbackLanguage,
          messages,
          schedule: triggerBuilt.schedule!,
        };
        await smsCampaigns.create(body);
        toast.success(`Created "${name.trim()}".`);
      } else {
        const body: SmsCampaignInput = {
          kind: 'RECURRING',
          name: name.trim(),
          audience: built.audience!,
          fallback_language: fallbackLanguage,
          messages,
          schedule: recurringBuilt.schedule!,
        };
        await smsCampaigns.create(body);
        toast.success(`Created "${name.trim()}".`);
      }
      onSaved();
    } catch (err) {
      setError(smsOfferErrorMessage(err, 'Could not save the campaign.'));
    } finally {
      setSaving(false);
    }
  }

  const title = editing ? 'Edit campaign' : kind === 'TRIGGER' ? 'New automatic campaign' : 'New repeating campaign';
  const set = <K extends keyof TriggerDraft>(key: K, value: TriggerDraft[K]) => setTrigger((t) => ({ ...t, [key]: value }));
  const setR = <K extends keyof RecurringDraft>(key: K, value: RecurringDraft[K]) => setRecurring((r) => ({ ...r, [key]: value }));

  return (
    <form ref={formRef} className="sms-offers sms-form" aria-label={title} onSubmit={save} noValidate>
      <div className="form panel sms-offers__compose">
        <h2 className="panel__title">{title}</h2>
        <Field label="Name" hint="To find it in the list.">
          <input className="input" aria-label="Name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        {kind === 'TRIGGER' ? (
          <section className="form__section" aria-label="Trigger">
            <Field label="Send" hint={TRIGGER_HELP[trigger.trigger]}>
              <select className="input" aria-label="Send" value={trigger.trigger} onChange={(e) => set('trigger', e.target.value as SmsTriggerKind)}>
                {TRIGGER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {TRIGGER_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form__row">
              <Field label={trigger.trigger === 'NO_ORDER_FOR_DAYS' ? 'No order for (days)' : 'Number of days'} hint="1 to 365">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  aria-label="Days"
                  value={trigger.days}
                  onChange={(e) => set('days', e.target.value)}
                />
              </Field>
              <Field label="Check every day at (Sri Lanka time)">
                <input className="input" type="time" aria-label="Check at" value={trigger.time} onChange={(e) => set('time', e.target.value)} />
              </Field>
            </div>
            {trigger.trigger === 'DAYS_AFTER_SIGNUP' ? (
              <p className="panel__body">
                <Switch
                  checked={trigger.only_if_never_ordered}
                  onChange={(on) => set('only_if_never_ordered', on)}
                  label="Only if they have not ordered"
                >
                  Only if they have not ordered ({trigger.only_if_never_ordered ? 'on' : 'off'})
                </Switch>
              </p>
            ) : null}
            {trigger.trigger === 'NO_ORDER_FOR_DAYS' ? (
              <Field label="Do not text the same customer again for (days)" hint="1 to 365, usually 30">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  aria-label="Cooldown days"
                  value={trigger.cooldown_days}
                  onChange={(e) => set('cooldown_days', e.target.value)}
                />
              </Field>
            ) : null}
            {!triggerBuilt.schedule ? (
              <p className="field__error" role="alert">
                {triggerBuilt.problem}
              </p>
            ) : null}
          </section>
        ) : (
          <>
            <CustomerGroupPicker
              value={groupDraft}
              onChange={setGroupDraft}
              groups={SMS_AUDIENCE_GROUPS}
              count={
                preview && 'data' in preview && preview.key === previewKey ? (
                  <span>
                    {preview.data.recipients} {preview.data.recipients === 1 ? 'customer' : 'customers'} can get it today. Who gets it is worked out again at every run.
                  </span>
                ) : (
                  <Spinner label="Counting the group" />
                )
              }
            />
            {kind === 'ONCE' ? (
              <Field label="Send at (Sri Lanka time)" hint="Up to a year ahead.">
                <input className="input" type="datetime-local" aria-label="Send at" value={onceLocal} onChange={(e) => setOnceLocal(e.target.value)} />
              </Field>
            ) : (
              <section className="form__section" aria-label="Schedule">
                <Field label="Repeat">
                  <select
                    className="input"
                    aria-label="Repeat"
                    value={recurring.frequency}
                    onChange={(e) => setR('frequency', e.target.value as SmsFrequency)}
                  >
                    {FREQUENCIES.map((f) => (
                      <option key={f} value={f}>
                        {FREQUENCY_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </Field>
                {recurring.frequency === 'WEEKLY' ? (
                  <div className="field">
                    <span className="field__label" id="sms-weekdays-label">
                      On
                    </span>
                    <div className="sms-offers__chips" role="group" aria-labelledby="sms-weekdays-label">
                      {WEEKDAYS.map((w) => {
                        const on = recurring.weekdays.includes(w.key);
                        return (
                          <button
                            key={w.key}
                            type="button"
                            className={on ? 'segmented__item is-selected sms-offers__day' : 'segmented__item sms-offers__day'}
                            aria-pressed={on}
                            aria-label={w.long}
                            onClick={() => setR('weekdays', on ? recurring.weekdays.filter((d) => d !== w.key) : [...recurring.weekdays, w.key])}
                          >
                            {w.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {recurring.frequency === 'MONTHLY' ? (
                  <Field label="Day of the month" hint="1 to 28">
                    <input
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={28}
                      aria-label="Day of the month"
                      value={recurring.month_day}
                      onChange={(e) => setR('month_day', e.target.value)}
                    />
                  </Field>
                ) : null}
                <div className="form__row">
                  <Field label="At (Sri Lanka time)">
                    <input className="input" type="time" aria-label="At" value={recurring.time} onChange={(e) => setR('time', e.target.value)} />
                  </Field>
                  <Field label="Starts on (optional)">
                    <input
                      className="input"
                      type="date"
                      aria-label="Starts on"
                      value={recurring.starts_on}
                      onChange={(e) => setR('starts_on', e.target.value)}
                    />
                  </Field>
                  <Field label="Ends on (optional)">
                    <input
                      className="input"
                      type="date"
                      aria-label="Ends on"
                      value={recurring.ends_on}
                      onChange={(e) => setR('ends_on', e.target.value)}
                    />
                  </Field>
                </div>
              </section>
            )}
          </>
        )}

        {multilingual ? (
          <div className="form__row">
            <Field label="Customers without a language get">
              <select className="input" value={fallbackLanguage} onChange={(e) => setFallback(e.target.value as SmsLanguage)}>
                {shown.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABEL[l]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <SmsTemplateBar texts={texts} enabled={shown} onPick={setTexts} />

        {shown.map((lang) => (
          <SmsTextEditor
            key={lang}
            language={lang}
            value={texts[lang]}
            placeholders={placeholders}
            onChange={(value) => setTexts((t) => ({ ...t, [lang]: value }))}
          />
        ))}

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
            {saving ? <Spinner label="Saving" /> : editing ? 'Save changes' : 'Create campaign'}
          </button>
        </div>
      </div>

      <aside className="panel sms-offers__estimate" aria-label="Preview">
        <h2 className="panel__title">{kind === 'TRIGGER' ? 'Who it would text today' : 'Who gets it'}</h2>
        {previewKey ? (
          <EstimateBody estimate={preview} currentKey={previewKey} fallback={fallbackLanguage} multilingual={multilingual} />
        ) : (
          <p className="form__note">Fill in the schedule to see who would get it.</p>
        )}
      </aside>
    </form>
  );
}
