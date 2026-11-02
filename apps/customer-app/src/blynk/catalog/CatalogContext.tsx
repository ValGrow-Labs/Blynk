import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { cartActions } from '@/lib/cart';
import { getCategories, getHomeGroups, getPromotions } from '../api/catalog';
import { ApiError } from '../api/client';
import { BROWSE_ERRORS } from './browseWords';
import type { Category, HomeGroup, Product, Promotion } from '../api/types';
import { ancestorsOf, topLevelOf } from '../lib/categories';
import { startCatalogLive } from '../lib/catalogLive';
import { loadAllProducts } from '../lib/loadAllProducts';
import { effectivePrice } from '../lib/pricing';
import { buildCategoryTree, type MainNode } from './tree';
import { readCatalogCache, writeCatalogCache, type RawCatalog } from './catalogCache';
import { productsInCategory } from './membership';
import { appHidden } from '../lib/visibility';
import { DEMO } from '@/demo/mode';

export interface CatalogData {
  products: Product[];
  /** Top-level aisles in Admin's home-group order. */
  aisles: Category[];
  /** Every category (sub-categories included). */
  categories: Category[];
  promotions: Promotion[];
  /** GET /catalog/home-groups as sent: the Mains with their top-level category tiles. */
  groups: HomeGroup[];
  /** Main -> Category -> Sub-category (docs/api/catalog-tools.md), for Home and the categories screen. */
  tree: MainNode[];
  /** Any category id -> its top-level aisle id. */
  topOf: (id: string) => string;
  /** Any category id -> its chain up to the top level, nearest first. */
  chainOf: (id: string) => string[];
}

/** Everything the shelf needs, requested at once: the small lists do not wait for the (paged) products. */
async function loadRaw(): Promise<RawCatalog> {
  const rest = Promise.all([
    getHomeGroups(),
    getPromotions().catch(() => ({ promotions: [] as Promotion[] })),
    getCategories().then((r) => r.categories).catch(() => [] as Category[]),
  ]);
  rest.catch(() => undefined); // if the products fail first, this must not become an unhandled rejection
  const products = await loadAllProducts();
  const [{ groups }, { promotions }, categories] = await rest;
  return { products, groups, promotions, categories };
}

function assemble({ products, groups, promotions, categories: all }: RawCatalog): CatalogData {
  const aisles: Category[] = groups.flatMap((g) => g.categories);
  // Home groups list top-level categories only; products can sit in a child category, so roll them up.
  const categories = all.length ? all : aisles;
  return {
    products, aisles, categories, promotions, groups, tree: buildCategoryTree(groups, categories),
    topOf: topLevelOf(categories), chainOf: ancestorsOf(categories),
  };
}

/**
 * What the server sent plus a signature of it: an unchanged shelf must not re-render the whole app, and
 * must not be rebuilt (category tree, lookups) or written to the phone's storage again either.
 */
async function loadAll(): Promise<{ raw: RawCatalog; sig: string }> {
  const raw = await loadRaw();
  return { raw, sig: JSON.stringify(raw) };
}

interface CatalogApi {
  data: CatalogData | null;
  error: ApiError | null;
  /** Reload now. Resolves false when that reload failed. */
  refresh: () => Promise<boolean>;
}

const Ctx = createContext<CatalogApi>({ data: null, error: null, refresh: async () => false });

/** One shared catalogue for every screen: loaded once, refreshed live (SSE / 30 s poll), and the cart reconciled each time. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  // the phone shows the last catalogue it saved at once; the fresh one replaces it as soon as it arrives.
  // The saved copy is read right after the first frame (below), not while it is being drawn: the launch intro
  // paints first and Home (which mounts ~0.7 s later) finds the shelf already there
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const seq = useRef(0);
  // what the shown catalogue was built from (the phone's saved copy counts: a live reload equal to it changes nothing)
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (DEMO) return;
    const t = setTimeout(() => {
      if (lastSig.current !== null) return; // the live answer is already in: it is newer than the saved copy
      const cached = readCatalogCache(Platform.OS !== 'web');
      if (cached) setData((cur) => cur ?? assemble(cached));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const refresh = useCallback(async () => {
    if (DEMO) return true;
    const n = ++seq.current;
    try {
      const { raw, sig } = await loadAll();
      if (n !== seq.current) return true; // a newer request is in flight; drop the stale answer
      setError(null);
      // the safety poll finds the same shelf almost every time: do not rebuild, save or re-render every screen for nothing
      if (sig === lastSig.current) return true;
      lastSig.current = sig;
      writeCatalogCache(raw, Platform.OS !== 'web');
      const d = assemble(raw);
      setData(d);
      cartActions.reconcileWith(d.products);
      return true;
    } catch (e) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(BROWSE_ERRORS.generic, 0));
      return false;
    }
  }, []);
  useEffect(() => {
    if (DEMO) return; // design mock: screens read src/demo/*, nothing is fetched
    void Promise.resolve().then(refresh); // first load, off the effect's synchronous path
    // the phone has no live stream, so it polls; a minute is plenty and halves the background work
    return startCatalogLive(() => void refresh(), appHidden, Platform.OS === 'web' ? 30_000 : 60_000);
  }, [refresh]);
  const api = useMemo(() => ({ data, error, refresh }), [data, error, refresh]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useCatalog = () => useContext(Ctx);

/** Products in an aisle or any of its sub-categories. */
export function productsIn(data: CatalogData, categoryId: string): Product[] {
  return productsInCategory(data.products, data.chainOf, categoryId);
}

/** Lowest effective price among available products, or null when there are none. */
export function minPrice(products: Product[]): number | null {
  const prices = products.filter((p) => p.is_available).map((p) => effectivePrice(p));
  return prices.length ? Math.min(...prices) : null;
}
