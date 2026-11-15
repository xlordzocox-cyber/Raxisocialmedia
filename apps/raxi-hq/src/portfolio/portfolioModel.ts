// Fototeca: pure, validated read model. Rows come from RLS-scoped owner reads;
// anything malformed is rejected instead of being rendered as real content.

export type PortfolioQa = 'VISUAL_REVIEW_REQUIRED' | 'PRELIMINARY_PASS' | 'NEEDS_FIX' | 'PASS' | 'FAIL';
export type PortfolioDecision = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PortfolioItemStatus = 'DRAFT' | 'READY' | 'PUBLISHED' | 'SKIPPED';

/** Publishing package written by Copy/QA/Director into the collection payload (all optional, validated). */
export interface PublishPack {
  format: 'REEL' | 'POSTS'; caption: string; hashtags: string[]; firstComment: string; audio: string; qa: string; publishedUrl: string | null;
}
export interface PortfolioCollection {
  id: string; externalId: string; characterId: string; title: string; channel: string;
  status: string; concept: string | null; createdAt: string; pack: PublishPack;
}
export interface PortfolioAsset { id: string; objectPath: string; mimeType: string; sha256: string; byteSize: number }
export interface PortfolioItem {
  id: string; collectionId: string; position: number; caption: string; altText: string; hashtags: string[];
  crop: string; qaStatus: PortfolioQa; qaNotes: string; decision: PortfolioDecision; status: PortfolioItemStatus;
  publishedUrl: string | null; asset: PortfolioAsset | null; seconds: number | null;
}
export interface PortfolioView { collections: (PortfolioCollection & { items: PortfolioItem[] })[] }

const QA = new Set<PortfolioQa>(['VISUAL_REVIEW_REQUIRED', 'PRELIMINARY_PASS', 'NEEDS_FIX', 'PASS', 'FAIL']);
const DECISIONS = new Set<PortfolioDecision>(['PENDING', 'APPROVED', 'REJECTED']);
const STATUS = new Set<PortfolioItemStatus>(['DRAFT', 'READY', 'PUBLISHED', 'SKIPPED']);
const str = (v: unknown, max = 5000): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Fototeca: dato inválido');
  return v;
};
const optStr = (v: unknown, max = 5000): string | null => (v === null || v === undefined ? null : str(v, max));
const softStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Lenient: a missing or odd package never breaks the Fototeca, it just shows less. */
export function parsePack(payload: unknown): PublishPack {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const copy = (p.copy && typeof p.copy === 'object' ? p.copy : {}) as Record<string, unknown>;
  const final = (p.final && typeof p.final === 'object' ? p.final : {}) as Record<string, unknown>;
  const url = softStr(p.published_url, 300);
  return {
    format: p.format === 'REEL' ? 'REEL' : 'POSTS', caption: softStr(copy.caption, 2200),
    hashtags: (Array.isArray(copy.hashtags) ? copy.hashtags : []).filter((h): h is string => typeof h === 'string' && h.length <= 60).slice(0, 30)
      .map((h) => (h.startsWith('#') ? h : `#${h}`)),
    firstComment: softStr(copy.primer_comentario, 2200), audio: softStr(copy.audio_sugerido, 400),
    qa: [softStr(final.qa_estado, 40), softStr(final.qa_resumen, 600)].filter(Boolean).join(' · '),
    publishedUrl: /^https:\/\/(www\.)?instagram\.com\//.test(url) ? url : null,
  };
}
/** Caption + hashtags of the whole publication (Reel or carousel). */
export const packText = (p: PublishPack): string => (p.hashtags.length ? `${p.caption}\n\n${p.hashtags.join(' ')}` : p.caption);

