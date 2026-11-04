import {useState} from 'react';
import {Bell,LoaderCircle} from 'lucide-react';
import {companion,supportsCompanion} from './companion';
import type {CompanionState} from './companion';
import metadata from '../package.json';
export default function BackgroundPanel({state,error,onToggle}:{state:CompanionState;error:string;onToggle:()=>Promise<void>}){
 const[busy,setBusy]=useState(false),[localError,setLocalError]=useState('');if(!supportsCompanion())return null;
 const xiaomi=/xiaomi|redmi|poco/i.test(state.manufacturer??'');
 async function action(fn:()=>Promise<void>){setLocalError('');try{await fn();}catch(e){setLocalError((e as Error).message);}}
 return <section className="background-panel" aria-label="后台连接与通知"><div className="background-heading"><span><Bell size={16}/>后台连接与通知</span><button type="button" role="switch" aria-label="后台连接与通知" aria-checked={state.enabled} disabled={busy} className={'setting-switch '+(state.enabled?'on':'')} onClick={()=>{setBusy(true);void onToggle().finally(()=>setBusy(false));}}>{busy?<LoaderCircle size={15} className="spin"/>:<i/>}</button></div>
 <p>{state.enabled?(state.running?`${state.hosts.filter(h=>h.online&&h.eventsReady).length} 台电脑已在后台连接${state.hosts.some(h=>h.online&&h.transport==='p2p')?`，其中 ${state.hosts.filter(h=>h.online&&h.transport==='p2p').length} 台 P2P 直连`:''}。锁屏后接收任务结束和审批提醒。`:'后台服务未运行，回到前台后自动恢复。'):'开启后显示常驻通知，切到后台仍接收任务和审批消息，会增加耗电。'}</p>
 {state.enabled&&!state.running&&<div className="background-hint">{state.lastError||'请检查系统是否限制 DSH 后台运行。'}<button onClick={()=>void action(async()=>{await companion.sync();})}>恢复后台连接</button></div>}
 {state.backgroundRestricted&&<div className="background-hint">系统正在限制 DSH 的后台活动。<button onClick={()=>void action(()=>companion.appSettings())}>应用设置</button></div>}
 {state.enabled&&!state.batteryUnrestricted&&<div className="background-hint">建议允许 DSH 不受电池优化限制。<button type="button" onClick={()=>void action(()=>companion.batterySettings())}>设置电池权限</button></div>}
 {(state.enabled||state.configured)&&!state.notifications&&<div className="background-hint">系统通知尚未开启。<button type="button" onClick={()=>void action(()=>companion.notificationSettings())}>开启通知</button></div>}
 {state.enabled&&xiaomi&&<div className="background-hint">红米 / 小米：允许 DSH 自启动，省电策略选择“无限制”。<button type="button" onClick={()=>void action(()=>companion.autostartSettings())}>自启动设置</button><button type="button" onClick={()=>void action(()=>companion.vendorBatterySettings())}>省电策略</button></div>}
 <details className="background-diagnostics"><summary>后台诊断</summary><p>{state.deviceModel??state.manufacturer??'Android'} · API {state.androidApi??'—'} · {state.running?'服务运行中':'服务未运行'}</p>{state.lastExitReason!==undefined&&<p>上次退出：{state.lastExitReason===3?'内存不足':state.lastExitReason===4||state.lastExitReason===5?'进程崩溃':state.lastExitReason===6?'应用未响应':state.lastExitReason===9?'资源限制':state.lastExitReason===10?'系统或用户清理':'进程已结束'}{state.lastExitAt?' · '+new Date(state.lastExitAt).toLocaleString():''}</p>}<button onClick={()=>void action(()=>navigator.clipboard.writeText(JSON.stringify({version:metadata.version,manufacturer:state.manufacturer,model:state.deviceModel,androidApi:state.androidApi,enabled:state.enabled,running:state.running,notifications:state.notifications,batteryUnrestricted:state.batteryUnrestricted,backgroundRestricted:state.backgroundRestricted,lastExitReason:state.lastExitReason,lastExitAt:state.lastExitAt,lastStartedAt:state.lastStartedAt,lastStoppedAt:state.lastStoppedAt,online:state.hosts.filter(h=>h.online).length},null,2)))}>复制诊断</button></details>
 {(error||localError)&&<p className="form-status" role="alert">{error||localError}</p>}
 </section>;
}
