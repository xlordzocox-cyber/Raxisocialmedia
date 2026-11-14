import type { HQState } from '../domain/hq';
import { getOwnAgent } from '../domain/agents';

/** Client-only rendering choice. Neither source state nor selection authorizes effects. */
export interface ScopedRuntimeSnapshot {owner:string;workspace:string;hq:HQState}

/** Never mix Munder, MOCK, historical and runtime agents into one ungrounded roster. */
export function mainOfficeSource(
 fallback:HQState,
 record:ScopedRuntimeSnapshot|null,
 viewerId:string|undefined,
 campus:'REAL'|'DEMO',
 selectedRuntimeAgentId?:string,
):HQState {
 if(campus!=='REAL'||!viewerId||!record||record.owner!==viewerId||!record.workspace||
    record.hq.mode!=='LIVE_READ_ONLY'||record.hq.mockMode!==false||
    record.hq.sourceHealth.source!=='runtime'||record.hq.sourceHealth.connection!=='CONNECTED')return fallback;
 const selectedAgentId=getOwnAgent(record.hq.agents,selectedRuntimeAgentId)?.id ??
  Object.keys(record.hq.agents)[0];
 return {...record.hq,selectedAgentId};
}
