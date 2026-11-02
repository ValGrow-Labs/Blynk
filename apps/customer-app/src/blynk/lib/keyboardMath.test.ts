import { describe, expect, it } from 'vitest';
import { bottomRoom, compactForKeyboard, keyboardCover, otpSlotWidth, scrollDelta, sheetRoom } from './keyboardMath';

describe('keyboardCover', () => {
  it('is 0 with no keyboard, whatever the bar', () => {
    expect(keyboardCover('android', 0, 48)).toBe(0);
    expect(keyboardCover('ios', 0, 34)).toBe(0);
  });
  it('adds the navigation bar on Android (RN reports ime minus system bars)', () => {
    expect(keyboardCover('android', 290, 24)).toBe(314);
    expect(keyboardCover('android', 290, 0)).toBe(290);
  });
  it('takes iOS and web as they are', () => {
    expect(keyboardCover('ios', 336, 34)).toBe(336);
    expect(keyboardCover('web', 280, 0)).toBe(280);
  });
  it('ignores a negative inset', () => {
    expect(keyboardCover('android', 290, -5)).toBe(290);
  });
});

describe('bottomRoom', () => {
  it('clears the gesture bar when the keyboard is down', () => {
    expect(bottomRoom(0, 24, 30)).toBe(54);
  });
  it('only keeps the padding when the container is lifted above the keyboard', () => {
    expect(bottomRoom(314, 24, 30)).toBe(30);
  });
});

describe('scrollDelta', () => {
  const view = { viewTop: 100, viewBottom: 500 };
  it('is 0 for a field already in view', () => {
    expect(scrollDelta({ ...view, fieldTop: 200, fieldBottom: 250 })).toBe(0);
  });
  it('scrolls down by what hangs below the view (plus the margin)', () => {
    expect(scrollDelta({ ...view, fieldTop: 480, fieldBottom: 530 })).toBe(46);
  });
  it('scrolls up when the field is above the view', () => {
    expect(scrollDelta({ ...view, fieldTop: 90, fieldBottom: 130 })).toBe(-26);
  });
  it('lines a field taller than the view up with its top', () => {
    expect(scrollDelta({ ...view, fieldTop: 300, fieldBottom: 900 })).toBe(184);
  });
  it('does nothing for a view with no room', () => {
    expect(scrollDelta({ viewTop: 100, viewBottom: 110, fieldTop: 400, fieldBottom: 440 })).toBe(0);
  });
  it('honours a custom margin', () => {
    expect(scrollDelta({ ...view, fieldTop: 480, fieldBottom: 520, margin: 0 })).toBe(20);
  });
});

describe('sheetRoom', () => {
  it('stays at max on a tall window with no keyboard', () => {
    expect(sheetRoom({ windowHeight: 900, cover: 0, topInset: 30, max: 600 })).toBe(600);
  });
  it('shrinks to fit above the keyboard on a 640 dp phone', () => {
    // 640 - 314 - 30 - 90
    expect(sheetRoom({ windowHeight: 640, cover: 314, topInset: 30, max: 600 })).toBe(206);
  });
  it('keeps a few rows even when almost nothing is left', () => {
    expect(sheetRoom({ windowHeight: 500, cover: 400, topInset: 40, max: 600 })).toBe(160);
  });
});

describe('otpSlotWidth', () => {
  it('is 45 where 6 cells and 5 gaps fit (360 dp minus 30 padding)', () => {
    expect(otpSlotWidth(330)).toBe(45);
  });
  it('shrinks on a 320 dp phone so the last cell is not cut off', () => {
    const w = otpSlotWidth(320 - 30);
    expect(w).toBe(39);
    expect(w * 6 + 11 * 5).toBeLessThanOrEqual(290);
  });
  it('never goes below the minimum', () => {
    expect(otpSlotWidth(150)).toBe(30);
  });
});

describe('compactForKeyboard', () => {
  it('never folds with the keyboard down', () => {
    expect(compactForKeyboard(640, 0)).toBe(false);
  });
  it('folds on a 640 dp phone with a 314 dp keyboard (326 dp left)', () => {
    expect(compactForKeyboard(640, 314)).toBe(true);
  });
  it('keeps the header on a tall phone (900 - 314 = 586 left)', () => {
    expect(compactForKeyboard(900, 314)).toBe(false);
  });
});
