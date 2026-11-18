import type { TakeStatus } from '../creator/creatorModel';

export type Style = 'CINEMATIC' | 'AMATEUR';
export type Channel = 'INSTAGRAM' | 'INSTAGRAM_STORY' | 'TEASER' | 'FANVUE_FEED' | 'FANVUE_CHAT';
export type ContentLevel = 'PUBLIC' | 'NSFW' | 'EXPLICIT';
export const CHANNEL_LABEL: Record<Channel, string> = { INSTAGRAM: 'Instagram (feed)', INSTAGRAM_STORY: 'Instagram Stories', TEASER: 'Teaser',
  FANVUE_FEED: 'Fanvue feed', FANVUE_CHAT: 'Fanvue chatting' };
/** Same mapping as the server (seriesPlan.ts); the server decides, this only labels. */
export const CHANNEL_LEVEL: Record<Channel, ContentLevel> = { INSTAGRAM: 'PUBLIC', INSTAGRAM_STORY: 'PUBLIC', TEASER: 'PUBLIC', FANVUE_FEED: 'NSFW', FANVUE_CHAT: 'EXPLICIT' };
/** Label on every adult approval (AGENTS.md): "NSFW · Fanvue feed" / "EXPLICIT · Fanvue chatting". */
export const levelTag = (c: Channel) => (CHANNEL_LEVEL[c] === 'PUBLIC' ? null : `${CHANNEL_LEVEL[c]} · ${CHANNEL_LABEL[c]}`);
export const STYLE_LABEL: Record<Style, string> = { CINEMATIC: 'Cinematográfico', AMATEUR: 'Amateur de móvil' };
/** Same defaults as the server (recreatePlan.ts): Vesper cinematic gothic, Raxi phone-casual. */
export const DEFAULT_STYLE: Record<string, Style> = { 'vesper-corvus': 'CINEMATIC', 'raxi-vox': 'AMATEUR' };
export const PROMPTER_ESTIMATE = 'unos $0.02'; // Sonnet 5.5 with two images; the real cost is shown after each call

export interface Prepared { objectivePath: string; objectiveUrl: string; prompt: string; summary: string; observations: string[]; warnings: string[]; promptCostMills: number }
export interface RecreateQuote { totalMills: number; perPhotoMills: number; spentMills: number; capMills: number }
export interface RecreateTake { id: string; variant: number; takeNo: number; status: TakeStatus; costMills: number; error: string | null; chosen: boolean; previewUrl: string | null }
export interface RecreateView { recreationId: string; character: string; channel: Channel; level?: ContentLevel; style: Style; prompt: string; variants: number; objectiveUrl: string; takes: RecreateTake[] }
export const recreateBusy = (v: RecreateView | null) => Boolean(v?.takes.some((t) => t.status === 'QUEUED' || t.status === 'PENDING'));

export const MAX_TARGET_BYTES = 3 * 1024 * 1024;
const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('No se pudo leer la foto.')); r.readAsDataURL(blob);
});

/** Reads the target photo as a data URL. Phone photos over 3 MB are scaled down to a JPEG (max 2048 px) in the browser. */
export async function readTarget(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('La foto objetivo debe ser JPG, PNG o WebP.');
  if (file.size <= MAX_TARGET_BYTES) return readAsDataUrl(file);
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error('La foto supera los 3 MB. Usa una más ligera.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.88));
  if (!blob || blob.size > MAX_TARGET_BYTES) throw new Error('La foto supera los 3 MB incluso reducida. Usa una más ligera.');
  return readAsDataUrl(blob);
}
