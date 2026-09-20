import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'lk.blynk.rider',
  appName: 'Blynk Rider',
  webDir: 'dist',
  android: {
    useLegacyBridge: true
  },
  plugins: {
    // Patches global fetch/XMLHttpRequest to native HTTP on Android. Without it the
    // WebView throttles requests ~5 min after the app is backgrounded, which would
    // silently stop location POSTs while the screen is locked (background-geolocation
    // README + issue #14).
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
