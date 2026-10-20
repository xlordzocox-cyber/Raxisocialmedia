export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError(400, 'Solicitud inválida.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RequestError(400, 'La creación no permite editar identidad, procedencia ni estado.');
}
function text(value: unknown, max: number, multiline = false): string {
  const controls = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/ : /[\u0000-\u001f\u007f-\u009f]/;
  if (typeof value !== 'string' || !value.trim() || value.length > max || controls.test(value)) throw new RequestError(400, 'Texto vacío, demasiado largo o con caracteres no permitidos.');
  return value;
}
export function validateCreateCommand(value: unknown) {
  const body = object(value);
  keys(body, ['workspaceId', 'externalId', 'operationId', 'input']);
  const workspaceId = text(body.workspaceId, 36), externalId = text(body.externalId, 128), operationId = text(body.operationId, 36);
  if (!UUID.test(workspaceId) || !UUID.test(operationId) || !externalId.startsWith('IDEA-REAL-') || !UUID.test(externalId.slice(10))) {
    throw new RequestError(400, 'Identificadores inválidos; las ideas DEMO no son importables.');
  }
  const input = object(body.input);
  keys(input, ['title', 'note', 'priority', 'sourceRef']);
  if (!['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(input.priority))) throw new RequestError(400, 'Prioridad inválida.');
  return { workspaceId, externalId, operationId, input: {
    title: text(input.title, 120), note: text(input.note, 1000, true), priority: input.priority as string,
    ...(input.sourceRef === undefined ? {} : { sourceRef: text(input.sourceRef, 256) }),
  } };
}
export type ValidatedCreateCommand = ReturnType<typeof validateCreateCommand>;
