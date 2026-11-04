import{useState}from'react';
import{ChevronDown,Globe,Link2,LoaderCircle,QrCode,Wifi,X}from'lucide-react';
import type{ConnectionProfile}from'./types';
import {DEFAULT_PROFILE} from './devices';
import type {SavedDevice,DeviceStatus} from './devices';
import DeviceList from './DeviceList';
import{parsePairingLink,redeemPairing,scanPairingCode}from'./pairing';
import{Capacitor}from'@capacitor/core';
import CameraScanner from './CameraScanner';
import BackgroundPanel from './BackgroundPanel';
import type {CompanionState} from './companion';
import UpdatePanel from './UpdatePanel';
type Props={background:CompanionState;backgroundError:string;onBackgroundToggle:()=>Promise<void>;devices:SavedDevice[];activeKey:string;statuses:Record<string,DeviceStatus>;busy:boolean;error:string;onConnect:(profile:ConnectionProfile)=>Promise<void>;onSelect:(key:string)=>void;onToggle:(key:string,enabled:boolean)=>void;onForget:(key:string)=>Promise<void>;onRename:(key:string,name:string)=>Promise<void>;onClose:()=>void};
export default function ConnectionSheet({background,backgroundError,onBackgroundToggle,devices,activeKey,statuses,busy:parentBusy,error,onConnect,onSelect,onToggle,onForget,onRename,onClose}:Props){
  const[draft,setDraft]=useState(DEFAULT_PROFILE);const[manual,setManual]=useState(false);const[importing,setImporting]=useState(false);const[link,setLink]=useState('');const[localError,setLocalError]=useState('');const[scanning,setScanning]=useState(false);
  const[webCamera,setWebCamera]=useState(false);
  const busy=scanning||parentBusy;
  async function useCode(text:string){setLocalError('');setScanning(true);try{await onConnect(await redeemPairing(parsePairingLink(text)));setManual(false);setImporting(false);}catch(e){setLocalError((e as Error).message);}finally{setScanning(false);}}
  async function manualConnect(){setLocalError('');setScanning(true);try{await onConnect(draft);setManual(false);}catch(e){setLocalError((e as Error).message);}finally{setScanning(false);}}
  async function scan(){setLocalError('');if(!Capacitor.isNativePlatform()){setWebCamera(true);return;}setScanning(true);try{const text=await scanPairingCode();if(text)await useCode(text);}catch(e){const message=typeof e==='string'?e:(e as Error).message;if(!/cancel/i.test(message))setLocalError(/permission|denied/i.test(message)?'请允许使用相机后重试':message||'无法打开相机，可以使用配对链接');}finally{setScanning(false);}}
  if(webCamera)return <CameraScanner onScan={text=>{setWebCamera(false);void useCode(text);}} onCancel={()=>setWebCamera(false)} onError={message=>{setWebCamera(false);setLocalError(message);}}/>;
  return <>
    <div className="sheet-top"><h2 id="settings-title">连接</h2><button className="icon-button" aria-label="关闭连接设置" onClick={onClose}><X size={20}/></button></div>
    <UpdatePanel/>
    <BackgroundPanel state={background} error={backgroundError} onToggle={onBackgroundToggle}/>
    {devices.length?<DeviceList devices={devices} activeKey={activeKey} statuses={statuses} busy={busy} onSelect={onSelect} onToggle={onToggle} onForget={onForget} onRename={onRename} onError={setLocalError}/>:<p className="pair-caption">扫描电脑上的 DSH 配对码</p>}
    <button className="primary-button scan-connect" onClick={()=>void scan()} disabled={busy}>{busy?<LoaderCircle size={20} className="spin"/>:<QrCode size={21}/>} {busy?'正在连接…':devices.length?'添加电脑 · 扫一扫':'扫一扫'}</button>
    {(localError||error)&&<div className="form-status" role="alert">{localError||error}</div>}
    <div className="connection-alternatives"><button onClick={()=>{setImporting(!importing);setManual(false);}} disabled={busy}>使用配对链接</button><span>·</span><button onClick={()=>{setManual(!manual);setImporting(false);}} disabled={busy}>手动连接<ChevronDown size={12}/></button></div>
    {importing&&<form className="connection-form compact-form" onSubmit={e=>{e.preventDefault();void useCode(link);}}><label htmlFor="pair-link">配对链接</label><textarea id="pair-link" aria-label="配对链接" value={link} onChange={e=>setLink(e.target.value)} placeholder="粘贴电脑端复制的链接" rows={3} autoCapitalize="none" spellCheck={false}/><button type="submit" className="primary-button connect-submit" disabled={busy||!link.trim()}>配对</button></form>}
    {manual&&<form className="connection-form compact-form" onSubmit={e=>{e.preventDefault();void manualConnect();}}>
      <div className="mode-switch" role="group" aria-label="连接方式"><button type="button" className={draft.mode==='public'?'active':''} onClick={()=>setDraft(p=>({...p,mode:'public',url:'https://dshapi.shelterhub.moe'}))}><Globe size={15}/>公网</button><button type="button" className={draft.mode==='lan'?'active':''} onClick={()=>setDraft(p=>({...p,mode:'lan',url:p.mode==='lan'?p.url:'http://192.168.1.10:43821'}))}><Wifi size={15}/>局域网</button></div>
      <label htmlFor="server-url">服务器地址</label><input id="server-url" type="url" value={draft.url} onChange={e=>setDraft(p=>({...p,url:e.target.value}))} required autoCapitalize="none" spellCheck={false}/>
      <label htmlFor="device-id">设备 ID</label><input id="device-id" value={draft.deviceId} onChange={e=>setDraft(p=>({...p,deviceId:e.target.value}))} required autoCapitalize="none" spellCheck={false}/>
      <label htmlFor="pairing-token">配对密钥</label><input id="pairing-token" type="password" value={draft.token} onChange={e=>setDraft(p=>({...p,token:e.target.value}))} required minLength={24} autoComplete="off"/>
      <button className="primary-button connect-submit" disabled={busy} type="submit"><Link2 size={16}/>连接</button>
    </form>}

  </>;
}
