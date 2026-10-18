import type { IdeaChannel } from '../ideas/ideaContracts';
import type { CampaignContentLevel } from './campaignContracts';

export const STRATEGY_FORMATS = ['PHOTO', 'CAROUSEL', 'SHORT_VIDEO', 'STORY', 'CHAT_PHOTO'] as const;
export type StrategyFormat = typeof STRATEGY_FORMATS[number];
export const STRATEGY_STATUSES = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] as const;
export type StrategyStatus = typeof STRATEGY_STATUSES[number];

/** A plan for future production, never an existing asset or publishing instruction. */
export interface StrategyDeliverable {
  id: string;
  channel: IdeaChannel;
  contentLevel: CampaignContentLevel;
  format: StrategyFormat;
  quantity: number;
  purpose: string;
  creativeAngle: string;
}

export interface CampaignStrategyInput {
  audience: string;
  audienceNeed: string;
  creativeConcept: string;
  narrativeApproach: string;
  visualDirection: string;
  toneOfVoice: string;
  desiredAudienceResponse: string;
  successCriteria: string;
  deliverables: StrategyDeliverable[];
  notes?: string;
}

/** Each revision is a separate session record; an approved revision is historical evidence. */
export interface CampaignStrategyRevision extends CampaignStrategyInput {
  campaignId: string;
  revision: number;
  status: StrategyStatus;
  createdAt: string;
  updatedAt: string;
  author: 'LUIS';
  approvedAt?: string;
  approvedBy?: 'LUIS';
  /** Why this revision was opened. Independent from requested changes within it. */
  revisionReason?: string;
  changeReason?: string;
}
