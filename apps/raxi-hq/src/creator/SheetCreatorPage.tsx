import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgencyNav } from '../agency/AgencyNav';
import { loadTalent } from '../talent/TalentProfilePage';
import type { TalentProfile } from '../talent/talentModel';
import { DEFAULT_MODEL, serverMessage, STATUS_LABEL, VIEWS, VIEW_LABEL, anchorReady, callSheet, isBusy, usd, viewCost, type Quote, type SheetLevel, type SheetRun, type SheetView } from './creatorModel';
import '../talent/talent.css';
import './creator.css';

type Talent = { profile: TalentProfile; urls: Record<string, string> };
type Notice = { kind: 'ok' | 'error'; text: string } | undefined;

/** Creates the 360 sheet: Luis uploads photos, sees the cost, and his click is the approval. The adult sheet only appears with NSFW on. */
export function SheetCreatorPage({ client, ownerId, characterId, pollMs = 3000 }: { client: SupabaseClient; ownerId: string; characterId: string; pollMs?: number }) {
  const [talent, setTalent] = useState<Talent | null>(null);
  const [error, setError] = useState<string>();
  const [nsfw, setNsfw] = useState(false); // off by default (AGENTS.md)
  const reload = useCallback(async () => {
    try { setTalent(await loadTalent(client, ownerId, characterId)); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo leer la ficha.'); }
  }, [client, ownerId, characterId]);
  useEffect(() => { void reload(); }, [reload]);

  const header = <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>;
  if (!talent) return <div className="agency">{header}<main className="agency-main">{error ? <p role="alert">{error}</p> : <p role="status">Cargando…</p>}</main></div>;
  const { profile } = talent;
  const general = (angle: string) => profile.references.some((r) => r.angle === angle && r.level === 'GENERAL');
  const adultReady = general('FRONT') && general('BODY_FRONT');

  return <div className="agency">{header}
    <main className="agency-main">
      <section className="agency-hero"><p className="agency-eyebrow"><Link to={`/talento/${characterId}`}>{profile.name}</Link></p>
        <h1>Crear ficha 360</h1>
        <p className="agency-lead">Sube sus fotos, revisa el costo y crea. Primero sale la cara de frente; con ella se generan solas las demás vistas.</p></section>
      <SheetSection client={client} characterId={characterId} level="GENERAL" talent={talent} onChange={reload} pollMs={pollMs} />
      <section className="agency-section">
        <div className="talent-sheet-head"><h2>Ficha adulta</h2>
          <label className="talent-switch"><input id="creator-nsfw" type="checkbox" role="switch" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} /> NSFW</label></div>
        {!nsfw && <p className="agency-meta">Apagada. La ficha adulta solo se usa como referencia para Fanvue y nunca para redes públicas.</p>}
      </section>
      {nsfw && (adultReady
        ? <SheetSection client={client} characterId={characterId} level="ADULT" talent={talent} onChange={reload} pollMs={pollMs} />
        : <p className="agency-meta" role="status">Para crear la ficha adulta, primero elige la cara de frente y el cuerpo de frente de la ficha general.</p>)}
    </main>
  </div>;
}

