import {useEffect,useRef,useState} from 'react';
import type {FormEvent,ReactNode} from 'react';
import {ArrowUp,ArrowUpRight,ArrowLeft,Check,ChevronDown,ChevronRight,Code2,Command,Copy,Folder,Globe,History,Laptop,Link2,LoaderCircle,Menu,MessageSquare,MoreHorizontal,Plus,Radio,RefreshCw,Search,Settings2,ShieldCheck,Square,Terminal,Unplug,Wifi,X} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {HarnessConnection} from './connection';
import WorkspaceSheet from './WorkspaceSheet';
import ModelSheet from './ModelSheet';
import MessageAttachments from './MessageAttachments';
import {attachmentContent,validateAttachments,IMAGE_TYPES} from './attachments';
import type {PendingAttachment} from './attachments';
import metadata from '../package.json';
import {deviceName} from './devices';
import type {SavedDevice,DeviceStatus} from './devices';
import {readModelProjection,advanceModelProjection,reasoningFor,modelChoice} from './modelSelection';
import type {ModelProjection} from './modelSelection';
import {workspaceOptions,sessionInWorkspace} from './workspaces';
import {emptyJournal,eventRows,reduceJournal} from './transcript';
import type {JournalState} from './transcript';
import type {Approval,ConnectionProfile,ConnectionState,MessageRow,ModelCatalog,ModelSelection,Session,WireEvent,Workspace} from './types';

const statusText={disconnected:'未连接',connecting:'正在连接',connected:'已连接',reconnecting:'重新连接中',error:'连接失败'};
function Logo({small=false}:{small?:boolean}){return <div className={'brand '+(small?'brand-small':'')}><span className="brand-mark"><Command size={small?18:24} strokeWidth={1.8}/></span><span>dsh<span className="brand-label">HARNESS</span></span></div>;}
function IconButton({label,children,onClick,className='',disabled=false}:{label:string;children:ReactNode;onClick:()=>void;className?:string;disabled?:boolean}){return <button type="button" className={'icon-button '+className} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;}
function timeLabel(time:number){const delta=Date.now()-time;return delta<60000?'刚刚':delta<3600000?`${Math.floor(delta/60000)} 分钟前`:new Date(time).toLocaleDateString('zh-CN',{month:'short',day:'numeric'});}
function basename(cwd?:string){return cwd?.split(/[\\/]/).filter(Boolean).at(-1)??'默认工作区';}

