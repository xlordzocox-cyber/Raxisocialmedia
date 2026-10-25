import type { HQState } from '../domain/hq';

export const OBSERVED_PROJECT = 'github.com/xlordzocox-cyber/Raxisocialmedia';
export const CAPTURE_SHA256 = 'f433a8e8874b0fe89e188853333e766829d4278b72c0e7f1f92c716e37fe7498';
const THREAD = '01a1559f-dfe9-7d31-90d3-b4fff0820615';
const RUN = '01a1701c-eac4-77b3-9075-1abe7031876d';
const EXECUTOR = `codex:local:${THREAD}`;
const admitted = new WeakSet<ReviewedCapture>();

export interface ExecutionObservation {
  readonly runId: string;
  readonly executorId: string;
  readonly originRef: string;
  readonly timestamp: string;
  readonly confirmed: 'STARTED' | 'COMPLETED';
}
export interface ReviewedCapture {
  readonly runId: string;
  readonly executorId: string;
  readonly sha256: string;
  readonly events: readonly ExecutionObservation[];
}
export interface ObservationScope { readonly viewerId: string; readonly project: string }
export interface ReplayView {
  readonly viewerId: string;
  readonly project: string;
  readonly runId: string;
  readonly executorId: string;
  readonly originRef: string;
  readonly confirmed: 'STARTED' | 'COMPLETED';
  readonly timestamp: string;
  readonly sha256: string;
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Contrato de captura inválido');
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString() !== value) throw new Error('Fecha de origen inválida');
  return value;
}
function scopeValid(scope: ObservationScope): void {
  if (!scope.viewerId || scope.viewerId.length > 128 || scope.project !== OBSERVED_PROJECT) throw new Error('Ámbito de observación no autorizado');
}

/** Strict metadata projection; only admitReviewedCapture can establish the reviewed integrity pin. */
export function validateCaptureMetadata(value: unknown): readonly ExecutionObservation[] {
  const c = record(value, ['schema','mode','source','project','threadId','runId','executorId','taskId','raxiAgentId','startedAt','completedAt','status','command']);
  if (c.schema !== 1 || c.mode !== 'HISTORICAL_REPLAY' || c.source !== 'CODEX_DESKTOP_READ_THREAD'
      || c.project !== OBSERVED_PROJECT || c.threadId !== THREAD || c.runId !== RUN || c.executorId !== EXECUTOR
      || c.taskId !== null || c.raxiAgentId !== null || c.status !== 'completed') throw new Error('Identidad o procedencia no autorizada');
  const cmd = record(c.command, ['id','status','exitCode','durationMs']);
  if (cmd.id !== 'exec-4cfd1881-2a6e-4c04-95d8-c61b98ba4855' || cmd.status !== 'completed'
      || cmd.exitCode !== 0 || !Number.isSafeInteger(cmd.durationMs) || (cmd.durationMs as number) < 0) throw new Error('Evidencia de comando inválida');
  const start = timestamp(c.startedAt), end = timestamp(c.completedAt);
  if (Date.parse(start) >= Date.parse(end)) throw new Error('Observaciones duplicadas o desordenadas');
  return Object.freeze([
    Object.freeze({ runId: RUN, executorId: EXECUTOR, originRef: `codex://threads/${THREAD}/turns/${RUN}#startedAt`, timestamp: start, confirmed: 'STARTED' as const }),
    Object.freeze({ runId: RUN, executorId: EXECUTOR, originRef: `codex://threads/${THREAD}/turns/${RUN}#completedAt`, timestamp: end, confirmed: 'COMPLETED' as const }),
  ]);
}

/** No caller-supplied digest, URLs, credentials, transport or execution capabilities. */
export async function admitReviewedCapture(text: string, scope: ObservationScope): Promise<ReviewedCapture> {
  scopeValid(scope);
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Captura fuera de límites');
  const bytes = new TextEncoder().encode(text); // immutable string snapshot before await
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
  if (sha256 !== CAPTURE_SHA256) throw new Error('La captura no coincide con la evidencia revisada');
  const events = validateCaptureMetadata(JSON.parse(text));
  const capture = Object.freeze({ runId: RUN, executorId: EXECUTOR, sha256, events });
  admitted.add(capture);
  return capture;
}

/** Historical states never become current RUNNING or claim a Raxi task/agent assignment. */
export function projectReplay(capture: ReviewedCapture, index: number, scope: ObservationScope): HQState {
  scopeValid(scope);
  if (!admitted.has(capture)) throw new Error('Captura sin admisión verificable');
  const event = capture.events[index];
  if (!event || !Number.isInteger(index)) throw new Error('Observación inexistente');
  const id = capture.executorId;
  return {
    agents: { [id]: { id, displayName: 'Codex · ejecutor observado', role: 'EXTERNAL_EXECUTOR',
      status: 'HISTORICAL', zone: 'WAR_ROOM', destinationZone: event.confirmed === 'STARTED' ? 'GITHUB_HUB' : 'WAR_ROOM',
      securityState: 'READ_ONLY', capabilities: [], lastEventAt: event.timestamp } },
    tasks: {}, campaigns: {}, handoffs: [], memorySignals: [], readOnly: true, mockMode: false, mode: 'HISTORICAL_REPLAY',
    selectedAgentId: id,
    observation: { viewerId: scope.viewerId, project: scope.project, runId: capture.runId, executorId: id,
      originRef: event.originRef, confirmed: event.confirmed, timestamp: event.timestamp, sha256: capture.sha256 },
    events: capture.events.slice(0,index+1).reverse().map(e => ({
      id: e.originRef, timestamp: e.timestamp, type: e.confirmed === 'STARTED' ? 'TASK_STARTED' : 'TASK_COMPLETED',
      actorId: id, label: `Histórico: ejecución ${e.confirmed}`, source: 'codex', verified: true,
      payload: { mode: 'HISTORICAL_REPLAY', runId: e.runId, executorId: e.executorId, originRef: e.originRef, taskId: null, raxiAgentId: null },
    })),
    sourceHealth: { source: 'codex', mode: 'HISTORICAL_REPLAY', connection: 'DISCONNECTED', eventsLoaded: index+1,
      agentsLoaded: 1, tasksLoaded: 0, lastSourceEvent: event.timestamp,
      message: 'Archivo histórico comprobado. Sin conexión en vivo; estado actual desconocido.' },
  };
}
