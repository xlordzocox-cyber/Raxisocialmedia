import { mockAgents, mockCampaign, mockTasks, mockTimeline, type TimedMockEvent } from './mockScenario';
import type { AgentSnapshot } from '../../domain/agents';
import type { CampaignSnapshot } from '../../domain/campaigns';
import type { TaskSnapshot } from '../../domain/tasks';

export interface HQReadOnlyAdapter {
  readonly id: string;
  readonly mode: 'mock-read-only';
  loadAgents(): Promise<AgentSnapshot[]>;
  loadTasks(): Promise<TaskSnapshot[]>;
  loadCampaigns(): Promise<CampaignSnapshot[]>;
  loadTimeline(): Promise<TimedMockEvent[]>;
}

export const mockAdapter: HQReadOnlyAdapter = {
  id: 'mock-office-v0.2',
  mode: 'mock-read-only',
  async loadAgents() {
    return structuredClone(mockAgents);
  },
  async loadTasks() {
    return structuredClone(mockTasks);
  },
  async loadCampaigns() {
    return [structuredClone(mockCampaign)];
  },
  async loadTimeline() {
    return structuredClone(mockTimeline);
  },
};
