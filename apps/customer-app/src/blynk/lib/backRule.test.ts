import { describe, expect, it } from 'vitest';
import { ownsBack } from './backRule';

describe('ownsBack', () => {
  it('leaves a plain arrow with history to the navigator', () => {
    expect(ownsBack({ customArrow: false, canGoBack: true })).toBe(false);
  });
  it('takes over a plain arrow with nothing to go back to (notification / shared link)', () => {
    expect(ownsBack({ customArrow: false, canGoBack: false })).toBe(true);
  });
  it('always takes over a custom arrow', () => {
    expect(ownsBack({ customArrow: true, canGoBack: true })).toBe(true);
    expect(ownsBack({ customArrow: true, canGoBack: false })).toBe(true);
  });
});
