import type { CampaignContentLevel, CampaignStatus } from './campaignContracts';

export const contentLevelLabel: Record<CampaignContentLevel, string> = {
  PUBLIC_SOCIAL: 'Redes públicas', TEASER: 'Teaser / puente', FANVIEW_FEED: 'Fanvue Feed', FANVIEW_CHAT: 'Fanvue Chat',
};
export const campaignStatusLabel: Record<CampaignStatus, string> = {
  DRAFT: 'Borrador', PLANNING: 'Planificación', BLOCKED: 'Bloqueada', CANCELED: 'Cancelada',
};
