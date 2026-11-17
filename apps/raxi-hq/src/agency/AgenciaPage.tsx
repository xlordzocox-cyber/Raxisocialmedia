import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { buildPortfolio } from '../portfolio/portfolioModel';
import { buildMedia } from '../portfolio/mediaModel';
import { AgencyNav } from './AgencyNav';
import { buildAgency, type AgencyView } from './agencyModel';
import './agency.css';

const BUCKET = 'raxi-hq-private';
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; view: AgencyView; urls: Record<string, string> };
const CHANNEL_LABEL: Record<string, string> = { INSTAGRAM: 'Instagram', INSTAGRAM_STORY: 'Stories', TEASER: 'Teaser', FANVUE_FEED: 'FanView feed', FANVUE_CHAT: 'FanView chatting' };

/** Owner-only reads (RLS). Read-only page: no writes, no generation, no cost. */
export async function loadAgency(client: SupabaseClient, ownerId: string): Promise<{ view: AgencyView; urls: Record<string, string> }> {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const [c, i, a] = await Promise.all([
    client.from('raxi_portfolio_collections').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_portfolio_items').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_assets').select('id,workspace_id,kind,object_path,mime_type,sha256,byte_size,external_asset_id,metadata,created_at').eq('workspace_id', workspaceId),
  ]);
  if (c.error || i.error || a.error) throw new Error('No se pudo leer la agencia.');
  const view = buildAgency(buildPortfolio(workspaceId, c.data, i.data, a.data), buildMedia(workspaceId, a.data, i.data, c.data));
  const paths = [...new Set(view.talent.flatMap((t) => (t.coverPath ? [t.coverPath] : [])))];
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await client.storage.from(BUCKET).createSignedUrls(paths, 60 * 30);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  return { view, urls };
}

export function AgenciaPage({ client, ownerId }: { client: SupabaseClient; ownerId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  useEffect(() => {
    let alive = true;
    loadAgency(client, ownerId)
      .then((r) => { if (alive) setState({ phase: 'ready', ...r }); })
      .catch((cause) => { if (alive) setState({ phase: 'error', message: cause instanceof Error ? cause.message : 'No se pudo leer la agencia.' }); });
    return () => { alive = false; };
  }, [client, ownerId]);

  return <div className="agency">
    <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">
      {state.phase === 'loading' && <p role="status">Cargando la agencia…</p>}
      {state.phase === 'error' && <p role="alert">{state.message}</p>}
      {state.phase === 'ready' && <>
        <section className="agency-hero">
          <p className="agency-eyebrow">Agencia</p>
          <h1>Tu agencia, hoy</h1>
          <p className="agency-lead">{state.view.pending.length === 0 ? 'Nada espera tu decisión.' : state.view.pending.length === 1 ? '1 decisión espera por ti.' : `${state.view.pending.length} decisiones esperan por ti.`}</p>
        </section>

        <section aria-labelledby="ag-toca" className="agency-section">
          <h2 id="ag-toca">Te toca</h2>
          {state.view.pending.length === 0 ? <p className="agency-empty">Todo lo pendiente está decidido.</p> : <ul className="agency-cards">
            {state.view.pending.slice(0, 6).map((p) => <li key={p.itemId} className="agency-card">
              <p className={`agency-tag agency-tag-${p.kind.toLowerCase()}`}>{p.kind === 'FIX' ? 'QA pide corrección' : 'Lista para tu decisión'}</p>
              <h3>{p.collectionTitle}</h3>
              <p className="agency-meta">Foto {p.position}</p>
              <Link to="/fototeca" className="agency-action">Revisar en Fototeca</Link>
            </li>)}
          </ul>}
          {state.view.pending.length > 6 && <p className="agency-meta">Y {state.view.pending.length - 6} más en la Fototeca.</p>}
        </section>

        <section aria-labelledby="ag-talento" className="agency-section">
          <h2 id="ag-talento">Talento</h2>
          {state.view.talent.length === 0 ? <p className="agency-empty">Aún no hay modelos con fotos archivadas.</p> : <ul className="agency-talent">
            {state.view.talent.map((t) => <li key={t.id}>
              {t.coverPath && state.urls[t.coverPath]
                ? <img src={state.urls[t.coverPath]} alt={`Foto reciente de ${t.name}`} className="agency-cover" loading="lazy" />
                : <div className="agency-cover agency-cover-empty" role="img" aria-label={`${t.name}: sin foto pública archivada`}><span>Sin foto pública todavía</span></div>}
              <h3 className="agency-talent-name"><Link to={`/talento/${t.id}`}>{t.name}</Link></h3>
              <p className="agency-meta">{t.photos} {t.photos === 1 ? 'foto' : 'fotos'} en archivo · {t.campaigns} {t.campaigns === 1 ? 'campaña' : 'campañas'}</p>
            </li>)}
          </ul>}
        </section>

        <section aria-labelledby="ag-prod" className="agency-section">
          <h2 id="ag-prod">Producción en curso</h2>
          {state.view.productions.length === 0 ? <p className="agency-empty">Aún no hay producciones en curso.</p> : <ul className="agency-cards">
            {state.view.productions.map((p) => <li key={p.id} className="agency-card">
              <p className="agency-tag">{p.character} · {CHANNEL_LABEL[p.channel] ?? p.channel}</p>
              <h3>{p.title}</h3>
              <p className="agency-meta">{p.approved} de {p.total} aprobadas · {p.published} publicadas{p.blocked > 0 ? ` · ${p.blocked} por corregir` : ''}</p>
              <div className="agency-bar" role="img" aria-label={`${p.approved} de ${p.total} fotos aprobadas`}><span style={{ width: `${p.total ? Math.round((p.approved / p.total) * 100) : 0}%` }} /></div>
              <Link to="/fototeca" className="agency-action">Abrir en Fototeca</Link>
            </li>)}
          </ul>}
        </section>
      </>}
    </main>
  </div>;
}
