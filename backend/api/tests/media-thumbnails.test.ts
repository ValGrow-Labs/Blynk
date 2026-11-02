import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import sharp from 'sharp';
import {
  ALLOWED_WIDTHS,
  Limiter,
  ThumbnailService,
  createUploadsHandler,
  parseUploadPath,
  removeThumbnails,
  snapWidth,
} from '../src/modules/media/thumbnails.js';
import { LocalDiskStorage } from '../src/utils/storage.js';

/**
 * On-the-fly /uploads thumbnails (GET /uploads/<path>?w=<width> -> WebP).
 * Real image files in a temporary MEDIA_ROOT, served by the same handler the
 * API mounts (createUploadsHandler) behind helmet, like app.ts. No database.
 */

let tmp = '';
let outside = '';
let service: ThumbnailService;
let app: express.Express;

const meta = async (buf: Buffer) => sharp(buf).metadata();
const thumbFiles = () => {
  const root = path.join(tmp, '.thumbs');
  if (!fs.existsSync(root)) return [] as string[];
  return fs.readdirSync(root).flatMap((d) => fs.readdirSync(path.join(root, d)).map((f) => path.join(root, d, f)));
};

/** A raw request: no client-side URL normalization of `..` or encodings. */
function rawGet(server: http.Server, rawPath: string): Promise<{ status: number; body: string }> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('latin1') }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-thumbs-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'blynk-thumbs-outside-'));
  fs.mkdirSync(path.join(tmp, 'products'), { recursive: true });

  const gradient = (w: number, h: number, channels: 3 | 4 = 3) =>
    sharp({ create: { width: w, height: h, channels, background: channels === 4 ? { r: 200, g: 30, b: 30, alpha: 0.5 } : { r: 30, g: 120, b: 200 } } });

  await gradient(1200, 800).jpeg().toFile(path.join(tmp, 'products/big.jpg'));
  await gradient(1200, 800).png().toFile(path.join(tmp, 'products/big.png'));
  await gradient(1000, 600, 4).png().toFile(path.join(tmp, 'products/alpha.png'));
  await gradient(200, 100).jpeg().toFile(path.join(tmp, 'products/small.jpg'));
  await gradient(1200, 800).webp().toFile(path.join(tmp, 'products/photo.webp'));
  // EXIF orientation 6: stored 600x300, displayed rotated as 300x600.
  await gradient(600, 300).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(tmp, 'products/rotated.jpg'));
  fs.writeFileSync(path.join(tmp, 'products/corrupt.jpg'), Buffer.from('this is not really a jpeg at all'));
  fs.writeFileSync(path.join(tmp, 'products/notes.txt'), 'plain text original');
  fs.writeFileSync(path.join(tmp, '.secret.png'), 'dotfile');
  fs.writeFileSync(path.join(outside, 'secret.png'), await gradient(100, 100).png().toBuffer());
  try {
    fs.symlinkSync(outside, path.join(tmp, 'products/escape'), 'junction');
  } catch {
    /* symlink not permitted on this machine; that test is skipped below */
  }

  service = new ThumbnailService(tmp, { concurrency: 2 });
  app = express();
  app.use(helmet());
  app.use('/uploads', createUploadsHandler(tmp, { service }));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('snapWidth', () => {
  it('rounds up to the nearest allowed width', () => {
    expect(snapWidth('1')).toBe(96);
    expect(snapWidth('96')).toBe(96);
    expect(snapWidth('97')).toBe(160);
    expect(snapWidth('300')).toBe(320);
    expect(snapWidth('641')).toBe(960);
    expect(snapWidth('960')).toBe(960);
  });
  it('rejects everything else', () => {
    for (const bad of ['0', '-5', 'abc', '', '1.5', '961', '99999', '1e3', ' 96', undefined, ['96', '160']]) {
      expect(snapWidth(bad)).toBeNull();
    }
  });
  it('allows exactly the documented widths', () => {
    expect([...ALLOWED_WIDTHS]).toEqual([96, 160, 240, 320, 480, 640, 960]);
  });
});

describe('parseUploadPath', () => {
  it('splits a clean path and refuses dot segments, encodings, backslashes and null bytes', () => {
    expect(parseUploadPath('/products/a%20b.jpg')).toEqual(['products', 'a b.jpg']);
    for (const bad of ['/../x.png', '/%2e%2e/x.png', '/a/%2E%2E/x.png', '/.thumbs/a.webp', '/products/.hidden.png', '/a%5Cb.png', '/a%00.png', '/%zz.png', '/', '']) {
      expect(() => parseUploadPath(bad)).toThrow();
    }
  });
});

