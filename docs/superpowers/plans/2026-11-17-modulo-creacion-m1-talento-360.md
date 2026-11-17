# Módulo de Creación — M1: Perfiles de talento e identidad 360 — Plan de implementación

> **Para quien ejecute esto:** usa `superpowers:subagent-driven-development` (o `executing-plans`) y sigue las tareas en orden. Cada paso lleva casilla `- [ ]`.
> **Estado:** PLAN PROPUESTO. No hay código escrito. Requiere el visto bueno de Luis antes de ejecutarse.

## Hoja de ruta del Módulo de Creación

El módulo se entrega en tres planes. Cada uno deja la app funcionando.

| Plan | Qué entrega | Gasta dinero | Depende de |
|---|---|---|---|
| **M1 (este)** | Página Talento con ficha 360 por modelo, texto de identidad versionado y bloqueo por Luis | No | Conexiones, Rediseño Fase 1 |
| M2 | Fotos de continuidad con WaveSpeed dentro del pipeline actual: foto base de Aria, fotos 2..N con referencias, orden de serie, libro de costos y tope de $10/mes | Sí, con aprobación por serie | M1 + clave de Conexiones |
| M3 | MCP `raxi-creation` para que Claude y Codex operen el módulo | Solo a través de M2 | M2 |

**Hechos verificados en `feat/claude-team-office` y en staging (2026-11-17) que este plan respeta:**
- `raxi_assets.kind` ya admite `'REFERENCE'`; hoy todos los assets de staging son `ORIGINAL`.
- `raxi_character_profiles.fixed_prompt` es el prompt fijo que Producción antepone a cada foto de Aria (`raxi-agent-runner`, línea ~411). Hoy solo existe el de `vesper-corvus` (632 caracteres).
- El bucket `raxi-hq-private` es privado (50 MB por archivo) y solo tiene política de lectura para el dueño; las escrituras pasan por funciones con `service_role`, como `raxi-archive-aria`.
- En staging, Raxi no tiene campañas ni fotos; Vesper tiene 3 campañas y 45 imágenes.

## Objetivo de M1

Cada modelo tiene una ficha profesional en `/talento/:id`: referencias 360 subidas por Luis (solo con ropa), texto de identidad, marcas distintivas y accesorios de firma, en versiones. Luis bloquea una versión; al bloquearla, su texto pasa a ser el prompt fijo que Producción ya usa con Aria.

**Arquitectura:** las imágenes se suben por la Edge Function `talent-reference` (sesión obligatoria, valida tipo real y tamaño, calcula sha256, guarda en el bucket privado y registra `raxi_assets` con `kind = 'REFERENCE'`). Las versiones viven en `raxi_identity_versions`; solo se escriben con dos RPCs que comprueban que quien llama es el dueño. Multimedia y la portada excluyen las referencias.

**Stack:** igual que Conexiones (React 19, Supabase, Edge Functions en Deno, `node --test`).

**Rama base:** `feat/v11-agencia`. Rama de trabajo: `feat/v11-talento`.

**Reglas que ninguna tarea puede romper:**
1. Solo fichas con ropa: la subida exige que Luis lo confirme y `AGENTS.md` (contenido no explícito) sigue vigente.
2. Nada en este plan llama a WaveSpeed ni a Aria, ni gasta dinero.
3. Ningún texto de identidad cambia sin que Luis lo guarde y lo bloquee él mismo.
4. Las pruebas existentes siguen en verde sin tocar sus aserciones, salvo la de `AgencyNav`, que cambia porque se añade la sección Talento.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/20261117100000_raxi_hq_talent_identity.sql` (nuevo) | Tabla de versiones, RLS y RPCs `raxi_identity_save_draft` y `raxi_identity_lock` |
| `supabase/functions/talent-reference/handler.ts`, `index.ts` (nuevos) | Subida segura de referencias |
| `supabase/config.toml` (modificar) | `verify_jwt = true` |
| `apps/raxi-hq/src/talent/talentModel.ts` (nuevo) | Modelo puro del perfil |
| `apps/raxi-hq/src/talent/TalentListPage.tsx`, `TalentProfilePage.tsx`, `TalentoRoute.tsx`, `talent.css` (nuevos) | Páginas |
| `apps/raxi-hq/src/portfolio/mediaModel.ts`, `MultimediaPage.tsx` (modificar) | Excluir referencias del Archivo |
| `apps/raxi-hq/src/agency/AgencyNav.tsx`, `AgenciaPage.tsx` (modificar) | Sección Talento y enlaces a cada ficha |
| `apps/raxi-hq/src/auth/AuthRoutes.tsx` (modificar) | Rutas `/talento` y `/talento/:id` |
| `apps/raxi-hq/tests/talent.test.tsx` (nuevo), `tests/agency.test.tsx`, `tests/campaignDatabase.ts`, `scripts/test.mjs` (modificar) | Pruebas |

Todos los bloques de prueba de este plan van en `apps/raxi-hq/tests/talent.test.tsx`. Mueve siempre los `import` al inicio del archivo; las constantes `ws`, `owner`, `sha` y `JPEG` se declaran una sola vez.

---

### Tarea 0: Rama y línea base

- [ ] **Paso 1**

```bash
git fetch origin feat/v11-agencia
git switch -c feat/v11-talento origin/feat/v11-agencia
cd apps/raxi-hq && npm ci && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
```

Esperado: 1006 pruebas, 0 fallos.

---

### Tarea 1: Modelo del perfil y exclusión de referencias del Archivo

**Archivos:**
- Crear: `apps/raxi-hq/src/talent/talentModel.ts`, `apps/raxi-hq/tests/talent.test.tsx`
- Modificar: `apps/raxi-hq/src/portfolio/mediaModel.ts`, `apps/raxi-hq/src/portfolio/MultimediaPage.tsx`, `apps/raxi-hq/src/agency/AgenciaPage.tsx`, `apps/raxi-hq/scripts/test.mjs`

- [ ] **Paso 1: Escribir las pruebas que fallan**

`apps/raxi-hq/tests/talent.test.tsx`:

```tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTalentProfile, canLock, splitLines } from '../src/talent/talentModel';
import { buildMedia } from '../src/portfolio/mediaModel';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const ref = (id: string, angle: string, character = 'raxi-vox', created = '2026-11-17T10:00:00Z') => ({
  id, workspace_id: ws, kind: 'REFERENCE', object_path: `${ws}/references/${character}/${id}.jpg`, sha256: sha,
  metadata: { character_id: character, angle, content_level: 'PUBLIC', source: 'LUIS_UPLOAD' }, created_at: created,
});
const version = (v: number, status: string, extra: Record<string, unknown> = {}) => ({
  workspace_id: ws, character_id: 'raxi-vox', version: v, identity_text: 'A 25-year-old woman named Raxi Vox with warm brown eyes.',
  marks: ['Pecas suaves'], accessories: [], reference_asset_ids: ['r1'], status, updated_at: '2026-11-17T10:00:00Z',
  locked_at: status === 'LOCKED' ? '2026-11-17T11:00:00Z' : null, ...extra,
});

