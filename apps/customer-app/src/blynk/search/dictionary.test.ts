import { describe, expect, it } from 'vitest';
import { DICTIONARY, DICTIONARY_GROUPS, DICTIONARY_THEMES } from './dictionary';
import { cleanText, isScriptText, tokensOfClean } from './normalize';

describe('search dictionary', () => {
  it('has 250+ entries in every theme the plan names', () => {
    expect(DICTIONARY.length).toBeGreaterThanOrEqual(250);
    expect(DICTIONARY_THEMES).toEqual([
      'staples', 'dairy', 'bread', 'vegetables', 'fruit', 'meatFishEgg', 'spices', 'oils', 'drinks', 'snacks', 'baby', 'household', 'personalCare',
    ]);
    for (const t of DICTIONARY_THEMES) expect(DICTIONARY_GROUPS[t].length).toBeGreaterThanOrEqual(9);
  });

  it('every entry is well formed', () => {
    for (const e of DICTIONARY) {
      expect(e.en.trim()).toBe(e.en);
      expect(tokensOfClean(cleanText(e.en)).length, e.en).toBeGreaterThan(0);
      expect(e.aliases.length, e.en).toBeGreaterThan(0);
      for (const a of e.aliases) {
        const toks = tokensOfClean(cleanText(a));
        expect(toks.length, `${e.en}: "${a}"`).toBeGreaterThan(0);
        expect(toks.length, `${e.en}: "${a}" is longer than 3 words`).toBeLessThanOrEqual(3);
        expect(a, `${e.en}: "${a}" has spaces around it`).toBe(a.trim());
      }
      expect(new Set(e.aliases).size, `${e.en} repeats an alias`).toBe(e.aliases.length);
    }
  });

  it('has Sinhala and Tamil script for the commonest items', () => {
    const script = (en: string, re: RegExp) => DICTIONARY.find((e) => e.en === en)!.aliases.some((a) => re.test(a));
    for (const en of ['sugar', 'salt', 'rice', 'milk', 'dhal', 'egg', 'chicken', 'fish', 'potato', 'tomato', 'coconut', 'oil', 'tea']) {
      expect(script(en, /[඀-෿]/), `${en} Sinhala`).toBe(true);
      expect(script(en, /[஀-௿]/), `${en} Tamil`).toBe(true);
    }
    expect(DICTIONARY.some((e) => e.aliases.some(isScriptText))).toBe(true);
  });

  it('keeps salt and onion apart: lunu is salt, onions are loku lunu / rathu lunu / bombay', () => {
    const lunu = DICTIONARY.filter((e) => e.aliases.includes('lunu')).map((e) => e.en);
    expect(lunu).toEqual(['salt']);
    const onion = DICTIONARY.find((e) => e.en === 'onion')!;
    expect(onion.aliases).toEqual(expect.arrayContaining(['loku lunu', 'rathu lunu', 'bombay']));
    expect(onion.aliases).not.toContain('lunu');
  });

  it('has the plan\'s synonyms', () => {
    const has = (en: string, alias: string) => expect(DICTIONARY.find((e) => e.en === en)?.aliases, `${en} <- ${alias}`).toContain(alias);
    has('sugar', 'seeni'); has('bread', 'paan'); has('milk powder', 'kiri pitti'); has('dhal', 'parippu'); has('dhal', 'paruppu');
    has('garlic', 'sudu lunu'); has('garlic', 'poondu'); has('potato', 'ala'); has('potato', 'urulai'); has('coconut', 'pol'); has('coconut', 'thenga');
    has('oil', 'thel'); has('oil', 'ennai'); has('chicken', 'kukul mas'); has('chicken', 'kozhi'); has('fish', 'malu'); has('fish', 'meen');
    has('egg', 'biththara'); has('egg', 'muttai'); has('chilli', 'miris'); has('chilli', 'milagai'); has('coriander', 'kottamalli'); has('coriander', 'malli');
    has('diapers', 'pampers'); has('tea', 'chai');
  });
});
