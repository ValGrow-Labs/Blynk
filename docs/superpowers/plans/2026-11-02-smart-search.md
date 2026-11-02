# Smart search for the customer app (contract)

Owner's brother, 2026-11-02 (WhatsApp): "We need to put AI for search. Some people might search for Sugar by typing *seeni*" and then the same word in Sinhala (සීනි) and Tamil
(சீனி) "as well", "typos and things will come". Today search is the server's `ILIKE '%term%'` on name, description, sku and barcode
(`GET /catalog/products?search=`, `backend/api/src/modules/catalog/catalog.repository.ts`), so "seeni", "සීනි", "சீனி" or "sugr" find nothing.

Decision of the lead: a **deterministic, offline smart search inside the customer app** (no server change, no migration, no paid AI call, instant):
the app already loads the whole catalogue (`useCatalog().data.products`, `categories`), so the search runs on it. (An LLM fallback for the rare miss can come later
as an optional server feature; not in this task.)

## What it must do
Given a typed term, return the catalogue products ranked best first, finding:
1. **Plain English**, as today: name / category name / description / sku / barcode contain the words (all words must match, any order), prefix matches ("sug" -> Sugar).
2. **Typos**: one or two wrong, missing, extra or swapped letters ("sugr", "suger", "shugar", "chiken", "bisquit", "milkpowder" vs "milk powder", "anhor" -> Anchor):
   edit distance (Damerau-Levenshtein) limited by word length (0 for < 4 letters, 1 for 4-6, 2 for 7+), only against whole words and word prefixes, never producing
   absurd matches (short words stay exact/prefix).
3. **Sinhala and Tamil in English letters (Singlish / Tanglish)**: "seeni", "sini", "seni", "heeni" -> sugar; "paan"/"pan" -> bread; "kiri"/"kiri pitti" -> milk / milk powder;
   "haal"/"hal"/"bath"/"nadu"/"samba"/"keeri samba" -> rice varieties; "parippu"/"paruppu" -> dhal; "lunu" -> salt (and *not* onion; onions are "loku lunu"/"rathu lunu"/
   "bombay"); "sudu lunu"/"poondu" -> garlic; "ala"/"urulai" -> potato; "pol"/"thenga" -> coconut; "thel"/"ennai" -> oil; "kukul mas"/"kozhi" -> chicken; "malu"/"meen" -> fish;
   "biththara"/"muttai" -> egg; "thé"/"theh"/"tea"/"chai"; "kola"/"keera" -> leafy greens; "miris"/"milagai" -> chilli; "kottamalli"/"malli" -> coriander; "uru"... use only words
   you are confident about; the list is data, not code.
4. **Sinhala and Tamil script**: "සීනි", "සීනී", "චීනි" (variants), "சீனி", "சக்கரை" -> sugar, and the same for the rest of the dictionary. Normalise Unicode (NFC, strip zero-width
   joiners/non-joiners, collapse repeated vowel signs) before matching so keyboard variants match.
5. **Phonetic folding for romanised words**: compare a folded key so that spellings of the same sound meet: lowercase, strip diacritics, `th->t`, `dh->d`, `sh/ch/ss->s` rules that
   are safe, `w<->v`, `ee->i`, `oo->u`, `aa->a`, doubled letters collapsed, trailing `h` dropped, `ph->f`, `c->k/s` where unambiguous. Apply to BOTH the typed word and to product-name words
   and dictionary entries (build the folded keys once per catalogue, not per keystroke).
6. **Category words**: a category name or its synonyms matches all the products in it ("rice", "baby", "diapers"/"pampers" -> diapers, "soap", "shampoo").
7. Ranking (best first): exact full-name match > name starts with the term > all words are whole-word hits in the name > dictionary/synonym hit on the name > prefix hits >
   fuzzy hits (fewer edits first) > description/category/sku hits; ties by in-stock first (`is_available`), then offer price lower, then name. Keep it a pure function that returns
   `{ product, score, why }` so tests can pin the order.
8. Empty or one-letter terms return nothing (the screen keeps its current behaviour for those). A term made only of symbols returns nothing. Never throws on any input
   (very long strings are truncated to 60 characters, emoji and control characters are ignored).

## Files (all in apps/customer-app; read AGENTS.md and docs/superpowers/plans/2026-11-01-customer-app-native.md first; the app also runs as a web PWA: keep it working)
* `src/blynk/search/dictionary.ts`: the synonym data. Entries `{ en: 'sugar', aliases: ['seeni','sini','heeni','සීනි','சீனி','சக்கரை', ...], note? }`. Group by theme (staples,
  dairy, bread, vegetables, fruit, meat/fish/egg, spices, oils, drinks, snacks, baby, household, personal care). Aim for 250+ entries that matter in a Sri Lankan grocery
  (Aluthgama / Beruwala): the words customers actually type. Put a `// NATIVE REVIEW` marker on any entry whose Sinhala or Tamil spelling you are not certain about, and write the list of those
  to `docs/research/search-dictionary-review.md` (a plain table: English, Singlish, Sinhala, Tamil, status) so the owner's brother can check it. Do not invent words: leave it out when unsure.
* `src/blynk/search/normalize.ts`: Unicode / Sinhala / Tamil normalisation, tokenising, the phonetic fold.
* `src/blynk/search/smartSearch.ts`: `buildSearchIndex(products, categories)` (pure, memoisable) and `searchProducts(index, term, opts?)` (`opts.categorySlug`, `opts.limit`).
* Tests (vitest, Node only, `src/blynk/search/*.test.ts`): the brother's examples ("seeni", "සීනි", "சீனி", "sugar", "sugr", "suger", "sini", "shugar" all find Sugar products first),
  typo tolerance and its limits (no match for "xyz", no match for "ab" -> "apple"), singlish for the 20 commonest items, script variants, category words, ranking order, in-stock
  tie-break, the category filter, empty/garbage/very long input, a catalogue of 2,000 products searched in well under 20 ms per call after the index is built (assert a generous bound).
  Build test products as plain objects (name, category, description, sku, availability, price).
* Wire it into `src/app/search.tsx`: when the catalogue is loaded (`useCatalog().data`), results come from `searchProducts` over it (instant, no network); the existing pagination
  UI keeps working over the ranked list (slice of 40 per "page"); when the catalogue is not loaded yet (cold start, offline without cache) fall back to today's API call. Keep recent
  searches, the category slug filter, analytics tracking and the empty/no-results states exactly as they are. If a search found something only through a synonym or typo, show
  nothing extra by default (no "did you mean" UI in this task) but expose `why` for later. Home's search bar hints and the Home "Ask us" flow stay as they are.
* Also make the same function available to the product-request "Can't find it? Ask us" prompt only if it is a one-line reuse; otherwise leave it.

## Rules
Do not touch backend/api, package.json, app.json or android/. No new dependency (write the edit-distance yourself). Do not commit or push. Run `npx tsc --noEmit` and the whole
`npx vitest run --testTimeout=120000` before reporting. Line endings: preserve each existing file's. Report: files changed, how many dictionary entries per theme, the entries marked for
native review, search timings, what the screen does when the catalogue is not loaded, anything that could not be satisfied.
