// Prompt templates for the 360 sheet. Pure. Order: locked identity → view template → Luis's change instruction.
import type { Level, View } from './sheetPlan.ts';

const STUDIO = 'plain light-grey studio background, soft even lighting, realistic photo, natural skin texture';
// Same wardrobe in every general view so the sheet never mixes outfits (Luis, 2026-11-17).
export const SHEET_WARDROBE = 'wearing only a plain black seamless bra and matching plain black briefs, no other clothing, no jacket, no lace';
const FACE: Partial<Record<View, string>> = {
  FRONT: 'Identity reference photo of the same woman as the reference images: head and shoulders, facing the camera straight on, neutral relaxed expression, eyes to camera, bra straps visible on the shoulders',
  THREE_QUARTER: 'Identity reference photo of the same woman as the reference images: head and shoulders, head turned three-quarters to her left, neutral relaxed expression, bra straps visible on the shoulders',
  PROFILE: 'Identity reference photo of the same woman as the reference images: head and shoulders, face in full side profile facing left, neutral relaxed expression, bra straps visible on the shoulders',
};
// Every body view, general or adult, is framed the same so the two sheets are comparable (Luis, 2026-11-17).
export const BODY_FRAME = 'full body from the neck down to the feet, both feet fully visible on the floor, nothing cropped below the neck';
const BODY_VIEW: Partial<Record<View, string>> = { BODY_FRONT: 'front view', BODY_SIDE: 'side view, facing left', BODY_BACK: 'back view' };
const GENERAL_BODY = `Full body reference photo, headless, cropped at the neck, standing, natural relaxed pose, arms relaxed at the sides, ${SHEET_WARDROBE}, same body proportions and skin tone as the reference images`;
export const ADULT_TEMPLATE = 'Nude figure study, artistic anatomical reference, neutral standing pose, non-sexual, headless, cropped at the neck, arms relaxed at the sides, same body proportions and skin tone as the reference images';

export const MAX_PROMPT = 4000;
export const MAX_INSTRUCTION = 300;
export const MAX_ADULT_TEMPLATE = 1500;

export function buildSheetPrompt(input: { level: Level; view: View; fixedPrompt: string | null; instruction?: string | null; adultTemplate?: string | null }): string {
  const { level, view } = input;
  let template: string;
  if (FACE[view]) {
    if (level === 'ADULT') throw new Error('Esa vista no existe en la ficha adulta.');
    template = `${FACE[view]}, ${SHEET_WARDROBE}, ${STUDIO}.`;
  } else {
    const base = level === 'ADULT' ? (input.adultTemplate?.trim() ? input.adultTemplate.trim().slice(0, MAX_ADULT_TEMPLATE) : ADULT_TEMPLATE) : GENERAL_BODY;
    template = `${base.replace(/[.\s]+$/, '')}, ${BODY_FRAME}, ${BODY_VIEW[view]}, ${STUDIO}.`;
  }
  const parts = [input.fixedPrompt?.trim() || null, template];
  const instruction = input.instruction?.trim().slice(0, MAX_INSTRUCTION);
  if (instruction) parts.push(instruction);
  const prompt = parts.filter(Boolean).join('\n\n');
  if (prompt.length > MAX_PROMPT) throw new Error('El prompt es demasiado largo (máximo 4000 caracteres).');
  return prompt;
}
