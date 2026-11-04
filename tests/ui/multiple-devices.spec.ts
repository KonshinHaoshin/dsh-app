import {test,expect} from '@playwright/test';
import type {Page,WebSocketRoute} from '@playwright/test';

async function computer(page:Page,letter:string,holdReady=false){
  const name=`电脑 ${letter}`,origin=`https://${letter.toLowerCase()}.computer.test`,token=`test-only-${letter}-computer-pairing-token-0001`;
  const calls:any[]=[];const sockets=new Set<WebSocketRoute>();let follow:(event:any)=>void=()=>{};let events:(frame:any)=>void=()=>{};let seq=0;let delayed=false;let finishPrompt:()=>void=()=>{};let releaseReady:()=>void=()=>{};
  await page.routeWebSocket(origin.replace('https:','wss:')+'/connect',ws=>{
    ws.onClose(()=>sockets.delete(ws));
    ws.onMessage(raw=>{
      const f=JSON.parse(String(raw));const send=(type:string,value:unknown)=>ws.send(JSON.stringify({type,id:f.id,value}));
      if(f.type==='pair'){const paired=()=>ws.send(JSON.stringify({type:'paired',protocol:1,deviceId:'same-id',token,name}));if(holdReady){releaseReady();setTimeout(paired,75);}else paired();return;}
      if(f.type==='hello'){expect(f.token).toBe(token);releaseReady=()=>{sockets.add(ws);ws.send(JSON.stringify({type:'ready',protocol:1,name}));};if(!holdReady)releaseReady();return;}
      if(f.type==='call'){
        calls.push(f);
        if(f.endpoint==='session/list')send('result',{items:[{sessionId:'same-session',title:`${letter} 的会话`,cwd:`/${letter}/project`,updatedAt:Date.now(),running:false}]});
        else if(f.endpoint==='session/modelCatalog')send('result',{default:{provider:'same-provider',model:'reasoner',reasoningEffort:letter==='A'?'low':'high'},groups:[{id:'same-provider',models:[{id:'reasoner',name:`${letter} 模型`,reasoning:{defaultEffort:letter==='A'?'low':'high',efforts:[{id:'low',name:'低'},{id:'high',name:'高'}]}}]}]});
        else if(f.endpoint==='session/prompt'){if(delayed)finishPrompt=()=>send('result',{accepted:true});else send('result',{accepted:true});}
        else if(f.endpoint==='session/selectModel')send('result',{selected:{provider:f.params.provider,model:f.params.model,reasoningEffort:f.params.reasoningEffort}});
        else send('result',{});
      }
      if(f.type==='open'){
        if(f.endpoint==='workspace/follow')send('item',{type:'baseline',value:{items:[{workspaceId:'same-workspace',title:`${letter} 项目`,path:`/${letter}/project`,sessionIds:['same-session']}]}});
        if(f.endpoint==='$events'){send('item',{type:'ready',clientId:'same-client',host:{home:`/${letter}`}});events=frame=>send('item',frame);}
        if(f.endpoint==='session/follow'){
          send('item',{type:'snapshot',cursor:0,hasMore:false,records:[{type:'event',event:{seq:0,type:'assistant/message',data:{stream:[{type:'text-chunks',texts:[`${letter} 的历史回复`]}]}}}],projections:{values:{modelSelection:{next:{provider:'same-provider',model:'reasoner',reasoningEffort:letter==='A'?'low':'high'},lastUsed:null}}}});
          seq=0;follow=event=>send('item',{type:'event',event:{...event,seq:++seq}});
        }
      }
    });
  });
  const link='https://dshapi.shelterhub.moe/#pair='+Buffer.from(JSON.stringify({v:1,url:origin,mode:'public',deviceId:'same-id',name,code:`test-only-${letter}-one-time-code-00000001`,expiresAt:Date.now()+300000})).toString('base64url');
  return {name,token,link,calls,sockets,delay:()=>{delayed=true;},finish:()=>finishPrompt(),reply:(text:string)=>follow({type:'assistant/message',data:{stream:[{type:'text-chunks',texts:[text]}]}}),approval:()=>events({type:'waterfall',event:'approval/request',eventId:'same-approval',agentId:'same-session',request:{tool:`${letter} 工具`,reason:`${letter} 请求确认`}})};
}
const active=(page:Page)=>page.locator('.device-workspace:not([hidden])');
async function pair(page:Page,link:string){
  await active(page).locator('.connection-pill').click();const sheet=page.getByRole('dialog',{name:'连接',exact:true});
  await sheet.getByRole('button',{name:'使用配对链接',exact:true}).click();await sheet.getByRole('textbox',{name:'配对链接',exact:true}).fill(link);await sheet.getByRole('button',{name:'配对',exact:true}).click();await expect(sheet).toHaveCount(0);
  await expect(active(page).locator('.connection-pill')).toHaveText('已连接');
}
async function switchTo(page:Page,name:string){await active(page).locator('.connection-pill').click();await page.getByRole('dialog').getByRole('button',{name:`切换到 ${name}`,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function openSession(page:Page,letter:string){await page.getByRole('button',{name:'打开会话列表'}).click();await page.getByRole('button').filter({hasText:`${letter} 的会话`}).click();await expect(page.getByText(`${letter} 的历史回复`,{exact:true})).toBeVisible();}

test('two computers stay connected with isolated sessions, drafts, workspaces and pending requests',async({page})=>{
  const a=await computer(page,'A'),b=await computer(page,'B');await page.goto('/');
  await pair(page,a.link);await openSession(page,'A');
  await page.getByRole('button',{name:'选择会话工作区'}).click();await page.getByRole('dialog').getByRole('option').filter({hasText:'A 项目'}).click();
  a.delay();await page.getByRole('textbox',{name:'发送给 DSH 的消息'}).fill('只发给 A');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await expect.poll(()=>a.calls.filter(f=>f.endpoint==='session/prompt').length).toBe(1);
  await pair(page,b.link);await openSession(page,'B');
  await expect.poll(()=>a.sockets.size).toBe(1);await expect.poll(()=>b.sockets.size).toBe(1);
  await expect(active(page).getByLabel('推理强度',{exact:true})).toHaveValue('high');
  expect(await active(page).locator('.workspace-row').textContent()).toBe('所有工作区');
  await page.getByRole('textbox',{name:'发送给 DSH 的消息'}).fill('B 的未发送草稿');a.finish();a.reply('A 的后台回复');
  await expect(page.getByRole('textbox',{name:'发送给 DSH 的消息'})).toHaveValue('B 的未发送草稿');
  await expect(page.getByText('A 的后台回复',{exact:true})).not.toBeVisible();expect(b.calls.filter(f=>f.endpoint==='session/prompt')).toHaveLength(0);
  await switchTo(page,a.name);await expect(page.getByText('A 的后台回复',{exact:true})).toBeVisible();await expect(active(page).getByLabel('推理强度',{exact:true})).toHaveValue('low');
  expect(await active(page).locator('.workspace-row').textContent()).toBe('A 项目');
  await switchTo(page,b.name);await expect(page.getByRole('textbox',{name:'发送给 DSH 的消息'})).toHaveValue('B 的未发送草稿');
  await active(page).locator('.connection-pill').click();await page.screenshot({path:'artifacts/multiple-computers-v04.png',animations:'disabled'});
  const metadata=await page.evaluate(()=>localStorage.getItem('dsh.devices.v1'));expect(metadata).not.toContain(a.token);expect(metadata).not.toContain(b.token);
});

test('pairing an existing computer closes the sheet when its saved connection becomes ready during redemption',async({page})=>{
  const a=await computer(page,'A',true);await page.addInitScript(({token})=>{localStorage.setItem('dsh.connection',JSON.stringify({url:'https://a.computer.test',deviceId:'same-id',mode:'public'}));sessionStorage.setItem('dsh.token',token);},{token:a.token});
  await page.goto('/');await expect(active(page).locator('.connection-pill')).toHaveText('正在连接');
  await pair(page,a.link);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('dsh.devices.v1')??'[]').length)).toBe(1);expect(a.sockets.size).toBe(1);
});

