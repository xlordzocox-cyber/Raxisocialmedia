import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StrictMode,useSyncExternalStore} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {humanAttention,type HumanAttentionContext} from '../src/operations/humanAttentionSelectors';
import {HumanAttentionPanel} from '../src/operations/HumanAttentionPanel';
import {RealCampaignCenter} from '../src/persistence/RealCampaignCenter';
import {RealCampaignStore,type RealCampaignState} from '../src/persistence/realCampaignStore';
import {RealIdeaStore} from '../src/persistence/realIdeaStore';
import {CampaignWorkspace} from '../src/campaigns/CampaignWorkspace';
import {emptyCampaignSnapshot,parseCampaignSnapshot} from '../src/persistence/campaignCommands';
import {attentionFixture,attentionOwner as owner,attentionWorkspace as workspace} from './humanAttentionFixture';
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const context:HumanAttentionContext={ownerId:owner,workspaceId:workspace,mode:'REAL',synchronized:true,ideasReady:true,ideaPending:false};
const state=():RealCampaignState=>({phase:'ready',snapshot:attentionFixture(),pending:null,error:null,confirmedId:null});
test('fixture is admitted through the canonical parser; pure summary has two categories and no mutation',()=>{
  const s=state();parseCampaignSnapshot(s.snapshot,owner,workspace);const before=JSON.stringify(s),view=humanAttention(s,context);
  assert.equal(view.available,true);assert.deepEqual(view.items.map(i=>i.kind),['proposal','strategy']);assert.equal(JSON.stringify(s),before);assert.deepEqual(view.warnings,[]);
});
test('confirmed empty REAL differs from an unconfirmed read',()=>{
  const s={...state(),snapshot:emptyCampaignSnapshot(owner,workspace)};assert.deepEqual(humanAttention(s,context),{available:true,items:[],warnings:[]});assert.equal(humanAttention({...s,snapshot:null},context).available,false);
});
for(const phase of ['unavailable','loading','saving','error'] as const)test(`phase ${phase} cannot expose a stale list or confirmed zero`,()=>{const v=humanAttention({...state(),phase},context);assert.equal(v.available,false);assert.equal(v.items.length,0);});
for(const patch of [{mode:'DEMO' as const},{ownerId:'other'},{workspaceId:'other'},{ownerId:undefined},{synchronized:false},{ideaPending:true},{ideasReady:false}])test(`context gate ${JSON.stringify(patch)} is fail closed`,()=>{assert.equal(humanAttention(state(),{...context,...patch}).available,false);});
test('pending command without receipt and errors cannot expose matters',()=>{
  const s=state();s.pending={workspaceId:workspace,operationId:'pending',expectedVersion:0,action:{type:'REJECT_PROPOSAL',ideaId:'missing',reason:'No'}};
  assert.equal(humanAttention(s,context).available,false);assert.equal(humanAttention({...state(),error:'conflict'},context).available,false);
});
for(const status of ['ACCEPTED','REJECTED'] as const)test(`proposal with ${status} does not become a pending approval`,()=>{
  const s=state();s.snapshot!.session.decisions.push({ideaId:s.snapshot!.handoffs[0].handoff.ideaId,status});assert.equal(humanAttention(s,context).items.filter(i=>i.kind==='proposal').length,0);
});
for(const bad of ['handoff','idea','decision','campaign','campaign-source','campaign-no-decision','non-real','missing-idea'] as const)test(`ambiguous ${bad} never selects an arbitrary proposal`,()=>{
  const s=state(),snap=s.snapshot!,id=snap.handoffs[0].handoff.ideaId;
  if(bad==='handoff')snap.handoffs.push(structuredClone(snap.handoffs[0]));
  if(bad==='idea')snap.ideas.push(structuredClone(snap.ideas[0]));
  if(bad==='decision')snap.session.decisions.push({ideaId:id,status:'PENDING'},{ideaId:id,status:'REJECTED'});
  if(bad==='campaign-no-decision')snap.session.campaigns[0].sourceIdeaId=id;
  if(bad==='campaign-source')snap.session.campaigns.push({...snap.session.campaigns[0],id:'OTHER',sourceIdeaId:id},{...snap.session.campaigns[0],id:'OTHER2',sourceIdeaId:id});
  if(bad==='campaign'){snap.session.campaigns.push({...snap.session.campaigns[0]});snap.session.campaigns[0].sourceIdeaId=id;}
  if(bad==='non-real')snap.handoffs[0].provenance='MOCK';if(bad==='missing-idea')snap.ideas.shift();
  const v=humanAttention(s,context);assert.equal(v.items.some(i=>i.id===id),false);assert.ok(v.warnings.length);
});
for(const status of ['DRAFT','APPROVED','CHANGES_REQUESTED'] as const)test(`Strategy ${status} excluded`,()=>{const s=state();s.snapshot!.session.strategies[0].status=status;assert.equal(humanAttention(s,context).items.some(i=>i.kind==='strategy'),false);});
for(const status of ['BLOCKED','CANCELED','DRAFT'] as const)test(`campaign ${status} excluded`,()=>{const s=state();s.snapshot!.session.campaigns[0].status=status;assert.equal(humanAttention(s,context).items.some(i=>i.kind==='strategy'),false);});
for(const bad of ['duplicate','obsolete','order','orphan','decision','handoff-date'] as const)test(`inconsistent Strategy ${bad} cannot win by array position`,()=>{
  const s=state(),snap=s.snapshot!,r=snap.session.strategies[0];
  if(bad==='duplicate')snap.session.strategies.push({...r});if(bad==='obsolete')snap.session.strategies.push({...r,revision:2,status:'DRAFT'});
  if(bad==='order')snap.session.strategies.unshift({...r,revision:2});if(bad==='orphan')r.campaignId='other';
  if(bad==='decision')snap.session.decisions[0].campaignId='other';if(bad==='handoff-date')snap.session.campaigns[0].sourceHandoffSentAt='other';
  assert.equal(humanAttention(s,context).items.some(i=>i.kind==='strategy'),false);
});
function button(view:ReactTestRenderer,label:string){return view.root.findAllByType('button').find(b=>b.children.join('')===label)!;}
test('two decisions cannot claim the same campaign; dangling decisions remain explicit warnings',()=>{
  const s=state(),snap=s.snapshot!;snap.session.decisions.push({ideaId:snap.ideas[0].id,status:'ACCEPTED',campaignId:snap.session.campaigns[0].id});
  assert.equal(humanAttention(s,context).items.some(i=>i.kind==='strategy'),false);
  snap.session.decisions.push({ideaId:'missing',status:'REJECTED'});assert.ok(humanAttention(s,context).warnings.some(w=>w.includes('Decisión missing')));
});
async function setup(){
  let reads=0,writes=0;const snapshot=attentionFixture();
  const ideas=new RealIdeaStore({findWorkspace:async()=>({id:workspace,ownerId:owner,name:'raxi-hq'}),createWorkspace:async()=>{throw Error('forbidden');},listIdeas:async()=>[],createIdea:async()=>{writes++;throw Error('forbidden');}},owner);
  await ideas.load();const store=new RealCampaignStore({read:async()=>{reads++;return structuredClone(snapshot);},execute:async()=>{writes++;throw Error('forbidden');}},owner,workspace);await store.load();
  return {ideas,store,counts:()=>({reads,writes})};
}
test('mounted StrictMode navigation opens original proposal/Strategy without preparing any command or network call',async()=>{
  const {ideas,store,counts}=await setup();let view!:ReactTestRenderer;await act(async()=>{view=create(<StrictMode><RealCampaignCenter store={store} ideas={ideas}/></StrictMode>);});
  const before=counts();await act(async()=>button(view,'Ver propuesta').props.onClick());
  assert.equal(view.root.findAll(n=>n.props.className==='operations-evaluation').length,0);
  await act(async()=>button(view,'Revisar estrategia').props.onClick());
  assert.ok(view.root.findAll(n=>n.props['aria-label']==='Campaign Workspace').length);assert.deepEqual(counts(),before);assert.equal(store.getSnapshot().pending,null);
  await act(async()=>view.unmount());
});
test('mounted stale navigation closure after invalidation cannot prepare a command or select an old issue',async()=>{
  const {ideas,store,counts}=await setup();let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
  const stale=button(view,'Revisar estrategia').props.onClick;await act(async()=>store.dispose());await act(async()=>stale());
  assert.equal(view.root.findAllByType(HumanAttentionPanel)[0].props.view.available,false);assert.equal(counts().writes,0);assert.equal(store.getSnapshot().pending,null);await act(async()=>view.unmount());
});
test('mounted account/workspace changes hide previous canonical matters without using office data',async()=>{
  const {ideas,store}=await setup();let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});
  for(const workspacePatch of [{ownerId:'other'},{id:'other'}]){await act(async()=>view.update(<RealCampaignCenter store={store} ideas={ideas} ideaState={{...ideas.getSnapshot(),workspace:{...ideas.getSnapshot().workspace!,...workspacePatch}}}/>));assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,false);}
  await act(async()=>view.unmount());
});
test('late canonical read after retired account never repopulates mounted attention',async()=>{
  let resolve!:(value:unknown)=>void;const {ideas}=await setup();const store=new RealCampaignStore({read:()=>new Promise(r=>{resolve=r;}),execute:async()=>{throw Error('forbidden');}},owner,workspace);
  const loading=store.load();let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});await act(async()=>store.dispose());await act(async()=>{resolve(attentionFixture());await loading;});
  assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,false);assert.equal(store.getSnapshot().snapshot,null);await act(async()=>view.unmount());
});
test('a new canonical read hides prior matters, then restores only confirmed results; obsolete click is inert',async()=>{
  const {ideas}=await setup();let reads=0,resolve!:(value:unknown)=>void;
  const store=new RealCampaignStore({read:async()=>++reads===1?attentionFixture():new Promise(r=>{resolve=r;}),execute:async()=>{throw Error('forbidden');}},owner,workspace);await store.load();
  let view!:ReactTestRenderer;await act(async()=>{view=create(<RealCampaignCenter store={store} ideas={ideas}/>);});const stale=button(view,'Revisar estrategia').props.onClick;
  let loading!:Promise<void>;await act(async()=>{loading=store.load();});assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,false);
  await act(async()=>{const next=attentionFixture();next.version++;resolve(next);await loading;});assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,true);
  await act(async()=>stale());assert.equal(view.root.findByType(CampaignWorkspace).props.selectedId,undefined);await act(async()=>view.unmount());
});
test('uncertain idea write invalidates attention through the existing parent idea subscription',async()=>{
  const {ideas,store}=await setup();function Parent(){const ideaState=useSyncExternalStore(ideas.subscribe,ideas.getSnapshot,ideas.getSnapshot);return <RealCampaignCenter store={store} ideas={ideas} ideaState={ideaState}/>;}
  let view!:ReactTestRenderer;await act(async()=>{view=create(<StrictMode><Parent/></StrictMode>);});assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,true);
  await act(async()=>{await ideas.save({title:'Idea sintética incierta',note:'Prueba local de fallo sin confirmación',priority:'MEDIUM'});});
  assert.equal(ideas.hasPendingWrite(),true);assert.equal(view.root.findByType(HumanAttentionPanel).props.view.available,false);await act(async()=>view.unmount());
});
