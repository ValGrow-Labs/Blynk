import { describe, expect, it } from 'vitest';
import { mediaOrigin, rewriteMediaUrls, viaApiHost } from './mediaUrl';

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
