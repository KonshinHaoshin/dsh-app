import {useCallback,useEffect,useRef,useState} from 'react';
import HostWorkspace from './HostWorkspace';
import ConnectionSheet from './ConnectionSheet';
import {ACTIVE_DEVICE_KEY,DEFAULT_PROFILE,loadDevices,saveDevices,upsertDevice} from './devices';
import type {SavedDevice,DeviceStatus} from './devices';
import {credentialVault} from './credentialVault';
import {parsePairingLink,redeemPairing} from './pairing';
import type {ConnectionProfile} from './types';
const EMPTY:SavedDevice={...DEFAULT_PROFILE,key:'empty',enabled:false};

export default function DeviceApp(){
  const [devices,setDevices]=useState(()=>loadDevices(localStorage,sessionStorage));
  const devicesRef=useRef(devices);devicesRef.current=devices;
  const [activeKey,setActiveKey]=useState(()=>localStorage.getItem(ACTIVE_DEVICE_KEY)??'');
  const [statuses,setStatuses]=useState<Record<string,DeviceStatus>>({});
  const statusesRef=useRef<Record<string,DeviceStatus>>({});
  const [attempts,setAttempts]=useState<Record<string,number>>({});
  const [ready,setReady]=useState(false),[connectionsOpen,setConnectionsOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [theme,setTheme]=useState(()=>localStorage.getItem('dsh.theme')??'light');
  const pendingClose=useRef('');const initialDrafts=useRef(new Map<string,string>());const unconnectedDraft=useRef('');
  const modal=useRef<HTMLElement>(null);
  const activeDevice=devices.find(d=>d.key===activeKey)??devices[0];

  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('dsh.theme',theme);},[theme]);
  useEffect(()=>{
    let alive=true;
    void(async()=>{
      let records=devicesRef.current;
      try{const registry=await credentialVault.getRegistry();if(registry!==null)records=loadDevices(localStorage,sessionStorage,registry);}catch{if(alive)setError('无法读取原生电脑列表，请检查已保存的连接');}
      const loaded=await Promise.all(records.map(async d=>{
        try{if(d.token){await credentialVault.set(d.key,d.token);return d;}return {...d,token:await credentialVault.get(d.key)};}
        catch{if(alive)setError('部分电脑需要重新扫码配对');return d;}
      }));
      if(!alive)return;
      try{await credentialVault.saveRegistry(loaded);}catch{if(alive)setError('无法保存电脑列表，请稍后重试');}
      if(alive){setDevices(loaded);setReady(true);}
    })();
    return()=>{alive=false;};
  },[]);
  useEffect(()=>{saveDevices(localStorage,devices);},[devices]);
  useEffect(()=>{
    if(!activeDevice)return;localStorage.setItem(ACTIVE_DEVICE_KEY,activeDevice.key);
    const {url,deviceId,mode,token}=activeDevice;
    localStorage.setItem('dsh.connection',JSON.stringify({url,deviceId,mode}));
    if(token)sessionStorage.setItem('dsh.token',token);else sessionStorage.removeItem('dsh.token');
  },[activeDevice]);
  useEffect(()=>{
    if(!ready||!location.hash.startsWith('#pair='))return;
    const text=location.href;history.replaceState(null,'',location.pathname+location.search);
    void(async()=>{try{await connect(await redeemPairing(parsePairingLink(text)));}catch(e){setError((e as Error).message);setConnectionsOpen(true);}})();
  },[ready]);

  const reportStatus=useCallback((key:string,status:DeviceStatus)=>{
    statusesRef.current={...statusesRef.current,[key]:status};
    setStatuses(previous=>{const old=previous[key];if(old&&old.state===status.state&&old.error===status.error&&old.name===status.name&&old.approvals===status.approvals)return previous;return {...previous,[key]:status};});
    if(status.state==='connected'&&status.name)setDevices(previous=>{const d=previous.find(x=>x.key===key);return !d||d.name===status.name?previous:previous.map(x=>x.key===key?{...x,name:status.name}:x);});
    if(status.state==='connected'&&pendingClose.current===key){pendingClose.current='';setConnectionsOpen(false);}
  },[]);
  const openConnections=useCallback((draft?:string)=>{if(draft!==undefined)unconnectedDraft.current=draft;setConnectionsOpen(true);},[]);

  async function connect(profile:ConnectionProfile){
    setSaving(true);setError('');
    try{
      const previous=devicesRef.current;const next=upsertDevice(previous,profile);await credentialVault.set(next.device.key,next.device.token);await credentialVault.saveRegistry(next.devices);
      if(!previous.length){if(unconnectedDraft.current)initialDrafts.current.set(next.device.key,unconnectedDraft.current);unconnectedDraft.current='';}
      pendingClose.current=next.device.key;setDevices(next.devices);setActiveKey(next.device.key);
      const old=previous.find(d=>d.key===next.device.key);
      if(statusesRef.current[next.device.key]?.state==='connected'&&old?.token===next.device.token&&old.url===next.device.url&&old.enabled){pendingClose.current='';setConnectionsOpen(false);}
    }finally{setSaving(false);}
  }
  function selectDevice(key:string){
    const device=devicesRef.current.find(d=>d.key===key);if(!device)return;setActiveKey(key);setError('');
    if(!device.token)return;
    if(statusesRef.current[key]?.state==='connected'){setConnectionsOpen(false);return;}
    pendingClose.current=key;if(!device.enabled){void toggleDevice(key,true);return;}
    if(device.enabled&&['error','disconnected'].includes(statusesRef.current[key]?.state??'disconnected'))setAttempts(previous=>({...previous,[key]:(previous[key]??0)+1}));
    setDevices(previous=>previous.map(d=>d.key===key?{...d,enabled:true}:d));
  }
  async function toggleDevice(key:string,enabled:boolean){
    setSaving(true);setError('');
    try{const next=devicesRef.current.map(d=>d.key===key?{...d,enabled}:d);await credentialVault.saveRegistry(next);if(enabled&&devicesRef.current.find(d=>d.key===key)?.enabled)setAttempts(previous=>({...previous,[key]:(previous[key]??0)+1}));setDevices(previous=>previous.map(d=>d.key===key?{...d,enabled}:d));}
    catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  async function forgetDevice(key:string){
    setSaving(true);try{
    await credentialVault.remove(key);if(pendingClose.current===key)pendingClose.current='';
    const remaining=devicesRef.current.filter(d=>d.key!==key);await credentialVault.saveRegistry(remaining);setDevices(remaining);
    localStorage.removeItem('dsh.workspace.'+key);localStorage.removeItem('dsh.session.'+key);initialDrafts.current.delete(key);
    setStatuses(previous=>{const next={...previous};delete next[key];return next;});
    const latest={...statusesRef.current};delete latest[key];statusesRef.current=latest;
    if(activeDevice?.key===key)setActiveKey(remaining[0]?.key??'');
    if(!remaining.length){localStorage.removeItem('dsh.connection');localStorage.removeItem(ACTIVE_DEVICE_KEY);sessionStorage.removeItem('dsh.token');}
    }finally{setSaving(false);}
  }
  async function renameDevice(key:string,alias:string){setSaving(true);try{const name=alias.trim().slice(0,80)||undefined;await credentialVault.saveRegistry(devicesRef.current.map(d=>d.key===key?{...d,alias:name}:d));setDevices(previous=>previous.map(d=>d.key===key?{...d,alias:name}:d));}finally{setSaving(false);}}

  useEffect(()=>{
    if(!connectionsOpen)return;const container=modal.current;if(!container)return;
    const previous=document.activeElement as HTMLElement|null;
    const nodes=()=>Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select')).filter(el=>el.offsetParent!==null);
    nodes()[0]?.focus();const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape')setConnectionsOpen(false);if(e.key!=='Tab')return;const all=nodes(),first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    document.addEventListener('keydown',keydown);return()=>{document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus();};
  },[connectionsOpen]);

  const views=devices.length?devices:[EMPTY];
  return <div className="device-root">
    {views.map(device=>{const active=activeDevice?activeDevice.key===device.key:true;return <div className="device-workspace" key={device.key} hidden={!active}>
      <HostWorkspace device={{...device,enabled:device.enabled&&ready}} active={active} blocked={connectionsOpen} theme={theme} onThemeChange={setTheme} attempt={attempts[device.key]??0} initialDraft={initialDrafts.current.get(device.key)??(device.key==='empty'?unconnectedDraft.current:'')} otherApprovals={Object.entries(statuses).reduce((n,[key,s])=>n+(key===device.key?0:s.approvals),0)} onOpenConnections={openConnections} onStatus={reportStatus}/>
    </div>;})}
    {connectionsOpen&&<div className="modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)setConnectionsOpen(false);}}><section ref={modal} className="settings-sheet connection-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title"><ConnectionSheet devices={devices} activeKey={activeDevice?.key??''} statuses={statuses} busy={saving||!ready} error={error} onConnect={connect} onSelect={selectDevice} onToggle={toggleDevice} onForget={forgetDevice} onRename={renameDevice} onClose={()=>setConnectionsOpen(false)}/></section></div>}
  </div>;
}
