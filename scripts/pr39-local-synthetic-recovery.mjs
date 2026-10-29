// PR39: local opt-in recovery of SYNTHETIC public Raxi data across two isolated PG17 containers.
// DEFAULT: read-only OFFLINE preflight. --run-local requires separate human approval.
// Never touches hosted Supabase, production, real Auth rows, Storage object bytes or providers.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadPreparationManifest,verifySqlSources} from '../apps/raxi-hq/scripts/staging-manifest.mjs';
import {assertBootstrapIntegrity} from './pr35-bootstrap-guard.mjs';
import {verifyPr38RecoveryEvidence} from './pr38-recovery-contract.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const fail=why=>{throw Error('PR39 STOP: '+why);};
const argv=process.argv.slice(2);
if(argv.length>1||(argv.length===1&&argv[0]!=='--run-local'))fail('only --run-local is accepted');
const runLocal=argv.length===1;
const read=p=>readFileSync(resolve(root,p),'utf8');
const manifest=await loadPreparationManifest();
const evidence=JSON.parse(read('docs/RAXI_HQ_PR38_RECOVERY_EVIDENCE.json'));
const scope=verifyPr38RecoveryEvidence(evidence,manifest);
if(scope.status!=='NO_GO_HOSTED_MIGRATION'||scope.scope!=='PUBLIC_ONLY_VERIFIED')
 fail('hosted migration and complete backup MUST remain blocked');
const bootstrap=read('supabase/tests/pg17-bootstrap.sql');
assertBootstrapIntegrity(bootstrap);
const sources=await verifySqlSources(manifest);
if(sources.length!==7||sources.slice(0,4).some(s=>s.kind!=='BASE_MIGRATION')||
   sources.slice(4).some(s=>s.kind!=='RUNTIME_PROPOSAL'))
 fail('reviewed SQL sources changed');
