import{useState}from'react';
import{Check,ChevronDown,Globe,Laptop,Link2,LoaderCircle,QrCode,Unplug,Wifi,X}from'lucide-react';
import type{ConnectionProfile,ConnectionState}from'./types';
import{parsePairingLink,redeemPairing,scanPairingCode}from'./pairing';
import{Capacitor}from'@capacitor/core';
import CameraScanner from './CameraScanner';
import UpdatePanel from './UpdatePanel';
type Props={profile:ConnectionProfile;state:ConnectionState;name:string;error:string;onConnect:(profile:ConnectionProfile)=>void;onDisconnect:()=>void;onClose:()=>void};
export default function ConnectionSheet({profile,state,name,error,onConnect,onDisconnect,onClose}:Props){
  const[draft,setDraft]=useState(profile);const[manual,setManual]=useState(false);const[importing,setImporting]=useState(false);const[link,setLink]=useState('');const[localError,setLocalError]=useState('');const[scanning,setScanning]=useState(false);
  const[webCamera,setWebCamera]=useState(false);
  const online=state==='connected';const busy=scanning||state==='connecting'||state==='reconnecting';
  async function useCode(text:string){setLocalError('');setScanning(true);try{const next=await redeemPairing(parsePairingLink(text));setDraft(next);onConnect(next);setManual(false);setImporting(false);}catch(e){setLocalError((e as Error).message);}finally{setScanning(false);}}
  async function scan(){setLocalError('');if(!Capacitor.isNativePlatform()){setWebCamera(true);return;}setScanning(true);try{const text=await scanPairingCode();if(text)await useCode(text);}catch(e){const message=typeof e==='string'?e:(e as Error).message;if(!/cancel/i.test(message))setLocalError(/permission|denied/i.test(message)?'请允许使用相机后重试':message||'无法打开相机，可以使用配对链接');}finally{setScanning(false);}}
  if(webCamera)return <CameraScanner onScan={text=>{setWebCamera(false);void useCode(text);}} onCancel={()=>setWebCamera(false)} onError={message=>{setWebCamera(false);setLocalError(message);}}/>;
  return <>
    <div className="sheet-top"><h2 id="settings-title">连接</h2><button className="icon-button" aria-label="关闭连接设置" onClick={onClose}><X size={20}/></button></div>
    {online?<div className="connected-device"><span className="connected-device-icon"><Laptop size={23}/></span><div><strong>{name}</strong><small><span className="status-dot online"/>{profile.mode==='public'?'公网连接':'局域网连接'}</small></div><Check size={18}/></div>:<p className="pair-caption">扫描电脑上的 DSH 配对码</p>}
    <button className="primary-button scan-connect" onClick={()=>void scan()} disabled={busy}>{busy?<LoaderCircle size={20} className="spin"/>:<QrCode size={21}/>} {busy?'正在连接…':online?'重新扫码':'扫一扫'}</button>
    {(localError||error)&&<div className="form-status" role="alert">{localError||error}</div>}
    <div className="connection-alternatives"><button onClick={()=>{setImporting(!importing);setManual(false);}} disabled={busy}>使用配对链接</button><span>·</span><button onClick={()=>{setManual(!manual);setImporting(false);}} disabled={busy}>手动连接<ChevronDown size={12}/></button></div>
    {importing&&<form className="connection-form compact-form" onSubmit={e=>{e.preventDefault();void useCode(link);}}><label htmlFor="pair-link">配对链接</label><textarea id="pair-link" aria-label="配对链接" value={link} onChange={e=>setLink(e.target.value)} placeholder="粘贴电脑端复制的链接" rows={3} autoCapitalize="none" spellCheck={false}/><button type="submit" className="primary-button connect-submit" disabled={busy||!link.trim()}>配对</button></form>}
    {manual&&<form className="connection-form compact-form" onSubmit={e=>{e.preventDefault();setLocalError('');onConnect(draft);}}>
      <div className="mode-switch" role="group" aria-label="连接方式"><button type="button" className={draft.mode==='public'?'active':''} onClick={()=>setDraft(p=>({...p,mode:'public',url:'https://dshapi.shelterhub.moe'}))}><Globe size={15}/>公网</button><button type="button" className={draft.mode==='lan'?'active':''} onClick={()=>setDraft(p=>({...p,mode:'lan',url:p.mode==='lan'?p.url:'http://192.168.1.10:43821'}))}><Wifi size={15}/>局域网</button></div>
      <label htmlFor="server-url">服务器地址</label><input id="server-url" type="url" value={draft.url} onChange={e=>setDraft(p=>({...p,url:e.target.value}))} required autoCapitalize="none" spellCheck={false}/>
      <label htmlFor="device-id">设备 ID</label><input id="device-id" value={draft.deviceId} onChange={e=>setDraft(p=>({...p,deviceId:e.target.value}))} required autoCapitalize="none" spellCheck={false}/>
      <label htmlFor="pairing-token">配对密钥</label><input id="pairing-token" type="password" value={draft.token} onChange={e=>setDraft(p=>({...p,token:e.target.value}))} required minLength={24} autoComplete="off"/>
      <button className="primary-button connect-submit" disabled={busy} type="submit"><Link2 size={16}/>连接</button>
    </form>}
    {online&&<button className="disconnect-button" onClick={onDisconnect}><Unplug size={15}/>断开连接</button>}
    <UpdatePanel/>
  </>;
}
