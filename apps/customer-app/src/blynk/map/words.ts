import { localized } from '@/blynk/i18n/localized';

/*
 * The one line of the phone map's own words: the hint a small map inside a scrolling page shows when a
 * finger drags it (maplibre's "cooperative gestures"). Read while building the page, never at module load.
 */
export const MAP_WORDS = localized(
  {
    twoFingers: 'Use two fingers to move the map',
  } as const,
  {
    si: { twoFingers: 'සිතියම ගෙන යාමට ඇඟිලි දෙකක් භාවිතා කරන්න' },
    ta: { twoFingers: 'வரைபடத்தை நகர்த்த இரண்டு விரல்களைப் பயன்படுத்துங்கள்' },
  },
  'map.MAP_WORDS',
);
