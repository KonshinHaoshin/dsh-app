import type {JournalState} from './transcript.ts';
import {emptyJournal} from './transcript.ts';
import type {Session,WireEvent,Workspace} from './types.ts';
export const CACHE_TTL=7*24*60*60*1000,CACHE_ENTRY_LIMIT=512*1024,CACHE_TOTAL_LIMIT=8*1024*1024,CACHE_COUNT_LIMIT=32;
export type CacheRecord={version:1;savedAt:number;value:unknown};
const bytes=(s:string)=>new TextEncoder().encode(s).length;
function preview(value:any,depth=0):any{
 if(typeof value==='string')return value.length>24000?value.slice(0,24000)+'\n…':value;
 if(value===null||typeof value!=='object')return value;
 if(depth>9)return null;
 if(Array.isArray(value))return value.slice(0,256).map(v=>preview(v,depth+1));
 return Object.fromEntries(Object.entries(value).slice(0,80).map(([k,v])=>[k,preview(v,depth+1)]));
}
export function journalPreview(journal:JournalState):JournalState{
 const events:WireEvent[]=[];let total=0;
 for(let i=journal.events.length-1;i>=0&&events.length<400;i--){
  const event=preview(journal.events[i]) as WireEvent;const n=bytes(JSON.stringify(event));
  if(total+n>384*1024)continue;events.unshift(event);total+=n;
 }
 return {...emptyJournal(),events,cursor:journal.cursor,hasMore:journal.hasMore||events.length<journal.events.length};
}
export function hostPreview(sessions:Session[],workspaces:Workspace[]){
 return {sessions:sessions.slice(0,200).map(({sessionId,title,cwd,updatedAt,blank})=>({sessionId,title:title?.slice(0,500),cwd:cwd?.slice(0,2000),updatedAt,blank,running:false})),workspaces:workspaces.slice(0,100).map(w=>({...w,sessionIds:w.sessionIds.slice(0,500)}))};
}
export function encodeCache(value:unknown,now=Date.now()):string|null{const raw=JSON.stringify({version:1,savedAt:now,value});return bytes(raw)<=CACHE_ENTRY_LIMIT?raw:null;}
export function decodeCache(raw:string|null,now=Date.now()):CacheRecord|null{
 try{if(!raw||bytes(raw)>CACHE_ENTRY_LIMIT)return null;const f=JSON.parse(raw);if(f.version!==1||!Number.isFinite(f.savedAt)||f.savedAt>now+60000||now-f.savedAt>CACHE_TTL)return null;return f;}catch{return null;}
}
export function validJournal(value:any):value is JournalState{return value&&Number.isSafeInteger(value.cursor)&&value.cursor>=-1&&typeof value.hasMore==='boolean'&&Array.isArray(value.events)&&value.events.length<=400&&value.events.every((e:any)=>Number.isSafeInteger(e.seq)&&typeof e.type==='string'&&e.data&&typeof e.data==='object'&&!Array.isArray(e.data));}
