import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgencyNav } from '../agency/AgencyNav';
import { callSheet, DEFAULT_MODEL, STATUS_LABEL, usd } from '../creator/creatorModel';
import { CHANNELS, CHANNEL_LABEL, isAdultChannel, seriesBusy, validScenes, type Channel, type SeriesQuote, type SeriesView } from './seriesModel';
import '../talent/talent.css';
import '../creator/creator.css';

const Shell = ({ children }: { children: React.ReactNode }) => <div className="agency">
  <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
  <main className="agency-main">{children}</main></div>;

/** New continuity series from a Fototeca photo. The click on "Crear serie · $x" is Luis's approval of that exact amount. */
export function NewSeriesPage({ client, characterId, baseAssetId }: { client: SupabaseClient; characterId: string; baseAssetId: string }) {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>('INSTAGRAM');
  const [nsfw, setNsfw] = useState(false); // adult scenes are only shown with the switch on
  const [scenes, setScenes] = useState<string[]>(['', '', '']);
  const [title, setTitle] = useState('');
  const [attest, setAttest] = useState(false);
  const [quote, setQuote] = useState<SeriesQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const body = { character: characterId, baseAssetId, channel, scenes: scenes.map((s) => s.trim()), model: DEFAULT_MODEL, resolution: '1.5k' };
  const adult = isAdultChannel(channel);

  useEffect(() => {
    void client.from('raxi_assets').select('object_path').eq('id', baseAssetId).maybeSingle().then(async ({ data }) => {
      if (!data?.object_path) return;
      const { data: s } = await client.storage.from('raxi-hq-private').createSignedUrl(data.object_path as string, 1800);
      setBaseUrl(s?.signedUrl ?? null);
    });
  }, [client, baseAssetId]);
  useEffect(() => {
    if (!validScenes(scenes)) { setQuote(null); return; }
    let live = true;
    callSheet<SeriesQuote>(client, { action: 'SERIES_QUOTE', ...body }).then((q) => { if (live) { setQuote(q); setNotice(undefined); } })
      .catch((e: Error) => { if (live) { setQuote(null); setNotice(e.message); } });
    return () => { live = false; };
  }, [client, channel, scenes.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setNotice(undefined);
    try {
      const r = await callSheet<SeriesView>(client, { action: 'SERIES_START', ...body, title, attestNotReal: attest, expectedTotalMills: quote!.totalMills });
      navigate(`/series/${r.seriesId}`);
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const canStart = !busy && quote !== null && attest && validScenes(scenes) && (!adult || nsfw);

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to="/fototeca">Fototeca</Link></p>
      <h1>Nueva serie de continuidad</h1>
      <p className="agency-lead">Mismo momento que la foto base: misma ropa, peinado, maquillaje, lugar y luz. Cada escena es una foto nueva.</p>
      <p className="agency-meta">Escribe solo qué cambia (pose, gesto, encuadre). Si la base es una selfie en espejo, dilo: «misma selfie en el espejo, ahora sentada en la cama» o «sin espejo, foto tomada por otra persona».</p></section>
    <section className="agency-section creator" aria-label="Serie nueva">
      <div className="creator-sources">{baseUrl ? <img src={baseUrl} alt="Foto base de la serie" style={{ maxWidth: 240, borderRadius: 12 }} /> : <p className="agency-meta">Cargando la foto base…</p>}</div>
      <label htmlFor="series-title">Nombre de la serie</label>
      <input id="series-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Habitación, noche" />
      <label htmlFor="series-channel">Canal</label>
      <select id="series-channel" value={channel} disabled={busy} onChange={(e) => setChannel(e.target.value as Channel)}>
        {CHANNELS.map((c) => <option key={c} value={c} disabled={quote ? !quote.channels.includes(c) : false}>{CHANNEL_LABEL[c]}</option>)}
      </select>
      {adult && <label className="talent-switch"><input id="series-nsfw" type="checkbox" role="switch" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} /> NSFW · las escenas de Fanvue las escribes tú</label>}
      {(!adult || nsfw) && <div>
        <h3>Escenas (2 a 6, una por foto)</h3>
        {scenes.map((s, i) => <div key={i} className="talent-actions">
          <textarea aria-label={`Escena ${i + 1}`} rows={2} maxLength={300} value={s} disabled={busy} onChange={(e) => setScenes((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
            placeholder={adult ? 'Escribe tú esta escena' : 'Ej.: sentada en la cama mirando el teléfono'} />
          {scenes.length > 2 && <button type="button" disabled={busy} onClick={() => setScenes((x) => x.filter((_, j) => j !== i))}>Quitar</button>}
        </div>)}
        {scenes.length < 6 && <button type="button" disabled={busy} onClick={() => setScenes((x) => [...x, ''])}>Añadir escena</button>}
      </div>}
      <label className="creator-attest"><input id="series-attest" type="checkbox" checked={attest} disabled={busy} onChange={(e) => setAttest(e.target.checked)} /> Es un personaje creado con IA: no es la imagen de otra persona real.</label>
      <div className="talent-actions">
        <button type="button" id="series-start" disabled={!canStart} onClick={() => { void start(); }}>{`Crear serie${quote ? ` · ${usd(quote.totalMills)}` : ''}`}</button>
        {quote && <span className="creator-meter">{usd(quote.perPhotoMills)} por foto · Gastado este mes: {usd(quote.spentMills)} de {usd(quote.capMills)}</span>}
      </div>
      {notice && <p role="alert" className="agency-meta">{notice}</p>}
    </section>
  </Shell>;
}

/** An existing series: one card per photo with "Otra versión", "Cambiar" and "Elegir". */
export function SeriesDetailPage({ client, seriesId, pollMs = 3000 }: { client: SupabaseClient; seriesId: string; pollMs?: number }) {
  const [view, setView] = useState<SeriesView | null>(null);
  const [nsfw, setNsfw] = useState(false);
  const [change, setChange] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const load = () => callSheet<SeriesView>(client, { action: 'SERIES_STATUS', seriesId }).then(setView);
  useEffect(() => { void load().catch((e: Error) => setNotice({ kind: 'error', text: e.message })); }, [client, seriesId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!seriesBusy(view)) return;
    const t = setTimeout(() => { void load().catch(() => undefined); }, pollMs);
    return () => clearTimeout(t);
  }, [view, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await work(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  if (!view) return <Shell>{notice ? <p role="alert">{notice.text}</p> : <p role="status">Cargando la serie…</p>}</Shell>;
  const adult = view.level !== 'PUBLIC';
  const hidden = adult && !nsfw;
  const cost = view.takes[0]?.costMills ?? 0;

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to="/fototeca">Fototeca</Link></p>
      <h1>Serie de continuidad</h1><p className="agency-lead">{CHANNEL_LABEL[view.channel]} · {view.scenes.length} fotos nuevas</p></section>
    <section className="agency-section creator" aria-label="Fotos de la serie">
      {adult && <label className="talent-switch"><input id="series-detail-nsfw" type="checkbox" role="switch" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} /> NSFW</label>}
      {hidden ? <p className="agency-meta">Serie de Fanvue: enciende NSFW para verla.</p> : <>
        <img src={view.baseUrl} alt="Foto base" style={{ maxWidth: 200, borderRadius: 12 }} />
        <ul className="creator-views">{view.scenes.map((scene, i) => {
          const shot = i + 1;
          const takes = view.takes.filter((t) => t.shot === shot);
          const pending = takes.some((t) => t.status === 'QUEUED' || t.status === 'PENDING');
          return <li key={shot} className="creator-view"><h3>Foto {shot + 1}</h3><p className="agency-meta">{scene}</p>
            <ul className="creator-takes">{takes.map((t) => <li key={t.id} className="creator-take">
              {t.previewUrl ? <img src={t.previewUrl} alt={`Foto ${shot + 1}, toma ${t.takeNo}`} loading="lazy" /> : <div className="talent-missing">{STATUS_LABEL[t.status]}</div>}
              <span className="agency-meta">Toma {t.takeNo} · {t.chosen ? 'Elegida' : STATUS_LABEL[t.status]}{t.error ? ` · ${t.error}` : ''}</span>
              {t.status === 'SUCCEEDED' && !t.chosen && <button type="button" disabled={busy} onClick={() => { void act(async () => {
                await callSheet(client, { action: 'SERIES_CHOOSE', takeId: t.id }); setNotice({ kind: 'ok', text: 'Elegida. Ya está en la colección de la Fototeca.' }); await load(); }); }}>Elegir</button>}
            </li>)}</ul>
            <div className="talent-actions">
              <button type="button" disabled={busy || pending} onClick={() => { void act(async () => { setView(await callSheet<SeriesView>(client, { action: 'SERIES_RETAKE', seriesId, shot, expectedCostMills: cost })); }); }}>{`Otra versión · ${usd(cost)}`}</button>
              <input aria-label={`Cambio para la foto ${shot + 1}`} maxLength={300} placeholder="Cambiar: describe el ajuste" value={change[shot] ?? ''} disabled={busy} onChange={(e) => setChange((c) => ({ ...c, [shot]: e.target.value }))} />
              <button type="button" disabled={busy || pending || !change[shot]?.trim()} onClick={() => { void act(async () => {
                setView(await callSheet<SeriesView>(client, { action: 'SERIES_RETAKE', seriesId, shot, instruction: change[shot], expectedCostMills: cost })); setChange((c) => ({ ...c, [shot]: '' })); }); }}>{`Cambiar · ${usd(cost)}`}</button>
            </div>
          </li>;
        })}</ul>
      </>}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="agency-meta">{notice.text}</p>}
    </section>
  </Shell>;
}
