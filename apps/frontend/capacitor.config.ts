import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arrow.puzzle',
  appName: 'Arrow Puzzle',
  webDir: 'dist',
  android: {
    path: 'mobile/android',
  },
  ios: {
    path: 'mobile/ios',
  },
};

export default config;
