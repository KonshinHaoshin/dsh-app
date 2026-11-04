import type{Session,Workspace,WorkspaceOption}from'./types';
export function workspaceOptions(workspaces:Workspace[],sessions:Session[]):WorkspaceOption[]{
  const byPath=new Map<string,WorkspaceOption>();
  for(const w of workspaces)byPath.set(w.path,{key:w.workspaceId,workspaceId:w.workspaceId,path:w.path,title:w.title||basename(w.path),sessionIds:[...w.sessionIds],registered:true});
  for(const s of sessions){if(!s.cwd)continue;let option=byPath.get(s.cwd);if(!option){option={key:'path:'+s.cwd,path:s.cwd,title:basename(s.cwd),sessionIds:[],registered:false};byPath.set(s.cwd,option);}if(!option.sessionIds.includes(s.sessionId))option.sessionIds.push(s.sessionId);}
  return [...byPath.values()];
}
export function basename(path:string){return path.split(/[\\/]/).filter(Boolean).at(-1)||path;}
export function sessionInWorkspace(session:Session,option?:WorkspaceOption){return !option||session.cwd===option.path||option.sessionIds.includes(session.sessionId);}
