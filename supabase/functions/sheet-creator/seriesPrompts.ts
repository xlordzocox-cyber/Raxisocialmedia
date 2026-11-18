// Continuity prompt: locked identity → continuity rule → the scene of this photo → Luis's change instruction.
import { MAX_INSTRUCTION, MAX_PROMPT } from './sheetPrompts.ts';

// Each image gets an explicit role (pilot 2026-11-17: without it the model mixed outfits and duplicated the woman).
export const CONTINUITY = 'Image 1 is the photo to continue: keep exactly the same outfit, hairstyle, makeup, jewelry, location and lighting as image 1. ' +
  'The other images only show who she is (face and body shape): ignore their clothing, pose and background. ' +
  'Only one woman in the photo; if a mirror is visible, it shows only her own reflection. New photo of the same moment:';

export function buildSeriesPrompt(input: { fixedPrompt: string | null; scene: string; instruction?: string | null }): string {
  const parts = [input.fixedPrompt?.trim() || null, `${CONTINUITY} ${input.scene.trim()}`];
  const instruction = input.instruction?.trim().slice(0, MAX_INSTRUCTION);
  if (instruction) parts.push(instruction);
  const prompt = parts.filter(Boolean).join('\n\n');
  if (prompt.length > MAX_PROMPT) throw new Error('El prompt es demasiado largo (máximo 4000 caracteres).');
  return prompt;
}
