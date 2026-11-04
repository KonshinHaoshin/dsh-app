import {useEffect,useRef,useState} from 'react';
import {File,Image as ImageIcon,LoaderCircle} from 'lucide-react';
import type {AttachmentRef} from './attachments';
import {IMAGE_TYPES} from './attachments';
import type {HarnessConnection} from './connection';
export default function MessageAttachments({items,sessionId,client,online}:{items:AttachmentRef[];sessionId:string;client:HarnessConnection;online:boolean}){
 return <div className="message-attachments">{items.map((item,i)=><Attachment key={item.attachmentId+'-'+i} {...{item,sessionId,client,online}}/>)}</div>;
}
function Attachment({item,sessionId,client,online}:{item:AttachmentRef;sessionId:string;client:HarnessConnection;online:boolean}){
 const element=useRef<HTMLDivElement>(null);const[visible,setVisible]=useState(false),[src,setSrc]=useState(''),[error,setError]=useState('');const image=IMAGE_TYPES.includes(item.mediaType??'');
 useEffect(()=>{const el=element.current;if(!el||!image)return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}});observer.observe(el);return()=>observer.disconnect();},[image]);
 useEffect(()=>{if(!visible||!online||!image||src)return;let alive=true;setError('');void client.call<{data:string;attachment:{mediaType:string}}>('session/attachment',{sessionId,attachmentId:item.attachmentId}).then(result=>{if(!alive)return;if(!IMAGE_TYPES.includes(result.attachment?.mediaType)||typeof result.data!=='string')throw new Error('图片数据无效');setSrc(`data:${result.attachment.mediaType};base64,${result.data}`);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[visible,online,sessionId,item.attachmentId,client,image,src]);
 return <div ref={element} className={'message-attachment '+(image?'is-image':'')}>{src?<a href={src} target="_blank" rel="noreferrer" aria-label={'查看图片 '+(item.name??'')}><img src={src} alt={item.name??'图片附件'} loading="lazy"/></a>:<><span>{image?(visible&&online&&!error?<LoaderCircle size={20} className="spin"/>:<ImageIcon size={20}/>):<File size={20}/>}</span><span>{item.name??(image?'图片':'文件附件')}{item.bytes!==undefined&&<small>{Math.ceil(item.bytes/1024)} KB</small>}{error&&<small>图片暂时无法加载</small>}</span></>}</div>;
}
