import {ReliablePipe} from './reliable.mjs';
import {RtcWire} from './rtc-wire.mjs';
import type {ConnectionProfile} from '../types';
const encoder=new TextEncoder();
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),v=>v.toString(16).padStart(2,'0')).join('');
export const signature=async(token:string,...parts:string[])=>{
 const key=await crypto.subtle.importKey('raw',encoder.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(['dsh-p2p-v1',...parts].join('\n'))));
};
type Route='relay'|'p2p'|'lan';
export class HybridSocket {
 readyState=0;onopen:(()=>void)|null=null;onmessage:((event:MessageEvent)=>void)|null=null;onclose:((event:CloseEvent)=>void)|null=null;onerror:(()=>void)|null=null;
 private ws?:WebSocket;private pipe?:ReliablePipe;private pc?:RTCPeerConnection;private wire?:RtcWire;
 private session=crypto.randomUUID();private epoch='';private nonce='';private attempt='';private candidates:RTCIceCandidateInit[]=[];
 private iceServers:RTCIceServer[]=[];private ready?:any;private joined=false;private direct=false;private disposed=false;private retry?:ReturnType<typeof setTimeout>;
 private tick:ReturnType<typeof setInterval>;private started=0;private lastPong=0;private lastProbe=0;private lastReplay=0;private nextProbe=0;
 constructor(private url:URL,private profile:ConnectionProfile,private route:(route:Route)=>void){
  this.openRelay();this.tick=setInterval(()=>this.poll(),50);
 }
 private raw(frame:any){if(this.ws?.readyState!==1)return false;this.ws.send(typeof frame==='string'?frame:JSON.stringify(frame));return true;}
 private openRelay(){
  if(this.disposed)return;const ws=new WebSocket(this.url);this.ws=ws;
  ws.onopen=()=>{if(this.ws!==ws)return;if(this.readyState===0){this.readyState=1;this.onopen?.();}else this.hello();};
  ws.onmessage=e=>{if(this.ws!==ws)return;void this.receive(String(e.data)).catch(()=>this.close(1002,'连接验证失败'));};
  ws.onerror=()=>this.onerror?.();
  ws.onclose=e=>{if(this.ws!==ws)return;this.ws=undefined;if(this.disposed)return;if(this.direct){this.retry=setTimeout(()=>this.openRelay(),1500);}else this.finish(e.code,e.reason);};
 }
 private hello(){
  const ws=this.ws;
  if(this.profile.mode==='public')void crypto.subtle.digest('SHA-256',encoder.encode(this.profile.token)).then(hash=>{if(this.ws===ws)this.raw({type:'hello',deviceId:this.profile.deviceId,tokenDigest:hex(hash)});});
  else this.raw({type:'hello',deviceId:this.profile.deviceId,token:this.profile.token});
 }
 private async receive(raw:string){
  if(raw.length>8*1024*1024)throw Error();const f=JSON.parse(raw);
  if(f.type==='ready'){
   if(this.profile.mode==='public'&&f.features?.includes('p2p-v1')){
    this.ready=f;this.nonce=crypto.randomUUID();const nonce=this.nonce;
    this.raw({type:'p2p-join',session:this.session,nonce,proof:await signature(this.profile.token,'join',this.session,nonce)});
   }else{this.route(this.profile.mode==='lan'?'lan':'relay');this.onmessage?.(new MessageEvent('message',{data:raw}));}
   return;
  }
  if(f.type==='p2p-joined'){
   if(f.session!==this.session||f.nonce!==this.nonce||typeof f.epoch!=='string'||!Array.isArray(f.iceServers)||f.iceServers.length>4||f.proof!==await signature(this.profile.token,'joined',f.session,f.epoch,f.nonce,JSON.stringify(f.iceServers)))throw Error();
   if(this.epoch&&this.epoch!==f.epoch){this.finish(1012,'电脑已重启，请检查任务状态');return;}
   this.epoch=f.epoch;this.iceServers=f.iceServers;
   if(!this.pipe)this.pipe=new ReliablePipe(this.session,this.epoch,{relay:s=>this.raw(s),deliver:body=>this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(body)})),fatal:()=>this.finish(1013,'连接缓冲已满，请检查会话后重试')});
   this.pipe.setRelay(s=>this.raw(s));
   if(!this.joined){this.joined=true;this.route('relay');this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(this.ready)}));}
   if(!this.pc)void this.negotiate(f.iceServers).catch(()=>this.dropDirect());return;
  }
  if(['p2p-packet','p2p-ack'].includes(f.type)){this.pipe?.receive(raw);return;}
  if(f.type==='p2p-reset'&&f.session===this.session){this.finish(1012,'会话连接需要重新同步');return;}
  if(f.type==='p2p-signal'){
   if(f.session!==this.session||f.epoch!==this.epoch||f.attempt!==this.attempt||f.role!=='host'||!['answer','candidate'].includes(f.kind)||typeof f.data!=='string'||f.data.length>65536||f.proof!==await signature(this.profile.token,'signal',this.session,this.epoch,this.attempt,'host',f.kind,f.data))return;
   const pc=this.pc;if(!pc)return;
   try{
    if(f.kind==='answer'){await pc.setRemoteDescription(JSON.parse(f.data));for(const c of this.candidates)await pc.addIceCandidate(c);this.candidates=[];}
    else if(pc.remoteDescription)await pc.addIceCandidate(JSON.parse(f.data));else if(this.candidates.length<100)this.candidates.push(JSON.parse(f.data));
   }catch{if(this.pc===pc)this.dropDirect();}return;
  }
  if(!this.joined)this.onmessage?.(new MessageEvent('message',{data:raw}));
 }
 private async signal(kind:string,data:string){const attempt=this.attempt;const proof=await signature(this.profile.token,'signal',this.session,this.epoch,attempt,'phone',kind,data);if(this.attempt===attempt)this.raw({type:'p2p-signal',session:this.session,epoch:this.epoch,attempt,role:'phone',kind,data,proof});}
 private async negotiate(iceServers:RTCIceServer[]){
  if(typeof RTCPeerConnection==='undefined')return;
  // Only STUN is accepted; WSS is the relay fallback, never a hidden TURN path.
  if(iceServers.some(s=>typeof s.urls!=='string'||!s.urls.startsWith('stun:')))return;
  const pc=new RTCPeerConnection({iceServers});this.pc=pc;this.attempt=crypto.randomUUID();this.started=Date.now();this.candidates=[];
  pc.onicecandidate=e=>{if(this.pc===pc&&e.candidate)void this.signal('candidate',JSON.stringify(e.candidate.toJSON())).catch(()=>this.dropDirect());};
  pc.onconnectionstatechange=()=>{if(this.pc===pc&&['failed','closed','disconnected'].includes(pc.connectionState))this.dropDirect();};
  const dc=pc.createDataChannel('dsh-p2p-v1',{ordered:true});dc.binaryType='arraybuffer';
  const wire=new RtcWire(dc,raw=>{
   if(this.pc!==pc)return;const f=JSON.parse(raw);
   if(f.type==='p2p-direct'&&f.session===this.session&&f.epoch===this.epoch&&f.attempt===this.attempt){this.direct=true;this.lastPong=Date.now();this.pipe?.setDirect(s=>wire.send(s));this.route('p2p');return;}
   if(f.type==='p2p-pong'){this.lastPong=Date.now();return;}
   this.pipe?.receive(raw);
  },()=>{if(this.pc===pc)this.dropDirect();});this.wire=wire;
  dc.onmessage=e=>{if(this.pc===pc){try{wire.accept(e.data);}catch{this.dropDirect();}}};dc.onclose=()=>{if(this.pc===pc)this.dropDirect();};dc.onerror=()=>{if(this.pc===pc)this.dropDirect();};
  const offer=await pc.createOffer();await this.signal('offer',JSON.stringify(offer));if(this.pc===pc)await pc.setLocalDescription(offer);
 }
 private dropDirect(){
  const pc=this.pc;this.pc=undefined;this.wire?.close();this.wire=undefined;this.direct=false;this.attempt='';this.candidates=[];this.nextProbe=Date.now()+60000;pc?.close();this.pipe?.setDirect(null);
  if(this.joined)this.route('relay');if(!this.ws&&!this.disposed)this.finish(1012,'网络需要重新连接');
 }
 private poll(){
  if(this.disposed)return;this.wire?.tick();const now=Date.now();
  if(this.direct){if(now-this.lastPong>15000){this.dropDirect();return;}if(now-this.lastProbe>5000){this.lastProbe=now;this.wire?.send(JSON.stringify({type:'p2p-probe',at:now}));}}
  else if(this.pc&&now-this.started>12000)this.dropDirect();
  else if(this.joined&&!this.pc&&this.nextProbe&&now>this.nextProbe&&this.ws?.readyState===1){this.nextProbe=now+60000;void this.negotiate(this.iceServers).catch(()=>this.dropDirect());}
  if(this.pipe&&now-this.lastReplay>2000&&(!this.wire||!(this.wire as any).queued)){this.lastReplay=now;this.pipe.replay();}
 }

 send(raw:string){if(this.disposed)return;const f=JSON.parse(raw);if(f.type==='hello'){this.hello();return;}if(this.joined)this.pipe?.send(f);else this.raw(raw);}
 close(code=1000,reason=''){if(this.disposed)return;if(this.joined)this.raw({type:'p2p-close',session:this.session,epoch:this.epoch});this.finish(code,reason);}
 private finish(code:number,reason:string){if(this.disposed)return;this.disposed=true;this.readyState=3;clearInterval(this.tick);clearTimeout(this.retry);this.pipe?.close();this.wire?.close();const pc=this.pc;this.pc=undefined;pc?.close();const ws=this.ws;this.ws=undefined;ws?.close(code===1000?1000:4001);this.onclose?.(new CloseEvent('close',{code,reason}));}
}
