import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { campaignDatabase } from './campaignDatabase';
import { applyCampaignOperation, emptyCampaignSnapshot, parseCampaignSnapshot, type CampaignOperation, type CampaignSnapshot, type RealCampaignAction } from '../src/persistence/campaignCommands';
import { RealCampaignStore } from '../src/persistence/realCampaignStore';
import { RealCampaignCenter } from '../src/persistence/RealCampaignCenter';
import { RealIdeaStore } from '../src/persistence/realIdeaStore';
import { createCampaignHandler } from '../../../supabase/functions/campaign-command/handler';
import { AuthStore } from '../src/auth/authStore';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { CampaignBriefForm } from '../src/campaigns/CampaignBriefForm';
import type { CampaignStrategyInput } from '../src/campaigns/strategyContracts';
import type { IdeaRecord } from '../src/ideas/ideaContracts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const idea: IdeaRecord={ id:'IDEA-REAL-cccccccc-cccc-4ccc-8ccc-cccccccccccc', title:'Idea de prueba aislada', summary:'Sin escritura de producción.', reason:'Entrada manual sin investigación', source:'MANUAL_LUIS',status:'PROPOSED',priority:'MEDIUM',createdAt:'2026-10-19T20:00:00Z',updatedAt:'2026-10-19T20:00:00Z',fitScore:0,confidenceScore:0,suggestedChannels:[],tags:[],evidence:[] };
const strategy: CampaignStrategyInput={audience:'Audiencia adulta',audienceNeed:'Conversación',creativeConcept:'Tarde de gaming',narrativeApproach:'Inicio y cierre',visualDirection:'Luz natural',toneOfVoice:'Conversacional',desiredAudienceResponse:'Comentar',successCriteria:'Evaluación cualitativa',deliverables:[{id:'STRATEGY-ITEM-001',channel:'INSTAGRAM_FEED',contentLevel:'PUBLIC_SOCIAL',format:'PHOTO',quantity:1,purpose:'Comunidad',creativeAngle:'Una partida inesperada'}]};
const brief={title:'Campaña real de prueba local',objective:'Comunidad',priority:'MEDIUM' as const,channels:['INSTAGRAM_FEED' as const],contentLevels:['PUBLIC_SOCIAL' as const],keyMessage:'Disfrutar una partida'};
const operation=(snapshot:CampaignSnapshot,action:RealCampaignAction):CampaignOperation=>({workspaceId:workspace,operationId:crypto.randomUUID(),expectedVersion:snapshot.version,action});

