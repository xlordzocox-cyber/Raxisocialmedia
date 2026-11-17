# Conexiones seguras (clave de WaveSpeed) — Plan de implementación

> **Para quien ejecute esto:** usa `superpowers:subagent-driven-development` (o `executing-plans`) y sigue las tareas en orden. Cada paso lleva casilla `- [ ]`.
> **Estado:** PLAN PROPUESTO. No hay código escrito. Requiere el visto bueno de Luis antes de ejecutarse.

**Objetivo:** una sección "Conexiones" en Raxi HQ donde Luis pega su clave de WaveSpeed una sola vez; la clave se guarda cifrada en el servidor y nunca vuelve al navegador.

**Arquitectura:** el navegador envía la clave por HTTPS a una Edge Function (`provider-connection`) con la sesión de Luis. La función la comprueba contra WaveSpeed y la guarda en Supabase Vault mediante una RPC que solo puede llamar `service_role`. La tabla `raxi_provider_connections` guarda únicamente proveedor, últimos 4 caracteres, estado y fechas. La UI solo lee esos datos.

**Stack:** React 19 + react-router 7 (Vite), Supabase (Postgres, Vault, Edge Functions en Deno), pruebas con `node --test` + `react-test-renderer` vía `apps/raxi-hq/scripts/test.mjs`.

**Rama base:** `feat/claude-team-office` (ahí vive la app actual). Rama de trabajo: `feat/v11-conexiones`.

**Fuentes verificadas (2026-11-16):**
- Supabase Vault: `vault.create_secret(secreto, nombre, descripción)`, `vault.update_secret(id, secreto)` y la vista `vault.decrypted_secrets` — https://supabase.com/docs/guides/database/vault
- Saldo de WaveSpeed: `GET https://api.wavespeed.ai/api/v3/account/balance` con `Authorization: Bearer`, respuesta `data.balance` — https://wavespeed.ai/docs/check-balance
- **Discrepancia a resolver en la Tarea 7:** otra página de WaveSpeed documenta `GET /api/v3/balance` (https://wavespeed.ai/docs/docs-common-api/balance). El código prueba primero `/account/balance`; si responde 404, usa `/balance`.

**Nota para las pruebas:** todas las tareas añaden bloques al mismo archivo `connections.test.tsx`. Mueve siempre las líneas `import` al inicio del archivo; las constantes `ws`, `owner` y `FAKE_KEY` se declaran una sola vez.

**Reglas de seguridad que ninguna tarea puede romper:**
1. La clave nunca se escribe en `localStorage`, `sessionStorage`, URL, logs, eventos de auditoría ni respuestas HTTP.
2. Ninguna política ni `grant` da a `authenticated` o `anon` acceso a Vault ni a `secret_id`.
3. El campo del formulario se vacía al enviar, con éxito o con error.
4. Nada de claves reales en pruebas: solo cadenas sintéticas como `wsk_test_0000000000000000ABCD`.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/raxi-hq/src/connections/connectionsModel.ts` (nuevo) | Validación de la clave en el cliente y lectura validada de las filas |
| `apps/raxi-hq/src/connections/ConexionesPage.tsx` (nuevo) | Página: estado, formulario, probar, desconectar |
| `apps/raxi-hq/src/connections/ConexionesRoute.tsx` (nuevo) | Envoltura con sesión, igual que `MultimediaRoute.tsx` |
| `apps/raxi-hq/src/connections/conexiones.css` (nuevo) | Estilos de la página |
| `apps/raxi-hq/src/auth/AuthRoutes.tsx` (modificar) | Ruta protegida `/conexiones` |
| `apps/raxi-hq/src/portfolio/MultimediaPage.tsx`, `FototecaPage.tsx` (modificar) | Enlace "Conexiones" en la navegación actual |
| `supabase/migrations/20261117000000_raxi_hq_provider_connections.sql` (nuevo) | Tabla, RLS y RPCs |
| `supabase/functions/provider-connection/handler.ts` (nuevo) | Lógica con dependencias inyectadas (probada en Node) |
| `supabase/functions/provider-connection/index.ts` (nuevo) | Cableado Deno: Supabase + WaveSpeed |
| `supabase/config.toml` (modificar) | `verify_jwt = true` para la función |
| `apps/raxi-hq/tests/connections.test.tsx` (nuevo) | Pruebas de modelo, handler, migración y página |
| `apps/raxi-hq/scripts/test.mjs` (modificar) | Registrar `connections.test.tsx` |

---

### Tarea 0: Rama de trabajo

- [ ] **Paso 1: Crear la rama desde la app actual**

```bash
git fetch origin feat/claude-team-office
git switch -c feat/v11-conexiones origin/feat/claude-team-office
cd apps/raxi-hq && npm ci && npm test
```

Esperado: todas las pruebas existentes en verde. Si alguna falla antes de tocar nada, detente e informa a Luis.

---

### Tarea 1: Modelo puro de conexiones

**Archivos:**
- Crear: `apps/raxi-hq/src/connections/connectionsModel.ts`
- Crear: `apps/raxi-hq/tests/connections.test.tsx`
- Modificar: `apps/raxi-hq/scripts/test.mjs` (lista `entries`)

- [ ] **Paso 1: Escribir la prueba que falla**

`apps/raxi-hq/tests/connections.test.tsx`:

```tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConnections, validateProviderKey, PROVIDERS } from '../src/connections/connectionsModel';