test('talent model: references, locked version, draft and history', () => {
  const p = buildTalentProfile(ws, 'raxi-vox',
    [version(1, 'LOCKED'), version(2, 'DRAFT', { reference_asset_ids: ['r1', 'r2'] }), { ...version(1, 'LOCKED'), character_id: 'vesper-corvus' }],
    [ref('r1', 'FRONT'), ref('r2', 'PROFILE', 'raxi-vox', '2026-11-17T12:00:00Z'), ref('v1', 'FRONT', 'vesper-corvus'), { ...ref('o1', 'FRONT'), kind: 'ORIGINAL' }]);
  assert.equal(p.name, 'Raxi Vox');
  assert.deepEqual(p.references.map((r) => [r.id, r.angle]), [['r2', 'PROFILE'], ['r1', 'FRONT']]);
  assert.equal(p.locked?.version, 1);
  assert.equal(p.draft?.version, 2);
  assert.deepEqual(p.history.map((h) => h.version), [2, 1]);
  assert.equal(canLock(p), true);
});

test('talent model: lock needs real text and a front reference in the draft', () => {
  const noFront = buildTalentProfile(ws, 'raxi-vox', [version(1, 'DRAFT', { reference_asset_ids: ['r2'] })], [ref('r2', 'PROFILE')]);
  assert.equal(canLock(noFront), false);
  const shortText = buildTalentProfile(ws, 'raxi-vox', [version(1, 'DRAFT', { identity_text: 'corto' })], [ref('r1', 'FRONT')]);
  assert.equal(canLock(shortText), false);
  const none = buildTalentProfile(ws, 'raxi-vox', [], []);
  assert.equal(none.draft, null);
  assert.equal(none.locked, null);
  assert.equal(canLock(none), false);
});

test('talent model: foreign or malformed rows are rejected', () => {
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [], [{ ...ref('r1', 'FRONT'), workspace_id: 'other' }]));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [], [{ ...ref('r1', 'FRONT'), object_path: 'other/r1.jpg' }]));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [{ ...version(1, 'DRAFT'), workspace_id: 'other' }], []));
  assert.throws(() => buildTalentProfile(ws, 'raxi-vox', [version(1, 'WEIRD')], []));
  assert.throws(() => buildTalentProfile(ws, 'nadie', [], []));
  assert.deepEqual(buildTalentProfile(ws, 'raxi-vox', [], [ref('r9', 'SIDEWAYS')]).references, [], 'unknown angle is ignored');
});

test('talent model: list fields are trimmed lines, max 20', () => {
  assert.deepEqual(splitLines('  uno \n\n dos\n'), ['uno', 'dos']);
  assert.equal(splitLines(Array.from({ length: 30 }, (_, i) => `x${i}`).join('\n')).length, 20);
});

