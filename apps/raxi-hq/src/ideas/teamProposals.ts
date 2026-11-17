// "Propuestas del equipo": ideas created by the Claude-led agents, kept apart from Luis's manual ideas.
// Rows come from an RLS owner-only read; anything malformed or foreign is rejected, never rendered.

export type ProposalStatus = 'PROPOSED' | 'ACCEPTED' | 'DISMISSED' | 'IN_PROGRESS' | 'DONE';
export interface ProposalEvidence { label: string; url?: string; observedAt?: string }
export interface TeamProposal {
  id: string; externalId: string; agentKey: string; characterId: string | null; title: string; summary: string;
  rationale: string | null; channel: string | null; estimatedCostUsd: number | null; evidence: ProposalEvidence[];
  status: ProposalStatus; ownerNote: string | null; createdAt: string;
}

const STATUSES = new Set<ProposalStatus>(['PROPOSED', 'ACCEPTED', 'DISMISSED', 'IN_PROGRESS', 'DONE']);
const AGENTS: Record<string, string> = {
  director: 'Director IA', researcher: 'Investigador', creative: 'Director Creativo', production: 'Producción Aria',
  qa: 'QA Visual', copy: 'Copy y Publicación', archivist: 'Archivista',
};
export const agentLabel = (key: string): string => AGENTS[key] ?? 'Equipo';
export const STATUS_LABEL: Record<ProposalStatus, string> = {
  PROPOSED: 'Nueva propuesta', ACCEPTED: 'Te interesa · el equipo la prepara', DISMISSED: 'Descartada',
  IN_PROGRESS: 'En producción', DONE: 'Terminada',
};

const str = (v: unknown, max: number): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Propuestas: dato inválido');
  return v;
};
const opt = (v: unknown, max: number): string | null => (v === null || v === undefined ? null : str(v, max));
const safeUrl = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  try { const u = new URL(v); return u.protocol === 'https:' ? u.toString() : undefined; } catch { return undefined; }
};

export function parseProposals(workspaceId: string, raw: unknown): TeamProposal[] {
  if (!Array.isArray(raw) || raw.length > 200) throw new Error('Propuestas: respuesta inválida');
  return (raw as Record<string, unknown>[]).map((p) => {
    if (p.workspace_id !== workspaceId) throw new Error('Propuestas: registro ajeno');
    const status = str(p.status, 16) as ProposalStatus;
    if (!STATUSES.has(status)) throw new Error('Propuestas: estado inválido');
    const cost = p.estimated_cost_usd === null || p.estimated_cost_usd === undefined ? null : Number(p.estimated_cost_usd);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('Propuestas: costo inválido');
    const evidence = Array.isArray(p.evidence) ? (p.evidence as Record<string, unknown>[]).slice(0, 10).map((e) => ({
      label: str(e?.label, 300), url: safeUrl(e?.url), observedAt: opt(e?.observedAt, 40) ?? undefined,
    })) : [];
    return {
      id: str(p.id, 64), externalId: str(p.external_id, 80), agentKey: str(p.agent_key, 32), characterId: opt(p.character_id, 64),
      title: str(p.title, 120), summary: str(p.summary, 1000), rationale: opt(p.rationale, 2000), channel: opt(p.channel, 32),
      estimatedCostUsd: cost, evidence, status, ownerNote: opt(p.owner_note, 500), createdAt: str(p.created_at, 64),
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** New proposals first; dismissed ones are hidden unless the owner asks to see them. */
export function visibleProposals(all: TeamProposal[], showDismissed: boolean): TeamProposal[] {
  const rank: Record<ProposalStatus, number> = { PROPOSED: 0, ACCEPTED: 1, IN_PROGRESS: 2, DONE: 3, DISMISSED: 4 };
  return all.filter((p) => showDismissed || p.status !== 'DISMISSED').sort((a, b) => rank[a.status] - rank[b.status]);
}

export const canDecide = (p: TeamProposal): boolean => p.status === 'PROPOSED';
export const canUndo = (p: TeamProposal): boolean => p.status === 'ACCEPTED' || p.status === 'DISMISSED';
