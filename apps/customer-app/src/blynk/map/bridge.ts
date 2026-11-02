import { encodeToPage, isValidToPage, parseFromPage, type FromPage, type ToPage } from './protocol';

/*
 * The app's side of the map page, with no React Native in it so it can be tested in Node: it owns the
 * loading / ready / failed state, the "no map within 15 s means failed" timer, the queue of commands
 * sent before the page said `ready` (the newest of each kind wins), and reads every message the page
 * posts (ignoring anything that is not ours). NativeMapView.tsx wires `inject` to the WebView.
 */

export type MapState = 'loading' | 'ready' | 'failed';

/** A map that has not drawn by then counts as failed (slow CDN, slow tiles, no signal): the retry fallback shows. */
export const LOAD_TIMEOUT_MS = 15_000;
/** At most this many commands wait for the page. */
export const MAX_QUEUE = 64;

export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Commands of one kind replace each other while waiting (a second camera move makes the first pointless). */
function coalesceKey(m: ToPage): string {
  switch (m.t) {
    case 'camera': case 'fit': return 'camera';
    case 'setData': return `data:${m.id}`;
    case 'marker': case 'removeMarker': return `marker:${m.id}`;
    default: return m.t;
  }
}

export type MapBridge = {
  /** Start the load timer (safe to call again after `stop`, e.g. React strict-mode effects). */
  start(): void;
  /** Stop the timer; nothing more is sent. */
  stop(): void;
  /** Send now when the page is ready, else queue. Invalid messages are dropped. */
  send(msg: ToPage): void;
  /** A raw string from the WebView's onMessage. */
  receive(raw: unknown): void;
  /** The WebView itself failed (page error, render process gone). */
  fail(why: string): void;
  state(): MapState;
};

export function createMapBridge(o: {
  inject: (js: string) => void;
  onState: (s: MapState, why?: string) => void;
  onEvent: (e: Exclude<FromPage, { t: 'ready' } | { t: 'error' }>) => void;
  timeoutMs?: number;
  timers?: Timers;
}): MapBridge {
  const timers = o.timers ?? realTimers;
  const timeoutMs = o.timeoutMs ?? LOAD_TIMEOUT_MS;
  let state: MapState = 'loading';
  let stopped = false;
  let timer: unknown = null;
  let queue: ToPage[] = [];

  const clearTimer = () => { if (timer !== null) { timers.clear(timer); timer = null; } };
  const set = (s: MapState, why?: string) => {
    if (state === s) return;
    state = s;
    clearTimer();
    if (s === 'failed') queue = [];
    o.onState(s, why);
  };
  const dispatch = (m: ToPage) => {
    try { o.inject(encodeToPage(m)); } catch { /* the page is gone; the load timer or the WebView's own error reports it */ }
  };

  return {
    start() {
      stopped = false;
      if (state === 'loading' && timer === null) timer = timers.set(() => { timer = null; set('failed', 'timeout'); }, timeoutMs);
    },
    stop() {
      stopped = true;
      clearTimer();
    },
    send(msg) {
      if (stopped || state === 'failed' || !isValidToPage(msg)) return;
      if (state === 'ready') { dispatch(msg); return; }
      const key = coalesceKey(msg);
      queue = queue.filter((q) => coalesceKey(q) !== key);
      queue.push(msg);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
    receive(raw) {
      if (stopped) return;
      const m = parseFromPage(raw);
      if (!m) return;
      if (m.t === 'ready') {
        if (state !== 'loading') return;
        set('ready');
        const waiting = queue;
        queue = [];
        waiting.forEach(dispatch);
        return;
      }
      if (m.t === 'error') {
        if (state === 'loading') set('failed', m.reason);
        return;
      }
      o.onEvent(m);
    },
    fail(why) {
      if (!stopped && state !== 'failed') set('failed', why);
    },
    state: () => state,
  };
}
