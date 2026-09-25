import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { delivery as deliveryApi } from '../../api/resources';
import type { DeliverySummary } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { useAuth } from '../../auth/AuthContext';
import { deliveryErrorMessage, splitQueue, statusLabel, statusTone } from '../../lib/delivery';
import { errorCode } from '../../lib/errors';
import { formatMoney, shortNumber } from '../../lib/orders';

/** How often the queue re-reads while it is on screen and visible (matches
 * Rider's own ~30s cadence, plan §9's "no polling faster than what
 * Admin/Rider already do"). */
const REFRESH_MS = 30_000;

/**
 * Delivery Mode's queue - "what do I act on now?" (plan §11), reusing the
 * exact rider endpoints B1 widened for an ADMIN+linked-rider operator
 * (task-B1-report.md). Ported from apps/rider/src/pages/Queue.tsx's own
 * layout (common.md rule 2: a fresh implementation, not an import),
 * restyled for Operations' own `.page`/`.card`/`.button` primitives instead
 * of Rider's `page`/`slip`/`row` classes.
 *
 * This screen never itself starts or stops live-location tracking - only
 * `pages/Delivery/Detail.tsx` does that, and only while a trackable delivery
 * is actually open there (common.md rule 10).
 */
export function Queue() {
  const { riderCapability, refreshRiderCapability } = useAuth();
  const [deliveries, setDeliveries] = useState<DeliverySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const list = await deliveryApi.list();
        setDeliveries(list);
        setError(null);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'RIDER_PROFILE_NOT_FOUND' || code === 'RIDER_INACTIVE') {
          // The rider profile this session's login-time probe confirmed may
          // have been deactivated mid-session - re-probe rather than show a
          // stale "you have delivery capability" screen (this task's brief).
          await refreshRiderCapability();
          return;
        }
        setError(deliveryErrorMessage(err));
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [refreshRiderCapability]
  );

  useEffect(() => {
    if (riderCapability !== 'ADMIN_PLUS_RIDER') return;
    void load(false);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [riderCapability, load]);

  if (riderCapability === 'ADMIN_ONLY') {
    return (
      <div className="page">
        <PageHeader title="Delivery" description="Delivery Mode" />
        <p className="banner banner--muted" role="status">
          No rider profile is linked to this account yet.
        </p>
      </div>
    );
  }

  if (riderCapability === null) {
    return (
      <div className="page">
        <PageHeader title="Delivery" description="Delivery Mode" />
        <p className="loading" role="status">
          Checking delivery capability…
        </p>
      </div>
    );
  }

  const queue = deliveries ? splitQueue(deliveries) : null;

  return (
    <div className="page">
      <PageHeader
        title="Delivery"
        description="Your deliveries, oldest assignment first."
        actions={
          <button type="button" className="button button--ghost" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error ? (
        <p className="field__error" role="status">
          {error}
        </p>
      ) : null}
      {!queue && !error ? (
        <p className="loading" role="status">
          Loading your deliveries…
        </p>
      ) : null}

      {queue ? (
        <>
          {queue.now ? <NowCard delivery={queue.now} /> : null}

          {!queue.now && queue.next.length === 0 ? (
            <p className="attention__clear">No deliveries assigned to you right now.</p>
          ) : null}

          {queue.next.length > 0 ? (
            <section className="section" aria-labelledby="queue-next-heading">
              <h2 className="section-label" id="queue-next-heading">
                Next
              </h2>
              <ul className="lane__rows">
                {queue.next.map((d) => (
                  <li key={d.delivery_id} className="ticket">
                    <Link to={`/delivery/${d.delivery_id}`} className="ticket__open" aria-label={`Open delivery #${shortNumber(d.order_number)}`}>
                      <span className="ticket__top">
                        <span className="ticket__number mono">#{shortNumber(d.order_number)}</span>
                      </span>
                      <span className="ticket__where">
                        <span className="ticket__place">{d.delivery_address_line1}</span>
                        <span className="ticket__who">{d.delivery_city}</span>
                      </span>
                      <span className="ticket__foot">
                        <span className={`queue-tone queue-tone--${statusTone(d)}`}>{statusLabel(d)}</span>
                        <span className="ticket__total">{formatMoney(d.total_amount)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {queue.done.length > 0 ? (
            <section className="section" aria-labelledby="queue-done-heading">
              <h2 className="section-label" id="queue-done-heading">
                Done today
              </h2>
              <p className="lane__summary">
                {queue.done.length} delivered · {formatMoney(queue.collectedToday)} collected
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NowCard({ delivery: d }: { delivery: DeliverySummary }) {
  const number = shortNumber(d.order_number);
  const owesCash = d.payment_method === 'COD' && d.payment_status === 'PENDING';
  return (
    <section className="card" aria-labelledby="queue-now-heading">
      <div className="delivery-card__status" id="queue-now-heading">
        {statusLabel(d)}
      </div>
      <p className="delivery-card__dest">{d.delivery_address_line1}</p>
      {d.delivery_address_line2 ? <p className="order-detail__meta">{d.delivery_address_line2}</p> : null}
      <p className="delivery-card__meta">
        <span className="mono">#{number}</span>
        <span>{d.delivery_recipient_name}</span>
        <span>{d.delivery_city}</span>
      </p>
      {owesCash ? (
        <p className="delivery-card__meta">
          <span className="order-detail__strong">Cash to collect: {formatMoney(d.total_amount)}</span>
        </p>
      ) : null}
      <Link to={`/delivery/${d.delivery_id}`} className="primary" aria-label={`Open delivery #${number}`}>
        Open delivery
      </Link>
    </section>
  );
}
