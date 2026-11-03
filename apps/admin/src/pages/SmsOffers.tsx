import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { smsOffers as smsOffersApi } from '../api/resources';
import type { SmsLanguage } from '../api/types';
import { CustomerGroupPicker } from '../components/CustomerGroupPicker';
import { PageHeader } from '../components/Layout';
import { SmsCampaignsTab } from '../components/SmsCampaignsTab';
import { EstimateBody } from '../components/SmsEstimateFigures';
import { SmsHistoryTab } from '../components/SmsHistoryTab';
import { SmsTemplateBar } from '../components/SmsTemplateBar';
import { SmsTemplatesTab } from '../components/SmsTemplatesTab';
import { SmsTextEditor, useSmsPlaceholders } from '../components/SmsTextEditor';
import { ConfirmDialog, Field, Spinner, useToast } from '../components/ui';
import { useSmsEstimate } from '../components/useSmsEstimate';
import { useSignedInUser } from '../auth/AuthContext';
import { SMS_AUDIENCE_GROUPS, audienceFromDraft, audienceLabel, blankAudienceDraft } from '../lib/customerGroups';
import { EMPTY_TEXTS, colomboLocalToSendAt, formatWhen } from '../lib/smsCampaigns';
import { LANGUAGE_LABEL, LAUNCH_LANGUAGES, SMS_LANGUAGES, languageList, offerInput, smsOfferErrorMessage } from '../lib/smsOffers';

/**
 * SMS offers to registered customers. Four tabs (2026-11-03, owner's brother: "no time limits and
 * fully customised, automatic SMS schedule things"):
 *
 *   Send                      the offer form: audience (groups or custom filters), texts with
 *                             {name} {points} {wallet} {app_link}, saved templates, live preview,
 *                             Send now or Schedule for a date and time (Asia/Colombo)
 *   Scheduled and automatic   campaigns that run later, repeat, or fire on a trigger
 *   History                   offers sent now and every campaign run
 *   Templates                 saved texts
 *
 * When texts may go out (any time, quiet hours) and the limits are the "SMS sending rules" in
 * Settings. Each customer gets the text in the language they picked in the app, or the fallback;
 * customers who turned "Offers by SMS" off get nothing.
 *
 * Which languages offers are written in is a backend setting (SMS_OFFER_LANGUAGES, English only at
 * launch) that each estimate reports; the page shows text boxes for those languages only.
 */

export { ESTIMATE_DELAY_MS } from '../components/useSmsEstimate';

type TabId = 'send' | 'scheduled' | 'history' | 'templates';
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'send', label: 'Send' },
  { id: 'scheduled', label: 'Scheduled and automatic' },
  { id: 'history', label: 'History' },
  { id: 'templates', label: 'Templates' },
];

export function SmsOffers() {
  const [tab, setTab] = useState<TabId>('send');
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  function select(id: TabId, focus = false) {
    setTab(id);
    if (focus) tabRefs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = TABS.length - 1;
    const at = TABS.findIndex((t) => t.id === tab);
    let to: number;
    if (event.key === 'ArrowRight') to = at === last ? 0 : at + 1;
    else if (event.key === 'ArrowLeft') to = at === 0 ? last : at - 1;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = last;
    else return;
    event.preventDefault();
    select(TABS[to]!.id, true);
  }

  return (
    <>
      <PageHeader
        title="SMS offers"
        description="Send an offer now or at a set time, repeat it, or let it go out by itself. Texts go out at any time unless you set quiet hours in the SMS sending rules."
        actions={
          <Link className="button button--ghost" to="/settings#sms-sending-rules">
            SMS sending rules
          </Link>
        }
      />
      <div className="settings-tabs" role="tablist" aria-label="SMS offers" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`sms-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`sms-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'settings-tabs__tab is-selected' : 'settings-tabs__tab'}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Send stays mounted while another tab is open, so a half-written offer is not lost. */}
      <div role="tabpanel" id="sms-panel-send" aria-labelledby="sms-tab-send" hidden={tab !== 'send'}>
        <SendTab />
      </div>
      {tab === 'scheduled' ? (
        <div role="tabpanel" id="sms-panel-scheduled" aria-labelledby="sms-tab-scheduled">
          <SmsCampaignsTab />
        </div>
      ) : null}
      {tab === 'history' ? (
        <div role="tabpanel" id="sms-panel-history" aria-labelledby="sms-tab-history">
          <SmsHistoryTab />
        </div>
      ) : null}
      {tab === 'templates' ? (
        <div role="tabpanel" id="sms-panel-templates" aria-labelledby="sms-tab-templates">
          <SmsTemplatesTab />
        </div>
      ) : null}
    </>
  );
}

