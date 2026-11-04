import type {ConnectionProfile,ConnectionState} from './types.ts';
export type SavedDevice=ConnectionProfile&{key:string;enabled:boolean;alias?:string};
export type DeviceStatus={state:ConnectionState;error:string;name:string;approvals:number};
export const DEVICES_KEY='dsh.devices.v1';
export const ACTIVE_DEVICE_KEY='dsh.active-device';
export const DEFAULT_PROFILE:ConnectionProfile={url:'https://dshapi.shelterhub.moe',deviceId:'',token:'',mode:'public'};
export const credentialKey=(key:string)=>'dsh.device-token.'+key;
export const deviceName=(device:SavedDevice)=>device.alias||device.name||device.deviceId;
export function normalizeProfile(profile:ConnectionProfile):ConnectionProfile{
  if(!['public','lan'].includes(profile.mode))throw new Error('连接方式无效');
  const url=new URL(profile.url);
  if(url.protocol==='ws:')url.protocol='http:';if(url.protocol==='wss:')url.protocol='https:';
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||profile.mode==='public'&&url.protocol!=='https:')throw new Error('请输入有效的连接地址；公网需要 HTTPS');
  if(!/^[-\w]{3,80}$/.test(profile.deviceId)||typeof profile.token!=='string')throw new Error('设备 ID 格式无效');
  return {url:url.origin,deviceId:profile.deviceId,token:profile.token,mode:profile.mode,name:profile.name?.slice(0,100)};
}
export function saveDevices(storage:Storage,devices:SavedDevice[]){
  storage.setItem(DEVICES_KEY,serializeDevices(devices));
}
export const serializeDevices=(devices:SavedDevice[])=>JSON.stringify(devices.map(({key,url,deviceId,mode,name,alias,enabled})=>({key,url,deviceId,mode,name,alias,enabled})));
export function loadDevices(storage:Storage,session:Storage,registry?:string):SavedDevice[]{
  const saved=registry??storage.getItem(DEVICES_KEY);
  if(saved!==null){
    try{const records=JSON.parse(saved);if(!Array.isArray(records))return [];
      return records.flatMap((r:any)=>{try{if(!r||typeof r.key!=='string'||!/^[-\w]{1,100}$/.test(r.key)||!['lan','public'].includes(r.mode))return [];return [{...normalizeProfile({...r,token:session.getItem(credentialKey(r.key))??''}),key:r.key,enabled:r.enabled!==false,...typeof r.alias==='string'?{alias:r.alias.slice(0,80)}:{}}];}catch{return [];}});
    }catch{return [];}
  }
  try{
    const old=JSON.parse(storage.getItem('dsh.connection')??'null');if(!old?.deviceId)return [];
    const device:SavedDevice={...normalizeProfile({...old,token:session.getItem('dsh.token')??''}),key:crypto.randomUUID(),enabled:true};
    const workspace=storage.getItem('dsh.workspace.'+device.deviceId);if(workspace!==null)storage.setItem('dsh.workspace.'+device.key,workspace);
    if(device.token)session.setItem(credentialKey(device.key),device.token);
    saveDevices(storage,[device]);storage.setItem(ACTIVE_DEVICE_KEY,device.key);return [device];
  }catch{return [];}
}
export function upsertDevice(devices:SavedDevice[],profile:ConnectionProfile,newKey=crypto.randomUUID()):{devices:SavedDevice[];device:SavedDevice}{
  const next=normalizeProfile(profile);if(next.token.length<24)throw new Error('配对密钥至少 24 位');
  const previous=devices.find(d=>d.deviceId===next.deviceId&&d.url===next.url);
  const device:SavedDevice={...previous,...next,name:next.name||previous?.name,key:previous?.key??newKey,enabled:true};
  return {device,devices:previous?devices.map(d=>d.key===previous.key?device:d):[...devices,device]};
}
