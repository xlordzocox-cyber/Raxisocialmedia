// Continuity prompt: locked identity → continuity rule → the scene of this photo → Luis's change instruction.
import { MAX_INSTRUCTION, MAX_PROMPT } from './sheetPrompts.ts';

export const CONTINUITY = 'Same outfit, hairstyle, makeup, location and lighting as image 1; same woman as the reference images. New photo of the same moment:';

export function buildSeriesPrompt(input: { fixedPrompt: string | null; scene: string; instruction?: string | null }): string {
  const parts = [input.fixedPrompt?.trim() || null, `${CONTINUITY} ${input.scene.trim()}`];
  const instruction = input.instruction?.trim().slice(0, MAX_INSTRUCTION);
  if (instruction) parts.push(instruction);
  const prompt = parts.filter(Boolean).join('\n\n');
  if (prompt.length > MAX_PROMPT) throw new Error('El prompt es demasiado largo (máximo 4000 caracteres).');
  return prompt;
}
