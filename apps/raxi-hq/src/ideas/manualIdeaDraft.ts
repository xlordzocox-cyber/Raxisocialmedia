import { IDEA_PRIORITIES, type IdeaPriority } from './ideaContracts';
import { MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH, validateIdeaTimestamp } from './ideaValidation';

/** In-memory capture only. A draft is neither an IdeaRecord nor a Campaign. */
export interface ManualIdeaDraft {
  id: string;
  title: string;
  note: string;
  priority: IdeaPriority;
  createdAt: string;
  updatedAt: string;
  sourceRef?: string;
}

export interface ManualIdeaInput {
  title: string;
  note: string;
  priority: IdeaPriority;
  sourceRef?: string;
}

export function validateSingleLineText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${label}: texto obligatorio, sin controles y de máximo ${maximum} caracteres.`);
  }
  return value;
}

/** Only LF is accepted as a line break. CR and CRLF are rejected, never normalized silently. */
export function validateMultilineText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${label}: texto obligatorio, admite saltos de línea LF y máximo ${maximum} caracteres.`);
  }
  return value;
}

export function validateManualIdeaInput(value: ManualIdeaInput): ManualIdeaInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Borrador inválido.');
  const source = value as unknown as Record<string, unknown>;
  const title = validateSingleLineText(Object.hasOwn(source, 'title') ? source.title : undefined, MAX_TITLE_LENGTH, 'Título');
  const note = validateMultilineText(Object.hasOwn(source, 'note') ? source.note : undefined, MAX_SUMMARY_LENGTH, 'Nota');
  const priority = Object.hasOwn(source, 'priority') ? source.priority : undefined;
  if (!IDEA_PRIORITIES.includes(priority as IdeaPriority)) throw new Error('Prioridad inválida.');
  const sourceRef = Object.hasOwn(source, 'sourceRef') ? source.sourceRef : undefined;
  return { title, note, priority: priority as IdeaPriority,
    sourceRef: sourceRef === undefined ? undefined : validateSingleLineText(sourceRef, 256, 'Referencia') };
}

export function createManualIdeaDraft(id: string, input: ManualIdeaInput, at: string): ManualIdeaDraft {
  if (!/^IDEA-MANUAL-\d{3,}$/.test(id)) throw new Error('ID manual inválido.');
  const data = validateManualIdeaInput(input);
  const timestamp = validateIdeaTimestamp(at);
  return { id, ...data, createdAt: timestamp, updatedAt: timestamp };
}
