import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'lk.blynk.rider',
  appName: 'Blynk Rider',
  webDir: 'dist',
  android: {
    useLegacyBridge: true
  }
};

export default config;
