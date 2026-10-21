/** Server-only bounded coordinator. No scheduling, provider call or deployment on import. */
export interface TaskSpec {
 question: string; externalResearch: boolean; provider: string; model: string;
 authorization: { confirmed: true; maxCostMicros: number; expiresAt: string };
}
export interface Source { id: string; url: string; content: string; sha256: string; capturedAt: string }
export interface Claim {
 task: { id: string; input_snapshot: { spec: TaskSpec; policy: { simulated: boolean; max_output_tokens: number } } };
 run: { id: string; lease_token: string; lease_until: string; stage: 'DIRECTOR'|'RESEARCHER'; simulated: boolean; provider: string; model: string; reserved_micros: number };
 previous: { summary: string } | null;
}
export interface RuntimeRepository {
 request(actor: string,workspace: string,key: string,spec: TaskSpec): Promise<string>;
 claim(task: string,worker: string): Promise<Claim|null>;
 step(run: string,token: string,kind: 'ack'|'finish'|'unknown',result?: unknown,receipt?: string,cost?: number): Promise<unknown>;
}
export interface Provider {
 id: string; simulated: boolean;
 start(input: { stage: string; model: string; question: string; previous: string|null; sources: Source[]; maxOutputTokens: number; runId: string },signal: AbortSignal): Promise<{receipt:string; output:unknown; knownCostMicros?:number}>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function taskSpec(value: unknown): TaskSpec {
 const s=value as TaskSpec;
 if(!s||Object.keys(s).some(k=>!['question','externalResearch','provider','model','authorization'].includes(k))||
   typeof s.question!=='string'||s.question.trim().length<5||s.question.length>1500||typeof s.externalResearch!=='boolean'||
   !/^[a-z0-9-]{1,50}$/.test(s.provider)||!/^[a-zA-Z0-9._-]{1,100}$/.test(s.model)||!s.authorization||
   Object.keys(s.authorization).some(k=>!['confirmed','maxCostMicros','expiresAt'].includes(k))||s.authorization.confirmed!==true||
   !Number.isSafeInteger(s.authorization.maxCostMicros)||s.authorization.maxCostMicros<0||
   !Number.isFinite(Date.parse(s.authorization.expiresAt))) throw Error('Invalid task authorization');
 return structuredClone(s);
}
export function requestHandler(deps:{verifyUser(token:string):Promise<{id:string;isAnonymous:boolean}|null>;repository:RuntimeRepository}) {
 return async(request:Request)=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const token=/^Bearer (\S+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  const user=token?await deps.verifyUser(token):null;if(!user||user.isAnonymous)return new Response(null,{status:401});
  try {
   if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('Content type');
   let size=0;const chunks:Uint8Array[]=[];const reader=request.body?.getReader();if(!reader)throw Error('Body');
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8000){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const body=JSON.parse(new TextDecoder().decode(bytes));
   if(Object.keys(body).some(k=>!['workspaceId','requestKey','spec'].includes(k))||!uuid.test(body.workspaceId)||!uuid.test(body.requestKey))throw Error('Command');
   const id=await deps.repository.request(user.id,body.workspaceId,body.requestKey,taskSpec(body.spec));
   return Response.json({taskId:id},{headers:{'Cache-Control':'no-store'}});
  } catch{return Response.json({error:'Task not authorized or not confirmed'},{status:400});}
 };
}
async function verifiedSources(sources:Source[],hosts:ReadonlySet<string>):Promise<Source[]> {
 if(sources.length>4)throw Error('Source limit');
 const ids=new Set<string>();
 for(const s of sources){const url=new URL(s.url);if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password||ids.has(s.id)||!s.id||s.content.length>3000||!s.content||!Number.isFinite(Date.parse(s.capturedAt)))throw Error('Untrusted source receipt');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s.content))),x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==s.sha256)throw Error('Source integrity');ids.add(s.id);
 }return structuredClone(sources);
}
export async function runOne(deps:{repository:RuntimeRepository;providers:ReadonlyMap<string,Provider>;workerId:string;liveEnabled?:boolean;retrieve?:(question:string)=>Promise<Source[]>;sourceHosts?:ReadonlySet<string>},task:string) {
 const claim=await deps.repository.claim(task,deps.workerId);if(!claim)return {claimed:false};
 const {run}=claim; const spec=taskSpec(claim.task.input_snapshot.spec);
 let knownCost:number|undefined;
 try {
  const provider=deps.providers.get(run.provider);
  if(!provider||provider.simulated!==run.simulated||(!provider.simulated&&!deps.liveEnabled))throw Error('Provider not enabled');
  let sources:Source[]=[];
  if(spec.externalResearch&&run.stage==='RESEARCHER'){
   if(!deps.retrieve)throw Error('External retrieval not configured');
   sources=await verifiedSources(await deps.retrieve(spec.question),deps.sourceHosts??new Set());if(!sources.length)throw Error('Sources required');
  }
  const deadline=Math.min(Date.parse(run.lease_until),Date.parse(spec.authorization.expiresAt));
  if(!Number.isFinite(deadline)||deadline<=Date.now()+45000)throw Error('Insufficient authorized lease for provider call');
  // No tools, credentials, approval methods or SQL are available to the model.
  const output=await provider.start({stage:run.stage,model:run.model,question:spec.question,previous:claim.previous?.summary??null,sources,maxOutputTokens:claim.task.input_snapshot.policy.max_output_tokens,runId:run.id},AbortSignal.timeout(45000));
  if(output.knownCostMicros!==undefined){if(!Number.isSafeInteger(output.knownCostMicros)||output.knownCostMicros<0)throw Error('Invalid cost receipt');knownCost=output.knownCostMicros;}
  if(typeof output.receipt!=='string'||!output.receipt||output.receipt.length>200)throw Error('Provider did not acknowledge');
  await deps.repository.step(run.id,run.lease_token,'ack',undefined,output.receipt);
  const result=output.output as {summary:string;sourceIds:string[]};
  if(!result||Object.keys(result).some(k=>!['summary','sourceIds'].includes(k))||typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>6000||
   !Array.isArray(result.sourceIds)||new Set(result.sourceIds).size!==result.sourceIds.length||result.sourceIds.some(id=>!sources.some(s=>s.id===id))||
   (spec.externalResearch&&run.stage==='RESEARCHER'&&result.sourceIds.length===0))throw Error('Unsupported output or citations');
  const canonical={summary:result.summary,sourceIds:result.sourceIds,sources:sources.filter(s=>result.sourceIds.includes(s.id)),simulated:run.simulated,
   verification:result.sourceIds.length?'CITED_SOURCES_NOT_FACT_CHECKED':'MODEL_OUTPUT_NOT_FACT_CHECKED'};
  await deps.repository.step(run.id,run.lease_token,'finish',canonical,undefined,output.knownCostMicros);
  return {claimed:true,stage:run.stage,simulated:run.simulated};
 }catch{
  // After any provider/transport uncertainty retain the reservation and never auto-charge a retry.
  try{await deps.repository.step(run.id,run.lease_token,'unknown',undefined,undefined,knownCost);}catch{/* Lease expiry is reconciled by the durable claim/office projection. */}
  return {claimed:true,uncertain:true,simulated:run.simulated};
 }
}
export function rpcRepository(client:{rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}):RuntimeRepository {
 const rpc=async(name:string,args:Record<string,unknown>)=>{const r=await client.rpc(name,args);if(r.error)throw Error('Runtime operation not confirmed');return r.data;};
 return {request:async(actor,workspace,key,spec)=>await rpc('raxi_runtime_request',{p_actor:actor,p_workspace:workspace,p_key:key,p_spec:spec}) as string,
  claim:async(task,worker)=>await rpc('raxi_runtime_claim',{p_task:task,p_worker:worker}) as Claim|null,
  step:(run,token,kind,result,receipt,cost)=>rpc('raxi_runtime_step',{p_run:run,p_token:token,p_kind:kind,p_result:result??null,p_receipt:receipt??null,p_cost:cost??null})};
}
