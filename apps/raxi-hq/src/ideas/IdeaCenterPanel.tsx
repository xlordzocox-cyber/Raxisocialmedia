import { useState } from 'react';
import type { IdeaRecord } from './ideaContracts';
import { getIdeaById, getIdeasSortedByPriority, summarizeIdeas } from './ideaSelectors';
import { ideaChannelLabel, ideaPriorityLabel, ideaSourceLabel, ideaStatusLabel } from './ideaPresentation';

interface IdeaCenterPanelProps {
  id: string;
  ideas: readonly IdeaRecord[];
  open: boolean;
}

export function IdeaCenterPanel({ id, ideas, open }: IdeaCenterPanelProps) {
  const ordered = getIdeasSortedByPriority(ideas);
  const summary = summarizeIdeas(ideas);
  const [selectedId, setSelectedId] = useState<string | undefined>(ordered[0]?.id);
  const selected = getIdeaById(ordered, selectedId ?? '') ?? ordered[0];
  const metrics = [
    ['Nuevas', summary.proposedCount],
    ['En análisis', summary.underReviewCount],
    ['Aprobadas para HQ', summary.approvedForHqCount],
    ['Enviadas al HQ', summary.sentToHqCount],
    ['Rechazadas', summary.rejectedCount],
    ['Archivadas', summary.archivedCount],
  ] as const;

  return <section id={id} className="idea-panel" role="region" aria-label="Centro de Ideas · MOCK" hidden={!open}>
    <div className="idea-panel-heading">
      <div><span className="campus-eyebrow">OBSERVACIÓN DE PROPUESTAS</span><h3>Centro de Ideas <span className="idea-mode">MOCK · solo lectura</span></h3><p>Propuestas antes de entrar a producción</p></div>
      <div className="idea-count">{summary.totalIdeas} <span>{summary.totalIdeas === 1 ? 'idea' : 'ideas'} en el radar</span></div>
    </div>
    <div className="idea-metrics" aria-label="Resumen de ideas">
      {metrics.map(([label, count]) => <div key={label} className="idea-metric"><strong>{count}</strong><span>{label}</span></div>)}
    </div>
    <div className="idea-panel-body">
      <div className="idea-list" aria-label="Lista de ideas">
        <div className="idea-list-heading"><h4>Propuestas</h4><span>Por prioridad · ID</span></div>
        {ordered.length === 0 ? <p>Sin ideas MOCK disponibles.</p> : ordered.map(idea =>
          <button key={idea.id} type="button" className="idea-card" data-status={idea.status}
            aria-pressed={selected?.id === idea.id} onClick={() => setSelectedId(idea.id)}>
            <span className="idea-card-top"><code>{idea.id}</code><span>{ideaPriorityLabel[idea.priority]}</span></span>
            <strong>{idea.title}</strong>
            <span className="idea-card-state">{ideaStatusLabel[idea.status]}{idea.status === 'APPROVED_FOR_HQ' && <em>LISTA PARA HQ</em>}</span>
            <span className="idea-card-source">{ideaSourceLabel[idea.source]}</span>
            <span className="idea-card-scores">Afinidad {idea.fitScore}% · Confianza {idea.confidenceScore}%</span>
            <span className="idea-card-channels">{idea.suggestedChannels.map(ideaChannel => ideaChannelLabel[ideaChannel]).join(' · ') || 'Sin canales sugeridos'}</span>
          </button>)}
      </div>
      <div className="idea-detail" aria-label="Detalle de idea seleccionada">
        {selected ? <>
          <div className="idea-detail-heading"><code>{selected.id}</code><span className="idea-detail-priority">Prioridad {ideaPriorityLabel[selected.priority]}</span></div>
          <h4>{selected.title}</h4>
          <div className="idea-detail-state"><span>{ideaStatusLabel[selected.status]}</span>{selected.status === 'APPROVED_FOR_HQ' && <strong>LISTA PARA HQ</strong>}</div>
          {selected.status === 'APPROVED_FOR_HQ' && <p className="idea-ready-note">Preparada para revisión del Centro de Operaciones.</p>}
          <p className="idea-detail-summary">{selected.summary}</p>
          <dl className="idea-detail-facts">
            <div><dt>Origen</dt><dd>{ideaSourceLabel[selected.source]}</dd></div>
            <div><dt>Estado</dt><dd>{ideaStatusLabel[selected.status]}</dd></div>
            <div><dt>Prioridad</dt><dd>{ideaPriorityLabel[selected.priority]}</dd></div>
            <div><dt>Motivo</dt><dd>{selected.reason}</dd></div>
          </dl>
          <div className="idea-score-grid">
            <label>Afinidad con Raxi <strong>{selected.fitScore}%</strong><meter min={0} max={100} value={selected.fitScore}>{selected.fitScore}%</meter></label>
            <label>Confianza <strong>{selected.confidenceScore}%</strong><meter min={0} max={100} value={selected.confidenceScore}>{selected.confidenceScore}%</meter></label>
          </div>
          <div className="idea-detail-group"><h5>Canales sugeridos</h5><div className="idea-chips">{selected.suggestedChannels.length ? selected.suggestedChannels.map(channel => <span key={channel}>{ideaChannelLabel[channel]}</span>) : <span>Sin canales sugeridos</span>}</div></div>
          <div className="idea-detail-group"><h5>Tags</h5><div className="idea-chips">{selected.tags.length ? selected.tags.map(tag => <span key={tag}>{tag}</span>) : <span>Sin tags</span>}</div></div>
          <div className="idea-detail-group"><h5>Evidencias</h5>{selected.evidence.length ? <ul className="idea-evidence">{selected.evidence.map(item => <li key={item.id}><span>{item.kind}</span><strong>{item.label}</strong>{item.sourceRef && <code>{item.sourceRef}</code>}{item.capturedAt && <time dateTime={item.capturedAt}>{item.capturedAt}</time>}</li>)}</ul> : <p>Sin evidencias registradas.</p>}</div>
          {(selected.duplicateOfIdeaId || selected.relatedCampaignIds?.length || selected.approvedAt || selected.sentToHqAt) && <dl className="idea-detail-secondary">
            {selected.duplicateOfIdeaId && <div><dt>Duplicada de</dt><dd>{selected.duplicateOfIdeaId}</dd></div>}
            {!!selected.relatedCampaignIds?.length && <div><dt>Campañas relacionadas</dt><dd>{selected.relatedCampaignIds.join(', ')}</dd></div>}
            {selected.approvedAt && <div><dt>Aprobada para HQ</dt><dd>{selected.approvedAt}</dd></div>}
            {selected.sentToHqAt && <div><dt>Enviada al HQ</dt><dd>{selected.sentToHqAt}</dd></div>}
          </dl>}
        </> : <p>Selecciona una idea para inspeccionar sus detalles.</p>}
      </div>
    </div>
    <p className="idea-scope-note">Las ideas aprobadas aquí son propuestas para el HQ. El Centro de Operaciones decide si pasan a producción. Una idea todavía no es una campaña.</p>
  </section>;
}
