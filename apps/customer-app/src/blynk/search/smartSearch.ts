/*
 * Smart search over the catalogue the app already holds (docs/superpowers/plans/2026-11-02-smart-search.md).
 * Deterministic, offline, no network and no new dependency:
 *
 *   buildSearchIndex(products, categories)  once per catalogue (memoise: searchIndexFor)
 *   searchProducts(index, term, opts?)      per keystroke, a pure function -> [{ product, score, why }]
 *
 * How a term is matched:
 *  1. It is cleaned and split into words (normalize.ts). Every word must hit somewhere on the product
 *     (name, category names, description, sku / barcode), in any order.
 *  2. A word hits a catalogue word exactly, phonetically (shugar = sugar), as a prefix ("sug"), or as a
 *     typo (Damerau-Levenshtein, 0 edits for < 4 letters, 1 for 4-6, 2 for 7+, never against script).
 *  3. Words that are in the dictionary (seeni, සීනි, சீனி, pampers, kukul mas ...) are also searched as their
 *     English meaning ("sugar"); the best of the literal and the translated reading wins.
 *
 * Scores (best first), the tiers are about 100 apart so the small in-tier bonuses never cross them:
 *   1000 exact full name   900 name starts with the term (a whole word, "sugar" -> "Sugar Cane Juice")
 *   800 every word a whole word of the name   780 name starts with the letters of a longer word ("sugar" -> "Sugary Cereal")
 *   700-760 dictionary / synonym hit on the name   650 phonetic   600 prefix   <=500 fuzzy (fewer edits first)
 *   <=340 category / sku   <=270 description.   Ties: in stock first, lower price, name.
 */
import type { Category, Product } from '../api/types';
import { effectivePrice } from '../lib/pricing';
import { DICTIONARY, type DictEntry } from './dictionary';
import { cleanText, tokenFromKey, tokensOfClean, type Token } from './normalize';

/** A product as the catalogue sends it; `sku` / `barcode` are searched when a server ever sends them. */
export type SearchableProduct = Product & { sku?: string | null; barcode?: string | null };

export type WhyKind =
  | 'exact' | 'name-start' | 'words' | 'dictionary' | 'phonetic' | 'prefix' | 'fuzzy' | 'category' | 'description' | 'sku';
export interface SearchWhy {
  kind: WhyKind;
  /** The English word a synonym / Singlish / script word was read as. */
  via?: string;
  /** Typos tolerated (fuzzy hits, and Singlish words matched through a misspelt alias). */
  edits?: number;
}
export interface SearchResult { product: Product; score: number; why: SearchWhy }
export interface SearchOptions {
  /** Only products listed in this category (or one of its sub-categories). */
  categorySlug?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ the index */

const F_NAME = 0;
const F_CAT = 1;
const F_DESC = 2;
const F_CODE = 3;

interface Entry {
  key: string;
  fold: string;
  script: boolean;
  /** doc * 4 + field, each at most once */
  posts: number[];
  last: number;
}
interface Doc {
  product: Product;
  /** Name words (stemmed keys) joined by a space. */
  nameKey: string;
  catIds: string[];
}
export interface SearchIndex {
  docs: Doc[];
  entries: Entry[];
  vocab: Map<string, Entry>;
  codes: { code: string; doc: number }[];
  categoryIdBySlug: Map<string, string>;
}

const DESC_CHARS = 400;
const DESC_WORDS = 30;

function chainIds(id: string, byId: Map<string, Category>, out: Set<string>) {
  let cur: string | null | undefined = id;
  for (let i = 0; i < 10 && cur && !out.has(cur); i++) {
    out.add(cur);
    cur = byId.get(cur)?.parent_id;
  }
}

const cleanCode = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '');

