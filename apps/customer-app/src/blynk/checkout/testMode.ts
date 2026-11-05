import type { CheckoutInfo } from '@/blynk/orders/types';

/*
 * The Google Play review account (backend migration 068, orders/test-orders.ts). The SERVER decides: GET
 * /orders/checkout-info carries `test_mode: true` for that one customer, and no phone number is known here.
 * In test mode the cart treats checkout as open (store hours, delivery time rules and the delivery area do not
 * apply - the server skips them too), it is cash on delivery only, and a small note says the order is cancelled
 * automatically. Everyone else gets the cart exactly as before: testGate returns its input untouched.
 */

/** True only while the quote says this is the review account's checkout. */
export const testModeOf = (quote: Pick<CheckoutInfo, 'test_mode'> | null | undefined): boolean => quote?.test_mode === true;

export interface CheckoutGate {
  closedNow: boolean;
  slotsOn: boolean;
  orderable: boolean;
}

/** The cart's open / slots / orderable state for this checkout: open and orderable in test mode, as given otherwise. */
export function testGate(testMode: boolean, gate: CheckoutGate): CheckoutGate {
  return testMode ? { closedNow: false, slotsOn: false, orderable: true } : gate;
}
