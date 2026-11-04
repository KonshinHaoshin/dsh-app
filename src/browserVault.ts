// Browser/iOS pairing survives process restarts without plaintext tokens in
// localStorage. The non-extractable AES key is structured-cloned into IndexedDB.
const DB='dsh-pairing-v1';
let opening:Promise<IDBDatabase>|undefined;
function database(){return opening??=new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore('vault');
 request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=undefined;};resolve(request.result);};request.onerror=()=>{opening=undefined;reject(new Error('无法打开配对存储，请检查浏览器存储权限'));};
});}
async function read<T>(id:string):Promise<T|undefined>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('vault','readonly'),r=tx.objectStore('vault').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function write(id:string,value:unknown,remove=false){const db=await database();return new Promise<void>((resolve,reject)=>{const tx=db.transaction('vault','readwrite');if(remove)tx.objectStore('vault').delete(id);else tx.objectStore('vault').put(value,id);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('无法保存配对信息，请检查存储空间'));});}
let loadingKey:Promise<CryptoKey>|undefined;
async function encryptionKey(){return loadingKey??=(async()=>{
 const existing=await read<CryptoKey>('key');if(existing)return existing;
 const generated=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const db=await database();
 return new Promise<CryptoKey>((resolve,reject)=>{const tx=db.transaction('vault','readwrite'),store=tx.objectStore('vault'),r=store.get('key');let key=generated;r.onsuccess=()=>{if(r.result)key=r.result;else store.put(generated,'key');};tx.oncomplete=()=>resolve(key);tx.onabort=tx.onerror=()=>reject(new Error('无法创建配对存储密钥'));});
 })().catch(e=>{loadingKey=undefined;throw e;});}
export const browserVault={
 async get(id:string){const entry=await read<{iv:Uint8Array<ArrayBuffer>;data:ArrayBuffer}>('token:'+id);if(!entry)return '';try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:entry.iv,additionalData:new TextEncoder().encode(id)},await encryptionKey(),entry.data));}catch{throw new Error('无法读取此电脑的配对信息');}},
 async set(id:string,value:string){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey();const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(id)},key,new TextEncoder().encode(value));await write('token:'+id,{iv,data});},
 async remove(id:string){await write('token:'+id,undefined,true);}
};
