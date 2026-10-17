import type { IdeaChannel, IdeaPriority } from '../ideas/ideaContracts';
import type { IdeaProvenance } from '../ideas/ideaCenterSession';

export const CAMPAIGN_CONTENT_LEVELS = ['PUBLIC_SOCIAL', 'TEASER', 'FANVIEW_FEED', 'FANVIEW_CHAT'] as const;
export type CampaignContentLevel = typeof CAMPAIGN_CONTENT_LEVELS[number];
export const CAMPAIGN_STATUSES = ['DRAFT', 'PLANNING', 'BLOCKED', 'CANCELED'] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];
export type CampaignDecisionStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface CampaignDecision {
  ideaId: string;
  status: CampaignDecisionStatus;
  decidedAt?: string;
  reason?: string;
  campaignId?: string;
}

/** Luis must supply every required field; suggestions may only prefill the UI. */
export interface CampaignBriefInput {
  title: string;
  objective: string;
  priority: IdeaPriority;
  channels: IdeaChannel[];
  contentLevels: CampaignContentLevel[];
  keyMessage: string;
  cta?: string;
  notes?: string;
}

/** Session-only editorial contract. Distinct from the Office MOCK CampaignSnapshot. */
export interface CampaignRecord extends CampaignBriefInput {
  id: string;
  sourceIdeaId: string;
  sourceHandoffSentAt: string;
  provenance: IdeaProvenance;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}
