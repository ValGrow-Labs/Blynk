import { describe, expect, test } from 'vitest';
import { createSharedClock } from './sharedClock';

function make() {
  const log: string[] = [];
  const clock = createSharedClock(() => log.push('start'), () => log.push('stop'));
  return { clock, log };
}

describe('shared animation clock', () => {
  test('does not run until somebody holds it', () => {
    const { clock, log } = make();
    expect(clock.running()).toBe(false);
    expect(log).toEqual([]);
  });

  test('starts with the first holder and stops with the last release', () => {
    const { clock, log } = make();
    const a = clock.hold();
    const b = clock.hold();
    expect(log).toEqual(['start']);
    expect(clock.holders()).toBe(2);
    a();
    expect(clock.running()).toBe(true);
    b();
    expect(clock.running()).toBe(false);
    expect(log).toEqual(['start', 'stop']);
  });

  test('releasing twice does not steal another consumer\'s hold', () => {
    const { clock } = make();
    const a = clock.hold();
    const b = clock.hold();
    a();
    a();
    expect(clock.holders()).toBe(1);
    expect(clock.running()).toBe(true);
    b();
    expect(clock.holders()).toBe(0);
  });

  test('pauses in the background and resumes in the foreground while held', () => {
    const { clock, log } = make();
    const release = clock.hold();
    clock.setForeground(false);
    expect(clock.running()).toBe(false);
    clock.setForeground(false);
    clock.setForeground(true);
    expect(clock.running()).toBe(true);
    expect(log).toEqual(['start', 'stop', 'start']);
    release();
    expect(log).toEqual(['start', 'stop', 'start', 'stop']);
  });

  test('a hold taken in the background waits for the foreground', () => {
    const { clock, log } = make();
    clock.setForeground(false);
    const release = clock.hold();
    expect(log).toEqual([]);
    clock.setForeground(true);
    expect(log).toEqual(['start']);
    release();
    expect(log).toEqual(['start', 'stop']);
  });

  test('foreground changes with nobody holding start nothing', () => {
    const { clock, log } = make();
    clock.setForeground(false);
    clock.setForeground(true);
    expect(log).toEqual([]);
  });
});
