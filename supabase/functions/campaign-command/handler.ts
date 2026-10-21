// Domain bundle is generated from the same frontend contracts, without Node imports.
import { applyCampaignOperation, parseCampaignSnapshot, validateCampaignOperation } from '../_shared/campaign-domain.js';

export interface CampaignDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  read(ownerId: string, workspaceId: string): Promise<unknown>;
  commit(ownerId: string, command: unknown, next: unknown): Promise<unknown>;
}
export function createCampaignHandler(dependencies: CampaignDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, { error: 'Sesión requerida.' });
    try {
      const user = await dependencies.verifyUser(token);
      if (!user || user.isAnonymous) return reply(401, { error: 'Sesión no válida.' });
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply(415, { error: 'JSON requerido.' });
      const reader = request.body?.getReader(); if (!reader) return reply(400, { error: 'Solicitud vacía.' });
      let size = 0; const chunks: Uint8Array[] = [];
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 100_000) { await reader.cancel(); return reply(413, { error: 'Solicitud demasiado grande.' }); } chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let command;
      try { command = validateCampaignOperation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
      catch { return reply(400, { error: 'Comando inválido. No se confirmó ningún cambio.' }); }
      const current = parseCampaignSnapshot(await dependencies.read(user.id, command.workspaceId), user.id, command.workspaceId);
      let next;
      try { next = applyCampaignOperation(current, command); }
      catch { return reply(409, { error: 'Conflicto de versión, idempotencia o transición. Recupera el estado antes de decidir.' }); }
      if (next === current) return reply(200, current);
      const saved = parseCampaignSnapshot(await dependencies.commit(user.id, command, next), user.id, command.workspaceId);
      return reply(200, saved);
    } catch {
      return reply(503, { error: 'El servicio no confirmó la operación. Conserva el comando y reintenta.' });
    }
  };
}
