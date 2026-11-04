import {useEffect,useRef,useState} from 'react';
import type {FormEvent,ReactNode} from 'react';
import {ArrowUp,ArrowUpRight,ArrowLeft,Check,ChevronDown,ChevronRight,Code2,Command,Copy,Folder,Globe,History,Laptop,Link2,LoaderCircle,Menu,MessageSquare,MoreHorizontal,Plus,Radio,RefreshCw,Search,Settings2,ShieldCheck,Square,Terminal,Unplug,Wifi,X} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {HarnessConnection} from './connection';
import ConnectionSheet from './ConnectionSheet';
import WorkspaceSheet from './WorkspaceSheet';
import metadata from '../package.json';
import {readModelProjection,advanceModelProjection,reasoningFor,modelChoice} from './modelSelection';
import type {ModelProjection} from './modelSelection';
import {workspaceOptions,sessionInWorkspace} from './workspaces';
import {parsePairingLink,redeemPairing} from './pairing';
import {emptyJournal,eventRows,reduceJournal} from './transcript';
import type {JournalState} from './transcript';
import type {Approval,ConnectionProfile,ConnectionState,MessageRow,ModelCatalog,ModelSelection,Session,WireEvent,Workspace} from './types';

const DEFAULT_URL='https://dshapi.shelterhub.moe';
const statusText={disconnected:'未连接',connecting:'正在连接',connected:'已连接',reconnecting:'重新连接中',error:'连接失败'};
function loadProfile():ConnectionProfile{
  try{const saved=JSON.parse(localStorage.getItem('dsh.connection')??'{}');return {url:saved.url??DEFAULT_URL,deviceId:saved.deviceId??'',mode:saved.mode??'public',token:sessionStorage.getItem('dsh.token')??''};}
  catch{return {url:DEFAULT_URL,deviceId:'',mode:'public',token:''};}
}
function Logo({small=false}:{small?:boolean}){return <div className={'brand '+(small?'brand-small':'')}><span className="brand-mark"><Command size={small?18:24} strokeWidth={1.8}/></span><span>dsh<span className="brand-label">HARNESS</span></span></div>;}
function IconButton({label,children,onClick,className='',disabled=false}:{label:string;children:ReactNode;onClick:()=>void;className?:string;disabled?:boolean}){return <button type="button" className={'icon-button '+className} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;}
function timeLabel(time:number){const delta=Date.now()-time;return delta<60000?'刚刚':delta<3600000?`${Math.floor(delta/60000)} 分钟前`:new Date(time).toLocaleDateString('zh-CN',{month:'short',day:'numeric'});}
function basename(cwd?:string){return cwd?.split(/[\\/]/).filter(Boolean).at(-1)??'默认工作区';}

