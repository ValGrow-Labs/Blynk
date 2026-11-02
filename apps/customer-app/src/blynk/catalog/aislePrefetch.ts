import type { Category, Product } from '../api/types';
import { productsInView, resolveCategory } from './tree';

/*
 * The category screen (app/category/[slug].tsx) draws a two-column grid beside a sidebar. Its card width
 * lives here so the screen and the prefetch of its photos (lib/prefetchImages.ts) agree on one size: a
 * photo prefetched at the size the screen then asks for is a cache hit.
 */
export const AISLE_SIDEBAR_W = 86;
export const AISLE_PAD = 12;
export const AISLE_GAP = 12;
/** ProductImage's default share of the card that the photo fills. */
const PHOTO_INSET = 0.92;

export function aisleCardWidth(screenW: number, hasSidebar: boolean): number {
  const gridW = screenW - (hasSidebar ? AISLE_SIDEBAR_W : 0) - AISLE_PAD * 2;
  return Math.floor((gridW - AISLE_GAP) / 2);
}

/** How wide the photo is drawn inside a card of that width (the size to ask the server for). */
export const aislePhotoPx = (screenW: number, hasSidebar: boolean) => aisleCardWidth(screenW, hasSidebar) * PHOTO_INSET;

/** How many photos of the screen about to open are fetched ahead: about the first two screenfuls. */
export const AISLE_PREFETCH_COUNT = 12;

export interface CatalogLike { categories: Category[]; products: Product[]; chainOf: (id: string) => string[] }

/** The photo addresses of the first products the category screen will show for this slug (and sub), in order. */
export function aislePhotoUrls(data: CatalogLike | null | undefined, slug: string, sub?: string | null, max = AISLE_PREFETCH_COUNT): string[] {
  if (!data) return [];
  const view = resolveCategory(data.categories, slug, sub);
  if (!view) return [];
  const out: string[] = [];
  for (const p of productsInView(data.products, data.chainOf, view)) {
    if (p.image_url && !out.includes(p.image_url)) out.push(p.image_url);
    if (out.length >= max) break;
  }
  return out;
}
