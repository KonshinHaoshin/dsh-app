import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAttachments,attachmentContent} from '../src/attachments.ts';
test('attachment batch fits the relay frame and refuses unsupported image formats',()=>{
 assert.throws(()=>validateAttachments([{size:4*1024*1024+1,type:'text/plain',name:'large'}]),/4 MB/);
 assert.throws(()=>validateAttachments([{size:1,type:'image/heic',name:'photo.heic'}]),/格式/);
 assert.throws(()=>validateAttachments(Array.from({length:7},()=>({size:1,type:'text/plain',name:'a'}))),/最多/);
});
test('images use DSH image admission and files use session scoped upload receipts',async()=>{
 const calls=[];const result=await attachmentContent('look',[{id:'image',file:new File(['photo'],'image.png',{type:'image/png'})},{id:'file',file:new File(['notes'],'notes.txt',{type:'text/plain'})}],'session-1',async(e,p)=>{calls.push([e,p]);return {receiptId:'receipt'};},()=>{});
 assert.deepEqual(calls,[['fileUploads/upload',{sessionId:'session-1',data:'bm90ZXM=',name:'notes.txt'}]]);assert.deepEqual(result,[{type:'text',text:'look'},{type:'image',mediaType:'image/png',data:'cGhvdG8=',name:'image.png'},{type:'file',receiptId:'receipt'}]);
});
