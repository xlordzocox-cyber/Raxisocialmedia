import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { agentLabel, canDecide, canUndo, parseProposals, STATUS_LABEL, visibleProposals, type TeamProposal } from './teamProposals';

type Load = { phase: 'loading' } | { phase: 'unavailable' } | { phase: 'error' } | { phase: 'ready'; items: TeamProposal[] };

/** Read-only list (RLS owner) + one audited RPC for the owner's decision. Never writes ideas directly. */
export function TeamProposalsPanel({ client, workspace }: { client: SupabaseClient; workspace: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    try {
      const { data, error } = await client.from('raxi_team_proposals').select('*').eq('workspace_id', workspace);
      if (error) { setState({ phase: error.code === '42P01' ? 'unavailable' : 'error' }); return; }
      setState({ phase: 'ready', items: parseProposals(workspace, data) });
    } catch { setState({ phase: 'error' }); }
  }, [client, workspace]);
  useEffect(() => { void load(); }, [load]);

  async function decide(p: TeamProposal, decision: 'ACCEPTED' | 'DISMISSED' | 'PROPOSED') {
    setBusy(p.id); setNotice(undefined);
    const { error } = await client.rpc('raxi_team_proposal_decide', { p_id: p.id, p_decision: decision });
    setBusy(undefined);
    setNotice(error ? 'No se guardó tu decisión.' : decision === 'ACCEPTED' ? 'Listo: el equipo preparará esta idea.' : decision === 'DISMISSED' ? 'Propuesta descartada.' : 'Propuesta devuelta a pendientes.');
    if (!error) await load();
  }

  if (state.phase === 'unavailable') return null;
  const items = state.phase === 'ready' ? visibleProposals(state.items, showDismissed) : [];
  const dismissed = state.phase === 'ready' ? state.items.filter((p) => p.status === 'DISMISSED').length : 0;
  const fresh = state.phase === 'ready' ? state.items.filter((p) => p.status === 'PROPOSED').length : 0;
  return <section className="team-proposals" aria-label="Propuestas del equipo">
    <header>
      <h3>Propuestas del equipo{fresh ? <span className="team-proposals-count">{fresh} nuevas</span> : null}</h3>
      <p>Ideas creadas por los agentes. Están separadas de las tuyas y solo avanzan si tú dices que te interesan.</p>
    </header>
    {state.phase === 'loading' && <p role="status">Consultando propuestas…</p>}
    {state.phase === 'error' && <p role="alert">No se pudieron leer las propuestas del equipo.</p>}
    {state.phase === 'ready' && !items.length && <p>El equipo todavía no tiene propuestas para ti.</p>}
    {items.map((p) => <article key={p.id} className={`team-proposal s-${p.status.toLowerCase()}`}>
      <p className="team-proposal-meta">{`Propuesta del equipo · ${agentLabel(p.agentKey)}${p.characterId ? ` · ${p.characterId}` : ''}${p.channel ? ` · ${p.channel}` : ''}`}</p>
      <h4>{p.title}</h4>
      <p>{p.summary}</p>
      {p.rationale && <p className="team-proposal-why"><b>Por qué:</b> {p.rationale}</p>}
      <p className="team-proposal-meta">{STATUS_LABEL[p.status]}{p.estimatedCostUsd !== null ? ` · costo estimado $${p.estimatedCostUsd.toFixed(2)}` : ''}</p>
      {!!p.evidence.length && <ul className="team-proposal-evidence">{p.evidence.map((e, i) => <li key={i}>
        {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.label}</a> : e.label}{e.observedAt ? ` (${e.observedAt})` : ''}
      </li>)}</ul>}
      <div className="team-proposal-actions" role="group" aria-label={`Decisión sobre ${p.title}`}>
        {canDecide(p) && <button type="button" disabled={!!busy} onClick={() => void decide(p, 'ACCEPTED')}>Me interesa</button>}
        {canDecide(p) && <button type="button" disabled={!!busy} onClick={() => void decide(p, 'DISMISSED')}>Descartar</button>}
        {canUndo(p) && <button type="button" disabled={!!busy} onClick={() => void decide(p, 'PROPOSED')}>Deshacer</button>}
      </div>
    </article>)}
    {dismissed > 0 && <button type="button" className="team-proposals-toggle" onClick={() => setShowDismissed((v) => !v)}>{showDismissed ? 'Ocultar descartadas' : `Ver descartadas (${dismissed})`}</button>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
