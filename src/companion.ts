import {useEffect,useRef,useState} from 'react';
import {Capacitor,registerPlugin} from '@capacitor/core';
import type {PluginListenerHandle} from '@capacitor/core';
import type {SavedDevice} from './devices';
import type {Approval} from './types';
export type CompanionState={enabled:boolean;running:boolean;notifications:boolean;batteryUnrestricted:boolean;configured?:boolean;foreground?:boolean;manufacturer?:string;deviceModel?:string;androidApi?:number;backgroundRestricted?:boolean;lastError?:string;lastExitReason?:number;lastExitAt?:number;lastStartedAt?:number;lastStoppedAt?:number;hosts:{key:string;online:boolean;eventsReady?:boolean;error:string;transport?:'relay'|'p2p'|'lan'}[];approvals:(Approval&{deviceKey:string})[]};
export type NoticeNavigation={key:string;sessionId?:string;kind:string};
const EMPTY:CompanionState={enabled:false,running:false,notifications:false,batteryUnrestricted:false,hosts:[],approvals:[]};
export const supportsCompanion=()=>Capacitor.getPlatform()==='android';
export const companion=registerPlugin<{
 getState():Promise<CompanionState>;setup():Promise<CompanionState>;enable():Promise<CompanionState>;disable():Promise<CompanionState>;sync():Promise<CompanionState>;
 answer(options:{key:string;eventId:string;allow:boolean}):Promise<void>;batterySettings():Promise<void>;notificationSettings():Promise<void>;appSettings():Promise<void>;autostartSettings():Promise<void>;vendorBatterySettings():Promise<void>;
 takeNavigation():Promise<{navigation:NoticeNavigation|null}>;
 addListener(event:'state',callback:(state:CompanionState)=>void):Promise<PluginListenerHandle>;
 addListener(event:'navigation',callback:()=>void):Promise<PluginListenerHandle>;
}>('Companion');
export function useCompanion(devices:SavedDevice[],ready:boolean){
 const[state,setState]=useState(EMPTY),[error,setError]=useState(''),[navigation,setNavigation]=useState<NoticeNavigation|null>(null);
 const latest=useRef({devices,ready});latest.current={devices,ready};const refreshRef=useRef<()=>void>(()=>{});
 useEffect(()=>{
  if(!supportsCompanion())return;let alive=true,refreshing=false,queued=false;const handles:Promise<PluginListenerHandle>[]=[];
  const refresh=async()=>{
   if(refreshing){queued=true;return;}refreshing=true;
   try{
    let s=await companion.getState();const current=latest.current;
    if(current.ready&&current.devices.some(d=>d.enabled&&d.token)&&s.foreground){
     if(!s.configured)s=await companion.setup();else if(s.enabled)s=await companion.sync();
    }
    if(alive){setState(s);if(s.running)setError('');}
    const r=await companion.takeNavigation();if(alive&&r.navigation)setNavigation(r.navigation);
   }catch(e){if(alive){setError((e as Error).message??'后台连接需要检查权限');void companion.getState().then(s=>{if(alive)setState(s);}).catch(()=>{});}}
   finally{refreshing=false;if(queued&&alive){queued=false;void refresh();}}
  };
  refreshRef.current=()=>void refresh();handles.push(companion.addListener('state',s=>{if(alive){setState(s);if(s.running)setError('');}}));handles.push(companion.addListener('navigation',()=>void refresh()));void refresh();window.addEventListener('dsh-resume',refreshRef.current);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('dsh-resume',refreshRef.current);refreshRef.current=()=>{};for(const h of handles)void h.then(x=>x.remove());};
 },[]);
 useEffect(()=>{if(ready&&supportsCompanion())refreshRef.current();},[devices,ready]);
 async function toggle(){setError('');try{setState(await(state.enabled?companion.disable():companion.enable()));}catch(e){setError((e as Error).message??'无法更改后台连接');}}
 return {state,error,toggle,navigation,consumeNavigation:()=>setNavigation(null)};
}
