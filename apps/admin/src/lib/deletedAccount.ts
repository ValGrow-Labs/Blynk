/*
 * A customer who deletes their account keeps their orders for accounting, but the API replaces
 * the phone number with a random `del:<hex>` code and clears the name (users/account.service.ts).
 * Staff screens show that as "Deleted account" instead of "Unnamed customer" and a code.
 */
export const DELETED_PHONE_PREFIX = 'del:';

export const isDeletedAccount = (phone: string | null | undefined): boolean =>
  typeof phone === 'string' && phone.startsWith(DELETED_PHONE_PREFIX);

/** The name to show for a customer row. */
export function customerDisplayName(c: { full_name: string | null; phone: string | null | undefined }): string {
  if (isDeletedAccount(c.phone)) return 'Deleted account';
  return c.full_name || 'Unnamed customer';
}

/** The phone to show; a deleted account has none. */
export const customerDisplayPhone = (phone: string | null | undefined): string =>
  isDeletedAccount(phone) ? 'Number removed' : (phone ?? '');
