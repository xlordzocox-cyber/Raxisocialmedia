import type { SourceConnection } from '../../domain/source';

/** Host-side producer contract. Raw Munder mapping is deferred until a documented feed exists. */
export interface LiveOfficeSource {
  getSourceStatus(): Promise<{ connection: SourceConnection; lastSuccessfulRead?: string }>;
  readAgents(): Promise<unknown>;
  readTasks(): Promise<unknown>;
  readEvents(): Promise<unknown>;
}

/** No connection is configured in v0.5; never substitutes mock data for live data. */
export const disconnectedLiveSource: LiveOfficeSource = {
  async getSourceStatus() { return { connection: 'DISCONNECTED' }; },
  async readAgents() { throw new Error('Live source unavailable'); },
  async readTasks() { throw new Error('Live source unavailable'); },
  async readEvents() { throw new Error('Live source unavailable'); },
};
