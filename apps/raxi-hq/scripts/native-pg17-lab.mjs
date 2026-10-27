// Opt-in local lab only. No TCP, hosted client, provider, Docker lifecycle or download.
import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadPreparationManifest,verifySqlSources,inspectRaxiSchema} from './staging-manifest.mjs';
export const LAB=Object.freeze({name:'raxi-pg17-validation',database:'raxi_validation',user:'raxi_local',network:'raxi-pg17-isolated',
 id:'18e930e0f9b68de168b8b97415d73bece0f1c7a6f38def2d4749251097185235',
 image:'sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe',version:170011});
export const PG17_SCHEMA_SHA256='d7983def867201cb307b92906b97db9876765852a1f0d96cd8fdf2b81efd7c5e';
// Select fields only: never read/log Config.Env, credentials or unrelated containers.
const format='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"tag":{{json .Config.Image}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"bindings":{{json .HostConfig.PortBindings}},"ports":{{json .NetworkSettings.Ports}},"publishAll":{{json .HostConfig.PublishAllPorts}},"privileged":{{json .HostConfig.Privileged}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:15000,windowsHide:true,stdio:['ignore','pipe','pipe']});
export function validateLab(container,network) {
 if(container.id!==LAB.id||container.name!=='/'+LAB.name||container.image!==LAB.image||container.tag!=='postgres:17'||
  container.running!==true||container.paused!==false||container.restarting!==false||container.privileged!==false||container.publishAll!==false||
  Object.keys(container.bindings??{}).length||Object.values(container.ports??{}).some(v=>v!==null)||
  Object.keys(container.networks??{}).length!==1||!container.networks[LAB.network]||
  network.Name!==LAB.network||network.Internal!==true||network.Id!==container.networks[LAB.network].NetworkID||
  container.mounts?.length!==1||container.mounts[0].Type!=='tmpfs'||container.mounts[0].Destination!=='/var/lib/postgresql/data')
  throw Error('Unapproved or non-isolated Docker lab');
 return {containerId:container.id,imageId:container.image,networkId:network.Id,internal:true,publishedPorts:0,dataStorage:'tmpfs'};
}
export function inspectLab() {
 const container=JSON.parse(docker(['inspect','--type=container',LAB.name,'--format',format]));
 const network=JSON.parse(docker(['network','inspect',LAB.network,'--format','{"Name":{{json .Name}},"Id":{{json .Id}},"Internal":{{json .Internal}}}']));
 return validateLab(container,network);
}
export function validateSqlTarget(row) {
 if(row.db!==LAB.database||row.actor!==LAB.user||row.version!==LAB.version||row.data!=='/var/lib/postgresql/data'||row.remote!==null)
  throw Error('Unexpected local PostgreSQL identity/version/data directory');
 return row;
}
// Parameters for static test queries only. Unknown-type literals preserve PG overload
// inference; doubling quotes + standard_conforming_strings prevent SQL interpolation.
export function bindFixtureSql(sql,values=[]) {
 return sql.replace(/\$(\d+)\b/g,(_,n)=>{
  if(Number(n)<1||Number(n)>values.length)throw Error('Missing fixture parameter');
  const v=values[Number(n)-1];if(v===null||v===undefined)return 'NULL';
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error('Invalid number');return String(v);}
  if(typeof v==='boolean')return v?'true':'false';
  const text=typeof v==='object'?JSON.stringify(v):String(v);if(text.includes('\0'))throw Error('Invalid text');
  return "'"+text.replaceAll("'","''")+"'";
 });
}
const identitySql=`select json_build_object('db',current_database(),'actor',current_user,'version',current_setting('server_version_num')::int,'data',current_setting('data_directory'),'remote',inet_server_addr(),'pid',pg_backend_pid());`;
export function openLabSession() {
 inspectLab(); // fail before spawning psql; execute immutable ID, not replaceable name
 const child=spawn('docker',['exec','-i',LAB.id,'psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-U',LAB.user,'-d',LAB.database,'-h','/var/run/postgresql'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 let connectTimer;
 const done=new Promise((resolve,reject)=>{
  connectTimer=setTimeout(()=>{child.kill();reject(Error('Local SQL timeout; transaction outcome must be reconciled'));},30000);
  child.on('error',()=>{clearTimeout(connectTimer);reject(Error('Cannot execute local psql'));});
  child.on('close',code=>{clearTimeout(connectTimer);if(code===0)resolve(stdout.trim());else{
   // No statement/context/arguments in errors. In particular never print lease tokens.
   const match=stderr.match(/ERROR:\s+([A-Z0-9]{5}):\s*([^\r\n]*)/);
   reject(Object.assign(Error(match?match[2]:'Local SQL failed'),{code:match?.[1]??'LOCAL_SQL'}));
  }});
 });
 // Observe runtime SQL identity inside EVERY connection before any supplied SQL.
 child.stdin.write("\\set VERBOSITY verbose\nset standard_conforming_strings=on;set statement_timeout='20s';set lock_timeout='8s';\n"+identitySql+'\n');
 let verified=false;
 const ready=new Promise((resolve,reject)=>{
  const poll=setInterval(()=>{const line=stdout.split('\n')[0];if(!line)return;
   try {validateSqlTarget(JSON.parse(line));verified=true;clearTimeout(connectTimer);clearInterval(poll);resolve(JSON.parse(line));}
   catch(e){clearInterval(poll);child.stdin.end();reject(e);}
  },10);
  done.then(()=>{if(!verified){clearInterval(poll);reject(Error('SQL identity response missing'));}},e=>{clearInterval(poll);reject(e);});
 });
 let sequence=0,closing;
 return {ready,done,send(sql){if(!verified||closing)throw Error('Unverified or closed SQL session');child.stdin.write(sql+'\n');},
  async request(sql){
   await ready;if(closing)throw Error('SQL session closed');const offset=stdout.length,marker='RAXI_QUERY_END_'+(++sequence);
   return new Promise((resolve,reject)=>{
    const finish=(error,value)=>{clearInterval(poll);clearTimeout(timeout);error?reject(error):resolve(value);};
    const poll=setInterval(()=>{const end=stdout.indexOf(marker+'\n',offset);if(end>=0)finish(null,stdout.slice(offset,end).trim());},5);
    const timeout=setTimeout(()=>{child.kill();finish(Error('SQL response timeout; reconcile before retry'));},30000);
    done.then(()=>finish(Error('SQL session closed before response')),e=>finish(e));
    child.stdin.write(sql+'\n\\echo '+marker+'\n');
   });
  },
  finish(sql=''){
   if(!closing)closing=(async()=>{await ready;if(sql)child.stdin.write(sql+'\n');child.stdin.end();const output=await done;return output.split('\n').slice(1).join('\n');})();
   return closing;
  }};
}
const activePorts=new Set();
export async function closeNativePorts(){const closing=[...activePorts];activePorts.clear();await Promise.all(closing.map(close=>close()));}
export async function labExec(sql,role='service_role') {
 if(!['service_role','authenticated','anon','raxi_local'].includes(role))throw Error('Invalid test role');
 const s=openLabSession();await s.ready;return s.finish(`set role ${role};\n${sql}`);
}
export function labPort(role='service_role',claims=null) {
 if(!['service_role','authenticated','anon','raxi_local'].includes(role))throw Error('Invalid test role');
 let session,queue=Promise.resolve();
 const close=async()=>{await queue;const old=session;session=null;if(old)await old.finish();};
 return {provenance:'LOCAL_POSTGRES_FIXTURE',query(sql,values=[]) {
  const operation=queue.then(async()=>{
  const query=bindFixtureSql(sql,values);
  const context=claims===null?'':`select set_config('request.jwt.claims',${bindFixtureSql('$1',[JSON.stringify(claims)])},false);`;
  if(!session){session=openLabSession();activePorts.add(close);}
  try{
   const output=await session.request(`set role ${role};${context}\nselect coalesce(json_agg(row_to_json(q)),'[]'::json) from (${query}) q;`);
   return {rows:JSON.parse(output.split('\n').at(-1))};
  }catch(e){session=null;throw e;} // reconnect only on the NEXT command; never retry this one
  });
  queue=operation.then(()=>{},()=>{});return operation;
 }};
}
export async function installLab() {
 const isolation=inspectLab(),manifest=await loadPreparationManifest(),sources=await verifySqlSources(manifest);
 if(sources.length!==7)throw Error('Exactly seven reviewed sources required');
 const admin=labPort('raxi_local');
 const {rows}=await admin.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage','raxi_validation_lab') and c.relkind in ('r','p','v','m','f')");
 // Never reset or overwrite an existing installation or unknown database contents.
 if(rows[0].n!==0)throw Error('Lab is not empty; no automatic reset/reapply permitted');
 const bootstrap=await readFile(fileURLToPath(new URL('../../../supabase/tests/pg17-bootstrap.sql',import.meta.url)),'utf8');
 await labExec('begin;\n'+bootstrap+'\n'+sources.map(s=>s.text).join('\n')+'\ncommit;','raxi_local');
 const schema=await inspectRaxiSchema(admin);
 await closeNativePorts();
 return {isolation,postgresVersion:LAB.version,sourceIds:sources.map(s=>s.id),schema,localOnly:true,hostedAuthValidated:false,b2Executed:false};
}
export async function observeWait(pid,blocker) {
 const admin=labPort('raxi_local');
 for(let i=0;i<60;i++){
  const {rows}=await admin.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[pid]);
  if(rows[0]?.wait_event_type==='Lock'&&rows[0].blockers.includes(blocker))return {waiter:pid,blocker,waitEvent:'Lock'};
  await new Promise(r=>setTimeout(r,50));
 }
 throw Error('Independent physical lock wait not observed');
}