/** Builds the view only from rows that belong to the given workspace. */
export function buildPortfolio(workspaceId: string, rawCollections: unknown, rawItems: unknown, rawAssets: unknown): PortfolioView {
  if (!Array.isArray(rawCollections) || !Array.isArray(rawItems) || !Array.isArray(rawAssets)) throw new Error('Fototeca: respuesta inválida');
  const assets = new Map<string, PortfolioAsset>();
  for (const a of rawAssets as Record<string, unknown>[]) {
    if (a.workspace_id !== workspaceId) throw new Error('Fototeca: asset ajeno');
    const sha = str(a.sha256, 64);
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Fototeca: hash inválido');
    const path = str(a.object_path, 400);
    if (path.split('/')[0] !== workspaceId) throw new Error('Fototeca: ruta ajena');
    assets.set(str(a.id, 64), { id: str(a.id, 64), objectPath: path, mimeType: str(a.mime_type, 64), sha256: sha, byteSize: Number(a.byte_size) });
  }
  const collections = (rawCollections as Record<string, unknown>[]).map((c) => {
    if (c.workspace_id !== workspaceId) throw new Error('Fototeca: colección ajena');
    return {
      id: str(c.id, 64), externalId: str(c.external_id, 128), characterId: str(c.character_id, 64), title: str(c.title, 160),
      channel: str(c.channel, 32), status: str(c.status, 32), concept: optStr(c.concept, 4000), createdAt: str(c.created_at, 64),
      items: [] as PortfolioItem[], pack: parsePack(c.payload),
    };
  });
  const byId = new Map(collections.map((c) => [c.id, c]));
  for (const i of rawItems as Record<string, unknown>[]) {
    if (i.workspace_id !== workspaceId) throw new Error('Fototeca: publicación ajena');
    const collection = byId.get(str(i.collection_id, 64));
    if (!collection) throw new Error('Fototeca: publicación huérfana');
    const qa = str(i.qa_status, 32) as PortfolioQa; const decision = str(i.human_decision, 16) as PortfolioDecision;
    const status = str(i.status, 16) as PortfolioItemStatus;
    if (!QA.has(qa) || !DECISIONS.has(decision) || !STATUS.has(status)) throw new Error('Fototeca: estado inválido');
    const position = Number(i.position);
    if (!Number.isInteger(position) || position < 1) throw new Error('Fototeca: posición inválida');
    const assetId = optStr(i.asset_id, 64);
    collection.items.push({
      id: str(i.id, 64), collectionId: collection.id, position, caption: optStr(i.caption, 2200) ?? '', altText: optStr(i.alt_text, 1000) ?? '',
      hashtags: Array.isArray(i.hashtags) ? (i.hashtags as unknown[]).map((h) => str(h, 100)) : [],
      crop: str(i.crop, 16), qaStatus: qa, qaNotes: optStr(i.qa_notes, 2000) ?? '', decision, status,
      publishedUrl: optStr(i.published_url, 500), asset: assetId ? assets.get(assetId) ?? null : null,
      seconds: (() => { const n = Number((i.payload as Record<string, unknown> | null)?.seconds); return Number.isFinite(n) && n > 0 && n <= 30 ? n : null; })(),
    });
  }
  for (const c of collections) c.items.sort((a, b) => a.position - b.position);
  collections.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { collections };
}

/** Instagram shows the newest post first: the last position goes top-left. */
export const gridOrder = (items: PortfolioItem[]): PortfolioItem[] => [...items].sort((a, b) => b.position - a.position);

/** Text ready to paste in Instagram: caption plus hashtags on their own line. */
export const postText = (item: PortfolioItem): string =>
  item.hashtags.length ? `${item.caption}\n\n${item.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}` : item.caption;

/** Source rectangle for a centered crop to the target ratio (e.g. 9:16 original → 4:5 feed). */
export function cropRect(width: number, height: number, crop: string, focusY = 0.5): { sx: number; sy: number; sw: number; sh: number } {
  const m = /^(\d+):(\d+)$/.exec(crop);
  if (!m || width < 1 || height < 1) return { sx: 0, sy: 0, sw: width, sh: height };
  const target = Number(m[1]) / Number(m[2]);
  if (width / height > target) { const sw = Math.round(height * target); return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height }; }
  const sh = Math.round(width / target);
  const f = Math.min(1, Math.max(0, Number.isFinite(focusY) ? focusY : 0.5));
  return { sx: 0, sy: Math.round((height - sh) * f), sw: width, sh };
}

/** How a tall photo fits a 4:5 feed slot. 'full' keeps the whole photo over a blurred fill (nothing is cut). */
export type Framing = 'top' | 'center' | 'bottom' | 'full';
export const FRAMING_FOCUS: Record<Exclude<Framing, 'full'>, number> = { top: 0.12, center: 0.5, bottom: 0.88 };
export const FRAMING_LABEL: Record<Framing, string> = { top: 'Arriba', center: 'Centro', bottom: 'Abajo', full: 'Completa' };

export const canApprove =(item: PortfolioItem): boolean =>
  item.status !== 'PUBLISHED' && item.decision !== 'APPROVED' && item.qaStatus !== 'NEEDS_FIX' && item.qaStatus !== 'FAIL' && !!item.asset;

export const QA_LABEL: Record<PortfolioQa, string> = {
  VISUAL_REVIEW_REQUIRED: 'Revisión visual pendiente', PRELIMINARY_PASS: 'QA preliminar OK', NEEDS_FIX: 'Necesita corrección',
  PASS: 'QA verificado', FAIL: 'QA rechazado',
};
export const STATUS_LABEL: Record<PortfolioItemStatus, string> = {
  DRAFT: 'Borrador', READY: 'Lista para publicar', PUBLISHED: 'Publicada', SKIPPED: 'Descartada',
};

export function progress(items: PortfolioItem[]) {
  return {
    total: items.length,
    approved: items.filter((i) => i.decision === 'APPROVED').length,
    published: items.filter((i) => i.status === 'PUBLISHED').length,
    blocked: items.filter((i) => i.qaStatus === 'NEEDS_FIX' || i.qaStatus === 'FAIL').length,
  };
}
