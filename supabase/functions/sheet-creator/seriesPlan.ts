// Continuity series: channel → content level, references per level, scenes and cost. Pure (unit-tested under Node).
import { takeCost, type Price, type Resolution } from './sheetPlan.ts';

export type Channel = 'INSTAGRAM' | 'INSTAGRAM_STORY' | 'TEASER' | 'FANVUE_FEED' | 'FANVUE_CHAT';
export type ContentLevel = 'PUBLIC' | 'NSFW' | 'EXPLICIT';
export const CHANNELS: readonly Channel[] = ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER', 'FANVUE_FEED', 'FANVUE_CHAT'];
export const CHANNEL_LEVEL: Record<Channel, ContentLevel> = { INSTAGRAM: 'PUBLIC', INSTAGRAM_STORY: 'PUBLIC', TEASER: 'PUBLIC', FANVUE_FEED: 'NSFW', FANVUE_CHAT: 'EXPLICIT' };
const RANK: Record<ContentLevel, number> = { PUBLIC: 1, NSFW: 2, EXPLICIT: 3 };
export const isChannel = (v: unknown): v is Channel => typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);
export const levelOf = (v: unknown): ContentLevel => (v === 'NSFW' || v === 'EXPLICIT' ? v : 'PUBLIC');

/** Channels a base photo may feed: its own level or higher, never lower (AGENTS.md). */
export const channelsFor = (baseLevel: ContentLevel): Channel[] => CHANNELS.filter((c) => RANK[CHANNEL_LEVEL[c]] >= RANK[baseLevel]);

export interface Ref { id: string; objectPath: string }
/** Identity references for a series. The base photo (image 1) already carries outfit, place and light, so a clothed
 *  body reference would compete with the base outfit (pilot 2026-11-17: the sheet's black underwear replaced the base outfit).
 *  Public: general face only. Fanvue: general face + adult body when it exists. Never an adult reference in a public series. */
export function seriesRefs(level: ContentLevel, refs: { face?: Ref; body?: Ref; adultBody?: Ref }): Ref[] {
  if (!refs.face) throw new Error('Primero elige la cara de frente de la ficha general.');
  return level === 'PUBLIC' || !refs.adultBody ? [refs.face] : [refs.face, refs.adultBody];
}
export const SERIES_RESOLUTION = '1.5k'; // same verified price as 1k on WaveSpeed (2026-11-17), more detail

export const MAX_SCENE = 300;
export function cleanScenes(raw: unknown): string[] {
  const scenes = Array.isArray(raw) ? raw.map((s) => (typeof s === 'string' ? s.trim() : '')) : [];
  if (scenes.length < 2 || scenes.length > 6) throw new Error('Una serie lleva de 2 a 6 fotos nuevas.');
  if (scenes.some((s) => s.length < 1 || s.length > MAX_SCENE)) throw new Error('Cada escena debe tener de 1 a 300 caracteres.');
  return scenes;
}

/** Each photo sends the base (image 1) plus the references. */
export function quoteSeries(input: { shots: number; refs: number; resolution: Resolution; price: Price }) {
  const perPhotoMills = takeCost(input.price, input.resolution, 1 + input.refs);
  return { perPhotoMills, totalMills: perPhotoMills * input.shots, inputs: 1 + input.refs };
}
