// talent-reference: stores one identity reference image for the signed-in owner. No Deno or npm imports,
// so the same file is unit-tested under Node. Every reference carries its level: GENERAL (clothed) or ADULT (NSFW, Fanvue only).

export interface ReferenceRow {
  id: string; workspace_id: string; kind: 'REFERENCE'; object_path: string; mime_type: string; byte_size: number; sha256: string;
  metadata: { character_id: string; angle: string; content_level: 'PUBLIC' | 'NSFW'; source: 'LUIS_UPLOAD' };
}
export interface ReferenceDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  workspaceOf(userId: string): Promise<string | null>;
  findBySha(workspaceId: string, sha256: string): Promise<{ id: string; kind: string; characterId: string | null } | null>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  register(row: ReferenceRow): Promise<void>;
  removeObject(path: string): Promise<void>;
  newId(): string;
  sha256(bytes: Uint8Array): Promise<string>;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
const ANGLES = new Set(['FRONT', 'THREE_QUARTER', 'PROFILE', 'BACK', 'FULL_BODY', 'SHEET']);
const LEVELS: Record<string, 'PUBLIC' | 'NSFW'> = { GENERAL: 'PUBLIC', ADULT: 'NSFW' };
const MAX_BYTES = 15 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Decides the type from the bytes, never from the file name or the browser's claim. */
export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createReferenceHandler(dependencies: ReferenceDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, { error: 'Sesión requerida.' });
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES + 64 * 1024) return reply(413, { error: 'La imagen supera 15 MB.' });
    let path: string | null = null;
    try {
      const user = await dependencies.verifyUser(token);
      if (!user || user.isAnonymous) return reply(401, { error: 'Sesión no válida.' });
      const workspaceId = await dependencies.workspaceOf(user.id);
      if (!workspaceId) return reply(403, { error: 'No tienes acceso a este workspace.' });
      let form: FormData;
      try { form = await request.formData(); } catch { return reply(400, { error: 'Solicitud inválida.' }); }
      const character = form.get('character'); const angle = form.get('angle'); const file = form.get('file');
      if (typeof character !== 'string' || !ROSTER.has(character) || typeof angle !== 'string' || !ANGLES.has(angle)) return reply(400, { error: 'Modelo o ángulo no válido.' });
      const level = LEVELS[String(form.get('level'))];
      if (!level) return reply(400, { error: 'Indica si la ficha es general (con ropa) o adulta (NSFW).' });
      if (!(file instanceof Blob) || file.size < 1) return reply(400, { error: 'Falta la imagen.' });
      if (file.size > MAX_BYTES) return reply(413, { error: 'La imagen supera 15 MB.' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImage(bytes);
      if (!mime) return reply(415, { error: 'Solo se aceptan imágenes JPG, PNG o WebP.' });
      const sha256 = await dependencies.sha256(bytes);
      const existing = await dependencies.findBySha(workspaceId, sha256);
      if (existing) {
        if (existing.kind === 'REFERENCE' && existing.characterId === character) return reply(200, { assetId: existing.id, character, angle, duplicate: true });
        return reply(409, { error: 'Esa imagen ya está en el archivo con otro uso.' });
      }
      const id = dependencies.newId();
      path = `${workspaceId}/references/${character}/${sha256}.${EXT[mime]}`;
      await dependencies.upload(path, bytes, mime);
      await dependencies.register({ id, workspace_id: workspaceId, kind: 'REFERENCE', object_path: path, mime_type: mime, byte_size: bytes.length, sha256,
        metadata: { character_id: character, angle, content_level: level, source: 'LUIS_UPLOAD' } });
      return reply(200, { assetId: id, character, angle, duplicate: false });
    } catch {
      if (path) { try { await dependencies.removeObject(path); } catch { /* keep the original error */ } }
      return reply(503, { error: 'No se pudo guardar la referencia. No se confirmó ningún cambio.' });
    }
  };
}
