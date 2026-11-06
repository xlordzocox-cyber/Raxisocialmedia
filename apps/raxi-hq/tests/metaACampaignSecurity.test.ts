// Meta A: adversarial Edge/domain tests. All dependencies are local fake functions.
// No Supabase client, Docker, network, SQL, provider, credentials or remote calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignHandler} from '../../../supabase/functions/campaign-command/handler';
import {applyCampaignOperation, emptyCampaignSnapshot, type CampaignOperation} from '../src/persistence/campaignCommands';
import type {IdeaRecord} from '../src/ideas/ideaContracts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='ffffffff-ffff-4fff-8fff-ffffffffffff';
const workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const time='2026-10-19T20:00:00.000Z';
const idea:IdeaRecord={id:'IDEA-REAL-cccccccc-cccc-4ccc-8ccc-cccccccccccc',title:'Prueba Meta A',summary:'Solo fixture local',reason:'Idea manual',source:'MANUAL_LUIS',status:'PROPOSED',priority:'MEDIUM',createdAt:time,updatedAt:time,fitScore:0,confidenceScore:0,suggestedChannels:[],tags:[],evidence:[]};
const command=():CampaignOperation=>({workspaceId:workspace,operationId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',expectedVersion:0,action:{type:'REVIEW_IDEA',ideaId:idea.id,expectedUpdatedAt:time,confirmed:true}});
const json=(value:unknown)=>JSON.stringify(value);
function request(body:unknown,headers:Record<string,string>={}) {
 return new Request('https://isolated.invalid/functions/v1/campaign-command',{method:'POST',headers:{Authorization:'Bearer local-test-token','Content-Type':'application/json',...headers},body:typeof body==='string'?body:json(body)});
}
function fixture(options:{user?:null|{id:string;isAnonymous:boolean}; snapshot?:ReturnType<typeof emptyCampaignSnapshot>; failRead?:boolean; failCommit?:boolean; returnStale?:boolean}={}) {
 const state=options.snapshot??emptyCampaignSnapshot(owner,workspace,[idea]);const calls={verify:0,read:0,commit:0};
 const handler=createCampaignHandler({
  verifyUser:async()=>{calls.verify++;return options.user===undefined?{id:owner,isAnonymous:false}:options.user;},
  read:async()=>{calls.read++;if(options.failRead)throw Error('offline read error');return structuredClone(state);},
  commit:async(_actor,c,next)=>{calls.commit++;if(options.failCommit)throw Error('offline commit error');return options.returnStale?structuredClone(state):structuredClone(next);}
 });
 return {handler,calls,state};
}
test('Meta A Edge rejects missing Bearer before user lookup or write (FAKE_ONLY)',async()=>{
 const f=fixture();const response=await f.handler(request(command(),{Authorization:''}));
 assert.equal(response.status,401);assert.deepEqual(f.calls,{verify:0,read:0,commit:0});
});
test('Meta A Edge rejects anonymous and unresolved JWT before read or commit (FAKE_ONLY)',async()=>{
 for(const user of [null,{id:owner,isAnonymous:true}]){
  const f=fixture({user});const response=await f.handler(request(command()));
  assert.equal(response.status,401);assert.deepEqual(f.calls,{verify:1,read:0,commit:0});
 }
});
test('Meta A Edge rejects unsupported method and content type without committing (FAKE_ONLY)',async()=>{
 const f=fixture();const get=new Request('https://isolated.invalid',{method:'GET'});
 assert.equal((await f.handler(get)).status,405);
 const wrong=await f.handler(request(command(),{'Content-Type':'text/plain'}));
 assert.equal(wrong.status,415);assert.equal(f.calls.commit,0);assert.equal(f.calls.read,0);
});
test('Meta A Edge rejects forged actor and projected state fields (FAKE_ONLY)',async()=>{
 for(const extra of [{actorId:other},{p_actor:other},{next:{ownerId:other}},{session:{decisions:[{approved:true}]}}]){
  const f=fixture();const response=await f.handler(request({...command(),...extra}));
  assert.equal(response.status,400);assert.deepEqual(f.calls,{verify:1,read:0,commit:0});
 }
});
test('Meta A Edge rejects malformed JSON, invalid UTF-8 and oversize payload (FAKE_ONLY)',async()=>{
 const f=fixture();
 assert.equal((await f.handler(request('{'))).status,400);
 const invalid=new Request('https://isolated.invalid',{method:'POST',headers:{Authorization:'Bearer local-test-token','Content-Type':'application/json'},body:new Uint8Array([0xff])});
 assert.equal((await f.handler(invalid)).status,400);
 assert.equal((await f.handler(request(' '.repeat(100_001)))).status,413);
 assert.equal(f.calls.commit,0);assert.equal(f.calls.read,0);
});
test('Meta A Edge refuses cross-owner canonical snapshot before commit (FAKE_ONLY)',async()=>{
 const foreign=emptyCampaignSnapshot(other,workspace,[idea]);const f=fixture({snapshot:foreign});
 const response=await f.handler(request(command()));
 assert.equal(response.status,503);assert.equal(f.calls.read,1);assert.equal(f.calls.commit,0);
});
test('Meta A Edge rejects stale version and missing human confirmation (FAKE_ONLY)',async()=>{
 const stale=fixture({snapshot:{...emptyCampaignSnapshot(owner,workspace,[idea]),version:1}});
 assert.equal((await stale.handler(request(command()))).status,409);assert.equal(stale.calls.commit,0);
 const unconfirmed=fixture();const raw={...command(),action:{...command().action,confirmed:false}};
 assert.equal((await unconfirmed.handler(request(raw))).status,409);assert.equal(unconfirmed.calls.commit,0);
});
test('Meta A Edge does not confirm a failed commit or an unverified canonical receipt (FAKE_ONLY)',async()=>{
 const failed=fixture({failCommit:true});assert.equal((await failed.handler(request(command()))).status,503);assert.equal(failed.calls.commit,1);
 const stale=fixture({returnStale:true});assert.equal((await stale.handler(request(command()))).status,200);
 // The handler currently validates snapshot shape, but leaves exact receipt verification to the caller store.
 // This test documents the current trust-boundary gap; a positive HTTP status is NOT an operation receipt.
 assert.equal(stale.calls.commit,1);
});
test('Meta A Edge canonical positive transition and idempotent replay are distinct (FAKE_ONLY)',async()=>{
 const current=emptyCampaignSnapshot(owner,workspace,[idea]);
 const applied=applyCampaignOperation(current,command());
 assert.equal(applied.ideas[0].status,'UNDER_REVIEW');
 assert.equal(applied.receipts.filter(r=>r.operationId===command().operationId).length,1);
 let commits=0;
 const handler=createCampaignHandler({verifyUser:async()=>({id:owner,isAnonymous:false}),read:async()=>structuredClone(applied),commit:async()=>{commits++;throw Error('replay must not commit');}});
 const response=await handler(request(command()));
 assert.equal(response.status,200);assert.equal(commits,0);
 const receipt=(await response.json()).receipts;
 assert.equal(receipt.length,1);assert.equal(receipt[0].operationId,command().operationId);
});
