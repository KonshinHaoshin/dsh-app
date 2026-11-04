export const MAX_ATTACHMENT_BYTES=4*1024*1024;
export const MAX_ATTACHMENTS=6;
export const IMAGE_TYPES=['image/png','image/jpeg','image/webp','image/gif'];
export type PendingAttachment={id:string;file:File;preview?:string};
export type AttachmentRef={attachmentId:string;name?:string;mediaType?:string;bytes?:number};
export type PromptPart={type:'text';text:string}|{type:'image';mediaType:string;data:string;name:string}|{type:'file';receiptId:string};
export function validateAttachments(files:Pick<File,'size'|'type'|'name'>[]){
 if(files.length>MAX_ATTACHMENTS)throw new Error(`一次最多添加 ${MAX_ATTACHMENTS} 个附件`);
 if(files.reduce((n,f)=>n+f.size,0)>MAX_ATTACHMENT_BYTES)throw new Error('附件合计不能超过 4 MB，请缩小图片或分次发送');
 for(const f of files)if(f.type.startsWith('image/')&&!IMAGE_TYPES.includes(f.type))throw new Error(`${f.name} 的图片格式暂不支持，请使用 PNG、JPEG、WebP 或 GIF`);
}
export async function encodeFile(file:Blob){
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}
export async function attachmentContent(text:string,files:PendingAttachment[],sessionId:string,call:<T=any>(endpoint:string,params:Record<string,unknown>)=>Promise<T>,onProgress:(message:string)=>void):Promise<PromptPart[]>{
 validateAttachments(files.map(a=>a.file));const content:PromptPart[]=text.trim()?[{type:'text',text:text.trim()}]:[];
 for(let i=0;i<files.length;i++){
  const file=files[i].file;onProgress(`正在准备附件 ${i+1}/${files.length}`);const data=await encodeFile(file);
  if(IMAGE_TYPES.includes(file.type))content.push({type:'image',mediaType:file.type,data,name:file.name});
  else{onProgress(`正在上传 ${file.name}`);const result=await call<{receiptId:string}>('fileUploads/upload',{sessionId,data,name:file.name});if(typeof result.receiptId!=='string')throw new Error('电脑未返回附件凭据，请更新电脑端插件');content.push({type:'file',receiptId:result.receiptId});}
 }
 return content;
}
