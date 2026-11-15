export type JobKind = 'BRIEF' | 'RESEARCH' | 'STRATEGY' | 'DESIGN' | 'REVIEW' | 'PRODUCTION' | 'GENERATE' | 'COPY' | 'QA' | 'FINAL' | 'ARCHIVE';
export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type AgentJob = {
  id: string; proposalId: string; kind: JobKind; status: JobStatus; costUsd: number;
  markdown: string; data: unknown; reused: boolean; rescued: boolean; verdict: 'APROBADA' | 'CAMBIOS' | null; decision: 'SUFICIENTE' | 'MAS_INVESTIGACION' | null; campaign: { externalId: string; items: number; kept: boolean; format: string } | null; sources: { url: string; title: string }[]; error: string | null; createdAt: string;
};

const KINDS = new Set(['BRIEF', 'RESEARCH', 'STRATEGY', 'DESIGN', 'REVIEW', 'PRODUCTION', 'GENERATE', 'COPY', 'QA', 'FINAL', 'ARCHIVE']);
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
    const data = (output.data && typeof output.data === 'object' ? output.data : {}) as Record<string, unknown>;
    const camp = (output.campaign && typeof output.campaign === 'object' ? output.campaign : null) as Record<string, unknown> | null;
    out.push({
      id: r.id, proposalId: r.proposal_id, kind: r.kind as JobKind, status: r.status as JobStatus,
      costUsd: Number(r.cost_usd) || 0, markdown: typeof output.markdown === 'string' ? output.markdown : '',
      data: output.data && typeof output.data === 'object' ? output.data : null,
      reused: typeof output.reused_from === 'string', rescued: output.rescued === true,
      verdict: data.veredicto === 'APROBADA' || data.veredicto === 'CAMBIOS' ? data.veredicto : null,
      decision: data.decision === 'SUFICIENTE' || data.decision === 'MAS_INVESTIGACION' ? data.decision : null,
      campaign: camp && typeof camp.externalId === 'string' ? { externalId: camp.externalId, items: Number(camp.items) || 0, kept: camp.kept === true, format: camp.format === 'REEL' ? 'REEL' : 'POSTS' } : null,
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
  if (jobs.some((j) => j.proposalId === proposalId && isActive(j))) return false;
  if (kind === 'BRIEF') return true;
  const before: JobKind = kind === 'DESIGN' || kind === 'STRATEGY' ? 'RESEARCH' : kind === 'RESEARCH' ? 'BRIEF' : 'DESIGN';
  return jobs.some((j) => j.proposalId === proposalId && j.kind === before && j.status === 'SUCCEEDED');
}

/** Counts toward the campaign cap: everything except failed steps (failed ones still count toward the monthly cap). */
export function campaignCost(jobs: AgentJob[], proposalId: string): number {
  return jobs.filter((j) => j.proposalId === proposalId && j.status !== 'FAILED').reduce((s, j) => s + j.costUsd, 0);
}
export function failedCost(jobs: AgentJob[], proposalId: string): number {
  return jobs.filter((j) => j.proposalId === proposalId && j.status === 'FAILED').reduce((s, j) => s + j.costUsd, 0);
}

const ERRORS: Record<string, string> = {
  'monthly budget reached': 'Se alcanzó el tope mensual de gasto.',
  'campaign budget reached': 'Esta campaña alcanzó su tope de gasto.',
  'research first': 'Primero hay que investigar.',
  'design first': 'Primero hay que diseñar.',
  'nothing to decide': 'Esta campaña ya no espera esa decisión. Recarga.',
  'note required': 'Escribe qué cambios quieres.',
  'invalid instagram url': 'Pega el enlace de la publicación de Instagram (instagram.com/reel/… o /p/…).',
  'this step is already running': 'Este paso ya está en marcha.',
  'campaign not accepted': 'La campaña debe estar aceptada.',
};
export function friendlyError(message: string | undefined): string {
  const hit = Object.keys(ERRORS).find((k) => message?.includes(k));
  return hit ? ERRORS[hit] : 'No se pudo iniciar el paso.';
}

export const JOB_LABEL: Record<JobKind, string> = {
  BRIEF: 'Brief del Director', RESEARCH: 'Investigación', STRATEGY: 'Análisis y estrategia del Director', DESIGN: 'Diseño de campaña', REVIEW: 'Revisión del Director',
  COPY: 'Copy de la publicación', QA: 'Control de calidad (QA)', FINAL: 'Paquete final del Director',
  PRODUCTION: 'Orden de producción (Aria)', GENERATE: 'Generación de fotos en Aria', ARCHIVE: 'Archivista: memoria de la campaña',
};
export const JOB_STATUS: Record<JobStatus, string> = {
  PENDING: 'En cola', RUNNING: 'Trabajando…', SUCCEEDED: 'Listo', FAILED: 'Falló', CANCELED: 'Cancelado',
};

export type PipelineStatus = 'RUNNING' | 'WAITING_APPROVAL' | 'PAUSED' | 'FAILED' | 'READY_FOR_PRODUCTION' | 'APPROVED_TO_PUBLISH' | 'PUBLISHED';
export type PipelineStage = 'BRIEF' | 'RESEARCH' | 'STRATEGY' | 'DESIGN' | 'REVIEW' | 'PRODUCTION' | 'GENERATE' | 'COPY' | 'QA' | 'FINAL' | 'DONE';
export type Gate = 'STRATEGY_APPROVAL' | 'PRODUCTION_COST' | 'PUBLISH_APPROVAL';
export type Pipeline = { proposalId: string; status: PipelineStatus; stage: PipelineStage; gate: Gate | null; note: string | null };
const P_STATUS = new Set(['RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'FAILED', 'READY_FOR_PRODUCTION', 'APPROVED_TO_PUBLISH', 'PUBLISHED']);
const P_STAGE = new Set(['BRIEF', 'RESEARCH', 'STRATEGY', 'DESIGN', 'REVIEW', 'PRODUCTION', 'GENERATE', 'COPY', 'QA', 'FINAL', 'DONE']);

/** Validates rows from raxi_campaign_pipelines (owner-read). Malformed rows are dropped. */
export function parsePipelines(rows: unknown): Pipeline[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Record<string, unknown>[]).flatMap((r) => {
    if (!r || typeof r.proposal_id !== 'string' || !P_STATUS.has(String(r.status)) || !P_STAGE.has(String(r.stage))) return [];
    return [{ proposalId: r.proposal_id, status: r.status as PipelineStatus, stage: r.stage as PipelineStage,
      gate: r.gate === 'STRATEGY_APPROVAL' || r.gate === 'PRODUCTION_COST' || r.gate === 'PUBLISH_APPROVAL' ? r.gate : null, note: typeof r.note === 'string' ? r.note.slice(0, 1000) : null }];
  });
}

/** The visible route of a campaign, following the master flow. */
export const PIPELINE_STEPS: { key: string; label: string }[] = [
  { key: 'BRIEF', label: 'Director: evalúa y delega' },
  { key: 'RESEARCH', label: 'Investigación' },
  { key: 'STRATEGY', label: 'Director: analiza y propone estrategia' },
  { key: 'GATE', label: 'Tú: apruebas la estrategia' },
  { key: 'DESIGN', label: 'Dirección creativa' },
  { key: 'REVIEW', label: 'Director: revisa y crea la campaña (Fototeca)' },
  { key: 'PRODUCTION', label: 'Producción: orden con precios reales de Aria (si hay fotos nuevas)' },
  { key: 'COST_GATE', label: 'Tú: apruebas el costo' },
  { key: 'GENERATE', label: 'Aria genera y se archivan en la Fototeca' },
  { key: 'COPY', label: 'Copy: texto de la publicación' },
  { key: 'QA', label: 'QA: revisa fotos y texto' },
  { key: 'FINAL', label: 'Director: paquete final' },
  { key: 'PUBLISH_GATE', label: 'Tú: autorizas la publicación' },
  { key: 'PUBLISH', label: 'Tú: publicas en Instagram' },
  { key: 'DONE', label: 'Publicada' },
  { key: 'ARCHIVE', label: 'Archivista: guarda la campaña para no repetirla' },
];
const ORDER = PIPELINE_STEPS.map((s) => s.key);

/** Where the campaign is right now on the route above. */
export function currentStep(p: Pipeline): string {
  if (p.status === 'WAITING_APPROVAL') return p.gate === 'PUBLISH_APPROVAL' ? 'PUBLISH_GATE' : p.gate === 'PRODUCTION_COST' ? 'COST_GATE' : 'GATE';
  if (p.status === 'READY_FOR_PRODUCTION') return 'PRODUCTION';
  if (p.status === 'APPROVED_TO_PUBLISH') return 'PUBLISH';
  if (p.status === 'PUBLISHED') return 'ARCHIVE';
  return p.stage;
}

export type StepState = 'done' | 'current' | 'waiting' | 'failed' | 'todo';
export function stepState(pipeline: Pipeline, step: string, archived = false): StepState {
  if (pipeline.status === 'PUBLISHED' && archived) return 'done';
  const i = ORDER.indexOf(step), j = ORDER.indexOf(currentStep(pipeline));
  if (i < j) return 'done';
  if (i > j) return 'todo';
  if (['WAITING_APPROVAL', 'READY_FOR_PRODUCTION', 'APPROVED_TO_PUBLISH'].includes(pipeline.status)) return 'waiting';
  if (pipeline.status === 'FAILED' || pipeline.status === 'PAUSED') return 'failed';
  return 'current';
}
export const needsOwner = (p: Pipeline | undefined): boolean =>
  !!p && ['WAITING_APPROVAL', 'FAILED', 'PAUSED', 'READY_FOR_PRODUCTION', 'APPROVED_TO_PUBLISH'].includes(p.status);
