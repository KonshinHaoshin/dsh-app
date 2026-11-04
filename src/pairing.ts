import type {ConnectionProfile} from './types';
export type PairingLink={v:1;url:string;mode:'public'|'lan';deviceId:string;name?:string;code:string;expiresAt:number};
export function parsePairingLink(text:string,now=Date.now()):PairingLink{
  if(text.length>8192)throw new Error('配对链接无效');
  let payload:unknown;
  try{
    const link=new URL(text.trim());
    if(link.protocol!=='https:'||link.hostname!=='dshapi.shelterhub.moe')throw Error();
    const encoded=new URLSearchParams(link.hash.slice(1)).get('pair');if(!encoded)throw Error();
    const binary=atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
    payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
  }catch{throw new Error('请扫描 DSH 电脑端生成的配对码');}
  const value=payload as PairingLink;
  if(!value||value.v!==1||!['public','lan'].includes(value.mode)||!/^[-\w]{3,80}$/.test(value.deviceId)||typeof value.code!=='string'||value.code.length<24||value.code.length>128||!Number.isSafeInteger(value.expiresAt))throw new Error('配对码格式不正确');
  if(value.expiresAt<=now)throw new Error('配对码已过期，请在电脑端刷新');
  if(value.expiresAt>now+10*60*1000)throw new Error('配对码时间无效，请检查设备时间');
  let url:URL;try{url=new URL(value.url);}catch{throw new Error('配对地址无效');}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('配对地址无效');
  if(value.mode==='public'&&url.protocol!=='https:')throw new Error('公网配对需要安全连接');
  if(value.mode==='lan'&&(!['http:','https:'].includes(url.protocol)||!(/^(localhost|127\.0\.0\.1|10\.(\d+\.){2}\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname)||url.hostname==='[::1]')))throw new Error('局域网配对地址无效');
  return {...value,url:url.origin,name:typeof value.name==='string'?value.name.slice(0,100):undefined};
}
export function redeemPairing(link:PairingLink):Promise<ConnectionProfile>{
  return new Promise((resolve,reject)=>{
    const url=new URL(link.url);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.pathname='/connect';
    const ws=new WebSocket(url);let settled=false;
    const finish=(error?:Error,token?:string,name?:string)=>{if(settled)return;settled=true;clearTimeout(timer);ws.close();error?reject(error):resolve({url:link.url,deviceId:link.deviceId,token:token!,mode:link.mode,name:name??link.name});};
    const timer=setTimeout(()=>finish(new Error('连接超时，请确认电脑 DSH 正在运行')),10000);
    ws.onopen=()=>ws.send(JSON.stringify({type:'pair',deviceId:link.deviceId,code:link.code}));
    ws.onmessage=event=>{try{const value=JSON.parse(event.data);if(value.type==='paired'&&value.protocol===1&&value.deviceId===link.deviceId&&typeof value.token==='string'&&value.token.length>=24)finish(undefined,value.token,typeof value.name==='string'?value.name.slice(0,100):undefined);else finish(new Error(value.message??'配对失败，请刷新配对码'));}catch{finish(new Error('配对响应无效'));}};
    ws.onerror=()=>finish(new Error('无法连接电脑，请检查网络'));
    ws.onclose=event=>finish(new Error(event.reason||'配对码已失效，请在电脑端刷新'));
  });
}
export async function scanPairingCode(){
  const {CapacitorBarcodeScanner,CapacitorBarcodeScannerAndroidScanningLibrary}=await import('@capacitor/barcode-scanner');
  const result=await CapacitorBarcodeScanner.scanBarcode({hint:0,scanInstructions:'扫描电脑上的 DSH 配对码',cameraDirection:1,android:{scanningLibrary:CapacitorBarcodeScannerAndroidScanningLibrary.ZXING},web:{showCameraSelection:false,scannerFPS:10}});
  return result.ScanResult;
}
