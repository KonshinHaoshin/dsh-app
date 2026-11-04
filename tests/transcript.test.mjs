import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyJournal,reduceJournal,eventRows,streamText} from '../src/transcript.ts';
test('compact DSH assistant stream excludes reasoning and tool arguments',()=>{
 assert.equal(streamText([{type:'reasoning-chunks',texts:['private']},{type:'text-chunks',texts:['Hello',' world']},{type:'chunk',chunk:{type:'text-delta',text:'!'}}]),'Hello world!');
});
test('reconnect replaces the baseline, drops duplicates, and reports durable gaps',()=>{
 const event={seq:0,type:'user/message',data:{content:[{type:'text',text:'hello'}]}};
 let state=reduceJournal(emptyJournal(),{type:'snapshot',cursor:0,records:[{type:'event',event}],assistantStream:{revision:1,activeAttempt:{attemptId:'a',nextIndex:2,stream:[{type:'text-chunks',texts:['Hi']}]}}});
 state=reduceJournal(state,{type:'assistant-stream',frame:{type:'chunk',revision:2,attemptId:'a',index:2,chunk:{type:'text-delta',text:' there'}}});assert.equal(state.live,'Hi there');
 assert.equal(reduceJournal(state,{type:'event',event}),state);
 assert.throws(()=>reduceJournal(state,{type:'event',event:{...event,seq:2}}),/缺口/);
 state=reduceJournal(state,{type:'snapshot',cursor:0,records:[{type:'event',event}],assistantStream:{revision:1,activeAttempt:{attemptId:'b',nextIndex:0,stream:[]}}});assert.equal(state.live,'');assert.equal(state.events.length,1);
});
test('tool results settle matching calls and completed assistant text renders once',()=>{
 const rows=eventRows([{seq:0,type:'tool/call',data:{id:'call',name:'bash',arguments:{cmd:'pwd'}}},{seq:1,type:'tool/result',data:{callId:'call',content:[{type:'text',text:'/workspace'}]}},{seq:2,type:'assistant/message',data:{stream:[{type:'text-chunks',texts:['Done']}]}}]);
 assert.equal(rows[0].pending,false);assert.match(rows[0].detail,/\/workspace/);assert.equal(rows[1].text,'Done');
});
