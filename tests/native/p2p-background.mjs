// Isolated emulator + the live relay. Synthetic DSH adapter; no models or tools.
import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';import{randomBytes,randomUUID,createHash}from'node:crypto';import{once}from'node:events';
import{chromium}from'@playwright/test';import assert from'node:assert/strict';
import WebSocket from'../../../dsh-app-plugin/node_modules/ws/wrapper.mjs';
import{RTCPeerConnection}from'../../../dsh-app-plugin/node_modules/werift/lib/index.mjs';
import{createHybridHost}from'../../../dsh-app-plugin/hybrid-host.mjs';
const serial=process.env.DSH_QA_SERIAL??'emulator-5580';if(!serial.startsWith('emulator-'))throw Error('Dedicated emulator only');
const adb=process.env.ADB??'/Users/ifan/Library/Android/sdk/platform-tools/adb',shell=(...a)=>execFileSync(adb,['-s',serial,...a],{encoding:'utf8',timeout:20000});
const wait=async(fn,label,timeout=30000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await fn())return;await new Promise(r=>setTimeout(r,250));}throw Error(label+' timed out')};
if(!process.env.DSH_QA_RELAY_SECRET_FILE)throw Error('Set DSH_QA_RELAY_SECRET_FILE to an explicitly authorized test credential file');
const secret=readFileSync(process.env.DSH_QA_RELAY_SECRET_FILE,'utf8').trim();
const token=randomBytes(32).toString('base64url'),deviceId='qa-p2p-'+randomUUID(),key='native-p2p-qa',answers=[],pcs=[],streams=new Set();let registered=false,owned=false,browser,page,debuggerSession,idle=false;
const adapter={createClient(){return{async call(endpoint,params){if(endpoint==='$events/result')answers.push(params);return endpoint==='session/list'?{items:[]} : endpoint==='session/modelCatalog'?{groups:[]} : {};},async *stream(endpoint,params,signal){
 if(endpoint==='$events'){const q=[],s={push:f=>{q.push(f);wake?.();}},clientId=randomUUID();let wake;streams.add(s);try{yield{type:'ready',clientId};while(!signal.aborted){if(q.length)yield q.shift();else await new Promise(r=>{wake=r;signal.addEventListener('abort',r,{once:true});});}}finally{streams.delete(s);}}
 else{yield endpoint==='workspace/follow'?{type:'baseline',value:{items:[]}}:{type:'snapshot',records:[],cursor:-1,hasMore:false};await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}
 }}}};
