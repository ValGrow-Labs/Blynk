import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Metro picks `X.native.ts` instead of `X.ts` on a phone. So a platform file that imports its own
 * base name ("./X") imports ITSELF there: every name it expects from the shared file is undefined,
 * the app crashes only on the phone, and Node tests (which resolve ./X to X.ts) stay green. That was
 * the "Use my current location" crash on the first native build. Shared code belongs in a file with
 * another name (see location/positionShared.ts). Type-only imports are erased and are fine.
 */
const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('platform files do not import themselves', () => {
  const files = walk(SRC).filter((f) => /\.(native|web|ios|android)\.(ts|tsx)$/.test(f));

  it('finds the platform files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(file.slice(SRC.length + 1).replace(/\\/g, '/'), () => {
      const base = file.replace(/\\/g, '/').split('/').pop()!.replace(/\.(native|web|ios|android)\.(ts|tsx)$/, '');
      const text = readFileSync(file, 'utf8');
      const bad: string[] = [];
      for (const m of text.matchAll(/^(import|export)\s+(type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/gms)) {
        const isType = !!m[2];
        const spec = m[3]!;
        const last = spec.split('/').pop();
        if (!isType && last === base) bad.push(m[0].split('\n')[0]!);
      }
      expect(bad).toEqual([]);
    });
  }
});
