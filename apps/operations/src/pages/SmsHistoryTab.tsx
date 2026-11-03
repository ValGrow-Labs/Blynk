import { useEffect, useState } from 'react';
import { smsCampaigns } from '../api/resources';
import type { SmsHistoryItem } from '../api/types';
import { EmptyState, Spinner, Status } from '../components/ui';
import { LANGUAGE_LABEL, SMS_LANGUAGES } from '../lib/sms';
import { HISTORY_TYPE_LABEL, formatWhen, runStatusText, skippedText } from '../lib/smsCampaigns';
import { smsErrorMessage } from '../lib/smsErrors';

/**
 * SMS offers > History: one list, newest first, of the offers sent right now and every run of a
 * scheduled or automatic campaign, with who it reached, the SMS parts and what was skipped.
 */
const HISTORY_PREVIEW = 80;
const truncate = (text: string) => (text.length > HISTORY_PREVIEW ? `${text.slice(0, HISTORY_PREVIEW - 1)}…` : text);

export function SmsHistoryTab() {
  const [items, setItems] = useState<SmsHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    smsCampaigns
      .history()
      .then((list) => live && setItems(list))
      .catch((err) => {
        if (!live) return;
        setError(smsErrorMessage(err, 'Could not load the history.'));
        setItems([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="sms-tab">
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {items === null ? (
        <Spinner label="Loading history" />
      ) : items.length === 0 ? (
        error ? null : <EmptyState title="Nothing sent yet" message="Offers sent now and runs of scheduled SMS show here." />
      ) : (
        <ul className="cat-list" aria-label="SMS history">
          {items.map((item) => {
            const skipped = skippedText({
              skipped_opted_out: item.skipped_opted_out ?? 0,
              skipped_capped: item.skipped_capped ?? 0,
              skipped_no_phone: item.skipped_no_phone ?? 0,
            });
            return (
            <li key={`${item.type}-${item.id}`} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <div className="sms-campaign__top">
                  <p className="cat-row__title">{item.name}</p>
                  <span className="chip">{HISTORY_TYPE_LABEL[item.type]}</span>
                  <Status tone={item.status === 'SENT' ? 'ok' : 'warn'}>{runStatusText(item.status)}</Status>
                </div>
                <p className="cat-row__meta">
                  {formatWhen(item.at)}
                  {item.sent_by_name ? <> &middot; {item.sent_by_name}</> : null}
                </p>
                {item.audience_label ? <p className="cat-row__meta">{item.audience_label}</p> : null}
                <p className="cat-row__meta">
                  {item.recipients} customers &middot; {item.sms_parts} SMS parts
                </p>
                {skipped ? <p className="cat-row__meta">{skipped}</p> : null}
                {item.reason ? <p className="cat-row__meta">{item.reason}</p> : null}
                {item.messages
                  ? SMS_LANGUAGES.map((l) =>
                      item.messages![l] ? (
                        <p key={l} className="cat-row__meta sms-history__text">
                          <strong>{LANGUAGE_LABEL[l]}:</strong> {truncate(item.messages![l]!)}
                        </p>
                      ) : null
                    )
                  : null}
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
