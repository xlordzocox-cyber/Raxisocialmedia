export type HQEventType =
  | 'AGENT_REGISTERED'
  | 'AGENT_STATUS_CHANGED'
  | 'TASK_ASSIGNED'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'AGENT_BLOCKED'
  | 'HANDOFF_SENT'
  | 'HANDOFF_RECEIVED'
  | 'ASSET_REQUESTED'
  | 'ASSET_RECEIVED'
  | 'QA_REQUESTED'
  | 'QA_PASS'
  | 'QA_FAIL'
  | 'VISUAL_REVIEW_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_GRANTED'
  | 'PUBLISH_SCHEDULED'
  | 'MEMORY_SAVE_REQUESTED'
  | 'MEMORY_ARCHIVED'
  | 'MEMORY_SAVE_FAILED'
  | 'SECURITY_STATE_CHANGED';

export interface HQEvent {
  id: string;
  timestamp: string;
  type: HQEventType;
  label: string;
  actorId?: string;
  targetId?: string;
  campaignId?: string;
  taskId?: string;
  assetId?: string;
  payload?: Record<string, unknown>;
  source: 'mock' | 'munder' | 'github' | 'aria' | 'supermemory' | 'runtime' | 'codex';
  verified: boolean;
}