/** Pure and memoisable: the words of every product, built once per catalogue (not per keystroke). */
export function buildSearchIndex(products: readonly Product[], categories: readonly Category[] = []): SearchIndex {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const vocab = new Map<string, Entry>();
  const entries: Entry[] = [];
  const docs: Doc[] = [];
  const codes: { code: string; doc: number }[] = [];

  const add = (tok: Token, doc: number, field: number) => {
    let e = vocab.get(tok.raw);
    if (!e) {
      e = { key: tok.raw, fold: tok.fold, script: tok.script, posts: [], last: -1 };
      vocab.set(tok.raw, e);
      entries.push(e);
    }
    const post = doc * 4 + field;
    if (e.last !== post) {
      e.posts.push(post);
      e.last = post;
    }
  };

  products.forEach((p, i) => {
    const name = tokensOfClean(cleanText(p.name));
    for (const t of name) add(t, i, F_NAME);
    // "milkpowder" finds "Milk Powder": adjacent name words are also searchable glued together
    for (let k = 0; k + 1 < name.length; k++) {
      const a = name[k];
      const b = name[k + 1];
      if (!a.script && !b.script && a.raw.length >= 2 && b.raw.length >= 2 && /^[a-z]+$/.test(a.raw + b.raw) && a.raw.length + b.raw.length >= 6) {
        add(tokenFromKey(a.raw + b.raw), i, F_NAME);
      }
    }

    const ids = new Set<string>();
    chainIds(p.category_id, byId, ids);
    for (const x of p.extra_category_ids ?? []) chainIds(x, byId, ids);
    const catTexts = [p.category_name];
    for (const id of ids) {
      const c = byId.get(id);
      if (c && c.name !== p.category_name) catTexts.push(c.name);
    }
    for (const text of catTexts) for (const t of tokensOfClean(cleanText(text))) if (t.raw.length >= 2) add(t, i, F_CAT);

    if (p.description) {
      const words = tokensOfClean(cleanText(p.description.slice(0, DESC_CHARS), DESC_CHARS)).slice(0, DESC_WORDS);
      for (const t of words) if (t.raw.length >= 3 && !/^[0-9]+$/.test(t.raw)) add(t, i, F_DESC);
    }

    const sp = p as SearchableProduct;
    const codeList = [sp.sku, sp.barcode, ...(p.variants ?? []).flatMap((v) => [v.sku, v.barcode])];
    const seen = new Set<string>();
    for (const raw of codeList) {
      const code = cleanCode(raw);
      if (code.length >= 3 && !seen.has(code)) {
        seen.add(code);
        codes.push({ code, doc: i });
      }
    }

    docs.push({ product: p, nameKey: name.map((t) => t.raw).join(' '), catIds: [...ids] });
  });

  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  return { docs, entries, vocab, codes, categoryIdBySlug };
}

/** Whether `slug` is a category of this catalogue (so `categorySlug` can be honoured). */
export const hasCategory = (index: SearchIndex, slug: string): boolean => index.categoryIdBySlug.has(slug);

const memo = new WeakMap<object, { categories: readonly Category[]; index: SearchIndex }>();
/** The index already built for exactly this catalogue, or null (builds nothing). */
export function cachedSearchIndex(products: readonly Product[], categories: readonly Category[]): SearchIndex | null {
  const hit = memo.get(products);
  return hit && hit.categories === categories ? hit.index : null;
}
/** The index for a catalogue, rebuilt only when the catalogue arrays change. */
export function searchIndexFor(products: readonly Product[], categories: readonly Category[]): SearchIndex {
  const hit = cachedSearchIndex(products, categories);
  if (hit) return hit;
  const index = buildSearchIndex(products, categories);
  memo.set(products, { categories, index });
  return index;
}

/* ------------------------------------------------------------------ edit distance */

const ROW_MAX = 66;
const r0 = new Uint8Array(ROW_MAX);
const r1 = new Uint8Array(ROW_MAX);
const r2 = new Uint8Array(ROW_MAX);

/** Damerau-Levenshtein (adjacent swap counts 1): the distance when it is <= max, else max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (n === 0) return m <= max ? m : max + 1;
  if (m === 0) return n <= max ? n : max + 1;
  if (n >= ROW_MAX || m >= ROW_MAX) return max + 1;
  let prev2 = r0;
  let prev = r1;
  let cur = r2;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ca === cb ? 0 : 1);
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        const sw = prev2[j - 2] + 1;
        if (sw < v) v = sw;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  const d = prev[m];
  return d <= max ? d : max + 1;
}

/** Typos allowed for a typed word of this length. */
export const editLimit = (len: number): number => (len < 4 ? 0 : len < 7 ? 1 : 2);

/* ------------------------------------------------------------------ the dictionary at query time */

interface Concept { en: string; targets: Token[][] }
interface AliasHit { concept: number; via: string; mode: number; edits: number }

/** How a query word was reached: typed (literal) or through a dictionary alias exactly / as a prefix / misspelt. */
const M_LITERAL = 0;
const M_DICT = 1;
const M_DICT_PREFIX = 2;
const M_DICT_FUZZY = 3;

const keyOfTokens = (tokens: Token[]): string => tokens.map((t) => t.fold).join(' ');

