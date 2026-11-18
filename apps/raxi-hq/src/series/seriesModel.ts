export type Channel = 'INSTAGRAM' | 'INSTAGRAM_STORY' | 'TEASER' | 'FANVUE_FEED' | 'FANVUE_CHAT';
export const CHANNEL_LABEL: Record<Channel, string> = {
  INSTAGRAM: 'Instagram (feed)', INSTAGRAM_STORY: 'Instagram Stories', TEASER: 'Teaser', FANVUE_FEED: 'Fanvue feed · NSFW', FANVUE_CHAT: 'Fanvue chatting · EXPLICIT',
};
export const CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];
export const isAdultChannel = (c: Channel) => c === 'FANVUE_FEED' || c === 'FANVUE_CHAT';
export interface SeriesTake { id: string; shot: number; takeNo: number; status: 'QUEUED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; costMills: number; error: string | null; chosen: boolean; previewUrl: string | null }
export interface SeriesView { seriesId: string; character: string; channel: Channel; level: 'PUBLIC' | 'NSFW' | 'EXPLICIT'; model: string; scenes: string[]; baseUrl: string; collectionId: string | null; takes: SeriesTake[] }
export interface SeriesQuote { totalMills: number; perPhotoMills: number; level: string; channels: Channel[]; spentMills: number; capMills: number }
export const seriesBusy = (v: SeriesView | null) => Boolean(v?.takes.some((t) => t.status === 'QUEUED' || t.status === 'PENDING'));
export const validScenes = (scenes: string[]) => scenes.length >= 2 && scenes.length <= 6 && scenes.every((s) => s.trim().length >= 1 && s.trim().length <= 300);
