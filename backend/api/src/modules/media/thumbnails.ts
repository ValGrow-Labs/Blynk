import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import sharp from 'sharp';
import { logger } from '../../utils/logger.js';

/**
 * On-the-fly thumbnails for /uploads (owner request, 2026-11-02: the customer
 * app was slow because product pictures were full-size originals).
 *
 *   GET /uploads/<any image path>?w=<width>   ->  resized WebP
 *
 * Rules:
 *  - `w` must be a whole number 1..960, else 400 INVALID_WIDTH (no `w` at all
 *    = the untouched original, exactly as before). It is rounded UP to the
 *    nearest allowed width (96, 160, 240, 320, 480, 640, 960), and an image is
 *    never enlarged: a 200 px wide original asked for w=480 comes back 200 px
 *    wide.
 *  - Only jpg/jpeg/png/webp files that exist under MEDIA_ROOT. Anything else
 *    (other extension, missing file) falls through to the static handler:
 *    the original or a 404, as it always was.
 *  - A path that tries to leave MEDIA_ROOT (.., encoded or not, backslashes,
 *    null bytes, a symlink pointing outside) is 400 INVALID_PATH. Any dot
 *    segment is refused, which also keeps `.thumbs` itself unreachable.
 *  - Any sharp failure (corrupt file, bigger than MAX_INPUT_PIXELS, ...) falls
 *    through to the static handler, i.e. the original is served. Never a 500.
 *
 * Cache: MEDIA_ROOT/.thumbs/<sha1 of the file's relative path>/<w>-<mtimeMs>-<size>.webp,
 * written atomically (temp file then rename). Because the key contains the
 * original's mtime and size, replacing a file re-renders it; and because the
 * directory is keyed by the file's path, deleting an original can drop all of
 * its thumbnails at once (removeThumbnails, called by LocalDiskStorage.delete).
 * express.static never serves dot directories (dotfiles: 'ignore').
 */

export const ALLOWED_WIDTHS = [96, 160, 240, 320, 480, 640, 960] as const;
export const THUMBS_DIR_NAME = '.thumbs';
export const THUMB_QUALITY = 78;
/** ~40 megapixels (e.g. 6300 x 6300); bigger inputs are served as the original. */
export const MAX_INPUT_PIXELS = 40_000_000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_BAD_ENTRIES = 1000;

// A small VPS: one libvips thread per operation, a small operation cache.
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });

/** The allowed width to render for a requested one, or null when invalid. */
export function snapWidth(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) return null;
  const requested = Number(raw);
  if (requested < 1) return null;
  return ALLOWED_WIDTHS.find((w) => w >= requested) ?? null;
}

export class InvalidPathError extends Error {}

/**
 * Turns the part of the URL after /uploads into a clean list of segments, or
 * throws InvalidPathError. Pure string checks; the filesystem checks (symlinks)
 * happen in ThumbnailService.
 */
export function parseUploadPath(urlPath: string): string[] {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    throw new InvalidPathError('Bad encoding');
  }
  if (decoded.includes('\0') || decoded.includes('\\')) throw new InvalidPathError('Bad characters');
  const segments = decoded.split('/').filter((s) => s !== '');
  if (!segments.length) throw new InvalidPathError('Empty path');
  // Dot segments: '..', '.', '.thumbs', '.env' ... none is ever a media file.
  if (segments.some((s) => s.startsWith('.'))) throw new InvalidPathError('Dot segment');
  return segments;
}

const pathHash = (relPosix: string) => crypto.createHash('sha1').update(relPosix).digest('hex');

/** Deletes every cached thumbnail of a media key such as "products/ab12.webp". Best effort. */
export async function removeThumbnails(root: string, key: string): Promise<void> {
  try {
    const rel = key.split(/[\\/]+/).filter(Boolean).join('/');
    if (!rel) return;
    await fs.promises.rm(path.join(path.resolve(root), THUMBS_DIR_NAME, pathHash(rel)), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, key }, 'Could not remove cached thumbnails');
  }
}

/** Runs at most `limit` tasks at once; the rest wait in FIFO order. */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export interface ThumbnailStats {
  /** Thumbnails rendered with sharp since startup. */
  generated: number;
  /** The most renders that ever ran at the same moment. */
  peakActive: number;
}

export class ThumbnailService {
  private readonly root: string;
  private readonly thumbsRoot: string;
  private readonly limiter: Limiter;
  private readonly inFlight = new Map<string, Promise<string | null>>();
  /** Cache keys whose original could not be resized: don't retry on every request. */
  private readonly bad = new Set<string>();
  private active = 0;
  readonly stats: ThumbnailStats = { generated: 0, peakActive: 0 };

  constructor(root: string, opts: { concurrency?: number } = {}) {
    this.root = path.resolve(root);
    this.thumbsRoot = path.join(this.root, THUMBS_DIR_NAME);
    this.limiter = new Limiter(opts.concurrency ?? 2);
  }

  get cacheRoot(): string {
    return this.thumbsRoot;
  }

