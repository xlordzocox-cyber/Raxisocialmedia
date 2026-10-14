import type { AgentSnapshot } from '../../domain/agents';
import type { CampaignSnapshot } from '../../domain/campaigns';
import type { HQEvent } from '../../domain/events';
import type { TaskSnapshot } from '../../domain/tasks';

export const mockCampaign: CampaignSnapshot = {
  id: 'campaign-raxi-office-demo',
  title: 'Raxi HQ Office v0.2 Demo',
  objective: 'Visualizar coordinación de campaña read-only con adapters mock.',
  progress: 8,
  status: 'MOCK_PLANNING',
};

export const mockAgents: AgentSnapshot[] = [
  {
    id: 'orchestrator',
    displayName: 'Orchestrator',
    role: 'Marketing Director / Orchestrator',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'READY',
    zone: 'WAR_ROOM',
    campaignId: mockCampaign.id,
    capabilities: ['campaign planning', 'handoffs', 'approval routing'],
    securityState: 'READ_ONLY',
  },
  {
    id: 'research',
    displayName: 'Research',
    role: 'Research & Insights',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'WAR_ROOM',
    capabilities: ['trend scan', 'audience insights'],
    securityState: 'READ_ONLY',
  },
  {
    id: 'strategy',
    displayName: 'Strategy',
    role: 'Campaign Strategy',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'WAR_ROOM',
    capabilities: ['funnel mapping', 'campaign structure'],
    securityState: 'READ_ONLY',
  },
  {
    id: 'creative',
    displayName: 'Creative',
    role: 'Creative Director',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'WAR_ROOM',
    capabilities: ['visual direction', 'Aria request prep'],
    securityState: 'WRITE_DISABLED',
  },
  {
    id: 'visual-qa',
    displayName: 'Visual QA',
    role: 'Visual QA',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'QA_LAB',
    capabilities: ['visual consistency', 'identity QA'],
    securityState: 'VISUAL_REVIEW_REQUIRED',
  },
  {
    id: 'editorial-qa',
    displayName: 'Editorial QA',
    role: 'Editorial QA',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'QA_LAB',
    capabilities: ['copy QA', 'platform QA'],
    securityState: 'READ_ONLY',
  },
  {
    id: 'publisher',
    displayName: 'Publisher',
    role: 'Publishing & Distribution',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'PUBLISHING',
    capabilities: ['planner read', 'schedule preview'],
    securityState: 'WRITE_DISABLED',
  },
  {
    id: 'performance',
    displayName: 'Performance',
    role: 'Performance Analysis',
    provider: 'mock',
    model: 'read-only adapter',
    status: 'IDLE',
    zone: 'GITHUB_HUB',
    capabilities: ['learning classifier', 'reporting'],
    securityState: 'READ_ONLY',
  },
];

export const mockTasks: TaskSnapshot[] = [
  {
    id: 'task-research',
    title: 'Trend scan for campaign angle',
    status: 'mock-ready',
    ownerAgentId: 'research',
    campaignId: mockCampaign.id,
  },
  {
    id: 'task-creative',
    title: 'Prepare Aria asset request',
    status: 'mock-ready',
    ownerAgentId: 'creative',
    campaignId: mockCampaign.id,
  },
  {
    id: 'task-qa',
    title: 'Review mock visual output',
    status: 'mock-ready',
    ownerAgentId: 'visual-qa',
    campaignId: mockCampaign.id,
    approvalRequired: true,
  },
];

export interface TimedMockEvent {
  atMs: number;
  event: HQEvent;
}

const base = new Date('2026-10-14T21:31:00-06:00').getTime();

function event(
  atSeconds: number,
  type: HQEvent['type'],
  label: string,
  patch: Partial<HQEvent> = {},
): TimedMockEvent {
  return {
    atMs: atSeconds * 1000,
    event: {
      id: `mock-${atSeconds}-${type}`,
      timestamp: new Date(base + atSeconds * 1000).toISOString(),
      type,
      label,
      source: 'mock',
      verified: true,
      campaignId: mockCampaign.id,
      ...patch,
    },
  };
}

