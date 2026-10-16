import { getOwnAgent, type AgentSnapshot, type AgentStatus, type ZoneId } from '../domain/agents';
import type { HQEvent } from '../domain/events';
import type { HQState } from '../domain/hq';

export function reduceEventToVisualState(event: HQEvent, state: HQState): HQState {
  const agents = { ...state.agents };
  const tasks = { ...state.tasks };
  const campaigns = { ...state.campaigns };
  const events = [event, ...state.events].slice(0, 80);
  const handoffs = [...state.handoffs];
  const memorySignals = [...state.memorySignals];

  const actor = getOwnAgent(agents,event.actorId);
  const target = getOwnAgent(agents,event.targetId);
  const payload = event.payload ?? {};

  if (actor) {
    agents[actor.id] = {
      ...actor,
      lastEventAt: event.timestamp,
    };
  }

  switch (event.type) {
    case 'AGENT_STATUS_CHANGED': {
      const status = asStatus(payload.status);
      if (actor && status) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status,
          waitingFor: status === 'WAITING' ? String(payload.waitingFor ?? 'dependency') : undefined,
          securityState: status === 'BLOCKED' ? 'PUBLISH_BLOCKED' : actor.securityState === 'PUBLISH_BLOCKED' ? 'READ_ONLY' : actor.securityState,
        });
      }
      break;
    }
    case 'TASK_ASSIGNED': {
      const targetAgent = target ?? actor;
      const destinationZone = asZone(payload.destinationZone) ?? targetAgent?.zone;
      if (targetAgent && destinationZone) {
        agents[targetAgent.id] = updateAgent(targetAgent, {
          status: 'WALKING',
          destinationZone,
          currentTaskId: event.taskId,
          campaignId: event.campaignId,
          waitingFor: undefined,
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'TASK_STARTED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: asStatus(payload.status) ?? 'RUNNING',
          zone: asZone(payload.zone) ?? actor.destinationZone ?? actor.zone,
          destinationZone: undefined,
          currentTaskId: event.taskId ?? actor.currentTaskId,
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'HANDOFF_SENT': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'COMPLETED',
          lastEventAt: event.timestamp,
        });
      }
      if (target) {
        agents[target.id] = updateAgent(target, {
          status: 'QUEUED',
          waitingFor: actor?.displayName,
          lastEventAt: event.timestamp,
        });
      }
      handoffs.push({
        id: event.id,
        fromAgentId: actor?.id ?? 'unknown',
        toAgentId: target?.id,
        label: event.type,
        createdAt: Date.parse(event.timestamp),
      });
      break;
    }
    case 'ASSET_REQUESTED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'WAITING_ASSET',
          zone: asZone(payload.zone) ?? 'ARIA_LINK',
          destinationZone: undefined,
          waitingFor: 'Aria Link mock adapter',
          securityState: 'WRITE_DISABLED',
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'ASSET_RECEIVED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'COMPLETED',
          waitingFor: undefined,
          lastEventAt: event.timestamp,
        });
      }
      if (target) {
        agents[target.id] = updateAgent(target, {
          status: 'WAITING_QA',
          waitingFor: event.assetId,
          lastEventAt: event.timestamp,
        });
      }
      handoffs.push({
        id: event.id,
        fromAgentId: actor?.id ?? 'creative',
        toAgentId: target?.id,
        label: 'ASSET',
        createdAt: Date.parse(event.timestamp),
      });
      break;
    }
    case 'QA_REQUESTED': {
      if (target) {
        agents[target.id] = updateAgent(target, {
          status: 'QA',
          destinationZone: asZone(payload.destinationZone) ?? 'QA_LAB',
          currentTaskId: event.taskId,
          waitingFor: undefined,
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'VISUAL_REVIEW_REQUIRED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'WAITING_APPROVAL',
          zone: asZone(payload.zone) ?? 'QA_LAB',
          destinationZone: undefined,
          securityState: 'VISUAL_REVIEW_REQUIRED',
          waitingFor: 'human visual review',
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'QA_PASS': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'COMPLETED',
          zone: asZone(payload.zone) ?? actor.zone,
          destinationZone: undefined,
          waitingFor: undefined,
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'PUBLISH_SCHEDULED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: asStatus(payload.status) ?? 'WAITING_APPROVAL',
          zone: asZone(payload.zone) ?? 'PUBLISHING',
          destinationZone: undefined,
          waitingFor: 'human approval',
          securityState: 'APPROVAL_REQUIRED',
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    case 'MEMORY_SAVE_REQUESTED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'WALKING',
          destinationZone: 'SUPERMEMORY_CORE',
          waitingFor: 'Supermemory confirmation',
          lastEventAt: event.timestamp,
        });
      }
      memorySignals.push({
        id: event.id,
        label: event.label,
        status: 'REQUESTED',
        sourceEventId: event.id,
      });
      break;
    }
    case 'MEMORY_ARCHIVED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'COMPLETED',
          zone: 'SUPERMEMORY_CORE',
          destinationZone: undefined,
          waitingFor: undefined,
          lastEventAt: event.timestamp,
        });
      }
      memorySignals.push({
        id: event.id,
        label: event.label,
        status: event.verified ? 'ARCHIVED' : 'FAILED',
        sourceEventId: event.id,
      });
      break;
    }
    case 'TASK_COMPLETED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'COMPLETED',
          lastEventAt: event.timestamp,
        });
      }
      if (event.campaignId && campaigns[event.campaignId]) {
        campaigns[event.campaignId] = {
          ...campaigns[event.campaignId],
          status: payload.status === 'MOCK_READY' ? 'MOCK_READY' : campaigns[event.campaignId].status,
        };
      }
      break;
    }
    case 'AGENT_BLOCKED': {
      if (actor) {
        agents[actor.id] = updateAgent(agents[actor.id], {
          status: 'BLOCKED',
          securityState: 'PUBLISH_BLOCKED',
          waitingFor: String(payload.waitingFor ?? 'dependency'),
          lastEventAt: event.timestamp,
        });
      }
      break;
    }
    default:
      break;
  }

  if (event.campaignId && campaigns[event.campaignId] && typeof payload.progress === 'number'
    && Number.isFinite(payload.progress) && payload.progress >= 0 && payload.progress <= 100) {
    campaigns[event.campaignId] = { ...campaigns[event.campaignId], progress: payload.progress };
  }

  return {
    ...state,
    agents,
    tasks,
    campaigns,
    events,
    handoffs,
    memorySignals,
  };
}

function updateAgent(agent: AgentSnapshot, patch: Partial<AgentSnapshot>): AgentSnapshot {
  return { ...agent, ...patch };
}

function asZone(value: unknown): ZoneId | undefined {
  const allowed: ZoneId[] = [
    'WAR_ROOM',
    'RESEARCH_LAB',
    'ARIA_LINK',
    'QA_LAB',
    'GITHUB_HUB',
    'PUBLISHING',
    'SUPERMEMORY_CORE',
  ];
  return typeof value === 'string' && allowed.includes(value as ZoneId) ? value as ZoneId : undefined;
}

function asStatus(value: unknown): AgentStatus | undefined {
  const allowed: AgentStatus[] = [
    'IDLE',
    'RUNNING',
    'WAITING',
    'QA',
    'READY',
    'QUEUED',
    'WALKING',
    'WORKING',
    'RESEARCHING',
    'WAITING_AGENT',
    'WAITING_ASSET',
    'WAITING_QA',
    'WAITING_APPROVAL',
    'BLOCKED',
    'FAILED',
    'COMPLETED',
    'QUARANTINED',
  ];
  return typeof value === 'string' && allowed.includes(value as AgentStatus) ? value as AgentStatus : undefined;
}
