import { getOwnAgent } from '../../domain/agents';
import type { HQState } from '../../domain/hq';
import type { AgentSnapshot } from '../../domain/agents';
import type { TaskSnapshot } from '../../domain/tasks';

/** Shared presentation coherence check. MATCHED is metadata, never authorization. */
export function taskOwnerMetadata(agent: AgentSnapshot, task: TaskSnapshot): 'INCONSISTENT' | 'INCOMPLETE' | 'MATCHED' {
  if ((task.ownerAgentId !== undefined && task.ownerAgentId !== agent.id) ||
    (task.campaignId !== undefined && agent.campaignId !== undefined && task.campaignId !== agent.campaignId)) return 'INCONSISTENT';
  if (task.ownerAgentId === undefined || (task.campaignId === undefined) !== (agent.campaignId === undefined)) return 'INCOMPLETE';
  return 'MATCHED';
}

/** Presentation only. Never substitutes a roster, authorizes work or admits source data. */
export function officeAgentView(state: HQState) {
  const agent = getOwnAgent(state.agents, state.selectedAgentId);
  const candidate = agent?.currentTaskId && Object.hasOwn(state.tasks, agent.currentTaskId)
    ? state.tasks[agent.currentTaskId] : undefined;
  // A reference alone is not an assignment. Contradictory or partial links remain
  // visible as such; this projection neither repairs nor writes source metadata.
  let taskState: 'NONE' | 'UNAVAILABLE' | 'INCONSISTENT' | 'INCOMPLETE' | 'MATCHED' = 'NONE';
  if (agent?.currentTaskId) {
    if (!candidate) taskState='UNAVAILABLE';
    else if (candidate.id !== agent.currentTaskId) taskState='INCONSISTENT';
    else taskState=taskOwnerMetadata(agent,candidate);
  }
  const task = taskState === 'MATCHED' ? candidate : undefined;
  const event = agent ? state.events.find(item => item.actorId === agent.id) : undefined;
  return {
    agents: Object.values(state.agents), agent, task, taskState, event,
    mode: state.mode,
    source: state.sourceHealth.source,
    connection: state.sourceHealth.connection,
    modeLabel: state.mode === 'MOCK' ? 'MOCK · simulación'
      : state.mode === 'HISTORICAL_REPLAY' ? 'HISTORICAL_REPLAY · sin estado actual'
        : 'LIVE_READ_ONLY · solo lectura',
    observation: state.observation,
  };
}
export type OfficeAgentView = ReturnType<typeof officeAgentView>;
