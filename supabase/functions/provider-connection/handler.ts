// provider-connection: stores, tests and removes a provider API key for the signed-in owner.
// No Deno or npm imports here so the same file is unit-tested under Node. The key is never logged or returned.

export type KeyCheck = 'VALID' | 'REJECTED' | 'UNAVAILABLE';
export interface ConnectionDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  checkKey(provider: string, key: string): Promise<KeyCheck>;
  store(actorId: string, provider: string, key: string): Promise<unknown>;
  readKey(actorId: string, provider: string): Promise<string | null>;
  mark(actorId: string, provider: string, status: 'CONNECTED' | 'INVALID'): Promise<void>;
  remove(actorId: string, provider: string): Promise<unknown>;
}

const PROVIDERS = new Set(['WAVESPEED']);
const ACTION_KEYS: Record<string, string[]> = { SET: ['action', 'key', 'provider'], TEST: ['action', 'provider'], REMOVE: ['action', 'provider'] };

export function createConnectionHandler(dependencies: ConnectionDependencies) {
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
      let body: Record<string, unknown>;
      try {
        const text = await request.text();
        if (text.length > 4096) return reply(413, { error: 'Solicitud demasiado grande.' });
        body = JSON.parse(text);
      } catch { return reply(400, { error: 'Solicitud inválida.' }); }
      const action = typeof body?.action === 'string' ? body.action : '';
      const expected = ACTION_KEYS[action];
      if (!expected || Object.keys(body).sort().join() !== expected.join() || !PROVIDERS.has(body.provider as string)) return reply(400, { error: 'Solicitud inválida.' });
      const provider = body.provider as string;

      if (action === 'SET') {
        const key = typeof body.key === 'string' ? body.key.trim() : '';
        if (key.length < 16 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) return reply(400, { error: 'Solicitud inválida.' });
        const check = await dependencies.checkKey(provider, key);
        if (check === 'UNAVAILABLE') return reply(503, { error: 'No se pudo comprobar la clave con el proveedor. No se guardó nada.' });
        if (check === 'REJECTED') return reply(422, { error: 'El proveedor rechazó la clave. No se guardó nada.' });
        return reply(200, await dependencies.store(user.id, provider, key));
      }
      if (action === 'TEST') {
        const key = await dependencies.readKey(user.id, provider);
        if (!key) return reply(404, { error: 'No hay una clave guardada.' });
        const check = await dependencies.checkKey(provider, key);
        if (check === 'UNAVAILABLE') return reply(503, { error: 'No se pudo comprobar la clave con el proveedor.' });
        const status = check === 'VALID' ? 'CONNECTED' : 'INVALID';
        await dependencies.mark(user.id, provider, status);
        return reply(200, { provider, status });
      }
      return reply(200, await dependencies.remove(user.id, provider));
    } catch {
      return reply(503, { error: 'No se pudo completar la operación. No se confirmó ningún cambio.' });
    }
  };
}
