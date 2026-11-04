export const UPDATE_MANIFEST_URL='https://raw.githubusercontent.com/KonshinHaoshin/dsh-app/main/update.json';
export type AppUpdate={schemaVersion:1;appId:'moe.shelterhub.dsh';version:string;versionCode:number;notes:string;android:{url:string;sha256:string;size:number}};
function versionParts(version:string){if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('版本号格式无效');return version.split('.').map(Number);}
export function isNewerVersion(latest:string,current:string){const a=versionParts(latest),b=versionParts(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
export function parseAppUpdate(value:unknown):AppUpdate{
  if(!value||typeof value!=='object')throw new Error('更新信息格式无效');
  const v=value as AppUpdate;versionParts(v.version);
  if(v.schemaVersion!==1||v.appId!=='moe.shelterhub.dsh'||!Number.isSafeInteger(v.versionCode)||v.versionCode<1||typeof v.notes!=='string'||v.notes.length>4000||!v.android||!/^[a-f0-9]{64}$/i.test(v.android.sha256)||!Number.isSafeInteger(v.android.size)||v.android.size<1||v.android.size>120*1024*1024)throw new Error('更新信息格式无效');
  const url=new URL(v.android.url);
  const raw=url.hostname==='raw.githubusercontent.com'&&url.pathname===`/KonshinHaoshin/dsh-app/v${v.version}/releases/v${v.version}/dsh-mobile-${v.version}-debug.apk`;
  const release=url.hostname==='github.com'&&url.pathname===`/KonshinHaoshin/dsh-app/releases/download/v${v.version}/dsh-mobile-${v.version}-debug.apk`;
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||(!raw&&!release))throw new Error('更新下载地址不受信任');
  return v;
}
export async function fetchAppUpdate(fetcher:typeof fetch=fetch):Promise<AppUpdate>{
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetcher(UPDATE_MANIFEST_URL,{cache:'no-store',credentials:'omit',signal:controller.signal});if(!response.ok)throw new Error(`无法检查更新（HTTP ${response.status}）`);return parseAppUpdate(await response.json());}
  catch(e){if(controller.signal.aborted)throw new Error('检查更新超时，请稍后重试');throw e;}
  finally{clearTimeout(timer);}
}
