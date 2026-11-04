import type { ConnectionProfile, ConnectionState } from './types';
import {HybridSocket} from './transport/HybridSocket';
type Frame = {type:string;id?:string;value?:unknown;error?:{code:string;message:string};name?:string;protocol?:number};
type Subscription = {endpoint:string;params:Record<string,unknown>;onItem:(value:any)=>void;onError:(error:Error)=>void};
export class HarnessConnection {
  private ws?:HybridSocket;
  transport:'relay'|'p2p'|'lan'='relay';
  onTransport?:(transport:'relay'|'p2p'|'lan')=>void;
  private profile?:ConnectionProfile;
  private pending=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private streams=new Map<string,Subscription>();
  private retry?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastFrame=0;
  private pongSupported=false;
  private wake=()=>{if(!this.disposed&&Date.now()-this.lastFrame>15000)this.reconnect();};
  private visible=()=>{if(document.visibilityState==='visible')this.wake();};
  private handshake?:ReturnType<typeof setTimeout>;
  private disposed=true;
  private attempts=0;
  state:ConnectionState='disconnected';
  name='';
  onState?:(state:ConnectionState,error?:string)=>void;
  private setState(state:ConnectionState,error?:string){this.state=state;this.onState?.(state,error);}
  connect(profile:ConnectionProfile){this.disconnect();this.profile=profile;this.disposed=false;this.attempts=0;window.addEventListener('online',this.wake);window.addEventListener('dsh-resume',this.wake);document.addEventListener('visibilitychange',this.visible);this.open();}
  private open(){
    if(this.disposed||!this.profile)return;
    clearInterval(this.heartbeat);this.pongSupported=false;
    this.setState(this.attempts?'reconnecting':'connecting');
    let url:URL;
    try{
      url=new URL(this.profile.url);url.protocol=url.protocol==='https:'?'wss:':url.protocol==='http:'?'ws:':url.protocol;
      if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请输入有效的服务器地址');
      if(url.protocol==='ws:' && this.profile.mode==='public')throw new Error('公网连接需要 HTTPS / WSS');
      url.pathname='/connect';
      this.ws=new HybridSocket(url,this.profile,route=>{this.transport=route;this.onTransport?.(route);});
    }catch(error){this.setState('error',(error as Error).message);return;}
    const ws=this.ws;
    this.handshake=setTimeout(()=>{if(this.ws===ws)ws.close(4000,'连接超时');},10000);
    ws.onopen=()=>{if(this.ws===ws)ws.send(JSON.stringify({type:'hello',deviceId:this.profile!.deviceId,token:this.profile!.token}));};
    ws.onmessage=event=>{
      if(this.ws!==ws)return;
      try{
        const frame:Frame=JSON.parse(event.data);this.lastFrame=Date.now();if(frame.type==='pong'){this.pongSupported=true;return;}
        if(frame.type==='ready'){
          if(frame.protocol!==1)throw new Error('服务器协议版本不兼容');
          clearTimeout(this.handshake);this.attempts=0;this.name=frame.name??'DSH';this.setState('connected');
          this.heartbeat=setInterval(()=>{if(this.ws!==ws)return;if(this.pongSupported&&Date.now()-this.lastFrame>65000){this.reconnect();return;}this.send({type:'ping'});},20000);this.send({type:'ping'});
          for(const [id,stream]of this.streams)this.send({type:'open',id,endpoint:stream.endpoint,params:stream.params});
        }else if(frame.id){
          const stream=this.streams.get(frame.id);
          if(frame.type==='item')stream?.onItem(frame.value);
          else if(frame.type==='end'){this.streams.delete(frame.id);stream?.onError(new Error('事件流已结束，请重新连接'));}
          else if(frame.type==='result'||frame.type==='error'){
            const p=this.pending.get(frame.id);
            if(p){clearTimeout(p.timer);this.pending.delete(frame.id);frame.type==='result'?p.resolve(frame.value):p.reject(new Error(frame.error?.message??'请求失败'));}
            else if(stream){this.streams.delete(frame.id);stream.onError(new Error(frame.error?.message??'事件流失败'));}
          }
        }
      }catch(error){this.setState('error',(error as Error).message);ws.close(1002,'协议错误');}
    };
    ws.onerror=()=>{};
    ws.onclose=event=>{
      if(this.ws!==ws)return;
      clearTimeout(this.handshake);clearInterval(this.heartbeat);
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('连接已断开；请检查会话后重试'));}this.pending.clear();
      if(this.disposed)return;
      if(event.code===1008&&this.profile?.mode!=='public'){this.setState('error',event.reason||'配对失败，请检查设备和密钥');return;}
      this.attempts++;this.setState('reconnecting',event.code===1008?'电脑暂不可用，正在重试；已保留配对信息':'连接已断开，正在自动恢复');
      this.retry=setTimeout(()=>this.open(),Math.min(1000*2**Math.min(this.attempts-1,4),15000));
    };
  }
  private send(frame:unknown){if(this.ws?.readyState!==WebSocket.OPEN)return false;this.ws.send(JSON.stringify(frame));return true;}
  call<T=any>(endpoint:string,params:Record<string,unknown>={}):Promise<T>{
    if(this.state!=='connected')return Promise.reject(new Error('请先连接 DSH'));
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);this.send({type:'cancel',id});reject(new Error('请求超时，请检查会话后重试'));},30000);
      this.pending.set(id,{resolve,reject,timer});
      if(!this.send({type:'call',id,endpoint,params})){clearTimeout(timer);this.pending.delete(id);reject(new Error('连接已断开'));}
    });
  }
  subscribe(endpoint:string,params:Record<string,unknown>,onItem:Subscription['onItem'],onError:Subscription['onError']=()=>{}){
    const id=crypto.randomUUID();this.streams.set(id,{endpoint,params,onItem,onError});
    if(this.state==='connected')this.send({type:'open',id,endpoint,params});
    return()=>{this.streams.delete(id);this.send({type:'cancel',id});};
  }
  disconnect(){
    this.disposed=true;window.removeEventListener('online',this.wake);window.removeEventListener('dsh-resume',this.wake);document.removeEventListener('visibilitychange',this.visible);clearInterval(this.heartbeat);clearTimeout(this.retry);clearTimeout(this.handshake);this.ws?.close();this.ws=undefined;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('连接已关闭'));}this.pending.clear();this.streams.clear();this.setState('disconnected');
  }
  reconnect(){if(this.profile)this.connect(this.profile);}
}
