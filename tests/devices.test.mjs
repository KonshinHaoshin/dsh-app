import test from 'node:test';
import assert from 'node:assert/strict';
import {DEVICES_KEY,ACTIVE_DEVICE_KEY,credentialKey,loadDevices,saveDevices,serializeDevices,upsertDevice} from '../src/devices.ts';
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const profile={url:'https://one.test',deviceId:'same-device',token:'test-only-computer-token-0001',mode:'public',name:'电脑'};
test('legacy connections migrate once with separate credentials and workspace namespace',()=>{
  const local=storage(),session=storage();local.setItem('dsh.connection',JSON.stringify(profile));local.setItem('dsh.workspace.same-device','workspace-a');session.setItem('dsh.token',profile.token);
  const [first]=loadDevices(local,session);assert.equal(first.token,profile.token);assert.equal(session.getItem(credentialKey(first.key)),profile.token);
  assert.equal(local.getItem('dsh.workspace.'+first.key),'workspace-a');assert.equal(local.getItem(ACTIVE_DEVICE_KEY),first.key);
  assert.equal(local.getItem(DEVICES_KEY).includes(profile.token),false);assert.equal(loadDevices(local,session)[0].key,first.key);
});
test('different computers retain identity even with duplicate IDs, names and shared credentials',()=>{
  const first=upsertDevice([],profile,'first').device;
  const result=upsertDevice([first],{...profile,url:'https://two.test'},'second');assert.equal(result.devices.length,2);assert.equal(result.device.key,'second');
  const replacement=upsertDevice(result.devices,{...profile,token:'replacement-computer-token-0002'},'unused');assert.equal(replacement.devices.length,2);assert.equal(replacement.device.key,'first');assert.equal(replacement.devices[1].token,profile.token);
});
test('saved metadata never serializes tokens and separate browser sessions need their own credentials',()=>{
  const local=storage(),session=storage();const first=upsertDevice([],profile,'first').device;
  saveDevices(local,[first]);assert.equal(local.getItem(DEVICES_KEY).includes('token'),false);assert.equal(loadDevices(local,session)[0].token,'');
  session.setItem(credentialKey('first'),profile.token);assert.equal(loadDevices(local,session)[0].token,profile.token);
  local.setItem(DEVICES_KEY,JSON.stringify([{...first,token:'untrusted-stored-secret'}]));session.removeItem(credentialKey('first'));assert.equal(loadDevices(local,session)[0].token,'');
});
test('a durable native registry overrides a stale WebView cache after an immediate process restart',()=>{
  const local=storage(),session=storage();const first=upsertDevice([],profile,'first').device;const devices=upsertDevice([first],{...profile,url:'https://two.test'},'second').devices;
  saveDevices(local,[first]);const restored=loadDevices(local,session,serializeDevices(devices));assert.equal(restored.length,2);assert.equal(restored[1].key,'second');assert.equal(restored.every(d=>!d.token),true);
  assert.deepEqual(loadDevices(local,session,'[]'),[]);
});
