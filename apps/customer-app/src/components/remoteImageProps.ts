import type { StyleProp, ImageStyle } from 'react-native';

/** One picture from the network (RemoteImage.tsx on the phone, RemoteImage.web.tsx in the browser). */
export interface RemoteImageProps {
  uri: string;
  /**
   * How many points wide the picture is drawn: the phone asks the server for a thumbnail of about that
   * size (a 79 pt tile does not download the 1200 px original). Give the box's width, not the screen's.
   */
  thumbPx: number;
  /** `contain` (the whole picture, never cropped; the default) or `cover` (fills the box, crops). */
  fit?: 'contain' | 'cover';
  /** A box with an explicit width and height, or absoluteFill. */
  style: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  /** Where a `cover` crop stays centred, 0-100 (the product / banner focal point); 50 when missing. */
  focalX?: number | null;
  focalY?: number | null;
  /** `low` for pictures that are off screen or below the fold: they queue behind the visible ones. */
  priority?: 'low' | 'normal' | 'high';
  /** The picture could not be loaded: the caller shows its fallback (the initial letter). */
  onError?: () => void;
  /** Told the picture's own pixel size once it is known (the product page fits its hero box to it). */
  onNaturalSize?: (width: number, height: number) => void;
  /** Reset the view when a recycled cell shows another picture (defaults to the address). */
  recyclingKey?: string;
}
