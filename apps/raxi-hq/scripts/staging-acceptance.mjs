// Opt-in only. Never creates projects, applies migrations or deploys functions.
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { stagingTarget } from './staging-target.mjs';
import { verifyFreshEdgeWrite } from './staging-edge-write.mjs';
import { applyCampaignOperation } from '../../../supabase/functions/_shared/campaign-domain.js';
const target = stagingTarget(process.env); // Validate before any network operation.
if (!process.argv.includes('--run')) throw new Error('Explicit --run required');
const key = process.env.RAXI_STAGING_PUBLISHABLE_KEY;
if (!key?.startsWith('sb_publishable_')) throw new Error('Staging publishable key required');
const required = name => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; };
const request = async (path, token, body, method = 'POST') => {
 const r = await fetch(target.api + path, { method, headers: { apikey:key, ...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)}), signal:AbortSignal.timeout(20000) });
 return r;
};
const ok = async r => { assert.ok(r.ok, `Staging HTTP ${r.status}`); return r.status===204?null:r.json(); };
const login = async suffix => ok(await request('/auth/v1/token?grant_type=password',null,{email:required(`RAXI_STAGING_EMAIL_${suffix}`),password:required(`RAXI_STAGING_PASSWORD_${suffix}`)}));
const a=await login('A'), b=await login('B');
const userA=await ok(await request('/auth/v1/user',a.access_token,undefined,'GET'));
const userB=await ok(await request('/auth/v1/user',b.access_token,undefined,'GET'));
assert.notEqual(userA.id,userB.id); assert.equal(userA.is_anonymous,false); assert.equal(userB.is_anonymous,false);
const rpc=(name,body,token=a.access_token)=>request('/rest/v1/rpc/'+name,token,body);
const workspace=await ok(await rpc('raxi_create_workspace',{}));
const foreign=await rpc('raxi_campaign_snapshot',{p_workspace:workspace.id,p_actor:userA.id},b.access_token); assert.ok(!foreign.ok);
const foreignRows=await ok(await request(`/rest/v1/raxi_agent_tasks?workspace_id=eq.${workspace.id}&select=id`,b.access_token,undefined,'GET')); assert.deepEqual(foreignRows,[]);
const externalId='IDEA-REAL-'+crypto.randomUUID();
const create={workspaceId:workspace.id,externalId,operationId:crypto.randomUUID(),input:{title:'Ensayo aislado '+crypto.randomUUID(),note:'Fixture autorizado del entorno de ensayo; nunca producción.',priority:'MEDIUM'}};
assert.equal((await request('/functions/v1/create-real-idea',null,create)).status,401);
await ok(await request('/functions/v1/create-real-idea',a.access_token,create));
const read=async()=>ok(await rpc('raxi_campaign_snapshot',{p_workspace:workspace.id}));
let snapshot=await read(); const idea=snapshot.ideas.find(i=>i.id===externalId); assert.ok(idea);
const command={workspaceId:workspace.id,operationId:crypto.randomUUID(),expectedVersion:snapshot.version,action:{type:'REVIEW_IDEA',ideaId:externalId,expectedUpdatedAt:idea.updatedAt,confirmed:true}};
const next=applyCampaignOperation(snapshot,command);
const clients=[0,1,2].map(()=>new Client({connectionString:target.database,ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,query_timeout:15000}));
try {
 await Promise.all(clients.map(c=>c.connect())); const [first,second,observer]=clients;
 const pids=await Promise.all(clients.map(c=>c.query('select pg_backend_pid() id'))); assert.equal(new Set(pids.map(r=>r.rows[0].id)).size,3);
 await first.query('begin'); await first.query('set local role service_role');
 await second.query('set role service_role');
 await first.query('select id from public.raxi_workspaces where id=$1 for update',[workspace.id]);
 const args=[userA.id,JSON.stringify(command),JSON.stringify(next)];
 const waiting=second.query('select public.raxi_campaign_commit($1,$2,$3) v',args);
 // Attach rejection immediately; still assert the original promise after releasing the lock.
 void waiting.catch(()=>{});
 let blocked=false;
 for(let attempt=0;attempt<30;attempt++) { const r=await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pids[1].rows[0].id]); if(r.rows[0]?.wait_event_type==='Lock'){blocked=true;break;} await new Promise(r=>setTimeout(r,100)); }
 assert.ok(blocked,'Independent PostgreSQL connection must actually wait on workspace lock');
 await first.query('select public.raxi_campaign_commit($1,$2,$3)',args); await first.query('commit'); await waiting;
 snapshot=await read(); assert.equal(snapshot.version,next.version); assert.equal(snapshot.receipts.filter(r=>r.operationId===command.operationId).length,1);
 const rolled={...command,operationId:crypto.randomUUID(),expectedVersion:snapshot.version,action:{type:'APPROVE_IDEA',ideaId:externalId,expectedUpdatedAt:snapshot.ideas.find(i=>i.id===externalId).updatedAt,confirmed:true}};
 await first.query('begin'); await first.query('set local role service_role');
 await first.query('select public.raxi_campaign_commit($1,$2,$3)',[userA.id,JSON.stringify(rolled),JSON.stringify(applyCampaignOperation(snapshot,rolled))]); await first.query('rollback');
 assert.equal((await read()).version,snapshot.version); assert.ok(!(await read()).receipts.some(r=>r.operationId===rolled.operationId));
 // New operation: neither the concurrency command nor the rolled-back command can prove Edge writes.
 const edgeCommand={workspaceId:workspace.id,operationId:crypto.randomUUID(),expectedVersion:snapshot.version,
  action:{type:'APPROVE_IDEA',ideaId:externalId,expectedUpdatedAt:snapshot.ideas.find(i=>i.id===externalId).updatedAt,confirmed:true}};
 snapshot=await verifyFreshEdgeWrite({read,send:body=>request('/functions/v1/campaign-command',a.access_token,body),command:edgeCommand});
 await ok(await request('/auth/v1/logout',a.access_token,{})); const again=await login('A');
 assert.equal((await ok(await rpc('raxi_campaign_snapshot',{p_workspace:workspace.id},again.access_token))).ideas.find(i=>i.id===externalId).status,'APPROVED_FOR_HQ');
 console.log(JSON.stringify({suite:'ISOLATED_STAGING',auth:true,rls:true,crossAccountDenied:true,independentConnections:3,lockContention:true,freshEdgeWrite:true,idempotency:true,rollback:true,recovery:true,productionTouched:false}));
} finally { await Promise.allSettled(clients.map(async c=>{try{await c.query('rollback');}finally{await c.end();}})); }
