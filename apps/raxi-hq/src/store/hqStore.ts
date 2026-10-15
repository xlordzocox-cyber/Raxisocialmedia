import { useSyncExternalStore } from 'react';
import { reduceEventToVisualState } from './hqReducer';
import type { HQEvent } from '../domain/events';
import type { HQState } from '../domain/hq';
import { mockAdapter } from '../adapters/mock/mockAdapter';
import type { TimedMockEvent } from '../adapters/mock/mockScenario';
import { disconnectedLiveSource, type LiveOfficeSource } from '../adapters/munder/liveSource';
import { normalizeLiveAgents, normalizeLiveTasks, normalizeLiveEvents, validateSourceTimestamp } from '../adapters/munder/canonicalFeed';
import type { OfficeMode, SourceConnection, SourceHealth } from '../domain/source';

function health(mode: OfficeMode, connection: SourceConnection, message?: string): SourceHealth {
  return { source: mode === 'MOCK' ? 'mock' : 'munder', mode, connection, eventsLoaded: 0, agentsLoaded: 0, tasksLoaded: 0, message };
}
function emptyState(mode: OfficeMode, sourceHealth: SourceHealth): HQState { return {
  agents: {},
  tasks: {},
  campaigns: {},
  events: [],
  handoffs: [],
  memorySignals: [],
  readOnly: true,
  mockMode: mode === 'MOCK',
  mode,
  sourceHealth,
}; }

export class HQStore {
  private state: HQState = emptyState('MOCK',health('MOCK','CONNECTED'));
  private listeners = new Set<() => void>();
  private timeline: TimedMockEvent[] = [];
  private startedAt = 0;
  private timer?: number;
  private nextEventIndex = 0;
  private generation = 0;

  constructor(private liveSource: LiveOfficeSource = disconnectedLiveSource) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HQState => this.state;

  async initialize(): Promise<void> {
    const generation = ++this.generation;
    window.clearInterval(this.timer);
    const [agents, tasks, campaigns, timeline] = await Promise.all([
      mockAdapter.loadAgents(),
      mockAdapter.loadTasks(),
      mockAdapter.loadCampaigns(),
      mockAdapter.loadTimeline(),
    ]);
    if (generation !== this.generation) return;

    this.state = {
      ...emptyState('MOCK',health('MOCK','CONNECTED')),
      agents: Object.fromEntries(agents.map((agent) => [agent.id, agent])),
      tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
      campaigns: Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign])),
      selectedAgentId: agents[0]?.id,
      sourceHealth: { ...health('MOCK','CONNECTED'), agentsLoaded: agents.length, tasksLoaded: tasks.length },
    };
    this.timeline = timeline;
    this.emit();
    this.startTimeline();
  }

  async switchMode(mode: OfficeMode): Promise<void> {
    if (mode === 'MOCK') {
      this.state = emptyState('MOCK',health('MOCK','CONNECTED'));
      this.emit();
      return this.initialize();
    }
    this.generation += 1;
    window.clearInterval(this.timer);
    this.timeline = [];
    this.state = emptyState('LIVE_READ_ONLY',health('LIVE_READ_ONLY','DISCONNECTED','No hay fuente live configurada.'));
    this.emit();
    await this.refreshLive();
  }

  async refreshLive(): Promise<void> {
    if (this.state.mode !== 'LIVE_READ_ONLY') return;
    const generation = ++this.generation;
    try {
      const status = await this.liveSource.getSourceStatus();
      if (generation !== this.generation || this.state.mode !== 'LIVE_READ_ONLY') return;
      if (!['CONNECTED','DISCONNECTED','DEGRADED'].includes(status.connection)) throw new Error('Invalid source status');
      const lastRead=status.lastSuccessfulRead === undefined ? undefined : validateSourceTimestamp(status.lastSuccessfulRead);
      if (status.connection !== 'CONNECTED') {
        this.state = emptyState('LIVE_READ_ONLY',{...health('LIVE_READ_ONLY',status.connection,
          status.connection === 'DISCONNECTED' ? 'No hay fuente live configurada.' : 'La fuente live no está disponible.'),lastSuccessfulRead:lastRead});
        this.emit();
        return;
      }
      const [rawAgents,rawTasks,rawEvents] = await Promise.all([
        this.liveSource.readAgents(),this.liveSource.readTasks(),this.liveSource.readEvents(),
      ]);
      if (generation !== this.generation || this.state.mode !== 'LIVE_READ_ONLY') return;
      const agents=normalizeLiveAgents(rawAgents);
      const tasks=normalizeLiveTasks(rawTasks);
      const events=normalizeLiveEvents(rawEvents);
      const visibleEvents=events.slice(0,80);
      this.state = {
        ...emptyState('LIVE_READ_ONLY',health('LIVE_READ_ONLY','CONNECTED')),
        agents:Object.fromEntries(agents.map(agent=>[agent.id,agent])),
        tasks:Object.fromEntries(tasks.map(task=>[task.id,task])),
        events:visibleEvents,
        selectedAgentId:agents.some(agent=>agent.id===this.state.selectedAgentId) ? this.state.selectedAgentId : agents[0]?.id,
        selectedEventId:visibleEvents.some(event=>event.id===this.state.selectedEventId) ? this.state.selectedEventId : undefined,
        sourceHealth:{...health('LIVE_READ_ONLY','CONNECTED'),lastSuccessfulRead:lastRead,
          lastSourceEvent:events[0]?.timestamp,agentsLoaded:agents.length,tasksLoaded:tasks.length,eventsLoaded:events.length},
      };
      this.emit();
    } catch {
      if (generation !== this.generation || this.state.mode !== 'LIVE_READ_ONLY') return;
      this.state = emptyState('LIVE_READ_ONLY',health('LIVE_READ_ONLY','DEGRADED','La lectura live falló o devolvió datos inválidos.'));
      this.emit();
    }
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
    if (this.state.mode !== 'MOCK') return;
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
    this.state = { ...this.state, sourceHealth: { ...this.state.sourceHealth,
      eventsLoaded:this.state.events.length,lastSourceEvent:event.timestamp } };
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
