import { Image } from 'expo-image';
import { Dimensions } from 'react-native';
import { aislePhotoPx, aislePhotoUrls, type CatalogLike } from '@/blynk/catalog/aislePrefetch';
import { imageUri } from './imageUri';

/**
 * Starts loading the first photos of the category screen that is about to open, so its grid is mostly
 * drawn when the screen appears. Phone only, never awaited, never throws; at the size the screen asks for
 * (it has a sidebar except for a lone category: then these are just unused cache entries).
 */
export function prefetchAisle(data: CatalogLike | null | undefined, slug: string, sub?: string | null): void {
  try {
    const px = aislePhotoPx(Dimensions.get('window').width, true);
    const urls = aislePhotoUrls(data, slug, sub).map((u) => imageUri(u, px));
    if (urls.length > 0) void Image.prefetch(urls, { cachePolicy: 'memory-disk' }).catch(() => undefined);
  } catch {
    /* a prefetch is only ever a head start */
  }
}
