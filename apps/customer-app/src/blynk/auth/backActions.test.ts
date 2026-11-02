import { describe, expect, it } from 'vitest';
import { otpBackAction } from './backActions';

describe('otpBackAction', () => {
  it('stays while a code is being checked or sent', () => {
    expect(otpBackAction({ busy: true, gate: false, canGoBack: true })).toBe('stay');
    expect(otpBackAction({ busy: true, gate: true, canGoBack: false })).toBe('stay');
  });
  it('goes to the gate login when the start gate opened it', () => {
    expect(otpBackAction({ busy: false, gate: true, canGoBack: true })).toBe('gate-login');
  });
  it('goes back to the caller, or the cart when opened cold', () => {
    expect(otpBackAction({ busy: false, gate: false, canGoBack: true })).toBe('back');
    expect(otpBackAction({ busy: false, gate: false, canGoBack: false })).toBe('cart');
  });
});