const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAKE_KEY = 'wsk_test_0000000000000000ABCD';

test('connections model: key validation trims and rejects junk', () => {
  assert.equal(validateProviderKey(`  ${FAKE_KEY}\n`), FAKE_KEY);
  assert.throws(() => validateProviderKey(''), /clave/i);
  assert.throws(() => validateProviderKey('short'), /clave/i);
  assert.throws(() => validateProviderKey('has space inside 0000000000'), /clave/i);
  assert.throws(() => validateProviderKey('x'.repeat(513)), /clave/i);
});

test('connections model: rows are validated and never carry a secret', () => {
  const view = buildConnections(ws, [
    { workspace_id: ws, provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED', verified_at: '2026-11-17T01:00:00Z', updated_at: '2026-11-17T01:00:00Z' },
  ]);
  assert.deepEqual(view, [{ provider: 'WAVESPEED', label: 'WaveSpeed', last4: 'ABCD', status: 'CONNECTED', verifiedAt: '2026-11-17T01:00:00Z' }]);
  assert.deepEqual(buildConnections(ws, []), [{ provider: 'WAVESPEED', label: 'WaveSpeed', last4: null, status: 'NOT_CONNECTED', verifiedAt: null }]);
  assert.throws(() => buildConnections(ws, [{ workspace_id: 'other', provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' }]));
  assert.throws(() => buildConnections(ws, [{ workspace_id: ws, provider: 'WAVESPEED', last4: 'TOOLONG', status: 'CONNECTED' }]));
  assert.throws(() => buildConnections(ws, [{ workspace_id: ws, provider: 'OTHER', last4: 'ABCD', status: 'CONNECTED' }]));
  assert.deepEqual(PROVIDERS, ['WAVESPEED']);
});
```

En `apps/raxi-hq/scripts/test.mjs`, añade `'connections.test.tsx'` a `entries`, justo después de `'multimedia.test.tsx'`.

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: FALLA al compilar (`Could not resolve "../src/connections/connectionsModel"`).

- [ ] **Paso 3: Implementación mínima**

`apps/raxi-hq/src/connections/connectionsModel.ts`:

```ts
// Conexiones: pure, validated model. The provider secret never enters this module's output.

export const PROVIDERS = ['WAVESPEED'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type ConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'INVALID';
export const PROVIDER_LABEL: Record<Provider, string> = { WAVESPEED: 'WaveSpeed' };

export interface ConnectionView { provider: Provider; label: string; last4: string | null; status: ConnectionStatus; verifiedAt: string | null }

const STATUSES = new Set<ConnectionStatus>(['CONNECTED', 'INVALID']);

/** Client-side shape check only; the server verifies the key against the provider. */
export function validateProviderKey(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length < 16 || key.length > 512 || /\s/.test(key) || !/^[\x21-\x7e]+$/.test(key)) throw new Error('La clave no tiene un formato válido.');
  return key;
}

export function buildConnections(workspaceId: string, rawRows: unknown): ConnectionView[] {
  if (!Array.isArray(rawRows)) throw new Error('Conexiones: respuesta inválida');
  const found = new Map<Provider, ConnectionView>();
  for (const r of rawRows as Record<string, unknown>[]) {
    if (r.workspace_id !== workspaceId) throw new Error('Conexiones: fila ajena');
    if (!PROVIDERS.includes(r.provider as Provider)) throw new Error('Conexiones: proveedor inválido');
    if (typeof r.last4 !== 'string' || !/^[\x21-\x7e]{4}$/.test(r.last4)) throw new Error('Conexiones: dato inválido');
    if (!STATUSES.has(r.status as ConnectionStatus)) throw new Error('Conexiones: estado inválido');
    const provider = r.provider as Provider;
    found.set(provider, { provider, label: PROVIDER_LABEL[provider], last4: r.last4, status: r.status as ConnectionStatus, verifiedAt: typeof r.verified_at === 'string' ? r.verified_at : null });
  }
  return PROVIDERS.map((p) => found.get(p) ?? { provider: p, label: PROVIDER_LABEL[p], last4: null, status: 'NOT_CONNECTED', verifiedAt: null });
}
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: las dos pruebas nuevas en verde y ninguna regresión.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/connections/connectionsModel.ts apps/raxi-hq/tests/connections.test.tsx apps/raxi-hq/scripts/test.mjs
git commit -m "feat(conexiones): modelo validado de conexiones de proveedor"
```

---

### Tarea 2: Migración (tabla, RLS y RPCs sobre Vault)

**Archivos:**
- Crear: `supabase/migrations/20261117000000_raxi_hq_provider_connections.sql`
- Modificar: `apps/raxi-hq/tests/connections.test.tsx`

Vault no existe en PGlite, así que la prueba local es un contrato sobre el texto de la migración; la verificación real se hace en staging (Tarea 7).

- [ ] **Paso 1: Escribir la prueba que falla**

Añade a `apps/raxi-hq/tests/connections.test.tsx`:

```tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('connections migration: no client role can reach the secret', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261117000000_raxi_hq_provider_connections.sql'), 'utf8');
  assert.match(sql, /alter table public\.raxi_provider_connections enable row level security/);
  assert.match(sql, /revoke all on public\.raxi_provider_connections from anon, authenticated/);
  assert.match(sql, /grant select \(workspace_id, provider, last4, status, verified_at, updated_at\) on public\.raxi_provider_connections to authenticated/);
  for (const fn of ['raxi_connection_store', 'raxi_connection_remove', 'raxi_connection_secret']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`), fn);
  }
  assert.doesNotMatch(sql, /grant[^;]*vault[^;]*to (anon|authenticated)/i);
  assert.doesNotMatch(sql, /jsonb_build_object\([^)]*p_secret/i, 'the secret must never be written to audit details');
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: FALLA con `ENOENT` (la migración no existe).

- [ ] **Paso 3: Escribir la migración**

`supabase/migrations/20261117000000_raxi_hq_provider_connections.sql`:

```sql
-- Conexiones v1: provider API keys stored in Supabase Vault. Clients never read or write the secret.
create extension if not exists supabase_vault with schema vault;

create table public.raxi_provider_connections (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  provider text not null check (provider in ('WAVESPEED')),
  secret_id uuid not null,
  last4 text not null check (length(last4) = 4),
  status text not null check (status in ('CONNECTED','INVALID')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);
alter table public.raxi_provider_connections enable row level security;
create policy raxi_provider_connections_owner_read on public.raxi_provider_connections for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_provider_connections from anon, authenticated;
grant select (workspace_id, provider, last4, status, verified_at, updated_at) on public.raxi_provider_connections to authenticated;

-- Store or rotate a key. Called only by the provider-connection Edge Function (service_role) after it verified the key.
create or replace function public.raxi_connection_store(p_actor uuid, p_provider text, p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_secret uuid; v_last4 text;
begin
  if p_provider not in ('WAVESPEED') then raise exception 'invalid provider' using errcode = '22023'; end if;
  if p_secret is null or length(p_secret) < 16 or length(p_secret) > 512 then raise exception 'invalid secret' using errcode = '22023'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  v_last4 := right(p_secret, 4);
  select c.secret_id into v_secret from public.raxi_provider_connections c where c.workspace_id = v_ws and c.provider = p_provider for update;
  if found then
    perform vault.update_secret(v_secret, p_secret);
    update public.raxi_provider_connections set last4 = v_last4, status = 'CONNECTED', verified_at = now(), updated_at = now()
     where workspace_id = v_ws and provider = p_provider;
  else
    v_secret := vault.create_secret(p_secret, 'raxi_' || lower(p_provider) || '_' || v_ws::text, 'Raxi HQ provider key');
    insert into public.raxi_provider_connections (workspace_id, provider, secret_id, last4, status, verified_at)
     values (v_ws, p_provider, v_secret, v_last4, 'CONNECTED', now());
  end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'PROVIDER_CONNECTION_STORED', 'HUMAN', p_actor, 'raxi_provider_connections', p_provider, 'raxi-hq-conexiones', jsonb_build_object('provider', p_provider), now(), now());
  return jsonb_build_object('provider', p_provider, 'last4', v_last4, 'status', 'CONNECTED');
end $$;

create or replace function public.raxi_connection_remove(p_actor uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_secret uuid;
begin
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = p_actor and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  delete from public.raxi_provider_connections where workspace_id = v_ws and provider = p_provider returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'PROVIDER_CONNECTION_REMOVED', 'HUMAN', p_actor, 'raxi_provider_connections', p_provider, 'raxi-hq-conexiones', jsonb_build_object('provider', p_provider), now(), now());
  return jsonb_build_object('provider', p_provider, 'status', 'NOT_CONNECTED');
end $$;

-- Read the decrypted key. Server-side only: used by provider-connection (test) and, later, creation-command.
create or replace function public.raxi_connection_secret(p_actor uuid, p_provider text)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.raxi_provider_connections c
  join public.raxi_workspaces w on w.id = c.workspace_id and w.owner_user_id = p_actor and w.slug = 'raxi-hq'
  join vault.decrypted_secrets s on s.id = c.secret_id
  where c.provider = p_provider;
$$;

create or replace function public.raxi_connection_mark(p_actor uuid, p_provider text, p_status text)
returns void language sql security definer set search_path = '' as $$
  update public.raxi_provider_connections c set status = p_status, verified_at = case when p_status = 'CONNECTED' then now() else c.verified_at end, updated_at = now()
  from public.raxi_workspaces w
  where w.id = c.workspace_id and w.owner_user_id = p_actor and w.slug = 'raxi-hq' and c.provider = p_provider and p_status in ('CONNECTED','INVALID');
$$;

revoke all on function public.raxi_connection_store(uuid, text, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_remove(uuid, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.raxi_connection_mark(uuid, text, text) from public, anon, authenticated;
grant execute on function public.raxi_connection_store(uuid, text, text) to service_role;
grant execute on function public.raxi_connection_remove(uuid, text) to service_role;
grant execute on function public.raxi_connection_secret(uuid, text) to service_role;
grant execute on function public.raxi_connection_mark(uuid, text, text) to service_role;
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: `connections migration: no client role can reach the secret` en verde.

- [ ] **Paso 5: Commit**

```bash
git add supabase/migrations/20261117000000_raxi_hq_provider_connections.sql apps/raxi-hq/tests/connections.test.tsx
git commit -m "feat(conexiones): tabla y RPCs sobre Vault, sin acceso de cliente al secreto"
```

---

### Tarea 3: Lógica de la Edge Function (probada en Node)

**Archivos:**
- Crear: `supabase/functions/provider-connection/handler.ts`
- Modificar: `apps/raxi-hq/tests/connections.test.tsx`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade a `apps/raxi-hq/tests/connections.test.tsx`:

```tsx
import { createConnectionHandler, type ConnectionDependencies } from '../../../supabase/functions/provider-connection/handler';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function deps(over: Partial<ConnectionDependencies> = {}) {
  const calls: string[] = [];
  const d: ConnectionDependencies = {
    async verifyUser(token) { return token === 'good' ? { id: owner, isAnonymous: false } : token === 'anon' ? { id: owner, isAnonymous: true } : null; },
    async checkKey(_provider, key) { calls.push('check'); return key === FAKE_KEY ? 'VALID' : 'REJECTED'; },
    async store(actor, provider, key) { calls.push(`store:${actor}:${provider}:${key.length}`); return { provider, last4: key.slice(-4), status: 'CONNECTED' }; },
    async readKey() { calls.push('read'); return FAKE_KEY; },
    async mark(_a, _p, status) { calls.push(`mark:${status}`); },
    async remove(actor, provider) { calls.push(`remove:${actor}:${provider}`); return { provider, status: 'NOT_CONNECTED' }; },
    ...over,
  };
  return { d, calls };
}
const post = (body: unknown, token = 'good') => new Request('https://x/functions/v1/provider-connection', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('connection handler: auth is required and anonymous users are rejected', async () => {
  const { d, calls } = deps();
  const h = createConnectionHandler(d);
  assert.equal((await h(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }, 'bad'))).status, 401);
  assert.equal((await h(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }, 'anon'))).status, 401);
  assert.equal((await h(new Request('https://x', { method: 'GET' }))).status, 405);
  assert.deepEqual(calls, []);
});

test('connection handler: SET verifies first, stores, and never echoes the key', async () => {
  const { d, calls } = deps();
  const res = await createConnectionHandler(d)(post({ action: 'SET', provider: 'WAVESPEED', key: `  ${FAKE_KEY} ` }));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' });
  assert.ok(!text.includes(FAKE_KEY));
  assert.deepEqual(calls, ['check', `store:${owner}:WAVESPEED:${FAKE_KEY.length}`]);
});

test('connection handler: a rejected or unverifiable key is not stored', async () => {
  const a = deps();
  const bad = await createConnectionHandler(a.d)(post({ action: 'SET', provider: 'WAVESPEED', key: 'wsk_test_0000000000000000XXXX' }));
  assert.equal(bad.status, 422);
  assert.deepEqual(a.calls, ['check']);
  const b = deps({ async checkKey() { return 'UNAVAILABLE'; } });
  assert.equal((await createConnectionHandler(b.d)(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }))).status, 503);
  assert.deepEqual(b.calls, []);
});

test('connection handler: invalid bodies are rejected without side effects', async () => {
  const { d, calls } = deps();
  const h = createConnectionHandler(d);
  for (const body of [{}, { action: 'SET', provider: 'OTHER', key: FAKE_KEY }, { action: 'SET', provider: 'WAVESPEED', key: 'short' }, { action: 'NOPE', provider: 'WAVESPEED' }, { action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY, extra: 1 }]) {
    assert.equal((await h(post(body))).status, 400);
  }
  assert.deepEqual(calls, []);
});

test('connection handler: TEST re-checks the stored key and REMOVE deletes it', async () => {
  const ok = deps();
  const t = await createConnectionHandler(ok.d)(post({ action: 'TEST', provider: 'WAVESPEED' }));
  assert.deepEqual(await t.json(), { provider: 'WAVESPEED', status: 'CONNECTED' });
  assert.deepEqual(ok.calls, ['read', 'check', 'mark:CONNECTED']);
  const none = deps({ async readKey() { return null; } });
  assert.equal((await createConnectionHandler(none.d)(post({ action: 'TEST', provider: 'WAVESPEED' }))).status, 404);
  const rm = deps();
  assert.deepEqual(await (await createConnectionHandler(rm.d)(post({ action: 'REMOVE', provider: 'WAVESPEED' }))).json(), { provider: 'WAVESPEED', status: 'NOT_CONNECTED' });
  assert.deepEqual(rm.calls, [`remove:${owner}:WAVESPEED`]);
});

test('connection handler: internal errors never leak details or the key', async () => {
  const { d } = deps({ async store() { throw new Error(`boom ${FAKE_KEY}`); } });
  const res = await createConnectionHandler(d)(post({ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }));
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.ok(!text.includes(FAKE_KEY) && !text.includes('boom'));
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: FALLA al compilar (`Could not resolve ".../provider-connection/handler"`).

- [ ] **Paso 3: Implementación mínima**

`supabase/functions/provider-connection/handler.ts`:

```ts
// provider-connection: stores, tests and removes a provider API key for the signed-in owner.
// No Deno or npm imports here so the same file is unit-tested under Node. The key is never logged or returned.

export type KeyCheck = 'VALID' | 'REJECTED' | 'UNAVAILABLE';
export interface ConnectionDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  checkKey(provider: string, key: string): Promise<KeyCheck>;
  store(actorId: string, provider: string, key: string): Promise<unknown>;
  readKey(actorId: string, provider: string): Promise<string | null>;
  mark(actorId: string, provider: string, status: 'CONNECTED' | 'INVALID'): Promise<void>;
  remove(actorId: string, provider: string): Promise<unknown>;
}

const PROVIDERS = new Set(['WAVESPEED']);
const ACTION_KEYS: Record<string, string[]> = { SET: ['action', 'key', 'provider'], TEST: ['action', 'provider'], REMOVE: ['action', 'provider'] };

export function createConnectionHandler(dependencies: ConnectionDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, { error: 'Sesión requerida.' });
    try {
      const user = await dependencies.verifyUser(token);
      if (!user || user.isAnonymous) return reply(401, { error: 'Sesión no válida.' });
      let body: Record<string, unknown>;
      try {
        const text = await request.text();
        if (text.length > 4096) return reply(413, { error: 'Solicitud demasiado grande.' });
        body = JSON.parse(text);
      } catch { return reply(400, { error: 'Solicitud inválida.' }); }
      const action = typeof body?.action === 'string' ? body.action : '';
      const expected = ACTION_KEYS[action];
      if (!expected || Object.keys(body).sort().join() !== expected.join() || !PROVIDERS.has(body.provider as string)) return reply(400, { error: 'Solicitud inválida.' });
      const provider = body.provider as string;

      if (action === 'SET') {
        const key = typeof body.key === 'string' ? body.key.trim() : '';
        if (key.length < 16 || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) return reply(400, { error: 'Solicitud inválida.' });
        const check = await dependencies.checkKey(provider, key);
        if (check === 'UNAVAILABLE') return reply(503, { error: 'No se pudo comprobar la clave con el proveedor. No se guardó nada.' });
        if (check === 'REJECTED') return reply(422, { error: 'El proveedor rechazó la clave. No se guardó nada.' });
        return reply(200, await dependencies.store(user.id, provider, key));
      }
      if (action === 'TEST') {
        const key = await dependencies.readKey(user.id, provider);
        if (!key) return reply(404, { error: 'No hay una clave guardada.' });
        const check = await dependencies.checkKey(provider, key);
        if (check === 'UNAVAILABLE') return reply(503, { error: 'No se pudo comprobar la clave con el proveedor.' });
        const status = check === 'VALID' ? 'CONNECTED' : 'INVALID';
        await dependencies.mark(user.id, provider, status);
        return reply(200, { provider, status });
      }
      return reply(200, await dependencies.remove(user.id, provider));
    } catch {
      return reply(503, { error: 'No se pudo completar la operación. No se confirmó ningún cambio.' });
    }
  };
}
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: las seis pruebas `connection handler: …` en verde.

- [ ] **Paso 5: Commit**

```bash
git add supabase/functions/provider-connection/handler.ts apps/raxi-hq/tests/connections.test.tsx
git commit -m "feat(conexiones): handler de provider-connection que nunca devuelve la clave"
```

---

### Tarea 4: Cableado Deno de la función

**Archivos:**
- Crear: `supabase/functions/provider-connection/index.ts`
- Modificar: `supabase/config.toml`

Este archivo no se ejecuta en Node; se valida con `tsc` vía la compilación existente y en staging (Tarea 7).

- [ ] **Paso 1: Escribir el cableado**

`supabase/functions/provider-connection/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createConnectionHandler, type KeyCheck } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

// Verified 2026-11-16: https://wavespeed.ai/docs/check-balance documents /account/balance;
// https://wavespeed.ai/docs/docs-common-api/balance documents /balance. Try the first, fall back on 404.
const BALANCE_URLS = ['https://api.wavespeed.ai/api/v3/account/balance', 'https://api.wavespeed.ai/api/v3/balance'];

async function checkWaveSpeed(key: string): Promise<KeyCheck> {
  for (const endpoint of BALANCE_URLS) {
    let res: Response;
    try { res = await fetch(endpoint, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { return 'UNAVAILABLE'; }
    await res.body?.cancel();
    if (res.ok) return 'VALID';
    if (res.status === 401 || res.status === 403) return 'REJECTED';
    if (res.status !== 404) return 'UNAVAILABLE';
  }
  return 'UNAVAILABLE';
}

Deno.serve(createConnectionHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async checkKey(_provider, key) { return checkWaveSpeed(key); },
  async store(actor, provider, key) { const { data, error } = await server.rpc('raxi_connection_store', { p_actor: actor, p_provider: provider, p_secret: key }); if (error || !data) throw new Error('store failed'); return data; },
  async readKey(actor, provider) { const { data, error } = await server.rpc('raxi_connection_secret', { p_actor: actor, p_provider: provider }); if (error) throw new Error('read failed'); return typeof data === 'string' && data ? data : null; },
  async mark(actor, provider, status) { const { error } = await server.rpc('raxi_connection_mark', { p_actor: actor, p_provider: provider, p_status: status }); if (error) throw new Error('mark failed'); },
  async remove(actor, provider) { const { data, error } = await server.rpc('raxi_connection_remove', { p_actor: actor, p_provider: provider }); if (error || !data) throw new Error('remove failed'); return data; },
}));
```

- [ ] **Paso 2: Exigir JWT en la función**

En `supabase/config.toml`, añade al final:

```toml
[functions.provider-connection]
verify_jwt = true
```

- [ ] **Paso 3: Comprobar que nada se rompió**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | tail -5
```

Esperado: sin errores de tipos y todas las pruebas en verde.

- [ ] **Paso 4: Commit**

```bash
git add supabase/functions/provider-connection/index.ts supabase/config.toml
git commit -m "feat(conexiones): cableado Deno con comprobación de saldo en WaveSpeed"
```

---

### Tarea 5: Página Conexiones

**Archivos:**
- Crear: `apps/raxi-hq/src/connections/ConexionesPage.tsx`, `ConexionesRoute.tsx`, `conexiones.css`
- Modificar: `apps/raxi-hq/tests/connections.test.tsx`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade a `apps/raxi-hq/tests/connections.test.tsx`:

```tsx
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConexionesPage } from '../src/connections/ConexionesPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function fakeClient(rows: unknown[], invoke: (body: unknown) => { data?: unknown; error?: unknown }) {
  const sent: unknown[] = [];
  const client = {
    rpc: async () => ({ data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }),
    from: () => ({ select: () => ({ eq: async () => ({ data: rows, error: null }) }) }),
    functions: { invoke: async (_name: string, opts: { body: unknown }) => { sent.push(opts.body); return invoke(opts.body); } },
  } as unknown as SupabaseClient;
  return { client, sent };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const textOf = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());

test('Conexiones page: shows not-connected, saves once, clears the field, never renders the key', async () => {
  const { client, sent } = fakeClient([], () => ({ data: { provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED' }, error: null }));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  assert.match(textOf(r), /Sin conectar/);
  const input = r.root.findByProps({ id: 'wavespeed-key' });
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.autoComplete, 'off');
  await act(async () => { input.props.onChange({ target: { value: FAKE_KEY } }); });
  await act(async () => { r.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.deepEqual(sent, [{ action: 'SET', provider: 'WAVESPEED', key: FAKE_KEY }]);
  assert.equal(r.root.findByProps({ id: 'wavespeed-key' }).props.value, '');
  assert.ok(!textOf(r).includes(FAKE_KEY));
});

test('Conexiones page: connected state shows only the last four and offers test and disconnect', async () => {
  const { client, sent } = fakeClient(
    [{ workspace_id: ws, provider: 'WAVESPEED', last4: 'ABCD', status: 'CONNECTED', verified_at: '2026-11-17T01:00:00Z', updated_at: '2026-11-17T01:00:00Z' }],
    (body) => ({ data: { provider: 'WAVESPEED', status: (body as { action: string }).action === 'TEST' ? 'CONNECTED' : 'NOT_CONNECTED' }, error: null }),
  );
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  assert.match(textOf(r), /Conectada/);
  assert.match(textOf(r), /ABCD/);
  const button = (label: string) => r.root.findAllByType('button').find((b) => b.children.join('') === label)!;
  await act(async () => { button('Probar conexión').props.onClick(); });
  await flush();
  assert.deepEqual(sent, [{ action: 'TEST', provider: 'WAVESPEED' }]);
});

test('Conexiones page: an invalid key shows an error and still clears the field', async () => {
  const { client } = fakeClient([], () => ({ data: null, error: { message: 'rejected' } }));
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><ConexionesPage client={client} ownerId={owner} /></MemoryRouter>); });
  await flush();
  await act(async () => { r.root.findByProps({ id: 'wavespeed-key' }).props.onChange({ target: { value: FAKE_KEY } }); });
  await act(async () => { r.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  await flush();
  assert.equal(r.root.findByProps({ id: 'wavespeed-key' }).props.value, '');
  assert.ok(r.root.findAllByProps({ role: 'alert' }).length > 0);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: FALLA al compilar (`Could not resolve "../src/connections/ConexionesPage"`).

- [ ] **Paso 3: Implementación**

`apps/raxi-hq/src/connections/ConexionesPage.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
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
      <nav aria-label="Secciones" className="hq-session-controls"><Link to="/fototeca">Fototeca</Link><Link to="/multimedia">Multimedia</Link><Link to="/">Oficina</Link></nav>
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
```

`apps/raxi-hq/src/connections/ConexionesRoute.tsx`:

```tsx
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { ConexionesPage } from './ConexionesPage';

export default function ConexionesRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="conexiones"><p role="alert">Conexiones necesita una sesión conectada a Supabase.</p></main>;
  return <ConexionesPage key={user.id} client={supabase} ownerId={user.id} />;
}
```

`apps/raxi-hq/src/connections/conexiones.css` (solo variables existentes de `tokens.css`; el rediseño las migrará):

```css
.conexiones { min-height: 100vh; background: var(--bg); color: var(--ink); padding: 24px 16px 48px; }
.conexiones-header, .conexion-card { max-width: 640px; margin: 0 auto; }
.conexiones-eyebrow, .conexion-meta { color: var(--muted); font-size: 13px; margin: 0; }
.conexiones-header h1 { margin: 4px 0 8px; font-size: 28px; }
.conexion-card { margin-top: 24px; padding: 20px; background: var(--panel); border: 1px solid var(--muted); border-radius: 12px; display: grid; gap: 12px; }
.conexion-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.conexion-head h2 { margin: 0; font-size: 20px; }
.conexion-status { font-size: 13px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--muted); }
.conexion-connected { border-color: var(--accent); color: var(--accent); }
.conexion-card form { display: grid; gap: 8px; }
.conexion-card input { min-height: 44px; padding: 10px; background: var(--bg); color: var(--ink); border: 1px solid var(--muted); border-radius: 8px; font: inherit; }
.conexion-card button { min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--accent); background: transparent; color: var(--accent); font: inherit; cursor: pointer; }
.conexion-card button[type='submit'] { background: var(--accent); color: var(--bg); font-weight: 600; }
.conexion-card button:disabled { opacity: 0.5; cursor: not-allowed; }
.conexion-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.conexion-notice { margin: 0; font-size: 14px; }
.conexion-notice-ok { color: var(--accent); }
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -20
```

Esperado: las tres pruebas `Conexiones page: …` en verde.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/connections apps/raxi-hq/tests/connections.test.tsx
git commit -m "feat(conexiones): página para guardar, probar y desconectar la clave de WaveSpeed"
```

---

### Tarea 6: Ruta y navegación

**Archivos:**
- Modificar: `apps/raxi-hq/src/auth/AuthRoutes.tsx`
- Modificar: `apps/raxi-hq/src/portfolio/MultimediaPage.tsx` (línea con `hq-session-controls`)
- Modificar: `apps/raxi-hq/src/portfolio/FototecaPage.tsx` (su bloque equivalente de enlaces)

- [ ] **Paso 1: Registrar la ruta protegida**

En `apps/raxi-hq/src/auth/AuthRoutes.tsx`, bajo la línea `const Multimedia = lazy(...)`, añade:

```tsx
const Conexiones = lazy(() => import('../connections/ConexionesRoute'));
```

y bajo la ruta `/multimedia`:

```tsx
      <Route path="/conexiones" element={<Suspense fallback={<Loading />}><Conexiones /></Suspense>} />
```

- [ ] **Paso 2: Enlazarla desde la navegación actual**

En `MultimediaPage.tsx`, cambia

```tsx
<div className="hq-session-controls"><Link to="/fototeca">Fototeca</Link><Link to="/">Oficina</Link></div>
```

por

```tsx
<div className="hq-session-controls"><Link to="/fototeca">Fototeca</Link><Link to="/conexiones">Conexiones</Link><Link to="/">Oficina</Link></div>
```

Haz el cambio equivalente en el bloque `hq-session-controls` de `FototecaPage.tsx` (añade `<Link to="/conexiones">Conexiones</Link>` antes del enlace a Oficina). No toques nada más de esas páginas.

- [ ] **Paso 3: Verificar**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | tail -5 && npm run build 2>&1 | tail -3
```

Esperado: tipos, pruebas (incluidas `fototeca` y `multimedia`) y build en verde.

- [ ] **Paso 4: Commit**

```bash
git add apps/raxi-hq/src/auth/AuthRoutes.tsx apps/raxi-hq/src/portfolio/MultimediaPage.tsx apps/raxi-hq/src/portfolio/FototecaPage.tsx
git commit -m "feat(conexiones): ruta protegida /conexiones y enlaces de navegación"
```

---

### Tarea 7: Staging y aceptación (requiere a Luis)

Nada de esta tarea se ejecuta sin la autorización explícita de Luis. Solo staging (`zvhxjindgyvtasstfjut`), nunca producción.

- [ ] **Paso 1: Aplicar la migración en staging** y comprobar que `supabase_vault` quedó disponible.
- [ ] **Paso 2: Desplegar `provider-connection` en staging** con `verify_jwt = true`.
- [ ] **Paso 3: Revisar los advisors de seguridad de Supabase.** Esperado: ningún aviso nuevo sobre `raxi_provider_connections` ni sobre las cuatro funciones.
- [ ] **Paso 4: Prueba negativa con la sesión de Luis en la consola del navegador:**

```js
await supabase.from('raxi_provider_connections').select('secret_id');   // esperado: error de permisos
await supabase.rpc('raxi_connection_secret', { p_actor: (await supabase.auth.getUser()).data.user.id, p_provider: 'WAVESPEED' }); // esperado: error de permisos
```

- [ ] **Paso 5: Luis crea una clave nueva de WaveSpeed solo para Raxi HQ** y la pega en `/conexiones` del despliegue de staging. Esperado: "Conectada" y solo los últimos 4 caracteres visibles.
- [ ] **Paso 6: Anotar cuál de los dos endpoints de saldo respondió** (ver "Fuentes verificadas") y dejar solo ese en `BALANCE_URLS`, con su prueba en verde.
- [ ] **Paso 7: Probar "Probar conexión" y "Desconectar"**, y confirmar en `raxi_audit_events` que hay dos eventos sin rastro de la clave.
- [ ] **Paso 8: Abrir el PR** `feat/v11-conexiones` → `feat/claude-team-office` con el resultado de los pasos 3 a 7.

---

## Autorrevisión del plan

- **Cobertura:** guardar, probar, rotar (guardar de nuevo) y desconectar están en las Tareas 2, 3 y 5; la lectura del secreto por el servidor (`raxi_connection_secret`) queda lista para `creation-command`.
- **Fuera de este plan (YAGNI):** otros proveedores, topes de gasto, generación de imágenes, el estilo de agencia (lo aplicará el plan de rediseño sobre esta misma página).
- **Riesgo conocido:** la clave viaja como parámetro de la RPC hacia Postgres. Antes de la Tarea 7 hay que confirmar en staging que el registro de sentencias no guarda parámetros; si lo hace, se desactiva para esas funciones o se detiene el despliegue.
- **Consistencia de nombres:** `raxi_connection_store/remove/secret/mark`, `provider-connection`, `ConexionesPage`, `connectionsModel` se usan igual en todas las tareas.
