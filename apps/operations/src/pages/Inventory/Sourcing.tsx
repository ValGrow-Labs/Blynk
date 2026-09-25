import { useCallback, useEffect, useState } from 'react';
import { inventory as inventoryApi, orders as ordersApi } from '../../api/resources';
import type { OrderSourcing, QueueOrder, SourcingItem, StockRow, Supplier } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner, Status, type Tone } from '../../components/ui';
import { formatDateTime, inventoryErrorMessage, isInventoryError } from '../../lib/inventory';
import { ITEM_STATUS_LABEL, STATUS_LABEL, formatMoney } from '../../lib/orders';
import { SourceItemDialog } from './SourceItemDialog';

export interface QueueEntry {
  order: QueueOrder;
  sourcing: OrderSourcing;
}

/**
 * Open orders with items still to source, oldest first (first in, first
 * out). Reuses `orders.needingPacking()` (`GET /admin/orders?status=
 * PLACED,ITEM_UNAVAILABLE&limit=100` - see that function's own doc comment
 * in `resources.ts` for the F2/F3 attribution correction), rather than
 * duplicating the same query, matching the brief's explicit instruction.
 * Ported from Inventory's own `SourcingQueue.tsx:loadQueue` (a fresh
 * implementation, not an import - common.md rule 2).
 */
export async function loadQueue(): Promise<QueueEntry[]> {
  const summaries = await ordersApi.needingPacking();
  const details = await Promise.all(summaries.map((o) => inventoryApi.sourcing.detail(o.id)));
  return summaries
    .map((order, i) => ({ order, sourcing: details[i]! }))
    .filter((entry) => entry.sourcing.metrics.pending_items > 0)
    .sort((a, b) => a.order.placed_at.localeCompare(b.order.placed_at) || a.order.id.localeCompare(b.order.id));
}

const ITEM_TONE: Record<SourcingItem['item_status'], Tone> = {
  PENDING: 'warn',
  SOURCED: 'ok',
  PACKED: 'ok',
  UNAVAILABLE: 'bad',
  SUBSTITUTED: 'muted',
};

/**
 * Items waiting to be bought (task F6, plan §13). Ported from
 * `apps/inventory/src/pages/SourcingQueue.tsx` (a fresh implementation, not
 * an import - common.md rule 2), rendered as mobile card-list order groups
 * instead of Inventory's desktop `<table>` - the same departure F3/F5 made
 * for the same reason (F1's single-column, bottom-tab `Layout`). Shows the
 * order number and time only - the customer's name, phone and address are
 * not needed to source and are never fetched or shown here.
 */