test('PostgreSQL local: real idea handoff, campaign, strategy history, deliverables, approvals and idempotency are atomic and owner scoped',async()=>{
 const db=await campaignDatabase();
 try {
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query("insert into public.raxi_workspaces(id,owner_user_id,slug,name) values($1,$2,'raxi-hq','Local test')",[workspace,owner]);
  await db.query("insert into public.raxi_ideas(workspace_id,external_id,kind,title,status,source,summary,priority,payload) values($1,$2,'PROPOSAL',$3,'PROPOSED','MANUAL_LUIS',$4,'MEDIUM',$5)",[workspace,idea.id,idea.title,idea.summary,JSON.stringify(idea)]);
  await db.exec('set role service_role');
  const read=async()=>parseCampaignSnapshot((await db.query<{v:unknown}>('select public.raxi_campaign_snapshot($1,$2) as v',[workspace,owner])).rows[0].v,owner,workspace);
  let snapshot=await read();
  const handler=createCampaignHandler({verifyUser:async()=>({id:owner,isAnonymous:false}),read:async(actor,scope)=>(await db.query<{v:unknown}>('select public.raxi_campaign_snapshot($1,$2) v',[scope,actor])).rows[0].v,
    commit:async(actor,command,next)=>(await db.query<{v:unknown}>('select public.raxi_campaign_commit($1,$2,$3) v',[actor,JSON.stringify(command),JSON.stringify(next)])).rows[0].v});
  const run=async(action:RealCampaignAction)=>{ const command=operation(snapshot,action); const next=applyCampaignOperation(snapshot,command);
    const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer local-fixture','Content-Type':'application/json'},body:JSON.stringify(command)}));
    assert.equal(response.status,200,await response.clone().text());snapshot=parseCampaignSnapshot(await response.json(),owner,workspace);return {command,next}; };
  for (const type of ['REVIEW_IDEA','APPROVE_IDEA','HANDOFF_IDEA'] as const) await run({type,ideaId:idea.id,expectedUpdatedAt:snapshot.ideas[0].updatedAt,confirmed:true});
  const created=await run({type:'CREATE_CAMPAIGN',ideaId:idea.id,brief});
  assert.equal(snapshot.session.campaigns.length,1); assert.equal(snapshot.session.campaigns[0].provenance,'REAL');
  const id=snapshot.session.campaigns[0].id;
  await db.query('select public.raxi_campaign_commit($1,$2,$3)',[owner,JSON.stringify(created.command),JSON.stringify(created.next)]);
  assert.equal((await read()).session.campaigns.length,1);
  await assert.rejects(db.query('select public.raxi_campaign_commit($1,$2,$3)',[owner,JSON.stringify({...created.command,action:{...created.command.action,brief:{...brief,title:'Changed'}}}),JSON.stringify(created.next)]));
  await run({type:'TRANSITION_CAMPAIGN',campaignId:id,to:'PLANNING'});
  await run({type:'SAVE_STRATEGY',campaignId:id,input:strategy});
  await run({type:'SUBMIT_STRATEGY',campaignId:id,revision:1});
  await run({type:'APPROVE_STRATEGY',campaignId:id,revision:1,confirmed:true});
  const approved=structuredClone(snapshot.session.strategies[0]);
  await run({type:'START_STRATEGY_REVISION',campaignId:id,revision:1,confirmed:true,reason:'Explorar otra dirección'});
  await run({type:'SAVE_STRATEGY',campaignId:id,input:{...strategy,creativeConcept:'Revisión dos'}});
  const reloaded=await read(); assert.equal(reloaded.session.strategies.length,2); assert.deepEqual(reloaded.session.strategies[0],approved);
  assert.equal((await db.query<{n:number}>('select count(*)::integer n from public.raxi_strategy_deliverables')).rows[0].n,2);
  const approvals=await db.query<{actor_user_id:string;subject_kind:string;context:{snapshot?:{revision:number}}}>('select actor_user_id,subject_kind,context from public.raxi_approvals');
  assert.ok(approvals.rows.every(a=>a.actor_user_id===owner)); assert.ok(approvals.rows.some(a=>a.subject_kind==='STRATEGY'&&a.context.snapshot?.revision===1));
  const before=await read(), badCommand=operation(before,{type:'SAVE_STRATEGY',campaignId:id,input:strategy});
  const invalid=applyCampaignOperation(before,badCommand); invalid.session.strategies[1].deliverables[0].quantity=101;
  await assert.rejects(db.query('select public.raxi_campaign_commit($1,$2,$3)',[owner,JSON.stringify(badCommand),JSON.stringify(invalid)]));
  assert.equal((await read()).version,before.version); assert.deepEqual((await read()).session.strategies,before.session.strategies);
  await assert.rejects(db.query('select public.raxi_campaign_snapshot($1,$2)',[workspace,'ffffffff-ffff-4fff-8fff-ffffffffffff']));
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select public.raxi_campaign_commit($1,$2,$3)',[owner,JSON.stringify(created.command),JSON.stringify(created.next)]));
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner})]); await db.exec('set role authenticated');
  assert.equal((await db.query<{v:CampaignSnapshot}>('select public.raxi_campaign_snapshot($1) v',[workspace])).rows[0].v.session.campaigns.length,1);
  await assert.rejects(db.exec("insert into public.raxi_campaigns(workspace_id) values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')"));
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:'ffffffff-ffff-4fff-8fff-ffffffffffff'})]); await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.raxi_campaign_snapshot($1,$2)',[workspace,owner]));
  await db.exec('reset role');
  await assert.rejects(db.exec("update public.raxi_strategy_revisions set payload=jsonb_set(payload,'{creativeConcept}','\"forged\"') where revision=1"));
  await assert.rejects(db.exec('delete from public.raxi_strategy_revisions where revision=1'));
  await assert.rejects(db.exec('update public.raxi_strategy_deliverables set quantity=3 where strategy_id in (select id from public.raxi_strategy_revisions where revision=1)'));
  await assert.rejects(db.exec('delete from public.raxi_approvals'));
 } finally { await db.close(); }
});

