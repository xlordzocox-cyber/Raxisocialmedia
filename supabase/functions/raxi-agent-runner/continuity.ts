// Continuity inside a campaign (Luis, 2026-11-17): Aria makes one base photo per moment and the creator engine makes
// the rest of that moment. Pure helpers, no Deno/npm imports (unit-tested under Node).

export const PUBLIC_CHANNELS = new Set(['INSTAGRAM', 'INSTAGRAM_STORY', 'TEASER']);
export const MAX_PER_BASE = 6;

export interface Post { posicion?: unknown; continuidad_de?: unknown; escena?: unknown; plano?: unknown; prompt?: unknown }
/** For each design post (1-based order): null if it is a new photo, or the position of the base photo it continues. */
export function continuityOf(posts: Post[]): (number | null)[] {
  const out: (number | null)[] = [];
  const count = new Map<number, number>();
  posts.forEach((p, idx) => {
    const base = Number(p.continuidad_de);
    const valid = Number.isInteger(base) && base >= 1 && base <= idx && out[base - 1] === null && (count.get(base) ?? 0) < MAX_PER_BASE;
    if (valid) count.set(base, (count.get(base) ?? 0) + 1);
    out.push(valid ? base : null);
  });
  return out;
}

/** The scene sent to the creator for one continuation: what the Creative wrote, without Aria-specific wording. */
export const continuationScene = (p: Post): string =>
  [p.escena, p.plano].map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).join('. ').slice(0, 300);

export interface CampaignItem { id: string; position: number; asset_id: string | null; human_decision?: string; payload: Record<string, unknown> }
export interface Group { basePosition: number; baseItemId: string; baseAssetId: string | null; items: CampaignItem[]; scenes: string[] }

/** Continuations still to make, grouped by their base photo. Rejected or already-made photos are left out. */
export function continuityGroups(items: CampaignItem[]): Group[] {
  const byPos = new Map(items.map((i) => [i.position, i]));
  const groups = new Map<number, Group>();
  for (const it of [...items].sort((a, b) => a.position - b.position)) {
    const p = it.payload ?? {};
    if (p.kind !== 'PHOTO_TO_CONTINUE' || it.asset_id || it.human_decision === 'REJECTED' || typeof p.series_id === 'string') continue;
    const base = byPos.get(Number(p.base_position));
    if (!base) continue;
    const g = groups.get(base.position) ?? { basePosition: base.position, baseItemId: base.id, baseAssetId: base.asset_id, items: [], scenes: [] };
    if (g.items.length >= MAX_PER_BASE) continue;
    g.items.push(it); g.scenes.push(String(p.scene ?? '').slice(0, 300) || 'another natural moment of the same scene');
    groups.set(base.position, g);
  }
  return [...groups.values()];
}

export interface ContinuityReadiness { channel: string; identityLocked: boolean; hasGeneralRefs: boolean; keyConnected: boolean; priceEnabled: boolean }
/** Why the continuity part cannot be made automatically (null when it can). */
export function continuityBlocked(r: ContinuityReadiness): string | null {
  if (!PUBLIC_CHANNELS.has(r.channel)) return 'Campaña de Fanvue: las fotos de continuidad quedan como serie pendiente. Tú escribes sus escenas y la lanzas desde la Fototeca.';
  if (!r.identityLocked) return 'La modelo no tiene identidad bloqueada en Talento; la continuidad no se genera.';
  if (!r.hasGeneralRefs) return 'Falta elegir la cara de frente de la ficha general; la continuidad no se genera.';
  if (!r.keyConnected) return 'La clave de WaveSpeed no está conectada en Conexiones; la continuidad no se genera.';
  if (!r.priceEnabled) return 'El modelo de continuidad no tiene precio verificado; la continuidad no se genera.';
  return null;
}

/** Order lines for the continuity part. Each photo sends base + general face (public channels only). */
export function continuityOrder(groups: Group[], perPhotoMills: number, blocked: string | null) {
  const photos = groups.reduce((n, g) => n + g.items.length, 0);
  if (!photos) return null;
  if (blocked) return { grupos: [], fotos: photos, precio_por_foto_usd: 0, total_mills: 0, total_usd: 0, nota: blocked };
  const total = perPhotoMills * photos;
  return { grupos: groups.map((g) => ({ base_posicion: g.basePosition, item_ids: g.items.map((i) => i.id), escenas: g.scenes, total_mills: perPhotoMills * g.items.length })),
    fotos: photos, precio_por_foto_usd: perPhotoMills / 1000, total_mills: total, total_usd: total / 1000,
    nota: 'Se generan con el creador de Raxi HQ (WaveSpeed, Seedream 5.5) cuando la foto base esté lista.' };
}
