import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgencyNav } from '../agency/AgencyNav';
import { callSheet, DEFAULT_MODEL, STATUS_LABEL, usd } from '../creator/creatorModel';
import { DEFAULT_STYLE, PROMPTER_ESTIMATE, PUBLIC_CHANNEL_LABEL, readTarget, recreateBusy, STYLE_LABEL,
  type Prepared, type PublicChannel, type RecreateQuote, type RecreateView, type Style } from './recreateModel';
import '../talent/talent.css';
import '../creator/creator.css';

const Shell = ({ children }: { children: React.ReactNode }) => <div className="agency">
  <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
  <main className="agency-main">{children}</main></div>;
const NAMES: Record<string, string> = { 'vesper-corvus': 'Vesper Corvus', 'raxi-vox': 'Raxi Vox' };

/** Target photo → prompt (Claude) → 1..4 versions (WaveSpeed). The click on "Crear · $x" is Luis's approval of that amount. */
export function NewRecreatePage({ client, characterId, read = readTarget }: { client: SupabaseClient; characterId: string; read?: (f: File) => Promise<string> }) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<PublicChannel>('INSTAGRAM');
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE[characterId] ?? 'AMATEUR');
  const [image, setImage] = useState<string | null>(null);
  const [scene, setScene] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [prompt, setPrompt] = useState('');
  const [fix, setFix] = useState('');
  const [variants, setVariants] = useState(2);
  const [quote, setQuote] = useState<RecreateQuote | null>(null);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [promptSpent, setPromptSpent] = useState(0);

  useEffect(() => {
    if (!prepared) { setQuote(null); return; }
    let live = true;
    callSheet<RecreateQuote>(client, { action: 'RECREATE_QUOTE', character: characterId, channel, style, model: DEFAULT_MODEL, variants })
      .then((q) => { if (live) setQuote(q); }).catch((e: Error) => { if (live) { setQuote(null); setNotice(e.message); } });
    return () => { live = false; };
  }, [client, characterId, channel, style, variants, prepared]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await work(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const ask = (extra: Record<string, unknown>) => act(async () => {
    const r = await callSheet<Prepared>(client, { action: 'RECREATE_PROMPT', character: characterId, style, scene, ...extra });
    setPrepared(r); setPrompt(r.prompt); setPromptSpent((s) => s + r.promptCostMills);
  });
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try { setImage(await read(file)); setPrepared(null); setPrompt(''); setNotice(undefined); } catch (e) { setNotice((e as Error).message); }
  };
  const start = () => act(async () => {
    const r = await callSheet<RecreateView>(client, { action: 'RECREATE_START', character: characterId, channel, style, model: DEFAULT_MODEL, scene,
      objectivePath: prepared!.objectivePath, prompt, promptCostMills: prepared!.promptCostMills, variants, attestNotReal: attest, expectedTotalMills: quote!.totalMills });
    navigate(`/recrear/${r.recreationId}`);
  });
  const canStart = !busy && Boolean(prepared) && quote !== null && attest && prompt.trim().length > 0;

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to={`/talento/${characterId}`}>{NAMES[characterId] ?? characterId}</Link></p>
      <h1>Recrear una foto</h1>
      <p className="agency-lead">Sube una foto que te guste. El prompter toma su pose, ropa, lugar y luz, y la rehace con {NAMES[characterId] ?? 'la modelo'}. Nunca copia la cara de la persona de la foto.</p>
      <p className="agency-meta">Solo para Instagram, Stories y teaser. Usa fotos generadas con IA o de pose; no la imagen de una persona real para suplantarla.</p></section>
    <section className="agency-section creator" aria-label="Recrear">
      <label htmlFor="rc-file">Foto objetivo</label>
      <input id="rc-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); }} />
      {(prepared?.objectiveUrl ?? image) && <img src={prepared?.objectiveUrl ?? image!} alt="Foto objetivo" style={{ maxWidth: 240, borderRadius: 12 }} />}
      <label htmlFor="rc-scene">Indicaciones (opcional)</label>
      <textarea id="rc-scene" rows={2} maxLength={1000} value={scene} disabled={busy} onChange={(e) => setScene(e.target.value)} placeholder="Ej.: de noche, con su collar de cruz, en una biblioteca" />
      <div className="talent-actions">
        <label htmlFor="rc-style">Estilo</label>
        <select id="rc-style" value={style} disabled={busy} onChange={(e) => { setStyle(e.target.value as Style); setPrepared(null); }}>
          {(Object.keys(STYLE_LABEL) as Style[]).map((s) => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
        </select>
        <label htmlFor="rc-channel">Canal</label>
        <select id="rc-channel" value={channel} disabled={busy} onChange={(e) => setChannel(e.target.value as PublicChannel)}>
          {(Object.keys(PUBLIC_CHANNEL_LABEL) as PublicChannel[]).map((c) => <option key={c} value={c}>{PUBLIC_CHANNEL_LABEL[c]}</option>)}
        </select>
      </div>
      <div className="talent-actions">
        <button type="button" id="rc-prepare" disabled={busy || (!image && !prepared)} onClick={() => { void ask(prepared ? { objectivePath: prepared.objectivePath } : { image }); }}>
          {`${prepared ? 'Rehacer prompt' : 'Preparar prompt'} · ${PROMPTER_ESTIMATE}`}</button>
        {promptSpent > 0 && <span className="creator-meter">{`Prompter en esta foto: ${usd(promptSpent)}`}</span>}
      </div>
      {prepared && <div>
        <p className="agency-meta">{prepared.summary}</p>
        {prepared.warnings.map((w) => <p key={w} className="agency-meta">⚠️ {w}</p>)}
        <label htmlFor="rc-prompt">Prompt (puedes editarlo)</label>
        <textarea id="rc-prompt" rows={8} maxLength={3000} value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} />
        <div className="talent-actions">
          <input aria-label="Corrección del prompt" maxLength={300} placeholder="Corregir: describe el ajuste" value={fix} disabled={busy} onChange={(e) => setFix(e.target.value)} />
          <button type="button" disabled={busy || !fix.trim()} onClick={() => { void ask({ objectivePath: prepared.objectivePath, previousPrompt: prompt, fix }).then(() => setFix('')); }}>{`Corregir · ${PROMPTER_ESTIMATE}`}</button>
        </div>
        <label htmlFor="rc-variants">Versiones</label>
        <select id="rc-variants" value={variants} disabled={busy} onChange={(e) => setVariants(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <label className="creator-attest"><input id="rc-attest" type="checkbox" checked={attest} disabled={busy} onChange={(e) => setAttest(e.target.checked)} /> {NAMES[characterId] ?? 'La modelo'} es un personaje creado con IA y no se copia la identidad de la persona de la foto objetivo.</label>
        <div className="talent-actions">
          <button type="button" id="rc-start" disabled={!canStart} onClick={() => { void start(); }}>{`Crear ${variants === 1 ? '1 foto' : `${variants} fotos`}${quote ? ` · ${usd(quote.totalMills)}` : ''}`}</button>
          {quote && <span className="creator-meter">{usd(quote.perPhotoMills)} por foto · Gastado este mes: {usd(quote.spentMills)} de {usd(quote.capMills)}</span>}
        </div>
      </div>}
      {notice && <p role="alert" className="agency-meta">{notice}</p>}
    </section>
  </Shell>;
}

/** A recreation: one card per version with "Otra versión", "Cambiar" and "Elegir". */
export function RecreateDetailPage({ client, recreationId, pollMs = 3000 }: { client: SupabaseClient; recreationId: string; pollMs?: number }) {
  const [view, setView] = useState<RecreateView | null>(null);
  const [change, setChange] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const load = () => callSheet<RecreateView>(client, { action: 'RECREATE_STATUS', recreationId }).then(setView);
  useEffect(() => { void load().catch((e: Error) => setNotice({ kind: 'error', text: e.message })); }, [client, recreationId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!recreateBusy(view)) return;
    const t = setTimeout(() => { void load().catch(() => undefined); }, pollMs);
    return () => clearTimeout(t);
  }, [view, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setNotice(undefined);
    try { await work(); } catch (e) { setNotice({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  if (!view) return <Shell>{notice ? <p role="alert">{notice.text}</p> : <p role="status">Cargando…</p>}</Shell>;
  const cost = view.takes[0]?.costMills ?? 0;

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to={`/recrear?modelo=${view.character}`}>Recrear otra</Link></p>
      <h1>Recreación · {NAMES[view.character] ?? view.character}</h1><p className="agency-lead">{PUBLIC_CHANNEL_LABEL[view.channel]} · {STYLE_LABEL[view.style]}</p></section>
    <section className="agency-section creator" aria-label="Versiones">
      <img src={view.objectiveUrl} alt="Foto objetivo" style={{ maxWidth: 200, borderRadius: 12 }} />
      <details><summary>Prompt</summary><p className="agency-meta">{view.prompt}</p></details>
      <ul className="creator-views">{Array.from({ length: view.variants }, (_, i) => i + 1).map((variant) => {
        const takes = view.takes.filter((t) => t.variant === variant);
        const pending = takes.some((t) => t.status === 'QUEUED' || t.status === 'PENDING');
        return <li key={variant} className="creator-view"><h3>Versión {variant}</h3>
          <ul className="creator-takes">{takes.map((t) => <li key={t.id} className="creator-take">
            {t.previewUrl ? <img src={t.previewUrl} alt={`Versión ${variant}, toma ${t.takeNo}`} loading="lazy" /> : <div className="talent-missing">{t.status === 'QUEUED' ? 'En espera' : STATUS_LABEL[t.status]}</div>}
            <span className="agency-meta">Toma {t.takeNo} · {t.chosen ? 'Elegida' : t.status === 'QUEUED' ? 'En espera' : STATUS_LABEL[t.status]}{t.error ? ` · ${t.error}` : ''}</span>
            {t.status === 'SUCCEEDED' && !t.chosen && <button type="button" disabled={busy} onClick={() => { void act(async () => {
              await callSheet(client, { action: 'RECREATE_CHOOSE', takeId: t.id }); setNotice({ kind: 'ok', text: 'Elegida. Ya está en el Archivo como pública.' }); await load(); }); }}>Elegir</button>}
          </li>)}</ul>
          <div className="talent-actions">
            <button type="button" disabled={busy || pending} onClick={() => { void act(async () => { setView(await callSheet<RecreateView>(client, { action: 'RECREATE_RETAKE', recreationId, variant, expectedCostMills: cost })); }); }}>{`Otra versión · ${usd(cost)}`}</button>
            <input aria-label={`Cambio para la versión ${variant}`} maxLength={300} placeholder="Cambiar: describe el ajuste" value={change[variant] ?? ''} disabled={busy} onChange={(e) => setChange((c) => ({ ...c, [variant]: e.target.value }))} />
            <button type="button" disabled={busy || pending || !change[variant]?.trim()} onClick={() => { void act(async () => {
              setView(await callSheet<RecreateView>(client, { action: 'RECREATE_RETAKE', recreationId, variant, instruction: change[variant], expectedCostMills: cost })); setChange((c) => ({ ...c, [variant]: '' })); }); }}>{`Cambiar · ${usd(cost)}`}</button>
          </div>
        </li>;
      })}</ul>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="agency-meta">{notice.text}</p>}
    </section>
  </Shell>;
}
