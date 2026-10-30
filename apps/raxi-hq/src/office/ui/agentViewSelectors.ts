import { getOwnAgent } from '../../domain/agents';
import type { HQState } from '../../domain/hq';

/** Presentation only. Never substitutes a roster, authorizes work or admits source data. */
export function officeAgentView(state: HQState) {
  const agent = getOwnAgent(state.agents, state.selectedAgentId);
  const task = agent?.currentTaskId && Object.hasOwn(state.tasks, agent.currentTaskId)
    ? state.tasks[agent.currentTaskId] : undefined;
  const event = agent ? state.events.find(item => item.actorId === agent.id) : undefined;
  return {
    agents: Object.values(state.agents), agent, task, event,
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
