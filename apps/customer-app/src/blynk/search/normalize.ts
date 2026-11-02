/*
 * Text normalisation for the smart search (docs/superpowers/plans/2026-11-02-smart-search.md).
 * Pure functions, no React Native, no \p{...} tricks beyond what the app already uses: the same code
 * runs in Hermes, on the web and in the Node tests.
 *
 *  - cleanText: NFC, invisible joiners stripped, Latin diacritics removed, lowercase, everything that is
 *    not a Latin letter / digit / Sinhala / Tamil character becomes a space (emoji, symbols, control
 *    characters are therefore ignored), capped at 60 characters.
 *  - Sinhala / Tamil script words are compared through foldScript (keyboard variants meet) and are
 *    never fuzzy-matched.
 *  - Latin words are compared through stemWord (light plural strip) and phoneticFold (spellings of
 *    the same sound meet: seeni / sini, shugar / sugar, chiken / chicken, paan / pan).
 */

export const TERM_MAX = 60;

/** One searchable word. `raw` is the comparison key (stemmed Latin, or folded script), `fold` the phonetic key. */
export interface Token {
  /** The cleaned word as typed. */
  text: string;
  /** Latin: stemmed lowercase word. Script: foldScript(word). */
  raw: string;
  /** Latin: phoneticFold(raw). Script: same as raw. */
  fold: string;
  script: boolean;
}

