// One logical channel across WSS and WebRTC. Only transport packets are replayed;
// a sequence is dispatched to the DSH adapter exactly once for this epoch.
export const LIMIT=8*1024*1024;
const size=s=>new TextEncoder().encode(s).length;
export class ReliablePipe {
  constructor(session,epoch,{relay,deliver,fatal,now=Date.now}){
    Object.assign(this,{session,epoch,relay,deliver,fatal,now});
    this.sent=0;this.received=0;this.acked=0;this.bytes=0;this.gapBytes=0;this.pending=new Map();this.gaps=new Map();this.direct=null;this.closed=false;
  }
  send(body){
    if(this.closed)return false;
    const packet={type:'p2p-packet',session:this.session,epoch:this.epoch,seq:++this.sent,ack:this.received,body};
    const raw=JSON.stringify(packet),bytes=size(raw);
    if(bytes>LIMIT||this.bytes+bytes>LIMIT*2||this.pending.size>=2048){this.fail();return false;}
    this.pending.set(packet.seq,{raw,bytes});this.bytes+=bytes;this.write(raw);return true;
  }
  write(raw){if(this.closed)return false;if(this.direct?.(raw))return true;return !!this.relay?.(raw);}
  receive(raw){
    if(this.closed)return;
    try{
      if(typeof raw!=='string'||size(raw)>LIMIT)throw Error();const f=JSON.parse(raw);
      if(f.session!==this.session||f.epoch!==this.epoch)return;
      if(!['p2p-packet','p2p-ack'].includes(f.type)||!Number.isSafeInteger(f.ack)||f.ack<0||f.ack>this.sent)throw Error();
      if(f.ack>this.acked){this.acked=f.ack;for(const [seq,p]of this.pending)if(seq<=f.ack){this.pending.delete(seq);this.bytes-=p.bytes;}}
      if(f.type==='p2p-ack')return;
      if(!Number.isSafeInteger(f.seq)||f.seq<1||!f.body||typeof f.body!=='object'||Array.isArray(f.body))throw Error();
      if(f.seq>this.received&&!this.gaps.has(f.seq)){
        const bytes=size(raw);if(this.gaps.size>=2048||this.gapBytes+bytes>LIMIT*2)throw Error();
        this.gaps.set(f.seq,{body:f.body,bytes});this.gapBytes+=bytes;
      }
      while(this.gaps.has(this.received+1)){
        const p=this.gaps.get(++this.received);this.gaps.delete(this.received);this.gapBytes-=p.bytes;this.deliver(p.body);
      }
      this.write(JSON.stringify({type:'p2p-ack',session:this.session,epoch:this.epoch,ack:this.received}));
    }catch{this.fail();}
  }
  replay(){for(const p of this.pending.values())this.write(p.raw);}
  setDirect(send){this.direct=send;this.replay();}
  setRelay(send){this.relay=send;this.replay();}
  fail(){if(this.closed)return;this.close();this.fatal();}
  close(){this.closed=true;this.direct=null;this.relay=null;this.pending.clear();this.gaps.clear();this.bytes=0;this.gapBytes=0;}
}
