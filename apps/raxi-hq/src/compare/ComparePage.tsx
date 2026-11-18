import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { AgencyNav } from '../agency/AgencyNav';
import { callSheet, STATUS_LABEL, usd, type TakeStatus } from '../creator/creatorModel';
import '../talent/talent.css';
import '../creator/creator.css';

const Shell = ({ children }: { children: React.ReactNode }) => <div className="agency">
  <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
  <main className="agency-main">{children}</main></div>;
const NAMES: Record<string, string> = { 'vesper-corvus': 'Vesper Corvus', 'raxi-vox': 'Raxi Vox' };
/** Suggested scenes: close, medium and full framing, so identity is judged at three distances. Luis can edit them. */
export const SUGGESTED_SCENES: Record<string, string[]> = {
  'vesper-corvus': [
    'Close-up portrait by a rainy window at night, soft candlelight on her face, looking at the camera.',
    'Medium shot reading in an old library, warm lamp light, three-quarter angle.',
    'Full body walking on a stone bridge at dusk, long black coat, wind in her hair.',
  ],
  'raxi-vox': [
    'Close-up selfie on her bed in the morning, natural window light, playful smile.',
    'Medium shot at a gaming desk with RGB lights, headphones around her neck, laughing.',
    'Full body mirror photo in a bedroom, casual streetwear, phone in hand.',
  ],
};

interface Quote { totalMills: number; perSceneMills: number; spentMills: number; capMills: number }
interface Photo { status: TakeStatus; error: string | null; previewUrl: string | null }
interface SceneView { scene: number; text: string; vote: 'A' | 'B' | 'TIE' | null; A: Photo | null; B: Photo | null; modelA?: string; modelB?: string }
export interface TestView { testId: string; character: string; revealed: boolean; faceUrl: string; scenes: SceneView[]; tally: Record<string, number> | null }
const busyTest = (v: TestView | null) => Boolean(v?.scenes.some((s) => [s.A, s.B].some((p) => p && (p.status === 'QUEUED' || p.status === 'PENDING'))));

