// Recrear (M5): target photo + the model's general face → 1..4 new photos. Pure (unit-tested under Node).
import { takeCost, type Price, type Resolution } from './sheetPlan.ts';
import { MAX_INSTRUCTION, MAX_PROMPT } from './sheetPrompts.ts';
import { CHANNEL_LEVEL, isChannel, type Channel, type ContentLevel, type Ref } from './seriesPlan.ts';
export { CHANNEL_LEVEL, isChannel, type Channel, type ContentLevel };

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

/** Fanvue targets live in their own folder, so an adult target photo can never feed a public recreation. */
export const draftFolder = (level: ContentLevel) => (level === 'PUBLIC' ? 'drafts' : 'drafts-adult');
/** A target photo path is only valid inside this workspace's drafts folder for that level (the server writes it there). */
export const isDraftPath = (ws: string, path: unknown, level: ContentLevel = 'PUBLIC'): path is string =>
  typeof path === 'string' && new RegExp(`^${ws}/recreate/${draftFolder(level)}/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(path);

/** Public: general face only. Fanvue: general face + the current adult body reference when it exists. */
export function recreateRefs(level: ContentLevel, refs: { face?: Ref; adultBody?: Ref }): Ref[] {
  if (!refs.face) throw new Error('Primero elige la cara de frente de la ficha general.');
  return level === 'PUBLIC' || !refs.adultBody ? [refs.face] : [refs.face, refs.adultBody];
}

export const MAX_ADULT_TEXT = 1500;
/** Luis's own wardrobe and adult part: required for Fanvue, never on public channels. Claude never writes it. */
export function cleanAdultText(text: unknown, level: ContentLevel): string | null {
  const t = typeof text === 'string' ? text.trim() : '';
  if (level === 'PUBLIC') { if (t) throw new Error('Los canales públicos no llevan parte adulta.'); return null; }
  if (!t) throw new Error('Escribe el vestuario y la parte adulta para Fanvue.');
  if (t.length > MAX_ADULT_TEXT) throw new Error('La parte adulta es demasiado larga (máximo 1500 caracteres).');
  return t;
}

export function cleanVariants(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_VARIANTS || v > MAX_VARIANTS) throw new Error('Elige de 1 a 4 versiones.');
  return v;
}

/** Each version sends the references (face, and the adult body on Fanvue) plus the target photo last. */
export function quoteRecreate(input: { variants: number; price: Price; resolution: Resolution; refs?: number }) {
  const inputs = (input.refs ?? 1) + 1;
  const perPhotoMills = takeCost(input.price, input.resolution, inputs);
  return { perPhotoMills, totalMills: perPhotoMills * input.variants, inputs };
}

// Image roles are stated explicitly (pilot 2026-11-17: without roles the model mixed outfits and duplicated the woman).
export const RECREATE_RULE = 'Image 1 shows who she is: keep her exact face, hair and body. ' +
  'Image 2 is only the scene reference (pose, outfit, place, light and framing): never copy the face, hair or identity of the person in image 2. ' +
  'Only one woman in the photo; if a mirror is visible, it shows only her own reflection. She is clearly an adult.';

/** Image roles for Fanvue: face, optional adult body, target last. The outfit comes from Luis's text, not from the target. */
export function recreateRule(level: ContentLevel, refs: number): string {
  if (level === 'PUBLIC') return RECREATE_RULE;
  const t = refs + 1;
  return 'Image 1 shows who she is: keep her exact face and hair. ' +
    (refs > 1 ? 'Image 2 shows her body: keep the same body shape and skin tone. ' : 'Keep her body shape and skin tone. ') +
    `Image ${t} is only the scene reference (pose, place, light and framing): never copy the face, hair, body or identity of the person in image ${t}, ` +
    `and take the outfit from the text below, not from image ${t}. ` +
    'Only one woman in the photo; if a mirror is visible, it shows only her own reflection. She is clearly an adult.';
}

/** Final prompt: locked identity → image roles → the prompter's scene → Luis's adult part (Fanvue) → Luis's change. */
export function buildRecreatePrompt(input: { fixedPrompt: string | null; prompt: string; instruction?: string | null; rule?: string; adultText?: string | null }): string {
  const parts = [input.fixedPrompt?.trim() || null, input.rule ?? RECREATE_RULE, input.prompt.trim(), input.adultText?.trim() || null];
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
