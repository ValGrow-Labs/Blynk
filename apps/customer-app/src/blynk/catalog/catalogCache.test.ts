import { describe, expect, it } from 'vitest';
import { storage } from '../lib/storage';
import { CATALOG_CACHE_KEY, CATALOG_CACHE_MAX_AGE_MS, readCatalogCache, writeCatalogCache, type RawCatalog } from './catalogCache';

const raw = (): RawCatalog => ({
  products: [{ id: 'p1', name: 'Anchor' } as never],
  groups: [],
  promotions: [],
  categories: [],
});
const NOW = 1_800_000_000_000;

describe('catalogue cache (the phone shows the last shelf at once)', () => {
  it('returns what was saved', () => {
    writeCatalogCache(raw(), true, NOW);
    expect(readCatalogCache(true, NOW + 1000)?.products[0]?.name).toBe('Anchor');
  });

  it('does nothing on the web', () => {
    storage.set(CATALOG_CACHE_KEY, '');
    writeCatalogCache(raw(), false, NOW);
    expect(storage.get(CATALOG_CACHE_KEY)).toBe('');
    writeCatalogCache(raw(), true, NOW);
    expect(readCatalogCache(false, NOW)).toBeNull();
  });

  it('ignores a copy that is too old, or from the future', () => {
    writeCatalogCache(raw(), true, NOW);
    expect(readCatalogCache(true, NOW + CATALOG_CACHE_MAX_AGE_MS + 1)).toBeNull();
    expect(readCatalogCache(true, NOW - 10 * 60_000)).toBeNull();
  });

  it('ignores damaged, empty or other-shaped copies', () => {
    for (const bad of ['{', '[]', '{"v":2}', JSON.stringify({ v: 1, at: NOW, raw: { products: [] } }), JSON.stringify({ v: 1, at: NOW, raw: null })]) {
      storage.set(CATALOG_CACHE_KEY, bad);
      expect(readCatalogCache(true, NOW)).toBeNull();
    }
  });

  it('does not save an empty catalogue over a good one', () => {
    writeCatalogCache(raw(), true, NOW);
    writeCatalogCache({ products: [], groups: [], promotions: [], categories: [] }, true, NOW + 5);
    expect(readCatalogCache(true, NOW + 10)?.products).toHaveLength(1);
  });
});
