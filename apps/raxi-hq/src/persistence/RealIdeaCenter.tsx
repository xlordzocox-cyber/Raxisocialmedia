import { useEffect, useState, useSyncExternalStore } from 'react';
import { IdeaCenterPanel } from '../ideas/IdeaCenterPanel';
import { IdeasBuilding } from '../campus/CampusOverview';
import type { RealIdeaStore } from './realIdeaStore';
import type { RealCampaignStore } from './realCampaignStore';
import { RealCampaignCenter } from './RealCampaignCenter';
const noSubscription = () => () => {};
const noCampaign = () => null;

export function RealIdeaCenter({ store, campaigns }: { store: RealIdeaStore; campaigns?: (workspace: string) => RealCampaignStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const selectionKey = state.workspace ? `raxi-hq:idea-selection:${state.workspace.ownerId}:${state.workspace.id}` : undefined;
  const campaignStore = state.workspace && campaigns ? campaigns(state.workspace.id) : null;
  const campaignState = useSyncExternalStore(campaignStore?.subscribe ?? noSubscription, campaignStore?.getSnapshot ?? noCampaign, campaignStore?.getSnapshot ?? noCampaign);
  useEffect(() => { void campaignStore?.resume(); }, [campaignStore, state.savedId]);
  // This is a visual subscription only; AuthStore owns session invalidation.
  useEffect(() => { void store.resume(); }, [store]);
  useEffect(() => {
    if (!selectionKey || state.phase === 'loading' || state.phase === 'saving') return;
    let remembered: string | null = null;
    try { remembered = window.sessionStorage.getItem(selectionKey); } catch { /* Storage can be unavailable; selection still works in memory. */ }
    setSelectedId(current => {
      const preferred = state.savedId ?? current ?? remembered;
      return state.ideas.some(item => item.idea.id === preferred) ? preferred! : state.ideas[0]?.idea.id;
    });
  }, [selectionKey, state.phase, state.savedId, state.ideas]);
  const select = (id: string) => {
    if (!state.ideas.some(item => item.idea.id === id)) return;
    setSelectedId(id);
    try { if (selectionKey) window.sessionStorage.setItem(selectionKey, id); } catch { /* Optional preference only. */ }
  };
  useEffect(() => { if (selectedId && selectionKey) { try { window.sessionStorage.setItem(selectionKey, selectedId); } catch { /* Optional preference only. */ } } }, [selectedId, selectionKey]);
  return <section className="campus real-idea-center" aria-label="Raxi HQ Campus REAL">
    <div className="campus-heading"><div><span className="campus-eyebrow">RAXI HQ CAMPUS · REAL</span><h2>Un lugar para operar y pensar lo que sigue.</h2></div><span className="campus-phase">Supabase · {state.phase === 'ready' ? 'Conectado' : state.phase === 'error' ? 'Error de conexión o guardado' : state.phase === 'saving' ? 'Guardando…' : state.phase === 'needsWorkspace' ? 'Sin workspace' : 'Cargando…'}</span></div>
    {state.error && !state.workspace && <p role="alert">{state.error} No se ha confirmado ningún guardado nuevo.</p>}
    {state.refreshWarning && <p role="alert">{state.refreshWarning}</p>}
    {state.phase === 'loading' && <p role="status">Consultando el workspace y sus ideas persistidas…</p>}
    {store.hasPendingWrite() && <p role="status">Hay un guardado pendiente de confirmar. La operación conserva su ID y clave de reintento al navegar entre REAL y DEMO.</p>}
    {store.hasPendingWrite() && <button type="button" disabled={state.phase === 'saving' || state.phase === 'loading'} onClick={() => { void store.retryPending(); }}>Reintentar guardado pendiente</button>}
    {state.phase === 'needsWorkspace' && <div><p>No tienes un workspace raxi-hq. Puedes crearlo para empezar a guardar tus ideas.</p><button type="button" onClick={() => { void store.createWorkspace(); }}>Crear mi workspace raxi-hq</button></div>}
    {state.phase === 'error' && !state.workspace && <button type="button" onClick={() => { void store.load(); }}>Reintentar conexión</button>}
    {state.workspace && <>
      <div className="campus-buildings real-campus-buildings"><button type="button" className="campus-building campus-building--ideas" aria-expanded={open} aria-controls="real-idea-center-panel" disabled={state.phase === 'saving'} onClick={() => setOpen(value => !value)}><span className="campus-art"><IdeasBuilding /></span><span className="campus-building-copy"><span className="campus-building-kicker">CENTRO DE IDEAS · REAL</span><strong>Centro de<br />Ideas</strong><span className="campus-building-description">Tus propuestas, guardadas para lo que sigue</span><span className="campus-telemetry"><span><b>{state.ideas.length}</b> {state.ideas.length === 1 ? 'idea persistida' : 'ideas persistidas'}</span><span>Workspace {state.workspace.name}</span></span><span className="campus-building-footer">{open ? 'Cerrar panel' : 'Explorar ideas'} <span aria-hidden="true">{open ? '↑' : '↗'}</span></span></span></button><div className="real-campus-note"><span className="campus-eyebrow">PERSISTENCIA VERIFICABLE</span><h3>Del primer apunte a la próxima propuesta.</h3><p>Captura manual, procedencia clara y memoria persistente. La evaluación y las decisiones de producción se habilitarán cuando exista un servicio real.</p><p>Sin agentes autónomos conectados. DEMO no se importa en este workspace.</p></div></div>
      <IdeaCenterPanel id="real-idea-center-panel" ideas={state.ideas.map(item => item.idea)} open={open} error={state.error ?? undefined} persistence={{
        traces: Object.fromEntries(state.ideas.map(item => [item.idea.id, item])),
        saving: state.phase === 'saving' || state.phase === 'loading', savedId: state.savedId, selectedId, onSelect: select,
        onCreate: input => store.save(input),
        transitionsBusy: campaignState?.phase === 'saving' || state.phase === 'loading' || store.hasPendingWrite(),
        onTransition: campaignStore && campaignState?.phase === 'ready' && !store.hasPendingWrite() ? async (idea, type) => {
          const saved = await campaignStore.execute({ type, ideaId: idea.id, expectedUpdatedAt: idea.updatedAt, confirmed: true });
          if (saved) await store.load(); return saved;
        } : undefined,
      }} />
      {state.phase !== 'saving' && <button type="button" onClick={() => { void store.load(); }}>Recargar desde Supabase</button>}
      {campaignStore && <RealCampaignCenter store={campaignStore} ideas={store} />}
    </>}
  </section>;
}
