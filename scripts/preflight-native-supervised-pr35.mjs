// PR35 offline-only source and hosted-denial gate; no subprocess or network.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {assertBootstrapIntegrity} from './pr35-bootstrap-guard.mjs';
if(process.argv.length!==2)throw Error('PR35 STOP: static preflight accepts no flags');
const root=fileURLToPath(new URL('..',import.meta.url));
const read=p=>readFileSync(resolve(root,p),'utf8');
const m=JSON.parse(read('supabase/staging/raxi-hq-staging.manifest.json'));
const assert=(cond,msg)=>{if(!cond)throw Error('PR35 STOP: '+msg)};
assert(m.executionReady===false,'executionReady changed');
const flags=['applySql','runB2','deploy','createUsers','realProviders','additionalSpend'];
assert(m.authorizations&&typeof m.authorizations==='object'&&!Array.isArray(m.authorizations),'authorizations absent');
assert(Object.keys(m.authorizations).length===flags.length&&flags.every(k=>Object.hasOwn(m.authorizations,k)&&m.authorizations[k]===false),'explicit hosted denials missing');
const paths=[
 'supabase/migrations/20261019030541_raxi_hq_v09_private_core.sql',
 'supabase/migrations/20261019030659_raxi_hq_v09_fk_indexes.sql',
 'supabase/migrations/20261019030808_raxi_hq_v09_workspace_onboarding.sql',
 'supabase/migrations/20261019231655_raxi_hq_real_idea_write.sql',
 'supabase/proposals/agent_runtime.sql',
 'supabase/proposals/supervised_host_stage_a.sql',
 'supabase/proposals/supervised_host_stage_b.sql'
];
const steps=m.applicationPlan?.steps;
assert(Array.isArray(steps)&&steps.length===paths.length,'source count changed');
for(let i=0;i<steps.length;i++){
 const item=steps[i],type=i<4?'BASE_MIGRATION':'RUNTIME_PROPOSAL';
 assert(item.path===paths[i]&&item.order===i+1&&item.kind===type,'source path/kind/order mismatch at '+i);
 assert(/^[a-f0-9]{64}$/.test(item.sha256Lf),'invalid digest at '+i);
 const digest=createHash('sha256').update(read(paths[i]).replace(/\r\n/g,'\n')).digest('hex');
 assert(digest===item.sha256Lf,'source bytes changed at '+i);
}
const runtime=read(paths[4]),stage=read(paths[5]),bootstrap=read('supabase/tests/pg17-bootstrap.sql');
assertBootstrapIntegrity(bootstrap);
for(const fn of ['raxi_runtime_claim'])assert(runtime.includes('create function public.'+fn+'('),'missing runtime function '+fn);
for(const fn of ['raxi_supervised_prepare','raxi_supervised_approve','raxi_supervised_step','raxi_supervised_protect_journal'])
 assert(stage.includes('create function public.'+fn+'('),'missing supervision function '+fn);
assert(runtime.includes("current_user<>'service_role'")&&bootstrap.includes('service_role nologin bypassrls'),'role semantics changed');
console.log('PASS: PR35_SOURCE_GATES: exact seven SQL files and hashes, pinned bootstrap SHA256, six hosted denials, supervised runtime contracts.');
console.log('NOT EXECUTED: Docker, native PG17, authorization/claim races, journal, real providers, hosted Auth, B2.');
