import type { CatalogLike } from '@/blynk/catalog/aislePrefetch';

/** The browser has its own image cache and no thumbnails: nothing to prefetch. */
export function prefetchAisle(_data: CatalogLike | null | undefined, _slug: string, _sub?: string | null): void {}
