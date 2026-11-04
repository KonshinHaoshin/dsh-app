import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'moe.shelterhub.dsh', appName: 'DSH', webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#ffffff', allowMixedContent: true },
  ios: { backgroundColor: '#ffffff', contentInset: 'automatic' }
};
export default config;
