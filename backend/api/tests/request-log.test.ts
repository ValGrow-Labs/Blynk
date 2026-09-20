import { describe, it, expect } from 'vitest';
import { shouldIgnoreRequestLog } from '../src/utils/request-log.js';

describe('access-log ignore predicate (map tile Range requests)', () => {
  it('skips requests for the tile archive, ranged or not, with or without a query', () => {
    expect(shouldIgnoreRequestLog({ url: '/map-tiles/blynk-service-area.pmtiles' })).toBe(true);
    expect(shouldIgnoreRequestLog({ url: '/map-tiles/blynk-service-area.pmtiles?x=1' })).toBe(true);
    expect(shouldIgnoreRequestLog({ originalUrl: '/map-tiles/other.pmtiles', url: '/other.pmtiles' })).toBe(true);
  });

  it('keeps logging everything else, including look-alike paths', () => {
    expect(shouldIgnoreRequestLog({ url: '/api/v1/orders' })).toBe(false);
    expect(shouldIgnoreRequestLog({ url: '/api/v1/map-tiles/x.pmtiles' })).toBe(false);
    expect(shouldIgnoreRequestLog({ url: '/map-tiles' })).toBe(false);
    expect(shouldIgnoreRequestLog({ url: '/map-tilesX/a' })).toBe(false);
    expect(shouldIgnoreRequestLog({ url: '/health' })).toBe(false);
    expect(shouldIgnoreRequestLog({})).toBe(false);
  });
});