test('campaign store recovers a lost response using the exact operation receipt and accepts a new command only afterward',async()=>{
 let snapshot=emptyCampaignSnapshot(owner,workspace,[idea]); let lose=true; const commands:CampaignOperation[]=[];
 const store=new RealCampaignStore({read:async()=>structuredClone(snapshot),execute:async command=>{commands.push(command);snapshot=applyCampaignOperation({...snapshot,serverTime:new Date().toISOString()},command);if(lose)throw new Error('lost');return structuredClone(snapshot);}},owner,workspace);
 await store.load(); const action={type:'REVIEW_IDEA' as const,ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true};
 assert.equal(await store.execute(action),false); assert.equal(store.getSnapshot().pending?.operationId,commands[0].operationId);
 await store.resume(); assert.equal(store.getSnapshot().pending,null); assert.equal(store.getSnapshot().confirmedId,commands[0].operationId);
 lose=false;assert.equal(await store.execute({type:'APPROVE_IDEA',ideaId:idea.id,expectedUpdatedAt:snapshot.ideas[0].updatedAt,confirmed:true}),true);
 assert.notEqual(commands[0].operationId,commands[1].operationId);
});

test('campaign Edge rejects missing/anonymous JWT and client-supplied actor or projection without calling commit',async()=>{
 let writes=0; const handler=createCampaignHandler({verifyUser:async()=>({id:owner,isAnonymous:false}),read:async()=>emptyCampaignSnapshot(owner,workspace,[idea]),commit:async()=>{writes++;}});
 const request=(body:unknown,token=true)=>new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
 const command=operation(emptyCampaignSnapshot(owner,workspace,[idea]),{type:'REVIEW_IDEA',ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true});
 assert.equal((await handler(request(command,false))).status,401);
 assert.equal((await handler(request({...command,ownerId:owner}))).status,400);
 assert.equal((await handler(request({...command,next:{}}))).status,400);
 const anonymous=createCampaignHandler({verifyUser:async()=>({id:owner,isAnonymous:true}),read:async()=>{},commit:async()=>{writes++;}});
 assert.equal((await anonymous(request(command))).status,401);assert.equal(writes,0);
});

test('real Campaign Workspace keeps its original panels, disables missing backend and never offers Aria generation',async()=>{
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const store=new RealCampaignStore({read:async()=>{throw new Error('SERVICE_NOT_DEPLOYED');},execute:async()=>{throw new Error('Must not write');}},owner,workspace);
 await store.load();const ideas=new RealIdeaStore({findWorkspace:async()=>null,createWorkspace:async()=>{throw new Error('unused');},listIdeas:async()=>[],createIdea:async()=>{throw new Error('unused');}},owner);
 let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
 assert.match(JSON.stringify(view.toJSON()),/pendiente de despliegue autorizado/);assert.ok(!JSON.stringify(view.toJSON()).includes('Aria Studio Pilot'));
 await act(async()=>view.unmount());
});

test('invalid campaign decisions fail before allocating a pending command; form can be corrected without a write',async()=>{
 let calls=0;const snapshot=emptyCampaignSnapshot(owner,workspace,[idea]);
 const store=new RealCampaignStore({read:async()=>snapshot,execute:async()=>{calls++;}},owner,workspace);
 await store.load(); assert.equal(await store.execute({type:'CREATE_CAMPAIGN',ideaId:idea.id,brief}),false);
 assert.equal(store.getSnapshot().pending,null);assert.equal(calls,0);assert.match(store.getSnapshot().error!,/bandeja/);
});

test('two callers cannot duplicate an active campaign command; remount preserves it and logout ignores its late response',async()=>{
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 const snapshot=emptyCampaignSnapshot(owner,workspace,[idea]);let resolve!:(value:unknown)=>void;let calls=0;
 const store=new RealCampaignStore({read:async()=>snapshot,execute:()=>{calls++;return new Promise(r=>{resolve=r;});}},owner,workspace);
 await store.load(); const action={type:'REVIEW_IDEA' as const,ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true};
 const saving=store.execute(action);const command=store.getSnapshot().pending!;
 const ideas=new RealIdeaStore({findWorkspace:async()=>null,createWorkspace:async()=>{throw new Error('unused');},listIdeas:async()=>[],createIdea:async()=>{throw new Error('unused');}},owner);
 let view!:ReactTestRenderer; await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
 await act(async()=>view.unmount()); await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
 assert.equal(store.getSnapshot().pending,command);assert.equal(store.getSnapshot().phase,'saving');
 assert.equal(await store.execute(action),false);assert.equal(calls,1);
 await act(async()=>store.dispose());const retired=store.getSnapshot();
 resolve(applyCampaignOperation(snapshot,command));assert.equal(await saving,false);assert.equal(store.getSnapshot(),retired);
 assert.equal(await store.execute(action),false); await act(async()=>view.unmount());
});

