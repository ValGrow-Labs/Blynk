import { describe, expect, test } from 'vitest';
import { CART } from './words';
import { PLACED } from '@/blynk/ui/strings';
import { testGate, testModeOf, type CheckoutGate } from './testMode';

const closedAndBlocked: CheckoutGate = { closedNow: true, slotsOn: true, orderable: false };

describe('test mode (the Google Play review account)', () => {
  test('only checkout-info saying test_mode: true turns it on', () => {
    expect(testModeOf({ test_mode: true })).toBe(true);
    expect(testModeOf({ test_mode: false })).toBe(false);
    expect(testModeOf({})).toBe(false);
    expect(testModeOf(null)).toBe(false);
    expect(testModeOf(undefined)).toBe(false);
    // not truthy look-alikes
    expect(testModeOf({ test_mode: 'true' as unknown as boolean })).toBe(false);
    expect(testModeOf({ test_mode: 1 as unknown as boolean })).toBe(false);
  });

  test('in test mode checkout is open and orderable even with the store closed and a slot or lead time needed', () => {
    expect(testGate(true, closedAndBlocked)).toEqual({ closedNow: false, slotsOn: false, orderable: true });
  });

  test('for everyone else the gate is exactly what it was (same object, nothing changed)', () => {
    expect(testGate(false, closedAndBlocked)).toBe(closedAndBlocked);
    const open: CheckoutGate = { closedNow: false, slotsOn: false, orderable: true };
    expect(testGate(false, open)).toBe(open);
  });

  test('the test note is plain and says about 10 minutes (en); the completeness test checks si and ta', () => {
    expect(CART.testNote).toBe('Test account: this order is cancelled automatically after about 10 minutes.');
    expect(PLACED.testNote).toBe(CART.testNote);
  });
});
