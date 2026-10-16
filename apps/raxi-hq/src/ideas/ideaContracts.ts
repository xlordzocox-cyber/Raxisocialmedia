export const IDEA_SOURCES = [
  'MANUAL_LUIS', 'TREND_RADAR', 'ANALYTICS', 'EDITORIAL_CALENDAR',
  'SUPERMEMORY_INSIGHT', 'EXTERNAL_SIGNAL',
] as const;
export type IdeaSource = typeof IDEA_SOURCES[number];

export const IDEA_STATUSES = [
  'PROPOSED', 'UNDER_REVIEW', 'APPROVED_FOR_HQ', 'REJECTED', 'ARCHIVED', 'SENT_TO_HQ',
] as const;
export type IdeaStatus = typeof IDEA_STATUSES[number];

export const IDEA_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type IdeaPriority = typeof IDEA_PRIORITIES[number];

export const IDEA_CHANNELS = [
  'INSTAGRAM_FEED', 'INSTAGRAM_REEL', 'INSTAGRAM_STORY',
  'TEASER', 'FANVIEW_FEED', 'FANVIEW_CHAT',
] as const;
export type IdeaChannel = typeof IDEA_CHANNELS[number];

export const IDEA_EVIDENCE_KINDS = [
  'TREND', 'ANALYTICS', 'CALENDAR', 'MEMORY', 'MANUAL_NOTE', 'EXTERNAL_REFERENCE',
] as const;
export type IdeaEvidenceKind = typeof IDEA_EVIDENCE_KINDS[number];

export interface IdeaEvidence {
  id: string;
  kind: IdeaEvidenceKind;
  label: string;
  /** Opaque reference only; never fetched, executed or interpreted as instructions. */
  sourceRef?: string;
  capturedAt?: string;
}

/** A proposal, not a campaign or production approval. */
export interface IdeaRecord {
  id: string;
  title: string;
  summary: string;
  source: IdeaSource;
  status: IdeaStatus;
  priority: IdeaPriority;
  createdAt: string;
  updatedAt: string;
  reason: string;
  suggestedChannels: IdeaChannel[];
  tags: string[];
  fitScore: number;
  confidenceScore: number;
  evidence: IdeaEvidence[];
  duplicateOfIdeaId?: string;
  relatedCampaignIds?: string[];
  approvedAt?: string;
  sentToHqAt?: string;
}

/** IdeaHandoffToHQ is not a Campaign; HQ/Luis decides whether to create one. */
export interface IdeaHandoffToHQ {
  ideaId: string;
  title: string;
  summary: string;
  reason: string;
  source: IdeaSource;
  priority: IdeaPriority;
  suggestedChannels: IdeaChannel[];
  fitScore: number;
  confidenceScore: number;
  evidenceRefs: string[];
  sentAt: string;
}
