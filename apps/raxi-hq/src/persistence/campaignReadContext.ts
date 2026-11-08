import type { RealCampaignState } from './realCampaignStore';

/** Presentation context. AuthStore and the canonical stores own admission. */
export interface CampaignReadContext {
  ownerId?: string;
  workspaceId?: string;
  mode: 'REAL' | 'DEMO';
  synchronized: boolean;
  ideasReady: boolean;
  ideaPending: boolean;
}

export function confirmedCampaignSnapshot(state: RealCampaignState, context: CampaignReadContext) {
  const snapshot = state.snapshot;
  if (context.mode !== 'REAL' || !context.ideasReady || context.ideaPending || !context.synchronized ||
      state.phase !== 'ready' || state.pending || state.error || !context.ownerId || !context.workspaceId ||
      snapshot?.ownerId !== context.ownerId || snapshot?.workspaceId !== context.workspaceId) return undefined;
  return snapshot;
}
