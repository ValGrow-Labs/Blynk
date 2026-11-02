import { describe, expect, it } from 'vitest';
import { category, GROCERY, product } from '../test/searchFixtures';
import { buildSearchIndex, editDistance, hasCategory, searchIndexFor, searchProducts } from './smartSearch';

const index = buildSearchIndex(GROCERY, []);
const names = (term: string, opts?: Parameters<typeof searchProducts>[2]) => searchProducts(index, term, opts).map((r) => r.product.name);
const top = (term: string, n = 1) => names(term).slice(0, n);
const SUGARS = ['Brown Sugar 500g', 'Sugar Free Sweetener', 'White Sugar 1KG'];

describe('the brother\'s examples: every way to type sugar finds Sugar first', () => {
  for (const term of ['sugar', 'seeni', 'සීනි', 'சீனி', 'sugr', 'suger', 'sini', 'shugar', 'සීනී', 'චීනි', 'සිනි', 'சக்கரை', 'heeni', 'seni', 'SUGAR', ' Sugar ']) {
    it(`"${term}"`, () => {
      const found = names(term);
      // the three products named sugar come before anything else that might match
      expect(found.slice(0, 3).sort()).toEqual(SUGARS);
      expect(found.slice(0, 3).filter((n) => /sugar/i.test(n))).toHaveLength(3);
      expect(found.slice(3).filter((n) => /sugar/i.test(n))).toHaveLength(0);
    });
  }
});

describe('plain English', () => {
  it('matches every word in any order', () => {
    expect(top('powder milk')).toEqual(['Anchor Full Cream Milk Powder 400g']);
    expect(names('white 1kg')).toContain('White Sugar 1KG');
    expect(names('1kg white')).toContain('White Sugar 1KG');
  });
  it('matches prefixes', () => {
    expect(top('sug', 3).sort()).toEqual(SUGARS);
    expect(top('biscu')).toEqual(['Biscuits Cream Cracker 190g']);
  });
  it('matches the category name and the description', () => {
    expect(names('diapers')).toContain('Huggies Wonder Pants L 40s');
    expect(names('dryness')).toEqual(['Huggies Wonder Pants L 40s']);
  });
  it('matches plurals both ways', () => {
    expect(names('eggs')).toContain('Egg White 10');
    expect(names('tomatoes')).toContain('Tomato 500g');
    expect(names('banana')).toContain('Banana 1KG');
  });
  it('finds a glued word and a split word', () => {
    expect(top('milkpowder')).toEqual(['Anchor Full Cream Milk Powder 400g']);
    expect(top('cornflakes')).toEqual(['Kellogs Cornflakes 250g']);
    expect(top('corn flakes')).toEqual(['Kellogs Cornflakes 250g']);
  });
});

describe('typos', () => {
  it('finds one wrong, missing, extra or swapped letter', () => {
    expect(top('chiken', 2)).toEqual(expect.arrayContaining(['Whole Chicken 1KG']));
    expect(top('bisquit')).toEqual(['Biscuits Cream Cracker 190g']);
    expect(top('anhor')).toEqual(['Anchor Full Cream Milk Powder 400g']);
    expect(top('suagr', 3).sort()).toEqual(SUGARS);
    expect(top('potatoo')).toEqual(['Potato 1KG']);
    expect(top('banan')).toEqual(['Banana 1KG']);
    expect(names('tomatto')).toContain('Tomato 500g');
  });
  it('allows two typos only in long words', () => {
    expect(names('pinaple')).toContain('Pineapple');
    expect(names('cornflaks')).toContain('Kellogs Cornflakes 250g');
    expect(names('pineple')).toContain('Pineapple'); // 2 edits, 7 letters
    expect(names('pinple')).not.toContain('Pineapple'); // 6 letters: only 1 edit
  });
  it('never produces absurd matches', () => {
    expect(names('xyz')).toEqual([]);
    expect(names('ab')).not.toContain('Apple Red 4pcs');
    expect(names('ap')).toContain('Apple Red 4pcs'); // a prefix is still a prefix
    expect(names('mlk')).toEqual([]); // 3 letters: exact or prefix only
    expect(names('qqqqqqqq')).toEqual([]);
    expect(names('zzzz')).toEqual([]);
    expect(names('sugx')).not.toContain('Salt Iodised 400g');
  });
});

