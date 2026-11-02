import { API_BASE_URL } from '../api/client';

/** True while the web page is in a background tab. Native passes its own check (AppState). */
export const documentHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;

/**
 * Calls onChange when staff change the catalogue (SSE where EventSource exists),
 * and every `pollMs` (30 s by default) as a safety net. The poll skips while `isHidden()` is true.
 */
export function startCatalogLive(onChange: () => void, isHidden: () => boolean = documentHidden, pollMs = 30_000): () => void {
  let es: EventSource | null = null;
  const ES = (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (typeof ES === 'function') {
    try {
      es = new ES(`${API_BASE_URL}/catalog/events`);
      es.addEventListener('catalog', () => onChange());
    } catch { /* no SSE: the poll still runs */ }
  }
  const poll = setInterval(() => { if (!isHidden()) onChange(); }, pollMs);
  return () => { clearInterval(poll); es?.close(); };
}
