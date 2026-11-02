import { describe, expect, test } from 'vitest';
import { restartToHome } from './restart';

describe('error screen "Try again"', () => {
  test('redraws first, then goes Home', async () => {
    const log: string[] = [];
    await restartToHome(async () => { log.push('retry'); }, () => log.push('home'));
    expect(log).toEqual(['retry', 'home']);
  });

  test('still goes Home when the redraw fails', async () => {
    const log: string[] = [];
    await restartToHome(() => Promise.reject(new Error('boom')), () => log.push('home'));
    expect(log).toEqual(['home']);
  });

  test('never throws, even when going Home does', async () => {
    await expect(restartToHome(async () => {}, () => { throw new Error('no navigator'); })).resolves.toBeUndefined();
  });
});
