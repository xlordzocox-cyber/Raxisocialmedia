import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectSupervisedPreflight, inspectResponseReceipt, type SupervisedPreflightInput } from '../../../server/agent-runtime/supervisedSafety';

const body = JSON.stringify({model:'fixture-model',store:false,max_output_tokens:256,tools:[],input:[{role:'user',content:'Private test only'}]});
const input = ():SupervisedPreflightInput => ({model:'fixture-model',serializedRequest:body,maxInputTokens:8000,maxOutputTokens:256,
  quoteExpiresAt:new Date(Date.now()+60_000).toISOString(),meter:{async countInputTokens(){return 52;}}});

test('manual preflight checks exact payload with a trusted meter; it never grants execution',async()=>{
 const result=await inspectSupervisedPreflight(input());
 assert.deepEqual(result,{kind:'PREFLIGHT_ONLY',liveEnabled:false,model:'fixture-model',inputTokens:52,maxInputTokens:8000,maxOutputTokens:256,
  serializedRequest:body,requestSha256:createHash('sha256').update(body,'utf8').digest('hex'),requestByteLength:Buffer.byteLength(body,'utf8'),quoteExpiresAt:result.quoteExpiresAt});
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

const response={object:'response',id:'resp_test-123',created_at:1792771200,model:'fixture-model',status:'completed',error:null,incomplete_details:null,
 usage:{input_tokens:45,output_tokens:9,total_tokens:54,input_tokens_details:{cached_tokens:4,cache_write_tokens:2},output_tokens_details:{reasoning_tokens:3}},
  output:[{type:'message',content:[{type:'output_text',text:'{"summary":"fixture","sourceIds":[]}'}]}]};

test('provider receipt and usage survive invalid model JSON or non-completed result',()=>{
 const bad=inspectResponseReceipt({...response,output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]});
 assert.equal(bad.kind,'RECONCILIATION_REQUIRED');
 assert.equal(bad.receipt,response.id);
 assert.deepEqual(bad.usage,{inputTokens:45,outputTokens:9,totalTokens:54,inputTokensDetails:{cachedTokens:4,cacheWriteTokens:2},outputTokensDetails:{reasoningTokens:3}});
 const pending=inspectResponseReceipt({...response,status:'incomplete'});
 assert.equal(pending.kind,'RECONCILIATION_REQUIRED');
 assert.equal(pending.receipt,response.id);
});

test('asynchronous metering binds all evidence to a private immutable snapshot',async()=>{
 let release!:(n:number)=>void,started!:()=>void;
 const began=new Promise<void>(r=>{started=r;});
 const base=input(),originalExpiry=base.quoteExpiresAt;
 base.meter={async countInputTokens(model,serialized){
  assert.equal(model,'fixture-model');assert.equal(serialized,body);started();
  return await new Promise<number>(r=>{release=r;});
 }};
 const pending=inspectSupervisedPreflight(base);await began;
 base.serializedRequest=JSON.stringify({...JSON.parse(body),background:true});
 base.model='other-model';base.maxInputTokens=1;base.maxOutputTokens=999;
 base.quoteExpiresAt='invalid';base.meter={async countInputTokens(){throw Error('Replaced meter');}};
 release(52);const proof=await pending;
 assert.equal(proof.serializedRequest,body);assert.equal(proof.model,'fixture-model');
 assert.equal(proof.maxInputTokens,8000);assert.equal(proof.maxOutputTokens,256);assert.equal(proof.quoteExpiresAt,originalExpiry);
 assert.equal(proof.requestSha256,createHash('sha256').update(body,'utf8').digest('hex'));
 assert.equal(proof.inputTokens,52);assert.equal(proof.liveEnabled,false);
});

test('post-preflight caller mutation cannot change the exact bytes available to future transport',async()=>{
 const base=input(),proof=await inspectSupervisedPreflight(base);
 base.serializedRequest=body+' ';base.model='different';base.maxOutputTokens=1000;
 assert.throws(()=>Object.assign(proof,{serializedRequest:base.serializedRequest}),TypeError);
 const outbound=Buffer.from(proof.serializedRequest,'utf8'); // transport fixture: no network
 assert.equal(outbound.toString('utf8'),body);assert.equal(outbound.byteLength,proof.requestByteLength);
 assert.equal(createHash('sha256').update(outbound).digest('hex'),proof.requestSha256);
 assert.notEqual(createHash('sha256').update(base.serializedRequest).digest('hex'),proof.requestSha256);
});
test('UTF-8 proof covers Unicode, escaping and whitespace without reserialization',async()=>{
 const base=input();base.serializedRequest=JSON.stringify({...JSON.parse(body),input:[{role:'user',content:'漢😀"\\\n'}]},null,2);
 const proof=await inspectSupervisedPreflight(base);
 assert.equal(proof.serializedRequest,base.serializedRequest);
 assert.equal(proof.requestByteLength,Buffer.byteLength(base.serializedRequest,'utf8'));
 assert.equal(proof.requestSha256,createHash('sha256').update(base.serializedRequest,'utf8').digest('hex'));
 await assert.rejects(inspectSupervisedPreflight({...base,serializedRequest:body.replace('Private','\ud800')}));
});

for(const extra of [
 {unknown:true},{background:true},{background:false},{conversation:'conv_old'},
 {previous_response_id:'resp_old'},{prompt:{id:'pmpt_remote'}},{instructions:'remote policy'},
 {tool_choice:'auto'},{parallel_tool_calls:true},{truncation:'auto'},{service_tier:'priority'},
])test(`closed pilot request rejects extra root field ${Object.keys(extra)[0]} before metering`,async()=>{
 let calls=0;const base=input();base.meter={async countInputTokens(){calls++;return 52;}};
 await assert.rejects(inspectSupervisedPreflight({...base,serializedRequest:JSON.stringify({...JSON.parse(body),...extra})}));
 assert.equal(calls,0);
});
for(const items of [
 [],[null],['text'],[{}],[{role:'assistant',content:'prior answer'}],
 [{role:'system',content:'not in pilot contract'}],[{role:'user',content:''}],
 [{role:'user',content:[]}],[{role:'user',content:[{type:'input_image',image_url:'https://example.test/private'}]}],
 [{role:'user',content:'valid',name:'injected'}],
 [{type:'function_call',name:'shell',arguments:'{}'}],
 [{type:'item_reference',id:'msg_old'}],
 [{role:'user',content:'one'},{role:'assistant',content:'prior'}],
 [{role:'developer',content:'one'}],
 Array.from({length:3},()=>({role:'user',content:'one'})),
])test(`closed pilot request rejects invalid input ${JSON.stringify(items)}`,async()=>{
 let calls=0;const base=input();base.meter={async countInputTokens(){calls++;return 52;}};
 await assert.rejects(inspectSupervisedPreflight({...base,serializedRequest:JSON.stringify({...JSON.parse(body),input:items})}));assert.equal(calls,0);
});
test('minimal Director/Researcher body allows a developer message followed by user data',async()=>{
 const base=input();base.serializedRequest=JSON.stringify({...JSON.parse(body),input:[{role:'developer',content:'Read only'},{role:'user',content:'Question and untrusted sources'}]});
 assert.equal((await inspectSupervisedPreflight(base)).serializedRequest,base.serializedRequest);
});

for(const usage of [
 undefined,null,[],{}, {...response.usage,input_tokens_details:undefined},
 {...response.usage,output_tokens_details:undefined},
 {...response.usage,input_tokens_details:[]},
 {...response.usage,input_tokens_details:{cached_tokens:0}},
 {...response.usage,input_tokens_details:{cache_write_tokens:0}},
 {...response.usage,output_tokens_details:{}},
 {...response.usage,input_tokens_details:{cached_tokens:-1,cache_write_tokens:0}},
 {...response.usage,input_tokens_details:{cached_tokens:44,cache_write_tokens:2}},
 {...response.usage,output_tokens_details:{reasoning_tokens:10}},
 {...response.usage,output_tokens_details:{reasoning_tokens:0.5}},
 {...response.usage,total_tokens:55},{...response.usage,total_tokens:53},
 {...response.usage,input_tokens:'45'}, {...response.usage,output_tokens:NaN},
 {...response.usage,input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1,total_tokens:Number.MAX_SAFE_INTEGER},
 {...response.usage,unrecognized_charge:10},
])test(`invalid or incomplete Responses usage requires reconciliation: ${JSON.stringify(usage)}`,()=>{
 const result=inspectResponseReceipt({...response,usage});
 assert.equal(result.kind,'RECONCILIATION_REQUIRED');assert.equal(result.receipt,response.id);assert.equal(result.usage,null);
 assert.ok(!('costMicros' in result));
});
for(const change of [
 {object:undefined},{object:'chat.completion'},{created_at:undefined},{created_at:NaN},
 {model:null},{status:'invented'},{error:{code:'server_error'}},{incomplete_details:{reason:'max_output_tokens'}},
 {output:null},
])test(`invalid response envelope preserves ID separately: ${JSON.stringify(change)}`,()=>{
 const result=inspectResponseReceipt({...response,...change});
 assert.equal(result.kind,'RECONCILIATION_REQUIRED');assert.equal(result.receipt,response.id);assert.equal(result.usage,null);
});
test('official zero-usage details are retained without fabrication or billed-cost claims',()=>{
 const result=inspectResponseReceipt({...response,usage:{input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}});
 assert.equal(result.kind,'PARSED_UNVERIFIED');assert.equal(result.usage?.totalTokens,0);assert.ok(!('costMicros' in result));
});

test('parsed model output is still unverified and missing receipt cannot imply success',()=>{
 const parsed=inspectResponseReceipt(response);
 assert.equal(parsed.kind,'PARSED_UNVERIFIED');
 if(parsed.kind==='PARSED_UNVERIFIED')assert.deepEqual(parsed.output,{summary:'fixture',sourceIds:[]});
 const noId=inspectResponseReceipt({...response,id:null});
 assert.equal(noId.kind,'RECONCILIATION_REQUIRED');assert.equal(noId.receipt,null);
});