describe('GET /uploads/<image>?w=', () => {
  it('returns a WebP of the right width, keeping the aspect ratio', async () => {
    const res = await request(app).get('/uploads/products/big.jpg?w=320').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    const m = await meta(res.body);
    expect(m.format).toBe('webp');
    expect(m.width).toBe(320);
    expect(m.height).toBe(213);
  });

  it('works for png and webp originals too', async () => {
    for (const name of ['big.png', 'photo.webp']) {
      const res = await request(app).get(`/uploads/products/${name}?w=160`).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      const m = await meta(res.body);
      expect(m.format).toBe('webp');
      expect(m.width).toBe(160);
    }
  });

  it('rounds the request up to an allowed width', async () => {
    const res = await request(app).get('/uploads/products/big.jpg?w=300').buffer(true).parse(binary);
    expect((await meta(res.body)).width).toBe(320);
    const res2 = await request(app).get('/uploads/products/big.jpg?w=97').buffer(true).parse(binary);
    expect((await meta(res2.body)).width).toBe(160);
  });

  it('never upscales beyond the original width', async () => {
    const res = await request(app).get('/uploads/products/small.jpg?w=960').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect((await meta(res.body)).width).toBe(200);
  });

  it('keeps transparency', async () => {
    const res = await request(app).get('/uploads/products/alpha.png?w=240').buffer(true).parse(binary);
    const m = await meta(res.body);
    expect(m.format).toBe('webp');
    expect(m.hasAlpha).toBe(true);
  });

  it('applies the EXIF rotation', async () => {
    const res = await request(app).get('/uploads/products/rotated.jpg?w=96').buffer(true).parse(binary);
    const m = await meta(res.body);
    // Displayed 300 wide x 600 tall -> fit inside 96 wide => 96 x 192.
    expect(m.width).toBe(96);
    expect(m.height).toBe(192);
  });

  it('sends cache, validator, CORS and security headers like the originals', async () => {
    const res = await request(app).get('/uploads/products/big.jpg?w=96');
    expect(res.headers['cache-control']).toBe('public, max-age=604800');
    expect(res.headers['etag']).toBeTruthy();
    expect(res.headers['last-modified']).toBeTruthy();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const original = await request(app).get('/uploads/products/big.jpg');
    expect(original.headers['cache-control']).toBe(res.headers['cache-control']);
    expect(original.headers['cross-origin-resource-policy']).toBe(res.headers['cross-origin-resource-policy']);
    expect(original.headers['content-type']).toBe('image/jpeg');
    expect(Number(original.headers['content-length'])).toBeGreaterThan(Number(res.headers['content-length']));
  });

  it('answers a conditional request with 304', async () => {
    const first = await request(app).get('/uploads/products/big.jpg?w=96');
    const second = await request(app).get('/uploads/products/big.jpg?w=96').set('If-None-Match', first.headers['etag']);
    expect(second.status).toBe(304);
  });

  it('serves HEAD', async () => {
    const res = await request(app).head('/uploads/products/big.jpg?w=96');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });

  it('without ?w= still serves the untouched original', async () => {
    const res = await request(app).get('/uploads/products/big.jpg').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect((await meta(res.body)).width).toBe(1200);
  });
});

