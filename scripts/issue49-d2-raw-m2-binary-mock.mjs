// Issue49 D2 M2 BINARY CANDIDATE: copied from reviewed M1, isolated mock only.
// No transport / Docker / network / SQL / socket. Historical RAW v2 remains unchanged.
const STOP=reason=>{throw Error('ISSUE49 D2 RAW V2 STOP: '+reason);};
const requireTrue=(ok,why)=>{if(!ok)STOP(why);};
const MAX=8*1024*1024,DEPTH=64,ITEMS=10000, ID=/^[a-f0-9]{64}$/;
const PIN='sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe';
const owned=new WeakMap();
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const nativeSlice=Uint8Array.prototype.slice;
const validStatus=n=>Number.isInteger(n)&&n>=100&&n<=599;
const make=(status,bytes)=>{
 requireTrue(validStatus(status)&&bytes.length<=MAX,'status or size');
 const token=Object.freeze(Object.create(null));
 owned.set(token,Object.freeze({status,bytes}));
 return token;
};
// TRUSTED MOCK SOURCE: status and primitive text are supplied by the local test,
 // never by network, plugin, UI, agent or user response object.
export function issue49RawM2JsonFixture(status,text){
 requireTrue(typeof text==='string'&&text.length<=MAX,'JSON fixture must be primitive string');
 return make(status,encoder.encode(text));
}
export function issue49RawM2BinaryFixture(status,hex){
 requireTrue(typeof hex==='string'&&hex.length<=MAX*2&&hex.length%2===0&&
  /^[0-9a-fA-F]*$/.test(hex),'binary fixture must be primitive hex');
 const bytes=new Uint8Array(hex.length/2);
 for(let i=0;i<bytes.length;i++)bytes[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
 return make(status,bytes);
}
export function issue49RawM2TextFixture(status,text){
 requireTrue(typeof text==='string'&&text.length<=MAX,'text fixture must be primitive string');
 return make(status,encoder.encode(text));
}
function parseStrict(bytes){
 requireTrue(bytes.length>0,'empty JSON');
 let text;
 try{text=decoder.decode(bytes);}catch{STOP('invalid UTF-8');}
 let at=0,tokens=0;
 const ws=()=>{while(at<text.length&&/\s/.test(text[at])){
  requireTrue(' \n\r\t'.includes(text[at]),'non-JSON whitespace');at++;
 }};
 const scanString=()=>{
  requireTrue(text[at]==='"','expected JSON string');
  const start=at++;let escaped=false;
  while(at<text.length){
   const c=text[at++];
   if(escaped){
    if(c==='u'){
     requireTrue(/^[0-9a-fA-F]{4}$/.test(text.slice(at,at+4)),'bad unicode escape');
     at+=4;
    }else requireTrue('"\\/bfnrt'.includes(c),'bad escape');
    escaped=false;continue;
   }
   if(c==='\\'){escaped=true;continue;}
   if(c==='"')return JSON.parse(text.slice(start,at));
   requireTrue(c.charCodeAt(0)>=32,'unescaped control');
  }
  STOP('unterminated JSON string');
 };
 const number=()=>{
  const chunk=text.slice(at);
  const hit=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(chunk);
  requireTrue(Boolean(hit),'bad number');
  at+=hit[0].length;
 };
 const literal=word=>{requireTrue(text.slice(at,at+word.length)===word,'invalid literal');at+=word.length;};
 const value=depth=>{
  requireTrue(depth<=DEPTH&&++tokens<=100000,'depth or token limit');ws();
  const c=text[at];
  if(c==='"'){scanString();return;}
  if(c==='{'||c==='['){
   const object=c==='{',close=object?'}':']';
   at++;ws();if(text[at]===close){at++;return;}
   const seen=new Set();let count=0;
   while(true){
    requireTrue(++count<=ITEMS,'oversized object or array');ws();
    if(object){
     const key=scanString();
     requireTrue(!seen.has(key),'duplicate JSON key');
     seen.add(key);ws();
     requireTrue(text[at++]===':','expected colon');
    }
    value(depth+1);ws();
    if(text[at]===close){at++;return;}
    requireTrue(text[at++ ]===',','expected comma');ws();
   }
  }
  if(c==='t'){literal('true');return;}
  if(c==='f'){literal('false');return;}
  if(c==='n'){literal('null');return;}
  number();
 };
 value(0);ws();requireTrue(at===text.length,'trailing garbage');
 let result;
 try{result=JSON.parse(text);}catch{STOP('invalid JSON');}
 return result;
}
// Parse a token-owned Docker Engine API non-TTY multiplex stream offline.
// No raw external Uint8Array accepted. Stream receipt != process exit success.
const FRAME_LIMIT=100000, STDERR_LIMIT=65536;
function readMultiplex(bytes){
 requireTrue(bytes.length<=MAX,'oversized multiplex stream');
 let offset=0,frames=0,outSize=0,errSize=0;
 const stdout=[],stderr=[];
 while(offset<bytes.length){
  requireTrue(bytes.length-offset>=8,'truncated multiplex header');
  const kind=bytes[offset];
  requireTrue((kind===1||kind===2)&&bytes[offset+1]===0&&
   bytes[offset+2]===0&&bytes[offset+3]===0,
   'invalid multiplex stream channel or reserved header');
  const length=bytes[offset+4]*0x1000000+bytes[offset+5]*0x10000+
   bytes[offset+6]*0x100+bytes[offset+7];
  offset+=8;
  requireTrue(length<=MAX&&length<=bytes.length-offset,
   'multiplex frame exceeds available bytes');
  requireTrue(++frames<=FRAME_LIMIT,'too many multiplex frames');
  const frame=new Uint8Array(length);
  for(let i=0;i<length;i++)frame[i]=bytes[offset+i];
  if(kind===1){
   outSize+=length;requireTrue(outSize<=MAX,'stdout exceeded maximum');
   stdout.push(frame);
  }else{
   errSize+=length;requireTrue(errSize<=STDERR_LIMIT,'stderr exceeded maximum');
   stderr.push(frame);
  }
  offset+=length;
 }
 const join=(parts,size)=>{
  const result=new Uint8Array(size);let at=0;
  for(const part of parts){result.set(part,at);at+=part.length;}
  return result;
 };
 // Binary stream is not proof of exit code; inspectExec is separately required.
 return Object.freeze({stdout:join(stdout,outSize),stderr:join(stderr,errSize),
  frames,executionConfirmed:false,streamValidated:true});
}
const isRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ids=(items,key)=>{
 requireTrue(Array.isArray(items)&&items.length<=ITEMS,'invalid inventory array');
 const unique=new Set();
 for(const item of items){
  requireTrue(isRecord(item)&&typeof item[key]==='string','invalid inventory identity');
  const ident=item[key];
  requireTrue((key==='Id'?ID.test(ident):ident.length>0&&ident.trim()===ident)&&
   !unique.has(ident),'invalid or duplicate identity');
  unique.add(ident);
 }
 return items;
};
// This processor NEVER reads properties from an input token, only WeakMap metadata.
export function issue49RawM2Check(token,operation,expectedStatus){
 requireTrue(owned.has(token),'untrusted response token');
 requireTrue(typeof operation==='string'&&Number.isInteger(expectedStatus),'invalid operation/status');
 const expectedByOperation=Object.freeze({
  ping:200,version:200,info:200,imageInspect:200,listVolumes:200,
  listContainers:200,inspectContainer:200,createContainer:201,
  startContainer:204,deleteContainer:204,createExec:201,
  inspectExec:200,startExec:200
 });
 requireTrue(Object.hasOwn(expectedByOperation,operation)&&
  expectedStatus===expectedByOperation[operation],
  'operation HTTP status not allowlisted');
 const {status,bytes}=owned.get(token);
 requireTrue(status===expectedStatus,'unexpected response status');
 if(operation==='startContainer'||operation==='deleteContainer'){
  requireTrue(bytes.length===0,'unexpected mutation body');return true;
 }
 if(operation==='startExec'){
  // Valid Docker non-TTY multiplex stream ONLY; does NOT prove successful exec.
  return readMultiplex(bytes);
 }
 if(operation==='ping'){
  requireTrue(bytes.length===2&&bytes[0]===79&&bytes[1]===75,
   'plain-text ping must be exact two bytes OK');
  return true;
 }
 const parsed=parseStrict(bytes);
 if(operation==='listContainers')return ids(parsed,'Id');
 if(operation==='listVolumes'){
  requireTrue(isRecord(parsed)&&Object.hasOwn(parsed,'Volumes')&&
   Object.hasOwn(parsed,'Warnings')&&
   (parsed.Warnings===null||(Array.isArray(parsed.Warnings)&&parsed.Warnings.length===0)),
   'bad volume shape/warnings');
  ids(parsed.Volumes,'Name');return parsed;
 }
 if(operation==='version'){
  requireTrue(isRecord(parsed)&&typeof parsed.ApiVersion==='string'&&
   /^1\.[0-9]{1,3}$/.test(parsed.ApiVersion)&&
   typeof parsed.Version==='string'&&parsed.Version.length>0,
   'untrusted Engine API version');return parsed;
 }
 if(operation==='imageInspect'){
  requireTrue(isRecord(parsed)&&parsed.Id===PIN&&parsed.Os==='linux'&&
   parsed.Architecture==='amd64'&&
   isRecord(parsed.Config)&&Array.isArray(parsed.Config.Env)&&
   parsed.Config.Env.filter(x=>typeof x==='string'&&
    x.startsWith('PG_VERSION=')).length===1&&
   parsed.Config.Env.some(x=>typeof x==='string'&&
    /^PG_VERSION=17\.11(?:-|$)/.test(x)),
   'untrusted image metadata');return parsed;
 }
 if(operation==='inspectContainer'){
  requireTrue(isRecord(parsed)&&typeof parsed.Id==='string'&&
   ID.test(parsed.Id),'bad container inspect');return parsed;
 }
 if(operation==='createContainer'||operation==='createExec'){
  requireTrue(isRecord(parsed)&&typeof parsed.Id==='string'&&
   ID.test(parsed.Id),'missing created identity');return parsed;
 }
 if(operation==='info'){
  requireTrue(isRecord(parsed)&&typeof parsed.ID==='string'&&parsed.ID.length>=4&&
   parsed.OSType==='linux','bad daemon identity');return parsed;
 }
 if(operation==='inspectExec'){
  requireTrue(isRecord(parsed)&&parsed.Running===false&&parsed.ExitCode===0,'failed exec');
  return parsed;
 }
 STOP('operation not allowlisted');
}
export const ISSUE49_RAW_M2_STATUS='M2_BINARY_CANDIDATE_FAKE_ONLY_NO_TRANSPORT';
export const ISSUE49_RAW_M2_IMAGE_ID=PIN;
// No open socket, no HTTP/client, no raw bytes external adapter, no named pipe.
