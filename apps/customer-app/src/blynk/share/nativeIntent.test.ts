import { describe, expect, test, vi } from 'vitest';
import { nativeIntentPath } from './nativeIntent';

describe('links that open the phone app', () => {
  test('blynk:// routes: the first segment sits in the host', () => {
    expect(nativeIntentPath('blynk://order/abc-123')).toBe('/order/abc-123');
    expect(nativeIntentPath('blynk://p/xyz_9')).toBe('/p/xyz_9');
    expect(nativeIntentPath('blynk:///track/7')).toBe('/track/7');
    expect(nativeIntentPath('blynk://home')).toBe('/home');
    expect(nativeIntentPath('blynk://')).toBe('/');
  });

  test('a shared product link and the web app base', () => {
    expect(nativeIntentPath('https://blynk.lk/p/abc_1')).toBe('/p/abc_1');
    expect(nativeIntentPath('https://blynk.lk/app/p/abc_1')).toBe('/p/abc_1');
    expect(nativeIntentPath('https://blynk.lk/app/')).toBe('/');
    expect(nativeIntentPath('https://blynk.lk/app')).toBe('/');
    expect(nativeIntentPath('https://blynk.lk/app/order/55?x=1')).toBe('/order/55');
  });

  test('the site hash routes', () => {
    expect(nativeIntentPath('https://blynk.lk/app/#/p/abc')).toBe('/p/abc');
    expect(nativeIntentPath('https://blynk.lk/app/#/refer')).toBe('/refer');
    expect(nativeIntentPath('https://blynk.lk/app/#/nothing-we-have')).toBe('/');
  });

  test('a referral link keeps the code and opens the app at its start', () => {
    const got = vi.fn();
    expect(nativeIntentPath('https://blynk.lk/app/?ref=friend7', got)).toBe('/');
    expect(got).toHaveBeenCalledWith('FRIEND7');
    expect(nativeIntentPath('blynk://refer?ref=ab12', got)).toBe('/refer');
    expect(got).toHaveBeenLastCalledWith('AB12');
    const none = vi.fn();
    nativeIntentPath('https://blynk.lk/app/?ref=%3Cscript%3E', none);
    expect(none).not.toHaveBeenCalled();
  });

  test('a failing referral store never breaks the link', () => {
    expect(nativeIntentPath('blynk://p/abc?ref=ZZZ99', () => { throw new Error('blocked'); })).toBe('/p/abc');
  });

  test('dev-client and Expo URLs pass through untouched', () => {
    const dev = 'blynk://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081';
    expect(nativeIntentPath(dev)).toBe(dev);
    expect(nativeIntentPath('exp://192.168.1.2:8081/--/order/1')).toBe('exp://192.168.1.2:8081/--/order/1');
  });

  test('an unsafe or empty input opens the start, never throws', () => {
    expect(nativeIntentPath('https://blynk.lk/p/<script>')).toBe('/');
    expect(nativeIntentPath('')).toBe('/');
    expect(nativeIntentPath(undefined as unknown as string)).toBe('/');
    expect(nativeIntentPath('/order/9')).toBe('/order/9');
    expect(nativeIntentPath('javascript:alert(1)')).toBe('/');
  });
});
