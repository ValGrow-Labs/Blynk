import path from 'node:path';
import express, { NextFunction, Request, Response, Router } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.middleware.js';

/**
 * Public, read-only static route for the self-hosted PMTiles archive
 * (GET /map-tiles/<name>.pmtiles).
 *
 * MapLibre Native reads a PMTiles archive with HTTP Range requests, so the
 * correctness of this route is the correctness of `express.static`'s Range
 * handling (serve-static 1.16.x on send 0.19.x): `Accept-Ranges: bytes`,
 * `206` with `Content-Range`/`Content-Length` of the slice, `416` with
 * `Content-Range: bytes * /total`, HEAD, ETag/Last-Modified and conditional
 * 304. Nothing here re-implements that; this module only narrows what can be
 * reached and fixes up the response headers.
 *
 * Deliberately absent: any compression. PMTiles offsets refer to the bytes
 * of the file as stored, and the tiles inside are already gzip-compressed,
 * so a re-encoded body would corrupt every range. `app.ts` has no
 * compression middleware and none may be added in front of this route.
 */

/** 1 hour. The file name is stable and the archive is rebuilt occasionally, so
 *  a short freshness window lets a rebuilt file propagate; ETag/Last-Modified
 *  make revalidation cheap. Not `immutable`: the name is reused. */
export const MAP_TILES_MAX_AGE = '1h';

const PMTILES_PATH = /\.pmtiles$/;

interface StaticError extends Error {
  status?: number;
  statusCode?: number;
  headers?: Record<string, string | number>;
}

export function createMapTilesRouter(root: string = env.MAP_TILES_DIR): Router {
  const router = Router();

  // Only *.pmtiles names are ever handed to the file server, so the README
  // and anything else that lands in the directory is unreachable. Leaving the
  // router (rather than answering) falls through to the app's normal 404.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!PMTILES_PATH.test(req.path)) return next('router');
    return next();
  });

  router.use(
    express.static(path.resolve(root), {
      maxAge: MAP_TILES_MAX_AGE, // Cache-Control: public, max-age=3600
      index: false, // no directory index
      redirect: false, // no directory redirect
      dotfiles: 'ignore', // dotfiles are 404
      // Errors are forwarded (not swallowed into a fall-through 404) so that a
      // Range problem surfaces as a real 416. serve-static itself answers
      // 405 + `Allow: GET, HEAD` for other methods when fallthrough is false.
      fallthrough: false,
      setHeaders: (res) => {
        // Helmet defaults every response to same-origin CORP. Map data is
        // public and non-credentialed, so - as for /uploads - it is marked
        // cross-origin here, and only here.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    })
  );

  // send reports 404/403/400/416 as errors. Turn them into the API's standard
  // error envelope, and re-apply the headers send attached to the error: the
  // global error handler would otherwise drop `Content-Range: bytes */total`
  // from a 416.
  router.use((err: StaticError, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status ?? err.statusCode;
    if (typeof status !== 'number' || status < 400 || status >= 500) return next(err);

    // send has already stamped the archive's Content-Type on the response;
    // clear it so the JSON error body is not mislabelled as octet-stream.
    res.removeHeader('Content-Type');
    for (const [name, value] of Object.entries(err.headers ?? {})) {
      res.setHeader(name, value);
    }
    if (status === 416) {
      return next(new AppError('Requested range not satisfiable', 416, 'RANGE_NOT_SATISFIABLE'));
    }
    if (status === 404) {
      return next(new AppError('Map tile archive not found', 404, 'NOT_FOUND'));
    }
    return next(new AppError('Map tile request rejected', status, 'BAD_REQUEST'));
  });

  return router;
}

export const mapTilesRouter = createMapTilesRouter();
