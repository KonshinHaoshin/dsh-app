import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
async function modelHost(page:Page,openExisting=true){
  const requests:any[]=[];let current={provider:'test',model:'reasoner',reasoningEffort:'medium'};let push:(selection:any)=>void=()=>{};let fail=false;
  await page.addInitScript(()=>{localStorage.setItem('dsh.connection',JSON.stringify({url:'https://model.test',deviceId:'test-device',mode:'public'}));sessionStorage.setItem('dsh.token','test-only-phone-pairing-key-0001');});
  await page.routeWebSocket('wss://model.test/connect',ws=>ws.onMessage(raw=>{
    const f=JSON.parse(String(raw));const send=(type:string,value:unknown)=>ws.send(JSON.stringify({type,id:f.id,value}));
    if(f.type==='hello'){ws.send(JSON.stringify({type:'ready',protocol:1,name:'测试电脑'}));return;}
    if(f.type==='call'){
      requests.push(f);
      if(f.endpoint==='session/list')send('result',{items:[{sessionId:'s1',title:'推理设置测试',running:false,updatedAt:Date.now(),projections:{values:{modelSelection:{next:current,lastUsed:null}}}}]});
      else if(f.endpoint==='session/modelCatalog')send('result',{default:current,groups:[{id:'test',name:'测试模型',models:[{id:'reasoner',name:'推理模型',reasoning:{defaultEffort:'medium',efforts:[{id:'medium',name:'中'},{id:'ultra',name:'极高'}]}},{id:'plain',name:'普通模型'}]}]});
      else if(f.endpoint==='session/selectModel'){
        if(fail){ws.send(JSON.stringify({type:'error',id:f.id,error:{message:'模拟选择失败'}}));return;}
        current={...f.params};delete(current as any).sessionId;send('result',{selected:current});push(current);
      }else if(f.endpoint==='session/create')send('result',{sessionId:'new-session'});
      else if(f.endpoint==='session/prompt')send('result',{accepted:true});
      else send('result',{});
    }
    if(f.type==='open'){
      if(f.endpoint==='workspace/follow')send('item',{type:'baseline',value:{items:[]}});
      if(f.endpoint==='$events')send('item',{type:'ready',clientId:'test-client',host:{home:'/tmp'}});
      if(f.endpoint==='session/follow'){
        send('item',{type:'snapshot',cursor:-1,records:[],hasMore:false,projections:{values:{modelSelection:{next:current,lastUsed:null}}}});
        let seq=0;push=selection=>{current=selection;send('item',{type:'event',event:{seq:seq++,type:'model/selection',data:selection}});};
      }
    }
  }));
  await page.goto('/');await expect(page.locator('.connection-pill')).toHaveText('已连接');
  if(openExisting){await page.getByRole('button',{name:'打开会话列表'}).click();await page.getByRole('button').filter({hasText:'推理设置测试'}).click();}
  await page.getByRole('button',{name:'模型与推理强度',exact:true}).click();
  return {requests,desktopSelect:(s:any)=>push(s),fail:()=>{fail=true;}};
}
test('reasoning follows the session, sends the full host selection and removes effort for plain models',async({page})=>{
  const host=await modelHost(page);
  await expect(page.getByLabel('选择模型',{exact:true})).toHaveValue('test\u001freasoner');
  const effort=page.getByLabel('推理强度',{exact:true});await expect(effort).toHaveValue('medium');
  await effort.selectOption('ultra');await expect(effort).toHaveValue('ultra');await expect(effort).toBeEnabled();
  await page.screenshot({path:'artifacts/mobile-reasoning-v03.png',animations:'disabled'});
  expect(host.requests.find(f=>f.endpoint==='session/selectModel').params).toEqual({sessionId:'s1',provider:'test',model:'reasoner',reasoningEffort:'ultra'});
  host.desktopSelect({provider:'test',model:'reasoner',reasoningEffort:'medium'});await expect(effort).toHaveValue('medium');
  await page.getByLabel('选择模型',{exact:true}).selectOption('test\u001fplain');await expect(effort).toBeDisabled();
  expect(host.requests.filter(f=>f.endpoint==='session/selectModel').at(-1).params).not.toHaveProperty('reasoningEffort');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('a reasoning choice before the first message is applied before the new session prompt',async({page})=>{
  const host=await modelHost(page,false);const effort=page.getByLabel('推理强度',{exact:true});await expect(effort).toHaveValue('medium');
  await effort.selectOption('ultra');expect(host.requests.filter(f=>f.endpoint==='session/selectModel')).toHaveLength(0);
  await page.getByRole('button',{name:'关闭模型设置'}).click();await page.getByRole('textbox',{name:'发送给 DSH 的消息'}).fill('测试新会话推理设置');await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await expect.poll(()=>host.requests.filter(f=>f.endpoint==='session/prompt').length).toBe(1);
  const selection=host.requests.findIndex(f=>f.endpoint==='session/selectModel'),prompt=host.requests.findIndex(f=>f.endpoint==='session/prompt');
  expect(selection).toBeLessThan(prompt);expect(host.requests[selection].params).toMatchObject({sessionId:'new-session',reasoningEffort:'ultra'});
});
test('failed reasoning changes retain the previous selection and show an error',async({page})=>{
  const host=await modelHost(page);host.fail();const effort=page.getByLabel('推理强度',{exact:true});await expect(effort).toHaveValue('medium');
  await effort.selectOption('ultra');await expect(effort).toHaveValue('medium');await page.getByRole('button',{name:'关闭模型设置'}).click();await expect(page.getByRole('alert')).toContainText('模拟选择失败');
});
