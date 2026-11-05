import { localized } from '@/blynk/i18n/localized';

/*
 * The iPhone "Add to Home Screen" hint (src/components/IosInstallHint.web.tsx) in English, Sinhala
 * and Tamil. Plain .ts so the completeness test can check it. The words in [square brackets] are
 * Safari's own button names (Safari shows them in the iPhone's language): drawn bold, brackets
 * removed (see hintParts). New wording: needs a native-speaker review.
 */
export const IOS_HINT_WORDS = localized(
  {
    line: 'Install Blynk: tap [Share], then [Add to Home Screen].',
    close: 'Close',
  } as const,
  {
    si: {
      line: 'Blynk ස්ථාපනය කරන්න: [Share] ඔබා, [Add to Home Screen] තෝරන්න.',
      close: 'වසන්න',
    },
    ta: {
      line: 'Blynk-ஐ நிறுவ: [Share] தொட்டு, [Add to Home Screen] தேர்ந்தெடுக்கவும்.',
      close: 'மூடு',
    },
  },
  'iosHint',
);

export type HintPart = { text: string; bold: boolean };

/** "a [b] c" -> a / b (bold) / c. */
export function hintParts(line: string): HintPart[] {
  return line.split(/(\[[^\]]*\])/).filter(Boolean).map((p) => (p.startsWith('[') && p.endsWith(']') ? { text: p.slice(1, -1), bold: true } : { text: p, bold: false }));
}
