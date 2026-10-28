// Pure offline source-contract preflight; does not import Docker or hosted SDKs.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const file=path=>readFileSync(resolve(root,path),'utf8');
const m=JSON.parse(file('supabase/staging/raxi-hq-staging.manifest.json'));
const fail=x=>{throw Error('PR34 STOP: '+x);};
if(process.argv.length!==2)fail('no execution arguments permitted in static preflight');
if(m.executionReady!==false||Object.values(m.authorizations||{}).some(x=>x!==false))fail('hosted execution gate changed');
const steps=m.applicationPlan?.steps;
if(!Array.isArray(steps)||steps.length!==7)fail('expected seven original sources');
for(let i=0;i<7;i++){
 const s=steps[i],type=i<4?'BASE_MIGRATION':'RUNTIME_PROPOSAL';
 if(s.order!==i+1||s.kind!==type||!/^supabase\/(migrations|proposals)\/[a-zA-Z0-9_-]+\.sql$/.test(s.path))fail('source order/path '+i);
 if((i<4)!==s.path.startsWith('supabase/migrations/'))fail('source type mismatch');
 const hash=createHash('sha256').update(file(s.path).replace(/\r\n/g,'\n')).digest('hex');
 if(hash!==s.sha256Lf)fail('hash mismatch '+s.id);
}
const runtime=file('supabase/proposals/agent_runtime.sql');
const stageA=file('supabase/proposals/supervised_host_stage_a.sql');
const bootstrap=file('supabase/tests/pg17-bootstrap.sql');
for(const fn of ['raxi_runtime_claim','raxi_runtime_step'])if(!runtime.includes('create function public.'+fn))fail('missing runtime function '+fn);
for(const fn of ['raxi_supervised_prepare','raxi_supervised_approve','raxi_supervised_step','raxi_supervised_protect_journal'])if(!stageA.includes('create function public.'+fn))fail('missing supervised function '+fn);
if(!runtime.includes("current_user<>'service_role'")||!bootstrap.includes('service_role nologin bypassrls'))fail('runtime/bootstrap role expectations changed');
console.log('PASS: PR34_STATIC_SOURCE_CONTRACT: 7 verified SQL sources, real runtime/journal functions, hosted gates blocked.');
console.log('NOT EXECUTED: Docker, native runtime claims, concurrency, journal, hosted Auth, B2, providers.');
