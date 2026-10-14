export type AgentStatus =
  | 'IDLE'
  | 'RUNNING'
  | 'WAITING'
  | 'QA'
  | 'READY'
  | 'QUEUED'
  | 'WALKING'
  | 'WORKING'
  | 'RESEARCHING'
  | 'WAITING_AGENT'
  | 'WAITING_ASSET'
  | 'WAITING_QA'
  | 'WAITING_APPROVAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'COMPLETED'
  | 'QUARANTINED';

export type SecurityState =
  | 'READ_ONLY'
  | 'WRITE_DISABLED'
  | 'APPROVAL_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'CIRCUIT_BREAKER_OPEN'
  | 'VISUAL_REVIEW_REQUIRED'
  | 'PUBLISH_BLOCKED'
  | 'QUARANTINED';

export type ZoneId =
  | 'WAR_ROOM'
  | 'RESEARCH_LAB'
  | 'ARIA_LINK'
  | 'QA_LAB'
  | 'GITHUB_HUB'
  | 'PUBLISHING'
  | 'SUPERMEMORY_CORE';

export interface AgentSnapshot {
  id: string;
  displayName: string;
  role: string;
  provider?: string;
  model?: string;
  status: AgentStatus;
  zone: ZoneId;
  destinationZone?: ZoneId;
  currentTaskId?: string;
  campaignId?: string;
  waitingFor?: string;
  capabilities: string[];
  securityState: SecurityState;
  lastEventAt?: string;
}
