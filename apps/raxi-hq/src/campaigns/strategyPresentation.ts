import type { CampaignContentLevel } from './campaignContracts';
import type { IdeaChannel } from '../ideas/ideaContracts';
import type { StrategyStatus } from './strategyContracts';

export const strategyStatusLabel: Record<StrategyStatus, string> = {
  DRAFT: 'Borrador', IN_REVIEW: 'Lista para revisión', CHANGES_REQUESTED: 'Cambios solicitados', APPROVED: 'Aprobada',
};
export const strategyFormatLabel = {
  PHOTO: 'Foto', CAROUSEL: 'Carrusel', SHORT_VIDEO: 'Vídeo corto', STORY: 'Story', CHAT_PHOTO: 'Foto para chat',
} as const;
export function compatibleLevels(channel: IdeaChannel, levels: readonly CampaignContentLevel[]): CampaignContentLevel[] {
  const allowed: Record<IdeaChannel, readonly CampaignContentLevel[]> = {
    INSTAGRAM_FEED: ['PUBLIC_SOCIAL', 'TEASER'], INSTAGRAM_REEL: ['PUBLIC_SOCIAL', 'TEASER'],
    INSTAGRAM_STORY: ['PUBLIC_SOCIAL', 'TEASER'], TEASER: ['TEASER'],
    FANVIEW_FEED: ['FANVIEW_FEED'], FANVIEW_CHAT: ['FANVIEW_CHAT'],
  };
  return levels.filter(level => allowed[channel].includes(level));
}