test('a complete read can prove a CAS command obsolete, but cannot discard an uncertain command at the same version',async()=>{
 let snapshot=emptyCampaignSnapshot(owner,workspace,[idea]);const store=new RealCampaignStore({read:async()=>structuredClone(snapshot),execute:async()=>{throw new Error('uncertain');}},owner,workspace);
 const action={type:'REVIEW_IDEA' as const,ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true};
 await store.load();await store.execute(action);const pending=store.getSnapshot().pending!;
 await store.load();store.reconsider();assert.equal(store.getSnapshot().pending?.operationId,pending.operationId);
 snapshot=applyCampaignOperation(snapshot,operation(snapshot,action));
 await store.load();assert.equal(store.canReconsider(),true);store.reconsider();assert.equal(store.getSnapshot().pending,null);
 assert.match(store.getSnapshot().error!,/no se aplicó/);
});

test('missing receipt retains retries unchanged; incompatible receipts never confirm another operation',async()=>{
 let snapshot=emptyCampaignSnapshot(owner,workspace,[idea]); const commands:CampaignOperation[]=[];
 const store=new RealCampaignStore({read:async()=>structuredClone(snapshot),execute:async c=>{commands.push(structuredClone(c));throw new Error('lost');}},owner,workspace);
 const action={type:'REVIEW_IDEA' as const,ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true};
 await store.load();await store.execute(action);await store.load();await store.retry();assert.deepEqual(commands[0],commands[1]);
 snapshot.receipts=[{operationId:commands[0].operationId,command:{...commands[0],action:{...action,confirmed:false}}}];
 await store.load();assert.equal(store.getSnapshot().phase,'error');assert.equal(store.getSnapshot().confirmedId,null);assert.ok(store.getSnapshot().pending);
});

test('the authenticated owner keeps the same campaign store through refresh and retires it on account change',async()=>{
 let user={id:owner} as User;
 const auth=new AuthStore({getUser:async()=>({data:{user},error:null}),signOut:async()=>({error:null})} as unknown as SupabaseClient['auth']);
 await auth.validate();let calls=0;
 const factory=(id:string)=>{calls++;return new RealCampaignStore({read:async()=>emptyCampaignSnapshot(id,workspace,[idea]),execute:async()=>{throw new Error('unused');}},id,workspace);};
 const current=auth.getRealCampaignStore(workspace,factory);await current.load();await auth.validate();
 assert.equal(auth.getRealCampaignStore(workspace,factory),current);assert.equal(calls,1);
 user={id:'ffffffff-ffff-4fff-8fff-ffffffffffff'} as User;await auth.validate();
 assert.equal(current.getSnapshot().snapshot,null);const next=auth.getRealCampaignStore(workspace,factory);assert.notEqual(next,current);
 await auth.signOut();assert.equal(next.getSnapshot().snapshot,null);assert.throws(()=>auth.getRealCampaignStore(workspace,factory));
});

test('mounted original campaign brief waits for server confirmation and retains its form on a failed write',async()=>{
 Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
 let snapshot=emptyCampaignSnapshot(owner,workspace,[idea]);
 for(const type of ['REVIEW_IDEA','APPROVE_IDEA','HANDOFF_IDEA'] as const) snapshot=applyCampaignOperation(snapshot,operation(snapshot,{type,ideaId:idea.id,expectedUpdatedAt:snapshot.ideas[0].updatedAt,confirmed:true}));
 let finish!:(s:unknown)=>void;let fail!:(e:Error)=>void;let request!:CampaignOperation;
 const store=new RealCampaignStore({read:async()=>snapshot,execute:c=>{request=c;return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});}},owner,workspace);await store.load();
 const ideas=new RealIdeaStore({findWorkspace:async()=>null,createWorkspace:async()=>{throw new Error('unused');},listIdeas:async()=>[],createIdea:async()=>{throw new Error('unused');}},owner);
 let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
 const click=async(label:string)=>{await act(async()=>{view.root.findAllByType('button').find(b=>b.children.join('')===label)!.props.onClick();});};
 await click('Evaluar propuesta');await click('Crear campaña');
 let saving!:Promise<boolean>;await act(async()=>{saving=view.root.findByType(CampaignBriefForm).props.onCreate(brief);});
 assert.equal(store.getSnapshot().phase,'saving');assert.equal(store.getSnapshot().snapshot!.session.campaigns.length,0);
 await act(async()=>{fail(new Error('network failed'));assert.equal(await saving,false);});
 assert.equal(view.root.findAllByType(CampaignBriefForm).length,1);assert.equal(store.getSnapshot().confirmedId,null);
 await act(async()=>{saving=store.retry();});const original=request;
 await act(async()=>{finish(applyCampaignOperation(snapshot,request));assert.equal(await saving,true);});
 assert.equal(request.operationId,original.operationId);assert.equal(store.getSnapshot().snapshot!.session.campaigns.length,1);
 assert.ok(!JSON.stringify(view.toJSON()).includes('Aria Studio Pilot'));await act(async()=>view.unmount());
});

