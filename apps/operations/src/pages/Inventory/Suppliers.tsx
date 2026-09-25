import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { inventory as inventoryApi } from '../../api/resources';
import type { Supplier, SupplierInput } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner } from '../../components/ui';
import { inventoryErrorMessage, isInventoryError } from '../../lib/inventory';

/**
 * Where Blynk buys from (task F6, plan §13). Ported from
 * `apps/inventory/src/pages/Suppliers.tsx` (a fresh implementation, not an
 * import - common.md rule 2), as a mobile card list. The Operations operator
 * is always ADMIN, so every action Inventory itself restricts to ADMIN
 * (add/edit/deactivate/reactivate) is available here unconditionally - no
 * role dimension, unlike Inventory's own `auth/can.ts` (common.md's OPS-04
 * decision). **The backend has no delete endpoint for suppliers** (verified
 * directly against `backend/api/src/modules/admin/index.ts` - only
 * GET/POST/PATCH are registered), so this screen deliberately offers no
 * delete UI, matching the brief's explicit instruction; deactivating is the
 * only supported way to retire one, keeping its sourcing history intact.
 */
export function Suppliers() {
  const [params, setParams] = useSearchParams();
  const showAll = params.get('show') === 'all';
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [toggling, setToggling] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await inventoryApi.suppliers.list(!showAll));
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load suppliers.'));
      setRows([]);
    }
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive() {
    if (!toggling) return;
    try {
      await inventoryApi.suppliers.update(toggling.id, { is_active: !toggling.is_active });
      setNotice(`${toggling.name} ${toggling.is_active ? 'deactivated' : 'reactivated'}.`);
      await load();
    } catch (err) {
      setNotice(inventoryErrorMessage(err));
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Suppliers"
        description="Market sources Blynk buys from. Staff choose from active suppliers when sourcing."
        actions={
          <button type="button" className="button" onClick={() => setEditing('new')}>
            Add supplier
          </button>
        }
      />

      <div className="segmented" role="group" aria-label="Which suppliers">
        <button
          type="button"
          className={`segmented__item${!showAll ? ' is-selected' : ''}`}
          aria-pressed={!showAll}
          onClick={() => setParams(new URLSearchParams(), { replace: true })}
        >
          Active
        </button>
        <button
          type="button"
          className={`segmented__item${showAll ? ' is-selected' : ''}`}
          aria-pressed={showAll}
          onClick={() => setParams(new URLSearchParams({ show: 'all' }), { replace: true })}
        >
          All
        </button>
      </div>

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading suppliers" />
      ) : rows.length === 0 ? (
        <EmptyState title={showAll ? 'No suppliers yet' : 'No active suppliers'} message="Add the market sources you buy from." />
      ) : (
        <ul className="cat-list">
          {rows.map((s) => (
            <li key={s.id} className={`cat-row cat-row--flat${!s.is_active ? ' is-muted' : ''}`}>
              <div className="cat-row__main">
                <p className="cat-row__title">{s.name}</p>
                <p className="cat-row__meta">{s.code ?? 'No code'}</p>
                <p className="cat-row__meta">
                  {s.contact_person ?? '—'}
                  {s.contact_phone ? ` · ${s.contact_phone}` : ''}
                </p>
                {s.address ? <p className="cat-row__meta">{s.address}</p> : null}
                <div className="cat-row__badges">
                  <Badge tone={s.is_active ? 'active' : 'inactive'}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
              </div>
              <div className="cat-row__actions">
                <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(s)}>
                  Edit
                </button>
                <button type="button" className="button button--ghost button--sm" onClick={() => setToggling(s)}>
                  {s.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      {toggling ? (
        <ConfirmDialog
          title={toggling.is_active ? 'Deactivate supplier' : 'Reactivate supplier'}
          message={
            toggling.is_active
              ? `${toggling.name} will no longer be offered when sourcing. Its past sourcing records are kept.`
              : `${toggling.name} will be offered again when sourcing.`
          }
          confirmLabel={toggling.is_active ? 'Deactivate' : 'Reactivate'}
          destructive={toggling.is_active}
          onConfirm={() => void toggleActive()}
          onCancel={() => setToggling(null)}
        />
      ) : null}
    </div>
  );
}

const LIMITS = { name: 128, code: 64, contact_person: 128, contact_phone: 20, address: 500, notes: 500 };

function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    code: supplier?.code ?? '',
    contact_person: supplier?.contact_person ?? '',
    contact_phone: supplier?.contact_phone ?? '',
    address: supplier?.address ?? '',
    notes: supplier?.notes ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function validate() {
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters.';
    for (const [key, max] of Object.entries(LIMITS) as Array<[keyof typeof form, number]>) {
      if (form[key].trim().length > max) next[key] = `Keep this under ${max} characters.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !validate()) return;
    submitting.current = true;
    setBusy(true);
    setFormError(null);

    // Send only filled fields - the backend cannot clear a field to empty,
    // and an empty code would collide with the unique index, so blanks are
    // left out (mirrors Inventory's own `SupplierDialog`).
    const body: SupplierInput = {};
    for (const key of Object.keys(LIMITS) as Array<keyof typeof form>) {
      const value = form[key].trim();
      if (value) body[key] = value;
    }

    try {
      if (supplier) {
        await inventoryApi.suppliers.update(supplier.id, body);
      } else {
        await inventoryApi.suppliers.create(body);
      }
      await onSaved();
    } catch (err) {
      if (isInventoryError(err, 'SUPPLIER_CODE_TAKEN')) {
        setErrors((e) => ({ ...e, code: 'Another supplier already uses this code.' }));
      } else {
        setFormError(inventoryErrorMessage(err, 'The supplier was not saved.'));
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={supplier ? `Edit ${supplier.name}` : 'Add supplier'}>
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">{supplier ? `Edit ${supplier.name}` : 'Add supplier'}</h2>
        <Field label="Name" error={errors.name}>
          <input className="input" value={form.name} onChange={set('name')} />
        </Field>
        <div className="form__row">
          <Field label="Code (optional)" hint="Short unique reference, e.g. SUP-DHARGA-MAIN" error={errors.code}>
            <input className="input input--mono" value={form.code} onChange={set('code')} />
          </Field>
          <Field label="Contact phone" error={errors.contact_phone}>
            <input className="input input--mono" inputMode="tel" value={form.contact_phone} onChange={set('contact_phone')} />
          </Field>
        </div>
        <Field label="Contact person" error={errors.contact_person}>
          <input className="input" value={form.contact_person} onChange={set('contact_person')} />
        </Field>
        <Field label="Address" error={errors.address}>
          <input className="input" value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Notes" error={errors.notes}>
          <textarea className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        {supplier ? <p className="form__note">Fields left blank keep their current value.</p> : null}
        {formError ? <p className="field__error" role="alert">{formError}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Saving" /> : supplier ? 'Save changes' : 'Add supplier'}
          </button>
        </div>
      </form>
    </div>
  );
}
