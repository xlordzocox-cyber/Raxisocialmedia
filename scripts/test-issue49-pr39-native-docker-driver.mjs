// Issue49 Docker transport QA: ALL docker operations are intercepted in memory.
// Does NOT call Docker, launch subprocesses, send SQL, or access a database.
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {makeT0T1Plan,T0T1_SOURCE_PATH} from './issue49-pr39-t0t1-offline-executor.mjs';
import {verifyNativeTrialPrerequisites} from './issue49-pr39-native-trial-contract.mjs';
import {prepareNativeTrial,runNativeTrialWithDriver} from './issue49-pr39-native-runner-core.mjs';
import {createIssue49LocalDockerDriver} from './issue49-pr39-native-docker-driver.mjs';

assert.equal(process.argv.length,2,'test execution flags forbidden');
const imageId='sha256:'+'a'.repeat(64),sessionId='3'.repeat(24);
const host=process.platform==='win32'
 ? 'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock';
const name=process.platform==='win32'?'desktop-linux':'default';
const source=readFileSync(join(process.cwd(),T0T1_SOURCE_PATH),'utf8').replace(/\r\n/g,'\n');
const manifest=JSON.parse(readFileSync(join(process.cwd(),
 'supabase/staging/raxi-hq-staging.manifest.json'),'utf8'));
const plan=makeT0T1Plan({source,manifest,environment:{},argv:['node','offline']});
const prerequisites=verifyNativeTrialPrerequisites({
 platform:process.platform,environment:{},contextName:name,
 inspection:[{Name:name,Endpoints:{docker:{Host:host,SkipTLSVerify:false}}}],
 image:{id:imageId,version:'PostgreSQL 17.11',os:'linux',
 architecture:'amd64',rootless:false,source:'LOCALLY_INSPECTED'}
});
const cfg={plan,source,manifest,prerequisites,expectedImageId:imageId,sessionId};
const trial=prepareNativeTrial(cfg);
const consent={scope:'ISSUE49_LOCAL_T0T1_PG17_11',sessionId,imageId,
 localOnly:true,syntheticOnly:true,maxContainers:4,separateOperatorConsent:true};

function requireWinDockerCliPath(){
 const local=process.env.LOCALAPPDATA;
 assert.ok(typeof local==='string'&&/^[A-Za-z]:\\/.test(local),
  'Windows per-user install root must be absolute');
 return join(local,'Programs','DockerDesktop','resources','bin','docker.exe');
}

