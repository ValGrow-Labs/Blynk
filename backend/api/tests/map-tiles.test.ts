import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp } from '../src/app.js';

/**
 * Self-hosted PMTiles archive served by GET /map-tiles/<name>.pmtiles.
 *
 * MapLibre Native reads a PMTiles archive with HTTP Range requests (a
 * directory read, then one small range per tile). The guarantees below are
 * therefore about ranges: a ranged request must return only the slice, never
 * the whole 2 MB file. Tests read tiny slices of the archive and compare them
 * with the same slice read straight from disk. No database is involved.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TILES_DIR = path.resolve(__dirname, '../map-tiles');
const ARCHIVE_NAME = 'blynk-service-area.pmtiles';
const ARCHIVE_PATH = path.join(TILES_DIR, ARCHIVE_NAME);
const ARCHIVE_URL = `/map-tiles/${ARCHIVE_NAME}`;
const ARCHIVE_SIZE = fs.statSync(ARCHIVE_PATH).size;

/** Reads bytes [start, end] (inclusive) from the archive without loading it all. */
function readSlice(start: number, end: number): Buffer {
  const fd = fs.openSync(ARCHIVE_PATH, 'r');
  try {
    const buf = Buffer.alloc(end - start + 1);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** supertest only buffers known text/JSON types; force a Buffer for binary. */
function binaryParser(
  res: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Self-hosted PMTiles route (GET /map-tiles/*.pmtiles)', () => {
  const app = createApp();

  it('the archive on disk is the size recorded in the docs (2,037,022 bytes)', () => {
    expect(ARCHIVE_SIZE).toBe(2037022);
  });

  it('the archive SHA-256 equals the value recorded in map-tiles/README.md', () => {
    const readme = fs.readFileSync(path.join(TILES_DIR, 'README.md'), 'utf-8');
    const recorded = /SHA-256\s*\|\s*`([0-9a-f]{64})`/.exec(readme)?.[1];
    expect(recorded, 'README must record a 64-hex SHA-256').toBeDefined();
    const actual = crypto.createHash('sha256').update(fs.readFileSync(ARCHIVE_PATH)).digest('hex');
    expect(actual).toBe(recorded);
  });

  describe('full-file metadata (HEAD)', () => {
    it('returns 200 with Content-Length and Accept-Ranges: bytes, and no body', async () => {
      const res = await request(app).head(ARCHIVE_URL);
      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBe('2037022');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['last-modified']).toBeTruthy();
      expect(res.text ?? '').toBe('');
    });

    it('works without an Authorization header (public map data)', async () => {
      const res = await request(app).head(ARCHIVE_URL);
      expect(res.headers['authorization']).toBeUndefined();
      expect(res.status).toBe(200);
    });
  });

  describe('Range requests (206 Partial Content)', () => {
    it('bytes=0-126 returns the 127-byte PMTiles header (magic "PMTiles", version 3)', async () => {
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('Range', 'bytes=0-126')
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 0-126/2037022');
      expect(res.headers['content-length']).toBe('127');
      expect(res.headers['accept-ranges']).toBe('bytes');
      const body = res.body as Buffer;
      expect(body.length).toBe(127);
      expect(body.subarray(0, 7).toString('ascii')).toBe('PMTiles');
      expect(body[7]).toBe(3);
      expect(body.equals(readSlice(0, 126))).toBe(true);
    });

    it('a middle range returns exactly the requested bytes', async () => {
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('Range', 'bytes=1000-1999')
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe('bytes 1000-1999/2037022');
      expect(res.headers['content-length']).toBe('1000');
      expect((res.body as Buffer).equals(readSlice(1000, 1999))).toBe(true);
    });

    it('a suffix range (bytes=-100) returns the last 100 bytes', async () => {
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('Range', 'bytes=-100')
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes ${ARCHIVE_SIZE - 100}-${ARCHIVE_SIZE - 1}/2037022`);
      expect(res.headers['content-length']).toBe('100');
      expect((res.body as Buffer).equals(readSlice(ARCHIVE_SIZE - 100, ARCHIVE_SIZE - 1))).toBe(true);
    });

    it('an open-ended range (bytes=N-) returns from N to the end of the file', async () => {
      const start = ARCHIVE_SIZE - 300;
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('Range', `bytes=${start}-`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes ${start}-${ARCHIVE_SIZE - 1}/2037022`);
      expect(res.headers['content-length']).toBe('300');
      expect((res.body as Buffer).equals(readSlice(start, ARCHIVE_SIZE - 1))).toBe(true);
    });

    it('a range response body is the range length, NOT the file length', async () => {
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('Range', 'bytes=4096-5119')
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(206);
      expect((res.body as Buffer).length).toBe(1024);
      expect((res.body as Buffer).length).toBeLessThan(ARCHIVE_SIZE);
      expect(res.headers['content-length']).toBe('1024');
      expect(res.headers['content-length']).not.toBe(String(ARCHIVE_SIZE));
    });

    it('an unsatisfiable range returns 416 with Content-Range: bytes */total', async () => {
      const res = await request(app).get(ARCHIVE_URL).set('Range', 'bytes=99999999-');
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe('bytes */2037022');
      // The body is the small JSON error envelope, labelled as JSON (not as the archive).
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.error.code).toBe('RANGE_NOT_SATISFIABLE');
      // The error body must not contain archive bytes.
      expect(Buffer.byteLength(res.text ?? '')).toBeLessThan(2000);
    });
  });

  describe('caching and validators', () => {
    it('sends Cache-Control: public, max-age=3600 (no immutable; the file name is stable)', async () => {
      const res = await request(app).head(ARCHIVE_URL);
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      expect(res.headers['cache-control']).not.toContain('immutable');
    });

    it('If-None-Match with the current ETag returns 304 and no body', async () => {
      const first = await request(app).head(ARCHIVE_URL);
      const etag = first.headers['etag'];
      expect(etag).toBeTruthy();

      const res = await request(app).get(ARCHIVE_URL).set('If-None-Match', etag);
      expect(res.status).toBe(304);
      expect(res.headers['etag']).toBe(etag);
      expect(res.text ?? '').toBe('');
    });

    it('If-Modified-Since with the current Last-Modified returns 304', async () => {
      const first = await request(app).head(ARCHIVE_URL);
      const res = await request(app)
        .get(ARCHIVE_URL)
        .set('If-Modified-Since', first.headers['last-modified']);
      expect(res.status).toBe(304);
    });
  });

  describe('no on-the-fly compression', () => {
    it('never sets Content-Encoding, even when the client sends Accept-Encoding: gzip', async () => {
      const full = await request(app).head(ARCHIVE_URL).set('Accept-Encoding', 'gzip, deflate, br');
      expect(full.status).toBe(200);
      expect(full.headers['content-encoding']).toBeUndefined();
      expect(full.headers['content-length']).toBe('2037022');

      const ranged = await request(app)
        .get(ARCHIVE_URL)
        .set('Accept-Encoding', 'gzip, deflate, br')
        .set('Range', 'bytes=0-126')
        .buffer(true)
        .parse(binaryParser);
      expect(ranged.status).toBe(206);
      expect(ranged.headers['content-encoding']).toBeUndefined();
      expect((ranged.body as Buffer).length).toBe(127);
    });
  });

  describe('cross-origin resource policy', () => {
    it('is marked cross-origin (public, non-credentialed), like /uploads', async () => {
      const res = await request(app).head(ARCHIVE_URL);
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });

  describe('only .pmtiles files from the tiles directory are served', () => {
    it('returns 404 for a missing .pmtiles file', async () => {
      const res = await request(app).get('/map-tiles/does-not-exist.pmtiles');
      expect(res.status).toBe(404);
    });

    it('returns 404 for an existing non-.pmtiles file (README.md)', async () => {
      expect(fs.existsSync(path.join(TILES_DIR, 'README.md'))).toBe(true);
      const res = await request(app).get('/map-tiles/README.md');
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('Self-hosted OSM-derived');
    });

    it('returns 404 for the directory itself (no listing, no index)', async () => {
      for (const url of ['/map-tiles', '/map-tiles/']) {
        const res = await request(app).get(url);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(ARCHIVE_NAME);
      }
    });

    it('returns 404 for a dotfile even with the .pmtiles extension', async () => {
      const res = await request(app).get('/map-tiles/.hidden.pmtiles');
      expect(res.status).toBe(404);
    });

    const traversalUrls = [
      '/map-tiles/..%2f..%2fpackage.json',
      '/map-tiles/%2e%2e/.env',
      '/map-tiles/%2e%2e%2f%2e%2e%2f.env',
      '/map-tiles/..%5c..%5cpackage.json',
      '/map-tiles/%252e%252e%252fpackage.json',
      '/map-tiles/..%2fmap-tiles%2fblynk-service-area.pmtiles',
      '/map-tiles/%2e%2e%2fmap-tiles%2fblynk-service-area.pmtiles',
      '/map-tiles/%00.pmtiles',
    ];

    it.each(traversalUrls)('rejects traversal attempt %s without leaking file content', async (url) => {
      const res = await request(app).get(url);
      expect([400, 403, 404]).toContain(res.status);
      const text = res.text ?? '';
      // package.json / .env / archive content must not appear in the body.
      expect(text).not.toContain('"dependencies"');
      expect(text).not.toContain('DATABASE_URL=');
      expect(text).not.toContain('PMTiles');
      expect(text.length).toBeLessThan(2000);
    });
  });

  describe('methods', () => {
    it.each(['post', 'put', 'delete', 'patch'] as const)('%s is not served', async (method) => {
      const res = await request(app)[method](ARCHIVE_URL).send({});
      expect([404, 405]).toContain(res.status);
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.headers['accept-ranges']).toBeUndefined();
      expect(Buffer.byteLength(res.text ?? '')).toBeLessThan(2000);
    });

    it('a rejected method advertises Allow: GET, HEAD', async () => {
      const res = await request(app).post(ARCHIVE_URL).send({});
      expect(res.status).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
    });
  });
});
