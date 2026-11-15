import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { campaignCost, currentStep, isActive, needsOwner, parseJobs, parsePipelines, PIPELINE_STEPS, type AgentJob, type Pipeline } from './agentJobs';
import { parseProposals, type TeamProposal } from './teamProposals';

const STATUS: Record<Pipeline['status'], string> = {
  RUNNING: 'Trabajando', WAITING_APPROVAL: 'Te toca', PAUSED: 'En pausa', FAILED: 'Falló un paso',
  READY_FOR_PRODUCTION: 'Lista para producir', APPROVED_TO_PUBLISH: 'Te toca publicar', PUBLISHED: 'Publicada',
};

/** Read-only overview of every campaign of the agency: where it is, what it cost, and whether it needs the owner. */
export function CampaignBoard({ client, workspace, onOpen }: { client: SupabaseClient; workspace: string; onOpen?: () => void }) {
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; proposals: TeamProposal[]; pipelines: Pipeline[]; jobs: AgentJob[] }>({ phase: 'loading' });
  const load = useCallback(async () => {
    try {
      const [p, pl, j] = await Promise.all([
        client.from('raxi_team_proposals').select('*').eq('workspace_id', workspace),
        client.from('raxi_campaign_pipelines').select('proposal_id, status, stage, gate, note').eq('workspace_id', workspace),
        client.from('raxi_agent_jobs').select('id, proposal_id, kind, status, output, cost_usd, error, created_at').eq('workspace_id', workspace).order('created_at', { ascending: false }).limit(200),
      ]);
      if (p.error || pl.error) { setState({ phase: 'error' }); return; }
      setState({ phase: 'ready', proposals: parseProposals(workspace, p.data), pipelines: parsePipelines(pl.data), jobs: j.error ? [] : parseJobs(j.data) });
    } catch { setState({ phase: 'error' }); }
  }, [client, workspace]);
  useEffect(() => { void load(); }, [load]);
  const running = state.phase === 'ready' && (state.pipelines.some((p) => p.status === 'RUNNING') || state.jobs.some(isActive));
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 8000);
    return () => clearInterval(t);
  }, [running, load]);

  if (state.phase === 'loading') return <p role="status">Cargando campañas…</p>;
  if (state.phase === 'error') return <p role="alert">No se pudieron leer las campañas.</p>;
  const rows = state.pipelines.map((pl) => ({ pl, prop: state.proposals.find((p) => p.id === pl.proposalId) }))
    .filter((r) => r.prop)
    .sort((a, b) => Number(needsOwner(b.pl)) - Number(needsOwner(a.pl)));
  const month = state.jobs.reduce((s, j) => s + j.costUsd, 0);
  return <section className="campaign-board" aria-label="Campañas de la agencia">
    <p className="team-proposal-meta">{rows.length} campañas · gasto registrado de agentes: ${month.toFixed(2)} USD (tope mensual $20)</p>
    {!rows.length && <p>Aún no hay campañas en marcha. Ve a <b>Ideas</b> y pulsa <b>Iniciar campaña</b> en una propuesta aceptada.</p>}
    {rows.map(({ pl, prop }) => {
      const step = PIPELINE_STEPS.find((s) => s.key === currentStep(pl))?.label ?? pl.stage;
      return <article key={pl.proposalId} className={`campaign-card ${needsOwner(pl) ? 'needs-owner' : ''}`}>
        <header><h4>{prop!.title}</h4><span className="campaign-chip">{STATUS[pl.status]}</span></header>
        <p className="team-proposal-meta">{[prop!.characterId, prop!.channel].filter(Boolean).join(' · ')}</p>
        <p><b>Paso actual:</b> {step}</p>
        {pl.note && <p className="team-proposal-meta">{pl.note}</p>}
        <p className="team-proposal-meta">Gastado: ${campaignCost(state.jobs, pl.proposalId).toFixed(4)} de $2.00</p>
        <div className="team-proposal-actions">
          {onOpen && <button type="button" onClick={onOpen}>{needsOwner(pl) ? 'Ir a decidir' : 'Ver detalle'}</button>}
          <Link className="hq-nav-link" to="/fototeca">Fototeca</Link>
        </div>
      </article>;
    })}
  </section>;
}
