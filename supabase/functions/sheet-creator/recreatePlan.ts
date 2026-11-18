// Recrear (M5): target photo + the model's general face → 1..4 new photos. Pure (unit-tested under Node).
import { takeCost, type Price, type Resolution } from './sheetPlan.ts';
import { MAX_INSTRUCTION, MAX_PROMPT } from './sheetPrompts.ts';

export type Style = 'CINEMATIC' | 'AMATEUR';
export type PublicChannel = 'INSTAGRAM' | 'INSTAGRAM_STORY' | 'TEASER';
export const PUBLIC_CHANNELS: readonly PublicChannel[] = ['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER'];
export const isPublicChannel = (v: unknown): v is PublicChannel => typeof v === 'string' && (PUBLIC_CHANNELS as readonly string[]).includes(v);
export const isStyle = (v: unknown): v is Style => v === 'CINEMATIC' || v === 'AMATEUR';
/** Each model's look (Luis, 2026-11-17): Vesper works best cinematic gothic-romantic; Raxi stays phone-casual. */
export const DEFAULT_STYLE: Record<string, Style> = { 'vesper-corvus': 'CINEMATIC', 'raxi-vox': 'AMATEUR' };
export const STYLE_OPEN: Record<Style, RegExp> = { CINEMATIC: /^Cinematic photograph\b/, AMATEUR: /^Amateur smartphone (photograph|selfie)\b/ };
export const STYLE_CLOSE: Record<Style, string> = { CINEMATIC: 'Cinematic photo, realistic skin texture', AMATEUR: 'Amateur smartphone photo' };

export const MAX_TARGET_BYTES = 3 * 1024 * 1024;
export const MAX_SCENE_TEXT = 1000;
export const MAX_PROMPTER_PROMPT = 3000;
export const MIN_VARIANTS = 1;
export const MAX_VARIANTS = 4;

/** Decodes a data URL and checks the real file header (never trusts the declared type). */
export function decodeTarget(dataUrl: unknown): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp'; bytes: Uint8Array; base64: string } {
  if (typeof dataUrl !== 'string') throw new Error('Sube la foto objetivo.');
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) throw new Error('La foto objetivo debe ser JPG, PNG o WebP.');
  if (m[2].length > Math.ceil(MAX_TARGET_BYTES * 4 / 3) + 4) throw new Error('La foto objetivo supera los 3 MB.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!bytes.length || bytes.length > MAX_TARGET_BYTES) throw new Error('La foto objetivo supera los 3 MB.');
  const mime = m[1] as 'image/png' | 'image/jpeg' | 'image/webp';
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  const ok = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    : mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!ok) throw new Error('El archivo no es la imagen que dice ser.');
  return { mime, ext: mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp', bytes, base64: m[2] };
}

/** A target photo path is only valid inside this workspace's recreate drafts folder (the server writes it there). */
export const isDraftPath = (ws: string, path: unknown): path is string =>
  typeof path === 'string' && new RegExp(`^${ws}/recreate/drafts/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(path);

export function cleanVariants(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_VARIANTS || v > MAX_VARIANTS) throw new Error('Elige de 1 a 4 versiones.');
  return v;
}

/** Each version sends the general face (image 1) and the target photo (image 2). */
export function quoteRecreate(input: { variants: number; price: Price; resolution: Resolution }) {
  const inputs = 2;
  const perPhotoMills = takeCost(input.price, input.resolution, inputs);
  return { perPhotoMills, totalMills: perPhotoMills * input.variants, inputs };
}

// Image roles are stated explicitly (pilot 2026-11-17: without roles the model mixed outfits and duplicated the woman).
export const RECREATE_RULE = 'Image 1 shows who she is: keep her exact face, hair and body. ' +
  'Image 2 is only the scene reference (pose, outfit, place, light and framing): never copy the face, hair or identity of the person in image 2. ' +
  'Only one woman in the photo; if a mirror is visible, it shows only her own reflection. She is clearly an adult.';

/** Final prompt sent to the image model: locked identity → image roles → the prompter's scene → Luis's change. */
export function buildRecreatePrompt(input: { fixedPrompt: string | null; prompt: string; instruction?: string | null }): string {
  const parts = [input.fixedPrompt?.trim() || null, RECREATE_RULE, input.prompt.trim()];
  const instruction = input.instruction?.trim().slice(0, MAX_INSTRUCTION);
  if (instruction) parts.push(instruction);
  const out = parts.filter(Boolean).join('\n\n');
  if (out.length > MAX_PROMPT) throw new Error('El prompt es demasiado largo (máximo 4000 caracteres).');
  return out;
}

/** Luis may edit the prompter's text; it must still follow the chosen style's opening. */
export function cleanEditedPrompt(prompt: unknown, style: Style): string {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Falta el prompt.');
  const p = prompt.trim();
  if (p.length > MAX_PROMPTER_PROMPT) throw new Error('El prompt es demasiado largo (máximo 3000 caracteres).');
  if (!STYLE_OPEN[style].test(p)) throw new Error(style === 'CINEMATIC' ? 'El prompt debe empezar con «Cinematic photograph».' : 'El prompt debe empezar con «Amateur smartphone photograph» o «Amateur smartphone selfie».');
  return p;
}