function fakeCli({wrongImageVersion=false,wrongImageId=false,foreignLabel=false,
 leaveVolume=false,remoteContext=false,unsafeNetwork=false,preexistingVolume=false,
 missingDataVolume=false,bootstrapTransition=false,incompleteCatalog=false,
 failedInventory=false,failedRestore=false,failedInfo=false}={}){
 const calls=[],containers=new Map(),volumes=new Set();
 if(preexistingVolume)volumes.add('6'.repeat(64));
 let index=0,removed=0;
 const readyCounts=new Map();
 const out=(value,code=0)=>({code,bytes:Buffer.isBuffer(value)?value:
  Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
 const transport=async ({binary,host:used,args,input})=>{
  assert.equal(used,host,'no alternate Docker host');
  const expectedCli=process.platform==='win32'
   ?requireWinDockerCliPath(): '/usr/bin/docker';
  assert.equal(binary,expectedCli,'must use the closed installed Docker CLI path');
  assert.ok(!args.includes('system'),'no global Docker system operations');
  assert.ok(!args.includes('prune'),'no global prune');
  calls.push([...args]);
  const a=args.join(' ');
  if(args[0]==='context'&&args[1]==='inspect')return out([{
   Name:name,Endpoints:{docker:{Host:remoteContext?'tcp://127.0.0.1:2375':host,
   SkipTLSVerify:false}}}]);
  if(args[0]==='info')return out({OSType:'linux',ID:'mock-docker-daemon'},failedInfo?1:0);
  if(args[0]==='image'&&args[1]==='inspect')return out([{
   Id:wrongImageId?'sha256:'+'f'.repeat(64):imageId,
   Os:'linux',Architecture:'amd64',Config:{
    Env:['PG_VERSION='+(wrongImageVersion?'17.10-1':'17.11-1.pgdg13+1')]}}]);
  if(args[0]==='volume'&&args[1]==='ls')return out([...volumes].join('\n'),failedInventory&&removed>0?1:0);
  if(args[0]==='container'&&args[1]==='ls')return out([...containers.keys()].join('\n'),failedInventory&&removed>0?1:0);
  if(args[0]==='container'&&args[1]==='create'){
   assert.equal(args[args.indexOf('--network')+1],'none');
   assert.equal(args[args.indexOf('--pull')+1],'never');
   assert.equal(args[args.indexOf('--restart')+1],'no');
   assert.ok(!args.includes('--privileged')&&!args.includes('--publish')&&
     !args.includes('--mount')&&!args.includes('--volume'));
   assert.equal(args.at(-1),imageId);
   const n=++index,id=String(n).repeat(64),volume=String(n+5).repeat(64);
   const resource={id,volume,label:args[args.indexOf('--label')+1].split('=').slice(1).join('='),
    name:args[args.indexOf('--name')+1]};
   containers.set(id,resource);volumes.add(volume);
   return out(id+'\n');
  }
  if(args[0]==='container'&&args[1]==='inspect'){
   const r=containers.get(args[2]);
   if(!r)throw Error('MOCK_UNKNOWN_CONTAINER');
   return out([{Id:r.id,Name:'/'+r.name,Image:imageId,
    Config:{Labels:{'raxi.issue49.owner':foreignLabel?'foreign':r.label}},
    HostConfig:{NetworkMode:unsafeNetwork?'bridge':'none',Privileged:false,
     Binds:null,PortBindings:null},
    Mounts:missingDataVolume?[]:[{Type:'volume',Name:r.volume,Destination:'/var/lib/postgresql/data'}]}]);
  }
  if(args[0]==='container'&&args[1]==='start')return out(args[2]);
  if(args[0]==='container'&&args[1]==='rm'){
   assert.equal(args[2],'-f');assert.equal(args[3],'-v');
   const id=args[4],r=containers.get(id);
   assert.ok(r,'remove only created exact IDs');
   containers.delete(id);removed++;
   if(!leaveVolume)volumes.delete(r.volume);
   return out(id);
  }
  if(args[0]==='container'&&args[1]==='exec'){
   const id=args.includes('-i')?args[3]:args[2];
   assert.ok(containers.has(id),'run only inside trial container');
   if(a.includes('pg_isready')){
    assert.equal(args[args.indexOf('-h')+1],'127.0.0.1',
      'do not accept bootstrap Unix-socket-only server');
    const count=readyCounts.get(id)||0;readyCounts.set(id,count+1);
    return out('',bootstrapTransition&&count===0?1:0);
   }
   if(a.includes('pg_dump'))return out(Buffer.from([80,71,68,77,80,1]));
   if(a.includes('pg_restore')){
    assert.ok(input instanceof Uint8Array&&input.length>0);
    return out('',failedRestore?1:0);
   }
   if(a.includes('psql')&&a.includes('--single-transaction')){
    assert.equal(typeof input,'string');assert.ok(input.includes('CHECK'));
    return out('');
   }
   if(a.includes('json_build_array'))return out(['170011','17.11 (Debian 17.11-1.pgdg13+2)','UTF8','C','C']);
   if(a.includes('json_build_object')){
    const r=containers.get(id);
    const t0=r.name.includes('t0-');
    const sourceRole=r.name.endsWith('-source');
    const conbin=t0?(sourceRole?'a':'b'):'c';
    const row={constraint_name:'raxi_workspaces_slug_check',type:'c',
      validated:true,slug_notnull:true,tablecount:1,constraintcount:1,
      conbin,definition:'mock constraint',local:true,noinherit:false,
      inhcount:0,slug_type:'text',slug_collation:'default'};
    if(incompleteCatalog)delete row.conbin;
    return out(row);
   }
  }
  throw Error('UNEXPECTED_MOCK_COMMAND '+args.join(' '));
 };
 return {calls,containers,volumes,transport};
}
const sim=fakeCli({bootstrapTransition:true});
const driver=createIssue49LocalDockerDriver({host,transport:sim.transport});
const result=await runNativeTrialWithDriver({...cfg,trial,consent,driver});
assert.equal(result.finding,'T1_MICROSCHEMA_CANDIDATE_ONLY');
assert.equal(result.cleanup,'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED');
assert.equal(result.decision,'BLOCKED');assert.equal(result.allowCatalogPass,false);
assert.equal(sim.containers.size,0);assert.equal(sim.volumes.size,0);
assert.equal(sim.calls.filter(c=>c[1]==='create').length,4);
console.log('PASS ISSUE49 DOCKER TRANSPORT MOCK: 4 isolated local containers, PG17.11 pin, dump/restore and verified cleanup');

let negatives=0;
for(const [label,config,cleanupExpected] of [
 ['invalid image metadata',{wrongImageVersion:true},'NOT_REQUIRED_NO_RESOURCES'],
 ['owner label changed',{foreignLabel:true},'RESOURCE_REMAINS'],
 ['anonymous volume not deleted',{leaveVolume:true},'RESOURCE_REMAINS'],
 ['remote context injection',{remoteContext:true},'NOT_REQUIRED_NO_RESOURCES'],
 ['wrong immutable image ID',{wrongImageId:true},'NOT_REQUIRED_NO_RESOURCES'],
 ['network escape on inspection',{unsafeNetwork:true},'RESOURCE_REMAINS'],
 ['preexisting volume attached',{preexistingVolume:true},'RESOURCE_REMAINS'],
 ['required data volume missing',{missingDataVolume:true},'RESOURCE_REMAINS'],
 ['incomplete microcatalog',{incompleteCatalog:true},'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED'],
 ['transport inventory error code',{failedInventory:true},'RESOURCE_REMAINS'],
 ['transport restore error code',{failedRestore:true},'ALL_TRACKED_IDS_AND_VOLUMES_REMOVED'],
 ['transport daemon info error code',{failedInfo:true},'NOT_REQUIRED_NO_RESOURCES']
]){
 const fake=fakeCli(config);
 const d=createIssue49LocalDockerDriver({host,transport:fake.transport});
 const response=await runNativeTrialWithDriver({...cfg,trial,consent,driver:d});
 assert.equal(response.finding,'INCONCLUSIVE',label);
 assert.equal(response.cleanup,cleanupExpected,label);
 assert.equal(response.allowCatalogPass,false,label);
 negatives++;
}
assert.throws(()=>createIssue49LocalDockerDriver({host:'tcp://127.0.0.1:2375'}),
 /ISSUE49 DOCKER DRIVER STOP/);
negatives++;
console.log('PASS ISSUE49 DOCKER TRANSPORT NEGATIVES ('+negatives+' mocked failure cases; no Docker/subprocess/SQL)');
console.log('ISSUE49 DRIVER STATUS: NOT_EXECUTED / NO_GO_HOSTED_MIGRATION');
