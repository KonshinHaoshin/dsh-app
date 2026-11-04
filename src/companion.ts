import {useEffect,useState} from 'react';
import {Capacitor,registerPlugin} from '@capacitor/core';
import type {PluginListenerHandle} from '@capacitor/core';
import type {SavedDevice} from './devices';
import type {Approval} from './types';
export type CompanionState={enabled:boolean;running:boolean;notifications:boolean;batteryUnrestricted:boolean;hosts:{key:string;online:boolean;error:string;transport?:'relay'|'p2p'|'lan'}[];approvals:(Approval&{deviceKey:string})[]};
export type NoticeNavigation={key:string;sessionId?:string;kind:string};
const EMPTY:CompanionState={enabled:false,running:false,notifications:false,batteryUnrestricted:false,hosts:[],approvals:[]};
export const supportsCompanion=()=>Capacitor.getPlatform()==='android';
export const companion=registerPlugin<{
 getState():Promise<CompanionState>;enable():Promise<CompanionState>;disable():Promise<CompanionState>;sync():Promise<CompanionState>;
 answer(options:{key:string;eventId:string;allow:boolean}):Promise<void>;batterySettings():Promise<void>;notificationSettings():Promise<void>;
 takeNavigation():Promise<{navigation:NoticeNavigation|null}>;
 addListener(event:'state',callback:(state:CompanionState)=>void):Promise<PluginListenerHandle>;
 addListener(event:'navigation',callback:()=>void):Promise<PluginListenerHandle>;
}>('Companion');
export function useCompanion(devices:SavedDevice[],ready:boolean){
 const[state,setState]=useState(EMPTY),[error,setError]=useState(''),[navigation,setNavigation]=useState<NoticeNavigation|null>(null);
 useEffect(()=>{
  if(!supportsCompanion())return;let alive=true;const handles:Promise<PluginListenerHandle>[]=[];
  const refresh=()=>{void companion.getState().then(s=>{if(alive)setState(s);}).catch(()=>{});void companion.takeNavigation().then(r=>{if(alive&&r.navigation)setNavigation(r.navigation);}).catch(()=>{});};
  handles.push(companion.addListener('state',s=>{if(alive)setState(s);}));handles.push(companion.addListener('navigation',refresh));refresh();window.addEventListener('dsh-resume',refresh);
  return()=>{alive=false;window.removeEventListener('dsh-resume',refresh);for(const h of handles)void h.then(x=>x.remove());};
 },[]);
 useEffect(()=>{if(ready&&supportsCompanion())void companion.sync().then(setState).catch(()=>setError('无法同步后台连接，请在连接设置中重新开启'));},[devices,ready]);
 async function toggle(){setError('');try{setState(await(state.enabled?companion.disable():companion.enable()));}catch(e){setError((e as Error).message??'无法更改后台连接');}}
 return {state,error,toggle,navigation,consumeNavigation:()=>setNavigation(null)};
}
