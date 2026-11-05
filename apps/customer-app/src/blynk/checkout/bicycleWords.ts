import { localized } from '@/blynk/i18n/localized';

/*
 * Bicycle delivery (2026-11-05; contract docs/superpowers/plans/2026-11-05-bicycle-delivery.md) in
 * English, Sinhala and Tamil. Plain .ts so the completeness test can check it. Amounts arrive
 * already formatted ("LKR 80"). New wording: needs a native-speaker review.
 */
export const BICYCLE_WORDS = localized(
  {
    sectionTitle: 'Delivery method',
    bicycleTitle: 'Bicycle - cheaper, a bit slower',
    /** The fee and the trip length the bicycle is for. */
    bicycleSub: (fee: string, km: string) => `${fee} · for trips up to ${km} km`,
    motorbikeTitle: 'Motorbike - faster',
    motorbikeSub: (fee: string) => fee,
    /** The small label on an order delivered by bicycle. */
    bicycleLabel: 'Bicycle delivery',
    /** The note under the delivery fee in the bill while bicycle is picked. */
    billNote: 'Bicycle delivery, for short trips',
  } as const,
  {
    si: {
      sectionTitle: 'බෙදාහැරීමේ ක්‍රමය',
      bicycleTitle: 'පාපැදිය - ලාභයි, ටිකක් ප්‍රමාදයි',
      bicycleSub: (fee: string, km: string) => `${fee} · කි.මී. ${km} ක් දක්වා ගමන් සඳහා`,
      motorbikeTitle: 'යතුරුපැදිය - වේගවත්',
      motorbikeSub: (fee: string) => fee,
      bicycleLabel: 'පාපැදියෙන් බෙදාහැරීම',
      billNote: 'පාපැදියෙන් බෙදාහැරීම, කෙටි ගමන් සඳහා',
    },
    ta: {
      sectionTitle: 'டெலிவரி முறை',
      bicycleTitle: 'சைக்கிள் - மலிவு, சற்று தாமதம்',
      bicycleSub: (fee: string, km: string) => `${fee} · ${km} கி.மீ. வரையிலான பயணங்களுக்கு`,
      motorbikeTitle: 'மோட்டார் சைக்கிள் - விரைவு',
      motorbikeSub: (fee: string) => fee,
      bicycleLabel: 'சைக்கிள் டெலிவரி',
      billNote: 'சைக்கிள் டெலிவரி, குறுகிய பயணங்களுக்கு',
    },
  },
  'checkout.BICYCLE_WORDS',
);
