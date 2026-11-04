// Full upgrade QA: requires an older native test build with AppUpdater installed.
// Only run in an isolated emulator with an empty connection registry.
// If Google Play Protect requests a scan, complete it in the emulator while this test waits.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const serial=process.env.DSH_QA_SERIAL??'emulator-5580',adb=process.env.ADB??'/Users/ifan/Library/Android/sdk/platform-tools/adb';
if(!serial.startsWith('emulator-'))throw Error('Upgrade QA requires a dedicated emulator');
const manifest=JSON.parse(readFileSync(new URL('../../update.json',import.meta.url),'utf8'));
function shell(...args){return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:20000});}
const wait=async(fn,label,timeout=30000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,300));}throw Error(label+' timed out');};
let browser,page,owned=false;
const native=(plugin,method,options={})=>page.evaluate(({plugin,method,options})=>window.Capacitor.nativePromise(plugin,method,options),{plugin,method,options});
async function attach(){
 shell('shell','input','keyevent','224');shell('shell','wm','dismiss-keyguard');shell('shell','am','start','-W','-n','moe.shelterhub.dsh/.MainActivity');
 let pid='';await wait(()=>{try{pid=shell('shell','pidof','moe.shelterhub.dsh').trim();return !!pid;}catch{return false;}},'App process');
 shell('forward','tcp:19227',`localabstract:webview_devtools_remote_${pid}`);
 await wait(async()=>{try{return(await(await fetch('http://127.0.0.1:19227/json')).json()).some(p=>p.url.startsWith('https://localhost'));}catch{return false;}},'WebView');
 browser=await chromium.connectOverCDP('http://127.0.0.1:19227');page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'));
 await page.reload();await page.waitForLoadState('domcontentloaded');
}
try{
 await attach();const registry=(await native('DeviceCredentials','getRegistry')).value;if(registry&&JSON.parse(registry).length)throw Error('Refusing upgrade QA with existing connections');
 const current=await native('App','getInfo');assert.notEqual(current.version,manifest.version,'Install an older test build first');
 await native('DeviceCredentials','set',{key:'qa-update-retain',value:'test-only-update-preservation-key-0001'});owned=true;
 await page.locator('.connection-pill').click();await page.getByRole('button',{name:'检查更新',exact:true}).click();
 await wait(()=>page.getByText(`发现新版本 v${manifest.version}`,{exact:true}).isVisible(),'published update discovery');console.log('App discovers the live published update PASS');
 if(!(await native('AppUpdater','status')).ready)await page.getByRole('button',{name:/下载更新/}).click();let last=-1;
 await wait(async()=>{const s=await native('AppUpdater','status');const percent=s.total?Math.floor(s.received/s.total*100):0;if(percent>=last+25){last=percent;console.log('Native APK download',percent+'%');}if(s.ready)return true;const error=await page.getByRole('alert').allTextContents();if(error.length)throw Error(error.join(';'));return false;},'verified native APK download',180000);
 const status=await native('AppUpdater','status');assert.equal(status.version,manifest.version);console.log('Native length/hash/package/version/signature validation PASS');
 // Only the QA emulator is granted installer access; Android still asks for confirmation.
 shell('shell','appops','set','moe.shelterhub.dsh','REQUEST_INSTALL_PACKAGES','allow');shell('shell','am','start','-W','-n','moe.shelterhub.dsh/.MainActivity');
 await page.getByRole('button',{name:'安装更新',exact:true}).click();
 let bounds;
 await wait(()=>{shell('shell','uiautomator','dump','/sdcard/dsh-upgrade-qa.xml');const xml=shell('shell','cat','/sdcard/dsh-upgrade-qa.xml');bounds=xml.match(/<node\b[^>]*\btext="(?:Update|Install|更新|安装)"[^>]*\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);return !!bounds;},'system update confirmation');
 shell('shell','input','tap',String(Math.floor((Number(bounds[1])+Number(bounds[3]))/2)),String(Math.floor((Number(bounds[2])+Number(bounds[4]))/2)));
 await wait(()=>shell('shell','dumpsys','package','moe.shelterhub.dsh').includes('versionName='+manifest.version),'installed version (complete any Play Protect scan in the emulator)',300000);console.log('Android system-confirmed upgrade PASS');
 try{await browser.close();}catch{}await attach();assert.equal((await native('DeviceCredentials','get',{key:'qa-update-retain'})).value,'test-only-update-preservation-key-0001');console.log('Encrypted pairing credentials survive the update PASS');
}finally{
 if(page&&owned)try{await native('DeviceCredentials','remove',{key:'qa-update-retain'});}catch{}
 if(browser)try{await browser.close();}catch{}try{shell('forward','--remove','tcp:19227');}catch{}
}
