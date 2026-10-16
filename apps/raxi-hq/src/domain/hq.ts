import type { AgentSnapshot } from './agents';
import type { CampaignSnapshot } from './campaigns';
import type { HQEvent } from './events';
import type { MemorySignal } from './memory';
import type { TaskSnapshot } from './tasks';
import type { OfficeMode, SourceHealth } from './source';

export interface HandoffVisual {
  id: string;
  fromAgentId: string;
  toAgentId?: string;
  toZone?: string;
  label: string;
  createdAt: number;
}

export interface HQState {
  agents: Record<string, AgentSnapshot>;
  tasks: Record<string, TaskSnapshot>;
  campaigns: Record<string, CampaignSnapshot>;
  events: HQEvent[];
  selectedAgentId?: string;
  selectedEventId?: string;
  handoffs: HandoffVisual[];
  memorySignals: MemorySignal[];
  readOnly: true;
  mockMode: boolean;
  mode: OfficeMode;
  sourceHealth: SourceHealth;
}
