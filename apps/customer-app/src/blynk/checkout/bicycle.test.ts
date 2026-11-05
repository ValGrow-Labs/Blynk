import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/blynk/api/client';
import { setLang } from '@/blynk/i18n/lang';
import { checkoutBill, checkoutSignature } from '@/blynk/orders/checkout';
import { placeErrorCopy } from '@/blynk/orders/errors';
import type { BicycleQuote, CheckoutInfo, DeliveryMethod } from '@/blynk/orders/types';
import {
  activeMethod, bicycleOffer, DEFAULT_METHOD, deliveryMethodBody, deliveryMethodLabel, methodRows, parseBicycle, quoteForMethod,
} from './bicycle';
import { BICYCLE_WORDS } from './bicycleWords';

afterEach(() => setLang('en'));

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

const bike = (over: Partial<BicycleQuote> = {}): BicycleQuote => ({
  available: true, fee_lkr: 80, charged_fee_lkr: 80, max_km: 3, distance_km: 1.5, distance_estimated: false, ...over,
});

const quote = (over: Partial<CheckoutInfo> = {}): CheckoutInfo => ({
  delivery_fee_lkr: 160,
  standard_delivery_fee_lkr: 160,
  delivery_fee_mode: 'DISTANCE_TIERS',
  delivery_distance_km: 1.6,
  delivery_distance_estimated: false,
  delivery_fee_address_id: 'a1',
  coupons_enabled: false,
  free_delivery: { enabled: false, count: 0, since: '2026-10-08T18:30:00.000Z', used: 0, remaining: 0, applies: false },
  basket_free_delivery: { enabled: false, min_subtotal_lkr: 0, applies: false, remaining_lkr: null },
  bicycle: bike(),
  ...over,
});

describe('the bicycle choice shows only while checkout-info offers it', () => {
  it('is hidden when the block is missing, unavailable or unusable', () => {
    expect(bicycleOffer(null)).toBeNull();
    expect(bicycleOffer(quote({ bicycle: undefined }))).toBeNull();
    expect(bicycleOffer(quote({ bicycle: bike({ available: false, reason: 'Bicycle delivery is for trips up to 3 km.' }) }))).toBeNull();
    expect(bicycleOffer(quote({ bicycle: bike({ max_km: 0 }) }))).toBeNull();
    expect(bicycleOffer(quote({ bicycle: bike({ charged_fee_lkr: NaN }) }))).toBeNull();
  });

  it('is visible when available, with the charged fee and the km', () => {
    expect(bicycleOffer(quote())).toEqual({ fee: 80, standardFee: 80, maxKm: 3, distanceKm: 1.5, distanceEstimated: false });
    expect(bicycleOffer(quote({ bicycle: bike({ fee_lkr: 80, charged_fee_lkr: 0 }) }))).toMatchObject({ fee: 0, standardFee: 80 });
  });

  it('starts on Motorbike', () => {
    expect(DEFAULT_METHOD).toBe('MOTORBIKE');
  });

  it('words the two rows with the fees and the trip length (English)', () => {
    const rows = methodRows(bicycleOffer(quote())!, 160);
    expect(rows).toEqual([
      { method: 'BICYCLE', title: 'Bicycle - cheaper, a bit slower', sub: 'LKR 80 · for trips up to 3 km' },
      { method: 'MOTORBIKE', title: 'Motorbike - faster', sub: 'LKR 160' },
    ]);
    expect(methodRows(bicycleOffer(quote({ bicycle: bike({ max_km: 2.5 }) }))!, null)[0]!.sub).toContain('up to 2.5 km');
    expect(methodRows(bicycleOffer(quote())!, null)[1]!.sub).toBe('');
  });
});

describe('the chosen method changes the fee and the total', () => {
  const total = (method: DeliveryMethod, itemTotal = 800, q = quote()) => checkoutBill(itemTotal, quoteForMethod(q, activeMethod(method, q)));

  it('motorbike keeps the existing fee, bicycle uses the bicycle fee', () => {
    expect(total('MOTORBIKE')).toMatchObject({ deliveryFee: 160, toPay: 960 });
    expect(total('BICYCLE')).toMatchObject({ deliveryFee: 80, standardFee: 80, toPay: 880, distanceKm: 1.5 });
  });

  it('motorbike leaves the quote untouched', () => {
    const q = quote();
    expect(quoteForMethod(q, 'MOTORBIKE')).toBe(q);
    expect(quoteForMethod(null, 'BICYCLE')).toBeNull();
  });

  it('uses the charged bicycle fee when free delivery applies (0), keeping the standard one for reference', () => {
    const q = quote({ bicycle: bike({ charged_fee_lkr: 0 }) });
    expect(total('BICYCLE', 800, q)).toMatchObject({ deliveryFee: 0, standardFee: 80, toPay: 800 });
  });

  it('adds the small-order fee on top of either fee', () => {
    const q = quote({ small_order_fee: { enabled: true, min_subtotal_lkr: 1000, fee_lkr: 50, applies: null, charged_lkr: 0, remaining_lkr: null } });
    expect(total('BICYCLE', 800, q).toPay).toBe(930); // 800 + 80 + 50
    expect(total('MOTORBIKE', 800, q).toPay).toBe(1010); // 800 + 160 + 50
  });

  it('keeps the quote distance for a fee that was flat before', () => {
    const q = quote({ delivery_fee_mode: 'FLAT', delivery_distance_km: null });
    expect(total('BICYCLE', 800, q).distanceKm).toBe(1.5);
    expect(total('MOTORBIKE', 800, q).distanceKm).toBeNull();
  });

  it('falls back to Motorbike when bicycle is no longer offered (new address, reload, refusal)', () => {
    expect(activeMethod('BICYCLE', quote())).toBe('BICYCLE');
    expect(activeMethod('BICYCLE', quote({ bicycle: bike({ available: false }) }))).toBe('MOTORBIKE');
    expect(activeMethod('BICYCLE', quote({ bicycle: undefined }))).toBe('MOTORBIKE');
    expect(activeMethod('BICYCLE', null)).toBe('MOTORBIKE');
    expect(activeMethod('MOTORBIKE', quote())).toBe('MOTORBIKE');
    expect(total('BICYCLE', 800, quote({ bicycle: bike({ available: false }) }))).toMatchObject({ deliveryFee: 160, toPay: 960 });
  });
});

