// Issue #49 D2: PURE mock Engine API contract. NO socket, HTTP, subprocess, SQL,
// Docker SDK, filesystem, environment reads, or production transport.
// An injected exchange is only a fake test hook; there is no socket implementation.
const stop=(reason)=>{throw Error('ISSUE49 D2 MOCK STOP: '+reason);};
const ID=/^[a-f0-9]{64}$/;
const SESSION=/^[a-f0-9]{24}$/;
const ROLES=Object.freeze(['T0_SOURCE','T0_RESTORED','T1_SOURCE','T1_RESTORED']);
const PIN='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const LIMIT=8*1024*1024, PREFIX='/v1.51';
const own=(o,k)=>Object.hasOwn(o,k);
const data=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);return d&&own(d,'value')?d.value:undefined;};
const noAccessors=(o)=>Reflect.ownKeys(o).every(k=>own(Object.getOwnPropertyDescriptor(o,k),'value'));

const shape=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.getPrototypeOf(o)===Object.prototype&&
 Reflect.ownKeys(o).length===keys.length&&noAccessors(o)&&keys.every(k=>own(o,k));
const str=(v)=>typeof v==='string';
const roleSlug=(r)=>r.toLowerCase().replaceAll('_','-');
const idCheck=(s)=>str(s)&&ID.test(s);
const dense=(items,max)=>Array.isArray(items)&&items.length<=max&&
 Reflect.ownKeys(items).length===items.length+1&&
 Array.from({length:items.length},(_,i)=>i).every(i=>own(items,i));
const fixed=(sessionId,role)=>{
 if(!str(sessionId)||!SESSION.test(sessionId)||!ROLES.includes(role))
  stop('invalid session or role');
 return {name:'raxi-t0t1-'+sessionId+'-'+roleSlug(role),
  owner:'raxi.issue49.trial.'+sessionId};
};
const ensure=(ok,reason)=>{if(!ok)stop(reason);};
const copy=(x)=>JSON.parse(JSON.stringify(x));
const freezeDeep=(x)=>{
 if(x&&typeof x==='object'){
  for(const value of Object.values(x))freezeDeep(value);
  Object.freeze(x);
 }
 return x;
};
const requireObject=(x)=>ensure(x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype,'invalid JSON object');
const request=(method,path,body,expect)=>{
 ensure(str(method)&&str(path)&&path.startsWith(PREFIX+'/')&&!path.includes('..')&&
 !path.includes('%')&&!path.includes('#'),'unsafe path');
 return Object.freeze({method,path,body:body===undefined?null:freezeDeep(body),expect});
};
export const ISSUE49_D2_IMAGE_ID=PIN;
export const ISSUE49_D2_CONTRACT='D2_FAKE_ONLY_NO_PIPE_OR_DOCKER';

export function buildIssue49D2Request(input){
 requireObject(input);
 ensure(str(input.operation),'missing operation');
 ensure(noAccessors(input),'accessor request forbidden');
 const op=data(input,'operation');
 const global=['operation'];
 if(['ping','version','info','listVolumes','listContainers'].includes(op)){
  ensure(shape(input,global),'unexpected fields');
  const tails={ping:'/_ping',version:'/version',info:'/info',
   listVolumes:'/volumes',listContainers:'/containers/json?all=1'};
  return request('GET',PREFIX+tails[op],undefined,200);
 }
 if(op==='imageInspect'){
  ensure(shape(input,['operation','imageId'])&&input.imageId===PIN,'image not pinned');
  return request('GET',PREFIX+'/images/'+PIN+'/json',undefined,200);
 }
 if(op==='inspectContainer'||op==='startContainer'||op==='deleteContainer'){
  ensure(shape(input,['operation','id'])&&idCheck(input.id),'invalid container id');
  if(op==='inspectContainer')
   return request('GET',PREFIX+'/containers/'+input.id+'/json',undefined,200);
  if(op==='startContainer')
   return request('POST',PREFIX+'/containers/'+input.id+'/start',{},204);
  return request('DELETE',PREFIX+'/containers/'+input.id+'?force=1&v=1',undefined,204);
 }
 if(op==='createContainer'){
  ensure(shape(input,['operation','sessionId','role','imageId'])&&input.imageId===PIN,
   'container not pinned');
  const {name,owner}=fixed(input.sessionId,input.role);
  const body={
   Image:PIN,Labels:{'raxi.issue49.owner':owner},
   Env:['POSTGRES_HOST_AUTH_METHOD=trust'],
   Tty:false,AttachStdin:false,AttachStdout:false,AttachStderr:false,
   OpenStdin:false,
   HostConfig:{NetworkMode:'none',Privileged:false,PublishAllPorts:false,
    PortBindings:{},Binds:[],AutoRemove:false,RestartPolicy:{Name:'no'}}
  };
  return request('POST',PREFIX+'/containers/create?name='+name,body,201);
 }
 if(op==='createExec'){
  ensure(shape(input,['operation','id','commandKey'])&&idCheck(input.id)&&
    input.commandKey==='READY_TCP','exec command not allowlisted at D2');
  const body={AttachStdin:false,AttachStdout:true,AttachStderr:true,
   Tty:false,Privileged:false,Cmd:['pg_isready','-h','127.0.0.1','-p','5432','-U','postgres']};
  return request('POST',PREFIX+'/containers/'+input.id+'/exec',body,201);
 }
 if(op==='inspectExec'){
  ensure(shape(input,['operation','id'])&&idCheck(input.id),'invalid exec id');
  return request('GET',PREFIX+'/exec/'+input.id+'/json',undefined,200);
 }
 if(op==='startExec'){
  ensure(shape(input,['operation','id'])&&idCheck(input.id),'invalid exec id');
  return request('POST',PREFIX+'/exec/'+input.id+'/start',
   {Detach:false,Tty:false},200);
 }
 stop('operation not allowlisted');
}