export default function App(){
  const [client]=useState(()=>new HarnessConnection());
  const [profile,setProfile]=useState(loadProfile);
  const [state,setState]=useState<ConnectionState>('disconnected');
  const [connectionError,setConnectionError]=useState('');
  const [sessions,setSessions]=useState<Session[]>([]);
  const [selected,setSelected]=useState('');
  const [journal,setJournal]=useState<JournalState>(emptyJournal);
  const [draft,setDraft]=useState('');
  const [pending,setPending]=useState<{id:string;text:string;accepted:boolean}|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const [busy,setBusy]=useState(false);
  const [drawer,setDrawer]=useState(false);
  const [settings,setSettings]=useState(false);
  const [view,setView]=useState<'chat'|'activity'>('chat');
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [catalog,setCatalog]=useState<ModelCatalog>({groups:[]});
  const [modelProjection,setModelProjection]=useState<ModelProjection|null>(null);
  const [selectingModel,setSelectingModel]=useState(false);
  const selectionOperation=useRef(0);
  const [approvals,setApprovals]=useState<Approval[]>([]);
  const [resolving,setResolving]=useState('');
  const [theme,setTheme]=useState(()=>localStorage.getItem('dsh.theme')??'light');
  const [workspaces,setWorkspaces]=useState<Workspace[]>([]);
  const [workspaceKey,setWorkspaceKey]=useState('');
  const [workspacePicker,setWorkspacePicker]=useState(false);
  const [addingWorkspace,setAddingWorkspace]=useState(false);
  const [toast,setToast]=useState('');
  const [older,setOlder]=useState(false);
  const clientId=useRef('');const selectedRef=useRef('');selectedRef.current=selected;
  const transcript=useRef<HTMLDivElement>(null);const followScroll=useRef(true);const composer=useRef<HTMLTextAreaElement>(null);
  const modal=useRef<HTMLElement>(null);const workspaceModal=useRef<HTMLElement>(null);const sidebar=useRef<HTMLElement>(null);const closeOnConnect=useRef(false);
  const submission=useRef<{id:string;text:string;sessionId:string}|null>(null);
  const current=sessions.find(s=>s.sessionId===selected);
  const selection=(modelProjection??readModelProjection(current?.projections)).next??catalog.default??catalog.defaultSelection??null;
  const model=selection?selection.provider+'\u001f'+selection.model:'';
  const reasoning=reasoningFor(catalog,selection);
  const reasoningEffort=selection?.reasoningEffort??reasoning?.defaultEffort??'';
  const rows=eventRows(journal.events);
  const online=state==='connected';
  const running=current?.running??false;
  const options=workspaceOptions(workspaces,sessions);
  const activeWorkspace=options.find(w=>w.key===workspaceKey);
  const currentWorkspace=current?options.find(w=>w.path===current.cwd):activeWorkspace;
  const createRequest=activeWorkspace?.workspaceId?{workspaceId:activeWorkspace.workspaceId}:activeWorkspace?{cwd:activeWorkspace.path}:{};

  async function refresh(){try{const result=await client.call<{items:Session[]}>('session/list');setSessions(result.items.map(s=>({...s,title:s.title??(typeof s.projections?.values.title==='string'?s.projections.values.title:undefined)})));}catch(e){setError((e as Error).message);}}
  useEffect(()=>{
    client.onState=(s,message)=>{setState(s);setConnectionError(message??'');if(s==='connected'&&closeOnConnect.current){closeOnConnect.current=false;setSettings(false);setToast('已连接');}if(s!=='connected'){clientId.current='';setApprovals([]);}};
    const initial=loadProfile();if(initial.deviceId&&initial.token)client.connect(initial);
    return()=>{client.onState=undefined;client.disconnect();};
  },[client]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('dsh.theme',theme);},[theme]);
  useEffect(()=>{setWorkspaceKey(localStorage.getItem('dsh.workspace.'+profile.deviceId)??'');},[profile.deviceId]);
  useEffect(()=>{
    if(!location.hash.startsWith('#pair='))return;
    const text=location.href;history.replaceState(null,'',location.pathname+location.search);
    void (async()=>{try{activateConnection(await redeemPairing(parsePairingLink(text)));}catch(e){setConnectionError((e as Error).message);setSettings(true);}})();
  },[]);
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
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDrawer(false);setSettings(false);setWorkspacePicker(false);}};
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[]);
  useEffect(()=>{
    const container=settings?modal.current:workspacePicker?workspaceModal.current:drawer?sidebar.current:null;
    if(!container)return;
    const previous=document.activeElement as HTMLElement|null;
    const focusables=()=>Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]')).filter(el=>el.offsetParent!==null);
    focusables()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const nodes=focusables();const first=nodes[0];const last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus();};
  },[settings,drawer,workspacePicker]);

  function activateConnection(next:ConnectionProfile){
    setError('');setConnectionError('');closeOnConnect.current=true;
    if(next.deviceId!==profile.deviceId){setSessions([]);setWorkspaces([]);setSelected('');}
    setProfile(next);
    localStorage.setItem('dsh.connection',JSON.stringify({url:next.url,deviceId:next.deviceId,mode:next.mode}));
    sessionStorage.setItem('dsh.token',next.token);client.connect(next);
  }
  function disconnect(){client.disconnect();sessionStorage.removeItem('dsh.token');setProfile(p=>({...p,token:''}));setSessions([]);setWorkspaces([]);setSelected('');}
  function openWorkspaces(){if(!online){setSettings(true);return;}setWorkspacePicker(true);}
  function chooseWorkspace(key:string){setWorkspaceKey(key);localStorage.setItem('dsh.workspace.'+profile.deviceId,key);const option=options.find(w=>w.key===key);if(current&&!sessionInWorkspace(current,option))setSelected('');setWorkspacePicker(false);}
  async function addWorkspace(path:string){
    setAddingWorkspace(true);
    try{const result=await client.call<{workspace:Workspace}>('workspace/create',{path});setWorkspaces(items=>[...items.filter(w=>w.workspaceId!==result.workspace.workspaceId),result.workspace]);setWorkspaceKey(result.workspace.workspaceId);localStorage.setItem('dsh.workspace.'+profile.deviceId,result.workspace.workspaceId);setSelected('');setWorkspacePicker(false);}
    finally{setAddingWorkspace(false);}
  }
  async function createSession(){
    if(!online){setSettings(true);return;}
    setBusy(true);setError('');setDraft('');
    try{const intended=!selected?modelProjection?.next:null;const result=await client.call('session/create',createRequest);setSessions(items=>[{sessionId:result.sessionId,title:'新会话',cwd:activeWorkspace?.path,updatedAt:Date.now(),running:false,blank:true},...items.filter(s=>s.sessionId!==result.sessionId)]);setSelected(result.sessionId);setDrawer(false);setView('chat');if(intended){const choice=await client.call<{selected:ModelSelection}>('session/selectModel',{sessionId:result.sessionId,...intended});setCatalog(previous=>({...previous,default:choice.selected}));}void refresh();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function submit(event:FormEvent){
    event.preventDefault();if(!draft.trim()||submitting||selectingModel)return;if(!online){setSettings(true);return;}
    setSubmitting(true);setError('');
    const text=draft.trim();const previous=submission.current;
    const requestId=previous?.text===text&&previous.sessionId===selected?previous.id:crypto.randomUUID();
    try{
      let sessionId=selected;
      if(!sessionId){const intended=modelProjection?.next;const result=await client.call('session/create',createRequest);sessionId=result.sessionId;setSelected(sessionId);if(intended){const choice=await client.call<{selected:ModelSelection}>('session/selectModel',{sessionId,...intended});setCatalog(previous=>({...previous,default:choice.selected}));}void refresh();}
      submission.current={id:requestId,text,sessionId};setPending({id:requestId,text,accepted:false});followScroll.current=true;
      await client.call('session/prompt',{sessionId,requestId,content:[{type:'text',text}],mode:running?'steer':'queue',clientTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
      setPending(p=>p?.id===requestId?{...p,accepted:true}:p);submission.current=null;setDraft('');void refresh();
    }catch(e){setError((e as Error).message);}finally{setSubmitting(false);}
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
      <button className="new-session" onClick={()=>void createSession()} disabled={busy}><Plus size={18}/>新建会话</button>
      <label className="search-box"><Search size={16}/><input aria-label="搜索会话" placeholder="搜索会话" value={search} onChange={e=>setSearch(e.target.value)}/><span className="shortcut">⌕</span></label>
      <div className="section-heading">工作区<span>{options.length||'—'}</span></div>
      <button className="workspace-row" aria-label="选择工作区" onClick={openWorkspaces}><Folder size={17}/><span>{activeWorkspace?.title??'所有工作区'}</span><ChevronDown size={15}/></button>
      <div className="section-heading history-heading">最近会话<History size={13}/></div>
      <nav className="session-list">
        {visible.map(session=><button className={'session-row '+(selected===session.sessionId?'selected':'')} key={session.sessionId} onClick={()=>{setSelected(session.sessionId);setDrawer(false);setView('chat');}}>
          <span className={'session-indicator '+(session.running?'is-running':'')}><MessageSquare size={16}/></span><span className="session-copy"><span>{session.title||'新会话'}</span><small>{basename(session.cwd)}<i/> {timeLabel(session.updatedAt)}</small></span>{session.running&&<span className="running-dot" aria-label="正在运行"/>}
        </button>)}
        {!visible.length&&<div className="sidebar-empty">{online?'还没有会话，开始一项新工作。':'连接 DSH 后，你的会话会出现在这里。'}</div>}
      </nav>
      <div className="sidebar-bottom"><button className="device-row" onClick={()=>setSettings(true)}><span className="device-icon"><Laptop size={18}/></span><span><strong>{online?client.name:'连接你的 DSH'}</strong><small><span className={'status-dot '+(online?'online':'')}/>{online?profile.mode==='lan'?'局域网连接':'公网连接':'手机与电脑，保持同步'}</small></span><Settings2 size={17}/></button><div className="sidebar-footnote"><span>DSH Companion</span><span>v{metadata.version}</span></div></div>
    </aside>
    <main className="main-pane" inert={settings||workspacePicker||drawer}>
      <header className="topbar"><div className="topbar-title"><IconButton className="mobile-only" label="打开会话列表" onClick={()=>setDrawer(true)}><Menu size={21}/></IconButton><span className="desktop-only breadcrumb">工作台<ChevronRight size={14}/></span><span>{current?.title||'新会话'}</span>{running&&<span className="pill running"><span className="running-dot"/>进行中</span>}</div><div className="topbar-actions"><button className={'connection-pill '+(online?'is-online':'')} onClick={()=>setSettings(true)}><span className={'status-dot '+(online?'online':'')}/><span>{statusText[state]}</span></button><IconButton label={theme==='light'?'切换深色外观':'切换浅色外观'} onClick={()=>setTheme(theme==='light'?'dark':'light')}><Settings2 size={18}/></IconButton></div></header>
      <div className="view-tabs"><button className={view==='chat'?'active':''} onClick={()=>setView('chat')}><MessageSquare size={15}/>对话</button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}><Terminal size={15}/>执行记录{tools.length>0&&<span className="tab-count">{tools.length}</span>}</button><span className="tabs-spacer"/><span className="desktop-only remote-label"><Radio size={13}/>远程工作台</span></div>
      {(state==='reconnecting'||state==='error')&&<div className="connection-banner" role="status"><Wifi size={16}/><span>{connectionError||statusText[state]}</span><button onClick={()=>client.reconnect()}>重连</button></div>}
      <div className="conversation" ref={transcript} onScroll={()=>{const el=transcript.current;if(el)followScroll.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
        {view==='chat'&&rows.length===0&&!journal.live&&!pending?<div className="welcome welcome-minimal">
          <Logo/>
          {!online&&<button className="connect-prompt" onClick={()=>setSettings(true)}><Link2 size={15}/>连接 DSH</button>}
        </div>:view==='chat'?<div className="message-list">
          {journal.hasMore&&<button className="load-older" disabled={older} onClick={()=>void loadOlder()}>{older?<LoaderCircle className="spin" size={15}/>:<History size={15}/>}查看更早的消息</button>}
          {rows.map(row=><Message key={row.id} row={row} onCopy={text=>void navigator.clipboard.writeText(text).then(()=>setToast('已复制')).catch(()=>setError('无法访问剪贴板'))}/>)}
          {pending&&!journal.events.some(e=>(e.data.source as any)?.rpcId===pending.id)&&<Message row={{id:pending.id,kind:'user',text:pending.text,label:pending.accepted?'已受理':'发送中',pending:true}}/>}
          {journal.live&&<Message row={{id:'live',kind:'assistant',text:journal.live,pending:true}}/>}
          {running&&!journal.live&&<div className="working-indicator" role="status"><LoaderCircle className="spin" size={16}/>DSH 正在处理任务…</div>}
        </div>:<div className="activity-list"><div className="activity-heading"><h1>执行记录</h1></div>{tools.length?tools.map(row=><Message key={row.id} row={row}/>):<div className="activity-empty"><Terminal size={30}/><strong>暂无执行记录</strong></div>}</div>}
      </div>
      <div className="composer-region">
        {approvals.map(approval=><div className="approval-card" key={approval.eventId} role="region" aria-label="操作审批"><div><ShieldCheck size={19}/><strong>DSH 需要你的确认</strong><span>{approval.tool}</span></div><p>{approval.reason}</p><div className="approval-actions"><button onClick={()=>{if(approval.sessionId)setSelected(approval.sessionId!);setView('chat');}}>查看会话</button><button disabled={!!resolving||!online} onClick={()=>void decide(approval,false)}>拒绝</button><button className="primary-button" disabled={!!resolving||!online} onClick={()=>void decide(approval,true)}>允许这一次</button></div></div>)}
        {error&&<div className="error-message" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={()=>setError('')}><X size={16}/></IconButton></div>}
        <form className="composer" onSubmit={submit}>
          <textarea ref={composer} aria-label="发送给 DSH 的消息" placeholder={running?'补充说明，调整任务方向…':'给 DSH 一个任务，或接着聊…'} value={draft} onChange={e=>setDraft(e.target.value)} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&window.matchMedia('(min-width: 768px)').matches){e.preventDefault();void submit(e);}}}/>
          <div className="composer-toolbar"><div className="composer-context"><button type="button" className="context-button" aria-label="选择会话工作区" onClick={openWorkspaces}><Folder size={15}/><span>{currentWorkspace?.title??'工作区'}</span><ChevronDown size={12}/></button><span className="toolbar-divider"/><label className="model-select"><span className="model-dot"/><select aria-label="选择模型" value={model} disabled={!online||selectingModel||!catalog.groups.length} onChange={e=>changeModel(e.target.value)}><option value="">会话默认模型</option>{catalog.groups.map(group=><optgroup key={group.id} label={group.label??group.name??group.id}>{group.models.map(m=><option key={m.id} value={group.id+'\u001f'+m.id}>{m.label??m.name??m.id}</option>)}</optgroup>)}</select><ChevronDown size={12}/></label>{reasoning?.efforts.length? <label className="model-select effort-select" title="推理强度"><select aria-label="推理强度" value={reasoningEffort} disabled={!online||selectingModel} onChange={e=>changeEffort(e.target.value)}>{!reasoningEffort&&<option value="">默认强度</option>}{reasoning.efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select><ChevronDown size={12}/></label>:null}</div><div className="composer-send">{running&&<IconButton label="停止任务" className="stop-button" onClick={()=>void stop()} disabled={!online}><Square size={15} fill="currentColor"/></IconButton>}<button className="send-button" type="submit" aria-label="发送消息" disabled={!draft.trim()||submitting||selectingModel}>{submitting?<LoaderCircle size={19} className="spin"/>:<ArrowUp size={20}/>}</button></div></div>
        </form>
      </div>
      <nav className="mobile-nav" aria-label="主要导航"><button className={view==='chat'?'active':''} onClick={()=>setView('chat')}><MessageSquare size={20}/><span>对话</span></button><button className={view==='activity'?'active':''} onClick={()=>setView('activity')}><Terminal size={20}/><span>执行</span></button><button onClick={()=>setDrawer(true)}><History size={20}/><span>会话</span></button><button onClick={()=>setSettings(true)}><Laptop size={20}/><span>连接</span></button></nav>
    </main>
    {settings&&<div className="modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false);}}><section ref={modal} className="settings-sheet connection-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title"><ConnectionSheet profile={profile} state={state} name={client.name} error={connectionError} onConnect={activateConnection} onDisconnect={disconnect} onClose={()=>setSettings(false)}/></section></div>}
    {workspacePicker&&<div className="modal-layer" onMouseDown={e=>{if(e.target===e.currentTarget)setWorkspacePicker(false);}}><section ref={workspaceModal} className="settings-sheet workspace-sheet" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><WorkspaceSheet options={options} selected={workspaceKey} onChoose={chooseWorkspace} onClose={()=>setWorkspacePicker(false)} onAdd={addWorkspace} busy={addingWorkspace}/></section></div>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}

function Message({row,onCopy}:{row:MessageRow;onCopy?:(text:string)=>void}){
  if(row.kind==='tool')return <details className="tool-card"><summary><span className="tool-icon"><Terminal size={15}/></span><strong>{row.text}</strong><span className={'tool-status '+(row.pending?'pending':'')}>{row.pending?<LoaderCircle size={12} className="spin"/>:<Check size={12}/>} {row.label}</span><ChevronDown size={14}/></summary><pre>{row.detail||'此工具没有返回文本输出。'}</pre></details>;
  if(row.kind==='error')return <div className="error-message" role="alert">{row.text}</div>;
  return <article className={'message message-'+row.kind}><div className="message-header">{row.kind==='assistant'?<><span className="assistant-avatar"><Command size={14}/></span><strong>DSH</strong><span className="message-role">HARNESS</span></>:<><span className="user-avatar">你</span><strong>你</strong></>}{row.pending&&<small>{row.kind==='assistant'?'正在生成':row.label}</small>}</div><div className="message-content"><Markdown remarkPlugins={[remarkGfm]}>{row.text}</Markdown></div>{row.kind==='assistant'&&!row.pending&&onCopy&&<div className="message-actions"><IconButton label="复制回复" onClick={()=>onCopy(row.text)}><Copy size={15}/></IconButton></div>}</article>;
}
