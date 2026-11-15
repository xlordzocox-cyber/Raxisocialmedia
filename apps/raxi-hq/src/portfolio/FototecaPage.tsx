import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import {
  buildPortfolio, canApprove, cropRect, gridOrder, postText, progress, QA_LABEL, STATUS_LABEL,
  type PortfolioItem, type PortfolioView,
} from './portfolioModel';
import './fototeca.css';

const BUCKET = 'raxi-hq-private';
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; workspaceId: string; view: PortfolioView };

/** Owner-only reads (RLS) + signed URLs that expire; no write except the audited decision RPC. */
export async function loadFototeca(client: SupabaseClient, ownerId: string): Promise<{ workspaceId: string; view: PortfolioView }> {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const [c, i, a] = await Promise.all([
    client.from('raxi_portfolio_collections').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_portfolio_items').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_assets').select('id,workspace_id,object_path,mime_type,sha256,byte_size').eq('workspace_id', workspaceId),
  ]);
  if (c.error || i.error || a.error) throw new Error(c.error?.code === '42P01' ? 'La Fototeca aún no está instalada en esta base.' : 'No se pudo leer la Fototeca.');
  return { workspaceId, view: buildPortfolio(workspaceId, c.data, i.data, a.data) };
}

async function signedUrls(client: SupabaseClient, items: PortfolioItem[]): Promise<Record<string, string>> {
  const paths = [...new Set(items.flatMap((i) => (i.asset ? [i.asset.objectPath] : [])))];
  if (!paths.length) return {};
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, 60 * 30);
  if (error || !data) return {};
  return Object.fromEntries(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])));
}

/** Crops in the browser (no upload, no new asset) and downloads a JPEG ready for the Instagram feed. */
async function downloadCropped(url: string, crop: string, name: string): Promise<void> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('load')); img.src = url; });
  const r = cropRect(img.naturalWidth, img.naturalHeight, crop);
  const canvas = document.createElement('canvas');
  canvas.width = r.sw; canvas.height = r.sh;
  canvas.getContext('2d')!.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
  if (!blob) throw new Error('encode');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function copy(text: string, done: () => void) {
  void navigator.clipboard?.writeText(text).then(done, () => undefined);
}

