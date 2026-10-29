// PR35 opt-in native committed journal recovery after simulated lost client confirmation; no provider calls.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {assertBootstrapIntegrity} from './pr35-bootstrap-guard.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const die=s=>{throw Error(s)};
const sh=(args,input)=>{
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)die('docker '+args.slice(0,2).join(' ')+' failed: '+String(r.stderr||r.error).slice(0,600));
 return r.stdout.trim();
};
const manifest=JSON.parse(readFileSync(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
if(manifest.executionReady!==false||Object.values(manifest.authorizations||{}).some(v=>v!==false))die('STOP: hosted authorizations changed');
const requiredFlags=['applySql','runB2','deploy','createUsers','realProviders','additionalSpend'];
if(!manifest.authorizations||typeof manifest.authorizations!=='object'||Array.isArray(manifest.authorizations)||
 requiredFlags.some(k=>!Object.hasOwn(manifest.authorizations,k)||manifest.authorizations[k]!==false)||
 Object.keys(manifest.authorizations).length!==requiredFlags.length)die('STOP: hosted authorization flags missing or changed');
const expectedPaths=[
 'supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql',
 'supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql',
 'supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql',
 'supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql',
 'supabase/proposals/agent_runtime.sql',
 'supabase/proposals/supervised_host_stage_a.sql',
 'supabase/proposals/supervised_host_stage_b.sql'
];
const steps=manifest.applicationPlan.steps;
if(steps.length!==7||steps.some((s,i)=>s.order!==i+1||s.path!==expectedPaths[i])||steps.filter(s=>s.kind==='BASE_MIGRATION').length!==4||steps.filter(s=>s.kind==='RUNTIME_PROPOSAL').length!==3)die('STOP: unexpected SQL source plan');
const sources=steps.map(step=>{
 if(!/^supabase\/(migrations|proposals)\/[\w-]+\.sql$/.test(step.path))die('STOP: unexpected SQL path');
 const sql=readFileSync(resolve(root,step.path),'utf8');
 const digest=createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
 if(digest!==step.sha256Lf)die('STOP: SQL source digest mismatch '+step.id);
 return {id:step.id,sql};
});
const bootstrap=readFileSync(resolve(root,'supabase/tests/pg17-bootstrap.sql'),'utf8');
assertBootstrapIntegrity(bootstrap);
console.log('PASS: seven ordered source SHA256 hashes, bootstrap present, hosted authorizations false.');
if(process.argv.length!==3||process.argv[2]!=='--run-local'){
 console.log('PRECHECK ONLY: no Docker called. For isolated native PG17 run, supply --run-local.');
 process.exit(0);
}
const image='postgres:17',name='raxi-pr35-'+randomBytes(6).toString('hex');
let id=null;
try{
 sh(['image','inspect',image,'--format','{{.Id}}']);
 const existing=sh(['ps','-aq','--filter','name=^/'+name+'$']);
 if(existing)die('STOP: container name already exists');
 id=sh(['run','-d','--rm','--pull=never','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 if(!/^[a-f0-9]{64}$/.test(id))die('STOP: invalid new Docker ID');
 const inspected=JSON.parse(sh(['inspect',id,'--format','{{json .}}']));
 if(inspected.Name!=='/'+name||inspected.Id!==id||inspected.HostConfig.NetworkMode!=='none'||Object.keys(inspected.HostConfig.PortBindings||{}).length||inspected.HostConfig.Privileged)die('STOP: container isolation violation');
 let ready=false;
 for(let i=0;i<40;i++){
  const r=spawnSync('docker',['exec',id,'pg_isready','-U','postgres','-d','postgres'],{encoding:'utf8',timeout:5000});
  if(r.status===0){ready=true;break;}
  await new Promise(done=>setTimeout(done,500));
 }
 if(!ready)die('STOP: local postgres did not become ready');
 const sql=(body)=>sh(['exec','-i',id,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],body);
 const version=sql("select current_setting('server_version_num')::integer / 10000;").split('\n').filter(x=>/^\s*17\s*$/.test(x));
 if(!version.length)die('STOP: not PostgreSQL 17');
 sql(bootstrap);
 for(const s of sources){sql(s.sql);console.log('LOADED VERIFIED SOURCE: '+s.id);}



 // Fixture lives ONLY in a uniquely named, networkless, disposable local PG17 instance.
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const workspace='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const taskKey='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const approvalKey='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const runScalar=(statement)=>sh(['exec','-i',id,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],statement).trim();
 sql(`insert into auth.users(id) values ('${owner}');
 insert into public.raxi_workspaces(id,owner_user_id,slug,name)
 values ('${workspace}','${owner}','pr35-recovery','PR35 RECOVERY');
 insert into public.raxi_runtime_policies
 (workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at)
 values ('${workspace}',true,true,'simulated','fixture-model',100,10,8,clock_timestamp()+interval '1 hour');`);
 const setup=sql(`begin;
 set local role service_role;
 do $pr35$
 declare spec jsonb; t jsonb; approved jsonb; claimed jsonb; digest text;
 begin
  spec:=jsonb_build_object('question','Local fixture confirmation recovery only',
   'externalResearch',false,'provider','simulated','model','fixture-model',
   'authorization',jsonb_build_object('confirmed',true,'maxCostMicros',10,
   'expiresAt',to_char(clock_timestamp()+interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  t:=public.raxi_supervised_prepare('${owner}'::uuid,'${workspace}'::uuid,
    '${taskKey}'::uuid,'DIRECTOR',spec,spec::text,null);
  if t->>'status'<>'WAITING_APPROVAL' then raise exception 'prepare not awaiting approval'; end if;
  digest:=t#>>'{input_snapshot,supervised,scopeDigest}';
  approved:=public.raxi_supervised_approve('${owner}'::uuid,(t->>'id')::uuid,
     '${approvalKey}'::uuid,digest,false);
  if approved->>'status'<>'QUEUED' then raise exception 'approval did not queue'; end if;
  claimed:=public.raxi_runtime_claim((t->>'id')::uuid,'PR35-RECOVERY');
  if claimed is null or claimed#>>'{run,lease_token}' is null then
    raise exception 'approved task not claimed'; end if;
 end $pr35$;
 commit;`);
 if(!setup.includes('DO')||!setup.includes('COMMIT'))die('STOP: committed preparation not confirmed');
 const identity=runScalar(`select t.id::text||'|'||r.id::text||'|'||r.lease_token::text
 from public.raxi_agent_tasks t join public.raxi_agent_runs r on r.task_id=t.id
 where t.workspace_id='${workspace}'::uuid and r.stage='DIRECTOR';`);
 const parts=identity.split('|');
 if(parts.length!==3||parts.some(v=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)))
  die('STOP: committed task/run/lease identity invalid');
 const [taskId,runId,token]=parts;
 const receipt='SIMULATED:'+runId;
 const resultJson='{"simulated":true,"answer":"Local synthetic fixture"}';
 // Each step uses an independent psql process and a separate committed transaction.
 const invoke=(kind,version,result,receiptValue,cost,expectedStatus)=>{
  const operation=runId+':'+kind;
  const call=`public.raxi_supervised_step('${owner}'::uuid,'${runId}'::uuid,
   '${token}'::uuid,'${operation}',${version},'${kind}',${result},${receiptValue},${cost})`;
  const committed=sql(`begin;
  set local role service_role;
  do $pr35$
  declare confirmation jsonb;
  begin
   confirmation:=${call};
   if confirmation->>'status' is distinct from '${expectedStatus}'
     or confirmation->>'journal_version' is distinct from '${version+1}'
     then raise exception 'journal confirmation mismatch: ${kind}'; end if;
  end $pr35$;
  commit;`);
  if(!committed.includes('DO')||!committed.includes('COMMIT'))
   die('STOP: journal step did not commit: '+kind);
 };
 invoke('dispatch',0,'null','null','null','CLAIMED');
 invoke('ack',1,'null',"'"+receipt+"'",'null','RUNNING');
 // The server commits finish but the client deliberately does NOT receive the
 // JSON confirmation: DO discards it. A new psql process must recover it.
 invoke('finish',2,"'"+resultJson+"'::jsonb","'"+receipt+"'",'0','SUCCEEDED');
 const persisted=runScalar(`select
   (select count(*) from public.raxi_agent_events
     where task_id='${taskId}'::uuid and event_type='SUPERVISED_LOCAL_JOURNAL')::text
   ||'|'||
   (select count(*) from public.raxi_agent_runs where task_id='${taskId}'::uuid)::text
   ||'|'||
   (select journal_version::text from public.raxi_agent_runs where id='${runId}'::uuid)
   ||'|'||
   (select status from public.raxi_agent_runs where id='${runId}'::uuid);`);
 if(persisted!=='3|1|3|SUCCEEDED')die('STOP: completed journal not durable after client exit: '+persisted);
 const recovered=sql(`begin;
 set local role service_role;
 do $pr35$
 declare original jsonb; replay jsonb; changed jsonb; n integer;
 begin
  select payload->'confirmation' into original from public.raxi_agent_events
   where task_id='${taskId}'::uuid
    and source_ref='SUPERVISED_JOURNAL:${runId}:finish';
  if original is null then raise exception 'committed confirmation missing'; end if;
  replay:=public.raxi_supervised_step('${owner}'::uuid,'${runId}'::uuid,
   '${token}'::uuid,'${runId}:finish',2,'finish',
   '${resultJson}'::jsonb,'${receipt}',0);
  if replay is distinct from original or replay->>'journal_version' is distinct from '3'
   then raise exception 'recovery failed to return committed confirmation'; end if;
  begin
   changed:=public.raxi_supervised_step('${owner}'::uuid,'${runId}'::uuid,
    '${token}'::uuid,'${runId}:finish',2,'finish',
    '{"simulated":true,"answer":"TAMPERED"}'::jsonb,'${receipt}',0);
   raise exception 'altered recovery replay was accepted';
  exception when others then
   if SQLERRM<>'journal idempotency conflict' then raise; end if;
  end;
  select count(*) into n from public.raxi_agent_events
   where task_id='${taskId}'::uuid and event_type='SUPERVISED_LOCAL_JOURNAL';
  if n<>3 then raise exception 'recovery appended duplicate journal'; end if;
  select count(*) into n from public.raxi_agent_events
   where task_id='${taskId}'::uuid and event_type='RUNTIME_RESULT_COMMITTED';
  if n<>1 then raise exception 'recovery committed duplicate finish'; end if;
  select count(*) into n from public.raxi_agent_events
   where task_id='${taskId}'::uuid and event_type='RUNTIME_ACKNOWLEDGED';
  if n<>1 then raise exception 'recovery committed duplicate acknowledgment'; end if;
  select count(*) into n from public.raxi_agent_runs where task_id='${taskId}'::uuid;
  if n<>1 then raise exception 'recovery created second run'; end if;
  if (select reserved_micros from public.raxi_runtime_policies
    where workspace_id='${workspace}'::uuid)<>10
   then raise exception 'recovery duplicated budget reservation'; end if;
  if (select status from public.raxi_agent_tasks where id='${taskId}'::uuid)<>'COMPLETED'
   then raise exception 'completed task status lost'; end if;
  if exists(select 1 from public.raxi_agent_runs where task_id='${taskId}'::uuid and stage='RESEARCHER')
   then raise exception 'unexpected automatic researcher stage'; end if;
 end $pr35$;
 commit;`);
 if(!recovered.includes('DO')||!recovered.includes('COMMIT'))die('STOP: recovered replay not confirmed');
 console.log('PASS: PR35_NATIVE_COMMITTED_CONFIRMATION_RECOVERY: committed finish survived client disconnect; fresh psql recovered exact journal confirmation; altered replay denied; one run, one reservation, one ack and one finish; no automatic RESEARCHER.');
 console.log('LIMITS: controlled dropped client confirmation after COMMIT; no OS crash/network outage, no server restart, no provider call, no native JS adapter and no hosted Auth.');
}finally{
 if(id){
  const probe=spawnSync('docker',['inspect',id,'--format','{{.Name}}|{{.Id}}'],{encoding:'utf8',timeout:10000});
  if(probe.status===0&&probe.stdout.trim()==='/'+name+'|'+id){
   const removal=spawnSync('docker',['rm','-f',id],{encoding:'utf8',timeout:30000});
   if(removal.status!==0){process.exitCode=1;console.error('CLEANUP FAILED; inspect exact test container ID:',id);}
   else console.log('CLEANUP PASS: removed only PR35 disposable container.');
  }else {process.exitCode=1;console.error('CLEANUP STOP: container identity differs; manual inspection required.');}
 }
}