describe('placement', () => {
  const items = [{ product_id: 'p1', quantity: 1 }];

  it('sends delivery_method for bicycle and leaves it out for motorbike (the server default)', () => {
    expect(deliveryMethodBody('BICYCLE')).toEqual({ delivery_method: 'BICYCLE' });
    expect(deliveryMethodBody('MOTORBIKE')).toEqual({});
  });

  it('the same basket by bicycle is a different order (its own idempotency key)', () => {
    const motor = checkoutSignature({ items, addressId: 'a1', extra: {} });
    const bicycle = checkoutSignature({ items, addressId: 'a1', extra: { delivery_method: 'BICYCLE' } });
    expect(bicycle).not.toBe(motor);
    expect(checkoutSignature({ items, addressId: 'a1' })).toBe(motor); // older signatures unchanged
  });

  it('BICYCLE_UNAVAILABLE gets the "back to motorbike" action and its own words', () => {
    const e = new ApiError('Bicycle delivery is for trips up to 3 km. Please choose motorbike delivery.', 400, 'BICYCLE_UNAVAILABLE');
    const copy = placeErrorCopy(e);
    expect(copy.action).toBe('bicycle');
    expect(copy.title).toBe('Bicycle delivery is not available');
    expect(copy.message).toContain('motorbike');
  });
});

describe('the order label', () => {
  it('says Bicycle delivery for a bicycle order and nothing for a motorbike or an older order', () => {
    expect(deliveryMethodLabel({ delivery_method: 'BICYCLE' })).toBe('Bicycle delivery');
    expect(deliveryMethodLabel({ delivery_method: 'MOTORBIKE' })).toBeNull();
    expect(deliveryMethodLabel({})).toBeNull();
    expect(deliveryMethodLabel(null)).toBeNull();
  });

  it('follows the language', () => {
    setLang('si');
    expect(deliveryMethodLabel({ delivery_method: 'BICYCLE' })).toMatch(SINHALA);
    setLang('ta');
    expect(deliveryMethodLabel({ delivery_method: 'BICYCLE' })).toMatch(TAMIL);
  });
});

describe('parseBicycle', () => {
  it('reads numbers sent as strings', () => {
    expect(parseBicycle({ available: true, fee_lkr: '80.00', charged_fee_lkr: '0', max_km: '3', distance_km: '1.50', distance_estimated: true })).toEqual({
      available: true, fee_lkr: 80, charged_fee_lkr: 0, max_km: 3, distance_km: 1.5, distance_estimated: true,
    });
  });

  it('keeps the reason and a null distance for an unavailable block', () => {
    expect(parseBicycle({ available: false, reason: 'Choose a delivery address to see bicycle delivery.', fee_lkr: 80, charged_fee_lkr: 80, max_km: 3, distance_km: null, distance_estimated: null })).toMatchObject({
      available: false, reason: 'Choose a delivery address to see bicycle delivery.', distance_km: null,
    });
  });

  it('turns a broken block into "not available" so the card hides, and ignores a missing one', () => {
    expect(parseBicycle({ available: true, fee_lkr: 'x', max_km: 3 })).toMatchObject({ available: false });
    expect(parseBicycle(undefined)).toBeUndefined();
    expect(parseBicycle('nope')).toBeUndefined();
  });
});

describe('bicycle words in Sinhala and Tamil', () => {
  it('every string is translated and keeps its fee and km', () => {
    setLang('si');
    expect(BICYCLE_WORDS.sectionTitle).toMatch(SINHALA);
    expect(BICYCLE_WORDS.bicycleTitle).toMatch(SINHALA);
    expect(BICYCLE_WORDS.motorbikeTitle).toMatch(SINHALA);
    expect(BICYCLE_WORDS.bicycleLabel).toMatch(SINHALA);
    expect(BICYCLE_WORDS.billNote).toMatch(SINHALA);
    expect(BICYCLE_WORDS.bicycleSub('LKR 80', '3')).toContain('LKR 80');
    expect(BICYCLE_WORDS.bicycleSub('LKR 80', '3')).toContain('3');
    expect(BICYCLE_WORDS.bicycleSub('LKR 80', '3')).toMatch(SINHALA);
    expect(placeErrorCopy(new ApiError('x', 400, 'BICYCLE_UNAVAILABLE')).title).toMatch(SINHALA);
    setLang('ta');
    expect(BICYCLE_WORDS.sectionTitle).toMatch(TAMIL);
    expect(BICYCLE_WORDS.bicycleTitle).toMatch(TAMIL);
    expect(BICYCLE_WORDS.motorbikeTitle).toMatch(TAMIL);
    expect(BICYCLE_WORDS.bicycleLabel).toMatch(TAMIL);
    expect(BICYCLE_WORDS.billNote).toMatch(TAMIL);
    expect(BICYCLE_WORDS.bicycleSub('LKR 80', '3')).toContain('LKR 80');
    expect(BICYCLE_WORDS.bicycleSub('LKR 80', '3')).toMatch(TAMIL);
    expect(placeErrorCopy(new ApiError('x', 400, 'BICYCLE_UNAVAILABLE')).message).toMatch(TAMIL);
  });
});
