// Multimedia: every archived original of the workspace (like Aria "Mis creaciones"), newest first.
// Pure, validated read model: rows come from RLS-scoped owner reads; malformed or foreign rows are rejected.

export interface MediaAsset {
  id: string; objectPath: string; mimeType: string; byteSize: number; sha256: string;
  ariaFile: string | null; characterId: string | null; createdAt: string; campaigns: string[];
}
export interface MediaView { assets: MediaAsset[]; characters: string[] }

const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Multimedia: dato inválido');
  return v;
};
const soft = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export function buildMedia(workspaceId: string, rawAssets: unknown, rawItems: unknown, rawCollections: unknown): MediaView {
  if (!Array.isArray(rawAssets) || !Array.isArray(rawItems) || !Array.isArray(rawCollections)) throw new Error('Multimedia: respuesta inválida');
  const titles = new Map<string, string>();
  for (const c of rawCollections as Record<string, unknown>[]) {
    if (c.workspace_id !== workspaceId) throw new Error('Multimedia: colección ajena');
    titles.set(str(c.id, 64), str(c.title, 160));
  }
  const campaignsOf = new Map<string, Set<string>>();
  for (const i of rawItems as Record<string, unknown>[]) {
    if (i.workspace_id !== workspaceId) throw new Error('Multimedia: publicación ajena');
    const assetId = soft(i.asset_id, 64); const title = titles.get(String(i.collection_id));
    if (!assetId || !title) continue;
    if (!campaignsOf.has(assetId)) campaignsOf.set(assetId, new Set());
    campaignsOf.get(assetId)!.add(title);
  }
  const assets = (rawAssets as Record<string, unknown>[]).map((a): MediaAsset => {
    if (a.workspace_id !== workspaceId) throw new Error('Multimedia: asset ajeno');
    const path = str(a.object_path, 400);
    if (path.split('/')[0] !== workspaceId) throw new Error('Multimedia: ruta ajena');
    const sha = str(a.sha256, 64);
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Multimedia: hash inválido');
    const meta = (a.metadata && typeof a.metadata === 'object' ? a.metadata : {}) as Record<string, unknown>;
    const id = str(a.id, 64);
    return {
      id, objectPath: path, mimeType: str(a.mime_type, 64), byteSize: Number(a.byte_size), sha256: sha,
      ariaFile: soft(meta.aria_file, 200) ?? soft(a.external_asset_id, 200), characterId: soft(meta.character_id, 64),
      createdAt: str(a.created_at, 64), campaigns: [...(campaignsOf.get(id) ?? [])].sort(),
    };
  }).filter((a) => a.mimeType.startsWith('image/'));
  assets.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const characters = [...new Set(assets.flatMap((a) => (a.characterId ? [a.characterId] : [])))].sort();
  return { assets, characters };
}

export type MediaFilter = { character: string | 'ALL'; onlyLoose: boolean };
export const filterMedia = (assets: MediaAsset[], f: MediaFilter): MediaAsset[] =>
  assets.filter((a) => (f.character === 'ALL' || a.characterId === f.character) && (!f.onlyLoose || a.campaigns.length === 0));

/** Groups by local day (YYYY-MM-DD) keeping newest-first order, like a camera roll. */
export function groupByDay(assets: MediaAsset[], timeZone?: string): { day: string; assets: MediaAsset[] }[] {
  const fmt = new Intl.DateTimeFormat('es-MX', { timeZone, day: 'numeric', month: 'long', year: 'numeric' });
  const groups: { day: string; assets: MediaAsset[] }[] = [];
  for (const a of assets) {
    const d = new Date(a.createdAt); const day = Number.isNaN(d.getTime()) ? 'Sin fecha' : fmt.format(d);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.assets.push(a); else groups.push({ day, assets: [a] });
  }
  return groups;
}

export const characterLabel = (id: string): string =>
  ({ 'vesper-corvus': 'Vesper Corvus', 'raxi-vox': 'Raxi Vox' } as Record<string, string>)[id] ?? id;
