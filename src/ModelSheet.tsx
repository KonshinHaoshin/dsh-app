import {ChevronDown,X} from 'lucide-react';
import type {ModelCatalog,ModelSelection} from './types';
import {reasoningFor,modelChoice} from './modelSelection';
export default function ModelSheet({catalog,selection,busy,online,error,onChoose,onClose}:{catalog:ModelCatalog;selection:ModelSelection|null;busy:boolean;online:boolean;error:string;onChoose:(selection:ModelSelection)=>void;onClose:()=>void}){
 const reasoning=reasoningFor(catalog,selection);const effort=selection?.reasoningEffort??reasoning?.defaultEffort??'';
 return <><div className="sheet-top"><h2 id="model-title">模型与推理</h2><button type="button" className="icon-button" aria-label="关闭模型设置" onClick={onClose}><X size={20}/></button></div>
 <div className="model-settings"><label htmlFor="model-choice">模型</label><div className="model-field"><select id="model-choice" aria-label="选择模型" disabled={!online||busy||!catalog.groups.length} value={selection?selection.provider+'\u001f'+selection.model:''} onChange={e=>{const[p,m]=e.target.value.split('\u001f');if(p&&m)onChoose(modelChoice(catalog,p,m,selection));}}><option value="">会话默认模型</option>{catalog.groups.map(g=><optgroup key={g.id} label={g.label??g.name??g.id}>{g.models.map(m=><option key={m.id} value={g.id+'\u001f'+m.id}>{m.label??m.name??m.id}</option>)}</optgroup>)}</select><ChevronDown size={16}/></div>
 <label htmlFor="effort-choice">推理强度</label><div className="model-field"><select id="effort-choice" aria-label="推理强度" disabled={!online||busy||!reasoning?.efforts.length} value={effort} onChange={e=>{if(selection)onChoose({...selection,reasoningEffort:e.target.value});}}>{!reasoning?.efforts.length?<option value="">当前模型未提供强度选项</option>:<>{!effort&&<option value="">默认强度</option>}{reasoning.efforts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</>}</select><ChevronDown size={16}/></div>
 <p className="field-hint">{reasoning?.efforts.length?'更改用于下一次生成，当前任务继续执行。':'可切换到提供推理档位的模型；可用选项由电脑端 DSH 返回。'}</p>{error&&<p className="error-message" role="alert">{error}</p>}{busy&&<p role="status">正在保存…</p>}
 </div></>;
}
