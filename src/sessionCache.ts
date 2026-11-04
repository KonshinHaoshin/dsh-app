import {Capacitor,registerPlugin} from '@capacitor/core';
import {browserVault} from './browserVault';
import {CACHE_COUNT_LIMIT,CACHE_TOTAL_LIMIT,CACHE_TTL,decodeCache,encodeCache,journalPreview,hostPreview,validJournal} from './cachePolicy';
import type {SavedDevice} from './devices';
import type {JournalState} from './transcript';
import type {Session,Workspace} from './types';
const native=registerPlugin<{get(o:{key:string}):Promise<{value:string|null}>;set(o:{key:string;value:string}):Promise<void>;removeDevice(o:{prefix:string}):Promise<void>}>('SessionCache');
const memory=new Map<string,string>();let dbPromise:Promise<IDBDatabase>|undefined;
const dropped=new Set<string>(),revisions=new Map<string,number>();
const revision=(d:SavedDevice)=>revisions.get(d.key)??0;
export function restoreCache(d:SavedDevice){dropped.delete(cacheOwner(d));}
function db(){return dbPromise??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('dsh-session-cache-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('entries',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=undefined;reject(r.error);};});}
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export const cacheOwner=(d:SavedDevice)=>JSON.stringify([d.key,d.url,d.deviceId,d.token]);
const memKey=(d:SavedDevice,id:string)=>JSON.stringify([cacheOwner(d),id]);
async function diskKey(d:SavedDevice,id:string){return await hash(d.key)+'.'+await hash(JSON.stringify([d.url,d.deviceId,d.token,id]));}
function remember(key:string,raw:string){memory.delete(key);memory.set(key,raw);let total=[...memory.values()].reduce((n,s)=>n+s.length*2,0);while(memory.size>CACHE_COUNT_LIMIT||total>CACHE_TOTAL_LIMIT){const oldest=memory.keys().next().value!;total-=memory.get(oldest)!.length*2;memory.delete(oldest);}}
async function readDisk(key:string){
 if(Capacitor.getPlatform()==='android')return (await native.get({key})).value;
 const database=await db();const entry:any=await new Promise((resolve,reject)=>{const r=database.transaction('entries').objectStore('entries').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 if(!entry||Date.now()-entry.at>CACHE_TTL)return null;return await browserVault.open(key,entry.cipher);
}
async function writeDisk(key:string,value:string,alive:()=>boolean){
 if(!alive())return;
 if(Capacitor.getPlatform()==='android'){await native.set({key,value});return;}
 const cipher=await browserVault.seal(key,value),database=await db();
 if(!alive())return;
 await new Promise<void>((resolve,reject)=>{const tx=database.transaction('entries','readwrite'),store=tx.objectStore('entries');store.put({key,cipher,at:Date.now(),bytes:cipher.data.byteLength+12});
  const r=store.getAll();r.onsuccess=()=>{const entries=r.result.sort((a,b)=>b.at-a.at);let total=0;entries.forEach((e,i)=>{total+=e.bytes;if(i>=CACHE_COUNT_LIMIT||total>CACHE_TOTAL_LIMIT||Date.now()-e.at>CACHE_TTL)store.delete(e.key);});};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);
 });
}
async function read(d:SavedDevice,id:string){if(dropped.has(cacheOwner(d)))return null;const rev=revision(d),key=memKey(d,id),old=decodeCache(memory.get(key)??null);if(old)return old.value;try{const raw=await readDisk(await diskKey(d,id)),entry=decodeCache(raw);if(entry&&rev===revision(d)&&!dropped.has(cacheOwner(d))){remember(key,raw!);return entry.value;}}catch{}return null;}
export function rememberSession(d:SavedDevice,id:string,journal:JournalState){if(dropped.has(cacheOwner(d)))return;const raw=encodeCache(journalPreview(journal));if(raw)remember(memKey(d,id),raw);}
export function memorySession(d:SavedDevice,id:string):JournalState|null{if(dropped.has(cacheOwner(d)))return null;const value=decodeCache(memory.get(memKey(d,id))??null)?.value;return validJournal(value)?value:null;}
export async function saveSession(d:SavedDevice,id:string,journal:JournalState){if(!d.token||!id||dropped.has(cacheOwner(d)))return;const rev=revision(d),raw=encodeCache(journalPreview(journal));if(!raw)return;remember(memKey(d,id),raw);try{await writeDisk(await diskKey(d,id),raw,()=>rev===revision(d)&&!dropped.has(cacheOwner(d)));}catch{/* Cache failure never blocks chat. */}}
export async function loadSession(d:SavedDevice,id:string):Promise<JournalState|null>{if(!d.token||!id)return null;const value=await read(d,id);return validJournal(value)?value:null;}
export async function saveHost(d:SavedDevice,sessions:Session[],workspaces:Workspace[]){if(!d.token||dropped.has(cacheOwner(d)))return;const rev=revision(d),raw=encodeCache(hostPreview(sessions,workspaces));if(!raw)return;remember(memKey(d,'$host'),raw);try{await writeDisk(await diskKey(d,'$host'),raw,()=>rev===revision(d)&&!dropped.has(cacheOwner(d)));}catch{}}
export async function loadHost(d:SavedDevice):Promise<{sessions:Session[];workspaces:Workspace[]}|null>{if(!d.token)return null;const v:any=await read(d,'$host');return v&&Array.isArray(v.sessions)&&Array.isArray(v.workspaces)&&v.sessions.every((s:any)=>typeof s.sessionId==='string')&&v.workspaces.every((w:any)=>typeof w.workspaceId==='string'&&Array.isArray(w.sessionIds))?v:null;}
export async function forgetCache(d:SavedDevice){
 dropped.add(cacheOwner(d));revisions.set(d.key,revision(d)+1);
 for(const key of memory.keys())if(JSON.parse(JSON.parse(key)[0])[0]===d.key)memory.delete(key);
 try{const prefix=await hash(d.key);if(Capacitor.getPlatform()==='android'){await native.removeDevice({prefix});return;}const database=await db();await new Promise<void>((resolve,reject)=>{const tx=database.transaction('entries','readwrite'),store=tx.objectStore('entries'),r=store.getAllKeys();r.onsuccess=()=>{for(const key of r.result)if(String(key).startsWith(prefix+'.'))store.delete(key);};tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error);});}catch{}
}