describe('cache', () => {
  it('renders each (file, width, mtime) once and writes MEDIA_ROOT/.thumbs/<hash>/<w>-<mtime>-<size>.webp', async () => {
    const before = service.stats.generated;
    const a = await request(app).get('/uploads/products/big.png?w=480');
    expect(a.status).toBe(200);
    expect(service.stats.generated).toBe(before + 1);
    const files = thumbFiles().filter((f) => /\/480-\d+-\d+\.webp$/.test(f.replace(/\\/g, '/')));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const mtimeBefore = fs.statSync(files[0]).mtimeMs;

    const b = await request(app).get('/uploads/products/big.png?w=480');
    expect(b.status).toBe(200);
    expect(service.stats.generated).toBe(before + 1); // cache hit: sharp did not run
    expect(fs.statSync(files[0]).mtimeMs).toBe(mtimeBefore);
    expect(b.headers['etag']).toBe(a.headers['etag']);
  });

  it('leaves no temp files behind', async () => {
    await request(app).get('/uploads/products/big.jpg?w=640');
    expect(thumbFiles().filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('re-renders when the original is replaced, and drops the old version', async () => {
    const file = path.join(tmp, 'products/replace.jpg');
    await sharp({ create: { width: 800, height: 800, channels: 3, background: '#ff0000' } }).jpeg().toFile(file);
    const first = await request(app).get('/uploads/products/replace.jpg?w=160').buffer(true).parse(binary);
    await new Promise((r) => setTimeout(r, 20));
    await sharp({ create: { width: 400, height: 400, channels: 3, background: '#0000ff' } }).jpeg().toFile(file);
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const before = service.stats.generated;
    const second = await request(app).get('/uploads/products/replace.jpg?w=160').buffer(true).parse(binary);
    expect(service.stats.generated).toBe(before + 1);
    expect(second.body.equals(first.body)).toBe(false);
    await new Promise((r) => setTimeout(r, 50)); // stale-version cleanup is fire-and-forget
    const mine = thumbFiles().filter((f) => /\/160-/.test(f.replace(/\\/g, '/')));
    const dirs = new Set(mine.map((f) => path.dirname(f)));
    for (const d of dirs) expect(fs.readdirSync(d).filter((f) => f.startsWith('160-')).length).toBeLessThanOrEqual(1);
  });

  it('shares one render between simultaneous identical requests', async () => {
    const before = service.stats.generated;
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).get('/uploads/products/photo.webp?w=640')));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(service.stats.generated).toBe(before + 1);
  });
});

describe('invalid input', () => {
  it('400s a bad width', async () => {
    for (const w of ['abc', '0', '-1', '1.5', '961', '100000', '']) {
      const res = await request(app).get(`/uploads/products/big.jpg?w=${w}`);
      expect(res.status, `w=${w}`).toBe(400);
      expect(res.body.error.code).toBe('INVALID_WIDTH');
    }
    const arr = await request(app).get('/uploads/products/big.jpg?w=96&w=160');
    expect(arr.status).toBe(400);
  });

  it('refuses path traversal in every encoding (400, never a file from outside)', async () => {
    const server = http.createServer(app).listen(0);
    try {
      const attempts = [
        '/uploads/../package.json?w=96',
        '/uploads/products/../../package.json?w=96',
        '/uploads/%2e%2e/package.png?w=96',
        '/uploads/%2e%2e%2fpackage.png?w=96',
        '/uploads/products/%2E%2E/%2E%2E/x.png?w=96',
        '/uploads/..%2f..%2fx.png?w=96',
        '/uploads/products/..%5c..%5cx.png?w=96',
        '/uploads/%00.png?w=96',
        '/uploads/products/big.jpg%00.txt?w=96',
        '/uploads/%252e%252e/x.png?w=96',
        '/uploads//etc/passwd.png?w=96',
        '/uploads/%zz.png?w=96',
        '/uploads/.secret.png?w=96',
      ];
      for (const p of attempts) {
        const res = await rawGet(server, p);
        expect([400, 404], p).toContain(res.status);
        expect(res.body.includes('PNG'), p).toBe(false);
        expect(res.body.includes('RIFF'), p).toBe(false);
      }
      // The explicit dot-segment and encoding forms are refused with 400.
      for (const p of ['/uploads/%2e%2e/package.png?w=96', '/uploads/..%2f..%2fx.png?w=96', '/uploads/products/..%5c..%5cx.png?w=96', '/uploads/%00.png?w=96', '/uploads/.secret.png?w=96']) {
        expect((await rawGet(server, p)).status, p).toBe(400);
      }
    } finally {
      server.close();
    }
  });

  it('refuses a symlink that points outside MEDIA_ROOT', async () => {
    if (!fs.existsSync(path.join(tmp, 'products/escape'))) return; // no symlink permission here
    const res = await request(app).get('/uploads/products/escape/secret.png?w=96');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).not.toBe('image/webp');
  });

  it('a missing file is 404', async () => {
    const res = await request(app).get('/uploads/products/nope.jpg?w=96');
    expect(res.status).toBe(404);
  });

  it('a non-image extension is served as the original, not resized', async () => {
    const res = await request(app).get('/uploads/products/notes.txt?w=96');
    expect(res.status).toBe(200);
    expect(res.text).toBe('plain text original');
  });

  it('a directory is not an image', async () => {
    // Falls through to the static handler (which redirects a folder to its slash form).
    const res = await request(app).get('/uploads/products?w=96');
    expect(res.status).not.toBe(200);
    expect(res.headers['content-type'] ?? '').not.toContain('image/webp');
  });

  it('never serves .thumbs, with or without ?w=', async () => {
    await request(app).get('/uploads/products/big.jpg?w=96'); // make sure it exists
    const dir = fs.readdirSync(path.join(tmp, '.thumbs'))[0];
    const file = fs.readdirSync(path.join(tmp, '.thumbs', dir))[0];
    const server = http.createServer(app).listen(0);
    try {
      for (const p of [`/uploads/.thumbs/${dir}/${file}`, `/uploads/.thumbs/${dir}/${file}?w=96`, `/uploads/%2ethumbs/${dir}/${file}`, `/uploads/.thumbs/`]) {
        const res = await rawGet(server, p);
        expect([400, 404], p).toContain(res.status);
        expect(res.body.includes('RIFF'), p).toBe(false);
      }
    } finally {
      server.close();
    }
  });
});

