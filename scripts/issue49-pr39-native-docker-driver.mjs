// Issue49 LOCAL Docker adapter: exported factory only, NO top-level execution.
// The separate native runner core performs scope/consent checks before calling it.
// NO remote hosts, auto-pull, published ports, bind mounts, or global prune.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {platform as osPlatform} from 'node:os';
const stop=msg=>{throw Error('ISSUE49 DOCKER DRIVER STOP: '+msg);};
const SHA=/^[a-f0-9]{64}$/;
const IMAGE=/^sha256:[a-f0-9]{64}$/;
const windows='npipe:////./pipe/dockerDesktopLinuxEngine';
const hosts={win32:[windows,'npipe:////./pipe/docker_engine'],
 linux:['unix:///var/run/docker.sock']};
const dockerPath={win32:'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
 linux:'/usr/bin/docker'};
const MAX=8*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const sqlFor=role=>'CREATE TABLE public.raxi_workspaces (\n'+
 '  slug text NOT NULL CHECK ('+(role.startsWith('T0_')
 ? "length(slug) BETWEEN 2 AND 64 AND slug ~ '^[a-z0-9-]+$'"
 : "length(slug) >= 2 AND length(slug) <= 64 AND slug ~ '^[a-z0-9-]+$'")+')\n);\n';
