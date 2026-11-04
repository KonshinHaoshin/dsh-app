// Binary chunks avoid WebRTC's per-message limit, including multi-MB attachments.
// The queue and reassembly are bounded independently of SCTP backpressure.
const CHUNK=16000,MAX=8*1024*1024;
export class RtcWire {
  constructor(channel,receive,fatal){this.channel=channel;this.receive=receive;this.fatal=fatal;this.queue=[];this.queued=0;this.incoming=new Map();this.id=0;this.closed=false;}
  send(raw){
    if(this.closed||this.channel.readyState!=='open')return false;
    const data=new TextEncoder().encode(raw),count=Math.ceil(data.length/CHUNK);
    if(!count||data.length>MAX||this.queued+data.length>MAX*2){this.fail();return false;}
    const id=(++this.id)>>>0;
    for(let i=0;i<count;i++){const part=data.subarray(i*CHUNK,(i+1)*CHUNK),frame=new Uint8Array(8+part.length),head=new DataView(frame.buffer);head.setUint32(0,id);head.setUint16(4,i);head.setUint16(6,count);frame.set(part,8);this.queue.push(frame);this.queued+=frame.length;}
    this.flush();return true;
  }
  flush(){
    if(this.closed)return;
    try{while(this.queue.length&&this.channel.readyState==='open'&&this.channel.bufferedAmount<256*1024){const frame=this.queue.shift();this.queued-=frame.length;this.channel.send(frame);}}catch{this.fail();}
  }
  accept(bytes){
    if(this.closed)return;
    try{
      const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),head=new DataView(data.buffer,data.byteOffset,data.byteLength);
      if(data.length<=8||data.length>CHUNK+8)throw Error();const id=head.getUint32(0),index=head.getUint16(4),count=head.getUint16(6);
      if(!count||count>Math.ceil(MAX/CHUNK)||index>=count)throw Error();
      let entry=this.incoming.get(id);if(!entry){if(this.incoming.size>=4)throw Error();entry={count,parts:new Map(),bytes:0,at:Date.now()};this.incoming.set(id,entry);}
      if(count!==entry.count)throw Error();
      if(!entry.parts.has(index)){entry.parts.set(index,data.slice(8));entry.bytes+=data.length-8;if(entry.bytes>MAX)throw Error();}
      if(entry.parts.size===count){const full=new Uint8Array(entry.bytes);let offset=0;for(let i=0;i<count;i++){const part=entry.parts.get(i);full.set(part,offset);offset+=part.length;}this.incoming.delete(id);this.receive(new TextDecoder('utf-8',{fatal:true}).decode(full));}
    }catch{this.fail();}
  }
  tick(){this.flush();for(const e of this.incoming.values())if(Date.now()-e.at>30000){this.fail();break;}}
  fail(){if(this.closed)return;this.close();this.fatal();}
  close(){this.closed=true;this.queue=[];this.queued=0;this.incoming.clear();}
}