describe('Singlish and Tanglish', () => {
  const cases: [string, string][] = [
    ['seeni', 'White Sugar 1KG'],
    ['paan', 'Sliced Bread 450g'],
    ['pan bread', 'Sliced Bread 450g'],
    ['kiri', 'Kotmale Fresh Milk 1L'],
    ['kiri pitti', 'Anchor Full Cream Milk Powder 400g'],
    ['haal', 'Nadu Rice 5KG'],
    ['hal', 'Red Raw Rice 5KG'],
    ['nadu', 'Nadu Rice 5KG'],
    ['samba', 'Samba Rice 1KG'],
    ['keeri samba', 'Keeri Samba Rice 5KG'],
    ['parippu', 'Masoor Dhal 1KG'],
    ['paruppu', 'Masoor Dhal 1KG'],
    ['lunu', 'Salt Iodised 400g'],
    ['loku lunu', 'Big Onion 1KG'],
    ['rathu lunu', 'Red Onion 500g'],
    ['sudu lunu', 'Garlic 250g'],
    ['poondu', 'Garlic 250g'],
    ['ala', 'Potato 1KG'],
    ['urulai', 'Potato 1KG'],
    ['pol', 'Coconut'],
    ['thenga', 'Coconut'],
    ['pol thel', 'Coconut Oil 750ml'],
    ['thel', 'Sunflower Oil 1L'],
    ['ennai', 'Coconut Oil 750ml'],
    ['kukul mas', 'Whole Chicken 1KG'],
    ['kozhi', 'Whole Chicken 1KG'],
    ['malu', 'Fresh Tuna 500g'],
    ['meen', 'Fresh Tuna 500g'],
    ['biththara', 'Egg White 10'],
    ['muttai', 'Egg White 10'],
    ['the', 'Ceylon Tea 200g'],
    ['theh', 'Ceylon Tea 200g'],
    ['chai', 'Ceylon Tea 200g'],
    ['thé', 'Ceylon Tea 200g'],
    ['kopi', 'Nescafe Coffee 100g'],
    ['miris', 'Red Chilli Powder 100g'],
    ['milagai', 'Green Chilli 250g'],
    ['kottamalli', 'Coriander Powder 100g'],
    ['malli', 'Coriander Powder 100g'],
    ['thakkali', 'Tomato 500g'],
    ['amba', 'Fresh Mango 1KG'],
    ['kesel', 'Banana 1KG'],
    ['annasi', 'Pineapple'],
    ['saban', 'Lux Soap Rose 100g'],
    ['pampers', 'Huggies Wonder Pants L 40s'],
    ['thirigu piti', 'Prima Wheat Flour 1KG'],
  ];
  for (const [term, expected] of cases) {
    it(`"${term}" finds ${expected}`, () => {
      expect(names(term).slice(0, 6)).toContain(expected);
    });
  }

  it('"lunu" is salt and not onion', () => {
    const found = names('lunu');
    expect(found).toContain('Salt Iodised 400g');
    expect(found).toContain('Rock Salt 1KG');
    expect(found).not.toContain('Big Onion 1KG');
    expect(found).not.toContain('Red Onion 500g');
    expect(found).not.toContain('Garlic 250g');
  });
  it('onions are loku lunu, rathu lunu and bombay', () => {
    for (const term of ['loku lunu', 'rathu lunu', 'bombay']) {
      const found = names(term);
      expect(found).toEqual(expect.arrayContaining(['Big Onion 1KG', 'Red Onion 500g']));
      expect(found).not.toContain('Salt Iodised 400g');
    }
  });
  it('rice words find the rice', () => {
    for (const term of ['haal', 'hal', 'bath', 'arisi']) {
      expect(names(term)).toEqual(expect.arrayContaining(['Nadu Rice 5KG', 'Samba Rice 1KG', 'Keeri Samba Rice 5KG']));
    }
  });
  it('a Singlish word typed with a typo or a partial word still reads right', () => {
    expect(names('seenii')).toContain('White Sugar 1KG');
    expect(names('kukulmas')).toContain('Whole Chicken 1KG');
    expect(names('kiripitti')).toContain('Anchor Full Cream Milk Powder 400g');
    expect(names('poondoo')).toContain('Garlic 250g');
    expect(names('seen')).toContain('White Sugar 1KG'); // typing seeni
  });
  it('mixes with ordinary words', () => {
    expect(top('seeni 1kg')).toEqual(['White Sugar 1KG']);
    expect(top('kiri pitti 400g')).toEqual(['Anchor Full Cream Milk Powder 400g']);
  });
});

