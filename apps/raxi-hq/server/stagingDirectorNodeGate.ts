/** Issue #49: unmounted Node-only Supabase composition for the Director ledger
 * readiness path. NO Vercel route, listener, environment reads, task commands,
 * runOne, provider registration, scheduler or user-visible frontend import.
 */
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {supabaseSupervisedAuth} from '../../../server/agent-runtime/supabaseSupervisedAuth';
import {createUnpublishedDirectorRealReadiness} from '../../../server/agent-runtime/stagingDirectorReadiness';
import {SERVER_AUTH_OPTIONS} from '../../../server/agent-runtime/stagingAuthHostComposition';
import {
 createUnpublishedStagingNodeIngress,STAGING_DIRECTOR_READINESS_PATH,
 type IngressAdmissionPort,
} from './stagingNodeAuthIngress';

declare const process:{versions?:{node?:string}};
const REF='zvhxjindgyvtasstfjut';
const URL_STAGING=`https://${REF}.supabase.co`;
const IDENTITY='raxi_supervised_host_identity';
const RATE='raxi_supervised_request_rate_admit';
const READ='raxi_director_real_read';

export interface UnpublishedDirectorNodeConfig {
 projectUrl:string;
 publishableKey:string;
 privilegedKey:string;
 approvedOrigin:string;
 /** Durable atomic cross-instance pre-auth gate from trusted Node infrastructure.
  * Must NEVER use request X-Forwarded-For or a process-local counter. */
 admission:IngressAdmissionPort;
}
export function createUnpublishedDirectorNodeGate(
 config:UnpublishedDirectorNodeConfig,
 sdkCreate:typeof createClient=createClient,
) {
 if(typeof window!=='undefined'||!process.versions?.node)
  throw Error('Node-only, unpublished Director gate');
 if(!config||config.projectUrl!==URL_STAGING||
    typeof config.publishableKey!=='string'||!config.publishableKey.startsWith('sb_publishable_')||
    config.publishableKey.length>512||
    typeof config.privilegedKey!=='string'||!config.privilegedKey.startsWith('sb_secret_')||
    config.privilegedKey.length>4096||config.publishableKey===config.privilegedKey||
    !config.admission||typeof config.admission.admit!=='function')
  throw Error('Separate authorized staging server ports required');

 // The ingress validates exact team deployment origin and requires a trusted
 // admission context. Construct before any SDK client, fail before secrets.
 const gateConfig={
  approvedOrigin:config.approvedOrigin,path:STAGING_DIRECTOR_READINESS_PATH,
  admission:config.admission,
 };
 // Only Node has credentials; neither client persists or refreshes a JWT.
 const userSdk=sdkCreate(URL_STAGING,config.publishableKey,{auth:{...SERVER_AUTH_OPTIONS}});
 const serviceSdk=sdkCreate(URL_STAGING,config.privilegedKey,{auth:{...SERVER_AUTH_OPTIONS}});
 if((userSdk as unknown)===(serviceSdk as unknown))throw Error('Separate SDK clients required');
 const auth={
  async getClaims(token:string) {
   const r=await userSdk.auth.getClaims(token);
   return {data:r.data?{claims:r.data.claims as Record<string,unknown>}:null,error:r.error};
  },
  async getUser(token:string) {
   const r=await userSdk.auth.getUser(token);
   return {data:{user:r.data.user?{id:r.data.user.id,is_anonymous:r.data.user.is_anonymous}:null},
    error:r.error};
  },
 };
 const serverRpc={
  async rpc(name:string,args:Record<string,unknown>) {
   if(name!==IDENTITY&&name!==RATE&&name!==READ)throw Error('No Director command RPC');
   const keys=Object.keys(args);
   if(name===IDENTITY && (keys.length!==1||keys[0]!=='p_identity'))throw Error('Closed identity RPC');
   if(name===RATE && (keys.length!==2||!keys.includes('p_identity')||
     args.p_operation!=='PREFLIGHT'))throw Error('Closed rate RPC');
   if(name===READ && (keys.length!==2||!keys.includes('p_identity')||
     !keys.includes('p_task_id')))throw Error('Closed read RPC');
   // This service client NEVER receives the browser bearer. The trusted
   // p_identity was constructed by verified SDK getClaims and getUser.
   const r=await serviceSdk.rpc(name,args);
   return {data:r.data,error:r.error};
  },
 };
 const identify=supabaseSupervisedAuth({projectRef:REF,auth,server:serverRpc});
 const readiness=createUnpublishedDirectorRealReadiness({
  identify,server:serverRpc,liveEnabled:false,actionsEnabled:false,
  providersEnabled:false,
 });
 return createUnpublishedStagingNodeIngress({
  ...gateConfig,authenticationHandler:readiness,
 });
}
