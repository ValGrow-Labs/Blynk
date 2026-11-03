import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { authRateLimiter } from '../src/modules/auth/auth.rate-limiter.js';
import {
  FEED_DESCRIPTION_MAX,
  FEED_RATE_LIMIT,
  FEED_TITLE_MAX,
  buildFeedRows,
  feedImageUrl,
  feedPrice,
  feedProductLink,
  xmlEscape,
} from '../src/modules/feeds/meta-catalog.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';

/**
 * Meta catalogue feed (GET /api/v1/feeds/meta-catalog.xml and .csv), against the database. The
 * feed's `id` is what the web app sends as `item_id` (analytics/track.ts itemIdOf): the product
 * SKU, or for a size the size's SKU (its id when it has none).
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-FEED-');
const TAG = `TST-FEED-${Date.now()}`;
const XML_URL = '/api/v1/feeds/meta-catalog.xml';
const CSV_URL = '/api/v1/feeds/meta-catalog.csv';

type Item = Record<string, string>;

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function parseXml(xml: string): Item[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const item: Item = {};
    for (const f of m[1]!.matchAll(/<g:([a-z_]+)>([\s\S]*?)<\/g:\1>/g)) item[f[1]!] = unescapeXml(f[2]!);
    return item;
  });
}

/** RFC 4180 reader (quotes, doubled quotes, newlines inside cells). */
function parseCsv(text: string): Item[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') {
      // belongs to the \n that follows
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

let categoryId = '';
let categoryName = '';
let seq = 0;

async function createProduct(body: Record<string, unknown> = {}) {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({
      category_id: categoryId,
      name: `${TAG} P${seq}`,
      sku: `${TAG}-P${seq}`,
      unit: '1 pack',
      purchase_cost: 100,
      pricing_mode: 'FIXED',
      fixed_selling_price: 245,
      image_url: `http://localhost:4000/uploads/products/${TAG}-${seq}.jpg`,
      is_available: true,
      is_active: true,
      ...body,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  fx.created.products.push(res.body.data.product.id);
  return res.body.data.product as { id: string; sku: string; name: string };
}

const feed = async () => parseXml((await request(app).get(XML_URL)).text);
const mine = (items: Item[]) => items.filter((i) => i.id.startsWith(TAG) || i.item_group_id?.startsWith(TAG));

beforeAll(async () => {
  await fx.setup();
  const cat = (await pool.query('SELECT id, name FROM categories WHERE is_active = true ORDER BY display_order LIMIT 1')).rows[0];
  categoryId = cat.id;
  categoryName = cat.name;
});

afterAll(async () => {
  await fx.cleanup();
});

describe('feed helpers', () => {
  it('escapes the five XML characters and nothing else', () => {
    expect(xmlEscape(`Tom & Jerry's "Milk" <1L>`)).toBe('Tom &amp; Jerry&apos;s &quot;Milk&quot; &lt;1L&gt;');
    expect(xmlEscape('කිරි தயிர் 🥛')).toBe('කිරි தயிர் 🥛');
  });

  it('reads pictures from the Cloudflare API host as 640 px thumbnails', () => {
    const origin = 'https://blynk-api.valgrowlabs.com';
    expect(feedImageUrl('http://1.2.3.4.sslip.io/uploads/products/a.jpg', origin)).toBe(`${origin}/uploads/products/a.jpg?w=640`);
    expect(feedImageUrl('/uploads/products/a.jpg?v=3&w=96', origin)).toBe(`${origin}/uploads/products/a.jpg?v=3&w=640`);
    expect(feedImageUrl('https://cdn.example.com/x.png', origin)).toBe('https://cdn.example.com/x.png');
    expect(feedImageUrl('', origin)).toBeNull();
    expect(feedImageUrl(null, origin)).toBeNull();
    expect(feedImageUrl('data:image/png;base64,AAAA', origin)).toBeNull();
  });

  it('formats the price and the link', () => {
    expect(feedPrice(245)).toBe('245.00 LKR');
    expect(feedPrice(99.5)).toBe('99.50 LKR');
    expect(feedPrice(0)).toBeNull();
    expect(feedPrice(Number.NaN)).toBeNull();
    expect(feedProductLink('abc-1', 'https://blynk.lk/app/')).toBe('https://blynk.lk/app/p/abc-1');
    expect(feedProductLink('abc-1', 'https://blynk.lk/app')).toBe('https://blynk.lk/app/p/abc-1');
  });

  it('caps the title at 150 and the description at 5000 characters (never half an emoji), and skips rows without a picture or price', () => {
    const product = {
      id: 'p-1',
      sku: 'LONG-1',
      name: `Milk ${'🥛'.repeat(200)}`,
      description: 'ක'.repeat(6000),
      category_name: 'Dairy',
      image_url: 'https://cdn.example.com/a.jpg',
      selling_price: 100,
      offer_price: null,
      is_available: true,
      window_closed: false,
      has_variants: false,
    } as unknown as Parameters<typeof buildFeedRows>[0][number];
    const [row] = buildFeedRows([product], new Map());
    expect(Array.from(row!.title).length).toBe(FEED_TITLE_MAX);
    expect(Array.from(row!.description).length).toBe(FEED_DESCRIPTION_MAX);
    expect(row!.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(buildFeedRows([{ ...product, image_url: null }], new Map())).toHaveLength(0);
    expect(buildFeedRows([{ ...product, selling_price: 0 }], new Map())).toHaveLength(0);
  });
});

describe('GET /feeds/meta-catalog.xml', () => {
  it('is public, cacheable XML with the Merchant namespace', async () => {
    const res = await request(app).get(XML_URL);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=900');
    expect(res.text.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(res.text).toContain('<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">');
  });

  it('lists an in-stock product with the id the web app sends, its price, link and thumbnail', async () => {
    const p = await createProduct({ description: '<p>Fresh <b>full cream</b> milk</p>\n  1 litre' });
    const item = (await feed()).find((i) => i.id === p.sku);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      id: p.sku, // = itemIdOf(product): the SKU
      title: p.name,
      description: 'Fresh full cream milk 1 litre',
      availability: 'in stock',
      condition: 'new',
      price: '245.00 LKR',
      link: `https://blynk.lk/app/p/${p.id}`,
      image_link: `https://blynk-api.valgrowlabs.com/uploads/products/${TAG}-${seq}.jpg?w=640`,
      brand: 'Blynk',
      product_type: categoryName,
      item_group_id: p.sku,
    });
    // Only the documented fields; no stock figures, cost or personal data.
    expect(Object.keys(item!).sort()).toEqual(
      ['availability', 'brand', 'condition', 'description', 'id', 'image_link', 'item_group_id', 'link', 'price', 'product_type', 'title'].sort()
    );
  });

  it('shows the offer price while an offer is on', async () => {
    const p = await createProduct({ offer_price: 199.5 });
    expect((await feed()).find((i) => i.id === p.sku)?.price).toBe('199.50 LKR');
    await pool.query("UPDATE products SET offer_ends_at = now() - interval '1 minute' WHERE id = $1", [p.id]);
    expect((await feed()).find((i) => i.id === p.sku)?.price).toBe('245.00 LKR');
  });

  it('says out of stock for a sold-out tracked product', async () => {
    const p = await createProduct();
    const mode = await request(app).patch(`/api/v1/admin/inventory/${p.id}/mode`).set(auth(tokens.admin)).send({ tracking_mode: 'TRACKED' });
    expect(mode.status).toBe(200);
    const item = (await feed()).find((i) => i.id === p.sku);
    expect(item?.availability).toBe('out of stock');
    // No stock numbers anywhere in the document.
    expect(JSON.stringify(item)).not.toMatch(/quantity|on_hand|sellable/i);
  });

  it('leaves out inactive products and products without a picture', async () => {
    const hidden = await createProduct({ is_active: false });
    const noPicture = await createProduct({ image_url: null });
    const ids = (await feed()).map((i) => i.id);
    expect(ids).not.toContain(hidden.sku);
    expect(ids).not.toContain(noPicture.sku);
    // Switching a product off removes it from the feed.
    const live = await createProduct();
    expect((await feed()).map((i) => i.id)).toContain(live.sku);
    await request(app).patch(`/api/v1/admin/products/${live.id}`).set(auth(tokens.admin)).send({ is_active: false });
    expect((await feed()).map((i) => i.id)).not.toContain(live.sku);
  });

  it('escapes & < > quotes, keeps Sinhala, Tamil and emoji, and is well formed', async () => {
    const tricky = await createProduct({ name: `Tom & Jerry's "Milk" <1L> ${TAG}`, description: `Tom & Jerry's <script>alert(1)</script> "milk" 🥛` });
    const sinhala = await createProduct({ name: `කිරි පැකට්ටුව தயிர் 🥛 ${TAG}` });
    const res = await request(app).get(XML_URL);
    expect(res.text).toContain(`Tom &amp; Jerry&apos;s &quot;Milk&quot; &lt;1L&gt; ${TAG}`);
    expect(res.text).not.toContain('<script>');
    expect(res.text).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/); // no bare ampersand anywhere
    const items = parseXml(res.text);
    expect(items.find((i) => i.id === tricky.sku)?.title).toBe(`Tom & Jerry's "Milk" <1L> ${TAG}`);
    expect(items.find((i) => i.id === tricky.sku)?.description).toBe(`Tom & Jerry's alert(1) "milk" 🥛`);
    expect(items.find((i) => i.id === sinhala.sku)?.title).toBe(`කිරි පැකට්ටුව தயிர் 🥛 ${TAG}`);
    // Every <item> opened is closed and no element is left open.
    expect((res.text.match(/<item>/g) ?? []).length).toBe((res.text.match(/<\/item>/g) ?? []).length);
    expect(res.text.match(/<g:([a-z_]+)>/g)!.length).toBe(res.text.match(/<\/g:[a-z_]+>/g)!.length);
  });

  it('gives a row per size, with the size SKU (or id) as the id and one item_group_id', async () => {
    const p = await createProduct({ name: `Chilli powder ${TAG}` });
    const add = (body: object) => request(app).post(`/api/v1/admin/products/${p.id}/variants`).set(auth(tokens.admin)).send(body);
    const v100 = await add({ label: '100 g', sku: `${p.sku}-100`, purchase_cost: 70, pricing_mode: 'FIXED', fixed_selling_price: 120 });
    const v250 = await add({ label: '250 g', purchase_cost: 150, pricing_mode: 'FIXED', fixed_selling_price: 280, offer_price: 260 });
    expect(v100.status, JSON.stringify(v100.body)).toBe(201);
    expect(v250.status, JSON.stringify(v250.body)).toBe(201);

    const items = (await feed()).filter((i) => i.item_group_id === p.sku);
    expect(items).toHaveLength(2);
    const by100 = items.find((i) => i.id === `${p.sku}-100`)!; // the size's SKU, as the web app sends it
    const by250 = items.find((i) => i.id === v250.body.data.variant.id)!; // no SKU: the size's id
    expect(by100).toMatchObject({ title: `Chilli powder ${TAG} - 100 g`, price: '120.00 LKR', availability: 'in stock', link: `https://blynk.lk/app/p/${p.id}` });
    expect(by250).toMatchObject({ title: `Chilli powder ${TAG} - 250 g`, price: '260.00 LKR', availability: 'in stock' });
    // The bare product is not a row of its own (its id is the group, not an item).
    expect((await feed()).some((i) => i.id === p.sku)).toBe(false);
  });

  it('is rate limited per IP like the other public routes', async () => {
    const key = [...authRateLimiter.keys()].find((k) => k.startsWith('meta_feed_ip:'));
    expect(key).toBeDefined();
    for (let i = 0; i < FEED_RATE_LIMIT.max; i++) authRateLimiter.checkLimit(key!, FEED_RATE_LIMIT.max * 2, FEED_RATE_LIMIT.windowMs);
    const res = await request(app).get(XML_URL);
    expect(res.status).toBe(429);
    authRateLimiter.clear(key!);
    expect((await request(app).get(XML_URL)).status).toBe(200);
    authRateLimiter.clear(key!);
  });
});

describe('GET /feeds/meta-catalog.csv', () => {
  it('has the same rows as the XML, with the same fields', async () => {
    await createProduct({ name: `Quote "x", y ${TAG}`, description: 'line one\nline two, with comma' });
    authRateLimiter.reset();
    const xml = await request(app).get(XML_URL);
    const csv = await request(app).get(CSV_URL);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['cache-control']).toBe('public, max-age=900');
    expect(csv.text.split('\r\n')[0]).toBe(
      'id,title,description,availability,condition,price,link,image_link,brand,product_type,item_group_id'
    );
    const fromXml = parseXml(xml.text);
    const fromCsv = parseCsv(csv.text);
    expect(fromCsv.length).toBe(fromXml.length);
    expect(fromCsv).toEqual(fromXml);
    expect(mine(fromCsv).length).toBeGreaterThan(0);
    expect(fromCsv.find((r) => r.title === `Quote "x", y ${TAG}`)?.description).toBe('line one line two, with comma');
  });
});
