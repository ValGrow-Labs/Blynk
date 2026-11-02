import { PixelRatio, Platform } from 'react-native';
import { API_BASE_URL } from '@/blynk/api/client';
import { mediaOrigin, thumbUrl } from '@/blynk/lib/mediaUrl';

/** The API host the uploads are read through (blynk/lib/mediaUrl.ts); null in local development. */
const MEDIA_ORIGIN = mediaOrigin(API_BASE_URL);

/**
 * The address to load a picture shown `cssPx` wide on this phone: an upload becomes the API's resized
 * WebP (`?w=` bucket of cssPx x pixel ratio, at most 2.5x), anything else is returned as it is.
 * RemoteImage (phone) and the prefetch of the next screen's photos both use it, so a photo prefetched
 * is byte-for-byte the address the screen then asks for (a cache hit).
 */
export function imageUri(uri: string, cssPx: number): string {
  if (Platform.OS === 'web') return uri; // the browser keeps loading the original (RemoteImage.web.tsx)
  return thumbUrl(uri, cssPx, PixelRatio.get(), MEDIA_ORIGIN);
}
