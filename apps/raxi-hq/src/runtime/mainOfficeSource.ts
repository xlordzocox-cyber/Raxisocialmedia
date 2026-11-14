import type { HQState } from '../domain/hq';
import { getOwnAgent } from '../domain/agents';

/** Client-only rendering choice. Neither source state nor selection authorizes effects. */
export interface ScopedRuntimeScope {owner:string;workspace:string}
export interface ScopedRuntimeSnapshot extends ScopedRuntimeScope {hq:HQState}

/** A connected snapshot is only renderable in its currently verified workspace. */
export function matchesActiveRuntimeScope(
 scope:ScopedRuntimeScope,
 viewerId:string|undefined,
 activeWorkspaceId:string|undefined,
):boolean {
 return !!viewerId && !!activeWorkspaceId &&
  scope.owner===viewerId && scope.workspace===activeWorkspaceId;
}

/** Never mix Munder, MOCK, historical and runtime agents into one ungrounded roster. */
export function mainOfficeSource(
 fallback:HQState,
 record:ScopedRuntimeSnapshot|null,
 viewerId:string|undefined,
 campus:'REAL'|'DEMO',
 activeWorkspaceId:string|undefined,
 selectedRuntimeAgentId?:string,
):HQState {
 if(campus!=='REAL'||fallback.mode!=='LIVE_READ_ONLY'||!record||!matchesActiveRuntimeScope(record,viewerId,activeWorkspaceId)||
    record.hq.mode!=='LIVE_READ_ONLY'||record.hq.mockMode!==false||
    record.hq.sourceHealth.source!=='runtime'||record.hq.sourceHealth.connection!=='CONNECTED')return fallback;
 const selectedAgentId=getOwnAgent(record.hq.agents,selectedRuntimeAgentId)?.id ??
  Object.keys(record.hq.agents)[0];
 return {...record.hq,selectedAgentId};
}