describe('Sinhala and Tamil script', () => {
  const cases: [string, string][] = [
    ['සීනි', 'White Sugar 1KG'],
    ['සිනි', 'White Sugar 1KG'],
    ['චීනි', 'White Sugar 1KG'],
    ['சீனி', 'White Sugar 1KG'],
    ['சர்க்கரை', 'White Sugar 1KG'],
    ['ලුණු', 'Salt Iodised 400g'],
    ['ලූණු', 'Big Onion 1KG'],
    ['හාල්', 'Nadu Rice 5KG'],
    ['அரிசி', 'Nadu Rice 5KG'],
    ['පාන්', 'Sliced Bread 450g'],
    ['பாண்', 'Sliced Bread 450g'],
    ['කිරි', 'Kotmale Fresh Milk 1L'],
    ['பால்', 'Kotmale Fresh Milk 1L'],
    ['කිරි පිටි', 'Anchor Full Cream Milk Powder 400g'],
    ['பால் மா', 'Anchor Full Cream Milk Powder 400g'],
    ['පරිප්පු', 'Masoor Dhal 1KG'],
    ['பருப்பு', 'Masoor Dhal 1KG'],
    ['බිත්තර', 'Egg White 10'],
    ['முட்டை', 'Egg White 10'],
    ['කුකුල් මස්', 'Whole Chicken 1KG'],
    ['கோழி', 'Whole Chicken 1KG'],
    ['අල', 'Potato 1KG'],
    ['உருளைக்கிழங்கு', 'Potato 1KG'],
    ['තක්කාලි', 'Tomato 500g'],
    ['தக்காளி', 'Tomato 500g'],
    ['පොල්', 'Coconut'],
    ['தேங்காய்', 'Coconut'],
    ['තේ', 'Ceylon Tea 200g'],
    ['தேநீர்', 'Ceylon Tea 200g'],
    ['සබන්', 'Lux Soap Rose 100g'],
  ];
  for (const [term, expected] of cases) {
    it(`${term} finds ${expected}`, () => {
      expect(names(term).slice(0, 8)).toContain(expected);
    });
  }
  it('script variants meet: ZWJ, doubled vowel signs, long and short vowels', () => {
    expect(top('සීීනි', 3).sort()).toEqual(SUGARS);
    expect(top('ස‍ීනි', 3).sort()).toEqual(SUGARS);
    expect(top('சீ‌னி', 3).sort()).toEqual(SUGARS);
    expect(names('සීන')).toContain('White Sugar 1KG'); // typing the start of සීනි
  });
  it('salt does not find onions and onions do not find salt', () => {
    expect(names('ලුණු')).not.toContain('Big Onion 1KG');
    expect(names('ලූණු')).not.toContain('Salt Iodised 400g');
  });
  it('script is never fuzzy: an unknown script word finds nothing', () => {
    expect(names('කෝකෝකෝ')).toEqual([]);
  });
});

