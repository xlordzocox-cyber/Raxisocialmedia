// Issue49 D2: isolated, fake-only byte-response contract. NO net/http/pipe/spawn/SQL.
const fail=(code)=>{throw Error('ISSUE49 D2 RAW STOP: '+code);};
const MAX=8*1024*1024;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const simple=(o)=>o!==null&&typeof o==='object'&&
 !Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const data=(o,key)=>{
 const d=Object.getOwnPropertyDescriptor(o,key);
 return d&&own(d,'value')?d.value:undefined;
};
const exact=(obj,fields)=>simple(obj)&&Reflect.ownKeys(obj).length===fields.length&&
 fields.every(k=>own(obj,k)&&own(Object.getOwnPropertyDescriptor(obj,k),'value'));
const check=(ok,why)=>{if(!ok)fail(why);};
const IDENT=/^[a-f0-9]{64}$/;
const dense=(a,max)=>Array.isArray(a)&&a.length<=max&&
 Reflect.ownKeys(a).length===a.length+1&&
 Array.from({length:a.length},(_,i)=>i).every(i=>own(a,i));
const idValid=v=>typeof v==='string'&&IDENT.test(v);
const identityList=(arr,key)=>{
 check(dense(arr,10000),'malformed inventory array');
 const names=new Set();
 for(let i=0;i<arr.length;i++){
  const item=arr[i];
  check(simple(item)&&own(item,key)&&typeof item[key]==='string'&&
   (key==='Id'?idValid(item[key]):item[key].length>0&&item[key].trim()===item[key]),
   'missing inventory identity');
  check(!names.has(item[key]),'duplicate inventory identity');
  names.add(item[key]);
 }
 return arr;
};
const parseJsonBytes=(raw)=>{
 check(raw instanceof Uint8Array&&raw.byteLength>0&&raw.byteLength<=MAX,
   'invalid JSON bytes');
 let val;
 try{
  const copied=Uint8Array.from(raw);
  val=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(copied));
 }catch{fail('invalid UTF-8 or JSON');}
 return val;
};
export const ISSUE49_D2_RAW_CONTRACT='FAKE_BYTES_ONLY_NO_ENGINE';
export function parseIssue49D2RawResponse({operation,expectedStatus,response}){
 check(typeof operation==='string'&&Number.isInteger(expectedStatus),
  'invalid expected operation');
 check(exact(response,['status','bodyBytes']),'invalid response envelope');
 const status=data(response,'status'),body=data(response,'bodyBytes');
 check(status===expectedStatus&&Number.isInteger(status),'unexpected response status');
 check(body instanceof Uint8Array&&body.byteLength<=MAX,'invalid response bytes');
 if(operation==='startExec'){
  // Separate binary multiplex parser remains a later explicit integration gate.
  check(body.byteLength>0,'empty binary output');
  return Uint8Array.from(body);
 }
 if(operation==='startContainer'||operation==='deleteContainer'){
  check(body.byteLength===0,'unexpected mutation response');
  return true;
 }
 const parsed=parseJsonBytes(body);
 if(operation==='ping'){
  check(parsed==='OK','bad ping');return true;
 }
 if(operation==='listContainers')
  return identityList(parsed,'Id');
 if(operation==='listVolumes'){
  check(simple(parsed)&&own(parsed,'Volumes')&&own(parsed,'Warnings')&&
   (parsed.Warnings===null||
    (dense(parsed.Warnings,0))),'inventory warnings or shape invalid');
  identityList(parsed.Volumes,'Name');
  return parsed;
 }
 if(operation==='info'){
  check(simple(parsed)&&typeof parsed.ID==='string'&&parsed.ID.length>=4&&
   parsed.OSType==='linux','wrong daemon');return parsed;
 }
 if(operation==='inspectExec'){
  check(simple(parsed)&&parsed.Running===false&&parsed.ExitCode===0,
   'incomplete exec');return parsed;
 }
 fail('operation not allowlisted by raw prototype');
}
