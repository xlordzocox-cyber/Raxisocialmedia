/** Server-only composition for the unpublished staging authentication probe.
 * No HTTP listener, Vercel/Edge route, tasks, provider, scheduler or execution.
 * Client creation is injected so credentials remain in a future reviewed server entrypoint.
 */
import {createStagingAuthReadinessProbe} from './stagingAuthReadinessProbe';
import {supabaseSupervisedAuth,type UserAuthPort,type ServerRpcPort} from './supabaseSupervisedAuth';

const STAGING_REF='zvhxjindgyvtasstfjut' as const;
const STAGING_URL=`https://${STAGING_REF}.supabase.co` as const;

/** Neither SDK client is allowed to persist, refresh or recover a browser session. */
export const SERVER_AUTH_OPTIONS=Object.freeze({
 persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,
});

export interface StagingAuthHostComposition {
 projectUrl:string;
 publishableKey:string;
 privilegedKey:string;
 makeUserAuth:(url:string,key:string,options:typeof SERVER_AUTH_OPTIONS)=>UserAuthPort;
 makePrivilegedRpc:(url:string,key:string,options:typeof SERVER_AUTH_OPTIONS)=>ServerRpcPort;
 /** Compile-time and runtime fail-closed switches. */
 liveEnabled:false;
 providersEnabled:false;
 actionsEnabled:false;
}

/** Builds an INERT handler. Publishing any route or providing credentials
 * requires a different, separately authorized change.
 */
export function createUnpublishedStagingAuthHost(deps:StagingAuthHostComposition) {
 if(typeof window!=='undefined')throw Error('Server-only host composition');
 if(deps.liveEnabled!==false||deps.providersEnabled!==false||deps.actionsEnabled!==false)
  throw Error('Staging diagnostic cannot enable actions or providers');
 if(deps.projectUrl!==STAGING_URL)throw Error('Only approved staging project');
 // A publishable key is public by design; the privileged key is never returned.
 if(typeof deps.publishableKey!=='string'||!deps.publishableKey.startsWith('sb_publishable_')||
    deps.publishableKey.length>512)throw Error('Staging publishable key required');
 if(typeof deps.privilegedKey!=='string'||!deps.privilegedKey.trim()||
    deps.privilegedKey===deps.publishableKey||deps.privilegedKey.startsWith('sb_publishable_')||
    deps.privilegedKey.length>4096)throw Error('Distinct server-only credential required');
 if(typeof deps.makeUserAuth!=='function'||typeof deps.makePrivilegedRpc!=='function')
  throw Error('Two independent server clients required');
 const userAuth=deps.makeUserAuth(STAGING_URL,deps.publishableKey,SERVER_AUTH_OPTIONS);
 const privileged=deps.makePrivilegedRpc(STAGING_URL,deps.privilegedKey,SERVER_AUTH_OPTIONS);
 if(!userAuth||!privileged||(userAuth as unknown)===(privileged as unknown))
  throw Error('Independent client ports required');
 const identify=supabaseSupervisedAuth({projectRef:STAGING_REF,auth:userAuth,server:privileged});
 return createStagingAuthReadinessProbe({
  identify,liveEnabled:false,providersEnabled:false,actionsEnabled:false,
 });
}
