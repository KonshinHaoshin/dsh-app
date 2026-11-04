import {createHash} from 'node:crypto';
import {test,expect} from '@playwright/test';
import type {Page,WebSocketRoute} from '@playwright/test';
const token='test-only-persistent-phone-token-000001';
async function host(page:Page){
 const calls:any[]=[];let offline=false,failPrompt=false,hellos=0,pongs=0;const muted=new Set<WebSocketRoute>();const sockets=new Set<WebSocketRoute>();
 await page.routeWebSocket('wss://features.test/connect',ws=>{sockets.add(ws);ws.onClose(()=>sockets.delete(ws));ws.onMessage(raw=>{
  if(muted.has(ws))return;
  const f=JSON.parse(String(raw)),send=(type:string,value:unknown)=>ws.send(JSON.stringify({type,id:f.id,value}));
  if(f.type==='hello'){hellos++;expect(f.token).toBeUndefined();expect(f.tokenDigest).toBe(createHash('sha256').update(token).digest('hex'));if(offline){ws.close({code:1008,reason:'设备离线或配对信息不正确'});return;}ws.send(JSON.stringify({type:'ready',protocol:1,name:'功能测试电脑'}));}
  if(f.type==='ping'){pongs++;ws.send(JSON.stringify({type:'pong'}));}
  if(f.type==='call'){calls.push(f);if(f.endpoint==='session/list')send('result',{items:[]});else if(f.endpoint==='session/modelCatalog')send('result',{groups:[]});else if(f.endpoint==='session/create')send('result',{sessionId:'test-session'});else if(f.endpoint==='fileUploads/upload')send('result',{receiptId:'receipt-for-session'});else if(f.endpoint==='session/prompt'){if(failPrompt)ws.send(JSON.stringify({type:'error',id:f.id,error:{message:'模型暂不可用'}}));else send('result',{accepted:true});}else send('result',{});}
  if(f.type==='open'){if(f.endpoint==='workspace/follow')send('item',{type:'baseline',value:{items:[]}});else if(f.endpoint==='$events')send('item',{type:'ready',clientId:'events-client'});else if(f.endpoint==='session/follow')send('item',{type:'snapshot',cursor:0,records:[{type:'event',event:{seq:0,type:'user/message',data:{source:{kind:'runtime-context'},content:[{type:'text',text:'Current runtime context. Internal path.'}]}}}],hasMore:false});}
 });});
 await page.addInitScript(token=>{if(localStorage.getItem('test.seeded'))return;localStorage.setItem('test.seeded','yes');localStorage.setItem('dsh.connection',JSON.stringify({url:'https://features.test',deviceId:'feature-device',mode:'public'}));sessionStorage.setItem('dsh.token',token);},token);await page.goto('/');await expect(page.locator('.connection-pill')).toHaveText('已连接');
 return {calls,get hellos(){return hellos;},get pongs(){return pongs;},fail(){failPrompt=true;},blackhole(){for(const ws of sockets)muted.add(ws);},offline(){offline=true;for(const ws of sockets)ws.close({code:1012,reason:'DSH 主机已离线'});},online(){offline=false;}};
}
test('pairing survives cleared session storage and foreground recovery without another QR',async({page})=>{
 const h=await host(page);await page.evaluate(()=>sessionStorage.clear());await page.reload();await expect(page.locator('.connection-pill')).toHaveText('已连接');
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(token);
 // The persisted vault holds ciphertext and a non-extractable key, not a token.
 const entries=await page.evaluate(()=>new Promise<any[]>((resolve,reject)=>{const r=indexedDB.open('dsh-pairing-v1');r.onsuccess=()=>{const tx=r.result.transaction('vault'),q=tx.objectStore('vault').getAll();q.onsuccess=()=>resolve(q.result.map(v=>v instanceof CryptoKey?{extractable:v.extractable}:v));q.onerror=()=>reject(q.error);};}));expect(JSON.stringify(entries)).not.toContain(token);expect(entries.some(e=>e.extractable===false)).toBe(true);
 await page.clock.install();await page.clock.fastForward(16000);const before=h.hellos;await page.evaluate(()=>window.dispatchEvent(new Event('dsh-resume')));await expect.poll(()=>h.hellos).toBeGreaterThan(before);await expect(page.locator('.connection-pill')).toHaveText('已连接');
});
test('a temporarily offline public host retries automatically with its saved pairing',async({page})=>{
 const h=await host(page);await page.clock.install();h.offline();await expect(page.locator('.connection-pill')).toHaveText('重新连接中');await page.clock.fastForward(1500);await expect.poll(()=>h.hellos).toBeGreaterThan(1);await expect(page.getByText('电脑暂不可用，正在重试；已保留配对信息')).toBeVisible();h.online();await page.clock.fastForward(5000);await expect(page.locator('.connection-pill')).toHaveText('已连接');
});
test('image and file attachments send scoped receipts, and injected runtime context stays hidden',async({page})=>{
 const h=await host(page);const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=','base64');
 await page.getByLabel('选择图片或文件').setInputFiles([{name:'photo.png',mimeType:'image/png',buffer:png},{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('hello file')}]);
 await expect(page.getByRole('img',{name:'photo.png'})).toBeVisible();await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeEnabled();await page.screenshot({path:'artifacts/mobile-attachments-v05.png'});
 await page.getByRole('button',{name:'发送消息',exact:true}).click();await expect.poll(()=>h.calls.filter(f=>f.endpoint==='session/prompt').length).toBe(1);
 const upload=h.calls.find(f=>f.endpoint==='fileUploads/upload'),prompt=h.calls.find(f=>f.endpoint==='session/prompt');expect(upload.params).toMatchObject({sessionId:'test-session',name:'notes.txt',data:'aGVsbG8gZmlsZQ=='});expect(prompt.params.content).toEqual([{type:'image',mediaType:'image/png',name:'photo.png',data:png.toString('base64')},{type:'file',receiptId:'receipt-for-session'}]);await expect(page.getByText('Current runtime context. Internal path.')).toHaveCount(0);await expect(page.getByLabel('待发送附件')).toHaveCount(0);
});
test('failed submissions retain draft and selected files for an explicit retry',async({page})=>{
 const h=await host(page);h.fail();await page.getByLabel('选择图片或文件').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('notes')});await page.getByRole('textbox',{name:'发送给 DSH 的消息'}).fill('请看附件');await page.getByRole('button',{name:'发送消息',exact:true}).click();await expect(page.getByRole('alert')).toContainText('模型暂不可用');await expect(page.getByRole('textbox',{name:'发送给 DSH 的消息'})).toHaveValue('请看附件');await expect(page.getByLabel('待发送附件')).toContainText('notes.txt');expect(h.calls.filter(f=>f.endpoint==='session/prompt')).toHaveLength(1);
});

test('a blackholed socket recovers after the application heartbeat times out',async({page})=>{
 await page.clock.install();const h=await host(page);await expect.poll(()=>h.pongs).toBeGreaterThan(0);const before=h.hellos;h.blackhole();await page.clock.runFor(82000);await expect.poll(()=>h.hellos).toBeGreaterThan(before);await expect(page.locator('.connection-pill')).toHaveText('已连接');
});
