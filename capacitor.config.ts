import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'moe.shelterhub.dsh', appName: 'DSH', webDir: 'dist',
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  plugins: { App: { disableBackButtonHandler: true } },
  android: { backgroundColor: '#ffffff', allowMixedContent: true },
  ios: { backgroundColor: '#ffffff', contentInset: 'automatic' }
};
export default config;