const relay=new WebSocket('wss://dshapi.shelterhub.moe/connect');const hybrid=createHybridHost(adapter,{token,iceServers:[{urls:'stun:38.76.193.106:3478'},{urls:'stun:stun.cloudflare.com:3478'}]},(clientId,body)=>{if(relay.readyState!==1)return false;relay.send(JSON.stringify({type:'forward',clientId,body}));return true;},async options=>{const pc=new RTCPeerConnection(options);pcs.push(pc);return pc;});
relay.on('message',raw=>{const f=JSON.parse(raw);if(f.type==='registered')registered=true;else if(f.type==='forward')hybrid.receive(f.clientId,f.body);else if(f.type==='leave')hybrid.leave(f.clientId);});relay.on('error',()=>{});
const native=(plugin,method,options={})=>page.evaluate(({plugin,method,options})=>window.Capacitor.nativePromise(plugin,method,options),{plugin,method,options});
const noticeId=text=>5000+([...text].reduce((h,c)=>(Math.imul(h,31)+c.charCodeAt(0))|0,0)&0x3fffffff);
const emit=value=>{for(const s of streams)s.push(value)};
try{
 await once(relay,'open');relay.send(JSON.stringify({type:'host',deviceId,hostSecret:secret,tokenDigest:createHash('sha256').update(token).digest('hex'),features:['p2p-v1'],name:'P2P 后台测试电脑'}));await wait(()=>registered,'live host registration');
 shell('shell','pm','grant','moe.shelterhub.dsh','android.permission.POST_NOTIFICATIONS');shell('shell','dumpsys','deviceidle','whitelist','+moe.shelterhub.dsh');shell('shell','input','keyevent','224');shell('shell','wm','dismiss-keyguard');shell('shell','am','start','-W','-n','moe.shelterhub.dsh/.MainActivity');
 const pid=shell('shell','pidof','moe.shelterhub.dsh').trim();shell('forward','tcp:19227',`localabstract:webview_devtools_remote_${pid}`);await wait(async()=>{try{return(await fetch('http://127.0.0.1:19227/json')).ok}catch{return false}},'WebView');
 browser=await chromium.connectOverCDP('http://127.0.0.1:19227');page=browser.contexts()[0].pages().find(p=>p.url().startsWith('https://localhost'));await page.waitForLoadState('domcontentloaded');
 const registry=(await native('DeviceCredentials','getRegistry')).value;if(registry&&JSON.parse(registry).length)throw Error('Refusing a populated emulator');owned=true;
 await native('DeviceCredentials','set',{key,value:token});await native('DeviceCredentials','setRegistry',{value:JSON.stringify([{key,url:'https://dshapi.shelterhub.moe',deviceId,mode:'public',enabled:true,name:'P2P 后台测试电脑'}])});await page.reload();await page.waitForLoadState('domcontentloaded');
 await native('Companion','enable');
 await wait(async()=>{const s=await native('Companion','getState');return s.hosts.some(h=>h.key===key&&h.online&&h.transport==='p2p')},'native real P2P path',45000);console.log('Native WebRTC connected through live authenticated signaling/STUN PASS');
 shell('shell','input','keyevent','3');shell('shell','input','keyevent','223');await wait(async()=>!(await native('Companion','getState')).foreground,'background Activity');shell('shell','dumpsys','battery','unplug');shell('shell','dumpsys','deviceidle','force-idle');idle=true;
 debuggerSession=await page.context().newCDPSession(page);await debuggerSession.send('Debugger.enable');await debuggerSession.send('Debugger.pause');
 emit({type:'emit',event:'api-session/status',args:['p2p-task',true]});emit({type:'emit',event:'api-session/status',args:['p2p-task',false]});await wait(()=>shell('shell','dumpsys','notification','--noredact').includes('DSH 任务已结束'),'P2P locked completion notice');
 emit({type:'waterfall',event:'approval/request',eventId:'p2p-approval',agentId:'p2p-task',request:{tool:'qa-tool',displayReason:'仅测试通知，不执行命令'}});await wait(()=>shell('shell','dumpsys','notification','--noredact').includes('DSH 需要你的审批'),'P2P locked approval notice');assert.equal(answers.length,0);console.log('Native P2P task/approval notifications in Doze with WebView JavaScript paused PASS');
 const owners=streams.size;await Promise.all(pcs.map(pc=>pc.close()));await wait(()=>hybrid.status().direct===0,'direct path closed');emit({type:'emit',event:'api-session/status',args:['fallback-task',true]});emit({type:'emit',event:'api-session/status',args:['fallback-task',false]});await wait(()=>shell('shell','dumpsys','notification','--noredact').includes('id='+noticeId(key+'fallback-task')),'locked fallback notification');assert.equal(streams.size,owners);assert.equal(answers.length,0);console.log('Locked P2P loss resumes WSS notifications without replacing approval owners PASS');
 await debuggerSession.send('Debugger.resume');shell('shell','dumpsys','deviceidle','unforce');shell('shell','dumpsys','battery','reset');idle=false;shell('shell','input','keyevent','224');shell('shell','wm','dismiss-keyguard');shell('shell','am','start','-n','moe.shelterhub.dsh/.MainActivity','--es','deviceKey',key,'--es','sessionId','p2p-task','--es','noticeKind','approval');
 await wait(async()=>{const s=await native('Companion','getState');return s.hosts.some(h=>h.key===key&&h.transport==='relay')&&s.approvals.some(a=>a.eventId==='p2p-approval')},'preserved pending approval after fallback');
 await page.getByRole('button',{name:'允许这一次',exact:true}).click();await wait(()=>answers.some(a=>a.eventId==='p2p-approval'),'manual approval round trip');assert.equal(answers.filter(a=>a.eventId==='p2p-approval').length,1);console.log('Pending approval survives native P2P fallback and is answered exactly once PASS');
}finally{
 if(debuggerSession)try{await debuggerSession.send('Debugger.resume')}catch{}
 if(idle){shell('shell','dumpsys','deviceidle','unforce');shell('shell','dumpsys','battery','reset');}
 if(page&&owned)try{await native('Companion','disable');const saved=(await native('DeviceCredentials','getRegistry')).value;await native('DeviceCredentials','setRegistry',{value:JSON.stringify(JSON.parse(saved??'[]').filter(d=>d.key!==key))});await native('DeviceCredentials','remove',{key});await page.reload();}catch{}
 if(browser)await browser.close();try{shell('forward','--remove','tcp:19227')}catch{}hybrid.close();relay.terminate();
}
