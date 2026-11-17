import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AgencyNav } from '../agency/AgencyNav';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { buildConnections, validateProviderKey, type ConnectionView } from './connectionsModel';
import './conexiones.css';

type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; rows: ConnectionView[] };
const STATUS_LABEL = { NOT_CONNECTED: 'Sin conectar', CONNECTED: 'Conectada', INVALID: 'Clave rechazada' } as const;

/** Owner-only read of non-secret columns (RLS + column grants). The key itself is never readable here. */
export async function loadConnections(client: SupabaseClient, ownerId: string): Promise<ConnectionView[]> {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const res = await client.from('raxi_provider_connections').select('workspace_id,provider,last4,status,verified_at,updated_at').eq('workspace_id', workspaceId);
  if (res.error) throw new Error('No se pudieron leer las conexiones.');
  return buildConnections(workspaceId, res.data);
}

export function ConexionesPage({ client, ownerId }: { client: SupabaseClient; ownerId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const reload = useCallback(async () => {
    try { setState({ phase: 'ready', rows: await loadConnections(client, ownerId) }); }
    catch (cause) { setState({ phase: 'error', message: cause instanceof Error ? cause.message : 'No se pudieron leer las conexiones.' }); }
  }, [client, ownerId]);
  useEffect(() => { void reload(); }, [reload]);

  const call = useCallback(async (body: Record<string, string>, ok: string, fail: string) => {
    setBusy(true); setNotice(undefined);
    try {
      const { data, error } = await client.functions.invoke('provider-connection', { body });
      if (error || !data) throw new Error(fail);
      setNotice({ kind: 'ok', text: ok });
    } catch { setNotice({ kind: 'error', text: fail }); }
    finally { setBusy(false); await reload(); }
  }, [client, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const typed = key;
    setKey(''); // the field is cleared before anything else can fail
    let valid: string;
    try { valid = validateProviderKey(typed); }
    catch (cause) { setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : 'La clave no es válida.' }); return; }
    await call({ action: 'SET', provider: 'WAVESPEED', key: valid }, 'Clave guardada y comprobada.', 'WaveSpeed no aceptó la clave o no se pudo comprobar. No se guardó nada.');
  }

  return <main className="conexiones">
    <header className="conexiones-header">
      <p className="conexiones-eyebrow">Raxi HQ</p>
      <h1>Conexiones</h1>
      <p>Las claves se guardan cifradas en el servidor. Nunca vuelven a este navegador.</p>
      <AgencyNav />
    </header>
    {state.phase === 'loading' && <p role="status">Cargando conexiones…</p>}
    {state.phase === 'error' && <p role="alert">{state.message}</p>}
    {state.phase === 'ready' && state.rows.map((row) => <section key={row.provider} className="conexion-card" aria-labelledby={`c-${row.provider}`}>
      <div className="conexion-head">
        <h2 id={`c-${row.provider}`}>{row.label}</h2>
        <span className={`conexion-status conexion-${row.status.toLowerCase()}`}>{STATUS_LABEL[row.status]}</span>
      </div>
      <p className="conexion-meta">{row.last4 ? `Clave que termina en ${row.last4}` : 'Genera las fotos de continuidad del Módulo de Creación.'}</p>
      <form onSubmit={submit}>
        <label htmlFor="wavespeed-key">{row.last4 ? 'Reemplazar la clave' : 'Clave de API'}</label>
        <input id="wavespeed-key" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} />
        <button type="submit" disabled={busy || key.length === 0}>{busy ? 'Comprobando…' : 'Guardar y comprobar'}</button>
      </form>
      {row.last4 && <div className="conexion-actions">
        <button type="button" disabled={busy} onClick={() => { void call({ action: 'TEST', provider: 'WAVESPEED' }, 'La clave sigue funcionando.', 'No se pudo comprobar la clave.'); }}>Probar conexión</button>
        <button type="button" disabled={busy} onClick={() => { void call({ action: 'REMOVE', provider: 'WAVESPEED' }, 'Clave eliminada.', 'No se pudo eliminar la clave.'); }}>Desconectar</button>
      </div>}
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`conexion-notice conexion-notice-${notice.kind}`}>{notice.text}</p>}
    </section>)}
  </main>;
}