console.log('PASS: PR39_PINNED_OFFLINE_PREFLIGHT (7 source SHA256, bootstrap pin, PR38 NO-GO, six false authorizations)');
if(!runLocal){
 console.log('PRECHECK ONLY: no Docker, network, SQL, backup or restore performed.');
 console.log('LOCAL SYNTHETIC rehearsal --run-local remains separately permissioned; hosted operation remains NO-GO.');
 process.exit(0);
}
const image='postgres:17';
const sourceName='raxi-pr39-src-'+randomBytes(6).toString('hex');
const targetName='raxi-pr39-restore-'+randomBytes(6).toString('hex');
const created=[];
const synthetic={
 users:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
 workspaces:['cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
 ideas:['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ffffffff-ffff-4fff-8fff-ffffffffffff']
};
function docker(args,{input,raw=false,timeout=120000}={}){
 const o=spawnSync('docker',args,{
  input,encoding:raw?undefined:'utf8',windowsHide:true,
  timeout,maxBuffer:64*1024*1024
 });
 if(o.error||o.status!==0)fail('local Docker '+args.slice(0,2).join(' ')+' failed: '+String(o.stderr||o.error).slice(0,450));
 return raw?o.stdout:o.stdout.trim();
}
const sql=(id,body)=>docker(['exec','-i',id,'psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-f','-'],{input:body});
async function start(name){
 if(docker(['ps','-aq','--filter','name=^/'+name+'$']))fail('unexpected existing fixture name');
 const id=docker(['run','-d','--rm','--pull=never','--name',name,'--network','none',
  '--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 if(!/^[a-f0-9]{64}$/.test(id))fail('invalid new disposable Docker ID');
 created.push({id,name});
 const cfg=JSON.parse(docker(['inspect',id,'--format','{{json .}}']));
 if(cfg.Id!==id||cfg.Name!=='/'+name||cfg.HostConfig.NetworkMode!=='none'||
    cfg.HostConfig.Privileged!==false||
    Object.keys(cfg.HostConfig.PortBindings||{}).length!==0||
    cfg.HostConfig.PublishAllPorts!==false||
    (cfg.Mounts||[]).some(x=>x.Type!=='tmpfs')||
    (cfg.HostConfig.Binds||[]).length!==0)
  fail('PG17 fixture isolation not proven');
 let ready=false;
 for(let i=0;i<50;i++){
  const check=spawnSync('docker',['exec',id,'pg_isready','-U','postgres','-d','postgres'],
   {encoding:'utf8',windowsHide:true,timeout:5000});
  if(check.status===0){ready=true;break;}
  await new Promise(done=>setTimeout(done,300));
 }
 if(!ready)fail('fixture PG17 did not become ready');
 const v=Number(sql(id,"select current_setting('server_version_num')::integer;"));
 if(!Number.isSafeInteger(v)||Math.floor(v/10000)!==17)fail('fixture is not PG17');
 return id;
}
function seedAuth(id){
 const values=synthetic.users.map(id=> "('"+id+"')").join(',');
 sql(id,"insert into auth.users(id) values "+values+";");
}
function fixtureData(id){
 const [ownerA,ownerB]=synthetic.users,[wa,wb]=synthetic.workspaces,[ia,ib]=synthetic.ideas;
 sql(id,
  "insert into public.raxi_workspaces(id,owner_user_id,slug,name) values "+
  "('"+wa+"','"+ownerA+"','pr39-alpha','PR39 Alpha'),"+
  "('"+wb+"','"+ownerB+"','pr39-beta','PR39 Beta');\n"+
  "insert into public.raxi_ideas(id,workspace_id,external_id,kind,title,status,source) values "+
  "('"+ia+"','"+wa+"','synthetic-a','DRAFT','Synthetic local A','DRAFT','LOCAL_FIXTURE'),"+
  "('"+ib+"','"+wb+"','synthetic-b','DRAFT','Synthetic local B','DRAFT','LOCAL_FIXTURE');");
}
function catalogue(id){
 const query=[
 "select jsonb_build_object(",
 "'workspaces',(select jsonb_agg(jsonb_build_object('id',id,'owner',owner_user_id,'slug',slug,'name',name) order by id) from public.raxi_workspaces),",
 "'ideas',(select jsonb_agg(jsonb_build_object('id',id,'workspace',workspace_id,'external',external_id,'kind',kind,'title',title,'status',status,'source',source) order by id) from public.raxi_ideas),",
 "'rlsTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'raxi_%' and c.relkind in ('r','p') and c.relrowsecurity),",
 "'policies',(select count(*) from pg_policies where schemaname='public' and tablename like 'raxi_%'),",
 "'workspaceSelect',has_table_privilege('authenticated','public.raxi_workspaces','SELECT'),",
 "'ideaSelect',has_table_privilege('authenticated','public.raxi_ideas','SELECT')",
 ")::text;"
 ].join('\n');
 return JSON.parse(sql(id,query));
}
function readIsolation(id,user,own,other){
 const token='{"sub":"'+user+'","role":"authenticated"}';
 const out=sql(id,"begin;\nset local role authenticated;\n"+
  "select set_config('request.jwt.claims','"+token+"',true);\n"+
  "set local row_security=on;\n"+
  "select (select count(*) from public.raxi_workspaces where id='"+own+"')::text || ':' || "+
  "(select count(*) from public.raxi_workspaces where id='"+other+"')::text || ':' || "+
  "(select count(*) from public.raxi_ideas where workspace_id='"+own+"')::text || ':' || "+
  "(select count(*) from public.raxi_ideas where workspace_id='"+other+"')::text;\nrollback;");
 return out.split(/\r?\n/).find(x=>/^\d+:\d+:\d+:\d+$/.test(x))||'INVALID';
}
let failed=false;
try{
 docker(['image','inspect',image,'--format','{{.Id}}']);
 const origin=await start(sourceName);
 sql(origin,bootstrap);
 for(const s of sources)sql(origin,s.text);
 seedAuth(origin);
 fixtureData(origin);
 const before=catalogue(origin);
 if(before.workspaces?.length!==2||before.ideas?.length!==2||
    before.rlsTables<20||before.policies<20||
    before.workspaceSelect!==true||before.ideaSelect!==true)
  fail('synthetic Raxi table/ACL/RLS fixture incomplete before export');
 const sourceIsolation=synthetic.users.map((u,i)=>
  readIsolation(origin,u,synthetic.workspaces[i],synthetic.workspaces[1-i]));
 if(sourceIsolation.some(x=>x!=='1:0:1:0'))fail('source fixture RLS isolation failed');
 // Archive travels in process memory only. No host-mounted files or passwords.
 const archive=docker(['exec',origin,'pg_dump','-Fc','--schema=public','--no-owner',
  '-U','postgres','-d','postgres'],{raw:true});
 if(!Buffer.isBuffer(archive)||archive.length<1024)fail('synthetic archive missing');
 const hash=createHash('sha256').update(archive).digest('hex');
 const toc=docker(['exec','-i',origin,'pg_restore','--list'],{input:archive});
 if(!toc.includes('TABLE DATA public raxi_workspaces')||
    !toc.includes('TABLE DATA public raxi_ideas')||
    !toc.includes('POLICY public raxi_workspaces'))
  fail('archive missing data or RLS policy');
 const restore=await start(targetName);
 sql(restore,bootstrap);
 seedAuth(restore); // SYNTHETIC AUTH STUBS ONLY; Auth data is NOT restored.
 sql(restore,'drop schema public cascade;');
 // Restore original public ACLs + policies, but NOT managed schemas or Storage bytes.
 docker(['exec','-i',restore,'pg_restore','--exit-on-error','--no-owner','-U','postgres','-d','postgres'],
  {input:archive});
 const after=catalogue(restore);
 if(JSON.stringify(after)!==JSON.stringify(before))fail('source and destination Raxi schema/data/ACL fingerprint mismatch');
 const afterIsolation=synthetic.users.map((u,i)=>
  readIsolation(restore,u,synthetic.workspaces[i],synthetic.workspaces[1-i]));
 if(afterIsolation.some(x=>x!=='1:0:1:0'))fail('restored fixture RLS isolation failed');
 console.log('PASS: PR39_LOCAL_PG17_SYNTHETIC_RESTORE: 2 Raxi workspaces, 2 ideas, 20+ RLS tables, policies and ACLs retained.');
 console.log('PASS: restored two synthetic authenticated owners see own data only. SHA256 in-memory archive: '+hash);
 console.log('LIMIT: NO managed Supabase Auth service, Auth session recovery, real Storage bytes, hosted RLS or full-project recovery tested.');
 console.log('HOSTED STATUS: NO_GO_HOSTED_MIGRATION; no network, uploads, paid providers or hosting operations.');
}catch(error){failed=true;console.error(String(error));}
finally{
 for(const x of created.reverse()){
  try{
   const line=docker(['inspect',x.id,'--format','{{.Name}}|{{.Id}}']);
   if(line!=='/'+x.name+'|'+x.id)throw Error('identity mismatch');
   docker(['rm','-f',x.id],{timeout:30000});
   console.log('CLEANUP PASS: only disposable '+x.name);
  }catch(error){failed=true;console.error('CLEANUP STOP: '+String(error));}
 }
}
if(failed)process.exitCode=1;
