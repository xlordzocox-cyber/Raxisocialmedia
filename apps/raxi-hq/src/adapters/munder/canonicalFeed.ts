import type { AgentSnapshot, AgentStatus, SecurityState, ZoneId } from '../../domain/agents';
import type { HQEvent, HQEventType } from '../../domain/events';
import type { TaskSnapshot } from '../../domain/tasks';

// This validates canonical HQ records supplied by a future read-only producer.
// It is not a mapper for an undocumented Munder raw format.
const statuses = new Set<AgentStatus>(['IDLE','RUNNING','WAITING','QA','READY','QUEUED','WALKING','WORKING','RESEARCHING','WAITING_AGENT','WAITING_ASSET','WAITING_QA','WAITING_APPROVAL','BLOCKED','FAILED','COMPLETED','QUARANTINED']);
const zones = new Set<ZoneId>(['WAR_ROOM','RESEARCH_LAB','ARIA_LINK','QA_LAB','GITHUB_HUB','PUBLISHING','SUPERMEMORY_CORE']);
const securityStates = new Set<SecurityState>(['READ_ONLY','WRITE_DISABLED','APPROVAL_REQUIRED','AUTH_REQUIRED','RATE_LIMITED','CIRCUIT_BREAKER_OPEN','VISUAL_REVIEW_REQUIRED','PUBLISH_BLOCKED','QUARANTINED']);
const eventTypes = new Set<HQEventType>(['AGENT_REGISTERED','AGENT_STATUS_CHANGED','TASK_ASSIGNED','TASK_STARTED','TASK_COMPLETED','AGENT_BLOCKED','HANDOFF_SENT','HANDOFF_RECEIVED','ASSET_REQUESTED','ASSET_RECEIVED','QA_REQUESTED','QA_PASS','QA_FAIL','VISUAL_REVIEW_REQUIRED','APPROVAL_REQUIRED','APPROVAL_GRANTED','PUBLISH_SCHEDULED','MEMORY_SAVE_REQUESTED','MEMORY_ARCHIVED','MEMORY_SAVE_FAILED','SECURITY_STATE_CHANGED']);

/** Bound visual objects and roster controls before normalizing a LIVE snapshot. */
export const MAX_LIVE_AGENTS = 32;
/** Bound the LIVE task ledger before creating records for the UI. */
export const MAX_LIVE_TASKS = 256;
/** Bound per-task dependency work before validating individual IDs. */
export const MAX_TASK_DEPENDENCIES = 32;

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid source record');
  return value as RecordValue;
}
function text(value: unknown, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid source text');
  return value;
}
function id(value: unknown): string {
  const result = text(value,128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error('Invalid source ID');
  return result;
}
function optional(value: unknown, validate: (input: unknown) => string): string | undefined {
  return value === undefined ? undefined : validate(value);
}
function member<T extends string>(value: unknown, allowed: Set<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) throw new Error('Unknown source value');
  return value as T;
}
export function validateSourceTimestamp(value: unknown): string {
  const result = text(value,40);
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-](\d\d):(\d\d))$/.exec(result);
  if (!parts) throw new Error('Invalid source timestamp');
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const hour = Number(parts[4]), minute = Number(parts[5]), second = Number(parts[6]);
  const offsetHour = parts[7] === undefined ? undefined : Number(parts[7]);
  const offsetMinute = parts[8] === undefined ? undefined : Number(parts[8]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      (offsetHour !== undefined && (offsetHour > 23 || offsetMinute! > 59)) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid source timestamp');
  return result;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid source collection');
  return value;
}
function strings(value: unknown): string[] {
  return list(value).map(item => text(item));
}
function taskDependencies(value: unknown): string[] {
  const dependencies = list(value);
  if (dependencies.length > MAX_TASK_DEPENDENCIES) throw new Error('Task dependency collection exceeds maximum');
  return dependencies.map(item => id(text(item)));
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error('Invalid source boolean');
  return value;
}
function byId(a: { id: string }, b: { id: string }): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function compareInstants(a: string, b: string): number {
  // Date.parse resolves the offset and whole second; compare all fractional digits separately.
  const wholeSecond = (value: string) => Date.parse(value.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/,''));
  const seconds = wholeSecond(a) - wholeSecond(b);
  if (seconds) return seconds;
  const fraction = (value: string) => /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  const left = fraction(a), right = fraction(b);
  const width = Math.max(left.length,right.length);
  const paddedLeft = left.padEnd(width,'0'), paddedRight = right.padEnd(width,'0');
  return paddedLeft < paddedRight ? -1 : paddedLeft > paddedRight ? 1 : 0;
}
function unique<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error('Duplicate source ID');
    seen.add(item.id);
  }
  return items;
}

export function normalizeLiveAgents(raw: unknown): AgentSnapshot[] {
  const agents = list(raw);
  if (agents.length > MAX_LIVE_AGENTS) throw new Error('Live agent roster exceeds maximum');
  return unique(agents.map(value => {
    const item = record(value);
    return {
      id: id(item.id), displayName: text(item.displayName), role: text(item.role),
      provider: optional(item.provider,text), model: optional(item.model,text),
      status: member(item.status,statuses), zone: member(item.zone,zones),
      destinationZone: item.destinationZone === undefined ? undefined : member(item.destinationZone,zones),
      currentTaskId: optional(item.currentTaskId,id), campaignId: optional(item.campaignId,id),
      waitingFor: optional(item.waitingFor,text), capabilities: strings(item.capabilities),
      securityState: member(item.securityState,securityStates),
      lastEventAt: optional(item.lastEventAt,validateSourceTimestamp),
    } satisfies AgentSnapshot;
  })).sort(byId);
}

export function normalizeLiveTasks(raw: unknown): TaskSnapshot[] {
  const tasks = list(raw);
  if (tasks.length > MAX_LIVE_TASKS) throw new Error('Live task collection exceeds maximum');
  return unique(tasks.map(value => {
    const item = record(value);
    if (typeof item.status !== 'string') throw new Error('Invalid task status');
    return {
      id: id(item.id), title: text(item.title), status: text(item.status),
      ownerAgentId: optional(item.ownerAgentId,id), campaignId: optional(item.campaignId,id),
      dependsOn: item.dependsOn === undefined ? undefined : taskDependencies(item.dependsOn),
      approvalRequired: optionalBoolean(item.approvalRequired),
    } satisfies TaskSnapshot;
  })).sort(byId);
}

export function normalizeLiveEvents(raw: unknown): HQEvent[] {
  const items = list(raw).map(value => {
    const item = record(value);
    if (item.source !== 'munder' || typeof item.verified !== 'boolean') throw new Error('Invalid event provenance');
    return {
      id: id(item.id), timestamp: validateSourceTimestamp(item.timestamp), type: member(item.type,eventTypes),
      label: text(item.label), actorId: optional(item.actorId,id), targetId: optional(item.targetId,id),
      campaignId: optional(item.campaignId,id), taskId: optional(item.taskId,id), assetId: optional(item.assetId,id),
      source: 'munder' as const, verified: item.verified,
      // Never forward unreviewed source payloads or message bodies to the renderer.
    } satisfies HQEvent;
  });
  items.sort((a,b)=>compareInstants(b.timestamp,a.timestamp) || byId(a,b));
  const seen = new Map<string,HQEvent>();
  for (const item of items) {
    const earlier = seen.get(item.id);
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(item)) throw new Error('Conflicting source event ID');
    seen.set(item.id,item);
  }
  return [...seen.values()];
}