let compiled: {
  concepts: Concept[];
  exact: Map<string, number[]>;
  singles: { key: string; script: boolean; concept: number }[];
} | null = null;

function compileDictionary(entries: DictEntry[]) {
  const concepts: Concept[] = [];
  const exact = new Map<string, number[]>();
  const singles: { key: string; script: boolean; concept: number }[] = [];
  const put = (key: string, c: number) => {
    const list = exact.get(key);
    if (!list) exact.set(key, [c]);
    else if (!list.includes(c)) list.push(c);
  };
  for (const entry of entries) {
    const targets: Token[][] = [];
    for (const english of [entry.en, ...(entry.also ?? [])]) {
      const toks = tokensOfClean(cleanText(english));
      if (toks.length) targets.push(toks);
    }
    if (!targets.length) continue;
    const c = concepts.length;
    concepts.push({ en: entry.en, targets });
    for (const alias of [entry.en, ...entry.aliases]) {
      const toks = tokensOfClean(cleanText(alias));
      if (!toks.length || toks.length > 3) continue;
      put(keyOfTokens(toks), c);
      if (toks.length > 1) put(toks.map((t) => t.fold).join(''), c); // "kiri pitti" is also typed "kiripitti"
      if (toks.length === 1) singles.push({ key: toks[0].fold, script: toks[0].script, concept: c });
    }
  }
  return { concepts, exact, singles };
}

const dictionary = () => (compiled ??= compileDictionary(DICTIONARY));

const MAX_ALIAS_WORDS = 3;
const MAX_PREFIX_CONCEPTS = 6;

