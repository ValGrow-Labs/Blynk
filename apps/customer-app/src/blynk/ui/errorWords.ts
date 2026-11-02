import { localized } from '../i18n/localized';

/*
 * The words of the "Something went wrong" screen (src/components/RootError.tsx): shown instead of a
 * white screen when a screen throws while drawing. It sits above the app's providers, so it only
 * reads the current language (a block of words), nothing from the store.
 */
export const ERROR_SCREEN = localized(
  {
    title: 'Something went wrong',
    body: 'Sorry about that. Tap Try again and carry on shopping.',
    button: 'Try again',
  } as const,
  {
    si: {
      title: 'යම් දෙයක් වැරදුණා',
      body: 'සමාවෙන්න. නැවත උත්සාහ කර සාප්පු සවාරිය දිගටම කරගෙන යන්න.',
      button: 'නැවත උත්සාහ කරන්න',
    },
    ta: {
      title: 'ஏதோ தவறு ஏற்பட்டது',
      body: 'மன்னிக்கவும். மீண்டும் முயற்சித்து ஷாப்பிங்கைத் தொடருங்கள்.',
      button: 'மீண்டும் முயற்சிக்கவும்',
    },
  },
  'ui.ERROR_SCREEN',
);
