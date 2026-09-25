import type { ReactNode } from 'react';

/**
 * Small presentational primitives for Catalog (task F5) - ported from
 * Admin's `components/ui.tsx` (a fresh implementation, not an import -
 * common.md rule 2), trimmed to what Products/Categories/Promotions
 * actually use: `Badge`/`Spinner`/`EmptyState`/`ConfirmDialog`/`Field`. No
 * `ToastProvider`/`useToast` here - Operations' own convention, established
 * by F3's Orders board/detail, is a local `notice`/`field__error` banner per
 * screen (see `pages/Orders.tsx`), not a global toast system; wiring one in
 * would touch `App.tsx`/`main.tsx` beyond this task's scope.
 */
export function Badge({ tone, children }: { tone: 'active' | 'inactive' | 'muted'; children: ReactNode }) {
  return (
    <span className={`status status--${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * A dot and a word with a wider tone vocabulary than `Badge` (task F6,
 * Inventory) - item status, order status and supplier status all need
 * `warn`/`bad`/`info` on top of `Badge`'s `active`/`inactive`/`muted`.
 * Additive only: `Badge`'s own callers (Products/Categories/Promotions, F5)
 * are untouched. `tone--warn`/`--bad`/`--info` are new CSS rules this task
 * adds; `tone--ok`/`--muted` reuse `Badge`'s existing `status--active`/
 * `status--muted` colours under a shared `status` class so both components
 * stay visually consistent.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`status status--tone-${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner__dot" />
    </span>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {message ? <p className="empty__message">{message}</p> : null}
      {action}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__panel">
        <h2 className="modal__title">{title}</h2>
        <p className="modal__message">{message}</p>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? 'button button--danger' : 'button'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error-text">{error}</span> : null}
    </label>
  );
}