describe('fallback to the original', () => {
  it('serves the original when the image is corrupt', async () => {
    const res = await request(app).get('/uploads/products/corrupt.jpg?w=96');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body.toString()).toBe('this is not really a jpeg at all');
    // and does not retry the failing render on every request
    const before = service.stats.generated;
    const again = await request(app).get('/uploads/products/corrupt.jpg?w=96');
    expect(again.status).toBe(200);
    expect(service.stats.generated).toBe(before);
    expect(thumbFiles().filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('serves the original when the input is over the pixel limit', async () => {
    // 7000 x 7000 = 49 MP > 40 MP limit; a flat PNG compresses to a tiny file.
    const file = path.join(tmp, 'products/huge.png');
    await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toFile(file);
    const res = await request(app).get('/uploads/products/huge.png?w=96').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.length).toBe(fs.statSync(file).size);
  }, 30000);
});

describe('concurrency', () => {
  it('Limiter runs at most N tasks at once and finishes them all in order', async () => {
    const limiter = new Limiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 15));
          running -= 1;
          order.push(i);
        })
      )
    );
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('a limiter survives a task that throws', async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('a burst of 24 different thumbnails never runs more than 2 renders at once', async () => {
    const burstDir = path.join(tmp, 'burst');
    fs.mkdirSync(burstDir, { recursive: true });
    for (let i = 0; i < 12; i++) {
      await sharp({ create: { width: 900, height: 900, channels: 3, background: { r: i * 20, g: 50, b: 90 } } }).jpeg().toFile(path.join(burstDir, `p${i}.jpg`));
    }
    const burstService = new ThumbnailService(tmp, { concurrency: 2 });
    const burstApp = express();
    burstApp.use('/uploads', createUploadsHandler(tmp, { service: burstService }));
    const calls = [];
    for (let i = 0; i < 12; i++) for (const w of [96, 240]) calls.push(request(burstApp).get(`/uploads/burst/p${i}.jpg?w=${w}`));
    const results = await Promise.all(calls);
    expect(results.every((r) => r.status === 200 && r.headers['content-type'] === 'image/webp')).toBe(true);
    expect(burstService.stats.generated).toBe(24);
    expect(burstService.stats.peakActive).toBeLessThanOrEqual(2);
    expect(burstService.stats.peakActive).toBeGreaterThan(0);
  }, 30000);
});

describe('deleting an original removes its thumbnails', () => {
  it('LocalDiskStorage.delete drops the file and its cached thumbnails, and nothing else', async () => {
    const storage = new LocalDiskStorage(tmp, '/uploads', 'http://media.test');
    await request(app).get('/uploads/products/small.jpg?w=96');
    await request(app).get('/uploads/products/small.jpg?w=160');
    await request(app).get('/uploads/products/big.jpg?w=96');
    const before = thumbFiles();
    const dirsBefore = new Set(before.map((f) => path.dirname(f)));
    expect(before.length).toBeGreaterThanOrEqual(3);

    await storage.delete('products/small.jpg');
    expect(fs.existsSync(path.join(tmp, 'products/small.jpg'))).toBe(false);
    const after = thumbFiles();
    // The whole per-file directory (every width of small.jpg) is gone; others stay.
    const dirsAfter = new Set(after.map((f) => path.dirname(f)));
    expect(dirsBefore.size - dirsAfter.size).toBe(1);
    expect(before.length - after.length).toBeGreaterThanOrEqual(2);
    // big.jpg's thumbnails survive
    const stillThere = await request(app).get('/uploads/products/big.jpg?w=96');
    expect(stillThere.status).toBe(200);

    // removeThumbnails on a file that never had any is harmless
    await expect(removeThumbnails(tmp, 'products/never-existed.jpg')).resolves.toBeUndefined();
    await expect(removeThumbnails(tmp, '')).resolves.toBeUndefined();
  });
});

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
