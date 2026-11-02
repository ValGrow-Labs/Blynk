import Kv from 'expo-sqlite/kv-store';
import type { SyncKv } from './storage';

/** expo-sqlite's key-value store (SDK 57): persisted in SQLite, synchronous getItemSync / setItemSync. */
export const phoneKv = (): SyncKv | null => Kv;