export function parseIssue49D2Multiplexed(bytes){
 ensure(bytes instanceof Uint8Array&&bytes.byteLength<=LIMIT,'invalid/oversized multiplex bytes');
 let offset=0;
 const stdout=[],stderr=[];
 let outBytes=0,errBytes=0,frames=0;
 while(offset<bytes.length){
  ensure(bytes.length-offset>=8,'truncated stream header');
  const kind=bytes[offset];
  ensure((kind===1||kind===2)&&bytes[offset+1]===0&&
    bytes[offset+2]===0&&bytes[offset+3]===0,'unexpected multiplex header');
  const len=(((bytes[offset+4]*0x1000000)>>>0)+
    (bytes[offset+5]<<16)+(bytes[offset+6]<<8)+bytes[offset+7])>>>0;
  offset+=8;
  ensure(len<=LIMIT&&len<=bytes.length-offset,'truncated or oversized frame');
  ensure(++frames<=100000,'too many frames');
  const frame=Uint8Array.from(bytes.subarray(offset,offset+len));
  if(kind===1){outBytes+=len;ensure(outBytes<=LIMIT,'stdout size exceeded');stdout.push(frame);}
  else{errBytes+=len;ensure(errBytes<=65536,'stderr size exceeded');stderr.push(frame);}
  offset+=len;
 }
 const concat=(parts,size)=>{
  const data=new Uint8Array(size);let cursor=0;
  for(const part of parts){data.set(part,cursor);cursor+=part.length;}
  return data;
 };
 return Object.freeze({stdout:concat(stdout,outBytes),stderr:concat(stderr,errBytes),frames});
}

function checkResponse(operation,result,expected){
 ensure(shape(result,['status','data'])&&Number.isInteger(result.status)&&
  result.status===expected,'unexpected HTTP status or response shape');
 const d=result.data;
 if(operation==='ping'){ensure(d==='OK','bad ping');return true;}
 if(operation==='startContainer'||operation==='deleteContainer'){
  ensure(d===null,'mutating operation returned unexpected data');
  return true;
 }
 if(operation==='startExec'){
  ensure(d instanceof Uint8Array,'exec output must be binary framed');
  return parseIssue49D2Multiplexed(d);
 }
 if(operation==='listContainers'){
  const valid=items=>dense(items,10000)&&items.every(x=>x!==null&&
    typeof x==='object'&&!Array.isArray(x)&&idCheck(x.Id))&&
    new Set(items.map(x=>x.Id)).size===items.length;
  ensure(valid(d)&&d.every(item=>noAccessors(item)),'bad container inventory');
  const before=d.map(item=>data(item,'Id'));
  const snap=copy(d);
  ensure(valid(snap)&&snap.every((item,i)=>item.Id===before[i]),
   'serialized container identity changed');
  return snap;
 }
 requireObject(d);
 if(operation==='info'){
  ensure(str(d.ID)&&d.ID.length>=4&&d.OSType==='linux','bad Linux daemon identity');
 }
 if(operation==='version'){
  ensure(str(d.ApiVersion)&&/^1\.[0-9]{1,3}$/.test(d.ApiVersion)&&
   str(d.Version)&&d.Version.length>0,'untrusted Engine API version');
 }
 if(operation==='imageInspect'){
  ensure(d.Id===PIN&&d.Os==='linux'&&d.Architecture==='amd64'&&
   Array.isArray(d.Config?.Env)&&d.Config.Env.filter(v=>str(v)&&
     /^PG_VERSION=17\.11(?:-|$)/.test(v)).length===1,
   'untrusted image metadata');
 }
 if(operation==='createContainer'||operation==='createExec'){
  ensure(idCheck(d.Id),'missing created identity');
 }
 if(operation==='inspectExec'){
  ensure(d.Running===false&&d.ExitCode===0,'exec incomplete or failed');
 }
 if(operation==='listVolumes'){
  const valid=inventory=>inventory!==null&&typeof inventory==='object'&&
   dense(inventory.Volumes,10000)&&inventory.Volumes.every(v=>v!==null&&
    typeof v==='object'&&!Array.isArray(v)&&str(v.Name)&&
    v.Name.length>0&&v.Name.trim()===v.Name)&&
   new Set(inventory.Volumes.map(v=>v.Name)).size===inventory.Volumes.length&&
   (inventory.Warnings===null||dense(inventory.Warnings,0));
  ensure(valid(d)&&d.Volumes.every(item=>noAccessors(item)),
   'bad volume inventory');
  const before=d.Volumes.map(item=>data(item,'Name'));
  const snap=copy(d);
  ensure(valid(snap)&&snap.Volumes.every((item,i)=>item.Name===before[i]),
   'serialized volume identity changed');
  return snap;
 }
 if(operation==='inspectContainer'){
  ensure(idCheck(d.Id),'bad container inspect');
 }
 return copy(d);
}

// Deliberately fake-only; cannot connect to Docker unless an external caller
// supplies a side-effectful exchange (out of D2 authorization).
export function createIssue49D2MockTransport({exchange,gate}){
 ensure(gate==='ISSUE49_D2_FAKE_ONLY'&&typeof exchange==='function',
  'D2 offline test gate required');
 return Object.freeze({
  contract:ISSUE49_D2_CONTRACT,
  async call(input){
   const descriptor=buildIssue49D2Request(input);
   const selected=data(input,'operation');
   const answer=await exchange(descriptor);
   return checkResponse(selected,answer,descriptor.expect);
  }
 });
}