export function NewComparePage({ client, characterId }: { client: SupabaseClient; characterId: string }) {
  const navigate = useNavigate();
  const [scenes, setScenes] = useState<string[]>(SUGGESTED_SCENES[characterId] ?? ['']);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const clean = scenes.map((s) => s.trim()).filter(Boolean);
  const key = clean.join('\n');

  useEffect(() => {
    if (!clean.length) { setQuote(null); return; }
    let live = true;
    callSheet<Quote>(client, { action: 'MODELTEST_QUOTE', character: characterId, scenes: clean })
      .then((q) => { if (live) setQuote(q); }).catch((e: Error) => { if (live) { setQuote(null); setNotice(e.message); } });
    return () => { live = false; };
  }, [client, characterId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true); setNotice(undefined);
    try {
      const r = await callSheet<TestView>(client, { action: 'MODELTEST_START', character: characterId, scenes: clean, attestNotReal: attest, expectedTotalMills: quote!.totalMills });
      navigate(`/comparar/${r.testId}`);
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to={`/talento/${characterId}`}>{NAMES[characterId] ?? characterId}</Link></p>
      <h1>Comparar modelos</h1>
      <p className="agency-lead">La misma cara y el mismo texto van a Seedream 5.5 y a FLUX-PuLID. Ves cada par como «A» y «B» sin saber cuál es cuál, votas qué foto se parece más a {NAMES[characterId] ?? 'la modelo'} y luego revelas.</p>
      <p className="agency-meta">Solo escenas públicas. Es una prueba: estas fotos no se archivan.</p></section>
    <section className="agency-section creator" aria-label="Escenas">
      {scenes.map((s, i) => <div key={i}>
        <label htmlFor={`cmp-scene-${i}`}>Escena {i + 1}</label>
        <textarea id={`cmp-scene-${i}`} rows={2} maxLength={300} value={s} disabled={busy} onChange={(e) => setScenes((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
      </div>)}
      <div className="talent-actions">
        {scenes.length < 3 && <button type="button" disabled={busy} onClick={() => setScenes((all) => [...all, ''])}>Añadir escena</button>}
        {scenes.length > 1 && <button type="button" disabled={busy} onClick={() => setScenes((all) => all.slice(0, -1))}>Quitar la última</button>}
      </div>
      <label className="creator-attest"><input id="cmp-attest" type="checkbox" checked={attest} disabled={busy} onChange={(e) => setAttest(e.target.checked)} /> {NAMES[characterId] ?? 'La modelo'} es un personaje creado con IA y no la imagen de una persona real.</label>
      <div className="talent-actions">
        <button type="button" id="cmp-start" disabled={busy || !attest || !quote || !clean.length} onClick={() => { void start(); }}>
          {`Comparar ${clean.length === 1 ? '1 escena' : `${clean.length} escenas`}${quote ? ` · ${usd(quote.totalMills)}` : ''}`}</button>
        {quote && <span className="creator-meter">{`${usd(quote.perSceneMills)} por escena (2 fotos) · Gastado este mes: ${usd(quote.spentMills)} de ${usd(quote.capMills)}`}</span>}
      </div>
      {notice && <p role="alert" className="agency-meta">{notice}</p>}
    </section>
  </Shell>;
}

const VOTE_LABEL = { A: 'A se parece más', B: 'B se parece más', TIE: 'Igual' } as const;

export function CompareDetailPage({ client, testId, pollMs = 3000 }: { client: SupabaseClient; testId: string; pollMs?: number }) {
  const [view, setView] = useState<TestView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const load = () => callSheet<TestView>(client, { action: 'MODELTEST_STATUS', testId }).then(setView);
  useEffect(() => { void load().catch((e: Error) => setNotice(e.message)); }, [client, testId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!busyTest(view)) return;
    const t = setTimeout(() => { void load().catch(() => undefined); }, pollMs);
    return () => clearTimeout(t);
  }, [view, pollMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setNotice(undefined);
    try { setView(await callSheet<TestView>(client, { testId, ...body })); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  if (!view) return <Shell>{notice ? <p role="alert">{notice}</p> : <p role="status">Cargando…</p>}</Shell>;
  const allVoted = view.scenes.every((s) => s.vote);
  const photo = (p: Photo | null, label: string) => <div className="creator-take">
    {p?.previewUrl ? <img src={p.previewUrl} alt={`Foto ${label}`} loading="lazy" /> : <div className="talent-missing">{p ? (p.status === 'QUEUED' ? 'En espera' : STATUS_LABEL[p.status]) : 'Sin foto'}</div>}
    <span className="agency-meta">{label}{p?.error ? ` · ${p.error}` : ''}</span></div>;

  return <Shell>
    <section className="agency-hero"><p className="agency-eyebrow"><Link to={`/comparar?modelo=${view.character}`}>Otra comparación</Link></p>
      <h1>Comparar modelos · {NAMES[view.character] ?? view.character}</h1>
      <p className="agency-lead">{view.revealed ? 'Modelos revelados.' : 'Vota cada escena sin saber qué modelo hizo cada foto.'}</p></section>
    <section className="agency-section creator" aria-label="Comparación">
      <div><p className="agency-meta">Referencia (cara de la ficha general)</p><img src={view.faceUrl} alt="Cara de referencia" style={{ maxWidth: 160, borderRadius: 12 }} /></div>
      <ul className="creator-views">{view.scenes.map((s) => <li key={s.scene} className="creator-view">
        <h3>Escena {s.scene}</h3><p className="agency-meta">{s.text}</p>
        <div className="creator-takes">{photo(s.A, view.revealed ? `A · ${s.modelA}` : 'A')}{photo(s.B, view.revealed ? `B · ${s.modelB}` : 'B')}</div>
        <div className="talent-actions">{(Object.keys(VOTE_LABEL) as (keyof typeof VOTE_LABEL)[]).map((v) =>
          <button key={v} type="button" aria-pressed={s.vote === v} disabled={busy || view.revealed || !s.A?.previewUrl || !s.B?.previewUrl}
            onClick={() => { void act({ action: 'MODELTEST_VOTE', scene: s.scene, vote: v }); }}>{s.vote === v ? `✓ ${VOTE_LABEL[v]}` : VOTE_LABEL[v]}</button>)}</div>
      </li>)}</ul>
      {!view.revealed && <button type="button" id="cmp-reveal" disabled={busy || !allVoted} onClick={() => { void act({ action: 'MODELTEST_REVEAL' }); }}>Revelar modelos</button>}
      {view.tally && <p className="agency-meta" role="status">{`Resultado: ${Object.entries(view.tally).map(([k, n]) => `${k} ${n}`).join(' · ')}`}</p>}
      {notice && <p role="alert" className="agency-meta">{notice}</p>}
    </section>
  </Shell>;
}

export default function CompareRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  const [params] = useSearchParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">Comparar necesita una sesión conectada a Supabase.</p></main>;
  if (!id) {
    const modelo = params.get('modelo') ?? 'vesper-corvus';
    if (!(TALENT_ROSTER as readonly string[]).includes(modelo)) return <Navigate to="/talento" replace />;
    return <NewComparePage key={modelo} client={supabase} characterId={modelo} />;
  }
  return <CompareDetailPage key={id} client={supabase} testId={id} />;
}
