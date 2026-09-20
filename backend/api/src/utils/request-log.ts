/**
 * Which requests the per-request access log (pino-http) skips.
 *
 * A MapLibre session reads the PMTiles archive with one small HTTP Range
 * request per tile, so a single map screen produces dozens to hundreds of
 * identical `info` lines that carry no signal. Those requests are not logged
 * on success. Failures still are: a tile error (404/416, or a 5xx) goes through
 * errorMiddleware, which logs client errors at `warn` and server errors at
 * `error` regardless of this predicate, and the http metrics counters
 * (http-metrics.middleware.ts - counters only, never log lines) still count
 * every tile request.
 */
const QUIET_PREFIXES = ['/map-tiles/'];

export function shouldIgnoreRequestLog(req: { url?: string; originalUrl?: string }): boolean {
  const url = req.originalUrl ?? req.url ?? '';
  return QUIET_PREFIXES.some((prefix) => url.startsWith(prefix));
}
