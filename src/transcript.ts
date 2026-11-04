import type {MessageRow,WireEvent} from './types';
import type {AttachmentRef} from './attachments';
type AnyRecord=Record<string,any>;
export function contentText(content:unknown):string {
  if(typeof content==='string')return content;
  if(!Array.isArray(content))return '';
  return content.map(part=>typeof part==='string'?part:part?.type==='text'?part.text:part?.type==='image'?'[图片]':part?.type==='file'?'[文件]':'').filter(Boolean).join('\n');
}
export function streamText(stream:unknown):string {
  if(!Array.isArray(stream))return '';
  return stream.map(r=>r.type==='text-chunks'?r.texts.join(''):r.type==='chunk'&&r.chunk?.type==='text-delta'?r.chunk.text:'').join('');
}
export function eventRows(events:WireEvent[]):MessageRow[]{
  const rows:MessageRow[]=[];
  const toolCalls=new Map<string,MessageRow>();
  for(const event of events){
    const d=event.data as AnyRecord;const id=String(event.seq);
    switch(event.type){
      case 'user/message': {
        const source=d.source??d.message?.source;
        // DSH records injected context as user/message too; classify by source,
        // never by matching its text (a real user may quote the same words).
        if(source?.kind&&source.kind!=='user')break;
        const content=d.content??d.message?.content;
        const attachments:AttachmentRef[]=Array.isArray(content)?content.filter(p=>['image','file'].includes(p?.type)&&p.attachment?.attachmentId).map(p=>p.attachment):[];
        const text=Array.isArray(content)?content.filter(p=>p?.type==='text').map(p=>p.text).join('\n'):contentText(content);
        rows.push({id,kind:'user',text,attachments,time:event.time});break;
      }
      case 'assistant/message':case 'assistant/attempt':{
        const stream=d.stream??d.message?.stream;
        const text=streamText(stream)||contentText(d.content??d.message?.content);
        if(text)rows.push({id,kind:'assistant',text,time:event.time});
        for(const block of d.message?.content??[]){
          if(block.type!=='tool-call')continue;
          const input=block.arguments??block.input;
          const row:MessageRow={id:`${id}-tool-${block.id}`,kind:'tool',text:block.name??'工具',label:'等待执行',detail:typeof input==='string'?input:JSON.stringify(input,null,2),pending:true};
          toolCalls.set(block.id,row);rows.push(row);
        }
        if(event.type==='assistant/attempt'&&d.error)rows.push({id:id+'error',kind:'error',text:typeof d.error==='string'?d.error:d.error.message??'本次生成未完成'});
        break;
      }
      case 'tool/call':{
        const existing=toolCalls.get(String(d.callId));
        if(existing){existing.label='正在执行';break;}
        const call=d.call??d;const name=String(call.name??call.tool??'工具');const input=call.arguments??call.input??call.args;
        const detail=typeof input==='string'?input:JSON.stringify(input,null,2);
        const row:MessageRow={id,kind:'tool',text:name,label:'正在执行',detail,pending:true};rows.push(row);toolCalls.set(String(call.id??call.callId),row);break;
      }
      case 'tool/result':{
        const callId=String(d.message?.source?.callId??d.callId??d.toolCallId??d.id);const row=toolCalls.get(callId);const result=d.message??d.result??d;
        const text=contentText(result.content)||contentText(d.content)||String(result.error?.message??'');
        if(row){row.pending=false;row.label=result.isError||result.error?'执行失败':'已完成';row.detail=[row.detail,text].filter(Boolean).join('\n\n');}
        else rows.push({id,kind:'tool',text:String(d.name??d.tool??'工具结果'),label:result.isError?'执行失败':'已完成',detail:text||JSON.stringify(result,null,2)});
        break;
      }
      case 'turn/end':for(const row of toolCalls.values())if(row.pending){row.pending=false;row.label='已结束';}break;
    }
  }
  return rows.filter(row=>row.kind==='tool'||row.text.trim()||row.attachments?.length);
}

export type JournalState={events:WireEvent[];cursor:number;hasMore:boolean;live:string;attemptId?:string;nextIndex:number;revision:number;liveStream:unknown[]};
export const emptyJournal=():JournalState=>({events:[],cursor:-1,hasMore:false,live:'',nextIndex:0,revision:0,liveStream:[]});
// Snapshot on each transport generation replaces the durable baseline. No replayed
// live delta is appended to old text. Sequence gaps are surfaced for refetch.
export function reduceJournal(state:JournalState,item:AnyRecord):JournalState {
  if(item.type==='snapshot'){
    const attempt=item.assistantStream?.activeAttempt;
    const events=(item.records??[]).filter((r:AnyRecord)=>r.type==='event').map((r:AnyRecord)=>r.event);
    return {events,cursor:item.cursor,hasMore:item.hasMore,live:streamText(attempt?.stream),attemptId:attempt?.attemptId,nextIndex:attempt?.nextIndex??0,revision:item.assistantStream?.revision??0,liveStream:attempt?.stream??[]};
  }
  if(item.type==='event'){
    const event=item.event as WireEvent;
    if(event.seq<=state.cursor)return state;
    if(event.seq!==state.cursor+1)throw new Error('会话记录出现缺口，请重新连接以恢复');
    const settled=['assistant/message','assistant/attempt'].includes(event.type);
    return {...state,events:[...state.events,event],cursor:event.seq,live:settled?'':state.live};
  }
  if(item.type==='assistant-stream'){
    const frame=item.frame;
    if(frame.revision<=state.revision)return state;
    if(frame.type==='start')return {...state,revision:frame.revision,attemptId:frame.attemptId,live:'',nextIndex:0,liveStream:[]};
    if(frame.revision!==state.revision+1)throw new Error('实时内容需要重新同步，请重新连接');
    if(frame.type==='chunk'){
      if(frame.attemptId!==state.attemptId||frame.index!==state.nextIndex)throw new Error('实时消息顺序不一致，请重新连接');
      return {...state,revision:frame.revision,nextIndex:state.nextIndex+1,live:state.live+(frame.chunk.type==='text-delta'?frame.chunk.text:''),liveStream:[...state.liveStream,{type:'chunk',chunk:frame.chunk}]};
    }
    if(frame.type==='end')return {...state,revision:frame.revision,attemptId:undefined,live:'',liveStream:[]};
  }
  return state;
}