test('the first computer receives an offline draft without saving message content in connection metadata',async({page})=>{
  const a=await computer(page,'A');await page.goto('/');await page.getByRole('textbox',{name:'发送给 DSH 的消息'}).fill('连接前写下的草稿');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  const sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'使用配对链接',exact:true}).click();await sheet.getByRole('textbox',{name:'配对链接',exact:true}).fill(a.link);await sheet.getByRole('button',{name:'配对',exact:true}).click();await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'发送给 DSH 的消息'})).toHaveValue('连接前写下的草稿');expect(await page.evaluate(()=>localStorage.getItem('dsh.devices.v1'))).not.toContain('连接前写下的草稿');
  await active(page).locator('.connection-pill').click();await sheet.getByRole('button',{name:'电脑 A 的连接选项'}).click();await sheet.getByRole('button',{name:'移除',exact:true}).click();await sheet.getByRole('button',{name:'移除电脑',exact:true}).click();await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox',{name:'发送给 DSH 的消息'})).toHaveValue('');
});

test('background approvals, disconnects, rename, reload and removal stay scoped to the selected computer',async({page})=>{
  const a=await computer(page,'A'),b=await computer(page,'B');await page.goto('/');await pair(page,a.link);await openSession(page,'A');await pair(page,b.link);await openSession(page,'B');
  a.approval();await expect(page.getByLabel('其他电脑有 1 项待审批')).toBeVisible();
  await active(page).locator('.connection-pill').click();const sheet=page.getByRole('dialog');await expect(sheet.getByText('待审批 1',{exact:true})).toBeVisible();await sheet.getByRole('button',{name:'切换到 电脑 A',exact:true}).click();
  await expect(page.getByRole('region',{name:'操作审批'})).toContainText('A 请求确认');await page.getByRole('button',{name:'允许这一次',exact:true}).click();
  await expect.poll(()=>a.calls.filter(f=>f.endpoint==='$events/result').length).toBe(1);expect(b.calls.filter(f=>f.endpoint==='$events/result')).toHaveLength(0);
  await active(page).locator('.connection-pill').click();await sheet.getByRole('button',{name:'电脑 A 的连接选项'}).click();await sheet.getByRole('button',{name:'重命名',exact:true}).click();await sheet.getByRole('textbox',{name:'电脑名称'}).fill('办公室');await sheet.getByRole('button',{name:'保存',exact:true}).click();
  await sheet.getByRole('button',{name:'办公室 的连接选项'}).click();await sheet.getByRole('button',{name:'断开连接',exact:true}).click();await expect.poll(()=>a.sockets.size).toBe(0);expect(b.sockets.size).toBe(1);
  await page.reload();await active(page).locator('.connection-pill').click();await expect(page.getByRole('button',{name:'切换到 办公室',exact:true})).toContainText('未连接');expect(a.sockets.size).toBe(0);
  await page.getByRole('button',{name:'切换到 电脑 B',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(active(page).locator('.connection-pill')).toHaveText('已连接');
  await active(page).locator('.connection-pill').click();await page.getByRole('button',{name:'办公室 的连接选项'}).click();await page.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('button',{name:'移除电脑',exact:true}).click();
  await expect(page.getByRole('button',{name:'切换到 办公室',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'切换到 电脑 B',exact:true})).toContainText('已连接');expect(b.sockets.size).toBe(1);
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem('dsh.devices.v1')??'[]'));expect(records).toHaveLength(1);
});