export function FototecaPage({ client, ownerId }: { client: SupabaseClient; ownerId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [selected, setSelected] = useState<string>();
  const [focus, setFocus] = useState<string>();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [publishUrl, setPublishUrl] = useState('');

  const reload = useCallback(async () => {
    try {
      const data = await loadFototeca(client, ownerId);
      setState({ phase: 'ready', ...data });
      setSelected((prev) => prev ?? data.view.collections[0]?.id);
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Error inesperado.' });
    }
  }, [client, ownerId]);
  useEffect(() => { void reload(); }, [reload]);

  const collection = state.phase === 'ready' ? state.view.collections.find((c) => c.id === selected) : undefined;
  useEffect(() => {
    let alive = true;
    if (collection) void signedUrls(client, collection.items).then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
  }, [client, collection]);
  const item = useMemo(() => collection?.items.find((i) => i.id === focus), [collection, focus]);
  useEffect(() => { setPublishUrl(''); }, [focus]);

  async function decide(target: PortfolioItem, decision: 'APPROVED' | 'REJECTED' | 'PENDING' | 'PUBLISHED') {
    setBusy(target.id); setNotice(undefined);
    const { error } = await client.rpc('raxi_portfolio_decide', { p_item: target.id, p_decision: decision, p_published_url: decision === 'PUBLISHED' ? publishUrl.trim() : null });
    setBusy(undefined);
    if (error) { setNotice('No se guardó la decisión: ' + (error.message || 'error')); return; }
    setNotice('Decisión guardada.');
    await reload();
  }

  if (state.phase === 'loading') return <main className="fototeca" role="status">Cargando Fototeca…</main>;
  if (state.phase === 'error') return <main className="fototeca"><Header /><p role="alert">{state.message}</p></main>;
  if (!state.view.collections.length) return <main className="fototeca"><Header /><p>Aún no hay campañas en la Fototeca.</p></main>;

  const p = collection ? progress(collection.items) : undefined;
  return <main className="fototeca">
    <Header />
    <nav className="foto-collections" aria-label="Campañas">
      {state.view.collections.map((c) => <button key={c.id} type="button" aria-pressed={c.id === selected} onClick={() => { setSelected(c.id); setFocus(undefined); }}>
        <b>{c.title}</b><span>{c.characterId} · {c.channel}</span>
      </button>)}
    </nav>
    {collection && p && <section className="foto-collection" aria-label={collection.title}>
      <header>
        <h2>{collection.title}</h2>
        {collection.concept && <p>{collection.concept}</p>}
        <p className="foto-progress">{`${p.approved}/${p.total} aprobadas · ${p.published} publicadas${p.blocked ? ` · ${p.blocked} necesitan corrección` : ''}`}</p>
      </header>
      <p className="foto-hint">Vista de cuadrícula como en Instagram: la última publicación queda arriba a la izquierda.</p>
      <div className="foto-grid" role="list">
        {gridOrder(collection.items).map((it) => {
          const url = it.asset ? urls[it.asset.objectPath] : undefined;
          return <button key={it.id} role="listitem" type="button" className={`foto-tile s-${it.status.toLowerCase()} q-${it.qaStatus.toLowerCase()}`} aria-pressed={it.id === focus} onClick={() => setFocus(it.id)} aria-label={`Publicación ${it.position}: ${STATUS_LABEL[it.status]}`}>
            {url ? <img src={url} alt={it.altText} loading="lazy" /> : <span className="foto-missing">{it.asset ? 'Cargando…' : 'Sin archivar'}</span>}
            <span className="foto-badge">#{it.position}</span>
            {it.qaStatus === 'NEEDS_FIX' && <span className="foto-flag">Corregir</span>}
            {it.decision === 'APPROVED' && it.status !== 'PUBLISHED' && <span className="foto-ok">✓</span>}
            {it.status === 'PUBLISHED' && <span className="foto-ok">Publicada</span>}
          </button>;
        })}
      </div>
      {item && <article className="foto-detail" aria-label={`Detalle publicación ${item.position}`}>
        <div className="foto-detail-media">
          {item.asset && urls[item.asset.objectPath] ? <img src={urls[item.asset.objectPath]} alt={item.altText} /> : <span className="foto-missing">Sin imagen archivada</span>}
        </div>
        <div className="foto-detail-body">
          <h3>Publicación #{item.position} · {STATUS_LABEL[item.status]}</h3>
          <p><b>{QA_LABEL[item.qaStatus]}</b>{item.qaNotes ? ` — ${item.qaNotes}` : ''}</p>
          <p className="foto-meta">Recorte para el feed: <b>{item.crop}</b>{item.asset ? ` · SHA-256 ${item.asset.sha256.slice(0, 12)}…` : ''}</p>
          <label>Texto para Instagram</label>
          <pre className="foto-caption">{postText(item)}</pre>
          <button type="button" onClick={() => copy(postText(item), () => setNotice('Texto copiado.'))}>Copiar texto</button>
          <label>Texto alternativo (accesibilidad)</label>
          <pre className="foto-caption">{item.altText || '—'}</pre>
          <button type="button" onClick={() => copy(item.altText, () => setNotice('Texto alternativo copiado.'))} disabled={!item.altText}>Copiar texto alternativo</button>
          {item.asset && urls[item.asset.objectPath] && item.crop !== 'ORIGINAL' && <button type="button" className="foto-download" onClick={() => {
            const url = urls[item.asset!.objectPath];
            void downloadCropped(url, item.crop, `${collection.externalId}-${String(item.position).padStart(2, '0')}-${item.crop.replace(':', 'x')}.jpg`)
              .then(() => setNotice(`Foto recortada a ${item.crop} descargada.`), () => setNotice('No se pudo recortar en este navegador; usa «Abrir original».'));
          }}>{`Descargar ${item.crop} lista para Instagram`}</button>}
          {item.asset && urls[item.asset.objectPath] && <a className="foto-download" href={urls[item.asset.objectPath]} download target="_blank" rel="noreferrer">Abrir original</a>}
          <p className="foto-meta">Al publicar, activa la etiqueta «AI info» en Instagram.</p>
          <div className="foto-actions" role="group" aria-label="Decisión">
            <button type="button" disabled={!!busy || !canApprove(item)} onClick={() => void decide(item, 'APPROVED')}>Aprobar</button>
            <button type="button" disabled={!!busy || item.status === 'PUBLISHED' || item.decision === 'REJECTED'} onClick={() => void decide(item, 'REJECTED')}>Descartar</button>
            {item.decision !== 'PENDING' && item.status !== 'PUBLISHED' && <button type="button" disabled={!!busy} onClick={() => void decide(item, 'PENDING')}>Volver a pendiente</button>}
          </div>
          {item.decision === 'APPROVED' && item.status !== 'PUBLISHED' && <div className="foto-publish">
            <label htmlFor="pub-url">Ya la publiqué — enlace de Instagram</label>
            <input id="pub-url" type="url" inputMode="url" placeholder="https://www.instagram.com/p/…" value={publishUrl} onChange={(e) => setPublishUrl(e.target.value)} />
            <button type="button" disabled={!!busy || !/^https:\/\/(www\.)?instagram\.com\//.test(publishUrl.trim())} onClick={() => void decide(item, 'PUBLISHED')}>Marcar como publicada</button>
          </div>}
          {item.publishedUrl && <a href={item.publishedUrl} target="_blank" rel="noreferrer">Ver en Instagram</a>}
          {notice && <p role="status">{notice}</p>}
        </div>
      </article>}
    </section>}
  </main>;
}

function Header() {
  return <header className="hq-command-header foto-header">
    <div className="hq-brand"><h1>Raxi HQ <span>Fototeca</span></h1><p>Campañas, fotos y textos listos para publicar</p></div>
    <div className="hq-session-controls"><Link to="/">Volver a la oficina</Link></div>
  </header>;
}
