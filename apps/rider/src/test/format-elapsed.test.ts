import { describe, it, expect } from 'vitest';
import { formatElapsed } from '../lib/format';

/** Same unit steps as the customer app's "Last seen ..." line: seconds under a minute, then minutes, then hours. */
describe('formatElapsed', () => {
  it('reads raw seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s ago');
    expect(formatElapsed(4)).toBe('4s ago');
    expect(formatElapsed(59)).toBe('59s ago');
  });

  it('switches to whole minutes from 60 s', () => {
    expect(formatElapsed(60)).toBe('1 min ago');
    expect(formatElapsed(95)).toBe('1 min ago');
    expect(formatElapsed(120)).toBe('2 min ago');
    expect(formatElapsed(3599)).toBe('59 min ago');
  });

  it('switches to whole hours from 1 h', () => {
    expect(formatElapsed(3600)).toBe('1 h ago');
    expect(formatElapsed(5399)).toBe('1 h ago');
    expect(formatElapsed(7200)).toBe('2 h ago');
    expect(formatElapsed(3 * 3600 + 59 * 60)).toBe('3 h ago');
  });

  it('never shows a negative number (clock skew) and rounds fractions down', () => {
    expect(formatElapsed(-5)).toBe('0s ago');
    expect(formatElapsed(4.9)).toBe('4s ago');
  });
});