export function Sourcing() {
  const [entries, setEntries] = useState<QueueEntry[] | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Map<string, StockRow>>(new Map());
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sourcing, setSourcing] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailable, setUnavailable] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailableBusy, setUnavailableBusy] = useState(false);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [queue, stock, activeSuppliers] = await Promise.all([
        loadQueue(),
        inventoryApi.stock.list({ include_inactive: true, limit: 200 }),
        inventoryApi.suppliers.list(true),
      ]);
      setEntries(queue);
      setStockByProduct(new Map(stock.inventory.map((r) => [r.product_id, r])));
      setSuppliers(activeSuppliers);
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load the sourcing queue.'));
      setEntries((prev) => prev ?? []);
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  async function confirmUnavailable() {
    if (!unavailable) return;
    setUnavailableBusy(true);
    setUnavailableError(null);
    try {
      await inventoryApi.sourcing.markUnavailable(unavailable.order.id, unavailable.item.id);
      setBanner(
        `${unavailable.item.product_name_snapshot} removed from ${unavailable.order.order_number}. The customer will be notified.`
      );
      setUnavailable(null);
      await load(true);
    } catch (err) {
      if (isInventoryError(err, 'ITEM_ALREADY_RESOLVED') || isInventoryError(err, 'ITEM_ALREADY_SOURCED')) {
        const what = isInventoryError(err, 'ITEM_ALREADY_RESOLVED') ? 'resolved' : 'sourced';
        setBanner(
          `${unavailable.item.product_name_snapshot} on ${unavailable.order.order_number} was already ${what} by someone else. Showing the latest queue.`
        );
        setUnavailable(null);
        await load(true);
        return;
      }
      setUnavailableError(inventoryErrorMessage(err, 'The item was not marked unavailable.'));
    } finally {
      setUnavailableBusy(false);
    }
  }

  const pendingItems = (entries ?? []).reduce((sum, e) => sum + e.sourcing.metrics.pending_items, 0);

  return (
    <div className="page">
      <PageHeader
        title="Sourcing queue"
        description={
          entries
            ? entries.length
              ? `${entries.length} ${entries.length === 1 ? 'order' : 'orders'} · ${pendingItems} ${pendingItems === 1 ? 'item' : 'items'} to source, oldest first.`
              : 'Nothing waiting.'
            : 'Open orders with items still to buy, oldest first.'
        }
        actions={
          <button type="button" className="button button--ghost" onClick={() => void load(true)} disabled={refreshing}>
            {refreshing ? <Spinner label="Refreshing" /> : 'Refresh'}
          </button>
        }
      />

      {banner ? (
        <p className="field__error" role="status">
          {banner}
          <button type="button" className="field__error-dismiss" onClick={() => setBanner(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}
      {entries === null && !error ? <Spinner label="Loading the sourcing queue" /> : null}

      {entries && entries.length === 0 ? (
        <EmptyState title="Nothing to source" message="Every open order has been sourced or resolved." />
      ) : null}

      {entries?.map(({ order, sourcing: detail }) => (
        <section key={order.id} className="src-order" aria-label={`Order ${order.order_number}`}>
          <div className="src-order__head">
            <span className="src-order__number mono">{order.order_number}</span>
            <Status tone={order.order_status === 'PLACED' ? 'info' : 'warn'}>{STATUS_LABEL[order.order_status]}</Status>
            <span className="src-order__meta">Placed {formatDateTime(order.placed_at)}</span>
            <span className="src-order__progress">
              {detail.metrics.pending_items} of {detail.metrics.total_items} to source
            </span>
          </div>
          <ul className="cat-list">
            {detail.items.map((item) => {
              const stockRow = stockByProduct.get(item.product_id);
              const record = item.sourcing_records[0];
              return (
                <li key={item.id} className="cat-row cat-row--flat">
                  <div className="cat-row__main">
                    <p className="cat-row__title">
                      {item.quantity} × {item.product_name_snapshot}
                    </p>
                    <p className="cat-row__meta">
                      {item.sku_snapshot} · {item.unit_snapshot} · Est. {formatMoney(item.estimated_unit_cost)}/unit
                    </p>
                    <p className="cat-row__meta">
                      {stockRow?.tracking_mode === 'TRACKED' ? (
                        <span className="mono">{stockRow.quantity_on_hand} counted</span>
                      ) : (
                        <span>Sourced on order</span>
                      )}
                    </p>
                    <div className="cat-row__badges">
                      <Status tone={ITEM_TONE[item.item_status]}>{ITEM_STATUS_LABEL[item.item_status]}</Status>
                      {item.item_status === 'SOURCED' && item.actual_unit_cost !== null ? (
                        <span className="cat-row__order">
                          <span className="mono">{formatMoney(item.actual_unit_cost)}</span>
                          {record?.supplier ? ` · ${record.supplier.name}` : ''}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {item.item_status === 'PENDING' ? (
                    <div className="cat-row__actions">
                      <button type="button" className="button button--sm" onClick={() => setSourcing({ order, item })}>
                        Source
                      </button>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        onClick={() => setUnavailable({ order, item })}
                      >
                        Mark unavailable
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {sourcing ? (
        <SourceItemDialog
          order={sourcing.order}
          item={sourcing.item}
          stock={stockByProduct.get(sourcing.item.product_id)}
          suppliers={suppliers}
          onClose={() => setSourcing(null)}
          onSourced={async (message) => {
            setSourcing(null);
            setBanner(message);
            await load(true);
          }}
          onAlreadySourced={async () => {
            setSourcing(null);
            setBanner(
              `${sourcing.item.product_name_snapshot} on ${sourcing.order.order_number} was already sourced by someone else. Showing the latest queue.`
            );
            await load(true);
          }}
          onMarkUnavailable={() => {
            setUnavailable(sourcing);
            setSourcing(null);
          }}
        />
      ) : null}

      {unavailable ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Mark item unavailable">
          <div className="modal__panel">
            <h2 className="modal__title">Mark item unavailable</h2>
            <div className="modal__body">
              <p>
                Remove <strong>
                  {unavailable.item.quantity} × {unavailable.item.product_name_snapshot}
                </strong>{' '}
                from order <span className="mono">{unavailable.order.order_number}</span>.
              </p>
              <ul className="consequences">
                <li>The order total drops by {formatMoney(unavailable.item.subtotal)}.</li>
                <li>The customer is notified that the item is unavailable.</li>
                <li>The item can no longer be sourced.</li>
              </ul>
            </div>
            {unavailableError ? <p className="field__error">{unavailableError}</p> : null}
            <div className="modal__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setUnavailable(null);
                  setUnavailableError(null);
                }}
              >
                Cancel
              </button>
              <button type="button" className="button" onClick={() => void confirmUnavailable()} disabled={unavailableBusy}>
                {unavailableBusy ? <Spinner label="Working" /> : 'Mark unavailable'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
