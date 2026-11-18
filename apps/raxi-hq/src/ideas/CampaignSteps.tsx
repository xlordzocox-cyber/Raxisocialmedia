import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DataView } from './DataView';
import {
  campaignCost, failedCost, friendlyError, isActive, JOB_LABEL, JOB_STATUS, latest, PIPELINE_STEPS, stepState,
  type AgentJob, type JobKind, type Pipeline,
} from './agentJobs';

const ICON = { done: '✓', current: '●', waiting: '!', failed: '✕', todo: '○' } as const;
const SHOWN: JobKind[] = ['BRIEF', 'RESEARCH', 'STRATEGY', 'DESIGN', 'REVIEW', 'PRODUCTION', 'GENERATE', 'COPY', 'QA', 'FINAL', 'ARCHIVE'];

/** "Iniciar campaña": the Director chains the departments; the owner only acts at gates. Calls audited RPCs only. */
export function CampaignSteps({ client, proposalId, jobs, pipeline, onChange }: {
  client: SupabaseClient; proposalId: string; jobs: AgentJob[]; pipeline: Pipeline | undefined; onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [changes, setChanges] = useState(false);
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');

  async function call(fn: 'raxi_start_campaign' | 'raxi_campaign_decide' | 'raxi_campaign_mark_published', args: Record<string, unknown>, ok: string) {
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
  const order = latest(jobs, proposalId, 'PRODUCTION');
  const plan = (order?.status === 'SUCCEEDED' && order.data && typeof order.data === 'object' ? order.data : null) as
    { modelo_key?: string; modelo_nombre?: string; precio_unitario_usd?: number; calidad?: string; formato?: string; total_usd?: number; fotos?: unknown[]; nota?: string;
      aria_total_usd?: number; continuidad?: { fotos?: number; precio_por_foto_usd?: number; total_usd?: number; nota?: string } | null } | null;
  const archive = latest(jobs, proposalId, 'ARCHIVE');
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
      {PIPELINE_STEPS.map((s) => { const st = stepState(pipeline, s.key, archive?.status === 'SUCCEEDED'); return <li key={s.key} className={`route-${st}`}>
        <span aria-hidden="true">{ICON[st]}</span> {s.label}{st === 'current' ? ' · trabajando…' : st === 'waiting' ? ' · te toca' : ''}
      </li>; })}
    </ol>
    <p className="team-proposal-meta">Gastado en esta campaña: ${spent.toFixed(4)} USD de $2.00{wasted > 0 ? ` · pasos fallidos: $${wasted.toFixed(4)} (solo cuentan en el tope mensual)` : ''}</p>

    {pipeline.status === 'WAITING_APPROVAL' && pipeline.gate && <div className="campaign-gate" role="region" aria-label="Te toca">
      {pipeline.gate === 'STRATEGY_APPROVAL'
        ? <p><b>TE TOCA · Aprobar la estrategia.</b> El Director la propone abajo. El equipo creativo no empieza hasta que la apruebes.</p>
        : pipeline.gate === 'PRODUCTION_COST'
        ? <div><p><b>TE TOCA · Aprobar el costo de producción.</b> Precios reales consultados en Aria. Nada se genera ni se cobra sin tu aprobación, y nunca se gasta más de este total.</p>
            {plan ? <ul className="production-plan">
              <li><b>Fotos nuevas en Aria:</b> {plan.fotos?.length ?? 0}</li>
              <li><b>Modelo:</b> {plan.modelo_nombre} ({plan.modelo_key}) · {plan.calidad} · formato {plan.formato}</li>
              <li><b>Precio por foto:</b> ${Number(plan.precio_unitario_usd).toFixed(4)}</li>
              {plan.continuidad && <li><b>Continuidad en Raxi HQ:</b> {plan.continuidad.total_usd
                ? `${plan.continuidad.fotos} fotos del mismo momento · $${Number(plan.continuidad.precio_por_foto_usd).toFixed(3)} c/u · $${Number(plan.continuidad.total_usd).toFixed(3)} (WaveSpeed, Seedream 5.5)`
                : `${plan.continuidad.fotos} fotos no incluidas`}{plan.continuidad.nota ? <span className="team-proposal-meta"> — {plan.continuidad.nota}</span> : null}</li>}
              <li><b>Total máximo:</b> ${Number(plan.total_usd).toFixed(plan.continuidad?.total_usd ? 3 : 2)} USD</li>
              {plan.nota && <li className="team-proposal-meta">{plan.nota}</li>}
            </ul> : <p role="status">Cargando la orden…</p>}</div>
        : <p><b>TE TOCA · Autorizar la publicación.</b> Revisa el paquete final y el reporte de QA abajo, y las fotos en la <Link to="/fototeca">Fototeca</Link>. Nada se publica sin ti.</p>}
      {!changes ? <div className="team-proposal-actions">
        <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'APPROVE' },
          pipeline.gate === 'STRATEGY_APPROVAL' ? 'Estrategia aprobada. El Director se la entrega al Creativo.'
            : pipeline.gate === 'PRODUCTION_COST' ? 'Costo aprobado. Producción está generando en Aria; las fotos aparecerán solas en la Fototeca.'
            : 'Publicación autorizada. Descarga el carrusel en la Fototeca y publícalo en Instagram.')}>
          {pipeline.gate === 'STRATEGY_APPROVAL' ? 'Aprobar estrategia' : pipeline.gate === 'PRODUCTION_COST' ? `Aprobar y generar ($${Number(plan?.total_usd ?? 0).toFixed(2)})` : 'Autorizar publicación'}</button>
        <button type="button" disabled={busy} onClick={() => setChanges(true)}>Pedir cambios</button>
      </div> : <div className="campaign-changes-form">
        <label>{pipeline.gate === 'STRATEGY_APPROVAL' ? '¿Qué debe cambiar el Director?' : pipeline.gate === 'PRODUCTION_COST' ? '¿Qué cambio en la orden? (ej. "usa seedflash", "más barato")' : '¿Qué debe cambiar Copy en el texto?'}<textarea value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="team-proposal-actions">
          <button type="button" disabled={busy || !note.trim()} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'CHANGES', p_note: note },
            pipeline.gate === 'STRATEGY_APPROVAL' ? 'Enviado. El Director rehace la estrategia con tus notas.' : pipeline.gate === 'PRODUCTION_COST' ? 'Enviado. Producción rehace la orden.' : 'Enviado. Copy rehace el texto y QA lo vuelve a revisar.')}>Enviar cambios</button>
          <button type="button" disabled={busy} onClick={() => setChanges(false)}>Cancelar</button>
        </div>
      </div>}
    </div>}

    {(pipeline.status === 'FAILED' || pipeline.status === 'PAUSED') && <div className="campaign-changes" role="alert">
      {pipeline.stage === 'QA' && <p>Si QA marcó fotos con problemas, ábrelas en la <Link to="/fototeca">Fototeca</Link> y usa <b>🔁 Rehacer esta foto</b>; Producción te mostrará el costo antes de generar.</p>}
      <p>{pipeline.status === 'FAILED' ? 'Un paso falló' : 'La campaña está en pausa'}: {pipeline.note ?? 'sin detalle.'}</p>
      <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'RESUME' },
        'Reanudado: el equipo vuelve a intentar ese paso.')}>Reintentar este paso</button>
    </div>}

    {pipeline.status === 'READY_FOR_PRODUCTION' && <div className="campaign-created" role="status">
      <p>{review?.campaign?.kept ? 'El Director aprobó, pero la campaña ya tenía decisiones tuyas y no se reemplazó.' : `✅ El Director aprobó y creó la campaña${review?.campaign ? ` con ${review.campaign.items} publicaciones` : ''} (borrador).`} <Link to="/fototeca">Ver en la Fototeca</Link></p>
      {review?.campaign?.format === 'REEL'
        ? <><p className="team-proposal-meta">Este Reel usa fotos que ya existen: no hace falta producir. Sigue Copy y QA.</p>
          <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'CONTINUE' },
            'En marcha: el Director le entrega la campaña a Copy.')}>Continuar: Copy y QA</button></>
        : <><p className="team-proposal-meta">Esta campaña necesita fotos nuevas: Producción prepara la orden en Aria y te muestra el costo antes de generar.</p>
          <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'CONTINUE' },
            'En marcha: el Director le entrega la orden a Producción (Aria Link).')}>Continuar: Producción en Aria</button></>}
    </div>}

    {pipeline.status === 'APPROVED_TO_PUBLISH' && <div className="campaign-gate" role="region" aria-label="Te toca: publicar">
      <p><b>TE TOCA · Publicar en Instagram.</b></p>
      <ol className="publish-steps">
        <li>Abre la <Link to="/fototeca">Fototeca</Link>, entra a esta campaña y pulsa <b>Armar video del Reel</b> (o descarga las fotos si es carrusel).</li>
        <li>En Instagram, sube el video, agrega un audio en tendencia (sugerencia en el paquete final) y pega el texto con <b>Copiar texto</b>.</li>
        <li>Publica, copia el enlace de la publicación y pégalo aquí.</li>
      </ol>
      <label>Enlace de la publicación<input type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" value={url} maxLength={300} onChange={(e) => setUrl(e.target.value)} /></label>
      <button type="button" disabled={busy || !url.trim()} onClick={() => void call('raxi_campaign_mark_published', { p_proposal: proposalId, p_url: url.trim() },
        '🎉 Registrada como publicada. Queda en la Fototeca con su enlace.')}>Marcar como publicada</button>
    </div>}
    {pipeline.status === 'PUBLISHED' && <div className="campaign-created" role="status">
      <p>🎉 Campaña publicada. <Link to="/fototeca">Ver en la Fototeca</Link></p>
      {archive?.status === 'SUCCEEDED' ? <p className="team-proposal-meta">📚 El Archivista guardó la campaña; el equipo no la repetirá.</p>
        : archive && isActive(archive) ? <p className="team-proposal-meta">📚 El Archivista está guardando la campaña…</p>
        : <button type="button" disabled={busy} onClick={() => void call('raxi_campaign_decide', { p_proposal: proposalId, p_decision: 'ARCHIVE' },
          'El Archivista está guardando la campaña.')}>Archivar campaña ahora</button>}
    </div>}
    {notice && <p role="status">{notice}</p>}

    {results.map((j) => <details key={j.id} className="campaign-step-result"
      open={isActive(j) || (j.kind === 'STRATEGY' && pipeline.gate === 'STRATEGY_APPROVAL') || (j.kind === 'FINAL' && pipeline.gate === 'PUBLISH_APPROVAL') || (j.kind === 'QA' && pipeline.stage === 'QA' && pipeline.status === 'PAUSED')}>
      <summary>{JOB_LABEL[j.kind]} · {JOB_STATUS[j.status]}{j.reused ? ' · reutilizada · $0' : j.status === 'SUCCEEDED' || j.status === 'FAILED' ? ` · $${j.costUsd.toFixed(4)}` : ''}{j.rescued ? ' · rescatada' : ''}
        {j.verdict ? ` · ${j.verdict === 'APROBADA' ? 'Aprobada' : 'Con cambios'}` : ''}{j.decision === 'MAS_INVESTIGACION' ? ' · pidió más investigación' : ''}</summary>
      {isActive(j) && <p role="status">El agente está trabajando. Esto tarda de 1 a 3 minutos.</p>}
      {j.status === 'FAILED' && <p role="alert">{j.error ?? 'Falló sin detalle.'}</p>}
      {j.data ? <div className="campaign-step-text"><DataView value={j.data} /></div> : j.markdown && <pre className="campaign-step-text">{j.markdown}</pre>}
      {!!j.sources.length && <><p><b>Fuentes</b></p><ul className="team-proposal-evidence">{j.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></>}
    </details>)}
  </div>;
}
