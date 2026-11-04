import {test,expect} from '@playwright/test';

test('minimal blue-white mobile interface, camera-first connection panel, dark mode and landscape',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.welcome-minimal .brand')).toBeVisible();
  await expect(page.getByText('想法在这里，')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'切换深色外观'}).click();
  await page.getByRole('button',{name:'切换浅色外观'}).click();
  await page.getByRole('button',{name:'连接 DSH',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'扫一扫',exact:true})).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.getByRole('button',{name:'使用配对链接'}).click();
  await dialog.getByRole('textbox',{name:'配对链接'}).fill('https://untrusted.example/');
  await dialog.getByRole('button',{name:'配对',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('配对码');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await page.setViewportSize({width:812,height:375});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('desktop sidebar remains visible',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await expect(page.getByRole('complementary',{name:'会话导航'})).toBeVisible();
});

test('pairing and searchable workspaces use only a browser-side protocol mock',async({page})=>{
  const token='test-only-phone-token-000000000001';
  let redeemed=false;
  await page.routeWebSocket('wss://dsh-mobile.test/connect',ws=>{
    ws.onMessage(raw=>{
      const f=JSON.parse(String(raw));
      if(f.type==='pair'){
        if(redeemed){ws.close({code:1008,reason:'配对码已失效'});return;}
        redeemed=true;ws.send(JSON.stringify({type:'paired',protocol:1,deviceId:'test-device',token}));return;
      }
      if(f.type==='hello'){ws.send(JSON.stringify({type:'ready',protocol:1,name:'测试电脑'}));return;}
      const send=(type:string,value:unknown)=>ws.send(JSON.stringify({type,id:f.id,value}));
      if(f.type==='call'){
        if(f.endpoint==='session/list')send('result',{items:[]});
        else if(f.endpoint==='session/modelCatalog')send('result',{groups:[]});
        else send('result',{});
      }
      if(f.type==='open'&&f.endpoint==='workspace/follow')send('item',{type:'baseline',value:{items:[{workspaceId:'one',title:'手机项目',path:'/projects/mobile',sessionIds:[]},{workspaceId:'two',title:'文档',path:'/projects/docs',sessionIds:[]}],archivedSessionIds:[],pinnedSessionIds:[]}});
      if(f.type==='open'&&f.endpoint==='$events')send('item',{type:'ready',clientId:'test-client',host:{home:'/projects'}});
    });
  });
  const uri='https://dshapi.shelterhub.moe/#pair='+Buffer.from(JSON.stringify({v:1,url:'https://dsh-mobile.test',mode:'public',deviceId:'test-device',code:'test-only-one-time-code-00000001',expiresAt:Date.now()+300000})).toString('base64url');
  await page.goto('/');await page.getByRole('button',{name:'连接 DSH',exact:true}).click();
  await page.getByRole('button',{name:'使用配对链接',exact:true}).click();
  await page.getByRole('textbox',{name:'配对链接'}).fill(uri);await page.getByRole('button',{name:'配对',exact:true}).click();
  await expect(page.locator('.connection-pill')).toHaveText('已连接');await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('dsh.connection'))).not.toContain(token);
  await page.getByRole('button',{name:'选择会话工作区'}).click();
  const picker=page.getByRole('dialog',{name:'工作区',exact:true});
  await picker.getByRole('textbox',{name:'搜索工作区'}).fill('mobile');
  await expect(picker.getByRole('option')).toHaveCount(2);
  await expect(picker.getByText('/projects/mobile',{exact:true})).toBeVisible();
  await picker.getByRole('option').filter({hasText:'手机项目'}).click();
  await expect(page.getByRole('button',{name:'选择会话工作区'})).toHaveText('手机项目');
});
