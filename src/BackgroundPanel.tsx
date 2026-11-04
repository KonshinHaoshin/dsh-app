import {useState} from 'react';
import {Bell,LoaderCircle} from 'lucide-react';
import {companion,supportsCompanion} from './companion';
import type {CompanionState} from './companion';
export default function BackgroundPanel({state,error,onToggle}:{state:CompanionState;error:string;onToggle:()=>Promise<void>}){
 const[busy,setBusy]=useState(false),[localError,setLocalError]=useState('');if(!supportsCompanion())return null;
 async function action(fn:()=>Promise<void>){setLocalError('');try{await fn();}catch(e){setLocalError((e as Error).message);}}
 return <section className="background-panel" aria-label="后台连接与通知"><div className="background-heading"><span><Bell size={16}/>后台连接与通知</span><button type="button" role="switch" aria-label="后台连接与通知" aria-checked={state.enabled} disabled={busy} className={'setting-switch '+(state.enabled?'on':'')} onClick={()=>{setBusy(true);void onToggle().finally(()=>setBusy(false));}}>{busy?<LoaderCircle size={15} className="spin"/>:<i/>}</button></div>
 <p>{state.enabled?`${state.hosts.filter(h=>h.online).length} 台电脑已在后台连接${state.hosts.some(h=>h.online&&h.transport==='p2p')?`，其中 ${state.hosts.filter(h=>h.online&&h.transport==='p2p').length} 台 P2P 直连`:''}。锁屏后接收任务结束和审批提醒。`:'开启后显示常驻通知，切到后台仍接收任务和审批消息，会增加耗电。'}</p>
 {state.enabled&&!state.batteryUnrestricted&&<div className="background-hint">建议允许 DSH 不受电池优化限制。<button type="button" onClick={()=>void action(()=>companion.batterySettings())}>设置电池权限</button></div>}
 {state.enabled&&!state.notifications&&<div className="background-hint">系统通知尚未开启。<button type="button" onClick={()=>void action(()=>companion.notificationSettings())}>开启通知</button></div>}
 {(error||localError)&&<p className="form-status" role="alert">{error||localError}</p>}
 </section>;
}
