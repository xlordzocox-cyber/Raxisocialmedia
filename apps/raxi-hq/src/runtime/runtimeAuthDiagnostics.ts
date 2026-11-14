/** Manual, READ-ONLY runtime authorization checks against hosted Supabase.
 * Never reads access tokens, signs users out, creates users or mutates a table.
 * A failure of network/availability is NOT proof that authorization works.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AccessResult = 'PASS' | 'FAIL' | 'NOT_TESTED';
export interface RuntimeAuthChecks {
 user: AccessResult;
 ownerWorkspace: AccessResult;
 unknownWorkspace: AccessResult;
 anonymous: AccessResult;
 sessionRevocation: 'NOT_TESTED';
 secondRealUser: 'NOT_TESTED';
}
const blank=():RuntimeAuthChecks=>({
 user:'NOT_TESTED',ownerWorkspace:'NOT_TESTED',unknownWorkspace:'NOT_TESTED',
 anonymous:'NOT_TESTED',sessionRevocation:'NOT_TESTED',secondRealUser:'NOT_TESTED',
});
function denied(result:{data:unknown;error:{code?:string}|null}):boolean {
 return (result.data===null||result.data===undefined)&&result.error?.code==='42501';
}
function validSnapshot(value:unknown,owner:string,workspace:string):boolean {
 const data=value as {ownerId?:unknown;workspaceId?:unknown;serverTime?:unknown;tasks?:unknown;events?:unknown}|null;
 return !!data&&data.ownerId===owner&&data.workspaceId===workspace&&
  typeof data.serverTime==='string'&&Number.isFinite(Date.parse(data.serverTime))&&
  Array.isArray(data.tasks)&&Array.isArray(data.events);
}
export async function checkHostedRuntimeAuth(
 ownerClient:SupabaseClient,anonymousClient:SupabaseClient,owner:string,workspace:string,unknownWorkspace:string,
):Promise<RuntimeAuthChecks> {
 const result=blank();
 // Auth getUser makes a network request using the live browser session.
 // Never call getSession()/log tokens or rely on a locally decoded JWT.
 try {
  const {data,error}=await ownerClient.auth.getUser();
  if(error||!data.user||data.user.id!==owner||data.user.is_anonymous===true) {
   result.user='FAIL';return result;
  }
  result.user='PASS';
 } catch {result.user='FAIL';return result;}
 try {
  const {data,error}=await ownerClient.rpc('raxi_runtime_office',{p_workspace:workspace});
  if(error||!validSnapshot(data,owner,workspace)) {
   result.ownerWorkspace='FAIL';return result;
  }
  result.ownerWorkspace='PASS';
 } catch {result.ownerWorkspace='FAIL';return result;}
 // A random nonexistent workspace checks the fail-closed path only.
 // It is NOT evidence of isolation between two existing user accounts.
 if(unknownWorkspace===workspace) {result.unknownWorkspace='FAIL';}
 else {
  try {
   const attempt=await ownerClient.rpc('raxi_runtime_office',{p_workspace:unknownWorkspace});
   result.unknownWorkspace=denied(attempt)?'PASS':'FAIL';
  } catch {result.unknownWorkspace='NOT_TESTED';}
 }
 try {
  const attempt=await anonymousClient.rpc('raxi_runtime_office',{p_workspace:workspace});
  result.anonymous=denied(attempt)?'PASS':'FAIL';
 } catch {result.anonymous='NOT_TESTED';}
 return result;
}
