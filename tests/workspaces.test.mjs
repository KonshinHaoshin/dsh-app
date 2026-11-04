import test from'node:test';import assert from'node:assert/strict';import{workspaceOptions,sessionInWorkspace}from'../src/workspaces.ts';
test('workspace picker retains full path identity and registered IDs without mutating source state',()=>{
 const registered=[{workspaceId:'one',title:'项目',path:'/a/project',sessionIds:['s1']}];const sessions=[{sessionId:'s1',cwd:'/a/project'},{sessionId:'s2',cwd:'/a/project'},{sessionId:'s3',cwd:'/b/project'}];
 const options=workspaceOptions(registered,sessions);assert.equal(options.length,2);assert.equal(options[0].workspaceId,'one');assert.deepEqual(options[0].sessionIds,['s1','s2']);assert.deepEqual(registered[0].sessionIds,['s1']);assert.notEqual(options[0].key,options[1].key);
 assert.equal(sessionInWorkspace(sessions[2],options[0]),false);assert.equal(sessionInWorkspace(sessions[2],options[1]),true);assert.equal(sessionInWorkspace(sessions[2]),true);
});