export const mockTimeline: TimedMockEvent[] = [
  event(2, 'TASK_ASSIGNED', 'Orchestrator assigned trend scan to Research', {
    actorId: 'orchestrator',
    targetId: 'research',
    taskId: 'task-research',
    payload: { destinationZone: 'RESEARCH_LAB' },
  }),
  event(8, 'TASK_STARTED', 'Research started trend scan in Research Lab', {
    actorId: 'research',
    taskId: 'task-research',
    payload: { status: 'RESEARCHING', zone: 'RESEARCH_LAB' },
  }),
  event(18, 'HANDOFF_SENT', 'Research handed insights to Strategy', {
    actorId: 'research',
    targetId: 'strategy',
    taskId: 'task-research',
  }),
  event(22, 'TASK_STARTED', 'Strategy shaped campaign angle in War Room', {
    actorId: 'strategy',
    payload: { status: 'RUNNING', zone: 'WAR_ROOM' },
  }),
  event(24, 'AGENT_BLOCKED', 'Strategy blocked by mock dependency', {
    actorId: 'strategy', payload: { waitingFor: 'mock brief dependency' },
  }),
  event(27, 'AGENT_STATUS_CHANGED', 'Strategy waiting for mock brief', {
    actorId: 'strategy', payload: { status: 'WAITING', waitingFor: 'mock brief' },
  }),
  event(30, 'AGENT_STATUS_CHANGED', 'Strategy resumed after mock dependency', {
    actorId: 'strategy', payload: { status: 'RUNNING' },
  }),
  event(32, 'TASK_ASSIGNED', 'Creative received visual direction', {
    actorId: 'strategy',
    targetId: 'creative',
    taskId: 'task-creative',
    payload: { destinationZone: 'ARIA_LINK' },
  }),
  event(38, 'ASSET_REQUESTED', 'Creative prepared mock Aria request', {
    actorId: 'creative',
    taskId: 'task-creative',
    payload: { status: 'WAITING_ASSET', zone: 'ARIA_LINK' },
    source: 'aria',
  }),
  event(50, 'ASSET_RECEIVED', 'Mock Aria output received for QA', {
    actorId: 'creative',
    targetId: 'visual-qa',
    assetId: 'MOCK-ASSET-ARIA-01',
    source: 'aria',
  }),
  event(56, 'QA_REQUESTED', 'Visual QA requested at QA Lab', {
    actorId: 'creative',
    targetId: 'visual-qa',
    taskId: 'task-qa',
    payload: { destinationZone: 'QA_LAB' },
  }),
  event(64, 'VISUAL_REVIEW_REQUIRED', 'Visual QA marks mock asset as review required', {
    actorId: 'visual-qa',
    taskId: 'task-qa',
    payload: { status: 'WAITING_APPROVAL', zone: 'QA_LAB' },
  }),
  event(72, 'QA_PASS', 'Editorial QA passes copy and platform fit', {
    actorId: 'editorial-qa',
    payload: { status: 'COMPLETED', zone: 'QA_LAB' },
  }),
  event(82, 'HANDOFF_SENT', 'QA handed package to Publishing', {
    actorId: 'editorial-qa',
    targetId: 'publisher',
  }),
  event(88, 'PUBLISH_SCHEDULED', 'Publishing created read-only schedule preview', {
    actorId: 'publisher',
    payload: { status: 'WAITING_APPROVAL', zone: 'PUBLISHING' },
  }),
  event(96, 'MEMORY_SAVE_REQUESTED', 'Performance identified durable learning', {
    actorId: 'performance',
    targetId: 'SUPERMEMORY_CORE',
    source: 'supermemory',
  }),
  event(104, 'MEMORY_ARCHIVED', 'Mock adapter confirmed learning archived', {
    actorId: 'performance',
    targetId: 'SUPERMEMORY_CORE',
    source: 'supermemory',
    verified: true,
  }),
  event(112, 'TASK_COMPLETED', 'Campaign progress reached mock-ready state', {
    actorId: 'orchestrator',
    payload: { progress: 100, status: 'MOCK_READY' },
  }),
];
