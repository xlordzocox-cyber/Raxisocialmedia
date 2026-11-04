import type { HQState } from '../domain/hq';

/** Shared presentation gate, not source admission or independent evidence. */
export function officeDeclarationContext(state:HQState){
  const demo=state.mode==='MOCK' && state.mockMode && state.sourceHealth.mode==='MOCK' && state.sourceHealth.source==='mock' && state.sourceHealth.connection==='CONNECTED';
  const live=state.mode==='LIVE_READ_ONLY' && !state.mockMode && state.sourceHealth.mode==='LIVE_READ_ONLY' && state.sourceHealth.source==='munder' && state.sourceHealth.connection==='CONNECTED';
  return {demo,live};
}
