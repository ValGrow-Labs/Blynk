import { describe, expect, it } from 'vitest';
import { hintParts, IOS_HINT_WORDS } from './iosHintWords';
import { HINT_QUIET_DAYS, inQuietPeriod, isIos, isIosSafari, parseShownAt, shouldShowIosHint, type HintEnv } from './iosHint';
import { resetLangForTests, setLang } from '@/blynk/i18n/lang';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 330.0.0.35.108';
const FB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const env = (o: Partial<HintEnv> = {}): HintEnv => ({ userAgent: SAFARI, platform: 'iPhone', maxTouchPoints: 5, lastShownAt: null, now: NOW, ...o });

describe('iPhone Add to Home Screen hint', () => {
  it('shows in iPhone Safari that is not installed and never saw it', () => {
    expect(shouldShowIosHint(env())).toBe(true);
  });

  it('never inside the installed app', () => {
    expect(shouldShowIosHint(env({ navigatorStandalone: true }))).toBe(false);
    expect(shouldShowIosHint(env({ displayStandalone: true }))).toBe(false);
  });

  it('never on Android or a desktop', () => {
    expect(shouldShowIosHint(env({ userAgent: ANDROID, platform: 'Linux armv81' }))).toBe(false);
    expect(shouldShowIosHint(env({ userAgent: IPADOS.replace('Macintosh', 'Windows'), platform: 'Win32', maxTouchPoints: 0 }))).toBe(false);
  });

  it('iPadOS (a Mac with a touch screen) counts as iOS', () => {
    expect(isIos(IPADOS, 'MacIntel', 5)).toBe(true);
    expect(isIos(IPADOS, 'MacIntel', 0)).toBe(false);
    expect(shouldShowIosHint(env({ userAgent: IPADOS, platform: 'MacIntel' }))).toBe(true);
  });

  it('only Safari: not Chrome on iOS, not in-app browsers', () => {
    expect(isIosSafari(SAFARI)).toBe(true);
    for (const ua of [CHROME, INSTAGRAM, FB]) {
      expect(isIosSafari(ua)).toBe(false);
      expect(shouldShowIosHint(env({ userAgent: ua }))).toBe(false);
    }
  });

  it('stays away for 14 days after it was shown, then returns', () => {
    expect(HINT_QUIET_DAYS).toBe(14);
    expect(shouldShowIosHint(env({ lastShownAt: NOW - 1 * DAY }))).toBe(false);
    expect(shouldShowIosHint(env({ lastShownAt: NOW - 13 * DAY }))).toBe(false);
    expect(shouldShowIosHint(env({ lastShownAt: NOW - 14 * DAY }))).toBe(true);
    expect(shouldShowIosHint(env({ lastShownAt: NOW - 60 * DAY }))).toBe(true);
  });

  it('a clock set back does not hide it for ever', () => {
    expect(inQuietPeriod(NOW + 30 * DAY, NOW)).toBe(false);
  });

  it('reads the stored time safely', () => {
    expect(parseShownAt(null)).toBeNull();
    expect(parseShownAt('abc')).toBeNull();
    expect(parseShownAt('0')).toBeNull();
    expect(parseShownAt(String(NOW))).toBe(NOW);
  });
});

describe('hint words', () => {
  it('splits the bold button names out of the sentence', () => {
    expect(hintParts('Install: tap [Share], then [Add].')).toEqual([
      { text: 'Install: tap ', bold: false }, { text: 'Share', bold: true }, { text: ', then ', bold: false }, { text: 'Add', bold: true }, { text: '.', bold: false },
    ]);
  });

  it('is written in all three languages, with both button names in each', () => {
    for (const lang of ['en', 'si', 'ta'] as const) {
      resetLangForTests();
      setLang(lang);
      const bold = hintParts(IOS_HINT_WORDS.line).filter((p) => p.bold).map((p) => p.text);
      expect(bold).toEqual(['Share', 'Add to Home Screen']);
      expect(IOS_HINT_WORDS.close.length).toBeGreaterThan(0);
    }
    resetLangForTests();
  });
});