/** Dictionary readings of the words tok[from..from+len). */
function lookup(index: SearchIndex, toks: Token[], from: number, len: number): AliasHit[] {
  const d = dictionary();
  const span = toks.slice(from, from + len);
  const via = span.map((t) => t.text).join(' ');
  const hits: AliasHit[] = [];
  for (const c of d.exact.get(keyOfTokens(span)) ?? []) hits.push({ concept: c, via, mode: M_DICT, edits: 0 });
  if (hits.length || len !== 1) return hits;

  // a single word that is not a word of the catalogue may still be a part of a Singlish word or a misspelt one
  const t = span[0];
  if (index.vocab.has(t.raw)) return hits;
  const seen = new Set<number>();
  if (t.script) {
    if (t.raw.length >= 3) {
      for (const s of d.singles) {
        if (s.script && s.key.length > t.raw.length && s.key.startsWith(t.raw) && !seen.has(s.concept)) {
          seen.add(s.concept);
          hits.push({ concept: s.concept, via, mode: M_DICT_PREFIX, edits: 0 });
          if (hits.length >= MAX_PREFIX_CONCEPTS) break;
        }
      }
    }
    return hits;
  }
  if (/\d/.test(t.raw)) return hits;
  if (t.raw.length >= 4 && t.fold.length >= 3) {
    for (const s of d.singles) {
      if (!s.script && s.key.length > t.fold.length && s.key.startsWith(t.fold) && !seen.has(s.concept)) {
        seen.add(s.concept);
        hits.push({ concept: s.concept, via, mode: M_DICT_PREFIX, edits: 0 });
        if (hits.length >= MAX_PREFIX_CONCEPTS) break;
      }
    }
  }
  const limit = t.raw.length >= 5 ? editLimit(t.fold.length) : 0;
  if (limit > 0) {
    for (const s of d.singles) {
      if (s.script || seen.has(s.concept) || s.key.length < 4) continue;
      if (Math.abs(s.key.length - t.fold.length) > limit) continue;
      if (s.key[0] !== t.fold[0] && limit < 2) continue;
      const e = editDistance(t.fold, s.key, limit);
      if (e > 0 && e <= limit) {
        seen.add(s.concept);
        hits.push({ concept: s.concept, via, mode: M_DICT_FUZZY, edits: e });
      }
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ matching one query word */

interface QTok {
  raw: string;
  fold: string;
  script: boolean;
  numeric: boolean;
  /** typos allowed (0 for dictionary words, numbers, script) */
  limit: number;
  mode: number;
  edits: number;
}

const K_EXACT = 1;
const K_PHON = 2;
const K_PREFIX = 3;
const K_PHON_PREFIX = 4;
const K_FUZZY = 5;
const K_FUZZY_PREFIX = 6;

let outEdits = 0;

function matchKind(t: QTok, e: Entry): number {
  outEdits = 0;
  if (e.script !== t.script) return 0;
  if (e.key === t.raw) return K_EXACT;
  const tl = t.raw.length;
  if (t.script) return tl >= 2 && e.key.startsWith(t.raw) ? K_PREFIX : 0;
  if (t.numeric) return 0;
  if (t.fold.length >= 2 && e.fold === t.fold) return K_PHON;
  if (tl >= 2) {
    if (e.key.startsWith(t.raw)) return K_PREFIX;
    if (t.fold.length >= 2 && e.fold.startsWith(t.fold)) return K_PHON_PREFIX;
  }
  const limit = t.limit;
  if (limit === 0) return 0;
  const el = e.key.length;
  if (el > 40) return 0;
  if (limit < 2 && t.raw[0] !== e.key[0] && t.fold[0] !== e.fold[0]) return 0;
  if (Math.abs(el - tl) <= limit) {
    let d = editDistance(t.raw, e.key, limit);
    // the phonetic keys are shorter, so they get the (smaller) limit of their own length: shampoo is not samba
    const foldLimit = t.fold.length >= 6 ? Math.min(limit, editLimit(t.fold.length)) : 0;
    if (d > limit && foldLimit > 0 && (t.fold !== t.raw || e.fold !== e.key)) {
      const df = editDistance(t.fold, e.fold, foldLimit);
      if (df <= foldLimit) d = df;
    }
    if (d <= limit) {
      outEdits = d;
      return K_FUZZY;
    }
  }
  // typed word with a typo is the start of a longer word ("sugr" -> sugarcane)
  if (tl >= 4 && el > tl) {
    for (let len = tl - 1; len <= tl + 1; len++) {
      if (len < 3 || len >= el) continue;
      const d = editDistance(t.raw, e.key.slice(0, len), limit);
      if (d <= limit) {
        outEdits = d;
        return K_FUZZY_PREFIX;
      }
    }
  }
  return 0;
}

/** Score of one word hit, and the reason. Fuzzy kinds are never produced for dictionary words. */
function hitScore(mode: number, kind: number, edits: number, field: number): number {
  if (field === F_CODE) return kind === K_EXACT ? 340 : kind === K_PREFIX ? 330 : 0;
  const exactish = kind === K_EXACT || kind === K_PHON;
  if (mode === M_LITERAL) {
    if (field === F_NAME) {
      switch (kind) {
        case K_EXACT: return 800;
        case K_PHON: return 650;
        case K_PREFIX: return 600;
        case K_PHON_PREFIX: return 580;
        case K_FUZZY: return 500 - 25 * edits;
        default: return 480 - 25 * edits;
      }
    }
    if (field === F_CAT) {
      switch (kind) {
        case K_EXACT: return 330;
        case K_PHON: case K_PREFIX: return 320;
        case K_PHON_PREFIX: return 315;
        case K_FUZZY: return 300 - 20 * edits;
        default: return 290 - 20 * edits;
      }
    }
    switch (kind) {
      case K_EXACT: return 270;
      case K_PHON: return 260;
      case K_PREFIX: return 255;
      case K_PHON_PREFIX: return 250;
      case K_FUZZY: return 230 - 20 * edits;
      default: return 220 - 20 * edits;
    }
  }
  if (mode === M_DICT) {
    if (field === F_NAME) return exactish ? 700 : 650;
    if (field === F_CAT) return exactish ? 330 : 320;
    return exactish ? 270 : 255;
  }
  if (mode === M_DICT_PREFIX) {
    if (field === F_NAME) return exactish ? 560 : 540;
    return field === F_CAT ? 300 : 240;
  }
  // misspelt Singlish alias: below a real prefix hit
  const base = field === F_NAME ? 520 : field === F_CAT ? 290 : 230;
  return base - 20 * edits - (exactish ? 0 : 20);
}

const W_WORDS = 1;
const W_DICT = 2;
const W_PHON = 3;
const W_PREFIX = 4;
const W_FUZZY = 5;
const W_CAT = 6;
const W_DESC = 7;
const W_SKU = 8;
const WHY_NAMES: WhyKind[] = ['words', 'words', 'dictionary', 'phonetic', 'prefix', 'fuzzy', 'category', 'description', 'sku'];

function whyCode(mode: number, kind: number, field: number): number {
  if (field === F_CODE) return W_SKU;
  if (field === F_CAT) return W_CAT;
  if (field === F_DESC) return W_DESC;
  if (mode !== M_LITERAL) return W_DICT;
  if (kind === K_EXACT) return W_WORDS;
  if (kind === K_PHON) return W_PHON;
  if (kind === K_PREFIX || kind === K_PHON_PREFIX) return W_PREFIX;
  return W_FUZZY;
}

interface Hits { score: Float32Array; why: Uint8Array; edits: Uint8Array }

function wordHits(index: SearchIndex, t: QTok): Hits {
  const n = index.docs.length;
  const hits: Hits = { score: new Float32Array(n), why: new Uint8Array(n), edits: new Uint8Array(n) };
  const put = (doc: number, score: number, why: number, edits: number) => {
    if (score > hits.score[doc]) {
      hits.score[doc] = score;
      hits.why[doc] = why;
      hits.edits[doc] = edits;
    }
  };
  for (const e of index.entries) {
    const kind = matchKind(t, e);
    if (!kind) continue;
    const edits = kind >= K_FUZZY ? outEdits : t.mode === M_DICT_FUZZY ? t.edits : 0;
    for (const post of e.posts) {
      const field = post & 3;
      const s = hitScore(t.mode, kind, edits, field);
      if (s > 0) put(post >> 2, s, whyCode(t.mode, kind, field), edits);
    }
  }
  if (t.raw.length >= 3 && !t.script && index.codes.length) {
    for (const c of index.codes) {
      const kind = c.code === t.raw ? K_EXACT : c.code.startsWith(t.raw) ? K_PREFIX : 0;
      if (kind) put(c.doc, hitScore(t.mode, kind, 0, F_CODE), W_SKU, 0);
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ interpretations */

interface Interp {
  toks: QTok[];
  /** the cleaned term of this reading, words joined by a space (for the name-start checks) */
  key: string;
  dict: boolean;
  via?: string;
  edits: number;
}

const STOP = new Set(['and', 'of', 'for', 'with', 'a', 'an']);
const MAX_WORDS = 6;
const MAX_INTERPS = 10;

function qtok(index: SearchIndex, t: Token, mode: number, edits: number): QTok {
  const numeric = /^[0-9]+$/.test(t.raw);
  // a word the catalogue really has is not a typo: "rice" never reads as "rose", "milk" never as "milo"
  const limit = mode !== M_LITERAL || t.script || numeric || /\d/.test(t.raw) || index.vocab.has(t.raw) ? 0 : editLimit(t.raw.length);
  return { raw: t.raw, fold: t.fold, script: t.script, numeric, limit, mode, edits };
}

function interpretations(index: SearchIndex, toks: Token[]): Interp[] {
  const literal: Interp = { toks: toks.map((t) => qtok(index, t, M_LITERAL, 0)), key: toks.map((t) => t.raw).join(' '), dict: false, edits: 0 };
  const out: Interp[] = [literal];

  // at each position the longest dictionary span wins; every concept of that span is a choice
  type Choice = { len: number; hit: AliasHit | null };
  const options: Choice[][] = [];
  let any = false;
  for (let i = 0; i < toks.length; ) {
    let found: AliasHit[] = [];
    let len = 1;
    for (let l = Math.min(MAX_ALIAS_WORDS, toks.length - i); l >= 1; l--) {
      found = lookup(index, toks, i, l);
      if (found.length) { len = l; break; }
    }
    if (found.length) {
      any = true;
      options.push(found.map((hit) => ({ len, hit })));
    } else {
      options.push([{ len: 1, hit: null }]);
    }
    i += len;
  }
  if (!any) return out;

  const spanStart: number[] = [];
  {
    let at = 0;
    for (const opts of options) {
      spanStart.push(at);
      at += opts[0].len;
    }
  }
  const d = dictionary();
  const seen = new Set<string>([literal.key]);
  const build = (pos: number, tokens: QTok[], keys: string[], via: string[], edits: number) => {
    if (out.length >= MAX_INTERPS) return;
    if (pos === options.length) {
      const key = keys.join(' ');
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ toks: tokens, key, dict: true, via: via.join(' '), edits });
      return;
    }
    // position -> source word: options are per span, so recover the word index from the spans already used
    for (const choice of options[pos]) {
      if (!choice.hit) {
        const t = toks[spanStart[pos]];
        build(pos + 1, [...tokens, qtok(index, t, M_LITERAL, 0)], [...keys, t.raw], via, edits);
        continue;
      }
      const concept = d.concepts[choice.hit.concept];
      for (const target of concept.targets) {
        build(
          pos + 1,
          [...tokens, ...target.map((t) => qtok(index, t, choice.hit!.mode, choice.hit!.edits))],
          [...keys, ...target.map((t) => t.raw)],
          [...via, target.map((t) => t.text).join(' ')],
          edits + choice.hit.edits,
        );
      }
    }
  };
  build(0, [], [], [], 0);
  return out;
}

/* ------------------------------------------------------------------ searching */

/** Terms shorter than this (or without a single letter or digit) are not smart-searched. */
export const MIN_TERM = 2;

/** Rank the catalogue for `term`, best first. Never throws; '', one letter or only symbols return []. */
export function searchProducts(index: SearchIndex, term: string, opts: SearchOptions = {}): SearchResult[] {
  try {
    return run(index, term, opts);
  } catch {
    return [];
  }
}

function run(index: SearchIndex, term: string, opts: SearchOptions): SearchResult[] {
  const clean = cleanText(term);
  if (clean.length < MIN_TERM || !index.docs.length) return [];
  let toks = tokensOfClean(clean);
  const kept = toks.filter((t) => !STOP.has(t.raw));
  if (kept.length) toks = kept;
  if (!toks.length) return [];
  if (toks.length === 1 && toks[0].text.length < MIN_TERM) return [];
  toks = toks.slice(0, MAX_WORDS);

  let catId: string | null = null;
  if (opts.categorySlug) {
    catId = index.categoryIdBySlug.get(opts.categorySlug) ?? null;
    if (!catId) return [];
  }

  const n = index.docs.length;
  const cache = new Map<string, Hits>();
  const best = new Float32Array(n);
  const bestWhy: SearchWhy[] = new Array(n);

  for (const interp of interpretations(index, toks)) {
    const hits = interp.toks.map((t) => {
      const k = `${t.raw}|${t.mode}|${t.edits}`;
      let h = cache.get(k);
      if (!h) {
        h = wordHits(index, t);
        cache.set(k, h);
      }
      return h;
    });
    const count = hits.length;
    for (let d = 0; d < n; d++) {
      let min = Infinity;
      let sum = 0;
      let minAt = 0;
      for (let k = 0; k < count; k++) {
        const s = hits[k].score[d];
        if (s <= 0) { min = 0; break; }
        sum += s;
        if (s < min) { min = s; minAt = k; }
      }
      if (min <= 0 || !Number.isFinite(min)) continue;
      let score = min + 0.15 * (sum / count - min);
      const nameKey = index.docs[d].nameKey;
      let kind: WhyKind = WHY_NAMES[hits[minAt].why[d]];
      let edits = hits[minAt].edits[d];
      if (!interp.dict) {
        if (nameKey === interp.key) { score = 1000; kind = 'exact'; edits = 0; }
        else if (score >= 600 && nameKey.startsWith(interp.key)) {
          if (nameKey.charCodeAt(interp.key.length) === 32) { score = Math.max(score, 900); kind = 'name-start'; } // "sugar" -> "Sugar Cane Juice"
          else { score = Math.max(score, 780); kind = 'prefix'; } // "sugar" -> "Sugary Cereal", "sug" -> "Sugar": typed so far
          edits = 0;
        }
      } else if (score >= 650) {
        if (nameKey === interp.key) score = Math.max(score, 760);
        else if (nameKey.startsWith(interp.key) && nameKey.charCodeAt(interp.key.length) === 32) score = Math.max(score, 740);
      }
      score = Math.round(score);
      if (score > best[d]) {
        best[d] = score;
        const why: SearchWhy = { kind };
        if (interp.dict && (kind === 'dictionary' || kind === 'category' || kind === 'description')) why.via = interp.via;
        if (edits) why.edits = edits;
        else if (interp.edits) why.edits = interp.edits;
        bestWhy[d] = why;
      }
    }
  }

  const out: SearchResult[] = [];
  for (let d = 0; d < n; d++) {
    if (best[d] <= 0) continue;
    const doc = index.docs[d];
    if (catId && !doc.catIds.includes(catId)) continue;
    out.push({ product: doc.product, score: best[d], why: bestWhy[d] });
  }
  const now = new Date();
  const price = new Map<string, number>();
  const priceOf = (p: Product) => {
    let v = price.get(p.id);
    if (v === undefined) { v = effectivePrice(p, now); price.set(p.id, v); }
    return v;
  };
  out.sort((a, b) =>
    b.score - a.score
    || Number(b.product.is_available) - Number(a.product.is_available)
    || priceOf(a.product) - priceOf(b.product)
    || (a.product.name < b.product.name ? -1 : a.product.name > b.product.name ? 1 : 0));
  return opts.limit != null && opts.limit >= 0 ? out.slice(0, opts.limit) : out;
}
