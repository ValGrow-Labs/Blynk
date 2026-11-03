import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { clientIp } from '../../utils/client-ip.js';
import { authRateLimiter } from '../auth/auth.rate-limiter.js';
import { catalogService, type CustomerProductDto } from '../catalog/catalog.service.js';
import type { CustomerVariantDto } from '../catalog/catalog.variants.js';

/**
 * Meta (Facebook / Instagram) product catalogue feed (owner's brother, 2026-11-03).
 *
 *   GET /api/v1/feeds/meta-catalog.xml   RSS 2.0 with the Google Merchant namespace (g:)
 *   GET /api/v1/feeds/meta-catalog.csv   the same rows as CSV
 *
 * Public, no sign-in, no personal data, no stock numbers (only in stock / out of stock). It lists
 * what the customer catalogue lists today (CatalogService.listAllForFeed: the same read and the
 * same prices, offers, availability and approved-seller rules as GET /catalog/products).
 *
 * The `id` of a row is EXACTLY the `item_id` the web app sends in its analytics events
 * (apps/customer-app/src/blynk/analytics/track.ts, itemIdOf), so Meta can match "viewed this
 * item" to a catalogue item:
 *   - a product without sizes:  its SKU;
 *   - a size (variant) of a product:  the size's SKU, or the size's id when it has no SKU.
 *     One row per active size, all with item_group_id = the product's SKU;
 *   - combo packs are not in the feed (item_id `combo_<id>` has no product page to link to).
 * The app falls back to the id when a product has no SKU, which cannot happen on the server
 * (SKU is required), so the SKU is used here the same way.
 */

export const FEED_RATE_LIMIT = { max: 120, windowMs: 10 * 60 * 1000 };
export const FEED_CACHE_CONTROL = 'public, max-age=900';
export const FEED_TITLE_MAX = 150;
export const FEED_DESCRIPTION_MAX = 5000;
const BRAND = 'Blynk';
const IMAGE_WIDTH = 640;

export interface FeedRow {
  id: string;
  title: string;
  description: string;
  availability: 'in stock' | 'out of stock';
  condition: 'new';
  price: string;
  link: string;
  image_link: string;
  brand: string;
  product_type: string;
  item_group_id: string;
}

/** Column order of both formats. */
export const FEED_FIELDS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'brand',
  'product_type',
  'item_group_id',
] as const satisfies readonly (keyof FeedRow)[];

// ----------------------------------------------------------------------------
// Text helpers
// ----------------------------------------------------------------------------

/** Characters XML 1.0 cannot carry (controls, U+FFFE/F) and lone surrogates (broken emoji). */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Single-line clean text: no invalid characters, whitespace collapsed. */
function clean(text: string): string {
  return text.replace(XML_INVALID, '').replace(/\s+/g, ' ').trim();
}

/** At most `max` characters (code points, so an emoji is never cut in half). */
function cap(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

/** Plain text of a description: tags dropped, &nbsp; as a space. */
function plain(text: string): string {
  return clean(text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' '));
}

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// ----------------------------------------------------------------------------
// Addresses and prices
// ----------------------------------------------------------------------------

