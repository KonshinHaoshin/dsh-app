import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePairingLink} from '../src/pairing.ts';
const now=Date.now();
const base={v:1,url:'https://dshapi.shelterhub.moe',mode:'public',deviceId:'test-device',code:'test-only-one-time-pairing-code-0001',expiresAt:now+300000};
const link=value=>'https://dshapi.shelterhub.moe/#pair='+Buffer.from(JSON.stringify(value)).toString('base64url');
test('mobile parser accepts public and private LAN pairing without manual credentials',()=>{
  assert.equal(parsePairingLink(link(base),now).mode,'public');
  const lan=parsePairingLink(link({...base,url:'http://192.168.1.2:43821',mode:'lan'}),now);
  assert.equal(lan.url,'http://192.168.1.2:43821');
});
test('mobile parser rejects expired codes, plaintext public endpoints, external LAN hosts and URL credentials',()=>{
  for(const patch of [{expiresAt:now-1},{expiresAt:now+900000},{url:'http://example.com'},{url:'http://example.com',mode:'lan'},{url:'https://user:secret@example.com'},{url:'https://example.com/?token=secret'},{code:'short'},{v:2}]){
    assert.throws(()=>parsePairingLink(link({...base,...patch}),now));
  }
  assert.throws(()=>parsePairingLink('https://untrusted.example/#pair=anything',now));
});
