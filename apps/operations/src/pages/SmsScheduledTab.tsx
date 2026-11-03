import { useCallback, useEffect, useState } from 'react';
import { smsCampaigns } from '../api/resources';
import type { SmsCampaign, SmsCampaignRun } from '../api/types';
import { SmsCampaignForm } from '../components/SmsCampaignForm';
import { ConfirmDialog, EmptyState, Spinner, Status } from '../components/ui';
import { LANGUAGE_LABEL, SMS_LANGUAGES } from '../lib/sms';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, formatWhen, runStatusText, skippedText } from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';

/**
 * SMS offers > Scheduled and automatic: everything that is sent later or on its own - offers
 * scheduled from Send, repeating campaigns and automatic triggers - with its status, next run and
 * totals. Pause, resume, edit (future runs only), cancel and see each run.
 */

type Action = 'pause' | 'resume' | 'cancel';
const ACTION_TEXT: Record<Action, { title: string; confirm: string; message: (c: SmsCampaign) => string; done: string; destructive: boolean }> = {
  pause: {
    title: 'Pause campaign',
    confirm: 'Pause',
    message: (c) => `Pause "${c.name}"? Nothing is sent until you resume it.`,
    done: 'paused',
    destructive: false,
  },
  resume: {
    title: 'Resume campaign',
    confirm: 'Resume',
    message: (c) => `Resume "${c.name}"? It carries on from its next time; runs missed while paused are not sent.`,
    done: 'resumed',
    destructive: false,
  },
  cancel: {
    title: 'Cancel campaign',
    confirm: 'Cancel campaign',
    message: (c) => `Cancel "${c.name}"? It will never be sent again. This cannot be undone.`,
    done: 'cancelled',
    destructive: true,
  },
};

const HISTORY_PREVIEW = 80;
const truncate = (text: string) => (text.length > HISTORY_PREVIEW ? `${text.slice(0, HISTORY_PREVIEW - 1)}…` : text);

