// Meta A — NATIVE PG17 CAS lock contention, two independent PostgreSQL connections.
// OFFLINE, synthetic data only. Does not create Docker containers or touch hosted Supabase.
// Run only after explicit operator inspection; not part of npm test or automatic workflows.
import {execFileSync, spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const ID='f8e8d43f6eac5b6ae2216e7272613d70b14fb53cebec6fdbf02c85f799481168';
const IMAGE='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const DB='raxi_campaign_qa';
const OWNER='11111111-1111-4111-8111-111111111111';
const WS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOCKER=['exec','-i'];
const psqlArgs=(app)=>[...DOCKER,'-e',`PGAPPNAME=${app}`,ID,'psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',DB,'-h','/var/run/postgresql'];

function docker(args) {return execFileSync('docker',args,{encoding:'utf8',timeout:12000,windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
function guardedLab() {
 const x=JSON.parse(docker(['inspect','--type=container',ID,'--format',
   '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"privileged":{{json .HostConfig.Privileged}},"mounts":{{json .Mounts}},"tmpfs":{{json .HostConfig.Tmpfs}}}']));
 assert.equal(x.id,ID);assert.equal(x.image,IMAGE);assert.equal(x.running,true);
 assert.equal(x.network,'none');assert.equal(x.privileged,false);
 assert.equal((x.mounts??[]).length,0);assert.equal(Object.keys(x.ports??{}).length,0);
 assert.deepEqual(Object.keys(x.tmpfs??{}),['/var/lib/postgresql/data']);
 assert.match(x.tmpfs['/var/lib/postgresql/data'],/(^|,)size=512m(,|$)/);
}
function query(sql) {return docker([...psqlArgs('meta_a_guard').slice(0,2),...psqlArgs('meta_a_guard').slice(2),'-c',sql]);}
function startSession(app,sql) {
 const cp=spawn('docker',psqlArgs(app),{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',error='',closed=false,exitCode;
 let onData=()=>{};
 cp.stdout.on('data',b=>{output+=b.toString();onData();});
 cp.stderr.on('data',b=>{error+=b.toString();});
 const done=new Promise((resolve,reject)=>{
   cp.on('error',reject);
   cp.on('close',code=>{closed=true;exitCode=code;if(code===0)resolve(output);else reject(Error(`Local psql ${app} failed (exit ${code}): ${error.slice(0,250)}`));});
 });
 cp.stdin.end(sql+'\n');
 const marker=(value,ms=4000)=>new Promise((resolve,reject)=>{
   if(output.includes(value))return resolve();
   const t=setTimeout(()=>{onData=()=>{};reject(Error(`Missing ${app} marker ${value}`));},ms);
   onData=()=>{if(output.includes(value)){clearTimeout(t);onData=()=>{};resolve();}};
 });
 return {done,marker,get closed(){return closed;},get exitCode(){return exitCode;},kill(){cp.kill();}};
}
const identity=`select current_database()||'|'||current_user||'|'||current_setting('server_version_num')||'|'||coalesce(inet_server_addr()::text,'LOCAL');`;
const workspacePredicate=`id='${WS}'::uuid`;
const baseline=`select 'tables='||count(*) from pg_tables where schemaname='public' and tablename like 'raxi_%';
select 'users='||count(*) from auth.users;
select 'workspaces='||count(*) from public.raxi_workspaces;
select 'rpc='||(to_regprocedure('public.raxi_campaign_commit(uuid,jsonb,jsonb)') is not null);`;
const expected=`raxi_campaign_qa|postgres|170011|LOCAL\ntables=18\nusers=0\nworkspaces=0\nrpc=true`;

let prepared=false, a=null, b=null, completed=false;
try {
 guardedLab();
 assert.equal(query(identity+baseline),expected,'Laboratory must be clean before fixture insertion');
 const setup=`BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'raxi_campaign_qa' OR current_user<>'postgres' OR
 current_setting('server_version_num')::int<>170011 OR inet_server_addr() IS NOT NULL
 OR (select count(*) from public.raxi_workspaces)<>0 OR (select count(*) from auth.users)<>0
 THEN RAISE EXCEPTION 'LAB_ONLY'; END IF;
END $guard$;
INSERT INTO auth.users(id) VALUES ('${OWNER}');
INSERT INTO public.raxi_workspaces(id,owner_user_id,slug,name) VALUES ('${WS}','${OWNER}','cas-race','CAS Race');
COMMIT;`;
 query(setup);prepared=true;
 console.log('PASS: isolated synthetic workspace fixture created');
 // Conn A intentionally updates only the version while holding the same row lock used
 // by raxi_campaign_commit. This tests CAS lock serialization, not two successful RPCs.
 a=startSession('meta_a_cas_winner',`BEGIN;
UPDATE public.raxi_workspaces SET campaign_version=1 WHERE ${workspacePredicate} AND campaign_version=0;
SELECT 'LOCK_HELD';
SELECT pg_sleep(8);
COMMIT;
SELECT 'WINNER_COMMITTED';`);
 await a.marker('LOCK_HELD',4500);
 b=startSession('meta_a_cas_loser',`SET ROLE service_role;
DO $test$
DECLARE errcode text; command jsonb; proposed jsonb;
BEGIN
 command:=jsonb_build_object('workspaceId','${WS}','operationId','22222222-2222-4222-8222-222222222222','expectedVersion',0,
   'action',jsonb_build_object('type','REVIEW_IDEA','ideaId','IDEA-REAL-NOT-EXISTING'));
 proposed:=jsonb_build_object('workspaceId','${WS}','ownerId','${OWNER}','version',1,'ideas','[]'::jsonb,'handoffs','[]'::jsonb,
   'session',jsonb_build_object('campaigns','[]'::jsonb,'strategies','[]'::jsonb,'decisions','[]'::jsonb,'audit','[]'::jsonb));
 BEGIN
   PERFORM public.raxi_campaign_commit('${OWNER}',command,proposed);
   RAISE EXCEPTION 'UNEXPECTED_RPC_SUCCESS';
 EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS errcode=RETURNED_SQLSTATE;
   IF errcode<>'40001' THEN RAISE EXCEPTION 'Expected stale CAS 40001; got %',errcode; END IF;
 END;
 RAISE NOTICE 'PASS: independent RPC connection rejected stale CAS 40001';
END $test$;
SELECT 'LOSER_REJECTED';`);
 let lockSeen=false;
 for(let i=0;i<25;i++){
   await new Promise(resolve=>setTimeout(resolve,120));
   if(query(`SELECT count(*) FROM pg_stat_activity WHERE application_name='meta_a_cas_loser' AND wait_event_type='Lock';`)==='1'){lockSeen=true;break;}
   if(b.closed)break;
 }
 assert.ok(lockSeen,'No simultaneous row-lock wait observed; cannot claim concurrency PASS');
 const [aOut,bOut]=await Promise.all([a.done,b.done]);
 assert.match(aOut,/WINNER_COMMITTED/);assert.match(bOut,/LOSER_REJECTED/);
 assert.equal(query(`SELECT campaign_version||'|'||(SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id='${WS}') FROM public.raxi_workspaces WHERE ${workspacePredicate};`),'1|0');
 console.log('PASS: two PostgreSQL sessions overlapped on a real row lock');
 console.log('PASS: loser returned stale CAS 40001 after winner committed');
 console.log('PASS: no campaign audit or approval fabricated');
 completed=true;
} catch(e) {
 console.error('FAIL: native PG17 concurrency NOT VERIFIED:',e.message);
 process.exitCode=1;
} finally {
 // No blanket delete. Refuse cleanup while sessions could still be active.
 if(a&&!a.closed||b&&!b.closed) {
   console.error('Cleanup BLOCKED: a lab session is active; inspect before deleting synthetic rows');
   process.exitCode=1;
 } else if(prepared) {
   try {
     guardedLab();
     const receiptCount=query(`SELECT count(*) FROM public.raxi_audit_events WHERE workspace_id='${WS}';`);
     const approvalCount=query(`SELECT count(*) FROM public.raxi_approvals WHERE workspace_id='${WS}';`);
     assert.equal(receiptCount,'0');assert.equal(approvalCount,'0');
     query(`BEGIN;
DO $guard$ BEGIN
 IF current_database()<>'raxi_campaign_qa' OR current_setting('server_version_num')::int<>170011
 OR (SELECT count(*) FROM public.raxi_workspaces)<>1 OR
 (SELECT count(*) FROM auth.users)<>1
 THEN RAISE EXCEPTION 'LAB_ONLY cleanup target changed'; END IF;
END $guard$;
DELETE FROM public.raxi_workspaces WHERE id='${WS}' AND owner_user_id='${OWNER}';
DELETE FROM auth.users WHERE id='${OWNER}';
COMMIT;`);
     assert.equal(query(identity+baseline),expected,'Postflight fixture cleanup mismatch');
     console.log('PASS: exact synthetic fixture removed; 0 users/workspaces remain');
   } catch(e) {
     console.error('FAIL: cleanup needs operator review:',e.message);
     process.exitCode=1;
   }
 }
 if(!completed)console.error('NO_GO: native concurrency case not established');
}
