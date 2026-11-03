import { afterEach, describe, expect, test } from 'vitest';
import { resetLangForTests, setLang } from '@/blynk/i18n/lang';
import {
  bannerHidden, bannerView, barFill, ETA_MAX_AGE_MS, etaMinutesLeft, isBannerStatus, pickActiveOrder, sameBannerOrder, type BannerEta, type BannerOrder,
} from './activeBanner';
import { refreshActiveEta } from './activeEta';
import { getActiveEta, getActiveOrder, setActiveEta, setKnownOrders } from './openOrders';

const order = (over: Partial<BannerOrder> = {}): BannerOrder => ({ id: 'o1', orderNumber: 'BL-1', status: 'PLACED', scheduled: false, assignment: null, ...over });
const NOW = 1_000_000;
const eta = (over: Partial<BannerEta> = {}): BannerEta => ({ orderId: 'o1', durationS: 12 * 60, fetchedAt: NOW, ...over });

afterEach(() => { resetLangForTests(); setKnownOrders([]); });

describe('which order the banner follows', () => {
  test('placed, packed and out for delivery only', () => {
    for (const s of ['PLACED', 'PACKED', 'OUT_FOR_DELIVERY']) expect(isBannerStatus(s)).toBe(true);
    for (const s of ['AWAITING_PAYMENT', 'DELIVERED', 'CANCELLED', 'FAILED', 'CUSTOMER_UNAVAILABLE', 'ITEM_UNAVAILABLE', '', null, undefined]) expect(isBannerStatus(s)).toBe(false);
  });

  test('the newest followed order of the list (newest first); none when nothing is in progress', () => {
    const list = [
      { id: 'a', order_status: 'DELIVERED' },
      { id: 'b', order_number: 'BL-2', order_status: 'PACKED', delivery: { assignment_status: 'ASSIGNED' } },
      { id: 'c', order_status: 'PLACED' },
    ];
    expect(pickActiveOrder(list)).toEqual({ id: 'b', orderNumber: 'BL-2', status: 'PACKED', scheduled: false, assignment: 'ASSIGNED' });
    expect(pickActiveOrder([{ id: 'a', order_status: 'DELIVERED' }, { id: 'x', order_status: 'AWAITING_PAYMENT' }, { id: 'y', order_status: 'ITEM_UNAVAILABLE' }])).toBeNull();
    expect(pickActiveOrder([])).toBeNull();
    // an order without an id cannot be opened
    expect(pickActiveOrder([{ order_status: 'PLACED' }])).toBeNull();
  });

  test('a booked order is flagged scheduled', () => {
    expect(pickActiveOrder([{ id: 'a', order_status: 'PLACED', scheduled_for: '2026-11-05T04:00:00Z' }])?.scheduled).toBe(true);
  });

  test('sameBannerOrder compares content, not identity', () => {
    expect(sameBannerOrder(order(), order())).toBe(true);
    expect(sameBannerOrder(order(), order({ status: 'PACKED' }))).toBe(false);
    expect(sameBannerOrder(null, null)).toBe(true);
    expect(sameBannerOrder(order(), null)).toBe(false);
  });
});

describe('the words, step and tap target per stage', () => {
  test('placed (not booked): packing', () => {
    expect(bannerView(order(), null, NOW)).toMatchObject({ stage: 'packing', text: 'Packing your order', step: 0, steps: 4, etaMinutes: null, opens: 'order' });
  });

  test('placed for a booked slot: order placed, not packing', () => {
    expect(bannerView(order({ scheduled: true }), null, NOW)).toMatchObject({ stage: 'placed', text: 'Order placed', step: 0 });
  });

  test('packed, with and without a rider assigned', () => {
    expect(bannerView(order({ status: 'PACKED' }), null, NOW)).toMatchObject({ stage: 'packed', text: 'Packed, waiting for a rider', step: 1, opens: 'order' });
    for (const a of ['ASSIGNED', 'ACCEPTED']) {
      expect(bannerView(order({ status: 'PACKED', assignment: a }), null, NOW)).toMatchObject({ stage: 'assigned', text: 'A rider is picking up your order', step: 1 });
    }
  });

  test('out for delivery without a time: "Rider is on the way", opens the live map', () => {
    expect(bannerView(order({ status: 'OUT_FOR_DELIVERY' }), null, NOW)).toMatchObject({ stage: 'onTheWay', text: 'Rider is on the way', step: 2, etaMinutes: null, opens: 'track' });
  });

  test('out for delivery with a known time: "Arriving in about N min" (rounded up, counted down)', () => {
    const o = order({ status: 'OUT_FOR_DELIVERY' });
    expect(bannerView(o, eta(), NOW)).toMatchObject({ stage: 'onTheWay', text: 'Arriving in about 12 min', etaMinutes: 12, opens: 'track' });
    // 12 min read, 3 min 10 s later: 8 min 50 s left -> 9
    expect(bannerView(o, eta(), NOW + 190_000)?.text).toBe('Arriving in about 9 min');
    expect(bannerView(o, eta({ durationS: 61 }), NOW)?.text).toBe('Arriving in about 2 min');
  });

  test('a minute or less left: nearby; at the door: arrived', () => {
    const o = order({ status: 'OUT_FOR_DELIVERY' });
    expect(bannerView(o, eta({ durationS: 45 }), NOW)).toMatchObject({ stage: 'nearby', text: 'Your rider is nearby', etaMinutes: 1 });
    // counted down: 200 s read, 150 s later 50 s are left
    expect(bannerView(o, eta({ durationS: 200 }), NOW + 150_000)).toMatchObject({ stage: 'nearby' });
    expect(bannerView(order({ status: 'OUT_FOR_DELIVERY', assignment: 'ARRIVED_AT_CUSTOMER' }), eta(), NOW)).toMatchObject({ stage: 'arrived', text: 'Your rider has arrived', etaMinutes: null, opens: 'order' });
  });

  test('hidden with no order in progress', () => {
    expect(bannerView(null, null, NOW)).toBeNull();
  });
});

