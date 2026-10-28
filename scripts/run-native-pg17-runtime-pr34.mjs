// PR34 opt-in ephemeral native PG17 RLS smoke test. Never imports hosted clients.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const die=s=>{throw Error(s)};
const sh=(args,input)=>{
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:8*1024*1024});
 if(r.error||r.status!==0)die('docker '+args.slice(0,2).join(' ')+' failed: '+String(r.stderr||r.error).slice(0,600));
 return r.stdout.trim();
};
const manifest=JSON.parse(readFileSync(resolve(root,'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
if(manifest.executionReady!==false||Object.values(manifest.authorizations||{}).some(v=>v!==false))die('STOP: hosted authorizations changed');
const steps=manifest.applicationPlan.steps;
if(steps.length!==7||steps.some((s,i)=>s.order!==i+1)||steps.filter(s=>s.kind==='BASE_MIGRATION').length!==4||steps.filter(s=>s.kind==='RUNTIME_PROPOSAL').length!==3)die('STOP: unexpected SQL source plan');
const sources=steps.map(step=>{
 if(!/^supabase\/(migrations|proposals)\/[\w-]+\.sql$/.test(step.path))die('STOP: unexpected SQL path');
 const sql=readFileSync(resolve(root,step.path),'utf8');
 const digest=createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');
 if(digest!==step.sha256Lf)die('STOP: SQL source digest mismatch '+step.id);
 return {id:step.id,sql};
});
const bootstrap=readFileSync(resolve(root,'supabase/tests/pg17-bootstrap.sql'),'utf8');
console.log('PASS: seven ordered source SHA256 hashes, bootstrap present, hosted authorizations false.');
if(process.argv.length!==3||process.argv[2]!=='--run-local'){
 console.log('PRECHECK ONLY: no Docker called. For isolated native PG17 run, supply --run-local.');
 process.exit(0);
}
const image='postgres:17',name='raxi-pr34-'+randomBytes(6).toString('hex');
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

 const result=sql(`do $test$
declare claim_allowed boolean; anon_allowed boolean; journal_trigger_count integer;
begin
 claim_allowed:=has_function_privilege('service_role','public.raxi_runtime_claim(uuid,text)','EXECUTE');
 anon_allowed:=has_function_privilege('authenticated','public.raxi_runtime_claim(uuid,text)','EXECUTE');
 if not claim_allowed or anon_allowed then raise exception 'runtime function role boundary violated'; end if;
 if has_table_privilege('service_role','public.raxi_agent_events','TRUNCATE') then raise exception 'runtime can TRUNCATE journal'; end if;
 select count(*) into journal_trigger_count from pg_trigger
 where tgrelid='public.raxi_agent_events'::regclass and tgname='raxi_supervised_journal_immutable' and not tgisinternal;
 if journal_trigger_count<>1 then raise exception 'journal immutability trigger missing'; end if;
end $test$;`);
 if(!result.includes('DO'))die('STOP: runtime role and journal catalogue assertions not executed');
 console.log('PASS: native service_role execute grant and authenticated EXECUTE revocation; journal trigger and TRUNCATE deny');
 const missing='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 const tested=sql(`begin;
set local role service_role;
do $test$
begin
 begin
  perform public.raxi_runtime_claim('${missing}'::uuid,'PR34-LOCAL');
  raise exception 'unexpected claim on missing task';
 exception when others then
  if SQLERRM <> 'runtime task required' then raise; end if;
 end;
end $test$;
rollback;`);
 if(!tested.includes('DO'))die('STOP: role-based missing task assertion did not run');
 console.log('PASS: native runtime claim rejects nonexistent task without reservation');
 console.log('PASS: PR34_NATIVE_PG17_RUNTIME_GUARDS. Concurrent claims, valid approvals, journal mutation/replay, provider dispatch and adapter integration NOT TESTED.');
}finally{
 if(id){
  const probe=spawnSync('docker',['inspect',id,'--format','{{.Name}}|{{.Id}}'],{encoding:'utf8',timeout:10000});
  if(probe.status===0&&probe.stdout.trim()==='/'+name+'|'+id){
   const removal=spawnSync('docker',['rm','-f',id],{encoding:'utf8',timeout:30000});
   if(removal.status!==0){process.exitCode=1;console.error('CLEANUP FAILED; inspect exact test container ID:',id);}
   else console.log('CLEANUP PASS: removed only PR34 disposable container.');
  }else {process.exitCode=1;console.error('CLEANUP STOP: container identity differs; manual inspection required.');}
 }
}
