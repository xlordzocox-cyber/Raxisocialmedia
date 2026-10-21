import { useRef, useState, useSyncExternalStore } from 'react';
import { OperationsBuilding } from '../campus/CampusOverview';
import { CampaignWorkspace } from '../campaigns/CampaignWorkspace';
import { OperationsInbox } from '../operations/OperationsInbox';
import type { CampaignCommand } from '../campaigns/campaignSession';
import type { RealIdeaStore } from './realIdeaStore';
import type { RealCampaignStore } from './realCampaignStore';

export function RealCampaignCenter({ store, ideas }: { store: RealCampaignStore; ideas: RealIdeaStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [open, setOpen] = useState(true), [selected, select] = useState<string>();
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const snapshot = state.snapshot;
  const action = async (command: CampaignCommand) => {
    if (ideas.hasPendingWrite()) return false;
    const saved = await store.execute(command);
    if (saved) { if (command.type === 'CREATE_CAMPAIGN') select(store.getSnapshot().snapshot?.session.campaigns.at(-1)?.id); await ideas.load(); }
    return saved;
  };
  return <section className="real-campaign-center" aria-label="Campañas REAL">
    <button type="button" className="campus-building campus-building--operations" aria-expanded={open} onClick={() => setOpen(v => !v)}><span className="campus-art"><OperationsBuilding /></span><span className="campus-building-copy"><span className="campus-building-kicker">CENTRO DE OPERACIONES · REAL</span><strong>Campañas y Strategy</strong><span>{snapshot ? `${snapshot.session.campaigns.length} campañas persistidas` : 'Sin lectura confirmada'}</span><span className="campus-building-footer">{open ? 'Cerrar workspace' : 'Abrir workspace'}</span></span></button>
    {state.phase === 'unavailable' && <p role="status">La persistencia de campañas está preparada para revisión y pendiente de despliegue autorizado. Sus acciones permanecen deshabilitadas.</p>}
    {state.phase === 'loading' && <p role="status">Consultando campañas y revisiones…</p>}
    {state.phase === 'saving' && <p role="status">Esperando confirmación de PostgreSQL…</p>}
    {state.error && state.phase !== 'unavailable' && <p role="alert">{state.error}</p>}
    {state.confirmedId && <p role="status">Operación confirmada por PostgreSQL · auditoría vinculada a esta versión.</p>}
    {state.pending && <button disabled={state.phase === 'saving' || state.phase === 'loading'} onClick={() => { void store.retry(); }}>Reintentar operación pendiente</button>}
    {store.canReconsider() && <button onClick={() => store.reconsider()}>Revisar decisión sobre la versión actual</button>}
    {snapshot && <fieldset className="real-campaign-fields" disabled={['loading','saving','unavailable'].includes(state.phase) || !!state.pending || ideas.hasPendingWrite()}>
      <OperationsInbox real id="real-operations-inbox" handoffs={snapshot.handoffs} open={open} campaigns={snapshot.session} onAction={action} onOpenCampaign={select} />
      <CampaignWorkspace persistent id="real-campaign-workspace" session={snapshot.session} getSession={() => store.getSnapshot().snapshot!.session} open={open} selectedId={selected} getSelectedId={() => selectedRef.current} onSelect={select} onAction={action} />
    </fieldset>}
    <button disabled={state.phase === 'saving'} onClick={() => { void store.load(); }}>Recargar campañas desde Supabase</button>
  </section>;
}
