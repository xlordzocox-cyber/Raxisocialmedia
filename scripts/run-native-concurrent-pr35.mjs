// PR35 opt-in local PG17 independent-session claim race; no external providers.
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


 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',foreign='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const workspace='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const taskKey='dddddddd-dddd-4ddd-8ddd-dddddddddddd',approvalKey='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 sql(`insert into auth.users(id) values ('${owner}'),('${foreign}');
 insert into public.raxi_workspaces(id,owner_user_id,slug,name) values ('${workspace}','${owner}','pr35-native','PR35 NATIVE');
 insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at)
 values ('${workspace}',true,true,'simulated','fixture-model',100,10,8,clock_timestamp()+interval '1 hour');`);

 const prep=sql(`begin;
 set local role service_role;
 do $pr35$
 declare spec jsonb; t jsonb; approved jsonb; digest text;
 begin
  spec:=jsonb_build_object('question','Compare local fixture notes only','externalResearch',false,
   'provider','simulated','model','fixture-model',
   'authorization',jsonb_build_object('confirmed',true,'maxCostMicros',10,
   'expiresAt',to_char(clock_timestamp()+interval '10 minutes','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  t:=public.raxi_supervised_prepare('${owner}'::uuid,'${workspace}'::uuid,'${taskKey}'::uuid,'DIRECTOR',spec,spec::text,null);
  digest:=t#>>'{input_snapshot,supervised,scopeDigest}';
  if t->>'status'<>'WAITING_APPROVAL' then raise exception 'prepare failed'; end if;
  begin
   perform public.raxi_supervised_approve('${foreign}'::uuid,(t->>'id')::uuid,'${approvalKey}'::uuid,digest,false);
   raise exception 'foreign approval accepted';
  exception when others then
   if SQLERRM <> 'owner or scope denied' then raise; end if;
  end;
  approved:=public.raxi_supervised_approve('${owner}'::uuid,(t->>'id')::uuid,'${approvalKey}'::uuid,digest,false);
  if approved->>'status'<>'QUEUED' then raise exception 'approve failed'; end if;
 end $pr35$;
 commit;`);
 if(!prep.includes('DO'))die('STOP: preparation and approval checks did not run');
 const taskId=sql(`select id from public.raxi_agent_tasks where external_id='SUPERVISED-${taskKey}';`).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0];
 if(!taskId)die('STOP: committed task ID missing');
 const {spawn}=await import('node:child_process');
 const claim=(worker)=>new Promise((resolve,reject)=>{
   const command=`begin; set local role service_role;
     select coalesce((public.raxi_runtime_claim('${taskId}'::uuid,'${worker}') is not null)::text,'false'); commit;`;
   const child=spawn('docker',['exec','-i',id,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',error='';
   child.stdout.on('data',v=>output+=v.toString());
   child.stderr.on('data',v=>error+=v.toString());
   child.on('error',reject);
   child.on('close',code=>code===0?resolve(output.trim()):reject(Error('claim process failed: '+error.slice(0,250))));
   child.stdin.end(command);
 });
 const outcomes=await Promise.all([claim('PR35-RACE-A'),claim('PR35-RACE-B')]);
 if(outcomes.filter(x=>x==='true').length!==1||outcomes.filter(x=>x==='false').length!==1)
   die('STOP: two-session claims did not produce exactly one winner: '+JSON.stringify(outcomes));
 const check=sql(`do $pr35$
 declare n integer; reservation bigint; runs integer;
 begin
  select count(*) into n from public.raxi_agent_runs where task_id='${taskId}'::uuid and status='CLAIMED';
  select count(*) into runs from public.raxi_agent_runs where task_id='${taskId}'::uuid;
  select reserved_micros into reservation from public.raxi_runtime_policies where workspace_id='${workspace}'::uuid;
  if n<>1 or runs<>1 or reservation<>10 then raise exception 'claim invariant failed'; end if;
 end $pr35$;`);
 if(!check.includes('DO'))die('STOP: SQL race result assertion not executed');
 console.log('PASS: native two independent PostgreSQL sessions raced one approved DIRECTOR task; one claimed, one denied, one run, one budget reservation');
 console.log('PASS: PR35_NATIVE_CONCURRENT_CLAIM_SQL_ONLY. Journal replay, provider, native adapter, hosted Auth NOT TESTED.');
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
