import { Image } from 'expo-image';
import { memo } from 'react';
import { imageUri } from '@/lib/imageUri';
import type { RemoteImageProps } from './remoteImageProps';

export type { RemoteImageProps } from './remoteImageProps';

const pct = (n: number | null | undefined) => (typeof n === 'number' && n >= 0 && n <= 100 ? n : 50);

/*
 * A picture from the network on the phone, through expo-image (SDK 57 docs, Image): a memory + disk cache
 * that survives restarts (React Native's own Image only had the HTTP cache), decoding at the size it is
 * drawn, a thumbnail address instead of the original (lib/imageUri.ts), at most a 100 ms cross-fade and
 * no spinner: the tile behind it (white / grey) is the placeholder, so nothing blocks while it loads.
 * The browser has its own file, RemoteImage.web.tsx, with the behaviour the app always had.
 */
export const RemoteImage = memo(function RemoteImage({
  uri, thumbPx, fit = 'contain', style, accessibilityLabel, focalX, focalY, priority = 'normal', onError, onNaturalSize, recyclingKey,
}: RemoteImageProps) {
  const src = imageUri(uri, thumbPx);
  return (
    <Image
      source={{ uri: src }}
      style={style}
      contentFit={fit}
      contentPosition={fit === 'cover' ? { left: `${pct(focalX)}%`, top: `${pct(focalY)}%` } : 'center'}
      cachePolicy="memory-disk"
      priority={priority}
      transition={100}
      recyclingKey={recyclingKey ?? src}
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      onError={onError ? () => onError() : undefined}
      onLoad={onNaturalSize ? (e) => { if (e.source.width > 0 && e.source.height > 0) onNaturalSize(e.source.width, e.source.height); } : undefined}
    />
  );
});
