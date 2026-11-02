import { phoneKv } from './nativeKv';

/**
 * Key-value storage. The web uses localStorage (unchanged). A phone uses the SDK 57 key-value store
 * of expo-sqlite (src/blynk/lib/nativeKv.native.ts: SQLite on disk with synchronous reads and
 * writes), so the sign-in session, cart, language and address survive a restart. When neither is
 * usable (private window, blocked storage, a failing database) it falls back to an in-memory map.
 * The API is synchronous and never throws. `get` / `set` do not use `this`: they are passed
 * around as plain functions (initialLang(storage.get)).
 */

/** The synchronous half of expo-sqlite/kv-store that this app uses. */
export type SyncKv = {
  getItemSync(key: string): string | null;
  setItemSync(key: string, value: string): void;
};

export type StorageDeps = {
  /** The browser's localStorage, or null (native, private window, blocked). */
  web: () => Storage | null;
  /** The phone's key-value store, or null on the web / where it cannot open. */
  kv: () => SyncKv | null;
};

export function createStorage({ web, kv }: StorageDeps) {
  const memory = new Map<string, string>();
  /** Last value read or written through the phone store: it is never changed behind our back. */
  const cache = new Map<string, string | null>();

  function safe<T>(f: () => T | null): T | null {
    try { return f(); } catch { return null; }
  }

  return {
    get(key: string): string | null {
      const ls = safe(web);
      if (ls) {
        try { return ls.getItem(key); } catch { /* blocked: fall through */ }
      }
      // a write the database refused is newer than whatever it still holds
      if (memory.has(key)) return memory.get(key) as string;
      if (cache.has(key)) return cache.get(key) as string | null;
      const store = safe(kv);
      if (store) {
        try {
          const v = store.getItemSync(key);
          const value = typeof v === 'string' ? v : null;
          cache.set(key, value);
          return value;
        } catch { /* the database failed: fall through */ }
      }
      return null;
    },
    set(key: string, value: string): void {
      const v = String(value);
      const ls = safe(web);
      if (ls) {
        try { ls.setItem(key, v); return; } catch { /* full or blocked: fall through */ }
      }
      const store = safe(kv);
      if (store) {
        try {
          store.setItemSync(key, v);
          cache.set(key, v);
          memory.delete(key);
          return;
        } catch { /* the database failed: keep it in memory for this run */ }
      }
      cache.delete(key);
      memory.set(key, v);
    },
  };
}

function browserStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

export const storage = createStorage({ web: browserStorage, kv: phoneKv });
