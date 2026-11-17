import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { AgencyNav } from '../agency/AgencyNav';
import { ANGLE_LABEL, SHEET_VIEWS, gridAngles, buildTalentProfile, canLock, splitLines, type Angle, type RefLevel, type TalentProfile } from './talentModel';
import './talent.css';

const BUCKET = 'raxi-hq-private';
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; profile: TalentProfile; urls: Record<string, string> };

/** Owner-only reads (RLS). Writes go only through the talent-reference function and the two identity RPCs. */
export async function loadTalent(client: SupabaseClient, ownerId: string, characterId: string) {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const [v, a] = await Promise.all([
    client.from('raxi_identity_versions').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_assets').select('id,workspace_id,kind,object_path,sha256,metadata,created_at').eq('workspace_id', workspaceId),
  ]);
  if (v.error || a.error) throw new Error(v.error?.code === '42P01' ? 'Talento aún no está instalado en esta base.' : 'No se pudo leer la ficha.');
  const profile = buildTalentProfile(workspaceId, characterId, v.data, a.data);
  const urls: Record<string, string> = {};
  if (profile.references.length) {
    const { data } = await client.storage.from(BUCKET).createSignedUrls(profile.references.map((r) => r.objectPath), 60 * 30);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  return { profile, urls };
}

export function TalentProfilePage({ client, ownerId, characterId }: { client: SupabaseClient; ownerId: string; characterId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [text, setText] = useState(''); const [marks, setMarks] = useState(''); const [accessories, setAccessories] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [file, setFile] = useState<Blob | null>(null); const [angle, setAngle] = useState<Angle>('FRONT'); const [level, setLevel] = useState<RefLevel>('GENERAL');
  const [nsfw, setNsfw] = useState(false); // off by default: the adult sheet is only shown when Luis turns it on
  const [busy, setBusy] = useState(false); const [confirmLock, setConfirmLock] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const reload = useCallback(async () => {
    try {
      const r = await loadTalent(client, ownerId, characterId);
      const base = r.profile.draft ?? r.profile.locked;
      setText(base?.identityText ?? ''); setMarks((base?.marks ?? []).join('\n')); setAccessories((base?.accessories ?? []).join('\n'));
      const visible = new Set(r.profile.references.filter((x) => x.angle !== 'SOURCE').map((x) => x.id));
      setSelected((base?.referenceIds ?? [...visible]).filter((id) => visible.has(id)));
      setState({ phase: 'ready', ...r });
    } catch (cause) { setState({ phase: 'error', message: cause instanceof Error ? cause.message : 'No se pudo leer la ficha.' }); }
  }, [client, ownerId, characterId]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (work: () => PromiseLike<{ error: unknown }>, ok: string, fail: string) => {
    setBusy(true); setNotice(undefined);
    try { const { error } = await work(); if (error) throw new Error(fail); setNotice({ kind: 'ok', text: ok }); }
    catch { setNotice({ kind: 'error', text: fail }); }
    finally { setBusy(false); setConfirmLock(false); await reload(); }
  };

  async function uploadReference(event: FormEvent) {
    event.preventDefault();
    if (!file) { setNotice({ kind: 'error', text: 'Elige una imagen.' }); return; }
    const body = new FormData();
    body.set('character', characterId); body.set('angle', angle); body.set('level', level); body.set('file', file);
    await run(() => client.functions.invoke('talent-reference', { body }), 'Referencia guardada.', 'No se pudo guardar la referencia.');
    setFile(null);
  }

  if (state.phase !== 'ready') return <div className="agency"><header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">{state.phase === 'loading' ? <p role="status">Cargando la ficha…</p> : <p role="alert">{state.message}</p>}</main></div>;

  const { profile, urls } = state;
  const status = profile.locked ? `Identidad v${profile.locked.version} bloqueada` : 'Sin identidad todavía';
  const lockable = canLock({ ...profile, draft: profile.draft && { ...profile.draft, identityText: text, referenceIds: selected } });

  return <div className="agency">
    <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">
      <section className="agency-hero"><p className="agency-eyebrow"><Link to="/talento">Talento</Link></p><h1>{profile.name}</h1>
        <p className="agency-lead">{status}{profile.draft ? ` · borrador v${profile.draft.version} sin bloquear` : ''}</p>
        <p><Link className="talent-create" to={`/talento/${characterId}/creador`}>Crear ficha 360</Link></p></section>

      <section aria-labelledby="t-360" className="agency-section">
        <div className="talent-sheet-head"><h2 id="t-360">Ficha 360 · {nsfw ? 'adulta' : 'general'}</h2>
          <label className="talent-switch"><input id="nsfw-switch" type="checkbox" role="switch" checked={nsfw} onChange={(e) => setNsfw(e.target.checked)} /> NSFW</label></div>
        <ul className="talent-angles">
          {gridAngles(profile.references.filter((r) => r.level === (nsfw ? 'ADULT' : 'GENERAL')), nsfw).map((a) => {
            const refs = profile.references.filter((r) => r.angle === a && r.level === (nsfw ? 'ADULT' : 'GENERAL'));
            return <li key={a} className="talent-angle"><h3>{ANGLE_LABEL[a]}</h3>
              {refs.length === 0 ? <div className="talent-missing">Falta</div> : refs.map((r) => <label key={r.id} className="talent-ref">
                {urls[r.objectPath] ? <img src={urls[r.objectPath]} alt={`${profile.name}, ${ANGLE_LABEL[a].toLowerCase()}`} loading="lazy" /> : <div className="talent-missing">Sin vista previa</div>}
                <span><input type="checkbox" checked={selected.includes(r.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} /> Usar en la identidad</span>
              </label>)}
            </li>;
          })}
        </ul>
        <form className="talent-upload" aria-label="Subir referencia" onSubmit={uploadReference}>
          <label htmlFor="ref-file">Imagen (JPG, PNG o WebP, hasta 15 MB)</label>
          <input id="ref-file" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <label htmlFor="ref-angle">Ángulo</label>
          <select id="ref-angle" value={angle} disabled={busy} onChange={(e) => setAngle(e.target.value as Angle)}>
            {SHEET_VIEWS.map((a) => <option key={a} value={a}>{ANGLE_LABEL[a]}</option>)}
          </select>
          <label htmlFor="ref-level">Tipo de ficha</label>
          <select id="ref-level" value={level} disabled={busy} onChange={(e) => setLevel(e.target.value as RefLevel)}>
            <option value="GENERAL">General · con ropa</option>
            <option value="ADULT">Adulta · NSFW, solo Fanvue</option>
          </select>
          <button type="submit" disabled={busy}>Subir referencia</button>
        </form>
      </section>

      <section aria-labelledby="t-id" className="agency-section">
        <h2 id="t-id">Identidad</h2>
        <label htmlFor="identity-text">Texto de identidad (lo que Producción antepone a cada foto)</label>
        <textarea id="identity-text" rows={6} maxLength={4000} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
        <label htmlFor="identity-marks">Marcas distintivas (una por línea)</label>
        <textarea id="identity-marks" rows={3} value={marks} disabled={busy} onChange={(e) => setMarks(e.target.value)} />
        <label htmlFor="identity-accessories">Accesorios de firma (uno por línea)</label>
        <textarea id="identity-accessories" rows={3} value={accessories} disabled={busy} onChange={(e) => setAccessories(e.target.value)} />
        <div className="talent-actions">
          <button type="button" disabled={busy} onClick={() => { void run(() => client.rpc('raxi_identity_save_draft', { p_character: characterId, p_text: text, p_marks: splitLines(marks), p_accessories: splitLines(accessories), p_refs: selected }), 'Borrador guardado.', 'No se pudo guardar el borrador.'); }}>Guardar borrador</button>
          {profile.draft && <button type="button" disabled={busy || !lockable} onClick={() => setConfirmLock(true)}>{`Bloquear versión ${profile.draft.version}`}</button>}
        </div>
        {profile.draft && !lockable && <p className="agency-meta">Para bloquear: guarda un texto de al menos 20 caracteres y marca una referencia general de frente.</p>}
        {confirmLock && profile.draft && <div className="talent-confirm" role="alertdialog" aria-label="Confirmar bloqueo">
          <p>Al bloquear la versión {profile.draft.version}, su texto reemplaza el prompt fijo que Producción usa hoy con Aria para {profile.name}.</p>
          <button type="button" disabled={busy} onClick={() => { void run(() => client.rpc('raxi_identity_lock', { p_character: characterId, p_version: profile.draft!.version }), 'Identidad bloqueada.', 'No se pudo bloquear.'); }}>Sí, bloquear</button>
          <button type="button" disabled={busy} onClick={() => setConfirmLock(false)}>Cancelar</button>
        </div>}
        {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className="agency-meta">{notice.text}</p>}
      </section>

      {profile.history.length > 0 && <section aria-labelledby="t-hist" className="agency-section">
        <h2 id="t-hist">Versiones</h2>
        <ul className="talent-history">{profile.history.map((h) => <li key={h.version}>v{h.version} · {h.status === 'LOCKED' ? 'Bloqueada' : 'Borrador'} · {h.referenceIds.length} referencias</li>)}</ul>
      </section>}
    </main>
  </div>;
}
