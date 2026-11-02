import { memo, useEffect } from 'react';
import { Image } from 'react-native';
import type { RemoteImageProps } from './remoteImageProps';

export type { RemoteImageProps } from './remoteImageProps';

/** The browser keeps what the app always did: React Native's Image on the original address (no thumbnails, no expo-image). */
export const RemoteImage = memo(function RemoteImage({
  uri, fit = 'contain', style, accessibilityLabel, onError, onNaturalSize,
}: RemoteImageProps) {
  useEffect(() => {
    if (!onNaturalSize) return;
    let alive = true;
    Image.getSize(uri, (w, h) => { if (alive && w > 0 && h > 0) onNaturalSize(w, h); }, () => undefined);
    return () => { alive = false; };
  }, [uri]);
  return <Image source={{ uri }} resizeMode={fit} style={style} accessibilityLabel={accessibilityLabel} onError={onError ? () => onError() : undefined} />;
});