describe('category words and synonyms', () => {
  it('finds everything in a category by its name or a synonym', () => {
    expect(names('rice')).toEqual(expect.arrayContaining(['Nadu Rice 5KG', 'Red Raw Rice 5KG']));
    expect(names('diapers')).toEqual(['Huggies Wonder Pants L 40s']);
    expect(names('diaper')).toEqual(['Huggies Wonder Pants L 40s']);
    expect(names('pampers')).toEqual(['Huggies Wonder Pants L 40s']);
    expect(names('nappies')).toEqual(['Huggies Wonder Pants L 40s']);
    expect(names('baby')).toEqual(expect.arrayContaining(['Baby Wipes 80s', 'Huggies Wonder Pants L 40s']));
    expect(top('shampoo')).toEqual(['Head and Shoulders Shampoo 180ml']);
    expect(names('shampoo')).toEqual(['Head and Shoulders Shampoo 180ml']);
    expect(names('soap')).toEqual(expect.arrayContaining(['Sunlight Soap 100g', 'Lux Soap Rose 100g']));
  });
  it('ranks a name hit above a category-only hit', () => {
    const r = searchProducts(index, 'baby');
    const wipes = r.findIndex((x) => x.product.name === 'Baby Wipes 80s');
    const pants = r.findIndex((x) => x.product.name === 'Huggies Wonder Pants L 40s');
    expect(wipes).toBeLessThan(pants);
    expect(r[pants].why.kind).toBe('description'); // only its description says baby
    // "kitchen" is only the category of the frying pan: a category hit
    expect(searchProducts(index, 'kitchen')).toMatchObject([{ product: { name: 'Non-stick Frying Pan 24cm' }, why: { kind: 'category' } }]);
  });
  it('uses the category tree: a parent category name finds the sub-category products', () => {
    const grocery = category('Grocery');
    const rice = category('Rice', grocery);
    const p = product('Nadu 5KG', { category: 'Rice', category_id: rice.id });
    const idx = buildSearchIndex([p, product('Soap Bar', { category: 'Soap' })], [grocery, rice]);
    expect(searchProducts(idx, 'grocery').map((r) => r.product.name)).toEqual(['Nadu 5KG']);
  });
});

describe('ranking', () => {
  const items = [
    product('Sugar', { price: 300 }), // exact
    product('Sugar Cane Juice 250ml', { price: 100 }), // name starts with
    product('Organic White Sugar 1KG', { price: 90 }), // whole word, not at the start
    product('Sugary Cereal 300g', { price: 80 }), // the name starts with the letters, but it is a longer word
    product('Mints', { price: 60, description: 'a sugar free mint' }), // description only
  ];
  const idx = buildSearchIndex(items, []);

  it('orders: exact > starts with > whole words > longer word > description', () => {
    const r = searchProducts(idx, 'sugar');
    expect(r.map((x) => x.product.name)).toEqual([
      'Sugar',
      'Sugar Cane Juice 250ml',
      'Organic White Sugar 1KG',
      'Sugary Cereal 300g',
      'Mints',
    ]);
    expect(r.map((x) => x.why.kind)).toEqual(['exact', 'name-start', 'words', 'prefix', 'description']);
    expect(r[3].score).toBe(780);
    expect(r[4].score).toBe(270);
    const scores = r.map((x) => x.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r[0].score).toBe(1000);
    expect(r[1].score).toBe(900);
    expect(r[2].score).toBe(800);
  });

  it('puts a dictionary hit on the name between whole words and prefix hits', () => {
    const r = searchProducts(idx, 'seeni');
    expect(r.map((x) => x.product.name).slice(0, 4)).toEqual([
      'Sugar',
      'Sugar Cane Juice 250ml',
      'Organic White Sugar 1KG',
      'Sugary Cereal 300g',
    ]);
    expect(r[0].why).toMatchObject({ kind: 'dictionary', via: 'sugar' });
    expect(r[0].score).toBe(760);
    expect(r[2].score).toBeGreaterThanOrEqual(700);
    expect(r[2].score).toBeLessThan(800);
    expect(r[3].score).toBeLessThan(700);
    expect(r[3].score).toBeGreaterThanOrEqual(600);
  });

  it('ranks typos below real hits, and a word the catalogue has is never read as a typo', () => {
    const fz = searchProducts(idx, 'sugxr'); // not a catalogue word: one wrong letter
    expect(fz.map((x) => x.product.name)).toContain('Sugar');
    expect(fz.every((x) => ['fuzzy', 'dictionary', 'description'].includes(x.why.kind))).toBe(true);
    expect(fz[0].score).toBeLessThanOrEqual(500);
    expect(fz[0].score).toBeGreaterThan(400);
    const mi = buildSearchIndex([product('Milk 1L'), product('Milo 400g'), product('Rose Soap'), product('Rice 1KG')], []);
    expect(searchProducts(mi, 'milk').map((x) => x.product.name)).toEqual(['Milk 1L']);
    expect(searchProducts(mi, 'rice').map((x) => x.product.name)).toEqual(['Rice 1KG']);
    expect(searchProducts(mi, 'milc').map((x) => x.product.name)).toContain('Milk 1L');
  });

  it('puts one typo above two typos', () => {
    const idx2 = buildSearchIndex([product('Marmaite Pack'), product('Marmite Jar'), product('Mango Jam')], []);
    // typed "marmyte" (not a catalogue word): Marmite is 1 edit away, Marmaite 2
    const r = searchProducts(idx2, 'marmyte');
    expect(r.map((x) => x.product.name)).toEqual(['Marmite Jar', 'Marmaite Pack']);
    expect(r.map((x) => x.why.edits)).toEqual([1, 2]);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('breaks ties by stock, then price, then name', () => {
    const tie = buildSearchIndex([
      product('Rice Gone', { price: 100, is_available: false }),
      product('Rice Dear', { price: 300 }),
      product('Rice Cheap B', { price: 100 }),
      product('Rice Cheap A', { price: 100 }),
      product('Rice Offer', { price: 400, offer_price: 50 }),
    ], []);
    const r = searchProducts(tie, 'rice');
    expect(r.every((x) => x.score === r[0].score)).toBe(true);
    expect(r.map((x) => x.product.name)).toEqual(['Rice Offer', 'Rice Cheap A', 'Rice Cheap B', 'Rice Dear', 'Rice Gone']);
  });

  it('returns { product, score, why } and honours limit', () => {
    const r = searchProducts(idx, 'sugar', { limit: 2 });
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ product: items[0], score: 1000, why: { kind: 'exact' } });
  });
});

