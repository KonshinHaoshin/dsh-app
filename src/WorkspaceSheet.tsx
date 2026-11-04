import{useState}from'react';import{Check,Folder,Plus,Search,X}from'lucide-react';
import type{WorkspaceOption}from'./types';
export default function WorkspaceSheet({options,selected,onChoose,onClose,onAdd,busy}:{options:WorkspaceOption[];selected:string;onChoose:(key:string)=>void;onClose:()=>void;onAdd:(path:string)=>Promise<void>;busy:boolean}){
  const[query,setQuery]=useState('');const[adding,setAdding]=useState(false);const[path,setPath]=useState('');const[error,setError]=useState('');
  const visible=options.filter(w=>(w.title+' '+w.path).toLowerCase().includes(query.toLowerCase()));
  return <><div className="sheet-top"><h2 id="workspace-title">工作区</h2><button className="icon-button" aria-label="关闭工作区选择" onClick={onClose}><X size={20}/></button></div>
    <label className="workspace-search"><Search size={17}/><input aria-label="搜索工作区" placeholder="搜索名称或路径" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="workspace-options" role="listbox" aria-label="工作区列表"><button className={'workspace-option '+(!selected?'chosen':'')} role="option" aria-selected={!selected} onClick={()=>onChoose('')}><Folder size={20}/><span><strong>所有工作区</strong><small>新会话使用默认目录</small></span>{!selected&&<Check size={18}/>}</button>
      {visible.map(w=><button key={w.key} className={'workspace-option '+(selected===w.key?'chosen':'')} role="option" aria-selected={selected===w.key} onClick={()=>onChoose(w.key)}><Folder size={20}/><span><strong>{w.title}</strong><small>{w.path}</small></span><span className="workspace-count">{w.sessionIds.length}</span>{selected===w.key&&<Check size={18}/>}</button>)}
      {!visible.length&&<p className="workspace-no-results">没有找到工作区</p>}
    </div>
    <button className="add-workspace" onClick={()=>setAdding(!adding)}><Plus size={17}/>添加工作区</button>
    {adding&&<form className="connection-form compact-form" onSubmit={async e=>{e.preventDefault();setError('');try{await onAdd(path.trim());}catch(e){setError((e as Error).message);}}}><label htmlFor="workspace-path">电脑上的目录</label><input id="workspace-path" value={path} onChange={e=>setPath(e.target.value)} placeholder="输入完整目录路径" required autoCapitalize="none" spellCheck={false}/>{error&&<p className="form-status" role="alert">{error}</p>}<button type="submit" className="primary-button connect-submit" disabled={busy||!path.trim()}>{busy?'正在添加…':'添加'}</button></form>}
  </>;
}
