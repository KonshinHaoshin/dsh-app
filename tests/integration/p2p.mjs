// Real Chromium <-> Node DTLS/SCTP through an authenticated local relay fixture.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {startBridge} from '../../../dsh-app-plugin/host.mjs';
import {createRelay} from '../../../server/relay.mjs';
const token='test-only-p2p-pairing-token-0000000001',secret='test-only-p2p-relay-owner-secret-00000000001';
let writes=0,resolveWrite,opened=0;
const adapter={async call(endpoint,params){if(endpoint==='session/prompt'){writes++;await new Promise(r=>resolveWrite=r);return {accepted:true};}return {echo:params};},async *stream(endpoint,params,signal){opened++;yield {type:'ready',clientId:'test-persistent-approval-owner'};await new Promise(r=>signal.addEventListener('abort',r,{once:true}));}};
const relay=await createRelay({hostSecret:secret,port:0,allowedOrigins:['http://127.0.0.1:5186']}),bridge=await startBridge(adapter,{deviceId:'qa-p2p-host',token,port:0,relayUrl:`ws://127.0.0.1:${relay.port}/connect`,relaySecret:secret,iceServers:[]});
let browser;try{
 for(let i=0;i<100&&!bridge.status().relayConnected;i++)await new Promise(r=>setTimeout(r,20));
 browser=await chromium.launch({headless:true,args:['--disable-features=WebRtcHideLocalIpsWithMdns']});const page=await browser.newPage();
 page.on('console',m=>{if(m.type()==='error')console.log('Browser error:',m.text().slice(0,200));});await page.goto('http://127.0.0.1:5186');
 await page.evaluate(async({port,token})=>{
  const {HybridSocket}=await import('/src/transport/HybridSocket.ts');window.qaFrames=[];window.qaRoutes=[];
  const s=window.qaSocket=new HybridSocket(new URL(`ws://127.0.0.1:${port}/connect`),{mode:'public',deviceId:'qa-p2p-host',token,url:`http://127.0.0.1:${port}`},r=>window.qaRoutes.push(r));
  s.onopen=()=>s.send(JSON.stringify({type:'hello'}));s.onmessage=e=>window.qaFrames.push(JSON.parse(e.data));
 },{port:relay.port,token});
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.type==='ready'),{},{timeout:20000});
 await page.evaluate(()=>window.qaSocket.send(JSON.stringify({type:'open',id:'approval-owner',endpoint:'$events',params:{}})));
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.id==='approval-owner'));
 await page.waitForFunction(()=>window.qaRoutes.at(-1)==='p2p',{},{timeout:20000});assert.equal(bridge.status().p2pConnections,1);console.log('Real browser DTLS/SCTP direct path PASS');
 // Losing signaling must not tear down an established direct session.
 const epoch=await page.evaluate(()=>window.qaSocket.epoch);await page.evaluate(()=>{window.qaSocket.ws.close();window.qaSocket.send(JSON.stringify({type:'call',id:'no-signaling',endpoint:'session/list',params:{}}));});
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.id==='no-signaling'));await page.waitForFunction(()=>window.qaSocket.ws?.readyState===1,{},{timeout:10000});
 assert.equal(await page.evaluate(()=>window.qaSocket.epoch),epoch);assert.equal(opened,1);console.log('Established P2P survives signaling reconnection without replacing the session PASS');
 await page.evaluate(()=>window.qaSocket.send(JSON.stringify({type:'call',id:'attachment',endpoint:'fileUploads/upload',params:{data:'图片🧩'.repeat(200000)}})));
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.id==='attachment'),{},{timeout:30000});assert.equal(await page.evaluate(()=>window.qaFrames.find(f=>f.id==='attachment').value.echo.data.length),800000);console.log('Multi-MB Unicode payload over real DataChannel PASS');
 await page.evaluate(()=>window.qaSocket.send(JSON.stringify({type:'call',id:'write-once',endpoint:'session/prompt',params:{sessionId:'test',content:[]}})));
 for(let i=0;i<100&&!writes;i++)await new Promise(r=>setTimeout(r,20));assert.equal(writes,1);
 await page.evaluate(()=>window.qaSocket.pc.close());await page.waitForFunction(()=>window.qaRoutes.at(-1)==='relay');resolveWrite();
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.id==='write-once'));assert.equal(writes,1);assert.equal(opened,1);console.log('P2P loss falls back to WSS with one execution and the same approval subscription PASS');
 await page.evaluate(()=>window.qaSocket.close());
 await page.evaluate(async({port,token})=>{
  const Base=window.RTCPeerConnection;window.blockedDescription=false;
  window.RTCPeerConnection=class extends Base{async setRemoteDescription(){window.blockedDescription=true;throw Error('test-only unsupported ICE/SDP');}};
  const {HybridSocket}=await import('/src/transport/HybridSocket.ts');window.qaFrames=[];window.qaRoutes=[];
  const s=window.qaSocket=new HybridSocket(new URL(`ws://127.0.0.1:${port}/connect`),{mode:'public',deviceId:'qa-p2p-host',token,url:`http://127.0.0.1:${port}`},r=>window.qaRoutes.push(r));s.onopen=()=>s.send(JSON.stringify({type:'hello'}));s.onmessage=e=>window.qaFrames.push(JSON.parse(e.data));
 },{port:relay.port,token});
 await page.waitForFunction(()=>window.blockedDescription,{},{timeout:20000});
 await page.evaluate(()=>window.qaSocket.send(JSON.stringify({type:'call',id:'blocked-p2p',endpoint:'session/list',params:{}})));
 await page.waitForFunction(()=>window.qaFrames.some(f=>f.id==='blocked-p2p'));assert.equal(await page.evaluate(()=>window.qaRoutes.at(-1)),'relay');console.log('Unsupported direct negotiation leaves the relay immediately usable PASS');await page.evaluate(()=>window.qaSocket.close());
}finally{await browser?.close();await bridge.close();await relay.close();}
