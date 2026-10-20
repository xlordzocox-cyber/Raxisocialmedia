import { RequestError, validateCreateCommand, type ValidatedCreateCommand } from '../_shared/ideaCommand.ts';

export interface IdeaWriteDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  /** Must check ownership and commit idea + idempotency + audit in ONE PostgreSQL transaction. */
  commit(userId: string, command: ValidatedCreateCommand): Promise<unknown>;
}
export function createIdeaHandler(dependencies: IdeaWriteDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    const response = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return response(405, { error: 'Método no permitido.' });
    const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '');
    if (!bearer) return response(401, { error: 'Necesitas una sesión autenticada.' });
    try {
      const user = await dependencies.verifyUser(bearer[1]);
      if (!user || user.isAnonymous) return response(401, { error: 'La sesión no es válida.' });
      if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return response(415, { error: 'Se requiere JSON.' });
      // Limit bytes while streaming, including bodies with no Content-Length header.
      const reader = request.body?.getReader();
      if (!reader) return response(400, { error: 'Solicitud vacía.' });
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 12_000) { await reader.cancel(); return response(413, { error: 'Solicitud demasiado grande.' }); }
        chunks.push(value);
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      let raw: unknown;
      try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
      catch { return response(400, { error: 'JSON inválido.' }); }
      const command = validateCreateCommand(raw);
      const canonical = await dependencies.commit(user.id, command);
      return response(200, canonical);
    } catch (cause) {
      if (cause instanceof RequestError) return response(cause.status, { error: cause.message });
      // Never return request bodies, JWTs, credentials, SQL or provider diagnostics.
      return response(503, { error: 'El guardado no se confirmó. Reintenta con la misma operación.' });
    }
  };
}