export function SmsScheduledTab() {
  const [campaigns, setCampaigns] = useState<SmsCampaign[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<{ editing?: SmsCampaign } | null>(null);
  const [confirm, setConfirm] = useState<{ campaign: SmsCampaign; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await smsCampaigns.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(smsErrorMessage(err, 'Could not load the scheduled messages.'));
      setCampaigns((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(campaign: SmsCampaign, action: Action) {
    setConfirm(null);
    setBusy(campaign.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await smsCampaigns[action](campaign.id);
      setNotice(`"${campaign.name}" ${ACTION_TEXT[action].done}.`);
      setCampaigns((list) => (list ?? []).map((c) => (c.id === updated.id ? updated : c)));
      void load();
    } catch (err) {
      setError(smsErrorMessage(err, 'Could not change the campaign.'));
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (form) {
    return (
      <div className="sms-tab">
        <SmsCampaignForm
          editing={form.editing}
          onCancel={() => setForm(null)}
          onSaved={(saved) => {
            setForm(null);
            setNotice(form.editing ? `Saved changes to "${saved.name}".` : `"${saved.name}" is on: ${saved.schedule_label}.`);
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
        New automatic SMS
      </button>
      <p className="page__note">
        Repeat an SMS on a schedule, or let it go out by itself a few days after an order or sign-up. To send one offer later, use
        Schedule for on the Send tab.
      </p>
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
      {campaigns === null ? (
        <Spinner label="Loading scheduled messages" />
      ) : campaigns.length === 0 ? (
        loadError ? null : <EmptyState title="Nothing scheduled" message="Scheduled and automatic SMS show here." />
      ) : (
        <ul className="cat-list" aria-label="Scheduled and automatic SMS">
          {campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              busy={busy === c.id}
              onAction={(action) => setConfirm({ campaign: c, action })}
              onEdit={() => {
                setNotice(null);
                setError(null);
                setForm({ editing: c });
              }}
            />
          ))}
        </ul>
      )}
      {confirm ? (
        <ConfirmDialog
          title={ACTION_TEXT[confirm.action].title}
          message={ACTION_TEXT[confirm.action].message(confirm.campaign)}
          confirmLabel={ACTION_TEXT[confirm.action].confirm}
          destructive={ACTION_TEXT[confirm.action].destructive}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void run(confirm.campaign, confirm.action)}
        />
      ) : null}
    </div>
  );
}

function CampaignRow({
  campaign: c,
  busy,
  onAction,
  onEdit,
}: {
  campaign: SmsCampaign;
  busy: boolean;
  onAction(action: Action): void;
  onEdit(): void;
}) {
  const [runs, setRuns] = useState<SmsCampaignRun[] | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const live = c.status === 'ACTIVE' || c.status === 'PAUSED';

  async function toggleRuns() {
    const next = !showRuns;
    setShowRuns(next);
    if (!next) return;
    setRunsError(null);
    try {
      setRuns((await smsCampaigns.get(c.id)).runs);
    } catch (err) {
      setRunsError(smsErrorMessage(err, 'Could not load the runs.'));
    }
  }

  return (
    <li className="cat-row cat-row--flat sms-campaign" aria-label={c.name}>
      <div className="cat-row__main">
        <div className="sms-campaign__top">
          <p className="cat-row__title">{c.name}</p>
          <span className="chip">{KIND_LABEL[c.kind]}</span>
          <Status tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Status>
        </div>
        <p className="cat-row__meta">{c.schedule_label}</p>
        {c.audience_label ? <p className="cat-row__meta">{c.audience_label}</p> : null}
        {c.status === 'ACTIVE' && c.next_run_at ? <p className="cat-row__meta">Next run: {formatWhen(c.next_run_at)}</p> : null}
        <p className="cat-row__meta">
          {c.run_count} {c.run_count === 1 ? 'run' : 'runs'} &middot; {c.recipients_total} customers &middot; {c.sms_parts_total} SMS parts
        </p>
        {c.last_run ? (
          <p className="cat-row__meta">
            Last run: {formatWhen(c.last_run.ran_at)} &middot; {runStatusText(c.last_run.status)} &middot; {c.last_run.recipients} customers
          </p>
        ) : null}
        {SMS_LANGUAGES.map((l) =>
          c.messages[l] ? (
            <p key={l} className="cat-row__meta sms-history__text">
              <strong>{LANGUAGE_LABEL[l]}:</strong> {truncate(c.messages[l]!)}
            </p>
          ) : null
        )}
        <div className="sms-actions">
          {c.status === 'ACTIVE' ? (
            <button type="button" className="button" disabled={busy} aria-label={`Pause ${c.name}`} onClick={() => onAction('pause')}>
              Pause
            </button>
          ) : null}
          {c.status === 'PAUSED' ? (
            <button type="button" className="button" disabled={busy} aria-label={`Resume ${c.name}`} onClick={() => onAction('resume')}>
              Resume
            </button>
          ) : null}
          {live ? (
            <button type="button" className="button" disabled={busy} aria-label={`Edit ${c.name}`} onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {live ? (
            <button type="button" className="button button--ghost" disabled={busy} aria-label={`Cancel ${c.name}`} onClick={() => onAction('cancel')}>
              Cancel
            </button>
          ) : null}
          <button type="button" className="button button--ghost" aria-expanded={showRuns} aria-label={`Runs of ${c.name}`} onClick={() => void toggleRuns()}>
            {showRuns ? 'Hide runs' : 'Runs'}
          </button>
        </div>
        {showRuns ? (
          runsError ? (
            <p className="field__error" role="alert">
              {runsError}
            </p>
          ) : runs === null ? (
            <Spinner label="Loading runs" />
          ) : runs.length === 0 ? (
            <p className="field__hint">It has not run yet.</p>
          ) : (
            <ul className="sms-runs" aria-label={`Runs of ${c.name}`}>
              {runs.map((r) => (
                <li key={r.id}>
                  <strong>{formatWhen(r.ran_at)}</strong> &middot; {runStatusText(r.status)} &middot; {r.recipients} customers &middot; {r.sms_parts} SMS parts
                  {skippedText(r) ? <> &middot; {skippedText(r)}</> : null}
                  {r.reason ? <> &middot; {r.reason}</> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </li>
  );
}
