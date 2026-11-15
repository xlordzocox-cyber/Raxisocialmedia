export type JobKind = 'RESEARCH' | 'DESIGN';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type AgentJob = {
  id: string; proposalId: string; kind: JobKind; status: JobStatus; costUsd: number;
  markdown: string; sources: { url: string; title: string }[]; error: string | null; createdAt: string;
};

const KINDS = new Set(['RESEARCH', 'DESIGN']);
const STATUSES = new Set(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']);

/** Validates rows from raxi_agent_jobs. Unknown kinds/statuses and non-https sources are dropped. */
export function parseJobs(rows: unknown): AgentJob[] {
  if (!Array.isArray(rows)) return [];
  const out: AgentJob[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.proposal_id !== 'string') continue;
    if (!KINDS.has(String(r.kind)) || !STATUSES.has(String(r.status))) continue;
    const output = (r.output && typeof r.output === 'object' ? r.output : {}) as Record<string, unknown>;
    const sources = Array.isArray(output.sources) ? (output.sources as Record<string, unknown>[])
      .filter((s) => s && typeof s.url === 'string' && /^https:\/\//.test(s.url))
      .slice(0, 30).map((s) => ({ url: String(s.url), title: typeof s.title === 'string' && s.title ? s.title : String(s.url) })) : [];
    out.push({
      id: r.id, proposalId: r.proposal_id, kind: r.kind as JobKind, status: r.status as JobStatus,
      costUsd: Number(r.cost_usd) || 0, markdown: typeof output.markdown === 'string' ? output.markdown : '',
      sources, error: typeof r.error === 'string' ? r.error : null, createdAt: String(r.created_at ?? ''),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Latest job of a kind for one campaign. */
export function latest(jobs: AgentJob[], proposalId: string, kind: JobKind): AgentJob | undefined {
  return jobs.find((j) => j.proposalId === proposalId && j.kind === kind);
}

export function isActive(job: AgentJob | undefined): boolean {
  return !!job && (job.status === 'PENDING' || job.status === 'RUNNING');
}

/** Steps follow the order Investigar → Diseñar. */
export function canRun(jobs: AgentJob[], proposalId: string, kind: JobKind): boolean {
  if (isActive(latest(jobs, proposalId, 'RESEARCH')) || isActive(latest(jobs, proposalId, 'DESIGN'))) return false;
  if (kind === 'RESEARCH') return true;
  return latest(jobs, proposalId, 'RESEARCH')?.status === 'SUCCEEDED';
}

export function campaignCost(jobs: AgentJob[], proposalId: string): number {
  return jobs.filter((j) => j.proposalId === proposalId).reduce((s, j) => s + j.costUsd, 0);
}

const ERRORS: Record<string, string> = {
  'monthly budget reached': 'Se alcanzó el tope mensual de gasto.',
  'campaign budget reached': 'Esta campaña alcanzó su tope de gasto.',
  'research first': 'Primero hay que investigar.',
  'this step is already running': 'Este paso ya está en marcha.',
  'campaign not accepted': 'La campaña debe estar aceptada.',
};
export function friendlyError(message: string | undefined): string {
  const hit = Object.keys(ERRORS).find((k) => message?.includes(k));
  return hit ? ERRORS[hit] : 'No se pudo iniciar el paso.';
}

export const JOB_LABEL: Record<JobKind, string> = { RESEARCH: 'Investigación', DESIGN: 'Diseño de campaña' };
export const JOB_STATUS: Record<JobStatus, string> = {
  PENDING: 'En cola', RUNNING: 'Trabajando…', SUCCEEDED: 'Listo', FAILED: 'Falló', CANCELED: 'Cancelado',
};
