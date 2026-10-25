export type OfficeMode = 'MOCK' | 'HISTORICAL_REPLAY' | 'LIVE_READ_ONLY';
export type SourceConnection = 'CONNECTED' | 'DISCONNECTED' | 'DEGRADED';

export interface SourceHealth {
  source: 'mock' | 'munder' | 'runtime' | 'codex';
  mode: OfficeMode;
  connection: SourceConnection;
  lastSuccessfulRead?: string;
  lastSourceEvent?: string;
  eventsLoaded: number;
  agentsLoaded: number;
  tasksLoaded: number;
  message?: string;
}
