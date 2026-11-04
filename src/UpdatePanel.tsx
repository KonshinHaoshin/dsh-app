import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {Capacitor} from '@capacitor/core';
import metadata from '../package.json';
import {fetchAppUpdate,isNewerVersion} from './updates';
import type {AppUpdate} from './updates';
export default function UpdatePanel(){
  const [version,setVersion]=useState(metadata.version),[checking,setChecking]=useState(false),[update,setUpdate]=useState<AppUpdate|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let active=true;if(Capacitor.isNativePlatform())void import('@capacitor/app').then(({App})=>App.getInfo()).then(info=>{if(active)setVersion(info.version);}).catch(()=>{});return()=>{active=false;};},[]);
  async function check(){setChecking(true);setError('');setMessage('');setUpdate(null);try{const latest=await fetchAppUpdate();if(isNewerVersion(latest.version,version))setUpdate(latest);else setMessage('已是最新版本');}catch(e){setError(e instanceof Error?e.message:'检查更新失败，请稍后重试');}finally{setChecking(false);}}
  async function download(){if(!update)return;setError('');try{if(Capacitor.isNativePlatform()){const{AppLauncher}=await import('@capacitor/app-launcher');const result=await AppLauncher.openUrl({url:update.android.url});if(!result.completed)throw new Error('无法打开下载地址');}else window.open(update.android.url,'_blank','noopener,noreferrer');}catch(e){setError(e instanceof Error?e.message:'无法打开下载地址');}}
  return <div className="app-update"><div className="update-heading"><span>DSH <span className="update-version">v{version}</span></span><button type="button" onClick={()=>void check()} disabled={checking}><RefreshCw size={14} className={checking?'spin':''}/>{checking?'正在检查…':'检查更新'}</button></div>
    {message&&<p className="update-message" role="status">{message}</p>}{error&&<p className="form-status" role="alert">{error}</p>}
    {update&&<div className="update-available"><strong>发现新版本 v{update.version}</strong><p>{update.notes}</p>{Capacitor.getPlatform()==='ios'?<p>iOS 暂未提供安装包</p>:<><button className="primary-button" type="button" onClick={()=>void download()}><Download size={16}/>下载更新 · {(update.android.size/1048576).toFixed(1)} MB</button><small>通过浏览器下载 APK，按系统提示安装</small></>}</div>}
  </div>;
}
