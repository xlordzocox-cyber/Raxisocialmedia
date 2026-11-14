/** Node-only, unmounted Supabase SDK adapter for the Issue #60 Auth readiness probe.
 * Deliberately outside Vite src/: never import this file from UI, routes or Edge.
 * No env reads, listener, scheduled work, runOne, task RPC or provider registration.
 * A future reviewed Node entrypoint must supply the staging credentials privately.
 */
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {createUnpublishedStagingAuthHost} from '../../../server/agent-runtime/stagingAuthHostComposition';

export interface StagingNodeAuthConfig {
 projectUrl:string;
 publishableKey:string;
 privilegedKey:string;
}

/** Node runtime marker is checked without requiring a new @types/node dependency. */
declare const process: {versions?:{node?:string}};

const IDENTITY_RPC='raxi_supervised_host_identity';

/** Creates an INERT request handler; does not publish a route or call Supabase.
 * The injectable factory exists only for offline contract tests. Production
 * usage must omit it so that the installed pinned SDK is used.
 */
export function createUnpublishedStagingNodeAuthProbe(
 config:StagingNodeAuthConfig,
 sdkCreate:typeof createClient=createClient,
) {
 if(typeof window!=='undefined'||!process.versions?.node)
  throw Error('Node server runtime required');
 if(!config||typeof config.privilegedKey!=='string'||
    !config.privilegedKey.startsWith('sb_secret_'))
  throw Error('Staging server secret key required');
 let userSdk:SupabaseClient|undefined;
 return createUnpublishedStagingAuthHost({
  ...config,
  liveEnabled:false,providersEnabled:false,actionsEnabled:false,
  makeUserAuth(url,key,options) {
   const client=sdkCreate(url,key,{auth:{...options}});
   userSdk=client;
   return {
    async getClaims(token) {
     // SDK validates signed JWT; never decode and trust token content locally.
     const result=await client.auth.getClaims(token);
     return {
      data:result.data?{claims:result.data.claims as Record<string,unknown>}:null,
      error:result.error,
     };
    },
    async getUser(token) {
     // Network confirmation for every call. Never setSession or share JWT
     // with the privileged RPC client.
     const result=await client.auth.getUser(token);
     return {
      data:{user:result.data.user?{
       id:result.data.user.id,is_anonymous:result.data.user.is_anonymous,
      }:null},
      error:result.error,
     };
    },
   };
  },
  makePrivilegedRpc(url,key,options) {
   const client=sdkCreate(url,key,{auth:{...options}});
   if(client===userSdk)throw Error('Privileged SDK client cannot be reused');
   return {
    async rpc(name,args) {
     // Intentional closed allowlist: no task/host commands can be reached.
     if(name!==IDENTITY_RPC||Object.keys(args).length!==1||
        !Object.hasOwn(args,'p_identity')||!args.p_identity||
        typeof args.p_identity!=='object'||Array.isArray(args.p_identity))
      throw Error('Auth-only RPC');
     const result=await client.rpc(IDENTITY_RPC,{p_identity:args.p_identity});
     return {data:result.data,error:result.error};
    },
   };
  },
 });
}
