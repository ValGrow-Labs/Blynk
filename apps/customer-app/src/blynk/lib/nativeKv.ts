/**
 * The phone's key-value store: none on the web and in Node (the browser's localStorage is used
 * there). The native build gets nativeKv.native.ts instead, which wraps expo-sqlite/kv-store.
 */
import type { SyncKv } from './storage';

export const phoneKv = (): SyncKv | null => null;