describe('category filter', () => {
  const grocery = category('Grocery');
  const rice = category('Rice', grocery);
  const dairy = category('Dairy');
  const inRice = product('Sugar Rice Crispy', { category: 'Rice', category_id: rice.id });
  const inDairy = product('Sugar Milk', { category: 'Dairy', category_id: dairy.id });
  const extra = product('Sugar Gift Box', { category: 'Dairy', category_id: dairy.id, extra_category_ids: [rice.id] });
  const idx = buildSearchIndex([inRice, inDairy, extra], [grocery, rice, dairy]);

  it('limits results to a category and its sub-categories, extra categories included', () => {
    expect(searchProducts(idx, 'sugar', { categorySlug: 'rice' }).map((r) => r.product.name).sort()).toEqual(['Sugar Gift Box', 'Sugar Rice Crispy']);
    expect(searchProducts(idx, 'sugar', { categorySlug: 'grocery' }).map((r) => r.product.name).sort()).toEqual(['Sugar Gift Box', 'Sugar Rice Crispy']);
    expect(searchProducts(idx, 'sugar', { categorySlug: 'dairy' }).map((r) => r.product.name).sort()).toEqual(['Sugar Gift Box', 'Sugar Milk']);
    expect(searchProducts(idx, 'sugar').length).toBe(3);
  });
  it('an unknown category returns nothing and hasCategory says so', () => {
    expect(searchProducts(idx, 'sugar', { categorySlug: 'nope' })).toEqual([]);
    expect(hasCategory(idx, 'rice')).toBe(true);
    expect(hasCategory(idx, 'nope')).toBe(false);
  });
});

describe('empty, garbage and huge input', () => {
  it('returns nothing for empty, one letter and symbols', () => {
    for (const t of ['', ' ', 'a', 'z', '1', '!!', '???', '#$%^&*', '😀', '😀😀😀', '\u0000\u0001', '\n\t', '-', '"']) {
      expect(searchProducts(index, t)).toEqual([]);
    }
  });
  it('never throws', () => {
    const weird = [
      undefined, null, 5, {}, [], '\uD800', '\uDC00x', 'a\u0000b', '‍', 'ස්‍රී', 'x'.repeat(100000), '🍬'.repeat(500),
      '%', '\\', '(', '[', '*', '.*', '$1', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '́', '්්',
    ];
    for (const t of weird) expect(() => searchProducts(index, t as unknown as string)).not.toThrow();
    expect(Array.isArray(searchProducts(index, '__proto__'))).toBe(true);
  });
  it('truncates very long input to 60 characters', () => {
    const long = `sugar ${'x'.repeat(5000)}`;
    expect(() => searchProducts(index, long)).not.toThrow();
    expect(names(long)).toEqual([]); // "xxxx..." is a word nothing contains
    expect(names(`sugar${' '.repeat(100)}`).length).toBeGreaterThan(0);
    // anything past 60 characters is ignored: the 61st word never has to match
    const sixty = 'sugar '.repeat(10); // 60 characters
    expect(names(`${sixty}white white white white`)).toEqual(names(sixty));
  });
  it('ignores emoji and control characters inside a term', () => {
    expect(names('su😀gar')).toEqual(names('su gar'));
    expect(names('sugar 😀')).toEqual(names('sugar'));
    expect(names('sugar\u0000')).toEqual(names('sugar'));
  });
  it('an empty catalogue finds nothing', () => {
    expect(searchProducts(buildSearchIndex([], []), 'sugar')).toEqual([]);
  });
});