const UPLOAD_ADDRESS = /^(?:https?:\/\/[^/?#\s]+)?(\/uploads\/[^?#\s]*)(?:\?([^#\s]*))?(?:#\S*)?$/i;

/**
 * The picture's address for Meta: an /uploads/ picture is read from the API's public (Cloudflare)
 * address as a 640 px WebP thumbnail (any other query parameters are kept, an existing w is
 * replaced); any other http(s) address is used as stored; anything else is not usable (null).
 */
export function feedImageUrl(raw: string | null | undefined, apiOrigin: string = new URL(env.PUBLIC_API_ORIGIN).origin): string | null {
  const url = (raw ?? '').trim().replace(/ /g, '%20');
  if (!url) return null;
  const m = UPLOAD_ADDRESS.exec(url);
  if (m) {
    const kept = (m[2] ?? '').split('&').filter((p) => p !== '' && !/^w(=|$)/i.test(p));
    kept.push(`w=${IMAGE_WIDTH}`);
    return `${apiOrigin}${m[1]}?${kept.join('&')}`;
  }
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/** https://blynk.lk/app/p/<id> (WEB_APP_URL is the web app's address, with or without the trailing slash). */
export function feedProductLink(productId: string, webAppUrl: string = env.WEB_APP_URL): string {
  const base = webAppUrl.endsWith('/') ? webAppUrl : `${webAppUrl}/`;
  return `${base}p/${encodeURIComponent(productId)}`;
}

/** '245.00 LKR', or null for a price that is not a positive number. */
export function feedPrice(amount: number): string | null {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(2)} LKR` : null;
}

// ----------------------------------------------------------------------------
// Rows
// ----------------------------------------------------------------------------

const str = (v: string | null | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** What the web app sends as item_id for a product (itemIdOf): its SKU, else its id. */
export const productItemId = (p: { id: string; sku?: string | null }) => str(p.sku) ?? p.id;
/** ... and for one of its sizes: the size's SKU, else the size's id. */
export const variantItemId = (v: { id: string; sku?: string | null }) => str(v.sku) ?? v.id;

/** The feed rows of the customer catalogue: one per product, or one per active size of a product with sizes. */
export function buildFeedRows(products: CustomerProductDto[], variants: Map<string, CustomerVariantDto[]>): FeedRow[] {
  const rows: FeedRow[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    const image = feedImageUrl(p.image_url);
    if (!image) continue;
    const name = clean(p.name ?? '');
    if (!name) continue;
    const groupId = productItemId(p);
    const link = feedProductLink(p.id);
    const productType = clean(p.category_name ?? '');
    const description = (label?: string) =>
      cap(plain(p.description ?? '') || `${name}${label ? ` - ${label}` : ''} from Blynk.`, FEED_DESCRIPTION_MAX);

    const push = (row: Omit<FeedRow, 'condition' | 'image_link' | 'brand' | 'product_type' | 'item_group_id' | 'link'>) => {
      if (seen.has(row.id)) return; // two products or sizes sharing an id: the first one wins
      seen.add(row.id);
      rows.push({ ...row, condition: 'new', link, image_link: image, brand: BRAND, product_type: productType, item_group_id: groupId });
    };

    if (p.has_variants) {
      // A product with sizes: a row per active size. A window-closed product (time-limited hours) is not in stock.
      for (const v of variants.get(p.id) ?? []) {
        const price = feedPrice(v.price);
        const label = clean(v.label ?? '');
        if (!price) continue;
        push({
          id: variantItemId(v),
          title: cap(label ? `${name} - ${label}` : name, FEED_TITLE_MAX),
          description: description(label),
          availability: v.is_available && !p.window_closed ? 'in stock' : 'out of stock',
          price,
        });
      }
      continue;
    }

    const price = feedPrice(p.offer_price ?? p.selling_price);
    if (!price) continue;
    push({
      id: groupId,
      title: cap(name, FEED_TITLE_MAX),
      description: description(),
      availability: p.is_available ? 'in stock' : 'out of stock',
      price,
    });
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Formats
// ----------------------------------------------------------------------------

export function renderFeedXml(rows: FeedRow[]): string {
  const site = new URL(env.WEB_APP_URL).origin;
  const items = rows
    .map((r) => `<item>${FEED_FIELDS.map((f) => `<g:${f}>${xmlEscape(r[f])}</g:${f}>`).join('')}</item>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n<channel>\n' +
    `<title>Blynk</title>\n<link>${xmlEscape(site)}</link>\n<description>Blynk product catalogue</description>\n` +
    (items ? `${items}\n` : '') +
    '</channel>\n</rss>\n'
  );
}

export function renderFeedCsv(rows: FeedRow[]): string {
  const lines = [FEED_FIELDS.join(','), ...rows.map((r) => FEED_FIELDS.map((f) => csvCell(r[f])).join(','))];
  return `${lines.join('\r\n')}\r\n`;
}

// ----------------------------------------------------------------------------
// Route
// ----------------------------------------------------------------------------

/** One read of the catalogue serves both formats for a minute (not in tests: they change data between calls). */
const MEMO_MS = 60_000;
let memo: { at: number; rows: Promise<FeedRow[]> } | null = null;

export function resetMetaCatalogCache(): void {
  memo = null;
}

async function loadRows(): Promise<FeedRow[]> {
  const now = Date.now();
  if (env.NODE_ENV !== 'test' && memo && now - memo.at < MEMO_MS) return memo.rows;
  const rows = catalogService.listAllForFeed().then(({ products, variants }) => buildFeedRows(products, variants));
  memo = { at: now, rows };
  rows.catch(() => {
    if (memo?.rows === rows) memo = null;
  });
  return rows;
}

function serve(format: 'xml' | 'csv') {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      authRateLimiter.checkLimit(
        `meta_feed_ip:${clientIp(req) ?? 'unknown'}`,
        FEED_RATE_LIMIT.max,
        FEED_RATE_LIMIT.windowMs,
        'Too many requests for the catalogue feed. Please wait before retrying.'
      );
      const rows = await loadRows();
      res.setHeader('Content-Type', format === 'xml' ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8');
      res.setHeader('Cache-Control', FEED_CACHE_CONTROL);
      res.status(200).send(format === 'xml' ? renderFeedXml(rows) : renderFeedCsv(rows));
    } catch (err) {
      next(err);
    }
  };
}

export const feedsRouter = Router();
feedsRouter.get('/meta-catalog.xml', serve('xml'));
feedsRouter.get('/meta-catalog.csv', serve('csv'));
