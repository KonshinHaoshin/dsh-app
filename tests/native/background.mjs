// Run only against a dedicated, empty emulator. Never clears an existing registry.
import {execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
import {WebSocketServer} from 'ws';
import assert from 'node:assert/strict';
const serial=process.env.DSH_QA_SERIAL??'emulator-5580';
if(!serial.startsWith('emulator-'))throw Error('Native QA requires an isolated emulator');
const adb=process.env.ADB??'/Users/ifan/Library/Android/sdk/platform-tools/adb';
function shell(...args){return execFileSync(adb,['-s',serial,...args],{encoding:'utf8',timeout:20000});}
const wait=async(fn,label,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,250));}throw Error(label+' timed out');};
const port=19786,server=new WebSocketServer({host:'127.0.0.1',port});
const token='test-only-native-companion-token-000001',key='native-background-qa';let nativeSocket,connections=0;const answers=[];
server.on('connection',ws=>ws.on('message',raw=>{
 const f=JSON.parse(raw);const send=(type,value)=>ws.send(JSON.stringify({type,id:f.id,value}));
 if(f.type==='hello'){assert.equal(f.token,token);ws.send(JSON.stringify({type:'ready',protocol:1,name:'原生测试电脑'}));}
 if(f.type==='ping')ws.send(JSON.stringify({type:'pong'}));
 if(f.type==='call'){
  if(f.endpoint==='session/list')send('result',{items:[{sessionId:'qa-task',title:'后台任务测试',running:false,updatedAt:Date.now()}]});
  else if(f.endpoint==='session/modelCatalog')send('result',{groups:[]});
  else if(f.endpoint==='$events/result'){answers.push(f.params);send('result',{});}
  else send('result',{});
 }
 if(f.type==='open'){
  if(f.endpoint==='$events'){send('item',{type:'ready',clientId:'qa-client-'+connections});if(f.id==='events'){nativeSocket=ws;connections++;}}
  else if(f.endpoint==='workspace/follow')send('item',{type:'baseline',value:{items:[]}});
  else if(f.endpoint==='session/follow')send('item',{type:'snapshot',cursor:-1,records:[],hasMore:false});
 }
}));
let browser,page,debuggerSession;let idleForced=false,ownsRegistry=false;
const native=(plugin,method,options={})=>page.evaluate(({plugin,method,options})=>window.Capacitor.nativePromise(plugin,method,options),{plugin,method,options});
try{
 shell('reverse',`tcp:${port}`,`tcp:${port}`);
 shell('shell','pm','grant','moe.shelterhub.dsh','android.permission.POST_NOTIFICATIONS');
 shell('shell','dumpsys','deviceidle','whitelist','+moe.shelterhub.dsh');
 shell('shell','input','keyevent','224');shell('shell','wm','dismiss-keyguard');
 shell('shell','am','start','-W','-n','moe.shelterhub.dsh/.MainActivity');
 let pid='';await wait(()=>{try{pid=shell('shell','pidof','moe.shelterhub.dsh').trim();return !!pid;}catch{return false;}},'App startup');
 shell('forward','tcp:19227',`localabstract:webview_devtools_remote_${pid}`);
 await wait(async()=>{try{return(await fetch('http://127.0.0.1:19227/json')).ok;}catch{return false;}},'WebView debugging');
 browser=await chromium.connectOverCDP('http://127.0.0.1:19227');page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'))??browser.contexts()[0].pages()[0];
 await page.waitForLoadState('domcontentloaded');
 const saved=(await native('DeviceCredentials','getRegistry')).value;if(saved&&JSON.parse(saved).length)throw Error('Refusing to replace an existing emulator registry');
 ownsRegistry=true;await native('DeviceCredentials','set',{key,value:token});
 await native('DeviceCredentials','setRegistry',{value:JSON.stringify([{key,url:`http://127.0.0.1:${port}`,deviceId:'qa-native-host',mode:'lan',enabled:true,name:'原生测试电脑'}])});
 await page.evaluate(key=>localStorage.removeItem('dsh.session.'+key),key);await page.reload();await page.waitForLoadState('domcontentloaded');
 await wait(async()=>{try{return await page.locator('.connection-pill').textContent()==='已连接';}catch{return false;}},'foreground connection');
 await native('Companion','enable');await wait(()=>nativeSocket?.readyState===1,'native event subscription');
 assert((await native('Companion','getState')).running);console.log('Native foreground service and independent socket PASS');
 shell('shell','input','keyevent','3');shell('shell','input','keyevent','223');await wait(async()=>!(await native('Companion','getState')).foreground,'Activity moved to background');
 shell('shell','dumpsys','battery','unplug');shell('shell','dumpsys','deviceidle','force-idle');idleForced=true;
 debuggerSession=await page.context().newCDPSession(page);await debuggerSession.send('Debugger.enable');await debuggerSession.send('Debugger.pause');
 nativeSocket.send(JSON.stringify({type:'item',id:'events',value:{type:'emit',event:'api-session/status',args:['qa-task',true]}}));
 nativeSocket.send(JSON.stringify({type:'item',id:'events',value:{type:'emit',event:'api-session/status',args:['qa-task',false]}}));
 try{await wait(()=>shell('shell','dumpsys','notification','--noredact').includes('DSH 任务已结束'),'task completion notification');}catch(e){if(debuggerSession)await debuggerSession.send('Debugger.resume');console.log('Notification diagnostic:',await native('Companion','getState'));throw e;}
 const service=shell('shell','dumpsys','activity','services','moe.shelterhub.dsh');assert(service.includes('isForeground=true'));console.log('Locked/background task completion notification and foreground lifecycle PASS');
 nativeSocket.send(JSON.stringify({type:'item',id:'events',value:{type:'waterfall',event:'approval/request',eventId:'qa-approval',agentId:'qa-task',request:{tool:'qa-tool',displayReason:'本地测试审批，不执行命令'}}}));
 await wait(()=>shell('shell','dumpsys','notification','--noredact').includes('DSH 需要你的审批'),'approval notification');
 assert.equal(answers.filter(a=>a.eventId==='qa-approval').length,0);console.log('Approval notification never approves automatically PASS');
 await debuggerSession.send('Debugger.resume');shell('shell','dumpsys','deviceidle','unforce');shell('shell','dumpsys','battery','reset');idleForced=false;
 shell('shell','input','keyevent','224');shell('shell','wm','dismiss-keyguard');
 shell('shell','am','start','-n','moe.shelterhub.dsh/.MainActivity','--es','deviceKey',key,'--es','sessionId','qa-task','--es','noticeKind','approval');
 await wait(()=>page.evaluate(key=>localStorage.getItem('dsh.session.'+key)==='qa-task',key),'notification session navigation');
 await wait(async()=>(await native('Companion','getState')).approvals.length===1,'retained pending approval');
 await page.getByRole('button',{name:'允许这一次',exact:true}).click();
 await wait(()=>answers.some(a=>a.eventId==='qa-approval'&&a.outcome.value==='allowed-once'),'explicit approval answer');
 await wait(async()=>(await native('Companion','getState')).approvals.length===0,'settled approval');console.log('Notification navigation and explicit native approval round trip PASS');
 const before=connections;nativeSocket.terminate();await wait(()=>connections>before,'native reconnect');console.log('Native socket reconnect PASS');
 await assert.rejects(native('AppUpdater','download',{url:'https://untrusted.example/app.apk',version:'99.0.0',versionCode:999,size:1,sha256:'0'.repeat(64)}));console.log('Native updater refuses an untrusted URL PASS');
}finally{
 if(debuggerSession)try{await debuggerSession.send('Debugger.resume');}catch{}
 if(idleForced)try{shell('shell','dumpsys','deviceidle','unforce');shell('shell','dumpsys','battery','reset');}catch{}
 if(page&&ownsRegistry){try{await native('Companion','disable');await native('DeviceCredentials','remove',{key});const current=(await native('DeviceCredentials','getRegistry')).value;await native('DeviceCredentials','setRegistry',{value:JSON.stringify(JSON.parse(current??'[]').filter(d=>d.key!==key))});}catch{}}
 if(browser)await browser.close();for(const ws of server.clients)ws.terminate();await new Promise(r=>server.close(r));
 try{shell('reverse','--remove',`tcp:${port}`);shell('forward','--remove','tcp:19227');}catch{}
}