describe('the time is never made up', () => {
  const out = order({ status: 'OUT_FOR_DELIVERY' });

  test('no time, another order time, or an order not on the road: none', () => {
    expect(etaMinutesLeft(out, null, NOW)).toBeNull();
    expect(etaMinutesLeft(out, eta({ orderId: 'other' }), NOW)).toBeNull();
    expect(etaMinutesLeft(order({ status: 'PACKED' }), eta(), NOW)).toBeNull();
    expect(bannerView(order({ status: 'PACKED' }), eta(), NOW)?.etaMinutes).toBeNull();
  });

  test('a stale or unusable time is dropped', () => {
    expect(etaMinutesLeft(out, eta(), NOW + ETA_MAX_AGE_MS)).toBe(7);
    expect(etaMinutesLeft(out, eta(), NOW + ETA_MAX_AGE_MS + 1)).toBeNull();
    expect(etaMinutesLeft(out, eta({ durationS: Number.NaN }), NOW)).toBeNull();
    expect(etaMinutesLeft(out, eta({ durationS: -5 }), NOW)).toBeNull();
    expect(etaMinutesLeft(out, eta({ fetchedAt: Number.NaN }), NOW)).toBeNull();
  });

  test('a phone clock behind the read time does not add minutes', () => {
    expect(etaMinutesLeft(out, eta(), NOW - 60_000)).toBe(12);
  });

  test('past the driving time (the rider is late) it says 1 minute until the time goes stale', () => {
    expect(etaMinutesLeft(out, eta({ durationS: 60 }), NOW + 120_000)).toBe(1);
  });
});

describe('the four-step bar', () => {
  test('filled up to and including the step', () => {
    expect(barFill(0)).toEqual([true, false, false, false]);
    expect(barFill(1)).toEqual([true, true, false, false]);
    expect(barFill(2)).toEqual([true, true, true, false]);
    expect(barFill(2)).toHaveLength(4);
  });
});

describe('where it hides', () => {
  test('over the keyboard, in the design mock and for a guest', () => {
    expect(bannerHidden({ keyboardOpen: false, demo: false, signedIn: true })).toBe(false);
    expect(bannerHidden({ keyboardOpen: true, demo: false, signedIn: true })).toBe(true);
    expect(bannerHidden({ keyboardOpen: false, demo: true, signedIn: true })).toBe(true);
    expect(bannerHidden({ keyboardOpen: false, demo: false, signedIn: false })).toBe(true);
  });
});

describe('Sinhala and Tamil', () => {
  test('every stage reads in the chosen language, with the minutes in it', () => {
    const o = order({ status: 'OUT_FOR_DELIVERY' });
    const en = bannerView(o, eta(), NOW)!.text;
    setLang('si');
    const si = bannerView(o, eta(), NOW)!.text;
    expect(si).not.toBe(en);
    expect(si).toContain('12');
    expect(/[඀-෿]/.test(bannerView(order(), null, NOW)!.text)).toBe(true);
    setLang('ta');
    expect(bannerView(o, eta(), NOW)!.text).toContain('12');
    expect(/[஀-௿]/.test(bannerView(order({ status: 'PACKED' }), null, NOW)!.text)).toBe(true);
  });
});

describe('the shell store and the time refresh', () => {
  const out = [{ id: 'o1', order_number: 'BL-1', order_status: 'OUT_FOR_DELIVERY' }];

  test('the list feeds the active order; a finished list clears it and its time', () => {
    setKnownOrders(out);
    expect(getActiveOrder()).toMatchObject({ id: 'o1', status: 'OUT_FOR_DELIVERY' });
    setActiveEta(eta());
    expect(getActiveEta()).not.toBeNull();
    setKnownOrders([{ id: 'o1', order_number: 'BL-1', order_status: 'DELIVERED' }]);
    expect(getActiveOrder()).toBeNull();
    expect(getActiveEta()).toBeNull();
  });

  test('a time for the old order is dropped when another order becomes the active one', () => {
    setKnownOrders(out);
    setActiveEta(eta());
    setKnownOrders([{ id: 'o2', order_status: 'PLACED' }, ...out]);
    expect(getActiveOrder()?.id).toBe('o2');
    expect(getActiveEta()).toBeNull();
  });

  test('refreshActiveEta stores the server time with the phone clock, and only for an order on the road', async () => {
    setKnownOrders(out);
    await refreshActiveEta(async (id) => (id === 'o1' ? { durationS: 540 } : null), () => 5);
    expect(getActiveEta()).toEqual({ orderId: 'o1', durationS: 540, fetchedAt: 5 });
    setKnownOrders([{ id: 'o1', order_status: 'PACKED' }]);
    let called = false;
    await refreshActiveEta(async () => { called = true; return { durationS: 1 }; });
    expect(called).toBe(false);
    expect(getActiveEta()).toBeNull();
  });

  test('no route or an error clears the time (never a guess); a late answer for a gone order is ignored', async () => {
    setKnownOrders(out);
    setActiveEta(eta());
    await refreshActiveEta(async () => null);
    expect(getActiveEta()).toBeNull();
    setActiveEta(eta());
    await refreshActiveEta(async () => { throw new Error('503'); });
    expect(getActiveEta()).toBeNull();
    await refreshActiveEta(async () => {
      setKnownOrders([{ id: 'o1', order_status: 'DELIVERED' }]);
      return { durationS: 100 };
    });
    expect(getActiveEta()).toBeNull();
  });
});
