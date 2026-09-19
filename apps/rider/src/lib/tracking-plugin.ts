import { registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin, CallbackError, Location } from '@capacitor-community/background-geolocation';

export type TrackingPermissionState = 'not_requested' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface TrackingPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: Date;
}

export interface TrackingPlugin {
  checkPermission(): Promise<TrackingPermissionState>;
  requestPermission(): Promise<TrackingPermissionState>;
  start(
    onPoint: (p: TrackingPoint) => void,
    onError: (code: 'permission_denied' | 'position_unavailable') => void
  ): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The installed @capacitor-community/background-geolocation@1.2.26 package
 * has NO `checkPermissions()`/`requestPermissions()` methods of its own -
 * neither in its native Android/iOS plugin classes nor in its
 * `definitions.d.ts`. Its only exported operations are `addWatcher`,
 * `removeWatcher`, and `openSettings` (confirmed by reading
 * node_modules/@capacitor-community/background-geolocation/README.md and
 * definitions.d.ts, and the Android native source at
 * android/src/main/java/.../BackgroundGeolocation.java).
 *
 * However, every Capacitor native plugin declared with a
 * `@CapacitorPlugin(permissions = ...)` annotation - which this plugin's
 * Android class is - automatically inherits generic `checkPermissions()`
 * and `requestPermissions()` bridge methods for free from Capacitor's base
 * `Plugin` class (see @capacitor/android's Plugin.java: `checkPermissions`
 * and `requestPermissions` around lines 777-867), even though the
 * community plugin's own TypeScript definitions never declare them. They
 * resolve to `{ location: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }`
 * (the alias "location" is the one this plugin declares for
 * ACCESS_COARSE_LOCATION/ACCESS_FINE_LOCATION). We call them via a local,
 * loosely-typed interface since the plugin's own .d.ts doesn't expose them.
 */
interface WithAutoPermissions {
  checkPermissions(): Promise<{ location: string }>;
  requestPermissions(): Promise<{ location: string }>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin & WithAutoPermissions>(
  'BackgroundGeolocation'
);

function mapPermissionState(state: string | undefined): TrackingPermissionState {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    case 'prompt-with-rationale':
      return 'not_requested';
    default:
      return 'unavailable';
  }
}

let watcherId: string | null = null;

/**
 * Real Capacitor adapter (plan §D.1). This is the ONLY file in the Rider
 * app allowed to import `@capacitor-community/background-geolocation`
 * directly - swapping plugins later touches only this file.
 */
export const capacitorTrackingPlugin: TrackingPlugin = {
  async checkPermission() {
    try {
      const result = await BackgroundGeolocation.checkPermissions();
      return mapPermissionState(result.location);
    } catch {
      return 'unavailable';
    }
  },

  async requestPermission() {
    try {
      const result = await BackgroundGeolocation.requestPermissions();
      return mapPermissionState(result.location);
    } catch {
      return 'unavailable';
    }
  },

  async start(onPoint, onError) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Cancel to stop sharing your location for this delivery.',
        backgroundTitle: 'Sharing your location',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (position?: Location, error?: CallbackError) => {
        if (error) {
          onError(error.code === 'NOT_AUTHORIZED' ? 'permission_denied' : 'position_unavailable');
          return;
        }
        if (!position) return;
        onPoint({
          latitude: position.latitude,
          longitude: position.longitude,
          accuracy: position.accuracy,
          capturedAt: position.time ? new Date(position.time) : new Date(),
        });
      }
    );
  },

  async stop() {
    if (watcherId === null) return;
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
    watcherId = null;
  },
};
