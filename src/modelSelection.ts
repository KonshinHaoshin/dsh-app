import type {ModelSelection,ModelCatalog,WireEvent} from './types.ts';
export type ModelProjection={lastUsed:ModelSelection|null;next:ModelSelection|null};
export const emptyModelProjection=():ModelProjection=>({lastUsed:null,next:null});
export function parseSelection(value:unknown):ModelSelection|null{
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  if(typeof v.provider!=='string'||!v.provider||typeof v.model!=='string'||!v.model)return null;
  return {provider:v.provider,model:v.model,...typeof v.reasoningEffort==='string'?{reasoningEffort:v.reasoningEffort}:{}};
}
export function readModelProjection(block:unknown):ModelProjection{
  const value=(block as {values?:{modelSelection?:{lastUsed?:unknown;next?:unknown}}}|undefined)?.values?.modelSelection;
  return {lastUsed:parseSelection(value?.lastUsed),next:parseSelection(value?.next)};
}
function same(a:ModelSelection|null,b:ModelSelection|null){return a===b||!!a&&!!b&&a.provider===b.provider&&a.model===b.model&&a.reasoningEffort===b.reasoningEffort;}
export function advanceModelProjection(state:ModelProjection,event:WireEvent):ModelProjection{
  if(event.type==='model/selection')return {...state,next:parseSelection(event.data)};
  if(event.type!=='request/header')return state;
  const used=parseSelection((event.data.header as {config?:unknown}|undefined)?.config);
  if(!used)return state;
  return {lastUsed:used,next:!state.next||same(state.next,state.lastUsed)||same(state.next,used)?used:state.next};
}
export function reasoningFor(catalog:ModelCatalog,selection:ModelSelection|null){return catalog.groups.find(g=>g.id===selection?.provider)?.models.find(m=>m.id===selection?.model)?.reasoning;}
export function modelChoice(catalog:ModelCatalog,provider:string,model:string,previous:ModelSelection|null):ModelSelection{
  const reasoning=reasoningFor(catalog,{provider,model});
  const effort=previous?.provider===provider&&previous.model===model&&reasoning?.efforts.some(e=>e.id===previous.reasoningEffort)?previous.reasoningEffort:reasoning?.defaultEffort;
  return {provider,model,...effort?{reasoningEffort:effort}:{}};
}