test('idea synchronization retains an uncertain command through queued reads and retries with its original keys', async () => {
 let snapshot=emptyCampaignSnapshot(owner,workspace,[idea]); const commands:CampaignOperation[]=[];
 const reads:Array<{resolve:(s:unknown)=>void;reject:(e:Error)=>void}>=[]; let hold=false;
 const store=new RealCampaignStore({read:async()=>hold?new Promise((resolve,reject)=>reads.push({resolve,reject})):structuredClone(snapshot),
  execute:async c=>{commands.push(structuredClone(c));throw new Error('HTTP lost');}},owner,workspace);
 await store.load(); await store.execute({type:'REVIEW_IDEA',ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true});
 const pending=structuredClone(store.getSnapshot().pending); hold=true;
 const loading=store.load(); void store.synchronizeIdea('new-confirmed-one'); void store.synchronizeIdea('new-confirmed-two');
 void store.synchronizeIdea('new-confirmed-two'); assert.equal(reads.length,1);
 reads[0].resolve(structuredClone(snapshot)); await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(reads.length,2); assert.equal(store.getSnapshot().phase,'loading'); assert.deepEqual(store.getSnapshot().pending,pending);
 reads[1].reject(new Error('canonical read failed')); await loading;
 assert.equal(store.needsSynchronization(),true); assert.equal(store.getSnapshot().phase,'error');
 assert.equal(await store.retry(),false); assert.equal(commands.length,1); assert.deepEqual(store.getSnapshot().pending,pending);
 hold=false; await store.load(); assert.deepEqual(store.getSnapshot().pending,pending);
 await store.retry(); assert.deepEqual(commands[0],commands[1]);
 snapshot=applyCampaignOperation(snapshot,commands[0]); await store.load();
 assert.equal(store.getSnapshot().pending,null); assert.equal(store.getSnapshot().confirmedId,commands[0].operationId);
});

test('synchronization queued during a write runs after its failure and preserves the operation receipt conflict', async () => {
 const snapshot=emptyCampaignSnapshot(owner,workspace,[idea]);let fail!:(e:Error)=>void;let reads=0; let incompatible=false;
 let command!:CampaignOperation;
 const store=new RealCampaignStore({read:async()=>{reads++;return incompatible?{...snapshot,receipts:[{operationId:command.operationId,command:{...command,action:{...command.action,confirmed:false}}}]}:snapshot;},
  execute:c=>{command=c;return new Promise((_resolve,reject)=>{fail=reject;});}},owner,workspace);
 await store.load(); const writing=store.execute({type:'REVIEW_IDEA',ideaId:idea.id,expectedUpdatedAt:idea.updatedAt,confirmed:true});
 const pending=store.getSnapshot().pending; void store.synchronizeIdea('confirmed-other-idea');
 assert.equal(reads,1); assert.equal(store.getSnapshot().phase,'saving');
 incompatible=true; fail(new Error('uncertain')); await writing; await store.load();
 assert.equal(reads,2); assert.equal(store.getSnapshot().pending,pending); assert.equal(store.getSnapshot().confirmedId,null);
 assert.match(store.getSnapshot().error!,/Conflicto verificable/); assert.equal(await store.retry(),false);
});

test('logout discards queued reconciliation and ignores the old read without starting another request', async () => {
 let finish!:(s:unknown)=>void;let reads=0;
 const store=new RealCampaignStore({read:()=>{reads++;return new Promise(resolve=>{finish=resolve;});},execute:async()=>{throw new Error('unused');}},owner,workspace);
 const loading=store.load(); void store.synchronizeIdea('confirmed-before-logout');
 store.dispose(); const retired=store.getSnapshot(); finish(emptyCampaignSnapshot(owner,workspace,[idea])); await loading;
 assert.equal(reads,1); assert.equal(store.getSnapshot(),retired); assert.equal(retired.snapshot,null);
 await store.load(); void store.synchronizeIdea('another-idea'); assert.equal(reads,1);
});
