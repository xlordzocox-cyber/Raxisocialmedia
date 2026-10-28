// PR33 opt-in ephemeral native PG17 RLS smoke test. Never imports hosted clients.
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
const image='postgres:17',name='raxi-pr33-'+randomBytes(6).toString('hex');
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
 const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const wa='cccccccc-cccc-4ccc-8ccc-cccccccccccc',wb='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 sql(`insert into auth.users(id) values ('${a}'),('${b}');
insert into public.raxi_workspaces(id,owner_user_id,slug,name) values
('${wa}','${a}','pr33-a','Workspace A'),
('${wb}','${b}','pr33-b','Workspace B');`);
 for(const [actor,own,foreign] of [[a,wa,wb],[b,wb,wa]]){
 const out=sql(`begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);
set local row_security=on;
do $$ declare own_count integer; foreign_count integer; begin
 if current_user <> 'authenticated' then raise exception 'wrong role'; end if;
 if (select rolbypassrls from pg_roles where rolname=current_user) then raise exception 'bypassrls'; end if;
 select count(*) into own_count from public.raxi_workspaces where id='${own}';
 select count(*) into foreign_count from public.raxi_workspaces where id='${foreign}';
 if own_count<>1 or foreign_count<>0 then raise exception 'RLS isolation failed'; end if;
end $$;
rollback;`);
 if(!out.includes('DO'))die('STOP: RLS assertion not executed');
 console.log('PASS: authenticated synthetic owner '+(actor===a?'A':'B')+' sees own workspace, not foreign');
 }
 console.log('PASS: PR33_NATIVE_PG17_RLS_READ_ISOLATION. Runtime claims, concurrency, journal and hosted Auth NOT TESTED.');
}finally{
 if(id){
  const probe=spawnSync('docker',['inspect',id,'--format','{{.Name}}|{{.Id}}'],{encoding:'utf8',timeout:10000});
  if(probe.status===0&&probe.stdout.trim()==='/'+name+'|'+id){
   const removal=spawnSync('docker',['rm','-f',id],{encoding:'utf8',timeout:30000});
   if(removal.status!==0){process.exitCode=1;console.error('CLEANUP FAILED; inspect exact test container ID:',id);}
   else console.log('CLEANUP PASS: removed only PR33 disposable container.');
  }else {process.exitCode=1;console.error('CLEANUP STOP: container identity differs; manual inspection required.');}
 }
}
