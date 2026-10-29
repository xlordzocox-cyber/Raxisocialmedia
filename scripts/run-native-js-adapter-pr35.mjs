// PR35 opt-in native runOne + supervised JS repository, simulated provider only.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
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


 const require=createRequire(resolve(root,'apps/raxi-hq/package.json'));
 let build;
 try{({build}=require('esbuild'));}catch{
  die('STOP: apps/raxi-hq esbuild must already be installed locally. Do not install automatically.');
 }
 // esbuild loads the *actual* checked-in TypeScript runtime and repository:
 // no mocked JS implementation or parallel runtime is introduced.
 const bundle=await build({
  stdin:{contents:"export {runOne} from './server/agent-runtime/runtime.ts';\nexport {localSupervisedRepository} from './server/agent-runtime/localSupervisedRepository.ts';\nexport {simulatedProvider} from './server/agent-runtime/providers.ts';\n",
   resolveDir:root,sourcefile:'pr35-native-adapter-entry.ts',loader:'ts'},
  platform:'node',format:'esm',bundle:true,write:false,logLevel:'silent'
 });
 if(bundle.outputFiles.length!==1)die('STOP: unexpected TS bundle shape');
 const {runOne,localSupervisedRepository,simulatedProvider}=await import(
  'data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
 if(typeof runOne!=='function'||typeof localSupervisedRepository!=='function'||
    simulatedProvider.id!=='simulated'||simulatedProvider.simulated!==true)
  die('STOP: expected local-only adapter or provider missing');
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const workspace='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const taskKey='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const approvalKey='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const scalar=(body)=>sh(['exec','-i',id,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],body).trim();
 sql(`insert into auth.users(id) values ('${owner}');
 insert into public.raxi_workspaces(id,owner_user_id,slug,name)
 values ('${workspace}','${owner}','pr35-js-fixture','PR35 JS FIXTURE');
 insert into public.raxi_runtime_policies(workspace_id,enabled,simulated,provider,model,total_budget_micros,per_call_micros,max_tasks,expires_at)
 values ('${workspace}',true,true,'simulated','fixture-model',100,10,8,clock_timestamp()+interval '1 hour');`);
 // Native psql query port: PostgreSQL PREPARE resolves types for the existing
 // repository's positional parameters; there is no hosted connection.
 const literal=(v)=>{
  if(v===null||v===undefined)return 'NULL';
  if(typeof v==='boolean')return v?'TRUE':'FALSE';
  if(typeof v==='number'){if(!Number.isSafeInteger(v))die('STOP: number');return String(v);}
  if(typeof v!=='string')die('STOP: parameter type');
  return "'"+v.replace(/'/g,"''")+"'";
 };
 const port={
  provenance:'LOCAL_POSTGRES_FIXTURE',
  async query(statement,params=[]){
   if(typeof statement!=='string'||!/^select\s/i.test(statement.trim())||
      statement.includes(';')||!Array.isArray(params)||params.length>12)
    die('STOP: unexpected native SQL port command');
   const query='select row_to_json(r) from ('+statement+') as r';
   const command='begin;\nset local role service_role;\nPREPARE pr35_native_query AS '+query+
    ';\nEXECUTE pr35_native_query('+params.map(literal).join(', ')+');\nDEALLOCATE pr35_native_query;\ncommit;\n';
   const output=scalar(command);
   return {rows:output?output.split(/\r?\n/).map(line=>{
    const record=JSON.parse(line);
    if(!record||typeof record!=='object'||Array.isArray(record))die('STOP: malformed native row');
    return record;
   }):[]};
  }
 };
 const local=localSupervisedRepository(port,owner);
 const spec={question:'Review local synthetic fixture only',externalResearch:false,
  provider:'simulated',model:'fixture-model',
  authorization:{confirmed:true,maxCostMicros:10,expiresAt:new Date(Date.now()+600000).toISOString()}};
 const prepared=await local.prepare(workspace,taskKey,'DIRECTOR',spec,null);
 if(prepared.status!=='WAITING_APPROVAL')die('STOP: JS prepare approval missing');
 const approved=await local.approve(prepared.id,approvalKey,prepared.input_snapshot.supervised.scopeDigest);
 if(approved.status!=='QUEUED')die('STOP: JS approval missing');
 let providerCalls=0;
 const provider={...simulatedProvider,async start(input,signal){
  providerCalls++;
  if(providerCalls!==1||input.stage!=='DIRECTOR'||input.model!=='fixture-model')die('STOP: wrong simulated call');
  return simulatedProvider.start(input,signal);
 }};
 const deps={repository:local.repository,providers:new Map([['simulated',provider]]),
  workerId:'PR35-NATIVE-JS',liveEnabled:false};
 const first=await runOne(deps,prepared.id);
 if(!first||first.claimed!==true||first.stage!=='DIRECTOR'||first.simulated!==true||first.uncertain===true||providerCalls!==1)
  die('STOP: JS runOne not completed once: '+JSON.stringify(first));
 const second=await runOne(deps,prepared.id);
 if(!second||second.claimed!==false||providerCalls!==1)die('STOP: duplicate native runOne effect');
 // Read back committed PostgreSQL state, independently of runOne return values.
 const payload=scalar(`select json_build_object(
  'runs',(select count(*) from public.raxi_agent_runs where task_id=t.id),
  'version',(select max(journal_version) from public.raxi_agent_runs where task_id=t.id),
  'runStatus',(select max(status) from public.raxi_agent_runs where task_id=t.id),
  'taskStatus',t.status,
  'journal',(select count(*) from public.raxi_agent_events where task_id=t.id and event_type='SUPERVISED_LOCAL_JOURNAL'),
  'ack',(select count(*) from public.raxi_agent_events where task_id=t.id and event_type='RUNTIME_ACKNOWLEDGED'),
  'finish',(select count(*) from public.raxi_agent_events where task_id=t.id and event_type='RUNTIME_RESULT_COMMITTED'),
  'reserved',(select reserved_micros from public.raxi_runtime_policies where workspace_id=t.workspace_id),
  'researcher',(select count(*) from public.raxi_agent_runs where task_id=t.id and stage='RESEARCHER')
 ) from public.raxi_agent_tasks t where id='${prepared.id}'::uuid;`);
 const state=JSON.parse(payload);
 if(state.runs!==1||state.version!==3||state.runStatus!=='SUCCEEDED'||state.taskStatus!=='COMPLETED'||
    state.journal!==3||state.ack!==1||state.finish!==1||state.reserved!==10||state.researcher!==0)
  die('STOP: canonical PG17 invariants incorrect '+JSON.stringify(state));
 const runId=scalar(`select id from public.raxi_agent_runs where task_id='${prepared.id}'::uuid;`);
 const finish=await local.confirmation(runId+':finish');
 if(!finish||finish.status!=='SUCCEEDED'||finish.journal_version!==3)
  die('STOP: JS adapter cannot recover finish confirmation');
 console.log('PASS: PR35_NATIVE_JS_ADAPTER: actual runOne + localSupervisedRepository + simulatedProvider against isolated native PostgreSQL 17; one provider call, one run, three durable journal transitions, one ACK, one finish, one reservation; adapter readback confirmed.');
 console.log('LIMITS: synthetic DIRECTOR only; no real provider, live endpoint, hosted Auth/B2, network failure or server restart. NEVER present MOCK as REAL office activity.');
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
