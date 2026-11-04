import test from 'node:test';
import assert from 'node:assert/strict';
import {modelChoice,readModelProjection,advanceModelProjection,reasoningFor} from '../src/modelSelection.ts';
const catalog={groups:[{id:'provider',models:[{id:'reasoner',reasoning:{efforts:[{id:'medium',name:'中'},{id:'ultra',name:'极高'}],defaultEffort:'medium'}},{id:'plain'}]}]};
const initial={provider:'provider',model:'reasoner',reasoningEffort:'ultra'};
test('model changes use host advertised defaults and never carry reasoning into unsupported models',()=>{
  assert.equal(modelChoice(catalog,'provider','reasoner',initial).reasoningEffort,'ultra');
  assert.equal(modelChoice(catalog,'provider','reasoner',null).reasoningEffort,'medium');
  assert.equal(modelChoice(catalog,'provider','plain',initial).reasoningEffort,undefined);
  assert.equal(reasoningFor(catalog,initial).efforts[1].id,'ultra');
});
test('session reasoning is restored from projections and desktop selection events, retaining pending intent',()=>{
  const old={...initial,reasoningEffort:'medium'};
  let state=readModelProjection({values:{modelSelection:{lastUsed:old,next:initial}}});
  state=advanceModelProjection(state,{type:'request/header',data:{header:{config:old}}});
  assert.deepEqual(state.next,initial);
  state=advanceModelProjection(state,{type:'request/header',data:{header:{config:initial}}});
  assert.deepEqual(state.lastUsed,initial);
  const plain={provider:'provider',model:'plain'};
  state=advanceModelProjection(state,{type:'model/selection',data:plain});
  assert.deepEqual(state.next,plain);
});
