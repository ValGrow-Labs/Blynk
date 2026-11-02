import { describe, expect, it } from 'vitest';
import { cleanText, foldScript, phoneticFold, stemWord, tokenize } from './normalize';

describe('cleanText', () => {
  it('lowercases, strips diacritics and punctuation, collapses spaces', () => {
    expect(cleanText('  Thé   CHAI!! ')).toBe('the chai');
    expect(cleanText("Kellogg's Corn-Flakes (250g)")).toBe('kelloggs corn flakes 250g');
    expect(cleanText('Café Crème')).toBe('cafe creme');
  });

  it('ignores emoji, symbols and control characters', () => {
    expect(cleanText('sugar 😀🍬')).toBe('sugar');
    expect(cleanText('su\u0000g\u0007ar')).toBe('su g ar');
    expect(cleanText('!!! ??? ###')).toBe('');
    expect(cleanText('😀')).toBe('');
  });

  it('is safe on anything', () => {
    expect(cleanText(undefined)).toBe('');
    expect(cleanText(null)).toBe('');
    expect(cleanText(42 as unknown as string)).toBe('');
    expect(cleanText('x'.repeat(5000)).length).toBe(60);
  });

  it('strips zero-width joiners and non-joiners (Sinhala and Tamil keyboards add them)', () => {
    expect(cleanText('ක්‍ය')).toBe(cleanText('ක්ය'));
    expect(cleanText('சீ‌னி')).toBe('சீனி');
  });

  it('normalises to NFC so a decomposed vowel sign equals the composed one', () => {
    expect(cleanText('ො')).toBe(cleanText('ො'));
    expect(cleanText('ொ')).toBe(cleanText('ொ'));
  });
});

describe('phoneticFold', () => {
  const same = (...words: string[]) => {
    const keys = new Set(words.map((w) => phoneticFold(stemWord(w))));
    expect([...keys]).toHaveLength(1);
  };
  it('lets spellings of one sound meet', () => {
    same('seeni', 'sini', 'siini');
    same('shugar', 'sugar');
    same('chiken', 'chicken');
    same('bisquit', 'biscuit');
    same('paan', 'pan');
    same('haal', 'hal');
    same('dhal', 'dal', 'dall');
    same('thel', 'tel');
    same('theh', 'the');
    same('keeri', 'kiri');
    same('wambatu', 'vambatu');
    same('phone', 'fone');
    same('kukkul', 'kukul');
  });
  it('keeps different sounds apart', () => {
    expect(phoneticFold('sugar')).not.toBe(phoneticFold('salt'));
    expect(phoneticFold('lunu')).not.toBe(phoneticFold('luna'));
  });
});

describe('script folding', () => {
  it('meets sugar spellings', () => {
    expect(foldScript('සීනි')).toBe(foldScript('සීනී'));
    expect(foldScript('සීනි')).toBe(foldScript('සිනි'));
  });
  it('keeps salt (ලුණු) and onion (ලූණු) apart', () => {
    expect(foldScript('ලුණු')).not.toBe(foldScript('ලූණු'));
  });
  it('collapses repeated vowel signs and doubled Tamil consonants', () => {
    expect(foldScript('සීීනි')).toBe(foldScript('සීනි'));
    expect(foldScript('சக்கரை')).toBe(foldScript('சகரை'));
    expect(foldScript('சீனி')).toBe(foldScript('சினி'));
  });
});

describe('tokenize', () => {
  it('splits letters from digits and stems plurals', () => {
    expect(tokenize('Eggs 400g').map((t) => t.raw)).toEqual(['egg', '400', 'g']);
    expect(tokenize('tomatoes').map((t) => t.raw)).toEqual(['tomato']);
  });
  it('marks script words', () => {
    const t = tokenize('සීනි sugar');
    expect(t.map((x) => x.script)).toEqual([true, false]);
  });
  it('never throws', () => {
    expect(tokenize('‍‍')).toEqual([]);
    expect(tokenize('\uD800')).toEqual([]);
  });
});