type Props={theme:string;onThemeChange:(theme:string)=>void;attempt:number;device:SavedDevice;active:boolean;blocked:boolean;initialDraft?:string;otherApprovals:number;onOpenConnections:(draft?:string)=>void;onStatus:(key:string,status:DeviceStatus)=>void};
export default function HostWorkspace({theme,onThemeChange:setTheme,attempt,device,active,blocked,initialDraft,otherApprovals,onOpenConnections,onStatus}:Props){
  const profile=device;const settings=blocked;
  const statusCallback=useRef(onStatus);statusCallback.current=onStatus;
  const hostName=device.key==='empty'?'':deviceName(device);
  function setSettings(open:boolean){if(open){setDrawer(false);setWorkspacePicker(false);onOpenConnections(device.key==='empty'?draft:undefined);}}

  const [client]=useState(()=>new HarnessConnection());
  const [state,setState]=useState<ConnectionState>('disconnected');
  const [connectionError,setConnectionError]=useState('');
  const [sessions,setSessions]=useState<Session[]>([]);
  const [selected,setSelected]=useState(()=>device.key==='empty'?'':localStorage.getItem('dsh.session.'+device.key)??'');
  const [journal,setJournal]=useState<JournalState>(emptyJournal);
  const [draft,setDraft]=useState(initialDraft??'');
  const [attachments,setAttachments]=useState<PendingAttachment[]>([]);const attachmentsRef=useRef(attachments);attachmentsRef.current=attachments;
  const [uploadStatus,setUploadStatus]=useState('');const fileInput=useRef<HTMLInputElement>(null);
  const [modelSettings,setModelSettings]=useState(false);const modelModal=useRef<HTMLElement>(null);
  const [pending,setPending]=useState<{id:string;text:string;accepted:boolean}|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [drawer,setDrawer]=useState(false);
  const [view,setView]=useState<'chat'|'activity'>('chat');
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [catalog,setCatalog]=useState<ModelCatalog>({groups:[]});
  const [modelProjection,setModelProjection]=useState<ModelProjection|null>(null);
  const [selectingModel,setSelectingModel]=useState(false);
  const selectionOperation=useRef(0);
  const [approvals,setApprovals]=useState<Approval[]>([]);
  const [resolving,setResolving]=useState('');
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [workspaceKey,setWorkspaceKey]=useState('');
  const [workspacePicker,setWorkspacePicker]=useState(false);
  const [addingWorkspace,setAddingWorkspace]=useState(false);
  const [toast,setToast]=useState('');
  const [older,setOlder]=useState(false);
  const clientId=useRef('');const selectedRef=useRef('');selectedRef.current=selected;
  const transcript=useRef<HTMLDivElement>(null);const followScroll=useRef(true);const composer=useRef<HTMLTextAreaElement>(null);
  const workspaceModal=useRef<HTMLElement>(null);const sidebar=useRef<HTMLElement>(null);
  const submission=useRef<{id:string;text:string;sessionId:string}|null>(null);
  const current=sessions.find(s=>s.sessionId===selected);
  const selection=(modelProjection??readModelProjection(current?.projections)).next??catalog.default??catalog.defaultSelection??null;
  const modelInfo=catalog.groups.find(g=>g.id===selection?.provider)?.models.find(m=>m.id===selection?.model);
  const reasoning=reasoningFor(catalog,selection);
  const reasoningEffort=selection?.reasoningEffort??reasoning?.defaultEffort??'';
  const rows=eventRows(journal.events);
  const online=state==='connected';
  const running=current?.running??false;
  const options=workspaceOptions(workspaces,sessions);
  const activeWorkspace=options.find(w=>w.key===workspaceKey);
  const currentWorkspace=current?options.find(w=>w.path===current.cwd):activeWorkspace;
  const createRequest=activeWorkspace?.workspaceId?{workspaceId:activeWorkspace.workspaceId}:activeWorkspace?{cwd:activeWorkspace.path}:{};

  useEffect(()=>()=>{for(const a of attachmentsRef.current)if(a.preview)URL.revokeObjectURL(a.preview);},[]);
  function addAttachments(files:File[]){try{validateAttachments([...attachments.map(a=>a.file),...files]);setAttachments(previous=>[...previous,...files.map(file=>({id:crypto.randomUUID(),file,...IMAGE_TYPES.includes(file.type)?{preview:URL.createObjectURL(file)}:{}}))]);setError('');}catch(e){setError((e as Error).message);}}
  function removeAttachment(id:string){setAttachments(previous=>previous.filter(a=>{if(a.id!==id)return true;if(a.preview)URL.revokeObjectURL(a.preview);return false;}));}
  async function refresh(){try{const result=await client.call<{items:Session[]}>('session/list');setSessions(result.items.map(s=>({...s,title:s.title??(typeof s.projections?.values.title==='string'?s.projections.values.title:undefined)})));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{
    client.onState=(s,message)=>{setState(s);setConnectionError(message??'');if(s!=='connected'){clientId.current='';setApprovals([]);}};
    if(device.enabled&&profile.deviceId&&profile.token)client.connect(profile);else client.disconnect();
    return()=>{client.onState=undefined;client.disconnect();};
  },[client,device.enabled,profile.url,profile.deviceId,profile.token,attempt]);
  useEffect(()=>{if(device.key!=='empty')statusCallback.current(device.key,{state,error:connectionError,name:client.name,approvals:approvals.length});},[device.key,client,state,connectionError,approvals.length]);
  useEffect(()=>{if(device.key!=='empty')localStorage.setItem('dsh.session.'+device.key,selected);},[device.key,selected]);
  useEffect(()=>{setWorkspaceKey(localStorage.getItem('dsh.workspace.'+device.key)??'');},[device.key]);
  useEffect(()=>{
    if(!online)return;
    let active=true;
    void refresh();
    client.call<ModelCatalog>('session/modelCatalog').then(value=>{if(active)setCatalog(value);}).catch(e=>{if(active)setError(e.message);});
    const unsub=client.subscribe('$events',{},(event:any)=>{
      if(event.type==='ready'){clientId.current=event.clientId;setApprovals([]);return;}
      if(event.type==='cancel'){setApprovals(a=>a.filter(x=>x.eventId!==event.eventId));return;}
      if(event.type==='waterfall'){
        if(event.event==='approval/request'){
          const approval={eventId:event.eventId,clientId:clientId.current,sessionId:event.agentId,tool:String(event.request.tool??'工具操作'),reason:String(event.request.displayReason??event.request.reason??'此操作需要你的确认')};
          setApprovals(a=>a.some(x=>x.eventId===approval.eventId)?a:[...a,approval]);
        }else{
          void client.call('$events/result',{clientId:clientId.current,eventId:event.eventId,outcome:{kind:'next'}}).catch(e=>setError(e.message));
        }
      }
      if(event.type==='event'&&event.event?.startsWith('api-session/'))void refresh();
    },e=>setError(e.message));
    const workspaceUnsub=client.subscribe('workspace/follow',{},(frame:any)=>{
      if(frame.type==='baseline')setWorkspaces(frame.value.items);
      else if(frame.type==='upsert')setWorkspaces(items=>[...items.filter(w=>w.workspaceId!==frame.workspace.workspaceId),frame.workspace]);
      else if(frame.type==='remove')setWorkspaces(items=>items.filter(w=>w.workspaceId!==frame.workspaceId));
      else if(frame.type==='order')setWorkspaces(items=>[...items].sort((a,b)=>frame.workspaceIds.indexOf(a.workspaceId)-frame.workspaceIds.indexOf(b.workspaceId)));
    },e=>setError(e.message));
    const timer=setInterval(()=>void refresh(),15000);
    return()=>{active=false;unsub();workspaceUnsub();clearInterval(timer);};
  },[online,client]);
  useEffect(()=>{
    setJournal(emptyJournal());setPending(null);setError('');setModelProjection(null);setSelectingModel(false);selectionOperation.current++;followScroll.current=true;
    if(!online||!selected)return;
    return client.subscribe('session/follow',{address:{kind:'session',sessionId:selected},assistantStream:true,maxMessages:100},item=>{
      if(item.type==='snapshot')setModelProjection(readModelProjection(item.projections));
      else if(item.type==='event')setModelProjection(previous=>advanceModelProjection(previous??readModelProjection(current?.projections),item.event));
      setJournal(previous=>{try{return reduceJournal(previous,item);}catch(e){setError((e as Error).message);return previous;}});
      const events=item.type==='snapshot'?(item.records??[]).map((r:any)=>r.event):item.type==='event'?[item.event]:[];
      if(events.some((e:any)=>e?.type==='turn/start'))setSessions(s=>s.map(row=>row.sessionId===selected?{...row,running:true}:row));
      if(events.some((e:any)=>e?.type==='turn/end')){setSessions(s=>s.map(row=>row.sessionId===selected?{...row,running:false}:row));void refresh();}
    },e=>setError(e.message));
  },[selected,online,client]);
  useEffect(()=>{
    if(pending&&journal.events.some(e=>(e.data.source as any)?.rpcId===pending.id))setPending(null);
  },[journal.events,pending]);
  useEffect(()=>{
    if((journal.events.length||journal.live||pending)&&followScroll.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;
  },[journal.events.length,journal.live,pending,selected]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),2500);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setModelSettings(false);setDrawer(false);setSettings(false);setWorkspacePicker(false);}};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{
    if(!active||settings)return;
    const container=modelSettings?modelModal.current:workspacePicker?workspaceModal.current:drawer?sidebar.current:null;
    if(!container)return;
    const previous=document.activeElement as HTMLElement|null;
    const focusables=()=>Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')).filter(el=>el.offsetParent!==null);
    focusables()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const nodes=focusables();const first=nodes[0];const last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[active,settings,drawer,workspacePicker,modelSettings]);

  function openWorkspaces(){if(!online){setSettings(true);return;}setWorkspacePicker(true);}
  function chooseWorkspace(key:string){if(submitting)return;setWorkspaceKey(key);localStorage.setItem('dsh.workspace.'+device.key,key);const option=options.find(w=>w.key===key);if(current&&!sessionInWorkspace(current,option))setSelected('');setWorkspacePicker(false);}
  async function addWorkspace(path:string){
    setAddingWorkspace(true);
    try{const result=await client.call<{workspace:Workspace}>('workspace/create',{path});setWorkspaces(items=>[...items.filter(w=>w.workspaceId!==result.workspace.workspaceId),result.workspace]);setWorkspaceKey(result.workspace.workspaceId);localStorage.setItem('dsh.workspace.'+device.key,result.workspace.workspaceId);setSelected('');setWorkspacePicker(false);}
    finally{setAddingWorkspace(false);}
  }
  async function createSession(){
    if(!online){setSettings(true);return;}
    setBusy(true);setError('');setDraft('');
    try{const intended=!selected?modelProjection?.next:null;const result=await client.call('session/create',createRequest);setSessions(items=>[{sessionId:result.sessionId,title:'新会话',cwd:activeWorkspace?.path,updatedAt:Date.now(),running:false,blank:true},...items.filter(s=>s.sessionId!==result.sessionId)]);setSelected(result.sessionId);setDrawer(false);setView('chat');if(intended){const choice=await client.call<{selected:ModelSelection}>('session/selectModel',{sessionId:result.sessionId,...intended});setCatalog(previous=>({...previous,default:choice.selected}));}void refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function submit(event:FormEvent){
    event.preventDefault();if((!draft.trim()&&!attachments.length)||submitting||selectingModel)return;if(!online){setSettings(true);return;}
    setSubmitting(true);setError('');
    const text=draft.trim();const fingerprint=JSON.stringify([text,...attachments.map(a=>a.id)]);const previous=submission.current;
    const requestId=previous?.text===fingerprint&&previous.sessionId===selected?previous.id:crypto.randomUUID();
    try{
      let sessionId=selected;
      if(!sessionId){const intended=modelProjection?.next;const result=await client.call('session/create',createRequest);sessionId=result.sessionId;setSelected(sessionId);if(intended){const choice=await client.call<{selected:ModelSelection}>('session/selectModel',{sessionId,...intended});setCatalog(previous=>({...previous,default:choice.selected}));}void refresh();}
      submission.current={id:requestId,text:fingerprint,sessionId};setPending({id:requestId,text:[text,...attachments.map(a=>'['+(IMAGE_TYPES.includes(a.file.type)?'图片':'附件')+'] '+a.file.name)].filter(Boolean).join('\n'),accepted:false});followScroll.current=true;
      const content=await attachmentContent(text,attachments,sessionId,(endpoint,params)=>client.call(endpoint,params),setUploadStatus);setUploadStatus(attachments.length?'正在发送附件…':'');
      await client.call('session/prompt',{sessionId,requestId,content,mode:running?'steer':'queue',clientTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      setPending(p=>p?.id===requestId?{...p,accepted:true}:p);submission.current=null;setDraft('');for(const a of attachments)if(a.preview)URL.revokeObjectURL(a.preview);setAttachments([]);void refresh();
    }catch(e){setError((e as Error).message);setPending(p=>p?.id===requestId?null:p);}finally{setSubmitting(false);setUploadStatus('');}
  }
  async function stop(){try{await client.call('session/cancel',{sessionId:selected});setToast('已请求停止当前任务');void refresh();}catch(e){setError((e as Error).message);}}
  async function changeSelection(next:ModelSelection){
    if(!selected){setModelProjection({lastUsed:null,next});return;}
    const target=selected,operation=++selectionOperation.current;setSelectingModel(true);setError('');
    try{const result=await client.call<{selected:ModelSelection}>('session/selectModel',{sessionId:target,...next});if(selectedRef.current!==target||selectionOperation.current!==operation)return;setModelProjection(previous=>({...previous??{lastUsed:null},next:result.selected}));setCatalog(previous=>({...previous,default:result.selected}));}
    catch(e){if(selectedRef.current===target&&selectionOperation.current===operation)setError((e as Error).message);}
    finally{if(selectionOperation.current===operation)setSelectingModel(false);}
  }
  function changeModel(value:string){const [provider,modelId]=value.split('\u001f');if(provider&&modelId)void changeSelection(modelChoice(catalog,provider,modelId,selection));}
  function changeEffort(value:string){if(selection&&reasoning?.efforts.some(e=>e.id===value))void changeSelection({...selection,reasoningEffort:value});}
  async function decide(approval:Approval,allow:boolean){
    setResolving(approval.eventId);
    try{await client.call('$events/result',{clientId:approval.clientId,eventId:approval.eventId,outcome:{kind:'result',value:allow?'allowed-once':'rejected'}});setApprovals(a=>a.filter(x=>x.eventId!==approval.eventId));}
    catch(e){setError((e as Error).message);}finally{setResolving('');}
  }
  async function loadOlder(){
    if(!selected||older)return;setOlder(true);
    try{const page=await client.call('session/page',{address:{kind:'session',sessionId:selected},throughSeq:journal.cursor,beforeSeq:journal.events[0]?.seq,maxMessages:100});
      setJournal(j=>({...j,events:[...page.records.filter((r:any)=>r.type==='event').map((r:any)=>r.event).filter((e:WireEvent)=>!j.events.some(old=>old.seq===e.seq)),...j.events],hasMore:page.hasMore}));
    }catch(e){setError((e as Error).message);}finally{setOlder(false);}
  }
  const visible=sessions.filter(s=>sessionInWorkspace(s,activeWorkspace)&&(s.title??s.sessionId).toLowerCase().includes(search.toLowerCase()));
  const tools=rows.filter(r=>r.kind==='tool');
  return <div className="app-shell">
    {drawer&&<button className="drawer-scrim" aria-label="关闭会话列表" onClick={()=>setDrawer(false)}/>}
    <aside ref={sidebar} inert={settings||workspacePicker} className={'sidebar '+(drawer?'is-open':'')} aria-label="会话导航">
      <div className="sidebar-brand"><Logo small/><IconButton className="mobile-only" label="关闭会话列表" onClick={()=>setDrawer(false)}><X size={19}/></IconButton><span className="desktop-only version">MOBILE</span></div>
      <button className="new-session" onClick={()=>void createSession()} disabled={busy||submitting}><Plus size={18}/>新建会话</button>
      <label className="search-box"><Search size={16}/><input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={e=>setSearch(e.target.value)}/><span className="shortcut">⌕</span></label>
      <div className="section-heading">工作区<span>{options.length||'—'}</span></div>
      <button className="workspace-row" aria-label="选择工作区" onClick={openWorkspaces}><Folder size={17}/><span>{activeWorkspace?.title??'所有工作区'}</span><ChevronDown size={15}/></button>
      <div className="section-heading history-heading">最近会话<History size={13}/></div>
      <nav className="session-list">
        {visible.map(session=><button className={'session-row '+(selected===session.sessionId?'selected':'')} key={session.sessionId} disabled={submitting} onClick={()=>{setSelected(session.sessionId);setDrawer(false);setView('chat');}}>
          <span className={'session-indicator '+(session.running?'is-running':'')}><MessageSquare size={16}/></span><span className="session-copy"><span>{session.title||'新会话'}</span><small>{basename(session.cwd)}<i/> {timeLabel(session.updatedAt)}</small></span>{session.running&&<span className="running-dot" aria-label="正在运行"/>}
        </button>)}
        {!visible.length&&<div className="sidebar-empty">{online?'还没有会话，开始一项新工作。':'连接 DSH 后，你的会话会出现在这里。'}</div>}
      </nav>
      <div className="sidebar-bottom"><button className="device-row" onClick={()=>setSettings(true)}><span className="device-icon"><Laptop size={18}/></span><span><strong>{online?hostName:'连接你的 DSH'}</strong><small><span className={'status-dot '+(online?'online':'')}/>{online?profile.mode==='lan'?'局域网连接':'公网连接':'手机与电脑，保持同步'}</small></span><Settings2 size={17}/></button><div className="sidebar-footnote"><span>DSH Companion</span><span>v{metadata.version}</span></div></div>
    </aside>
    <main className="main-pane" inert={settings||workspacePicker||drawer||modelSettings}>
      <header className="topbar"><div className="topbar-title"><IconButton className="mobile-only" label="打开会话列表" onClick={()=>setDrawer(true)}><Menu size={21}/></IconButton><span className="desktop-only breadcrumb">工作台<ChevronRight size={14}/></span><span className="topbar-session">{hostName&&<button className="host-caption" onClick={()=>setSettings(true)} aria-label="切换电脑"><Laptop size={11}/>{hostName}<ChevronDown size={10}/></button>}<span>{current?.title||'新会话'}</span></span>{running&&<span className="pill running"><span className="running-dot"/>进行中</span>}</div><div className="topbar-actions"><button className={'connection-pill '+(online?'is-online':'')} onClick={()=>setSettings(true)}><span className={'status-dot '+(online?'online':'')}/><span>{statusText[state]}</span></button><IconButton label={theme==='light'?'切换深色外观':'切换浅色外观'} onClick={()=>setTheme(theme==='light'?'dark':'light')}><Settings2 size={18}/></IconButton></div></header>
      <div className="view-tabs"><button className={view==='chat'?'active':''} onClick={()=>setView('chat')}><MessageSquare size={15}/>对话</button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}><Terminal size={15}/>执行记录{tools.length>0&&<span className="tab-count">{tools.length}</span>}</button><span className="tabs-spacer"/><span className="desktop-only remote-label"><Radio size={13}/>远程工作台</span></div>
      {(state==='reconnecting'||state==='error')&&<div className="connection-banner" role="status"><Wifi size={16}/><span>{connectionError||statusText[state]}</span><button onClick={()=>client.reconnect()}>重连</button></div>}
      <div className="conversation" ref={transcript} onScroll={()=>{const el=transcript.current;if(el)followScroll.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
        {view==='chat'&&rows.length===0&&!journal.live&&!pending?<div className="welcome welcome-minimal">
          <Logo/>
          {!online&&<button className="connect-prompt" onClick={()=>setSettings(true)}><Link2 size={15}/>连接 DSH</button>}
        </div>:view==='chat'?<div className="message-list">
          {journal.hasMore&&<button className="load-older" disabled={older} onClick={()=>void loadOlder()}>{older?<LoaderCircle className="spin" size={15}/>:<History size={15}/>}查看更早的消息</button>}
          {rows.map(row=><Message key={row.id} row={row} client={client} sessionId={selected} online={online} onCopy={text=>void navigator.clipboard.writeText(text).then(()=>setToast('已复制')).catch(()=>setError('无法访问剪贴板'))}/>)}
          {pending&&!journal.events.some(e=>(e.data.source as any)?.rpcId===pending.id)&&<Message row={{id:pending.id,kind:'user',text:pending.text,label:pending.accepted?'已受理':'发送中',pending:true}}/>}
          {journal.live&&<Message row={{id:'live',kind:'assistant',text:journal.live,pending:true}}/>}
          {running&&!journal.live&&<div className="working-indicator" role="status"><LoaderCircle className="spin" size={16}/>DSH 正在处理任务…</div>}
        </div>:<div className="activity-list"><div className="activity-heading"><h1>执行记录</h1></div>{tools.length?tools.map(row=><Message key={row.id} row={row}/>):<div className="activity-empty"><Terminal size={30}/><strong>暂无执行记录</strong></div>}</div>}
      </div>
      <div className="composer-region">
        {approvals.map(approval=><div className="approval-card" key={approval.eventId} role="region" aria-label="操作审批"><div><ShieldCheck size={19}/><strong>DSH 需要你的确认</strong><span>{approval.tool}</span></div><p>{approval.reason}</p><div className="approval-actions"><button onClick={()=>{if(approval.sessionId)setSelected(approval.sessionId!);setView('chat');}}>查看会话</button><button disabled={!!resolving||!online} onClick={()=>void decide(approval,false)}>拒绝</button><button className="primary-button" disabled={!!resolving||!online} onClick={()=>void decide(approval,true)}>允许这一次</button></div></div>)}
        {error&&<div className="error-message" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={()=>setError('')}><X size={16}/></IconButton></div>}
        <form className="composer" onSubmit={submit}>
          <input ref={fileInput} type="file" className="attachment-input" aria-label="选择图片或文件" multiple disabled={submitting} onChange={e=>{addAttachments(Array.from(e.target.files??[]));e.target.value='';}}/>
          {!!attachments.length&&<div className="pending-attachments" aria-label="待发送附件">{attachments.map(a=><div className="pending-attachment" key={a.id}>{a.preview?<img src={a.preview} alt={a.file.name}/>:<Code2 size={20}/>}<span>{a.file.name}<small>{Math.ceil(a.file.size/1024)} KB</small></span><button type="button" className="icon-button" aria-label={'移除附件 '+a.file.name} disabled={submitting} onClick={()=>removeAttachment(a.id)}><X size={16}/></button></div>)}</div>}
          {uploadStatus&&<p className="upload-status" role="status"><LoaderCircle className="spin" size={14}/>{uploadStatus}</p>}
          <textarea ref={composer} aria-label="发送给 DSH 的消息" placeholder={running?'补充说明，调整任务方向…':'给 DSH 一个任务，或接着聊…'} value={draft} disabled={submitting} onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();addAttachments(files);}}} onChange={e=>setDraft(e.target.value)} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(min-width: 768px)').matches){e.preventDefault();void submit(e);}}}/>
          <div className="composer-toolbar"><div className="composer-context"><button type="button" className="icon-button attachment-button" aria-label="添加图片或附件" disabled={submitting} onClick={()=>fileInput.current?.click()}><Plus size={20}/></button><button type="button" className="context-button" aria-label="选择会话工作区" disabled={submitting} onClick={openWorkspaces}><Folder size={15}/><span>{currentWorkspace?.title??'工作区'}</span><ChevronDown size={12}/></button><button type="button" className="context-button model-menu-button" aria-label="模型与推理强度" disabled={submitting} onClick={()=>setModelSettings(true)}><span>{modelInfo?.label??modelInfo?.name??selection?.model??'模型与推理'}</span><ChevronDown size={12}/></button></div><div className="composer-send">{running&&<IconButton label="停止任务" className="stop-button" onClick={()=>void stop()} disabled={!online}><Square size={15} fill="currentColor"/></IconButton>}<button className="send-button" type="submit" aria-label="发送消息" disabled={(!draft.trim()&&!attachments.length)||submitting||selectingModel}>{submitting?<LoaderCircle size={19} className="spin"/>:<ArrowUp size={20}/>}</button></div></div>
        </form>
      </div>
      <nav className="mobile-nav" aria-label="主要导航"><button className={view==='chat'?'active':''} onClick={()=>setView('chat')}><MessageSquare size={20}/><span>对话</span></button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}><Terminal size={20}/><span>执行</span></button><button onClick={()=>setDrawer(true)}><History size={20}/><span>会话</span></button><button onClick={()=>setSettings(true)}><Laptop size={20}/><span>连接{otherApprovals>0&&<i className="device-approval-badge" aria-label={`其他电脑有 ${otherApprovals} 项待审批`}>{otherApprovals}</i>}</span></button></nav>
    </main>
    {modelSettings&&<div className="modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)setModelSettings(false);}}><section ref={modelModal} className="settings-sheet model-sheet" role="dialog" aria-modal="true" aria-labelledby="model-title"><ModelSheet catalog={catalog} selection={selection} busy={selectingModel||submitting} online={online} error={error} onChoose={next=>void changeSelection(next)} onClose={()=>setModelSettings(false)}/></section></div>}
    {workspacePicker&&<div className="modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)setWorkspacePicker(false);}}><section ref={workspaceModal} className="settings-sheet workspace-sheet" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><WorkspaceSheet options={options} selected={workspaceKey} onChoose={chooseWorkspace} onClose={()=>setWorkspacePicker(false)} onAdd={addWorkspace} busy={addingWorkspace}/></section></div>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

function Message({row,onCopy,client,sessionId,online}:{row:MessageRow;onCopy?:(text:string)=>void;client?:HarnessConnection;sessionId?:string;online?:boolean}){
  if(row.kind==='tool')return <details className="tool-card"><summary><span className="tool-icon"><Terminal size={15}/></span><strong>{row.text}</strong><span className={'tool-status '+(row.pending?'pending':'')}>{row.pending?<LoaderCircle size={12} className="spin"/>:<Check size={12}/>} {row.label}</span><ChevronDown size={14}/></summary><pre>{row.detail||'此工具没有返回文本输出。'}</pre></details>;
  if(row.kind==='error')return <div className="error-message" role="alert">{row.text}</div>;
  return <article className={'message message-'+row.kind}><div className="message-header">{row.kind==='assistant'?<><span className="assistant-avatar"><Command size={14}/></span><strong>DSH</strong><span className="message-role">HARNESS</span></>:<><span className="user-avatar">你</span><strong>你</strong></>}{row.pending&&<small>{row.kind==='assistant'?'正在生成':row.label}</small>}</div><div className="message-content"><Markdown remarkPlugins={[remarkGfm]}>{row.text}</Markdown>{!!row.attachments?.length&&client&&sessionId&&<MessageAttachments items={row.attachments} sessionId={sessionId} client={client} online={!!online}/>}</div>{row.kind==='assistant'&&!row.pending&&onCopy&&<div className="message-actions"><IconButton label="复制回复" onClick={()=>onCopy(row.text)}><Copy size={15}/></IconButton></div>}</article>;
}
