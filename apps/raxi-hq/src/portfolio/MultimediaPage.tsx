import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgencyNav } from '../agency/AgencyNav';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { buildMedia, characterLabel, countBySection, filterMedia, groupByDay, LEVEL_LABEL, type MediaAsset, type MediaFilter, type MediaSection, type MediaView } from './mediaModel';
import './fototeca.css';

const BUCKET = 'raxi-hq-private';
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; view: MediaView };

/** Owner-only reads (RLS). Read-only page: no writes, no generation, no cost. */
export async function loadMultimedia(client: SupabaseClient, ownerId: string): Promise<MediaView> {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const [a, i, c] = await Promise.all([
    client.from('raxi_assets').select('id,workspace_id,kind,object_path,mime_type,sha256,byte_size,external_asset_id,metadata,created_at').eq('workspace_id', workspaceId),
    client.from('raxi_portfolio_items').select('workspace_id,asset_id,collection_id').eq('workspace_id', workspaceId),
    client.from('raxi_portfolio_collections').select('id,workspace_id,title').eq('workspace_id', workspaceId),
  ]);
  if (a.error || i.error || c.error) throw new Error('No se pudo leer Multimedia.');
  return buildMedia(workspaceId, a.data, i.data, c.data);
}

async function signedUrls(client: SupabaseClient, assets: MediaAsset[]): Promise<Record<string, string>> {
  const paths = [...new Set(assets.map((a) => a.objectPath))];
  const out: Record<string, string> = {};
  for (let k = 0; k < paths.length; k += 100) {
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths.slice(k, k + 100), 60 * 30);
    if (error || !data) continue;
    for (const d of data) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  }
  return out;
}

