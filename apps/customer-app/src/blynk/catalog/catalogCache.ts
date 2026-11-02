import { storage } from '../lib/storage';
import type { Category, HomeGroup, Product, Promotion } from '../api/types';

/*
 * The phone keeps the last catalogue it loaded, so the next launch shows Home at once (stale for a
 * moment) while the fresh one loads (owner, 2026-11-02: "very slow": the first screen waited for the
 * network every time). Native only: the web page has the browser's HTTP cache and always loads fresh.
 * The caller says whether this is the phone (Platform.OS !== 'web'). Stored through the app's key-value storage (SQLite on the phone). A damaged or older-shaped copy is
 * ignored, never an error.
 */
export const CATALOG_CACHE_KEY = 'blynk.app.catalog.v1';
/** A copy older than this is not shown (prices and stock move; a week-old shelf would mislead). */
export const CATALOG_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type RawCatalog = {
  products: Product[];
  groups: HomeGroup[];
  promotions: Promotion[];
  categories: Category[];
};

type Stored = { v: 1; at: number; raw: RawCatalog };

const isRaw = (r: unknown): r is RawCatalog => {
  const o = r as Partial<RawCatalog> | null;
  return !!o && Array.isArray(o.products) && o.products.length > 0 && Array.isArray(o.groups)
    && Array.isArray(o.promotions) && Array.isArray(o.categories);
};

export function readCatalogCache(native: boolean, now = Date.now()): RawCatalog | null {
  if (!native) return null;
  try {
    const text = storage.get(CATALOG_CACHE_KEY);
    if (!text) return null;
    const s = JSON.parse(text) as Partial<Stored>;
    if (s.v !== 1 || typeof s.at !== 'number' || now - s.at > CATALOG_CACHE_MAX_AGE_MS || now < s.at - 60_000) return null;
    return isRaw(s.raw) ? s.raw : null;
  } catch {
    return null;
  }
}

export function writeCatalogCache(raw: RawCatalog, native: boolean, now = Date.now()): void {
  if (!native || !isRaw(raw)) return;
  try {
    storage.set(CATALOG_CACHE_KEY, JSON.stringify({ v: 1, at: now, raw } satisfies Stored));
  } catch {
    /* storage full or blocked: the next launch just loads from the network */
  }
}