const SCRIPT_RE = /[඀-෿஀-௿]/;
/** Soft hyphen, zero-width space / joiners / marks, bidi controls, word joiner, BOM, variation selectors. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁯﻿︀-️]/g;
const NOT_SEARCHABLE = /[^a-z0-9඀-෿஀-௿]+/g;
const LATIN_EXTRA: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

export const isScriptText = (s: string): boolean => SCRIPT_RE.test(s);

const ASCII_ONLY = /^[\x00-\x7f]*$/;

function stripDiacritics(s: string): string {
  if (ASCII_ONLY.test(s)) return s;
  try {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  } catch {
    return s;
  }
}

/** Lowercase, tidy, whitespace-separated text; '' for anything that is not a string or has nothing searchable. */
export function cleanText(input: unknown, max: number = TERM_MAX): string {
  if (typeof input !== 'string' || !input) return '';
  let s = input.length > 600 ? input.slice(0, 600) : input;
  if (!ASCII_ONLY.test(s)) {
    try {
      s = s.normalize('NFC');
    } catch {
      /* an engine without normalize keeps the text as typed */
    }
    s = s.replace(INVISIBLE, '');
  }
  s = stripDiacritics(s).toLowerCase();
  s = s.replace(/['’‘`´]/g, '');
  s = s.replace(/[ßæœøłđðþı]/g, (c) => LATIN_EXTRA[c] ?? c);
  s = s.replace(NOT_SEARCHABLE, ' ').trim();
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

/* ---------------------------------------------------------------- Sinhala / Tamil */

const SCRIPT_MAP: Record<string, string> = {
  // Sinhala: long vowel signs and letters meet the short ones, except u/uu (ලුණු salt vs ලූණු onion differ)
  'ී': 'ි', 'ේ': 'ෙ', 'ෝ': 'ො', 'ෑ': 'ැ',
  'ඊ': 'ඉ', 'ඒ': 'එ', 'ඕ': 'ඔ', 'ආ': 'අ', 'ඈ': 'ඇ',
  // Sinhala: aspirated and voiced-aspirated consonants meet the plain ones; sibilants, ණ/ළ meet න/ල
  'ඛ': 'ක', 'ඝ': 'ග', 'ඡ': 'ච', 'ඣ': 'ජ', 'ඨ': 'ට', 'ඪ': 'ඩ', 'ථ': 'ත', 'ධ': 'ද', 'ඵ': 'ප', 'භ': 'බ',
  'ශ': 'ස', 'ෂ': 'ස', 'ණ': 'න', 'ළ': 'ල',
  // Tamil: long vowel signs and letters meet the short ones
  'ீ': 'ி', 'ே': 'ெ', 'ோ': 'ொ', 'ூ': 'ு',
  'ஈ': 'இ', 'ஏ': 'எ', 'ஓ': 'ஒ', 'ஊ': 'உ', 'ஆ': 'அ',
  // Tamil: grantha sibilants meet ச; ந/ண meet ன; ற meets ர; ள meets ல
  'ஷ': 'ச', 'ஸ': 'ச', 'ஜ': 'ச', 'ண': 'ன', 'ந': 'ன', 'ற': 'ர', 'ள': 'ல',
};
const SCRIPT_MAP_RE = new RegExp(`[${Object.keys(SCRIPT_MAP).join('')}]`, 'g');
/** The same dependent vowel sign / virama typed twice. */
const REPEATED_SIGN = /([ංඃ්-ෟෲෳா-்])\1+/g;

/** The comparison key of a Sinhala / Tamil word (also safe to call on anything else). */
export function foldScript(word: string): string {
  let s = word.replace(INVISIBLE, '').replace(REPEATED_SIGN, '$1');
  s = s.replace(SCRIPT_MAP_RE, (c) => SCRIPT_MAP[c] ?? c);
  // a consonant doubled with a virama between (க்க, ක්ක) is typed with or without the double
  s = s.replace(/([க-ஹ])்\1/g, '$1').replace(/([ක-ෆ])්\1/g, '$1');
  return s.replace(REPEATED_SIGN, '$1');
}

/* ---------------------------------------------------------------- Latin */

/** Light plural strip so "eggs" meets "egg" and "tomatoes" meets "tomato". Applied to both sides. */
export function stemWord(w: string): string {
  const n = w.length;
  if (n >= 5 && w.endsWith('oes')) return w.slice(0, -2);
  if (n >= 4 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/**
 * Phonetic key of a lowercase Latin word, so that spellings of one sound meet:
 * ph->f, ch/sh->s, th->t, dh->d, kh->k, gh->g, bh->b, ck/q/c->k (c before e, i, y -> s), w->v, z->s,
 * ee->i, oo->u, aa->a, doubled letters collapsed, a trailing h dropped.
 */
export function phoneticFold(word: string): string {
  let s = word.replace(/ph/g, 'f');
  s = s.replace(/ch/g, 's').replace(/sh/g, 's');
  s = s.replace(/th/g, 't').replace(/dh/g, 'd').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/bh/g, 'b');
  s = s.replace(/ck/g, 'k').replace(/q/g, 'k');
  s = s.replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
  s = s.replace(/w/g, 'v').replace(/z/g, 's');
  s = s.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a');
  s = s.replace(/([a-z])\1+/g, '$1');
  if (s.length > 2 && s.endsWith('h')) s = s.slice(0, -1);
  return s;
}

/** A catalogue repeats its words thousands of times: keep the last few thousand tokens. Tokens are never mutated. */
const TOKENS = new Map<string, Token>();
const TOKENS_MAX = 20000;

/** Token for an already cleaned word. */
export function makeToken(word: string): Token {
  const hit = TOKENS.get(word);
  if (hit) return hit;
  let tok: Token;
  if (SCRIPT_RE.test(word)) {
    const key = foldScript(word);
    tok = { text: word, raw: key, fold: key, script: true };
  } else {
    const raw = stemWord(word);
    tok = { text: word, raw, fold: phoneticFold(raw), script: false };
  }
  if (TOKENS.size >= TOKENS_MAX) TOKENS.clear();
  TOKENS.set(word, tok);
  return tok;
}

/** Token for a comparison key built elsewhere (a compound of two stemmed words, an alias). */
export function tokenFromKey(key: string): Token {
  return SCRIPT_RE.test(key)
    ? { text: key, raw: key, fold: key, script: true }
    : { text: key, raw: key, fold: phoneticFold(key), script: false };
}

/** Words of an already cleaned string; "1kg" -> "1", "kg". */
export function tokensOfClean(clean: string): Token[] {
  if (!clean) return [];
  const spaced = clean.replace(/([a-z])([0-9])/g, '$1 $2').replace(/([0-9])([a-z])/g, '$1 $2');
  const out: Token[] = [];
  for (const w of spaced.split(' ')) if (w) out.push(makeToken(w));
  return out;
}

/** Cleaned, tokenised text. Never throws. */
export function tokenize(input: unknown, max: number = TERM_MAX): Token[] {
  try {
    return tokensOfClean(cleanText(input, max));
  } catch {
    return [];
  }
}