function SheetSection({ client, characterId, level, talent, onChange, pollMs }: { client: SupabaseClient; characterId: string; level: SheetLevel; talent: Talent; onChange: () => Promise<void>; pollMs: number }) {
  const [run, setRun] = useState<SheetRun | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [attest, setAttest] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [adultTemplate, setAdultTemplate] = useState('');
  const [change, setChange] = useState<Partial<Record<SheetView, string>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const sources = talent.profile.references.filter((r) => r.angle === 'SOURCE' && r.level === 'GENERAL');
  const prefix = level === 'ADULT' ? 'adult' : 'general';
  const base = { character: characterId, level, model: DEFAULT_MODEL, resolution: '1k', sourceIds: level === 'GENERAL' ? selected : [] };

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await work(); } catch (e) { setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'No se pudo completar la acción.' }); } finally { setBusy(false); }
  };

  useEffect(() => { void callSheet<SheetRun | { runId: null }>(client, { action: 'LATEST', character: characterId, level }).then((r) => { if (r?.runId) setRun(r as SheetRun); }).catch(() => undefined); }, [client, characterId, level]);
  useEffect(() => {
    if (level === 'GENERAL' && selected.length === 0) { setQuote(null); return; }
    let live = true;
    callSheet<Quote>(client, { action: 'QUOTE', ...base }).then((q) => { if (live) setQuote(q); }).catch((e) => { if (live) { setQuote(null); setNotice({ kind: 'error', text: e.message }); } });
    return () => { live = false; };
  }, [client, characterId, level, selected.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isBusy(run)) return;
    const t = setTimeout(() => { void callSheet<SheetRun>(client, { action: 'STATUS', runId: run!.runId }).then(setRun).catch(() => undefined); }, pollMs);
    return () => clearTimeout(t);
  }, [client, run, pollMs]);

  const upload = (angle: string, file: File | undefined) => act(async () => {
    if (!file) return;
    const body = new FormData();
    body.set('character', characterId); body.set('angle', angle); body.set('level', level === 'ADULT' ? 'ADULT' : 'GENERAL'); body.set('file', file);
    const { error } = await client.functions.invoke('talent-reference', { body });
    if (error) throw new Error(await serverMessage(error, 'No se pudo subir la imagen.'));
    setNotice({ kind: 'ok', text: 'Imagen guardada.' }); await onChange();
  });
  const start = () => act(async () => {
    const r = await callSheet<SheetRun>(client, { action: 'START', ...base, attestNotReal: attest, expectedTotalMills: quote!.totalMills, ...(level === 'ADULT' && adultTemplate.trim() ? { adultTemplate } : {}) });
    setRun(r); setNotice({ kind: 'ok', text: 'Creando la ficha. Primero sale la vista de frente.' });
  });
  const retake = (view: SheetView, instruction?: string) => act(async () => {
    setRun(await callSheet<SheetRun>(client, { action: 'RETAKE', runId: run!.runId, view, expectedCostMills: viewCost(run!, view), ...(instruction ? { instruction } : {}) }));
    setChange((c) => ({ ...c, [view]: undefined }));
  });
  const choose = (takeId: string) => act(async () => {
    await callSheet(client, { action: 'CHOOSE', takeId });
    setNotice({ kind: 'ok', text: 'Elegida. Reemplaza a la anterior de esta vista en Talento.' });
    if (run) {
      const view = run.takes.find((t) => t.id === takeId)?.view;
      // One chosen take per view: the previous one is retired from Talento on the server.
      setRun({ ...run, takes: run.takes.map((t) => (t.id === takeId ? { ...t, chosen: true } : t.view === view ? { ...t, chosen: false } : t)) });
    }
    await onChange();
  });

  const canStart = !busy && !isBusy(run) && quote !== null && attest && (level === 'ADULT' || selected.length > 0);
  const startLabel = `Crear ficha${level === 'ADULT' ? ' adulta' : ''}${quote ? ` · ${usd(quote.totalMills)}` : ''}`;

  return <section className="agency-section creator" aria-label={level === 'ADULT' ? 'Ficha adulta' : 'Ficha general'}>
    <h2>{level === 'ADULT' ? 'Ficha adulta · NSFW, solo Fanvue' : 'Ficha general · con ropa'}</h2>
    <p className="agency-meta">Modelo: Seedream 5.5 (WaveSpeed) · 1k{level === 'ADULT' ? ' · basada en la cara y el cuerpo de frente de la ficha general' : ''}</p>

    {level === 'GENERAL' && <div className="creator-sources">
      <h3>Sus fotos (1 a 3)</h3>
      {sources.length === 0 && <p className="agency-meta">Todavía no hay fotos de la modelo.</p>}
      <ul>{sources.map((s) => <li key={s.id}><label className="talent-ref">
        {talent.urls[s.objectPath] ? <img src={talent.urls[s.objectPath]} alt="Foto de la modelo" loading="lazy" /> : <div className="talent-missing">Sin vista previa</div>}
        <span><input type="checkbox" checked={selected.includes(s.id)} disabled={busy || (!selected.includes(s.id) && selected.length >= 3)}
          onChange={(e) => setSelected((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))} /> Usar</span></label></li>)}</ul>
      <label htmlFor="source-file">Subir otra foto suya</label>
      <input id="source-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { void upload('SOURCE', e.target.files?.[0]); }} />
    </div>}

    {level === 'ADULT' && <div>
      <label htmlFor="adult-template">Plantilla de la ficha adulta (opcional; vacía usa el desnudo artístico neutral por defecto)</label>
      <textarea id="adult-template" rows={3} maxLength={1500} value={adultTemplate} disabled={busy} onChange={(e) => setAdultTemplate(e.target.value)} />
    </div>}

    <label className="creator-attest"><input id={`${prefix}-attest`} type="checkbox" checked={attest} disabled={busy} onChange={(e) => setAttest(e.target.checked)} /> Es un personaje creado con IA: no es la imagen de otra persona real.</label>
    <div className="talent-actions">
      <button type="button" id={`${prefix}-start`} disabled={!canStart} onClick={() => { void start(); }}>{startLabel}</button>
      {quote && <span className="creator-meter">Gastado este mes: {usd(quote.spentMills)} de {usd(quote.capMills)}</span>}
    </div>
    {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="agency-meta">{notice.text}</p>}

    {run && <ul className="creator-views">{VIEWS[level].map((view) => {
      const takes = run.takes.filter((t) => t.view === view);
      const cost = usd(viewCost(run, view));
      const ready = view === VIEWS[level][0] || anchorReady(run);
      return <li key={view} className="creator-view"><h3>{VIEW_LABEL[view]}</h3>
        <ul className="creator-takes">{takes.map((t) => <li key={t.id} className="creator-take">
          {t.previewUrl ? <img src={t.previewUrl} alt={`${VIEW_LABEL[view]}, toma ${t.takeNo}`} loading="lazy" /> : <div className="talent-missing">{STATUS_LABEL[t.status]}</div>}
          <span className="agency-meta">Toma {t.takeNo} · {t.chosen ? 'Elegida' : STATUS_LABEL[t.status]}{t.error ? ` · ${t.error}` : ''}</span>
          {t.status === 'SUCCEEDED' && !t.chosen && <button type="button" disabled={busy} onClick={() => { void choose(t.id); }}>Elegir</button>}
        </li>)}</ul>
        <div className="talent-actions">
          <button type="button" disabled={busy || !ready || isBusy({ ...run, takes })} onClick={() => { void retake(view); }}>{`Otra versión · ${cost}`}</button>
          <input aria-label={`Cambio para ${VIEW_LABEL[view]}`} maxLength={300} placeholder="Cambiar: describe el ajuste" value={change[view] ?? ''} disabled={busy} onChange={(e) => setChange((c) => ({ ...c, [view]: e.target.value }))} />
          <button type="button" disabled={busy || !ready || !change[view]?.trim() || isBusy({ ...run, takes })} onClick={() => { void retake(view, change[view]); }}>{`Cambiar · ${cost}`}</button>
          <label className="creator-own">Subir la mía<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => { void upload(view, e.target.files?.[0]); }} /></label>
        </div>
      </li>;
    })}</ul>}
  </section>;
}
