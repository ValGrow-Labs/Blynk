import { describe, expect, it } from 'vitest';
import { mergeInsets, parseInset, sameInsets } from './safeArea';

describe('safe-area readings', () => {
  it('parses a CSS length', () => {
    expect(parseInset('47px')).toBe(47);
    expect(parseInset('34.4px')).toBe(34);
    expect(parseInset('0px')).toBe(0);
    expect(parseInset('')).toBe(0);
    expect(parseInset('auto')).toBe(0);
    expect(parseInset(null)).toBe(0);
    expect(parseInset('-5px')).toBe(0);
  });

  it('merges edge by edge, taking the larger', () => {
    const lib = { top: 0, bottom: 34, left: 0, right: 0 };
    const mine = { top: 47, bottom: 0, left: 0, right: 0 };
    expect(mergeInsets(lib, mine)).toEqual({ top: 47, bottom: 34, left: 0, right: 0 });
  });

  it('a late 0 never takes an inset away', () => {
    const known = { top: 47, bottom: 34, left: 0, right: 0 };
    expect(mergeInsets(known, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual(known);
  });

  it('compares readings', () => {
    expect(sameInsets({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 1, bottom: 2, left: 3, right: 4 })).toBe(true);
    expect(sameInsets({ top: 1, bottom: 2, left: 3, right: 4 }, { top: 1, bottom: 2, left: 3, right: 5 })).toBe(false);
  });
});