const catalogSql=`
SELECT json_build_object(
 'constraint_name',c.conname,'type',c.contype,'validated',c.convalidated,
 'local',c.conislocal,'noinherit',c.connoinherit,'inhcount',c.coninhcount,
 'conbin',c.conbin::text,'definition',pg_get_constraintdef(c.oid,true),
 'slug_notnull',a.attnotnull,'slug_type',format_type(a.atttypid,a.atttypmod),
 'slug_collation',a.attcollation::regcollation::text,
 'tablecount',(SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace),
 'constraintcount',(SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace)
)
FROM pg_constraint c
JOIN pg_class t ON t.oid=c.conrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname='slug'
WHERE n.nspname='public' AND t.relname='raxi_workspaces'
AND c.contype='c' AND c.conname='raxi_workspaces_slug_check';
`.trim();
async function command({binary,host,args,input,permitFailure=false}){
 if(!hosts[osPlatform()]?.includes(host))stop('non-local endpoint');
 if(!Array.isArray(args)||args.some(x=>typeof x!=='string'))stop('invalid argv');
 if(input!==undefined&&!(input instanceof Uint8Array)&&typeof input!=='string')stop('invalid stdin');
 return await new Promise((resolve,reject)=>{
  const child=spawn(binary,['--host',host,...args],{
   shell:false,windowsHide:true,
   env:{PATH:process.env.PATH||'',SystemRoot:process.env.SystemRoot||'',
     HOME:process.env.HOME||'',USERPROFILE:process.env.USERPROFILE||''},
   stdio:['pipe','pipe','pipe']
  });
  const output=[];let size=0,errBytes=0,failed=false;
  const timeout=setTimeout(()=>{failed=true;child.kill();},25000);
  child.stdout.on('data',chunk=>{
   size+=chunk.length;
   if(size>MAX){failed=true;child.kill();return;}
   output.push(chunk);
  });
  child.stderr.on('data',chunk=>{errBytes+=chunk.length;
   if(errBytes>65536){failed=true;child.kill();}});
  child.on('error',()=>{clearTimeout(timeout);reject(Error('DOCKER_SUBPROCESS_UNAVAILABLE'));});
  child.on('close',(code)=>{
   clearTimeout(timeout);
   if(failed||code===null||(!permitFailure&&code!==0))reject(Error('DOCKER_COMMAND_FAILED'));
   else resolve({code,bytes:Buffer.concat(output)});
  });
  // A stopped child can close its stdin first; never allow an uncaught EPIPE.
  child.stdin.on('error',()=>{failed=true;child.kill();});
  if(input!==undefined)child.stdin.end(input);
  else child.stdin.end();
 });
}
const parseJson=bytes=>{try{return JSON.parse(bytes.toString('utf8'));}catch{stop('invalid JSON attestation');}};
export function createIssue49LocalDockerDriver({host,transport=command}){
 const platform=osPlatform();
 if(typeof transport!=='function')stop('transport must be callable');
 if(!hosts[platform]?.includes(host)||!dockerPath[platform])
  stop('unsupported host/platform');
 const binary=dockerPath[platform];
 let pinnedDaemonId=null,attestedImageId=null,baselineVolumes=new Set();
 const created=new Map(),inspected=new Map(),removalRequested=new Set();
 const registered=(id,spec)=>{
  if(!SHA.test(id)||!created.has(id)||!inspected.has(id))stop('unknown or uninspected container');
  const expected=created.get(id);
  if(spec&&(spec.name!==expected.name||spec.ownerLabel!==expected.ownerLabel||
    spec.role!==expected.role||spec.imageId!==expected.imageId))
    stop('container ownership binding changed');
  return expected;
 };
 const run=(args,input,permitFailure=false)=>transport({binary,host,args,input,permitFailure});
 const inspectContainer=async id=>{
  const out=await run(['container','inspect',id]);
  const list=parseJson(out.bytes);
  if(!Array.isArray(list)||list.length!==1)stop('invalid inspect count');
  return list[0];
 };
 const owner=x=>x?.Config?.Labels?.['raxi.issue49.owner'];
 return Object.freeze({
  async attestLocal({host:required}){
   if(required!==host)stop('changed local host');
   const contextName=host===windows?'desktop-linux':'default';
   const contexts=parseJson((await run(['context','inspect',contextName])).bytes);
   if(!Array.isArray(contexts)||contexts.length!==1||
      contexts[0].Name!==contextName||
      contexts[0].Endpoints?.docker?.Host!==host||
      contexts[0].Endpoints?.docker?.SkipTLSVerify!==false)
      stop('Docker context no longer points to local socket');
   const x=parseJson((await run(['info','--format','{{json .}}'])).bytes);
   if(x.OSType!=='linux'||typeof x.ID!=='string'||x.ID.length<4)
      stop('not Linux daemon');
   if(pinnedDaemonId!==null&&x.ID!==pinnedDaemonId)
      stop('daemon identity changed');
   pinnedDaemonId=x.ID;
   const inventory=await run(['volume','ls','--format','{{.Name}}']);
   const preexistingVolumes=inventory.bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
   if(preexistingVolumes.length>10000||new Set(preexistingVolumes).size!==preexistingVolumes.length)
      stop('unbounded or duplicate volume inventory');
   baselineVolumes=new Set(preexistingVolumes);
   return {host,local:true,verified:true,daemonId:x.ID,preexistingVolumes};
  },
  async attestImage({imageId}){
   if(!IMAGE.test(imageId))stop('image ID required');
   const x=parseJson((await run(['image','inspect',imageId])).bytes);
   if(!Array.isArray(x)||x.length!==1||x[0].Id!==imageId||
     x[0].Os!=='linux'||x[0].Architecture!=='amd64'||
     !x[0].Config?.Env?.some(v=>/^PG_VERSION=17\.11(?:-|$)/.test(v)))
     stop('image ID, OS, architecture or PostgreSQL version mismatch');
   if(attestedImageId!==null&&attestedImageId!==imageId)
     stop('attested image changed');
   attestedImageId=imageId;
   return {id:imageId,version:'17.11',os:'linux',architecture:'amd64',verified:true};
  },
  async create({spec,host:required}){
   if(required!==host||pinnedDaemonId===null||spec.imageId!==attestedImageId||
     !IMAGE.test(spec.imageId)||
     !/^raxi-t0t1-[a-f0-9]{24}-(?:t0|t1)-(?:source|restored)$/.test(spec.name)||
     spec.ownerLabel!=='raxi.issue49.trial.'+spec.name.slice(10,34))
     stop('unsafe container request');
   const x=await run(['container','create','--name',spec.name,
    '--label','raxi.issue49.owner='+spec.ownerLabel,'--network','none',
    '--pull','never','--restart','no',
    '--env','POSTGRES_HOST_AUTH_METHOD=trust',spec.imageId]);
   const id=x.bytes.toString('utf8').trim();
   if(!SHA.test(id)||created.has(id))stop('invalid or duplicated created ID');
   created.set(id,Object.freeze({...spec}));
   return id;
  },
  async inspect({id,spec}){
   if(!SHA.test(id)||!created.has(id))stop('inspect foreign resource denied');
   const expected=created.get(id);
   if(!spec||spec.name!==expected.name||spec.ownerLabel!==expected.ownerLabel||
      spec.imageId!==expected.imageId||spec.role!==expected.role)
      stop('inspect specification changed');
   const x=await inspectContainer(id);
   if(x.Id!==id||owner(x)!==spec.ownerLabel||
      x.Image!==spec.imageId||x.Name!=='/'+spec.name||
      x.HostConfig?.NetworkMode!=='none'||
      x.HostConfig?.Privileged!==false||
      Boolean(x.HostConfig?.Binds?.length)||
      Object.values(x.HostConfig?.PortBindings||{}).some(v=>Array.isArray(v)&&v.length>0))
      stop('foreign, privileged, networked or exposed resource');
   const mounts=x.Mounts||[];
   if(!Array.isArray(mounts)||mounts.length!==1||
      mounts.some(m=>m.Type!=='volume'||!SHA.test(m.Name)||
        m.Destination!=='/var/lib/postgresql/data'||
        baselineVolumes.has(m.Name)||
        [...inspected].some(([otherId,vols])=>otherId!==id&&vols.includes(m.Name))))
      stop('unknown, preexisting or shared storage mount');
   inspected.set(id,mounts.map(m=>m.Name));
   const mappings=x.HostConfig?.PortBindings||{};
   const ports=Object.values(mappings).some(v=>Array.isArray(v)&&v.length>0);
   return {id:x.Id,name:String(x.Name||'').replace(/^\//,''),
    role:spec.role,ownerLabel:owner(x),imageId:x.Image,
    network:x.HostConfig?.NetworkMode,ports,privileged:x.HostConfig?.Privileged,
    bindMounts:Boolean(x.HostConfig?.Binds?.length),
    anonymousVolumes:mounts.map(m=>m.Name),existing:false};
  },
  async start({id,spec}){
   registered(id,spec);
   await run(['container','start',id]);
   for(let i=0;i<25;i++){
    const r=await run(['container','exec',id,'pg_isready','-U','postgres'],undefined,true);
    if(r.code===0)return;
    await new Promise(resolve=>setTimeout(resolve,400));
   }
   stop('postgres did not become ready');
  },
  async initialize({id,spec}){
   registered(id,spec);
   const sql=sqlFor(spec.role);
   if(hash(sql)!==spec.ddlSha256)stop('DDL differs from pinned micro-schema');
   await run(['container','exec','-i',id,'psql','-U','postgres','-d','postgres',
     '-v','ON_ERROR_STOP=1','--single-transaction'],sql);
  },
  async dump({id,spec}){
   registered(id,spec);
   const r=await run(['container','exec',id,'pg_dump','-U','postgres','-d','postgres',
      '-Fc','--schema=public','--no-owner','--no-acl']);
   if(r.bytes.length===0)stop('empty dump');
   return r.bytes;
  },
  async restore({id,spec,archive}){
   registered(id,spec);
   if(!(archive instanceof Uint8Array)||
      archive.length===0||archive.length>MAX)stop('bad restore input');
   await run(['container','exec','-i',id,'pg_restore','-U','postgres','-d','postgres',
      '--single-transaction','--exit-on-error','--no-owner','--no-acl'],archive);
  },
  async catalog({id,spec}){
   registered(id,spec);
   const result=await run(['container','exec',id,'psql','-U','postgres','-d','postgres',
    '-tA','-v','ON_ERROR_STOP=1','-c',catalogSql]);
   const row=parseJson(result.bytes);
   const actual=JSON.stringify(row);
   if(row?.constraint_name!=='raxi_workspaces_slug_check'||row.type!=='c'||
      row.validated!==true||row.slug_notnull!==true||
      row.tablecount!=='1'&&row.tablecount!==1||
      row.constraintcount!=='1'&&row.constraintcount!==1)
      stop('unexpected microcatalog');
   const build=parseJson((await run(['container','exec',id,'psql','-U','postgres',
     '-d','postgres','-tA','-v','ON_ERROR_STOP=1','-c',
     "SELECT json_build_array(current_setting('server_version'), current_setting('server_encoding'), current_setting('lc_collate'), current_setting('lc_ctype'))"])).bytes);
   if(!Array.isArray(build)||build[0]!=='17.11')stop('unexpected database build');
   return {conbinSha256:hash(String(row.conbin)),
    catalogSha256:hash(actual),buildSha256:hash(JSON.stringify(build))};
  },
  async remove({id,spec,anonymousVolumes}){
   registered(id,spec);
   const known=inspected.get(id);
   if(!Array.isArray(anonymousVolumes)||anonymousVolumes.length!==known.length||
      anonymousVolumes.some((v,i)=>v!==known[i]))
     stop('cleanup volumes not bound to inspection');
   await run(['container','rm','-f','-v',id]);
   removalRequested.add(id);
  },
  async confirmRemoved({id,spec,anonymousVolumes}){
   registered(id,spec);
   const known=inspected.get(id);
   if(!removalRequested.has(id)||!Array.isArray(anonymousVolumes)||
     anonymousVolumes.length!==known.length||
     anonymousVolumes.some((v,i)=>v!==known[i])||pinnedDaemonId===null)
     stop('bad removal evidence');
   const info=parseJson((await run(['info','--format','{{json .}}'])).bytes);
   if(info.ID!==pinnedDaemonId||info.OSType!=='linux')
     stop('daemon changed during cleanup');
   // Query successful inventories; a failed inspect is NOT proof of deletion.
   const containers=(await run(['container','ls','-a','--no-trunc',
     '--format','{{.ID}}'])).bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
   const volumes=(await run(['volume','ls','--format',
     '{{.Name}}'])).bytes.toString('utf8').split(/\r?\n/).filter(Boolean);
   const containerGone=!containers.includes(id);
   const volumesGone=anonymousVolumes.every(v=>!volumes.includes(v));
   if(containerGone&&volumesGone){
     created.delete(id);inspected.delete(id);removalRequested.delete(id);
   }
   return {containerGone,volumesGone};
  }
 });
}
