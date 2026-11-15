import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { campaignCost, canRun, friendlyError, isActive, JOB_LABEL, JOB_STATUS, latest, type AgentJob, type JobKind } from './agentJobs';

/** Step buttons for an accepted campaign. Only calls the owner/budget-checked RPC; never spends on images. */
export function CampaignSteps({ client, proposalId, jobs, onChange }: { client: SupabaseClient; proposalId: string; jobs: AgentJob[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  async function run(kind: JobKind) {
    setBusy(true); setNotice(undefined);
    const { error } = await client.rpc('raxi_request_agent_job', { p_proposal: proposalId, p_kind: kind });
    setBusy(false);
    setNotice(error ? friendlyError(error.message) : `${JOB_LABEL[kind]} en marcha. Mira la oficina: el agente ya está trabajando.`);
    onChange();
  }
  const research = latest(jobs, proposalId, 'RESEARCH');
  const design = latest(jobs, proposalId, 'DESIGN');
  const spent = campaignCost(jobs, proposalId);
  return <div className="campaign-steps">
    <div className="team-proposal-actions" role="group" aria-label="Pasos de la campaña">
      <button type="button" disabled={busy || !canRun(jobs, proposalId, 'RESEARCH')} onClick={() => void run('RESEARCH')}>
        {research?.status === 'SUCCEEDED' ? '1 · Investigar de nuevo' : '1 · Investigar'}
      </button>
      <button type="button" disabled={busy || !canRun(jobs, proposalId, 'DESIGN')} onClick={() => void run('DESIGN')}>
        {design?.status === 'SUCCEEDED' ? '2 · Diseñar de nuevo' : '2 · Diseñar'}
      </button>
      <button type="button" disabled title="Próximamente: requiere tu aprobación del costo">3 · Generar fotos</button>
    </div>
    <p className="team-proposal-meta">Gastado en esta campaña: ${spent.toFixed(4)} USD</p>
    {notice && <p role="status">{notice}</p>}
    {[research, design].filter((j): j is AgentJob => !!j).map((j) => <details key={j.id} className="campaign-step-result" open={isActive(j) || j.kind === 'DESIGN'}>
      <summary>{JOB_LABEL[j.kind]} · {JOB_STATUS[j.status]}{j.status === 'SUCCEEDED' ? ` · $${j.costUsd.toFixed(4)}` : ''}</summary>
      {isActive(j) && <p role="status">El agente está trabajando. Esto tarda de 1 a 3 minutos.</p>}
      {j.status === 'FAILED' && <p role="alert">{j.error ?? 'Falló sin detalle.'}</p>}
      {j.markdown && <pre className="campaign-step-text">{j.markdown}</pre>}
      {!!j.sources.length && <><p><b>Fuentes</b></p><ul className="team-proposal-evidence">{j.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></>}
    </details>)}
  </div>;
}