  /**
   * The path of the thumbnail file *relative to cacheRoot* (rendering it first
   * when needed), or null when the request should fall back to the static
   * handler (missing file, not an image, resize failed). Throws
   * InvalidPathError for traversal attempts.
   */
  async thumbnailFor(segments: string[], width: number): Promise<string | null> {
    if (!IMAGE_EXTENSIONS.has(path.extname(segments[segments.length - 1]).toLowerCase())) return null;

    const absolute = path.join(this.root, ...segments);
    const lexical = path.relative(this.root, absolute);
    if (!lexical || lexical.startsWith('..') || path.isAbsolute(lexical)) throw new InvalidPathError('Outside root');

    let real: string;
    let realRoot: string;
    let stat: fs.Stats;
    try {
      realRoot = await fs.promises.realpath(this.root);
      real = await fs.promises.realpath(absolute);
      stat = await fs.promises.stat(real);
    } catch {
      return null; // missing: the static handler answers 404
    }
    const realRelative = path.relative(realRoot, real);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new InvalidPathError('Symlink escapes root');
    }
    // A symlink into .thumbs (or any dot directory) is no original either.
    if (realRelative.split(path.sep).some((s) => s.startsWith('.'))) throw new InvalidPathError('Dot segment');
    if (!stat.isFile()) return null;

    const dir = pathHash(segments.join('/'));
    const name = `${width}-${Math.round(stat.mtimeMs)}-${stat.size}.webp`;
    const relative = `${dir}/${name}`;
    const cached = path.join(this.thumbsRoot, dir, name);

    try {
      if ((await fs.promises.stat(cached)).isFile()) return relative;
    } catch {
      /* not cached yet */
    }
    if (this.bad.has(relative)) return null;

    let pending = this.inFlight.get(relative);
    if (!pending) {
      pending = this.render(real, cached, dir, width, relative).finally(() => this.inFlight.delete(relative));
      this.inFlight.set(relative, pending);
    }
    return pending;
  }

  private render(source: string, destination: string, dir: string, width: number, relative: string): Promise<string | null> {
    return this.limiter.run(async () => {
      this.active += 1;
      this.stats.peakActive = Math.max(this.stats.peakActive, this.active);
      let temp = '';
      try {
        // Read into memory (originals are capped at 2 MB on upload) so no file
        // handle or memory map stays open on the original: it can be replaced
        // or deleted at any time, including on Windows development machines.
        const input = await fs.promises.readFile(source);
        const output = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
          .rotate() // apply EXIF orientation
          .resize({ width, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: THUMB_QUALITY })
          .toBuffer();
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        temp = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        await fs.promises.writeFile(temp, output);
        await fs.promises.rename(temp, destination);
        this.stats.generated += 1;
        void this.dropStaleVersions(dir, width, path.basename(destination));
        return relative;
      } catch (err) {
        if (temp) await fs.promises.rm(temp, { force: true }).catch(() => undefined);
        if (this.bad.size >= MAX_BAD_ENTRIES) this.bad.clear();
        this.bad.add(relative);
        logger.warn({ err, source }, 'Thumbnail failed; serving the original instead');
        return null;
      } finally {
        this.active -= 1;
      }
    });
  }

  /** The original was replaced: remove this width's thumbnails of older versions. */
  private async dropStaleVersions(dir: string, width: number, keep: string): Promise<void> {
    try {
      const folder = path.join(this.thumbsRoot, dir);
      for (const file of await fs.promises.readdir(folder)) {
        if (file !== keep && file.startsWith(`${width}-`) && file.endsWith('.webp')) {
          await fs.promises.rm(path.join(folder, file), { force: true });
        }
      }
    } catch {
      /* best effort */
    }
  }
}

/** Headers every /uploads response carries (originals and thumbnails alike). */
export function setMediaHeaders(res: Response): void {
  // Helmet defaults every response to same-origin CORP, which stops the admin
  // web app (a different origin) from displaying these images. Media is
  // public, non-credentialed content, so it is marked cross-origin here - and
  // only here.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

export function thumbnailMiddleware(service: ThumbnailService): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.query.w === undefined || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

    const width = snapWidth(req.query.w);
    if (width === null) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_WIDTH', message: `w must be a whole number from 1 to ${ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1]}` },
      });
      return;
    }

    try {
      const relative = await service.thumbnailFor(parseUploadPath(req.path), width);
      if (!relative) return next();
      setMediaHeaders(res);
      res.sendFile(relative, { root: service.cacheRoot, dotfiles: 'allow', maxAge: '7d', etag: true, lastModified: true }, (err) => {
        // Headers already sent = the client went away; otherwise the original.
        if (err && !res.headersSent) next();
      });
    } catch (err) {
      if (err instanceof InvalidPathError) {
        res.status(400).json({ success: false, error: { code: 'INVALID_PATH', message: 'Invalid media path' } });
        return;
      }
      logger.warn({ err }, 'Thumbnail handler failed; serving the original instead');
      next();
    }
  };
}

/**
 * Everything mounted at /uploads: thumbnails (requests with ?w=) first, then
 * the static originals. Dot files and directories (.thumbs) are never served.
 */
export function createUploadsHandler(root: string, opts: { service?: ThumbnailService } = {}): Router {
  const router = express.Router();
  router.use(thumbnailMiddleware(opts.service ?? new ThumbnailService(root)));
  router.use(
    express.static(root, {
      maxAge: '7d',
      index: false,
      dotfiles: 'ignore',
      setHeaders: setMediaHeaders,
    })
  );
  return router;
}
