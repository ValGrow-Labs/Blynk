import { localized } from '@/blynk/i18n/localized';

/*
 * The words of the slim "active order" banner above the tab bar (owner's brother, 2026-11-03, the
 * PickMe style), in English, Sinhala and Tamil. Read them while rendering (never at module load).
 */

export const BANNER_WORDS = localized(
  {
    placed: 'Order placed',
    packing: 'Packing your order',
    packed: 'Packed, waiting for a rider',
    packedAssigned: 'A rider is picking up your order',
    onTheWay: 'Rider is on the way',
    nearby: 'Your rider is nearby',
    arrived: 'Your rider has arrived',
    arriving: (minutes: number) => `Arriving in about ${minutes} min`,
    track: 'Track',
    view: 'View',
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    tapTrack: 'Tap to track your order',
    tapView: 'Tap to see your order',
  } as const,
  {
    si: {
      placed: 'ඇණවුම ලැබුණා',
      packing: 'ඔබේ ඇණවුම ඇසුරුම් කරනවා',
      packed: 'ඇසුරුම් කළා, රයිඩර් කෙනෙක් එනතුරු',
      packedAssigned: 'රයිඩර් කෙනෙක් ඔබේ ඇණවුම ගන්න එනවා',
      onTheWay: 'රයිඩර් එනවා',
      nearby: 'ඔබේ රයිඩර් ළඟයි',
      arrived: 'ඔබේ රයිඩර් ළඟා වුණා',
      arriving: (minutes: number) => `මිනිත්තු ${minutes}කින් පමණ ළඟා වෙනවා`,
      track: 'ලුහුබඳින්න',
      view: 'බලන්න',
      stepOf: (step: number, total: number) => `පියවර ${step} / ${total}`,
      tapTrack: 'ඇණවුම ලුහුබැඳීමට තට්ටු කරන්න',
      tapView: 'ඇණවුම බැලීමට තට්ටු කරන්න',
    },
    ta: {
      placed: 'ஆர்டர் பெறப்பட்டது',
      packing: 'உங்கள் ஆர்டர் பேக் செய்யப்படுகிறது',
      packed: 'பேக் ஆனது, ரைடருக்காக காத்திருக்கிறது',
      packedAssigned: 'ஒரு ரைடர் உங்கள் ஆர்டரை எடுக்க வருகிறார்',
      onTheWay: 'ரைடர் வந்துகொண்டிருக்கிறார்',
      nearby: 'உங்கள் ரைடர் அருகில் இருக்கிறார்',
      arrived: 'உங்கள் ரைடர் வந்துவிட்டார்',
      arriving: (minutes: number) => `சுமார் ${minutes} நிமிடத்தில் வந்துவிடுவார்`,
      track: 'கண்காணி',
      view: 'பார்க்க',
      stepOf: (step: number, total: number) => `படி ${step} / ${total}`,
      tapTrack: 'ஆர்டரைக் கண்காணிக்கத் தட்டவும்',
      tapView: 'ஆர்டரைப் பார்க்கத் தட்டவும்',
    },
  },
  'orders.BANNER_WORDS',
);
