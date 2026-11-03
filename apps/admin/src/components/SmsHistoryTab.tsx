import { Fragment, useCallback, useEffect, useState } from 'react';
import { smsCampaigns } from '../api/resources';
import type { SmsHistoryItem } from '../api/types';
import { KIND_LABEL, formatWhen, runStatusLabel } from '../lib/smsCampaigns';
import { LANGUAGE_LABEL, SMS_LANGUAGES, smsOfferErrorMessage } from '../lib/smsOffers';
import { EmptyState, Spinner } from './ui';

/**
 * History: offers sent right now and every run of a scheduled or automatic campaign, newest first
 * (GET /admin/sms-campaigns/history).
 */
export function SmsHistoryTab() {
  const [items, setItems] = useState<SmsHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await smsCampaigns.history()) ?? []);
      setError(null);
    } catch (err) {
      setError(smsOfferErrorMessage(err, 'Could not load the history.'));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="SMS history">
      {error ? <p className="field__error">{error}</p> : null}
      {items === null ? (
        <Spinner label="Loading the history" />
      ) : items.length === 0 ? (
        error ? null : <EmptyState title="Nothing sent yet" message="Offers you send and the runs of scheduled campaigns show here." />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Sent history">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Result</th>
                <th scope="col">Audience</th>
                <th scope="col" className="num">
                  Recipients
                </th>
                <th scope="col" className="num">
                  SMS parts
                </th>
                <th scope="col">Left out</th>
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const open = openId === item.id;
                const written = SMS_LANGUAGES.filter((l) => item.messages?.[l]);
                const left = [
                  item.skipped_capped ? `${item.skipped_capped} already got their share` : null,
                  item.skipped_opted_out ? `${item.skipped_opted_out} opted out` : null,
                  item.skipped_no_phone ? `${item.skipped_no_phone} no usable number` : null,
                ].filter(Boolean);
                const hasDetails = written.length > 0 || !!item.reason;
                return (
                  <Fragment key={`${item.type}-${item.id}`}>
                    <tr>
                      <td className="cell__secondary">{formatWhen(item.at)}</td>
                      <td>
                        {item.name}
                        {item.type === 'CAMPAIGN_RUN' && item.campaign_kind ? (
                          <span className="cell__secondary"> · {KIND_LABEL[item.campaign_kind]}</span>
                        ) : null}
                        {item.type === 'OFFER' && item.sent_by_name ? <span className="cell__secondary"> · {item.sent_by_name}</span> : null}
                      </td>
                      <td>{runStatusLabel(item.status)}</td>
                      <td className="cell__secondary">{item.audience_label ?? '—'}</td>
                      <td className="num mono">{item.recipients}</td>
                      <td className="num mono">{item.sms_parts}</td>
                      <td className="cell__secondary">{left.length ? left.join(', ') : '—'}</td>
                      <td>
                        {hasDetails ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            aria-expanded={open}
                            aria-label={`${open ? 'Hide' : 'Show'} details of ${item.name} ${formatWhen(item.at)}`}
                            onClick={() => setOpenId(open ? null : item.id)}
                          >
                            {open ? 'Hide' : 'Details'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="order-expand">
                        <td colSpan={8}>
                          {item.reason ? <p className="form__note">{item.reason}</p> : null}
                          <dl className="sms-offers__texts">
                            {written.map((l) => (
                              <div key={l}>
                                <dt>{LANGUAGE_LABEL[l]}</dt>
                                <dd>{item.messages?.[l]}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
