import { describe, expect, it } from 'vitest';
import { mediaOrigin, rewriteMediaUrls, thumbBucket, thumbUrl, viaApiHost } from './mediaUrl';

const API = 'https://blynk-api.valgrowlabs.com/api/v1';
const RAW = 'https://q26l1nnsapwt2baiv2uqrvhb.72.62.253.92.sslip.io/uploads/products/5defb25f.jpg';

describe('mediaOrigin', () => {
  it('is the https origin of the API address', () => {
    expect(mediaOrigin(API)).toBe('https://blynk-api.valgrowlabs.com');
  });
  it('is null for local or broken addresses', () => {
    expect(mediaOrigin('http://localhost:4000/api/v1')).toBeNull();
    expect(mediaOrigin('not a url')).toBeNull();
    expect(mediaOrigin('')).toBeNull();
  });
});

describe('viaApiHost', () => {
  const origin = mediaOrigin(API);
  it('moves an upload from another host to the API host', () => {
    expect(viaApiHost(RAW, origin)).toBe('https://blynk-api.valgrowlabs.com/uploads/products/5defb25f.jpg');
  });
  it('leaves an upload already on the API host', () => {
    const u = 'https://blynk-api.valgrowlabs.com/uploads/promotions/a.jpg';
    expect(viaApiHost(u, origin)).toBe(u);
  });
  it('leaves other addresses and text alone', () => {
    expect(viaApiHost('https://example.com/pics/a.jpg', origin)).toBe('https://example.com/pics/a.jpg');
    expect(viaApiHost('See https://x.io/uploads/a.jpg for more', origin)).toBe('See https://x.io/uploads/a.jpg for more');
    expect(viaApiHost('Dairy', origin)).toBe('Dairy');
  });
  it('does nothing without an origin (local development)', () => {
    expect(viaApiHost(RAW, null)).toBe(RAW);
  });
  it('keeps the query string of the picture', () => {
    expect(viaApiHost(`${RAW}?v=2`, origin)).toBe('https://blynk-api.valgrowlabs.com/uploads/products/5defb25f.jpg?v=2');
  });
});

describe('rewriteMediaUrls', () => {
  const origin = mediaOrigin(API);
  it('rewrites nested response data, arrays included, and leaves everything else', () => {
    const data = {
      products: [{ id: 'a', name: 'Anchor', image_url: RAW, price: 1300, tags: [RAW, 'x'], gone: null }],
      promotions: [{ image_url: null, background_image_url: RAW }],
      flag: true,
    };
    const out = rewriteMediaUrls(data, origin);
    expect(out.products[0]!.image_url).toBe('https://blynk-api.valgrowlabs.com/uploads/products/5defb25f.jpg');
    expect(out.products[0]!.tags).toEqual(['https://blynk-api.valgrowlabs.com/uploads/products/5defb25f.jpg', 'x']);
    expect(out.products[0]!.gone).toBeNull();
    expect(out.products[0]!.price).toBe(1300);
    expect(out.promotions[0]!.background_image_url).toContain('blynk-api.valgrowlabs.com/uploads/');
    expect(out.flag).toBe(true);
  });
  it('returns primitives and null untouched', () => {
    expect(rewriteMediaUrls(null, origin)).toBeNull();
    expect(rewriteMediaUrls(5, origin)).toBe(5);
    expect(rewriteMediaUrls(RAW, null)).toBe(RAW);
  });
});

describe('thumbBucket', () => {
  it('rounds up to the allowed widths and stops at the largest', () => {
    expect(thumbBucket(1)).toBe(96);
    expect(thumbBucket(96)).toBe(96);
    expect(thumbBucket(97)).toBe(160);
    expect(thumbBucket(158)).toBe(160);
    expect(thumbBucket(240)).toBe(240);
    expect(thumbBucket(241)).toBe(320);
    expect(thumbBucket(641)).toBe(960);
    expect(thumbBucket(5000)).toBe(960);
  });
});

describe('thumbUrl', () => {
  const origin = mediaOrigin(API);
  const P = 'https://blynk-api.valgrowlabs.com/uploads/products/5defb25f.jpg';
  it('asks for the bucket of cssPx x pixel ratio', () => {
    expect(thumbUrl(P, 79, 3, origin)).toBe(`${P}?w=240`); // 79 x 2.5 = 197.5 -> 198 -> 240
    expect(thumbUrl(P, 79, 2, origin)).toBe(`${P}?w=160`); // 158 -> 160
    expect(thumbUrl(P, 79, 1, origin)).toBe(`${P}?w=96`);
    expect(thumbUrl(P, 390, 3, origin)).toBe(`${P}?w=960`); // 975 -> 960 (largest)
    expect(thumbUrl(P, 360, 2, origin)).toBe(`${P}?w=960`); // 720 -> 960
  });
  it('caps the pixel ratio at 2.5', () => {
    expect(thumbUrl(P, 100, 4, origin)).toBe(`${P}?w=320`); // 250 -> 320, not 400 -> 480
  });
  it('replaces an existing w, keeps other parameters and the fragment', () => {
    expect(thumbUrl(`${P}?v=3&w=960`, 79, 2, origin)).toBe(`${P}?v=3&w=160`);
    expect(thumbUrl(`${P}?w=5&v=3#x`, 79, 2, origin)).toBe(`${P}?v=3&w=160#x`);
    expect(thumbUrl(`${P}?width=5`, 79, 2, origin)).toBe(`${P}?width=5&w=160`);
  });
  it('is idempotent', () => {
    const once = thumbUrl(P, 79, 2, origin);
    expect(thumbUrl(once, 79, 2, origin)).toBe(once);
  });
  it('never touches other hosts, other paths, data/file addresses or text', () => {
    for (const u of [RAW, 'https://example.com/uploads/a.jpg', 'https://blynk-api.valgrowlabs.com/api/v1/x.jpg',
      'data:image/png;base64,AAAA', 'file:///data/a.png', 'asset:/a.png', '/uploads/products/a.jpg', 'Dairy', 'See https://blynk-api.valgrowlabs.com/uploads/a.jpg now']) {
      expect(thumbUrl(u, 79, 2, origin)).toBe(u);
    }
  });
  it('leaves null, empty and a missing origin or size alone', () => {
    expect(thumbUrl(null, 79, 2, origin)).toBeNull();
    expect(thumbUrl(undefined, 79, 2, origin)).toBeNull();
    expect(thumbUrl('', 79, 2, origin)).toBe('');
    expect(thumbUrl(P, 79, 2, null)).toBe(P);
    expect(thumbUrl(P, 0, 2, origin)).toBe(P);
    expect(thumbUrl(P, NaN, 2, origin)).toBe(P);
  });
  it('treats a bad pixel ratio as 1', () => {
    expect(thumbUrl(P, 79, NaN, origin)).toBe(`${P}?w=96`);
    expect(thumbUrl(P, 79, 0, origin)).toBe(`${P}?w=96`);
  });
  it('matches the host case-insensitively', () => {
    expect(thumbUrl('https://BLYNK-API.valgrowlabs.com/uploads/a.jpg', 79, 2, origin)).toBe('https://BLYNK-API.valgrowlabs.com/uploads/a.jpg?w=160');
  });
});