export function MultimediaPage({ client, ownerId }: { client: SupabaseClient; ownerId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<MediaFilter>({ section: 'PUBLIC', character: 'ALL', onlyLoose: false });
  const [focus, setFocus] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const view = await loadMultimedia(client, ownerId);
      setState({ phase: 'ready', view });
      setUrls(await signedUrls(client, view.assets));
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Error inesperado.' });
    }
  }, [client, ownerId]);
  useEffect(() => { void reload(); }, [reload]);

  const shown = useMemo(() => (state.phase === 'ready' ? filterMedia(state.view.assets, filter) : []), [state, filter]);
  const groups = useMemo(() => groupByDay(shown), [shown]);
  const current = shown.find((a) => a.id === focus);
  const counts = state.phase === 'ready' ? countBySection(state.view.assets) : { PUBLIC: 0, HIDDEN: 0, UNCLASSIFIED: 0 };
  const hidden = filter.section === 'HIDDEN';
  const goSection = (section: MediaSection) => {
    if (section === 'HIDDEN' && !window.confirm('Vas a ver fotos NSFW / EXPLICIT (solo Fanvue). ¿Continuar?')) return;
    setFocus(undefined); setFilter((f) => ({ ...f, section }));
  };

  if (state.phase === 'loading') return <main className="fototeca" role="status">Cargando Multimedia…</main>;
  if (state.phase === 'error') return <main className="fototeca"><Header /><p role="alert">{state.message}</p></main>;

  return <main className="fototeca">
    <Header />
    <section className="foto-collection" aria-label="Todas las fotos">
      <div className="media-filters media-sections" role="group" aria-label="Nivel de contenido">
        <button type="button" aria-pressed={filter.section === 'PUBLIC'} onClick={() => goSection('PUBLIC')}>{`Públicas (${counts.PUBLIC})`}</button>
        <button type="button" aria-pressed={filter.section === 'UNCLASSIFIED'} onClick={() => goSection('UNCLASSIFIED')}>{`Sin clasificar (${counts.UNCLASSIFIED})`}</button>
        <button type="button" className="media-hidden-tab" aria-pressed={hidden} onClick={() => goSection('HIDDEN')}>{`🔒 Ocultas · NSFW (${counts.HIDDEN})`}</button>
      </div>
      {filter.section === 'UNCLASSIFIED' && <p className="foto-meta">Fotos archivadas sin nivel de contenido. No se muestran entre las públicas hasta clasificarlas.</p>}
      {hidden && <p className="foto-meta">Solo para Fanvue. Nunca se usan en Instagram ni en redes públicas.</p>}
      <div className="media-filters" role="group" aria-label="Filtrar">
        <button type="button" aria-pressed={filter.character === 'ALL'} onClick={() => setFilter((f) => ({ ...f, character: 'ALL' }))}>Todas</button>
        {state.view.characters.map((ch) => <button key={ch} type="button" aria-pressed={filter.character === ch} onClick={() => setFilter((f) => ({ ...f, character: ch }))}>{characterLabel(ch)}</button>)}
        <button type="button" aria-pressed={filter.onlyLoose} onClick={() => setFilter((f) => ({ ...f, onlyLoose: !f.onlyLoose }))}>Sin campaña</button>
      </div>
      <p className="foto-meta">{`${shown.length} de ${state.view.assets.length} fotos archivadas · las más recientes primero. Solo aparecen las fotos ya archivadas en Raxi HQ.`}</p>
      {!shown.length && <p>No hay fotos con este filtro.</p>}
      {current && <article className="foto-detail" aria-label="Detalle de la foto">
        <div className="foto-detail-media">{urls[current.objectPath] ? <img src={urls[current.objectPath]} alt={current.ariaFile ?? 'Foto archivada'} /> : <span className="foto-missing">Cargando…</span>}</div>
        <div className="foto-detail-body">
          <h3>{current.characterId ? characterLabel(current.characterId) : 'Sin personaje'}</h3>
          <p><b>{current.level ? LEVEL_LABEL[current.level] : 'Sin clasificar'}</b></p>
          <p className="foto-meta">{new Date(current.createdAt).toLocaleString('es-MX')}{current.ariaFile ? ` · ${current.ariaFile}` : ''}</p>
          <p>{current.campaigns.length ? `Campañas: ${current.campaigns.join(', ')}` : 'Sin campaña en la Fototeca'}</p>
          <p className="foto-meta">{`SHA-256 ${current.sha256.slice(0, 12)}… · ${(current.byteSize / 1024).toFixed(0)} KB`}</p>
          {urls[current.objectPath] && <a className="foto-download" href={urls[current.objectPath]} download target="_blank" rel="noreferrer">Abrir original</a>}
          {/* Only classified photos of a model can be a series base: an unclassified photo is never assumed public. */}
          {current.characterId && current.level && <Link className="foto-download" to={`/series/nueva?base=${current.id}&modelo=${current.characterId}`}>Crear serie de continuidad</Link>}
          {current.characterId && !current.level && <p className="foto-meta">Clasifica su nivel para poder crear una serie con esta foto.</p>}
          <button type="button" onClick={() => setFocus(undefined)}>Cerrar</button>
        </div>
      </article>}
      {groups.map((g) => <section key={g.day} aria-label={g.day}>
        <h3 className="media-day">{g.day}</h3>
        <div className="foto-grid media-grid" role="list">
          {g.assets.map((a) => <button key={a.id} role="listitem" type="button" className={`foto-tile${hidden ? ' media-blur' : ''}`} aria-pressed={a.id === focus} aria-label={`Foto ${a.ariaFile ?? a.id}`} onClick={() => setFocus(a.id)}>
            {urls[a.objectPath] ? <img src={urls[a.objectPath]} alt={a.ariaFile ?? 'Foto archivada'} loading="lazy" /> : <span className="foto-missing">Cargando…</span>}
            {!a.campaigns.length && <span className="foto-badge">Sin campaña</span>}
          </button>)}
        </div>
      </section>)}
    </section>
  </main>;
}

function Header() {
  return <header className="hq-command-header foto-header">
    <div className="hq-brand"><h1>Raxi HQ <span>Multimedia</span></h1><p>Todas las fotos archivadas, como en Mis creaciones</p></div>
    <AgencyNav />
  </header>;
}
