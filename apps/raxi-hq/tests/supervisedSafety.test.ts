import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectSupervisedPreflight, inspectResponseReceipt } from '../../../server/agent-runtime/supervisedSafety';

const body = JSON.stringify({model:'fixture-model',store:false,max_output_tokens:256,tools:[],input:[{role:'user',content:'Private test only'}]});
const input = () => ({model:'fixture-model',serializedRequest:body,maxInputTokens:8000,maxOutputTokens:256,
  quoteExpiresAt:new Date(Date.now()+60_000).toISOString(),meter:{async countInputTokens(){return 52;}}});

test('manual preflight checks exact payload with a trusted meter; it never grants execution',async()=>{
 const result=await inspectSupervisedPreflight(input());
 assert.deepEqual(result,{kind:'PREFLIGHT_ONLY',liveEnabled:false,model:'fixture-model',inputTokens:52,maxInputTokens:8000,maxOutputTokens:256});
 assert.equal(Object.isFrozen(result),true);
});

test('preflight fails closed without accurate token count and with expired quote',async()=>{
 const base=input();
 await assert.rejects(inspectSupervisedPreflight({...base,meter:undefined as never}),/unmetered/);
 await assert.rejects(inspectSupervisedPreflight({...base,meter:{async countInputTokens(){return 8001;}}}),/limit/);
 await assert.rejects(inspectSupervisedPreflight({...base,meter:{async countInputTokens(){return NaN;}}}),/limit/);
 await assert.rejects(inspectSupervisedPreflight({...base,quoteExpiresAt:new Date(Date.now()-1000).toISOString()}),/expired/);
});

test('preflight fails when quote expires during metering',async(t)=>{
 const base=input(), expires=Date.now()+1000;let checks=0;
 t.mock.method(Date,'now',()=>++checks<=2?expires-1:expires);
 await assert.rejects(inspectSupervisedPreflight({...base,quoteExpiresAt:new Date(expires).toISOString()}),/expired during metering/);
});

test('preflight rejects altered transport body, tools, storage, and output cap',async()=>{
 const base=input();
 const altered=[
  {...base,serializedRequest:body.replace('"tools":[]','"tools":[{"type":"web_search"}]')},
  {...base,serializedRequest:body.replace('"store":false','"store":true')},
  {...base,serializedRequest:body.replace('"max_output_tokens":256','"max_output_tokens":257')},
  {...base,serializedRequest:body.replace('"fixture-model"','"other-model"')},
  {...base,serializedRequest:'not-json'},
 ];
 for(const bad of altered)await assert.rejects(inspectSupervisedPreflight(bad));
});

const response={id:'resp_test-123',status:'completed',usage:{input_tokens:45,output_tokens:9,total_tokens:54},
  output:[{type:'message',content:[{type:'output_text',text:'{"summary":"fixture","sourceIds":[]}'}]}]};

test('provider receipt and usage survive invalid model JSON or non-completed result',()=>{
 const bad=inspectResponseReceipt({...response,output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]});
 assert.equal(bad.kind,'RECONCILIATION_REQUIRED');
 assert.equal(bad.receipt,response.id);
 assert.deepEqual(bad.usage,{inputTokens:45,outputTokens:9,totalTokens:54});
 const pending=inspectResponseReceipt({...response,status:'incomplete'});
 assert.equal(pending.kind,'RECONCILIATION_REQUIRED');
 assert.equal(pending.receipt,response.id);
});

test('parsed model output is still unverified and missing receipt cannot imply success',()=>{
 const parsed=inspectResponseReceipt(response);
 assert.equal(parsed.kind,'PARSED_UNVERIFIED');
 if(parsed.kind==='PARSED_UNVERIFIED')assert.deepEqual(parsed.output,{summary:'fixture',sourceIds:[]});
 const noId=inspectResponseReceipt({...response,id:null});
 assert.equal(noId.kind,'RECONCILIATION_REQUIRED');assert.equal(noId.receipt,null);
});
