import { useSyncExternalStore } from 'react';
import { reduceEventToVisualState } from './hqReducer';
import type { HQEvent } from '../domain/events';
import type { HQState } from '../domain/hq';
import { mockAdapter } from '../adapters/mock/mockAdapter';
import type { TimedMockEvent } from '../adapters/mock/mockScenario';

const initialState: HQState = {
  agents: {},
  tasks: {},
  campaigns: {},
  events: [],
  handoffs: [],
  memorySignals: [],
  readOnly: true,
  mockMode: true,
};

class HQStore {
  private state: HQState = initialState;
  private listeners = new Set<() => void>();
  private timeline: TimedMockEvent[] = [];
  private startedAt = 0;
  private timer?: number;
  private nextEventIndex = 0;
  private generation = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HQState => this.state;

  async initialize(): Promise<void> {
    const generation = ++this.generation;
    const [agents, tasks, campaigns, timeline] = await Promise.all([
      mockAdapter.loadAgents(),
      mockAdapter.loadTasks(),
      mockAdapter.loadCampaigns(),
      mockAdapter.loadTimeline(),
    ]);
    if (generation !== this.generation) return;

    this.state = {
      ...initialState,
      agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
      tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
      campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign])),
      selectedAgentId: agents[0]?.id,
    };
    this.timeline = timeline;
    this.emit();
    this.startTimeline();
  }

  selectAgent(agentId: string): void {
    this.state = { ...this.state, selectedAgentId: agentId };
    this.emit();
  }

  selectEvent(eventId: string): void {
    const event = this.state.events.find((item) => item.id === eventId);
    this.state = {
      ...this.state,
      selectedEventId: eventId,
      selectedAgentId: event?.actorId ?? this.state.selectedAgentId,
    };
    this.emit();
  }

  restartDemo(): void {
    window.clearInterval(this.timer);
    this.nextEventIndex = 0;
    void this.initialize();
  }

  stop(): void {
    this.generation += 1;
    window.clearInterval(this.timer);
  }

  private startTimeline(): void {
    window.clearInterval(this.timer);
    this.startedAt = performance.now();
    this.nextEventIndex = 0;
    this.timer = window.setInterval(() => {
      const elapsed = performance.now() - this.startedAt;
      while (
        this.nextEventIndex < this.timeline.length
        && this.timeline[this.nextEventIndex].atMs <= elapsed
      ) {
        this.dispatchEvent(this.timeline[this.nextEventIndex].event);
        this.nextEventIndex += 1;
      }

      if (this.nextEventIndex >= this.timeline.length) {
        window.clearInterval(this.timer);
      }
    }, 250);
  }

  private dispatchEvent(event: HQEvent): void {
    this.state = reduceEventToVisualState(event, this.state);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const hqStore = new HQStore();

export function useHQState(): HQState {
  return useSyncExternalStore(hqStore.subscribe, hqStore.getSnapshot, hqStore.getSnapshot);
}
