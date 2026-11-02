import * as Location from 'expo-location';
import { createNativePosition } from './nativePosition';
import { locateWith } from './position';

export * from './position';
export const getCurrentPosition = createNativePosition(Location);

/** Resolves a fix, rejects with { code } like the browser (so area/flow.ts gpsFailureOf keeps working). */
export const phoneLocateOnce: (() => Promise<{ lat: number; lng: number }>) | null = () => locateWith(getCurrentPosition);
