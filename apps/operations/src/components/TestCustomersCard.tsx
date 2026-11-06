import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { TestCustomersSetting } from '../api/types';
import { catalogErrorMessage } from '../lib/catalog';
import { MAX_TEST_CUSTOMERS, maskTesterPhone, readTesterEntries, TEST_CUSTOMERS_HELP } from '../lib/testCustomers';
import { ConfirmDialog, Spinner } from './ui';
import './testCustomers.css';

/**
 * Test customers (Play testers) (2026-11-06): `GET|PUT /admin/settings/test-customers { phones }` (ADMIN, OPERATIONS).
 * The numbers pasted here are ADDED to the saved list and the whole list is saved (PUT replaces the list).
 * Saved numbers are shown masked (last 3 digits) with a Remove that saves at once after a confirm; a full number
 * is only ever shown in the box the staff member typed it in.
 */
export function TestCustomersCard() {
  const [current, setCurrent] = useState<TestCustomersSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    settings.testCustomers
      .get()
      .then((setting) => !cancelled && setCurrent(setting))
      .catch((err) => !cancelled && setLoadError(catalogErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const read = useMemo(() => readTesterEntries(text), [text]);
  const saved = current?.phones ?? [];
  const people = (n: number) => `${n} test ${n === 1 ? 'customer' : 'customers'}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (read.numbers.length === 0 && read.unreadable.length === 0) {
      setError('Paste at least one phone number.');
      return;
    }
    if (read.unreadable.length > 0) {
      setError('Some entries cannot be read. Fix or delete them (listed above), then save.');
      return;
    }
    const merged = [...saved, ...read.numbers.filter((n) => !saved.includes(n))];
    if (merged.length > MAX_TEST_CUSTOMERS) {
      setError(`The list can hold at most ${MAX_TEST_CUSTOMERS} numbers. Remove some first.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updated = await settings.testCustomers.update(merged);
      setCurrent(updated);
      setText('');
      setNotice(`Saved. ${people(updated.count)} on the list.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(phone: string) {
    setRemoving(null);
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const updated = await settings.testCustomers.update(saved.filter((p) => p !== phone));
      setCurrent(updated);
      setNotice(`Removed. ${people(updated.count)} on the list.`);
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="test-customers" aria-labelledby="test-customers-title">
      <h2 className="section-label" id="test-customers-title">
        Test customers (Play testers)
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading test customers" />
      ) : (
        <>
          <p className="page__note">{TEST_CUSTOMERS_HELP}</p>
          <form className="form" onSubmit={save} noValidate>
            <label className="field">
              <span className="field__label">Add numbers</span>
              <textarea
                className="input"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                inputMode="tel"
                aria-invalid={error ? true : undefined}
              />
              <span className="field__hint">
                One per line, or separated by commas or spaces. Like 0771234567 or +94771234567. They are added to the list below.
              </span>
            </label>
            <p className="quiet" data-testid="test-customers-count" role="status">
              {read.numbers.length} {read.numbers.length === 1 ? 'number' : 'numbers'} read
            </p>
            {read.unreadable.length > 0 ? (
              <p className="field__error" data-testid="test-customers-unreadable">
                Cannot read: {read.unreadable.join(', ')}
              </p>
            ) : null}
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </form>
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="quiet quiet--ok" role="status">
              {notice}
            </p>
          ) : null}

          <h3 className="section-label" data-testid="test-customers-saved-count">
            On the list: {current.count} of {MAX_TEST_CUSTOMERS}
          </h3>
          {saved.length === 0 ? (
            <p className="quiet">No test customers yet.</p>
          ) : (
            <ul className="test-customers__list" aria-label="Saved test customers">
              {saved.map((phone) => (
                <li key={phone} className="test-customers__row">
                  <span className="mono">{maskTesterPhone(phone)}</span>
                  <button
                    type="button"
                    className="button button--ghost"
                    aria-label={`Remove ${maskTesterPhone(phone)}`}
                    disabled={saving}
                    onClick={() => setRemoving(phone)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {removing ? (
        <ConfirmDialog
          title="Remove this number?"
          message={`${maskTesterPhone(removing)} will no longer place test orders. Orders already placed stay test orders and are still cancelled automatically.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => void remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </section>
  );
}
