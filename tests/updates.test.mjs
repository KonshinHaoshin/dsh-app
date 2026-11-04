import test from 'node:test';
import assert from 'node:assert/strict';
import {isNewerVersion,parseAppUpdate,fetchAppUpdate,UPDATE_MANIFEST_URL} from '../src/updates.ts';
const update={schemaVersion:1,appId:'moe.shelterhub.dsh',version:'0.3.0',versionCode:3,notes:'推理强度和检查更新',android:{url:'https://raw.githubusercontent.com/KonshinHaoshin/dsh-app/v0.3.0/releases/v0.3.0/dsh-mobile-0.3.0-debug.apk',sha256:'a'.repeat(64),size:34000000}};
test('version comparison handles numeric segments and avoids downgrades',()=>{
  assert.equal(isNewerVersion('0.3.10','0.3.9'),true);assert.equal(isNewerVersion('1.0.0','0.99.99'),true);
  assert.equal(isNewerVersion('0.3.0','0.3.0'),false);assert.equal(isNewerVersion('0.2.0','0.3.0'),false);
});
test('update manifests accept only the app release download and reject untrusted URLs',()=>{
  assert.deepEqual(parseAppUpdate(update),update);
  for(const url of ['http://raw.githubusercontent.com/KonshinHaoshin/dsh-app/v0.3.0/releases/v0.3.0/app.apk','https://untrusted.example/app.apk','https://raw.githubusercontent.com/other/repo/v0.3.0/releases/v0.3.0/app.apk',update.android.url+'?token=secret'])assert.throws(()=>parseAppUpdate({...update,android:{...update.android,url}}));
  assert.throws(()=>parseAppUpdate({...update,appId:'another.app'}));
});
test('manual update check omits credentials, bypasses cache and surfaces network errors',async()=>{
  const latest=await fetchAppUpdate(async(url,options)=>{assert.equal(url,UPDATE_MANIFEST_URL);assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');return Response.json(update);});
  assert.equal(latest.version,'0.3.0');
  await assert.rejects(()=>fetchAppUpdate(async()=>new Response('',{status:503})),/503/);
});

test('manifest download version and size must match the declared release',()=>{
 assert.throws(()=>parseAppUpdate({...update,version:'0.4.0'}),/不受信任/);
 assert.throws(()=>parseAppUpdate({...update,android:{...update.android,size:121*1024*1024}}),/格式/);
});
