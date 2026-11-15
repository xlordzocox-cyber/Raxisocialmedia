import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DataView } from './DataView';
import {
  campaignCost, failedCost, friendlyError, isActive, JOB_LABEL, JOB_STATUS, latest, PIPELINE_STEPS, stepState,
  type AgentJob, type JobKind, type Pipeline,
} from './agentJobs';

const ICON = { done: '✓', current: '●', waiting: '!', failed: '✕', todo: '○' } as const;
const SHOWN: JobKind[] = ['BRIEF', 'RESEARCH', 'STRATEGY', 'DESIGN', 'REVIEW'];

/** "Iniciar campaña": the Director chains the departments; the owner only acts at gates. Calls audited RPCs only. */
export function CampaignSteps({ client, proposalId, jobs, pipeline, onChange }: {
  client: SupabaseClient; proposalId: string; jobs: AgentJob[]; pipeline: Pipeline | undefined; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState('');

  async function call(fn: 'raxi_start_campaign' | 'raxi_campaign_decide', args: Record<string, unknown>, ok: string) {
    setBusy(true); setNotice(undefined);
    const { error } = await client.rpc(fn, args);
    setBusy(false);
    setNotice(error ? friendlyError(error.message) : ok);
    if (!error) { setChanges(false); setNote(''); }
    onChange();
  }

  const spent = campaignCost(jobs, proposalId);
  const wasted = failedCost(jobs, proposalId);
  const review = latest(jobs, proposalId, 'REVIEW');
  const results = SHOWN.map((k) => latest(jobs, proposalId, k)).filter((j): j is AgentJob => !!j);

  if (!pipeline) return <div className="campaign-steps">
    <button type="button" className="campaign-start" disabled={busy} onClick={() => void call('raxi_start_campaign', { p_proposal: proposalId },
      'Campaña iniciada. El Director ya está trabajando; mira la oficina.')}>▶ Iniciar campaña</button>
    <p className="team-proposal-meta">El Director coordina al equipo y solo te detiene para aprobar la estrategia. Tope: $2 por campaña.</p>
    {spent > 0 && <p className="team-proposal-meta">Gastado antes en pruebas manuales: ${spent.toFixed(4)} USD (cuenta para el tope).</p>}
    {notice && <p role="status">{notice}</p>}
  </div>;

  return <div className="campaign-steps">
    <ol className="campaign-route" aria-label="Avance de la campaña">
      {PIPELINE_STEPS.map((s) => { const st = stepState(pipeline, s.key); return <li key={s.key} className={`route-${st}`}>
        <span aria-hidden="true">{ICON[st]}</span> {s.label}{st === 'current' ? ' · trabajando…' : st === 'waiting' ? ' · te toca' : ''}
      </li>; })}
    </ol>
    <p className="team-proposal-meta">Gastado en esta campaña: ${spent.toFixed(4)} USD de $2.00{wasted > 0 ? ` · pasos fallidos: $${wasted.toFixed(4)} (solo cuentan en el tope mensual)` : ''}</p>

    {pipeline.status === 'WAITING_APPROVAL' && pipeline.gate === 'STRATEGY_APPROVAL' && <div className="campaign-gate" role="region" aria-label="Te toca: aprobar estrategia">
      <p><b>TE TOCA · Aprobar la estrategia.</b> El Director la propone abajo. El equipo creativo no empieza hasta que la apruebes.</p>
      {!changes ? <div className="team-proposal-actions">
        <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'APPROVE' },
          'Estrategia aprobada. El Director se la entrega al Creativo.')}>Aprobar estrategia</button>
        <button type="button" disabled={busy} onClick={() => setChanges(true)}>Pedir cambios</button>
      </div> : <div className="campaign-changes-form">
        <label>¿Qué debe cambiar el Director?<textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="team-proposal-actions">
          <button type="button" disabled={busy || !note.trim()} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'CHANGES', p_note: note },
            'Enviado. El Director rehace la estrategia con tus notas.')}>Enviar cambios</button>
          <button type="button" disabled={busy} onClick={() => setChanges(false)}>Cancelar</button>
        </div>
      </div>}
    </div>}

    {(pipeline.status === 'FAILED' || pipeline.status === 'PAUSED') && <div className="campaign-changes" role="alert">
      <p>{pipeline.status === 'FAILED' ? 'Un paso falló' : 'La campaña está en pausa'}: {pipeline.note ?? 'sin detalle.'}</p>
      <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'RESUME' },
        'Reanudado: el equipo vuelve a intentar ese paso.')}>Reintentar este paso</button>
    </div>}

    {pipeline.status === 'READY_FOR_PRODUCTION' && review?.campaign && <p className="campaign-created" role="status">
      {review.campaign.kept ? 'El Director aprobó, pero la campaña ya tenía decisiones tuyas y no se reemplazó.' : `✅ El Director aprobó y creó la campaña con ${review.campaign.items} publicaciones (borrador).`} <Link to="/fototeca">Ver en la Fototeca</Link>
      <br /><span className="team-proposal-meta">Siguiente: generar fotos con tu aprobación del costo (en construcción).</span>
    </p>}
    {notice && <p role="status">{notice}</p>}

    {results.map((j) => <details key={j.id} className="campaign-step-result"
      open={isActive(j) || (j.kind === 'STRATEGY' && pipeline.gate === 'STRATEGY_APPROVAL') || (j.kind === 'REVIEW' && pipeline.status === 'READY_FOR_PRODUCTION')}>
      <summary>{JOB_LABEL[j.kind]} · {JOB_STATUS[j.status]}{j.reused ? ' · reutilizada · $0' : j.status === 'SUCCEEDED' || j.status === 'FAILED' ? ` · $${j.costUsd.toFixed(4)}` : ''}{j.rescued ? ' · rescatada' : ''}
        {j.verdict ? ` · ${j.verdict === 'APROBADA' ? 'Aprobada' : 'Con cambios'}` : ''}{j.decision === 'MAS_INVESTIGACION' ? ' · pidió más investigación' : ''}</summary>
      {isActive(j) && <p role="status">El agente está trabajando. Esto tarda de 1 a 3 minutos.</p>}
      {j.status === 'FAILED' && <p role="alert">{j.error ?? 'Falló sin detalle.'}</p>}
      {j.data ? <div className="campaign-step-text"><DataView value={j.data} /></div> : j.markdown && <pre className="campaign-step-text">{j.markdown}</pre>}
      {!!j.sources.length && <><p><b>Fuentes</b></p><ul className="team-proposal-evidence">{j.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></>}
    </details>)}
  </div>;
}