test('media model: identity references never appear in the archive', () => {
  const asset = { id: 'a1', workspace_id: ws, object_path: `${ws}/a1/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 10, external_asset_id: null, metadata: { character_id: 'raxi-vox', content_level: 'PUBLIC' }, created_at: '2026-11-17T10:00:00Z' };
  const view = buildMedia(ws, [asset, { ...asset, id: 'r1', object_path: `${ws}/references/raxi-vox/r1.jpg`, kind: 'REFERENCE' }], [], []);
  assert.deepEqual(view.assets.map((a) => a.id), ['a1']);
});
```

En `apps/raxi-hq/scripts/test.mjs`, añade `'talent.test.tsx'` a `entries` después de `'agency.test.tsx'`.

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve "../src/talent/talentModel"`).

- [ ] **Paso 3: Implementar el modelo**

`apps/raxi-hq/src/talent/talentModel.ts`:

```ts
// Talento: pure, validated read model of one model's identity (references + versioned identity text).
import { characterLabel } from '../portfolio/mediaModel';
import { TALENT_ROSTER } from '../agency/agencyModel';

export const ANGLES = ['FRONT', 'THREE_QUARTER', 'PROFILE', 'BACK', 'FULL_BODY', 'SHEET'] as const;
export type Angle = (typeof ANGLES)[number];
export const ANGLE_LABEL: Record<Angle, string> = { FRONT: 'Frente', THREE_QUARTER: 'Tres cuartos', PROFILE: 'Perfil', BACK: 'Espalda', FULL_BODY: 'Cuerpo completo', SHEET: 'Ficha completa' };

export interface TalentReference { id: string; angle: Angle; objectPath: string; sha256: string; createdAt: string }
export interface IdentityVersion { version: number; status: 'DRAFT' | 'LOCKED'; identityText: string; marks: string[]; accessories: string[]; referenceIds: string[]; updatedAt: string; lockedAt: string | null }
export interface TalentProfile { id: string; name: string; references: TalentReference[]; locked: IdentityVersion | null; draft: IdentityVersion | null; history: IdentityVersion[] }

const str = (v: unknown, max: number): string => { if (typeof v !== 'string' || v.length > max) throw new Error('Talento: dato inválido'); return v; };
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);

export function buildTalentProfile(workspaceId: string, characterId: string, rawVersions: unknown, rawRefs: unknown): TalentProfile {
  if (!(TALENT_ROSTER as readonly string[]).includes(characterId)) throw new Error('Talento: modelo desconocida');
  if (!Array.isArray(rawVersions) || !Array.isArray(rawRefs)) throw new Error('Talento: respuesta inválida');
  const references: TalentReference[] = [];
  for (const a of rawRefs as Record<string, unknown>[]) {
    if (a.workspace_id !== workspaceId) throw new Error('Talento: asset ajeno');
    if (a.kind !== 'REFERENCE') continue;
    const meta = (a.metadata && typeof a.metadata === 'object' ? a.metadata : {}) as Record<string, unknown>;
    if (meta.character_id !== characterId) continue;
    const path = str(a.object_path, 400);
    if (path.split('/')[0] !== workspaceId) throw new Error('Talento: ruta ajena');
    const sha = str(a.sha256, 64);
    if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Talento: hash inválido');
    if (!(ANGLES as readonly string[]).includes(meta.angle as string)) continue;
    references.push({ id: str(a.id, 64), angle: meta.angle as Angle, objectPath: path, sha256: sha, createdAt: str(a.created_at, 64) });
  }
  references.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const history: IdentityVersion[] = [];
  for (const v of rawVersions as Record<string, unknown>[]) {
    if (v.workspace_id !== workspaceId) throw new Error('Talento: versión ajena');
    if (v.character_id !== characterId) continue;
    if (v.status !== 'DRAFT' && v.status !== 'LOCKED') throw new Error('Talento: estado inválido');
    const version = Number(v.version);
    if (!Number.isInteger(version) || version < 1) throw new Error('Talento: versión inválida');
    history.push({
      version, status: v.status, identityText: str(v.identity_text, 4000), marks: strList(v.marks), accessories: strList(v.accessories),
      referenceIds: Array.isArray(v.reference_asset_ids) ? (v.reference_asset_ids as unknown[]).map((x) => str(x, 64)) : [],
      updatedAt: str(v.updated_at, 64), lockedAt: typeof v.locked_at === 'string' ? v.locked_at : null,
    });
  }
  history.sort((x, y) => y.version - x.version);
  return {
    id: characterId, name: characterLabel(characterId), references,
    locked: history.find((h) => h.status === 'LOCKED') ?? null, draft: history.find((h) => h.status === 'DRAFT') ?? null, history,
  };
}

export const canLock = (p: TalentProfile): boolean =>
  !!p.draft && p.draft.identityText.trim().length >= 20 && p.references.some((r) => r.angle === 'FRONT' && p.draft!.referenceIds.includes(r.id));

export const splitLines = (s: string): string[] => s.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
```

- [ ] **Paso 4: Excluir las referencias del Archivo**

En `apps/raxi-hq/src/portfolio/mediaModel.ts`, dentro de `buildMedia`, cambia

```ts
  const assets = (rawAssets as Record<string, unknown>[]).map((a): MediaAsset => {
```

por

```ts
  // Identity references (Talento) are working material, not archive photos.
  const assets = (rawAssets as Record<string, unknown>[]).filter((a) => a.kind !== 'REFERENCE').map((a): MediaAsset => {
```

En `MultimediaPage.tsx` y en `AgenciaPage.tsx`, en la consulta a `raxi_assets`, cambia la lista de columnas

```ts
'id,workspace_id,object_path,mime_type,sha256,byte_size,external_asset_id,metadata,created_at'
```

por

```ts
'id,workspace_id,kind,object_path,mime_type,sha256,byte_size,external_asset_id,metadata,created_at'
```

- [ ] **Paso 5: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1011 pruebas, 0 fallos (incluidas `multimedia` y `agency` sin cambios en sus aserciones).

- [ ] **Paso 6: Commit**

```bash
git add apps/raxi-hq/src/talent apps/raxi-hq/src/portfolio apps/raxi-hq/src/agency/AgenciaPage.tsx apps/raxi-hq/tests/talent.test.tsx apps/raxi-hq/scripts/test.mjs
git commit -m "feat(talento): modelo de identidad versionada; las referencias no entran al Archivo"
```

---

### Tarea 2: Migración de identidad

**Archivos:**
- Crear: `supabase/migrations/20261117100000_raxi_hq_talent_identity.sql`
- Modificar: `apps/raxi-hq/tests/talent.test.tsx`, `apps/raxi-hq/tests/campaignDatabase.ts`

- [ ] **Paso 1: Escribir la prueba que falla**

Añade a `apps/raxi-hq/tests/talent.test.tsx`:

```tsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('talent migration: owner-only writes through two RPCs; lock feeds the Aria fixed prompt', () => {
  const sql = readFileSync(join(process.cwd(), '../../supabase/migrations/20261117100000_raxi_hq_talent_identity.sql'), 'utf8');
  assert.match(sql, /alter table public\.raxi_identity_versions enable row level security/);
  assert.match(sql, /revoke all on public\.raxi_identity_versions from anon, authenticated/);
  assert.match(sql, /grant select on public\.raxi_identity_versions to authenticated/);
  assert.match(sql, /create unique index raxi_identity_one_draft/);
  for (const fn of ['raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[])', 'raxi_identity_lock(text, integer)']) {
    const name = fn.replace(/[()[\]]/g, (c) => `\\${c}`);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name} from public, anon`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name} to authenticated`), fn);
  }
  assert.match(sql, /a\.kind = 'REFERENCE'/, 'drafts only accept identity references');
  assert.match(sql, /metadata->>'angle' = 'FRONT'/, 'lock needs a front reference');
  assert.match(sql, /insert into public\.raxi_character_profiles[\s\S]*on conflict \(workspace_id, character_id\) do update set fixed_prompt = excluded\.fixed_prompt/);
  assert.match(sql, /'IDENTITY_LOCKED'/);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: falla `talent migration: …` con `ENOENT`.

- [ ] **Paso 3: Escribir la migración**

`supabase/migrations/20261117100000_raxi_hq_talent_identity.sql`:

```sql
-- Talento v1: versioned identity per model (360 references + identity text), locked by the owner.
-- Locking a version copies its text to raxi_character_profiles.fixed_prompt, which Production already prepends in Aria.
create table public.raxi_identity_versions (
  workspace_id uuid not null references public.raxi_workspaces(id) on delete restrict,
  character_id text not null check (character_id in ('raxi-vox','vesper-corvus')),
  version integer not null check (version between 1 and 999),
  identity_text text not null default '' check (length(identity_text) <= 4000),
  marks jsonb not null default '[]'::jsonb check (jsonb_typeof(marks) = 'array'),
  accessories jsonb not null default '[]'::jsonb check (jsonb_typeof(accessories) = 'array'),
  reference_asset_ids uuid[] not null default '{}',
  status text not null default 'DRAFT' check (status in ('DRAFT','LOCKED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references auth.users(id),
  primary key (workspace_id, character_id, version),
  check ((status = 'LOCKED') = (locked_at is not null and locked_by is not null))
);
create unique index raxi_identity_one_draft on public.raxi_identity_versions (workspace_id, character_id) where status = 'DRAFT';
alter table public.raxi_identity_versions enable row level security;
create policy raxi_identity_versions_owner_read on public.raxi_identity_versions for select to authenticated
 using (exists (select 1 from public.raxi_workspaces w where w.id = workspace_id and w.owner_user_id = (select auth.uid())));
revoke all on public.raxi_identity_versions from anon, authenticated;
grant select on public.raxi_identity_versions to authenticated;

create or replace function public.raxi_identity_save_draft(p_character text, p_text text, p_marks jsonb, p_accessories jsonb, p_refs uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_draft int;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'owner required' using errcode = '42501'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = auth.uid() and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  if p_character not in ('raxi-vox','vesper-corvus') then raise exception 'unknown character' using errcode = '22023'; end if;
  if p_text is null or length(p_text) > 4000 then raise exception 'invalid text' using errcode = '22023'; end if;
  if jsonb_typeof(p_marks) is distinct from 'array' or jsonb_typeof(p_accessories) is distinct from 'array'
     or jsonb_array_length(p_marks) > 20 or jsonb_array_length(p_accessories) > 20
     or exists (select 1 from jsonb_array_elements(p_marks || p_accessories) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 200)
  then raise exception 'invalid lists' using errcode = '22023'; end if;
  if coalesce(cardinality(p_refs), 0) > 12 then raise exception 'too many references' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_refs, '{}'::uuid[])) r where not exists (
       select 1 from public.raxi_assets a where a.id = r and a.workspace_id = v_ws and a.kind = 'REFERENCE' and a.metadata->>'character_id' = p_character))
  then raise exception 'invalid reference' using errcode = '22023'; end if;
  select v.version into v_draft from public.raxi_identity_versions v
   where v.workspace_id = v_ws and v.character_id = p_character and v.status = 'DRAFT' for update;
  if found then
    update public.raxi_identity_versions set identity_text = p_text, marks = p_marks, accessories = p_accessories,
      reference_asset_ids = coalesce(p_refs, '{}'::uuid[]), updated_at = now()
     where workspace_id = v_ws and character_id = p_character and version = v_draft;
  else
    select coalesce(max(v.version), 0) + 1 into v_draft from public.raxi_identity_versions v where v.workspace_id = v_ws and v.character_id = p_character;
    insert into public.raxi_identity_versions (workspace_id, character_id, version, identity_text, marks, accessories, reference_asset_ids)
     values (v_ws, p_character, v_draft, p_text, p_marks, p_accessories, coalesce(p_refs, '{}'::uuid[]));
  end if;
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'IDENTITY_DRAFT_SAVED', 'HUMAN', auth.uid(), 'raxi_identity_versions', p_character, 'raxi-hq-talento', jsonb_build_object('character', p_character, 'version', v_draft), now(), now());
  return jsonb_build_object('character', p_character, 'version', v_draft, 'status', 'DRAFT');
end $$;

create or replace function public.raxi_identity_lock(p_character text, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v public.raxi_identity_versions;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'owner required' using errcode = '42501'; end if;
  select w.id into v_ws from public.raxi_workspaces w where w.owner_user_id = auth.uid() and w.slug = 'raxi-hq';
  if not found then raise exception 'owner required' using errcode = '42501'; end if;
  select * into v from public.raxi_identity_versions x
   where x.workspace_id = v_ws and x.character_id = p_character and x.version = p_version for update;
  if not found or v.status <> 'DRAFT' then raise exception 'not a draft' using errcode = '22023'; end if;
  if length(trim(v.identity_text)) < 20 then raise exception 'identity text required' using errcode = '22023'; end if;
  if not exists (select 1 from public.raxi_assets a where a.id = any (v.reference_asset_ids) and a.workspace_id = v_ws
                 and a.kind = 'REFERENCE' and a.metadata->>'angle' = 'FRONT')
  then raise exception 'front reference required' using errcode = '22023'; end if;
  update public.raxi_identity_versions set status = 'LOCKED', locked_at = now(), locked_by = auth.uid(), updated_at = now()
   where workspace_id = v_ws and character_id = p_character and version = p_version;
  insert into public.raxi_character_profiles (workspace_id, character_id, fixed_prompt, updated_at)
   values (v_ws, p_character, v.identity_text, now())
   on conflict (workspace_id, character_id) do update set fixed_prompt = excluded.fixed_prompt, updated_at = now();
  insert into public.raxi_audit_events (workspace_id, action, actor_kind, actor_user_id, resource_kind, resource_id, source_ref, details, occurred_at, recorded_at)
   values (v_ws, 'IDENTITY_LOCKED', 'HUMAN', auth.uid(), 'raxi_identity_versions', p_character, 'raxi-hq-talento', jsonb_build_object('character', p_character, 'version', p_version), now(), now());
  return jsonb_build_object('character', p_character, 'version', p_version, 'status', 'LOCKED');
end $$;

revoke all on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) from public, anon;
revoke all on function public.raxi_identity_lock(text, integer) from public, anon;
grant execute on function public.raxi_identity_save_draft(text, text, jsonb, jsonb, uuid[]) to authenticated;
grant execute on function public.raxi_identity_lock(text, integer) to authenticated;
```

- [ ] **Paso 4: Mantener PGlite fuera de esta migración**

`raxi_character_profiles` llega en una migración que PGlite ya excluye, así que esta también. En `apps/raxi-hq/tests/campaignDatabase.ts`, bajo la línea de `'20261117000000_raxi_hq_provider_connections.sql',` añade:

```ts
    // Talento v1 depends on raxi_character_profiles (post-freeze product schema); covered by talent.test.tsx.
    '20261117100000_raxi_hq_talent_identity.sql',
```

- [ ] **Paso 5: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1012 pruebas, 0 fallos.

- [ ] **Paso 6: Commit**

```bash
git add supabase/migrations/20261117100000_raxi_hq_talent_identity.sql apps/raxi-hq/tests/talent.test.tsx apps/raxi-hq/tests/campaignDatabase.ts
git commit -m "feat(talento): versiones de identidad; bloquear actualiza el prompt fijo de Producción"
```

---

### Tarea 3: Subida segura de referencias (`talent-reference`)

**Archivos:**
- Crear: `supabase/functions/talent-reference/handler.ts`, `supabase/functions/talent-reference/index.ts`
- Modificar: `supabase/config.toml`, `apps/raxi-hq/tests/talent.test.tsx`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade a `apps/raxi-hq/tests/talent.test.tsx`:

```tsx
import { createReferenceHandler, type ReferenceDependencies } from '../../../supabase/functions/talent-reference/handler';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
function refDeps(over: Partial<ReferenceDependencies> = {}) {
  const calls: string[] = [];
  const d: ReferenceDependencies = {
    async verifyUser(token) { return token === 'good' ? { id: owner, isAnonymous: false } : null; },
    async workspaceOf() { return ws; },
    async findBySha() { return null; },
    async upload(path, bytes, mime) { calls.push(`upload:${path}:${bytes.length}:${mime}`); },
    async register(row) { calls.push(`register:${row.kind}:${row.metadata.character_id}:${row.metadata.angle}:${row.metadata.content_level}`); },
    async removeObject(path) { calls.push(`remove:${path}`); },
    newId: () => 'new-id',
    async sha256() { return sha; },
    ...over,
  };
  return { d, calls };
}
function upload(fields: Record<string, string>, bytes: Uint8Array | null = JPEG, token = 'good') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (bytes) fd.set('file', new File([bytes], 'ficha.jpg', { type: 'image/jpeg' }));
  return new Request('https://x/functions/v1/talent-reference', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
}
const okFields = { character: 'raxi-vox', angle: 'FRONT', confirm_safe: 'true' };

test('reference handler: session required', async () => {
  const { d, calls } = refDeps();
  assert.equal((await createReferenceHandler(d)(upload(okFields, JPEG, 'bad'))).status, 401);
  assert.equal((await createReferenceHandler(d)(new Request('https://x', { method: 'GET' }))).status, 405);
  assert.deepEqual(calls, []);
});

test('reference handler: stores a confirmed clothed reference as REFERENCE in the workspace', async () => {
  const { d, calls } = refDeps();
  const res = await createReferenceHandler(d)(upload(okFields));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { assetId: 'new-id', character: 'raxi-vox', angle: 'FRONT', duplicate: false });
  assert.deepEqual(calls, [`upload:${ws}/references/raxi-vox/${sha}.jpg:${JPEG.length}:image/jpeg`, 'register:REFERENCE:raxi-vox:FRONT:PUBLIC']);
});

test('reference handler: refuses unconfirmed, unknown model or angle, and non-images', async () => {
  const h = createReferenceHandler(refDeps().d);
  assert.equal((await h(upload({ ...okFields, confirm_safe: 'false' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, character: 'nadie' }))).status, 400);
  assert.equal((await h(upload({ ...okFields, angle: 'SIDEWAYS' }))).status, 400);
  assert.equal((await h(upload(okFields, null))).status, 400);
  assert.equal((await h(upload(okFields, new TextEncoder().encode('<svg onload=x>')))).status, 415);
});

test('reference handler: duplicates are reused, other uses conflict, failed registration cleans up', async () => {
  const dup = refDeps({ async findBySha() { return { id: 'old', kind: 'REFERENCE', characterId: 'raxi-vox' }; } });
  const r1 = await createReferenceHandler(dup.d)(upload(okFields));
  assert.deepEqual(await r1.json(), { assetId: 'old', character: 'raxi-vox', angle: 'FRONT', duplicate: true });
  assert.deepEqual(dup.calls, []);
  const other = refDeps({ async findBySha() { return { id: 'old', kind: 'ORIGINAL', characterId: 'raxi-vox' }; } });
  assert.equal((await createReferenceHandler(other.d)(upload(okFields))).status, 409);
  const broken = refDeps({ async register() { throw new Error('db down'); } });
  const r3 = await createReferenceHandler(broken.d)(upload(okFields));
  assert.equal(r3.status, 503);
  assert.ok(!(await r3.text()).includes('db down'));
  assert.deepEqual(broken.calls.at(-1), `remove:${ws}/references/raxi-vox/${sha}.jpg`);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve ".../talent-reference/handler"`).

- [ ] **Paso 3: Implementar el handler**

`supabase/functions/talent-reference/handler.ts`:

```ts
// talent-reference: stores one identity reference image for the signed-in owner. No Deno or npm imports,
// so the same file is unit-tested under Node. Only clothed (non-explicit) references, confirmed by the owner.

export interface ReferenceRow {
  id: string; workspace_id: string; kind: 'REFERENCE'; object_path: string; mime_type: string; byte_size: number; sha256: string;
  metadata: { character_id: string; angle: string; content_level: 'PUBLIC'; source: 'LUIS_UPLOAD' };
}
export interface ReferenceDependencies {
  verifyUser(token: string): Promise<{ id: string; isAnonymous: boolean } | null>;
  workspaceOf(userId: string): Promise<string | null>;
  findBySha(workspaceId: string, sha256: string): Promise<{ id: string; kind: string; characterId: string | null } | null>;
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  register(row: ReferenceRow): Promise<void>;
  removeObject(path: string): Promise<void>;
  newId(): string;
  sha256(bytes: Uint8Array): Promise<string>;
}

const ROSTER = new Set(['raxi-vox', 'vesper-corvus']);
const ANGLES = new Set(['FRONT', 'THREE_QUARTER', 'PROFILE', 'BACK', 'FULL_BODY', 'SHEET']);
const MAX_BYTES = 15 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Decides the type from the bytes, never from the file name or the browser's claim. */
export function sniffImage(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function createReferenceHandler(dependencies: ReferenceDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Método no permitido.' });
    const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
    if (!token) return reply(401, { error: 'Sesión requerida.' });
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BYTES + 64 * 1024) return reply(413, { error: 'La imagen supera 15 MB.' });
    let path: string | null = null;
    try {
      const user = await dependencies.verifyUser(token);
      if (!user || user.isAnonymous) return reply(401, { error: 'Sesión no válida.' });
      const workspaceId = await dependencies.workspaceOf(user.id);
      if (!workspaceId) return reply(403, { error: 'No tienes acceso a este workspace.' });
      let form: FormData;
      try { form = await request.formData(); } catch { return reply(400, { error: 'Solicitud inválida.' }); }
      const character = form.get('character'); const angle = form.get('angle'); const file = form.get('file');
      if (typeof character !== 'string' || !ROSTER.has(character) || typeof angle !== 'string' || !ANGLES.has(angle)) return reply(400, { error: 'Modelo o ángulo no válido.' });
      if (form.get('confirm_safe') !== 'true') return reply(400, { error: 'Confirma que la ficha es con ropa (contenido no explícito).' });
      if (!(file instanceof Blob) || file.size < 1) return reply(400, { error: 'Falta la imagen.' });
      if (file.size > MAX_BYTES) return reply(413, { error: 'La imagen supera 15 MB.' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = sniffImage(bytes);
      if (!mime) return reply(415, { error: 'Solo se aceptan imágenes JPG, PNG o WebP.' });
      const sha256 = await dependencies.sha256(bytes);
      const existing = await dependencies.findBySha(workspaceId, sha256);
      if (existing) {
        if (existing.kind === 'REFERENCE' && existing.characterId === character) return reply(200, { assetId: existing.id, character, angle, duplicate: true });
        return reply(409, { error: 'Esa imagen ya está en el archivo con otro uso.' });
      }
      const id = dependencies.newId();
      path = `${workspaceId}/references/${character}/${sha256}.${EXT[mime]}`;
      await dependencies.upload(path, bytes, mime);
      await dependencies.register({ id, workspace_id: workspaceId, kind: 'REFERENCE', object_path: path, mime_type: mime, byte_size: bytes.length, sha256,
        metadata: { character_id: character, angle, content_level: 'PUBLIC', source: 'LUIS_UPLOAD' } });
      return reply(200, { assetId: id, character, angle, duplicate: false });
    } catch {
      if (path) { try { await dependencies.removeObject(path); } catch { /* keep the original error */ } }
      return reply(503, { error: 'No se pudo guardar la referencia. No se confirmó ningún cambio.' });
    }
  };
}
```

- [ ] **Paso 4: Cableado Deno**

`supabase/functions/talent-reference/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createReferenceHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
// Service credential exists only in the managed Edge runtime. It is never returned or logged.
const server = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = 'raxi-hq-private';
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

Deno.serve(createReferenceHandler({
  async verifyUser(token) { const { data, error } = await auth.auth.getUser(token); return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true }; },
  async workspaceOf(userId) {
    const { data, error } = await server.from('raxi_workspaces').select('id').eq('owner_user_id', userId).eq('slug', 'raxi-hq').maybeSingle();
    if (error) throw new Error('workspace');
    return (data?.id as string | undefined) ?? null;
  },
  async findBySha(workspaceId, sha256) {
    const { data, error } = await server.from('raxi_assets').select('id,kind,metadata').eq('workspace_id', workspaceId).eq('sha256', sha256).limit(1);
    if (error) throw new Error('lookup');
    const row = data?.[0] as { id: string; kind: string; metadata: Record<string, unknown> } | undefined;
    return row ? { id: row.id, kind: row.kind, characterId: typeof row.metadata?.character_id === 'string' ? row.metadata.character_id : null } : null;
  },
  async upload(path, bytes, mime) { const { error } = await server.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false }); if (error) throw new Error('upload'); },
  async register(row) { const { error } = await server.from('raxi_assets').insert({ ...row, bucket_id: BUCKET }); if (error) throw new Error('register'); },
  async removeObject(path) { await server.storage.from(BUCKET).remove([path]); },
  newId: () => crypto.randomUUID(),
  async sha256(bytes) { return hex(await crypto.subtle.digest('SHA-256', bytes)); },
}));
```

En `supabase/config.toml`, añade al final:

```toml
[functions.talent-reference]
verify_jwt = true
```

- [ ] **Paso 5: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1016 pruebas, 0 fallos.

- [ ] **Paso 6: Commit**

```bash
git add supabase/functions/talent-reference supabase/config.toml apps/raxi-hq/tests/talent.test.tsx
git commit -m "feat(talento): subida segura de referencias 360 con tipo real, sha256 y confirmación de contenido"
```

---

### Tarea 4: Páginas de Talento

**Archivos:**
- Crear: `apps/raxi-hq/src/talent/TalentListPage.tsx`, `TalentProfilePage.tsx`, `TalentoRoute.tsx`, `talent.css`
- Modificar: `apps/raxi-hq/tests/talent.test.tsx`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade a `apps/raxi-hq/tests/talent.test.tsx`:

```tsx
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TalentProfilePage } from '../src/talent/TalentProfilePage';
import { TalentListPage } from '../src/talent/TalentListPage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

function talentClient(versions: unknown[], refs: unknown[]) {
  const rpcs: [string, unknown][] = []; const invokes: [string, unknown][] = [];
  const client = {
    rpc: async (name: string, args?: unknown) => { rpcs.push([name, args]); return name === 'raxi_get_workspace' ? { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null } : { data: { ok: true }, error: null }; },
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: name === 'raxi_identity_versions' ? versions : refs, error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
    functions: { invoke: async (name: string, opts: { body: unknown }) => { invokes.push([name, opts.body]); return { data: { assetId: 'r9', duplicate: false }, error: null }; } },
  } as unknown as SupabaseClient;
  return { client, rpcs, invokes };
}
const renderProfile = async (client: SupabaseClient) => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><TalentProfilePage client={client} ownerId={owner} characterId="raxi-vox" /></MemoryRouter>); await new Promise((res) => setTimeout(res, 20)); });
  return r;
};
const byText = (r: ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === 'button' && n.children.join('') === label)[0];

test('Talento list: the whole roster, each linking to its profile', async () => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><TalentListPage /></MemoryRouter>); });
  const hrefs = r.root.findAllByType('a').map((a) => a.props.href);
  assert.ok(hrefs.includes('/talento/raxi-vox') && hrefs.includes('/talento/vesper-corvus'));
});

test('Talento profile: shows each 360 angle, missing ones included, read with RLS only', async () => {
  const { client, rpcs } = talentClient([], [ref('r1', 'FRONT')]);
  const r = await renderProfile(client);
  const text = JSON.stringify(r.toJSON());
  assert.match(text, /Raxi Vox/);
  assert.match(text, /Sin identidad todavía/);
  for (const label of ['Frente', 'Tres cuartos', 'Perfil', 'Espalda', 'Cuerpo completo']) assert.match(text, new RegExp(label));
  assert.equal(r.root.findAllByType('img').filter((i) => String(i.props.src).includes('/r1.jpg')).length, 1);
  assert.deepEqual(rpcs.map(([n]) => n), ['raxi_get_workspace']);
});

test('Talento profile: upload sends the file, model, angle and the clothed-content confirmation', async () => {
  const { client, invokes } = talentClient([], []);
  const r = await renderProfile(client);
  const file = new File([JPEG], 'frente.jpg', { type: 'image/jpeg' });
  await act(async () => { r.root.findByProps({ id: 'ref-file' }).props.onChange({ target: { files: [file] } }); });
  await act(async () => { r.root.findByProps({ id: 'ref-angle' }).props.onChange({ target: { value: 'FRONT' } }); });
  const submit = () => act(async () => { r.root.findByProps({ 'aria-label': 'Subir referencia' }).props.onSubmit({ preventDefault() {} }); await new Promise((res) => setTimeout(res, 10)); });
  await submit();
  assert.equal(invokes.length, 0, 'nothing is sent without the confirmation');
  await act(async () => { r.root.findByProps({ id: 'ref-safe' }).props.onChange({ target: { checked: true } }); });
  await submit();
  assert.equal(invokes.length, 1);
  const [name, body] = invokes[0] as [string, FormData];
  assert.equal(name, 'talent-reference');
  assert.deepEqual([body.get('character'), body.get('angle'), body.get('confirm_safe')], ['raxi-vox', 'FRONT', 'true']);
  assert.ok(body.get('file') instanceof Blob);
});

test('Talento profile: saving a draft and locking it go through the owner RPCs', async () => {
  const { client, rpcs } = talentClient([version(1, 'DRAFT', { reference_asset_ids: ['r1'] })], [ref('r1', 'FRONT')]);
  const r = await renderProfile(client);
  await act(async () => { r.root.findByProps({ id: 'identity-text' }).props.onChange({ target: { value: 'A 25-year-old woman named Raxi Vox, warm brown eyes, teal highlights.' } }); });
  await act(async () => { r.root.findByProps({ id: 'identity-marks' }).props.onChange({ target: { value: 'Pecas suaves\nLunar junto al labio' } }); });
  await act(async () => { byText(r, 'Guardar borrador').props.onClick(); await new Promise((res) => setTimeout(res, 10)); });
  assert.deepEqual(rpcs.find(([n]) => n === 'raxi_identity_save_draft')?.[1], {
    p_character: 'raxi-vox', p_text: 'A 25-year-old woman named Raxi Vox, warm brown eyes, teal highlights.',
    p_marks: ['Pecas suaves', 'Lunar junto al labio'], p_accessories: [], p_refs: ['r1'],
  });
  await act(async () => { byText(r, 'Bloquear versión 1').props.onClick(); });
  assert.ok(!rpcs.some(([n]) => n === 'raxi_identity_lock'), 'first click only asks for confirmation');
  assert.match(JSON.stringify(r.toJSON()), /prompt fijo/);
  await act(async () => { byText(r, 'Sí, bloquear').props.onClick(); await new Promise((res) => setTimeout(res, 10)); });
  assert.deepEqual(rpcs.find(([n]) => n === 'raxi_identity_lock')?.[1], { p_character: 'raxi-vox', p_version: 1 });
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve "../src/talent/TalentProfilePage"`).

- [ ] **Paso 3: Implementar**

`apps/raxi-hq/src/talent/TalentListPage.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { AgencyNav } from '../agency/AgencyNav';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { characterLabel } from '../portfolio/mediaModel';
import './talent.css';

export function TalentListPage() {
  return <div className="agency">
    <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">
      <section className="agency-hero"><p className="agency-eyebrow">Talento</p><h1>Nuestras modelos</h1>
        <p className="agency-lead">Cada ficha guarda su identidad 360: lo que Producción debe respetar en cada foto.</p></section>
      <ul className="talent-roster">
        {TALENT_ROSTER.map((id) => <li key={id} className="agency-card"><h2 className="talent-name">{characterLabel(id)}</h2>
          <Link to={`/talento/${id}`} className="agency-action">Abrir ficha</Link></li>)}
      </ul>
    </main>
  </div>;
}
```

`apps/raxi-hq/src/talent/TalentProfilePage.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { AgencyNav } from '../agency/AgencyNav';
import { ANGLES, ANGLE_LABEL, buildTalentProfile, canLock, splitLines, type Angle, type TalentProfile } from './talentModel';
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
  const [file, setFile] = useState<Blob | null>(null); const [angle, setAngle] = useState<Angle>('FRONT'); const [safe, setSafe] = useState(false);
  const [busy, setBusy] = useState(false); const [confirmLock, setConfirmLock] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const reload = useCallback(async () => {
    try {
      const r = await loadTalent(client, ownerId, characterId);
      const base = r.profile.draft ?? r.profile.locked;
      setText(base?.identityText ?? ''); setMarks((base?.marks ?? []).join('\n')); setAccessories((base?.accessories ?? []).join('\n'));
      setSelected(base?.referenceIds ?? r.profile.references.map((x) => x.id));
      setState({ phase: 'ready', ...r });
    } catch (cause) { setState({ phase: 'error', message: cause instanceof Error ? cause.message : 'No se pudo leer la ficha.' }); }
  }, [client, ownerId, characterId]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (work: () => Promise<{ error: unknown }>, ok: string, fail: string) => {
    setBusy(true); setNotice(undefined);
    try { const { error } = await work(); if (error) throw new Error(fail); setNotice({ kind: 'ok', text: ok }); }
    catch { setNotice({ kind: 'error', text: fail }); }
    finally { setBusy(false); setConfirmLock(false); await reload(); }
  };

  async function uploadReference(event: FormEvent) {
    event.preventDefault();
    if (!file) { setNotice({ kind: 'error', text: 'Elige una imagen.' }); return; }
    if (!safe) { setNotice({ kind: 'error', text: 'Confirma que la ficha es con ropa (contenido no explícito).' }); return; }
    const body = new FormData();
    body.set('character', characterId); body.set('angle', angle); body.set('confirm_safe', 'true'); body.set('file', file);
    await run(() => client.functions.invoke('talent-reference', { body }), 'Referencia guardada.', 'No se pudo guardar la referencia.');
    setFile(null); setSafe(false);
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
        <p className="agency-lead">{status}{profile.draft ? ` · borrador v${profile.draft.version} sin bloquear` : ''}</p></section>

      <section aria-labelledby="t-360" className="agency-section">
        <h2 id="t-360">Ficha 360</h2>
        <ul className="talent-angles">
          {ANGLES.map((a) => {
            const refs = profile.references.filter((r) => r.angle === a);
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
            {ANGLES.map((a) => <option key={a} value={a}>{ANGLE_LABEL[a]}</option>)}
          </select>
          <label className="talent-check"><input id="ref-safe" type="checkbox" checked={safe} disabled={busy} onChange={(e) => setSafe(e.target.checked)} /> Confirmo que esta ficha es con ropa (contenido no explícito)</label>
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
        {profile.draft && !lockable && <p className="agency-meta">Para bloquear: guarda un texto de al menos 20 caracteres y marca una referencia de frente.</p>}
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
```

`apps/raxi-hq/src/talent/TalentoRoute.tsx`:

```tsx
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { TALENT_ROSTER } from '../agency/agencyModel';
import { TalentListPage } from './TalentListPage';
import { TalentProfilePage } from './TalentProfilePage';

export default function TalentoRoute() {
  const { user } = useAuth();
  const { id } = useParams();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">Talento necesita una sesión conectada a Supabase.</p></main>;
  if (!id) return <TalentListPage />;
  if (!(TALENT_ROSTER as readonly string[]).includes(id)) return <Navigate to="/talento" replace />;
  return <TalentProfilePage key={`${user.id}:${id}`} client={supabase} ownerId={user.id} characterId={id} />;
}
```

`apps/raxi-hq/src/talent/talent.css` (solo tokens):

```css
.talent-roster, .talent-angles, .talent-history { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-5); }
.talent-roster { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.talent-name { font-family: var(--font-display); font-weight: 400; font-size: var(--text-2xl); margin: 0; }
.talent-angles { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
.talent-angle { display: flex; flex-direction: column; gap: var(--space-2); }
.talent-angle h3 { margin: 0; font-size: var(--text-sm); color: var(--muted); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
.talent-ref { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); color: var(--muted); }
.talent-ref img, .talent-missing { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; object-position: top; border-radius: var(--radius-md); background: var(--surface-2); }
.talent-missing { display: grid; place-items: center; border: 1px dashed var(--border-strong); color: var(--muted); font-size: var(--text-sm); }
.talent-upload, .agency-section textarea, .talent-confirm { font: inherit; }
.talent-upload { display: grid; gap: var(--space-2); max-width: 520px; padding: var(--space-5); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md); }
.talent-upload input, .talent-upload select, .agency-section textarea { min-height: 44px; padding: var(--space-2) var(--space-3); background: var(--bg); color: var(--ink); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); }
.agency-section textarea { width: 100%; resize: vertical; }
.talent-check { display: flex; gap: var(--space-2); align-items: flex-start; font-size: var(--text-sm); }
.talent-upload button, .talent-actions button, .talent-confirm button { min-height: 44px; padding: 0 var(--space-4); border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: transparent; color: var(--ink); font-weight: 600; cursor: pointer; }
.talent-upload button[type='submit'] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.talent-upload button:disabled, .talent-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.talent-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.talent-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-4); border: 1px solid var(--status-warn); border-radius: var(--radius-md); }
.talent-confirm p { flex-basis: 100%; margin: 0; color: var(--ink); }
.talent-history li { color: var(--muted); font-size: var(--text-sm); }
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1020 pruebas, 0 fallos.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/talent apps/raxi-hq/tests/talent.test.tsx
git commit -m "feat(talento): páginas de talento con ficha 360, identidad y bloqueo en dos pasos"
```

---

### Tarea 5: Rutas, navegación y enlaces desde la portada

**Archivos:**
- Modificar: `apps/raxi-hq/src/auth/AuthRoutes.tsx`, `apps/raxi-hq/src/agency/AgencyNav.tsx`, `apps/raxi-hq/src/agency/AgenciaPage.tsx`, `apps/raxi-hq/tests/agency.test.tsx`

- [ ] **Paso 1: Actualizar la prueba de la navegación (cambio de requisito)**

En `apps/raxi-hq/tests/agency.test.tsx`, en la prueba `agency nav: five sections, the current one is marked`, cambia el nombre a `agency nav: six sections, the current one is marked` y sus dos listas esperadas por:

```tsx
  assert.deepEqual(AGENCY_SECTIONS.map((s) => [s.to, s.label]), [['/', 'Agencia'], ['/talento', 'Talento'], ['/fototeca', 'Fototeca'], ['/multimedia', 'Archivo'], ['/conexiones', 'Conexiones'], ['/estudio', 'Estudio en vivo']]);
```

```tsx
  assert.deepEqual(links.map((a) => a.props.href), ['/', '/talento', '/fototeca', '/multimedia', '/conexiones', '/estudio']);
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: falla solo `agency nav: six sections…`.

- [ ] **Paso 3: Implementar**

En `AgencyNav.tsx`, añade `{ to: '/talento', label: 'Talento' },` justo después de la entrada `'/'`.

En `AuthRoutes.tsx`, bajo `const Agencia = lazy(...)` añade

```tsx
const Talento = lazy(() => import('../talent/TalentoRoute'));
```

y bajo la ruta `/estudio`:

```tsx
      <Route path="/talento" element={<Suspense fallback={<Loading />}><Talento /></Suspense>} />
      <Route path="/talento/:id" element={<Suspense fallback={<Loading />}><Talento /></Suspense>} />
```

En `AgenciaPage.tsx`, convierte el nombre de cada talento en enlace a su ficha. Cambia

```tsx
              <h3 className="agency-talent-name">{t.name}</h3>
```

por

```tsx
              <h3 className="agency-talent-name"><Link to={`/talento/${t.id}`}>{t.name}</Link></h3>
```

y añade al final de `agency.css`:

```css
.agency-talent-name a { color: inherit; text-decoration: none; }
.agency-talent-name a:hover { color: var(--accent); }
.agency-talent-name a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Paso 4: Verificar todo**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run build 2>&1 | tail -2
```

Esperado: 1020 pruebas, 0 fallos y build correcto.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src apps/raxi-hq/tests/agency.test.tsx
git commit -m "feat(talento): sección Talento en la navegación y fichas enlazadas desde la portada"
```

---

### Tarea 6: Staging y aceptación (requiere a Luis)

Nada de esta tarea se ejecuta sin la autorización explícita de Luis. Solo staging.

- [ ] **Paso 1:** aplicar la migración y desplegar `talent-reference` (`verify_jwt = true`).
- [ ] **Paso 2:** comprobar permisos: `anon` sin acceso a la tabla ni a las funciones; `authenticated` solo `SELECT` en la tabla y `EXECUTE` en las dos RPCs. Revisar los advisors (se espera el mismo aviso que ya tienen las otras RPCs de dueño, como `raxi_portfolio_decide`).
- [ ] **Paso 3:** probar el ciclo guardar borrador → bloquear dentro de una transacción revertida, como en Conexiones.
- [ ] **Paso 4:** Luis sube la ficha con ropa de Raxi (frente, perfil, tres cuartos, espalda y la ficha completa) y revisa el texto propuesto abajo antes de bloquear.
- [ ] **Paso 5:** cuando Luis tenga la ficha nueva de Vesper, la sube igual. Antes de bloquear su identidad, Luis decide si el texto nuevo reemplaza su prompt fijo actual de 632 caracteres.
- [ ] **Paso 6:** abrir el PR `feat/v11-talento` → base que corresponda según lo fusionado.

**Texto de identidad propuesto para Raxi (borrador; Luis lo edita antes de bloquear).** Parte del texto que devuelve Aria, corregido con la revisión visual de la ficha:

```text
A regular quality phone photo of a 25-year-old woman named Raxi Vox. Oval face, straight nose, natural medium lips,
warm brown almond-shaped eyes. Long black wavy hair parted in the middle with teal highlights and a few lilac strands.
Light skin with natural texture, visible pores and soft freckles across the nose and cheeks. Small mole near the
corner of the upper lip. Slim, athletic build, about 168 cm, natural confident posture. Realistic smartphone photo,
natural lighting, never plastic-looking skin.
```

Marcas propuestas: "Pecas suaves en nariz y mejillas", "Lunar pequeño junto a la comisura del labio superior", "Lunar en el muslo". Accesorios: ninguno.

---

## Autorrevisión del plan

- **Cobertura:** ficha 360 por ángulos, texto de identidad, marcas, accesorios, versiones, bloqueo con confirmación y conexión con el prompt fijo existente. Raxi y Vesper siempre visibles.
- **Fuera de M1:** generar fichas 360 nuevas con IA, la orden de serie, WaveSpeed, el libro de costos y el MCP (M2 y M3).
- **Decisión que este plan toma y Luis debe confirmar:** bloquear una identidad **reemplaza** el prompt fijo que hoy usa Producción con Aria. Es lo que da consistencia entre Aria y WaveSpeed; la alternativa sería mantener dos textos separados.
- **Riesgos:** (1) `supabase.functions.invoke` debe enviar `FormData` como multipart: se verifica en staging en la Tarea 6, y si no, se cambia a `fetch` con el token de sesión; (2) las RPCs de dueño quedan ejecutables por `authenticated`, igual que las existentes, con la comprobación de dueño dentro; (3) los recuentos de pruebas suponen la base `feat/v11-agencia` con 1006 pruebas.
- **Consistencia de nombres:** `raxi_identity_versions`, `raxi_identity_save_draft`, `raxi_identity_lock`, `talent-reference`, `buildTalentProfile`, `canLock`, `TalentProfilePage`, `TalentoRoute` se usan igual en todas las tareas.
