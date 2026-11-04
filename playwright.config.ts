import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/ui', testIgnore:'**/._*', timeout:30000,
  use:{baseURL:'http://127.0.0.1:5186',viewport:{width:375,height:812},trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 5186',url:'http://127.0.0.1:5186',reuseExistingServer:!process.env.CI},
  workers:1
});