describe('edit distance', () => {
  it('counts insert, delete, substitute and adjacent swap as one', () => {
    expect(editDistance('sugar', 'sugar', 2)).toBe(0);
    expect(editDistance('sugr', 'sugar', 2)).toBe(1);
    expect(editDistance('suger', 'sugar', 2)).toBe(1);
    expect(editDistance('sugarr', 'sugar', 2)).toBe(1);
    expect(editDistance('suagr', 'sugar', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 2)).toBe(3);
    expect(editDistance('', 'ab', 2)).toBe(2);
    expect(editDistance('', 'abc', 2)).toBe(3);
  });
});

describe('memoised index', () => {
  it('is rebuilt only when the catalogue changes', () => {
    const cats = [category('Groceries')];
    const a = searchIndexFor(GROCERY, cats);
    expect(searchIndexFor(GROCERY, cats)).toBe(a);
    expect(searchIndexFor([...GROCERY], cats)).not.toBe(a);
  });
});

describe('speed', () => {
  const WORDS = ['Sugar', 'Rice', 'Milk', 'Powder', 'Anchor', 'Kotmale', 'Prima', 'Flour', 'Nadu', 'Samba', 'Dhal', 'Salt', 'Onion', 'Garlic', 'Soap', 'Lux',
    'Sunlight', 'Shampoo', 'Coconut', 'Oil', 'Chicken', 'Fish', 'Tuna', 'Tea', 'Coffee', 'Chilli', 'Biscuit', 'Cracker', 'Banana', 'Mango', 'Apple', 'Baby',
    'Diaper', 'Wipes', 'Cereal', 'Juice', 'Jam', 'Butter', 'Cheese', 'Yoghurt', 'Pasta', 'Noodles', 'Maggi', 'Munchee', 'Elephant', 'House', 'Ginger', 'Beer',
    'Red', 'White', 'Brown', 'Green', 'Fresh', 'Organic', 'Premium', 'Classic', 'Gold', 'Super', '500g', '1KG', '250ml', '1L', '5KG'];
  const big = Array.from({ length: 2000 }, (_, i) => {
    const w = (k: number) => WORDS[(i * 7 + k * 13 + (i >> 3)) % WORDS.length];
    return product(`${w(0)} ${w(1)} ${w(2)} ${i}`, {
      category: ['Groceries', 'Dairy', 'Beverages', 'Vegetables', 'Baby Care', 'Soap'][i % 6], price: 50 + (i % 400),
      description: i % 3 === 0 ? `${w(3)} ${w(4)} for every day, the best ${w(5)}` : null,
    });
  });
  it('builds the index and searches 2,000 products well under 20 ms per call', () => {
    const t0 = performance.now();
    const idx = buildSearchIndex(big, []);
    const build = performance.now() - t0;
    expect(build).toBeLessThan(2000);
    const terms = ['sugar', 'seeni', 'සීනි', 'சீனி', 'sugr', 'shugar', 'kiri pitti', 'rathu lunu', 'milkpowder', 'anhor', 'pampers', 'chiken', 'xyz', 'bis', 'red onion 1kg', 'a very long search term about nothing'];
    for (const t of terms) searchProducts(idx, t); // warm up
    let worst = 0;
    let total = 0;
    let calls = 0;
    for (let round = 0; round < 5; round++) {
      for (const t of terms) {
        const s = performance.now();
        searchProducts(idx, t);
        const d = performance.now() - s;
        worst = Math.max(worst, d);
        total += d;
        calls++;
      }
    }
    console.info(`smart search: build ${build.toFixed(1)} ms, mean ${(total / calls).toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${calls} calls (2,000 products)`);
    expect(total / calls).toBeLessThan(20);
    expect(worst).toBeLessThan(60);
  });
});
