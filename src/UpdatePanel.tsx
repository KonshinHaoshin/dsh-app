import {useEffect,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {Capacitor,registerPlugin} from '@capacitor/core';
import type {PluginListenerHandle} from '@capacitor/core';
import metadata from '../package.json';
import {fetchAppUpdate,isNewerVersion} from './updates';
import {cachedUpdate,saveUpdate} from './updateCache';
import type {AppUpdate} from './updates';
const installer=registerPlugin<{download(options:AppUpdate['android']&{version:string;versionCode:number}):Promise<{ready:boolean}>;install():Promise<{permissionRequired?:boolean;started?:boolean}>;status():Promise<{downloading:boolean;ready:boolean;version:string;received:number;total:number}>;addListener(event:'progress',callback:(p:{received:number;total:number})=>void):Promise<PluginListenerHandle>}>('AppUpdater');
export default function UpdatePanel(){
 const [version,setVersion]=useState(metadata.version),[checking,setChecking]=useState(false),[update,setUpdate]=useState<AppUpdate|null>(()=>cachedUpdate(metadata.version)),[message,setMessage]=useState(''),[error,setError]=useState('');
 const[downloading,setDownloading]=useState(false),[readyVersion,setReadyVersion]=useState(''),[progress,setProgress]=useState(0);
 const ready=!!update&&readyVersion===update.version;
 const android=Capacitor.getPlatform()==='android';
 useEffect(()=>{let active=true;if(Capacitor.isNativePlatform())void import('@capacitor/app').then(({App})=>App.getInfo()).then(info=>{if(active)setVersion(info.version);}).catch(()=>{});return()=>{active=false;};},[]);
 useEffect(()=>{const refresh=()=>setUpdate(cachedUpdate(version));refresh();window.addEventListener('dsh-update-available',refresh);return()=>window.removeEventListener('dsh-update-available',refresh);},[version]);
 useEffect(()=>{if(!android)return;let active=true;const listener=installer.addListener('progress',p=>{if(active){setDownloading(true);setProgress(p.total?Math.min(100,Math.floor(p.received/p.total*100)):0);}});void installer.status().then(s=>{if(active){setDownloading(s.downloading);setReadyVersion(s.ready?s.version:'');setProgress(s.total?Math.floor(s.received/s.total*100):0);}}).catch(()=>{});return()=>{active=false;void listener.then(h=>h.remove());};},[android]);
 async function check(){setChecking(true);setError('');setMessage('');setUpdate(null);try{const latest=await fetchAppUpdate();saveUpdate(latest,version);if(isNewerVersion(latest.version,version))setUpdate(latest);else setMessage('已是最新版本');}catch(e){setError(e instanceof Error?e.message:'检查更新失败，请稍后重试');}finally{setChecking(false);}}
 async function install(){setError('');try{const result=await installer.install();if(result.permissionRequired)setMessage('请允许 DSH 安装更新，返回后点击“安装更新”。');else setMessage('请在系统界面确认安装。');}catch(e){setReadyVersion('');setError((e as Error).message??'无法打开系统安装界面');}}
 async function download(){if(!update)return;setError('');try{if(android){setDownloading(true);setProgress(0);await installer.download({...update.android,version:update.version,versionCode:update.versionCode});setReadyVersion(update.version);setDownloading(false);await install();}else if(Capacitor.isNativePlatform()){const{AppLauncher}=await import('@capacitor/app-launcher');const result=await AppLauncher.openUrl({url:update.android.url});if(!result.completed)throw new Error('无法打开下载地址');}else window.open(update.android.url,'_blank','noopener,noreferrer');}catch(e){setError(e instanceof Error?e.message:'下载失败，请稍后重试');}finally{setDownloading(false);}}
 return <section className="app-update" aria-label="应用更新"><div className="update-heading"><span>DSH <span className="update-version">v{version}</span></span><button type="button" onClick={()=>void check()} disabled={checking||downloading}><RefreshCw size={14} className={checking?'spin':''}/>{checking?'正在检查…':'检查更新'}</button></div>
 {message&&<p className="update-message" role="status">{message}</p>}{error&&<p className="form-status" role="alert">{error}</p>}
 {update&&<div className="update-available"><strong>发现新版本 v{update.version}</strong><p>{update.notes}</p>{Capacitor.getPlatform()==='ios'?<p>iOS 暂未提供安装包</p>:<>{downloading?<div role="status"><progress aria-label="更新下载进度" max={100} value={progress}/><span>正在下载并校验… {progress}%</span></div>:<button className="primary-button" type="button" onClick={()=>void(ready&&android?install():download())}><Download size={16}/>{ready&&android?'安装更新':`下载更新 · ${(update.android.size/1048576).toFixed(1)} MB`}</button>}<small>{android?'下载后校验完整性和签名，由系统确认安装':'下载 APK 后按系统提示安装'}</small></>}</div>}
 </section>;
}
