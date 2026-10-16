import type { IdeaPriority, IdeaRecord, IdeaSource, IdeaStatus } from './ideaContracts';

export interface IdeaSummary {
  totalIdeas: number;
  proposedCount: number;
  underReviewCount: number;
  approvedForHqCount: number;
  sentToHqCount: number;
  rejectedCount: number;
  archivedCount: number;
}

/** Pure selectors over validated records; ties use stable IDs, not input order. */
export function summarizeIdeas(ideas: readonly IdeaRecord[]): IdeaSummary {
  return {
    totalIdeas: ideas.length,
    proposedCount: ideas.filter(idea => idea.status === 'PROPOSED').length,
    underReviewCount: ideas.filter(idea => idea.status === 'UNDER_REVIEW').length,
    approvedForHqCount: ideas.filter(idea => idea.status === 'APPROVED_FOR_HQ').length,
    sentToHqCount: ideas.filter(idea => idea.status === 'SENT_TO_HQ').length,
    rejectedCount: ideas.filter(idea => idea.status === 'REJECTED').length,
    archivedCount: ideas.filter(idea => idea.status === 'ARCHIVED').length,
  };
}

export function getIdeaById(ideas: readonly IdeaRecord[], ideaId: string): IdeaRecord | undefined {
  return ideas.find(idea => idea.id === ideaId);
}
function byId(a: IdeaRecord, b: IdeaRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
export function getIdeasByStatus(ideas: readonly IdeaRecord[], status: IdeaStatus): IdeaRecord[] {
  return ideas.filter(idea => idea.status === status).sort(byId);
}
export function getIdeasBySource(ideas: readonly IdeaRecord[], source: IdeaSource): IdeaRecord[] {
  return ideas.filter(idea => idea.source === source).sort(byId);
}
const priorityRank: Readonly<Record<IdeaPriority, number>> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export function getIdeasSortedByPriority(ideas: readonly IdeaRecord[]): IdeaRecord[] {
  return [...ideas].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || byId(a, b));
}
