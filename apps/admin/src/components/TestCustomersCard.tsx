import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { TestCustomersSetting } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import { MAX_TEST_CUSTOMERS, maskTesterPhone, readTesterEntries, TEST_CUSTOMERS_HELP } from '../lib/testCustomers';
import { ConfirmDialog, Field, Spinner, useToast } from './ui';
import './testCustomers.css';

/**
 * Settings -> Test customers (Play testers) (2026-11-06): `GET|PUT /admin/settings/test-customers { phones }`.
 * The numbers pasted here are ADDED to the saved list and the whole list is saved (PUT replaces the list).
 * Saved numbers are shown masked (last 3 digits) with a Remove that saves at once after a confirm; a full number
 * is only ever shown in the box the staff member typed it in.
 */
export function TestCustomersCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<TestCustomersSetting | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getTestCustomers()
      .then((setting) => !cancelled && setCurrent(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the test customers.')));
    return () => {
      cancelled = true;
    };
  }, []);

  const read = useMemo(() => readTesterEntries(text), [text]);
  const saved = current?.phones ?? [];

  async function put(phones: string[]): Promise<TestCustomersSetting> {
    try {
      return await settingsApi.setTestCustomers(phones);
    } catch (err) {
      throw new Error(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save the test customers.'));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
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
      const updated = await put(merged);
      setCurrent(updated);
      setText('');
      toast.success(`Saved. ${updated.count} test ${updated.count === 1 ? 'customer' : 'customers'} on the list.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(phone: string) {
    setRemoving(null);
    setError(null);
    setSaving(true);
    try {
      const updated = await put(saved.filter((p) => p !== phone));
      setCurrent(updated);
      toast.success(`Removed. ${updated.count} test ${updated.count === 1 ? 'customer' : 'customers'} on the list.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" id="test-customers" aria-label="Test customers (Play testers)">
      <h2 className="panel__title">Test customers (Play testers)</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the test customers" />
      ) : (
        <>
          <p className="form__note">{TEST_CUSTOMERS_HELP}</p>
          <form className="form" onSubmit={save} noValidate>
            <Field
              label="Add numbers"
              hint="One per line, or separated by commas or spaces. Like 0771234567 or +94771234567. They are added to the list below."
              error={error ?? undefined}
            >
              <textarea
                className="input"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                inputMode="tel"
              />
            </Field>
            <p className="form__note" data-testid="test-customers-count" role="status">
              {read.numbers.length} {read.numbers.length === 1 ? 'number' : 'numbers'} read
            </p>
            {read.unreadable.length > 0 ? (
              <p className="field__error" data-testid="test-customers-unreadable">
                Cannot read: {read.unreadable.join(', ')}
              </p>
            ) : null}
            <div className="form__actions">
              <button type="submit" className="button" disabled={saving}>
                {saving ? <Spinner label="Saving" /> : 'Save'}
              </button>
            </div>
          </form>

          <h3 className="section-label" data-testid="test-customers-saved-count">
            On the list: {current.count} of {MAX_TEST_CUSTOMERS}
          </h3>
          {saved.length === 0 ? (
            <p className="form__note">No test customers yet.</p>
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
