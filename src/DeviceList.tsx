import {useState} from 'react';
import {Check,Laptop,MoreHorizontal,Pencil,Trash2,Unplug,Wifi} from 'lucide-react';
import {deviceName} from './devices';
import type {SavedDevice,DeviceStatus} from './devices';
type Props={devices:SavedDevice[];activeKey:string;statuses:Record<string,DeviceStatus>;busy:boolean;onSelect:(key:string)=>void;onToggle:(key:string,enabled:boolean)=>void;onForget:(key:string)=>Promise<void>;onRename:(key:string,name:string)=>Promise<void>;onError:(message:string)=>void};
const labels={connected:'已连接',connecting:'正在连接',reconnecting:'重连中',disconnected:'未连接',error:'连接失败'};
export default function DeviceList({devices,activeKey,statuses,busy,onSelect,onToggle,onForget,onRename,onError}:Props){
  const [menu,setMenu]=useState(''),[renaming,setRenaming]=useState(''),[alias,setAlias]=useState(''),[removing,setRemoving]=useState(''),[deleting,setDeleting]=useState(false);
  return <div className="device-list" aria-label="已保存的电脑">{devices.map(device=>{
    const name=deviceName(device),status=statuses[device.key],online=status?.state==='connected';
    return <div className={'saved-device '+(device.key===activeKey?'is-active':'')} key={device.key} data-device-key={device.key}>
      <div className="saved-device-row"><button type="button" className="saved-device-main" aria-label={'切换到 '+name} onClick={()=>onSelect(device.key)} disabled={busy||deleting}><span className="device-icon"><Laptop size={21}/></span><span className="saved-device-copy"><strong>{name}</strong><small><span className={'status-dot '+(online?'online':'')}/>{!device.token?'需要配对':labels[status?.state??'disconnected']}<span>·</span>{device.mode==='lan'?'局域网':online&&status?.transport==='p2p'?'P2P 直连':online?'中继':'公网'}</small><span className="saved-device-address">{new URL(device.url).host}</span></span>{status?.approvals?<span className="device-pending-count">待审批 {status.approvals}</span>:device.key===activeKey?<Check size={17}/>:null}</button><button type="button" className="icon-button" aria-label={name+' 的连接选项'} disabled={busy||deleting} onClick={()=>{setMenu(menu===device.key?'':device.key);setRemoving('');setRenaming('');}}><MoreHorizontal size={19}/></button></div>
      {status?.error&&<p className="device-status-error">{status.error}</p>}
      {menu===device.key&&<div className="device-menu">{device.token&&<button type="button" onClick={()=>{onToggle(device.key,!device.enabled||status?.state==='error');setMenu('');}}>{device.enabled&&status?.state!=='error'?<Unplug size={14}/>:<Wifi size={14}/>} {device.enabled&&status?.state!=='error'?'断开连接':'重新连接'}</button>}<button type="button" onClick={()=>{setRenaming(device.key);setAlias(name);setMenu('');}}><Pencil size={14}/>重命名</button><button type="button" onClick={()=>{setRemoving(device.key);setMenu('');}}><Trash2 size={14}/>移除</button></div>}
      {renaming===device.key&&<form className="device-rename" onSubmit={e=>{e.preventDefault();void onRename(device.key,alias).then(()=>setRenaming('')).catch(e=>onError((e as Error).message));}}><input aria-label="电脑名称" value={alias} maxLength={80} onChange={e=>setAlias(e.target.value)} autoFocus/><button type="submit" disabled={busy}>保存</button><button type="button" disabled={busy} onClick={()=>setRenaming('')}>取消</button></form>}
      {removing===device.key&&<div className="device-remove"><p>移除此电脑的配对信息？再次连接需要扫码。</p><button type="button" disabled={deleting} onClick={()=>{setDeleting(true);void onForget(device.key).catch(e=>onError((e as Error).message)).finally(()=>{setDeleting(false);setRemoving('');});}}>移除电脑</button><button type="button" disabled={deleting} onClick={()=>setRemoving('')}>取消</button></div>}
    </div>;
  })}</div>;
}
