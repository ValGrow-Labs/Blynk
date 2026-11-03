import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { PageHeader } from '../components/Layout';
import { SmsHistoryTab } from './SmsHistoryTab';
import { SmsScheduledTab } from './SmsScheduledTab';
import { SmsSendTab } from './SmsSendTab';
import { SmsTemplatesTab } from './SmsTemplatesTab';
import '../components/sms.css';

/**
 * More -> SMS offers (owner, 2026-10-06; tabs 2026-11-03). Admin and Operations write an offer in
 * Sinhala, Tamil and/or English and send it to a group of customers - now or later - or set an SMS
 * to repeat or to go out by itself. The backend is the real guard: it picks each customer's
 * language (or the fallback), skips customers who turned offers off, fills in {name}, {points},
 * {wallet} and {app_link} and applies the SMS sending rules (quiet hours, limits, monthly budget).
 *
 * Four tabs (one scrollable row of chips, like More's categories):
 *   Send                       the offer form (stays mounted, so a half-written offer is kept)
 *   Scheduled and automatic    scheduled offers, repeating and automatic campaigns
 *   History                    offers sent now and every campaign run
 *   Templates                  saved texts
 * Only the open tab (and Send, once opened) is mounted: the others fetch nothing until opened.
 */
const TABS = [
  { id: 'send', label: 'Send' },
  { id: 'scheduled', label: 'Scheduled and automatic' },
  { id: 'history', label: 'History' },
  { id: 'templates', label: 'Templates' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function SmsOffers() {
  const [tab, setTab] = useState<TabId>('send');
  // Bumped when Templates changes something, so the pickers on the other tabs load the new list.
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function choose(id: TabId, focus = false) {
    setTab(id);
    const el = refs.current[id];
    if (focus) el?.focus();
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    choose(TABS[next].id, true);
  }

  const panelId = `${base}-panel`;
  return (
    <div className="page sms-page">
      <PageHeader title="SMS offers" description="Send an offer by SMS to your customers, now, later or automatically." />

      <div className="settings-cats__tabs" role="tablist" aria-label="SMS offers">
        {TABS.map((t, index) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              className={selected ? 'settings-cats__tab is-selected' : 'settings-cats__tab'}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(t.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${base}-tab-${tab}`} className="sms-tab">
        <div className="sms-tab" hidden={tab !== 'send'}>
          <SmsSendTab templatesVersion={templatesVersion} />
        </div>
        {tab === 'scheduled' ? <SmsScheduledTab /> : null}
        {tab === 'history' ? <SmsHistoryTab /> : null}
        {tab === 'templates' ? <SmsTemplatesTab onChanged={() => setTemplatesVersion((v) => v + 1)} /> : null}
      </div>
    </div>
  );
}
