import type { IdeaChannel, IdeaPriority, IdeaSource, IdeaStatus } from './ideaContracts';
import type { IdeaProvenance } from './ideaCenterSession';

/** Labels belong to the view; canonical Idea Center values stay unchanged. */
export const ideaStatusLabel: Record<IdeaStatus, string> = {
  PROPOSED: 'Nueva',
  UNDER_REVIEW: 'En análisis',
  APPROVED_FOR_HQ: 'Aprobada para HQ',
  SENT_TO_HQ: 'Enviada al HQ',
  REJECTED: 'Rechazada',
  ARCHIVED: 'Archivada',
};

export const ideaPriorityLabel: Record<IdeaPriority, string> = {
  LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente',
};

export const ideaSourceLabel: Record<IdeaSource, string> = {
  MANUAL_LUIS: 'Luis',
  TREND_RADAR: 'Radar de tendencias',
  ANALYTICS: 'Analytics',
  EDITORIAL_CALENDAR: 'Calendario editorial',
  SUPERMEMORY_INSIGHT: 'Insight de memoria',
  EXTERNAL_SIGNAL: 'Señal externa',
};

export const ideaProvenanceLabel: Record<IdeaProvenance, string> = {
  MOCK: 'MOCK',
  MOCK_SESSION_MODIFIED: 'MOCK · MODIFICADO EN SESIÓN',
  LOCAL_SESSION: 'LOCAL · SESIÓN',
};

export const ideaChannelLabel: Record<IdeaChannel, string> = {
  INSTAGRAM_FEED: 'Instagram Feed',
  INSTAGRAM_REEL: 'Instagram Reel',
  INSTAGRAM_STORY: 'Instagram Stories',
  TEASER: 'Teaser',
  FANVIEW_FEED: 'FanView Feed',
  FANVIEW_CHAT: 'FanView Chat',
};
