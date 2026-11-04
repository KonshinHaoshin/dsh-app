import {test,expect} from '@playwright/test';
const manifest={schemaVersion:1,appId:'moe.shelterhub.dsh',version:'0.4.0',versionCode:4,notes:'改进推理强度与更新体验',android:{url:'https://raw.githubusercontent.com/KonshinHaoshin/dsh-app/v0.4.0/releases/v0.4.0/dsh-mobile-0.4.0-debug.apk',sha256:'a'.repeat(64),size:34000000}};
test('manual checks show a new version and open the official APK download',async({page})=>{
  await page.addInitScript(()=>{window.open=((url:unknown)=>{(window as any).__download=String(url);return null;}) as typeof window.open;});
  await page.route('**/dsh-app/main/update.json',route=>route.fulfill({json:manifest}));
  await page.goto('/');await page.getByRole('button',{name:'连接 DSH',exact:true}).click();
  await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByText('发现新版本 v0.4.0')).toBeVisible();
  await expect(page.getByText(manifest.notes,{exact:true})).toBeVisible();await page.getByRole('button',{name:/下载更新/}).click();
  await page.screenshot({path:'artifacts/mobile-update-v03.png'});
  await expect.poll(()=>page.evaluate(()=>(window as any).__download)).toBe(manifest.android.url);
});
test('latest version and network failure are visible and retryable without a DSH connection',async({page})=>{
  let fail=true;await page.route('**/dsh-app/main/update.json',route=>fail?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:{...manifest,version:'0.3.0',versionCode:3}}));
  await page.goto('/');await page.getByRole('button',{name:'连接 DSH',exact:true}).click();await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByRole('alert')).toContainText('503');
  fail=false;await page.getByRole('button',{name:'检查更新',exact:true}).click();await expect(page.getByText('已是最新版本',{exact:true})).toBeVisible();
});
