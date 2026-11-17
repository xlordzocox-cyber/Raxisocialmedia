// Talento: pure, validated read model of one model's identity (references + versioned identity text).
import { characterLabel } from '../portfolio/mediaModel';
import { TALENT_ROSTER } from '../agency/agencyModel';

export const ANGLES = ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK', 'BACK', 'FULL_BODY', 'SHEET', 'SOURCE'] as const;
export type Angle = (typeof ANGLES)[number];
/** The six views of the 360 sheet, in display order. Older angles show only if a reference already uses them; SOURCE photos live in the creator. */
export const SHEET_VIEWS = ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BODY_FRONT', 'BODY_SIDE', 'BODY_BACK'] as const satisfies readonly Angle[];
export const gridAngles = (refs: { angle: Angle }[], adult = false): Angle[] => {
  const used = (a: Angle) => refs.some((r) => r.angle === a);
  // The adult sheet only has body views; a face slot appears there only if an adult reference already uses it.
  return [...SHEET_VIEWS.filter((a) => !adult || a.startsWith('BODY_') || used(a)), ...(['BACK', 'FULL_BODY', 'SHEET'] as const).filter(used)];
};
export const ANGLE_LABEL: Record<Angle, string> = { FRONT: 'Cara de frente', THREE_QUARTER: 'Cara a tres cuartos', PROFILE: 'Cara de perfil', BACK: 'Espalda', FULL_BODY: 'Cuerpo completo', SHEET: 'Ficha completa', BODY_FRONT: 'Cuerpo de frente', BODY_SIDE: 'Cuerpo de lado', BODY_BACK: 'Cuerpo de espalda', SOURCE: 'Foto de la modelo' };

export type RefLevel = 'GENERAL' | 'ADULT';
export interface TalentReference { id: string; angle: Angle; level: RefLevel; objectPath: string; sha256: string; createdAt: string }
export interface IdentityVersion { version: number; status: 'DRAFT' | 'LOCKED'; identityText: string; marks: string[]; accessories: string[]; referenceIds: string[]; updatedAt: string; lockedAt: string | null }
export interface TalentProfile { id: string; name: string; references: TalentReference[]; locked: IdentityVersion | null; draft: IdentityVersion | null; history: IdentityVersion[] }

const str = (v: unknown, max: number): string => { if (typeof v !== 'string' || v.length > max) throw new Error('Talento: dato inválido'); return v; };
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);

export function buildTalentProfile(workspaceId: string, characterId: string, rawVersions: unknown, rawRefs: unknown): TalentProfile {
  if (!(TALENT_ROSTER as readonly string[]).includes(characterId)) throw new Error('Talento: modelo desconocida');
  if (!Array.isArray(rawVersions) || !Array.isArray(rawRefs)) throw new Error('Talento: respuesta inválida');
  const references: TalentReference[] = [];
  for (const a of rawRefs as Record<string, unknown>[]) {
    if (a.workspace_id !== workspaceId) throw new Error('Talento: asset ajeno');
    if (a.kind !== 'REFERENCE') continue;
    const meta = (a.metadata && typeof a.metadata === 'object' ? a.metadata : {}) as Record<string, unknown>;
    if (meta.character_id !== characterId) continue;
    const path = str(a.object_path, 400);
    if (path.split('/')[0] !== workspaceId) throw new Error('Talento: ruta ajena');
    const sha = str(a.sha256, 64);
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Talento: hash inválido');
    if (!(ANGLES as readonly string[]).includes(meta.angle as string)) continue;
    if (meta.superseded_by) continue; // replaced by a newer chosen reference for the same view
    const level: RefLevel | null = meta.content_level === 'PUBLIC' ? 'GENERAL' : meta.content_level === 'NSFW' || meta.content_level === 'EXPLICIT' ? 'ADULT' : null;
    if (!level) continue; // unclassified references are never used
    references.push({ id: str(a.id, 64), angle: meta.angle as Angle, level, objectPath: path, sha256: sha, createdAt: str(a.created_at, 64) });
  }
  references.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const history: IdentityVersion[] = [];
  for (const v of rawVersions as Record<string, unknown>[]) {
    if (v.workspace_id !== workspaceId) throw new Error('Talento: versión ajena');
    if (v.character_id !== characterId) continue;
    if (v.status !== 'DRAFT' && v.status !== 'LOCKED') throw new Error('Talento: estado inválido');
    const version = Number(v.version);
    if (!Number.isInteger(version) || version < 1) throw new Error('Talento: versión inválida');
    history.push({
      version, status: v.status, identityText: str(v.identity_text, 4000), marks: strList(v.marks), accessories: strList(v.accessories),
      referenceIds: Array.isArray(v.reference_asset_ids) ? (v.reference_asset_ids as unknown[]).map((x) => str(x, 64)) : [],
      updatedAt: str(v.updated_at, 64), lockedAt: typeof v.locked_at === 'string' ? v.locked_at : null,
    });
  }
  history.sort((x, y) => y.version - x.version);
  return {
    id: characterId, name: characterLabel(characterId), references,
    locked: history.find((h) => h.status === 'LOCKED') ?? null, draft: history.find((h) => h.status === 'DRAFT') ?? null, history,
  };
}

export const canLock = (p: TalentProfile): boolean =>
  !!p.draft && p.draft.identityText.trim().length >= 20 && p.references.some((r) => r.angle === 'FRONT' && r.level === 'GENERAL' && p.draft!.referenceIds.includes(r.id));

export const splitLines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