/** The Send tab: the offer form, the live numbers, and Send now / Schedule for. */
function SendTab() {
  const toast = useToast();
  const placeholders = useSmsPlaceholders();
  // "Send to" (customer groups, 2026-10-24) replaces the old audience words; CUSTOM filters 2026-11-03.
  const [groupDraft, setGroupDraft] = useState(blankAudienceDraft);
  const built = useMemo(() => audienceFromDraft(groupDraft), [groupDraft]);
  const [fallback, setFallback] = useState<SmsLanguage>('en');
  const [texts, setTexts] = useState<Record<SmsLanguage, string>>(EMPTY_TEXTS);
  const [languages, setLanguages] = useState<readonly SmsLanguage[]>(LAUNCH_LANGUAGES);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Now, or later: "Schedule for" a date and time in Sri Lanka time.
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [sendAtLocal, setSendAtLocal] = useState('');
  const [scheduleName, setScheduleName] = useState('');
  // "Send test to": admins have no phone (backend migration 028), so they
  // enter one; prefilled with the account's own phone when it has one.
  const ownPhone = useSignedInUser()?.phone ?? '';
  const [testPhone, setTestPhone] = useState(ownPhone);
  useEffect(() => {
    if (ownPhone) setTestPhone((current) => current || ownPhone);
  }, [ownPhone]);

  const enabled = useMemo(() => SMS_LANGUAGES.filter((l) => languages.includes(l)), [languages]);
  const multilingual = enabled.length > 1;
  const input = useMemo(
    () => offerInput(built.audience ?? { group: 'ALL' }, fallback, texts, enabled),
    [built.audience, fallback, texts, enabled]
  );
  // A group with a bad number is not counted (the picker says why) and cannot be sent.
  const key = built.audience ? JSON.stringify(input) : '';

  const estimate = useSmsEstimate(key, smsOffersApi.estimate, 'Could not count the customers.');
  // Keep the same array when unchanged so the body (and key) stays put.
  useEffect(() => {
    if (estimate && 'data' in estimate && estimate.data.languages?.length) {
      const next = estimate.data.languages;
      setLanguages((now) => (now.join() === next.join() ? now : next));
    }
  }, [estimate]);

  const current = key && estimate && estimate.key === key && 'data' in estimate ? estimate.data : null;
  const hasText = Object.keys(input.messages).length > 0;

  const sendAt = when === 'later' ? colomboLocalToSendAt(sendAtLocal) : null;
  const timeProblem =
    when !== 'later' ? null : !sendAt ? 'Pick the date and time to send.' : Date.parse(sendAt) <= Date.now() ? 'Pick a time in the future.' : null;
  const canSend =
    !!current && hasText && current.recipients > 0 && current.missing_languages.length === 0 && !sending && !timeProblem;

  async function send() {
    if (!current) return;
    setConfirming(false);
    setSending(true);
    setSendError(null);
    try {
      if (when === 'later' && sendAt) {
        const name = scheduleName.trim();
        await smsOffersApi.send({ ...input, send_at: sendAt, ...(name ? { name } : {}) });
        toast.success(`Offer scheduled for ${formatWhen(sendAt)} (Sri Lanka time). Find it under Scheduled and automatic.`);
        setSendAtLocal('');
        setScheduleName('');
      } else {
        const result = await smsOffersApi.send(input);
        const n = result.offer?.recipients ?? current.recipients;
        toast.success(`Offer sent to ${n} ${n === 1 ? 'customer' : 'customers'}.`);
      }
      setTexts(EMPTY_TEXTS);
    } catch (err) {
      setSendError(smsOfferErrorMessage(err, when === 'later' ? 'Could not schedule the offer.' : 'Could not send the offer.'));
    } finally {
      setSending(false);
    }
  }

  const who = `${current?.recipients ?? 0} ${current?.recipients === 1 ? 'customer' : 'customers'}`;

  return (
    <>
      <div className="sms-offers">
        <div className="form sms-offers__compose">
          <CustomerGroupPicker
            value={groupDraft}
            onChange={setGroupDraft}
            groups={SMS_AUDIENCE_GROUPS}
            count={
              current ? (
                <span data-testid="sms-group-count">
                  {current.recipients} {current.recipients === 1 ? 'customer' : 'customers'}
                  {groupDraft.group === 'ALL' ? '' : ' in this group'} can get offers by SMS.
                </span>
              ) : (
                <Spinner label="Counting the group" />
              )
            }
          />
          {multilingual ? (
            <div className="form__row">
              <Field label="Customers without a language get">
                <select className="input" value={input.fallback_language} onChange={(e) => setFallback(e.target.value as SmsLanguage)}>
                  {enabled.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <Field label="Send test to" hint="The mobile number test SMS go to, e.g. 077 123 4567.">
            <input
              className="input"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="077 123 4567"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </Field>

          <SmsTemplateBar texts={texts} enabled={enabled} onPick={setTexts} />

          {enabled.map((lang) => (
            <SmsTextEditor
              key={lang}
              language={lang}
              value={texts[lang]}
              placeholders={placeholders}
              testPhone={testPhone}
              onChange={(value) => setTexts((t) => ({ ...t, [lang]: value }))}
            />
          ))}

          <section className="form__section sms-offers__when" aria-label="When to send">
            <span className="field__label" id="sms-when-label">
              When
            </span>
            <div className="segmented" role="group" aria-labelledby="sms-when-label">
              <button
                type="button"
                className={when === 'now' ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={when === 'now'}
                onClick={() => setWhen('now')}
              >
                Send now
              </button>
              <button
                type="button"
                className={when === 'later' ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={when === 'later'}
                onClick={() => setWhen('later')}
              >
                Schedule for
              </button>
            </div>
            {when === 'later' ? (
              <div className="form__row">
                <Field label="Send at (Sri Lanka time)" hint="Up to a year ahead." error={sendAtLocal && timeProblem ? timeProblem : undefined}>
                  <input
                    className="input"
                    type="datetime-local"
                    aria-label="Send at"
                    value={sendAtLocal}
                    onChange={(e) => setSendAtLocal(e.target.value)}
                  />
                </Field>
                <Field label="Name (optional)" hint="To find it in Scheduled and automatic.">
                  <input
                    className="input"
                    aria-label="Name"
                    maxLength={120}
                    value={scheduleName}
                    onChange={(e) => setScheduleName(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="panel sms-offers__estimate" aria-label="Estimate">
          <h2 className="panel__title">Who gets it</h2>
          <EstimateBody estimate={estimate} currentKey={key} fallback={input.fallback_language} multilingual={multilingual} />

          {current && current.missing_languages.length > 0 ? (
            <p className="sms-offers__warning" role="alert">
              Write the {languageList(current.missing_languages)} text: some customers in this audience get{' '}
              {current.missing_languages.length === 1 ? 'that language' : 'those languages'}.
            </p>
          ) : null}
          {current && current.recipients === 0 ? <p className="sms-offers__warning">No customer in this audience can receive offers.</p> : null}
          {sendError ? (
            <p className="field__error" role="alert">
              {sendError}
            </p>
          ) : null}

          <button type="button" className="button sms-offers__send" disabled={!canSend} onClick={() => setConfirming(true)}>
            {sending ? <Spinner label={when === 'later' ? 'Scheduling offer' : 'Sending offer'} /> : when === 'later' ? 'Schedule offer' : 'Send offer'}
          </button>
        </aside>
      </div>

      {confirming && current ? (
        <ConfirmDialog
          title={when === 'later' ? 'Schedule offer' : 'Send offer'}
          message={
            when === 'later' && sendAt
              ? `Send on ${formatWhen(sendAt)} (Sri Lanka time) to ${
                  input.audience.group === 'ALL' ? 'all customers' : audienceLabel(input.audience)
                }? Who gets it is worked out again at that time. Right now that is ${who}, about ${current.sms_parts_total} SMS parts.`
              : `Send to ${who}${input.audience.group === 'ALL' ? '' : ` (${audienceLabel(input.audience)})`}, about ${current.sms_parts_total} SMS parts?`
          }
          confirmLabel={when === 'later' ? 'Schedule' : 'Send'}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      ) : null}
    </>
  );
}
