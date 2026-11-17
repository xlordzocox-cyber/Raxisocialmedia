# Rediseño estilo agencia — Fase 1 (fundamentos, navegación y portada) — Plan de implementación

> **Para quien ejecute esto:** usa `superpowers:subagent-driven-development` (o `executing-plans`) y sigue las tareas en orden. Cada paso lleva casilla `- [ ]`.
> **Estado:** PLAN PROPUESTO. No hay código escrito. Requiere el visto bueno de Luis antes de ejecutarse.

**Objetivo:** que Raxi HQ abra en una portada "Agencia" con estilo editorial, con una navegación común en todas las páginas, sobre un sistema de tokens y fuentes multiplataforma, sin perder nada de lo que hoy funciona.

**Arquitectura:** se amplía `design/tokens.css` y dos pruebas vigilan el CSS (toda variable usada existe; el número de colores escritos a mano no crece). Un componente `AgencyNav` reemplaza los enlaces sueltos de cada página. La portada `AgenciaPage` es de solo lectura: reutiliza `buildPortfolio` y `buildMedia` sobre las mismas tablas que ya leen Fototeca y Multimedia. La oficina actual se muda sin cambios de `/` a `/estudio`.

**Stack:** React 19 + react-router 7 (Vite), CSS plano con variables, `@fontsource-variable/inter` y `@fontsource-variable/fraunces` (verificado en npm el 2026-11-16: versión 5.3.0, licencia OFL-1.1), pruebas con `node --test` + `react-test-renderer`.

**Rama base:** `feat/claude-team-office` con el PR #81 (Conexiones) ya fusionado. Si aún no lo está, parte de `feat/v11-conexiones`. Rama de trabajo: `feat/v11-agencia`.

**Diseño aprobado:** `docs/superpowers/specs/2026-11-16-agency-redesign-design.md` y la maqueta "Raxi HQ — Portada Agencia".

**Alcance de esta fase y lo que queda para la Fase 2:**

| Fase 1 (este plan) | Fase 2 (plan aparte) |
|---|---|
| Tokens, fuentes y pruebas guardianas | Migrar a tokens los colores de `global.css` y `campus.css` |
| `AgencyNav` en todas las páginas | Página Talento con ficha por modelo |
| Portada Agencia con datos reales | Restyling editorial de Fototeca y Multimedia |
| Oficina en `/estudio` | Página Equipo y gasto del mes (depende del Módulo de Creación) |

**Reglas que ninguna tarea puede romper:**
1. Las pruebas existentes de `fototeca`, `multimedia`, `connections`, `officeUX` y `auth` siguen en verde sin tocar sus aserciones.
2. La portada no escribe nada: ninguna RPC salvo `raxi_get_workspace`, ninguna generación, ningún costo.
3. La portada no muestra datos inventados. Lo que aún no existe (gasto del mes, equipo) no aparece.
4. Solo se muestran como portada de talento fotos con nivel `PUBLIC`.
5. No se toca la escena PixiJS ni sus textos.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `apps/raxi-hq/src/design/tokens.css` (modificar) | Sistema de tokens completo |
| `apps/raxi-hq/src/design/global.css` (modificar) | Corregir `var(--text)`; fuente por token |
| `apps/raxi-hq/src/main.tsx` (modificar) | Importar las fuentes |
| `apps/raxi-hq/src/agency/AgencyNav.tsx` (nuevo) | Navegación común |
| `apps/raxi-hq/src/agency/agencyModel.ts` (nuevo) | Vista pura de la portada |
| `apps/raxi-hq/src/agency/AgenciaPage.tsx`, `AgenciaRoute.tsx` (nuevos) | Portada |
| `apps/raxi-hq/src/agency/agency.css` (nuevo) | Estilos, solo con tokens |
| `apps/raxi-hq/src/auth/AuthRoutes.tsx` (modificar) | `/` → Agencia, `/estudio` → oficina |
| `apps/raxi-hq/src/App.tsx`, `portfolio/FototecaPage.tsx`, `portfolio/MultimediaPage.tsx`, `connections/ConexionesPage.tsx` (modificar) | Usar `AgencyNav` |
| `apps/raxi-hq/tests/designTokens.test.ts`, `tests/agency.test.tsx` (nuevos) | Pruebas |
| `apps/raxi-hq/scripts/test.mjs` (modificar) | Registrar las dos pruebas |

---

### Tarea 0: Rama y línea base

- [ ] **Paso 1**

```bash
git fetch origin feat/claude-team-office
git switch -c feat/v11-agencia origin/feat/claude-team-office
git log --oneline -8 | grep -q "conexiones" || echo "FALTA Conexiones: parte de origin/feat/v11-conexiones"
cd apps/raxi-hq && npm ci && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
```

Esperado: 996 pruebas, 0 fallos. Si falta Conexiones, recrea la rama desde `origin/feat/v11-conexiones`.

---

### Tarea 1: Tokens y pruebas guardianas del CSS

**Archivos:**
- Crear: `apps/raxi-hq/tests/designTokens.test.ts`
- Modificar: `apps/raxi-hq/src/design/tokens.css`, `apps/raxi-hq/src/design/global.css`, `apps/raxi-hq/scripts/test.mjs`

- [ ] **Paso 1: Escribir las pruebas que fallan**

`apps/raxi-hq/tests/designTokens.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : []);
}
const files = cssFiles(SRC).map((path) => ({ name: relative(SRC, path).replaceAll('\\', '/'), css: readFileSync(path, 'utf8') }));
const tokens = files.find((f) => f.name === 'design/tokens.css')!.css;
const defined = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

test('design tokens: the full system is declared once in tokens.css', () => {
  const have = defined(tokens);
  for (const t of ['--bg', '--panel', '--ink', '--muted', '--accent', '--surface-2', '--border', '--border-strong', '--accent-ink',
    '--status-ok', '--status-warn', '--status-danger', '--font-ui', '--font-display', '--text-xs', '--text-sm', '--text-md', '--text-lg',
    '--text-xl', '--text-2xl', '--text-display', '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
    '--space-8', '--radius-sm', '--radius-md', '--radius-pill', '--shadow-1', '--ease', '--dur-fast']) assert.ok(have.has(t), `missing ${t}`);
});

test('design tokens: every CSS variable in use is defined', () => {
  const global = defined(tokens);
  for (const f of files) {
    const local = defined(f.css);
    for (const [, name] of f.css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(global.has(name) || local.has(name), `${f.name} uses undefined ${name}`);
  }
});

// Ratchet: hand-written hex colors may only go down. New stylesheets start at zero.
const HEX_BUDGET: Record<string, number> = { 'design/global.css': 98, 'campus/campus.css': 214, 'portfolio/fototeca.css': 15 };
test('design tokens: hand-written colors never increase outside tokens.css', () => {
  for (const f of files) {
    if (f.name === 'design/tokens.css') continue;
    const count = (f.css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length;
    assert.ok(count <= (HEX_BUDGET[f.name] ?? 0), `${f.name}: ${count} hex colors, budget ${HEX_BUDGET[f.name] ?? 0}. Use a token.`);
  }
});
```

En `apps/raxi-hq/scripts/test.mjs`, añade `'designTokens.test.ts'` a `entries` después de `'connections.test.tsx'`.

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: fallan `the full system is declared once` (falta `--surface-2`) y `every CSS variable in use is defined` (`design/global.css uses undefined --text`). La prueba del presupuesto de colores pasa.

- [ ] **Paso 3: Implementar**

Reemplaza todo `apps/raxi-hq/src/design/tokens.css` por:

```css
:root {
  /* Color: surfaces and text (the first five names are the original tokens and stay). */
  --bg: #090d18; --panel: #121a2a; --ink: #f4f7ff; --muted: #99a3b8; --accent: #35e7ff;
  --surface-2: #18233a; --border: #29364d; --border-strong: #496180; --accent-ink: #06121a;
  --status-ok: #6ee7a8; --status-warn: #f0b45a; --status-danger: #ffb4b4;
  /* Type */
  --font-ui: 'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-display: 'Fraunces Variable', Georgia, 'Times New Roman', serif;
  --text-xs: 12px; --text-sm: 14px; --text-md: 16px; --text-lg: 20px; --text-xl: 28px; --text-2xl: 36px;
  --text-display: clamp(2.4rem, 6vw, 4rem);
  /* Space, shape, depth, motion */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 72px;
  --radius-sm: 8px; --radius-md: 12px; --radius-pill: 999px;
  --shadow-1: 0 8px 24px rgb(0 0 0 / 0.35);
  --ease: cubic-bezier(0.2, 0, 0, 1); --dur-fast: 120ms;
}
```

En `apps/raxi-hq/src/design/global.css`:
- en la regla `.task-board-filters select`, cambia `color: var(--text);` por `color: var(--ink);`;
- en la regla `body`, cambia `font-family: 'Segoe UI', sans-serif;` por `font-family: var(--font-ui);`.

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 999 pruebas, 0 fallos.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/design apps/raxi-hq/tests/designTokens.test.ts apps/raxi-hq/scripts/test.mjs
git commit -m "feat(design): sistema de tokens y pruebas guardianas del CSS"
```

---

### Tarea 2: Fuentes multiplataforma

**Archivos:**
- Modificar: `apps/raxi-hq/package.json`, `apps/raxi-hq/package-lock.json`, `apps/raxi-hq/src/main.tsx`

- [ ] **Paso 1: Instalar las fuentes (autoalojadas, sin peticiones a terceros)**

```bash
cd apps/raxi-hq && npm install @fontsource-variable/inter@5.3.0 @fontsource-variable/fraunces@5.3.0
grep -o "font-family: '[^']*'" node_modules/@fontsource-variable/inter/index.css | sort -u
grep -o "font-family: '[^']*'" node_modules/@fontsource-variable/fraunces/index.css | sort -u
```

Esperado: `font-family: 'Inter Variable'` y `font-family: 'Fraunces Variable'`. **Si los nombres difieren, corrige `--font-ui` y `--font-display` en `tokens.css` para que coincidan exactamente** antes de seguir.

- [ ] **Paso 2: Cargarlas**

En `apps/raxi-hq/src/main.tsx`, justo antes de `import './design/tokens.css';`, añade:

```ts
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
```

- [ ] **Paso 3: Verificar**

```bash
cd apps/raxi-hq && npm run typecheck && npm run build 2>&1 | tail -4 && ls dist/assets | grep -ci "woff2"
```

Esperado: build correcto y un número mayor que 0 (los archivos de fuente están en el bundle).

- [ ] **Paso 4: Commit**

```bash
git add apps/raxi-hq/package.json apps/raxi-hq/package-lock.json apps/raxi-hq/src/main.tsx
git commit -m "feat(design): Inter y Fraunces autoalojadas en lugar de Segoe UI"
```

---

### Tarea 3: Navegación común `AgencyNav`

**Archivos:**
- Crear: `apps/raxi-hq/src/agency/AgencyNav.tsx`, `apps/raxi-hq/src/agency/agency.css`, `apps/raxi-hq/tests/agency.test.tsx`
- Modificar: `apps/raxi-hq/scripts/test.mjs`

- [ ] **Paso 1: Escribir la prueba que falla**

`apps/raxi-hq/tests/agency.test.tsx`:

```tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { AgencyNav, AGENCY_SECTIONS } from '../src/agency/AgencyNav';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

test('agency nav: five sections, the current one is marked', async () => {
  assert.deepEqual(AGENCY_SECTIONS.map((s) => [s.to, s.label]), [['/', 'Agencia'], ['/fototeca', 'Fototeca'], ['/multimedia', 'Archivo'], ['/conexiones', 'Conexiones'], ['/estudio', 'Estudio en vivo']]);
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter initialEntries={['/fototeca']}><AgencyNav /></MemoryRouter>); });
  const links = r.root.findAllByType('a');
  assert.deepEqual(links.map((a) => a.props.href), ['/', '/fototeca', '/multimedia', '/conexiones', '/estudio']);
  assert.deepEqual(links.filter((a) => a.props['aria-current'] === 'page').map((a) => a.props.href), ['/fototeca']);
  assert.equal(r.root.findByType('nav').props['aria-label'], 'Secciones de la agencia');
});
```

En `apps/raxi-hq/scripts/test.mjs`, añade `'agency.test.tsx'` a `entries` después de `'designTokens.test.ts'`.

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve "../src/agency/AgencyNav"`).

- [ ] **Paso 3: Implementar**

`apps/raxi-hq/src/agency/AgencyNav.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import './agency.css';

export const AGENCY_SECTIONS = [
  { to: '/', label: 'Agencia' },
  { to: '/fototeca', label: 'Fototeca' },
  { to: '/multimedia', label: 'Archivo' },
  { to: '/conexiones', label: 'Conexiones' },
  { to: '/estudio', label: 'Estudio en vivo' },
] as const;

/** Shared navigation for every protected page. Presentation only: no data, no writes. */
export function AgencyNav() {
  return <nav className="agency-nav" aria-label="Secciones de la agencia">
    {AGENCY_SECTIONS.map((s) => <NavLink key={s.to} to={s.to} end={s.to === '/'} className="agency-nav-link">{s.label}</NavLink>)}
  </nav>;
}
```

`apps/raxi-hq/src/agency/agency.css`:

```css
.agency-nav { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-5); font-family: var(--font-ui); font-size: var(--text-sm); }
.agency-nav-link { display: inline-flex; align-items: center; min-height: 44px; color: var(--muted); text-decoration: none; border-bottom: 2px solid transparent; transition: color var(--dur-fast) var(--ease); }
.agency-nav-link:hover { color: var(--accent); }
.agency-nav-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.agency-nav-link[aria-current='page'] { color: var(--ink); font-weight: 600; border-bottom-color: var(--accent); }
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1000 pruebas, 0 fallos (incluida la del presupuesto de colores: `agency/agency.css` tiene 0).

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/agency apps/raxi-hq/tests/agency.test.tsx apps/raxi-hq/scripts/test.mjs
git commit -m "feat(agencia): navegación común AgencyNav"
```

---

### Tarea 4: Modelo puro de la portada

**Archivos:**
- Crear: `apps/raxi-hq/src/agency/agencyModel.ts`
- Modificar: `apps/raxi-hq/tests/agency.test.tsx`

- [ ] **Paso 1: Escribir la prueba que falla**

Añade a `apps/raxi-hq/tests/agency.test.tsx` (los `import` van al inicio del archivo):

```tsx
import { buildPortfolio } from '../src/portfolio/portfolioModel';
import { buildMedia } from '../src/portfolio/mediaModel';
import { buildAgency } from '../src/agency/agencyModel';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ws = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sha = 'a'.repeat(64);
const collections = [
  { id: 'c1', workspace_id: ws, external_id: 'VESPER-1', character_id: 'vesper-corvus', title: 'Una noche', channel: 'INSTAGRAM', status: 'IN_REVIEW', concept: null, created_at: '2026-11-15T08:00:00Z' },
  { id: 'c2', workspace_id: ws, external_id: 'RAXI-1', character_id: 'raxi-vox', title: 'Setup nuevo', channel: 'INSTAGRAM', status: 'PUBLISHED', concept: null, created_at: '2026-11-10T08:00:00Z' },
];
const item = (id: string, collection: string, position: number, extra: Record<string, unknown> = {}) => ({
  id, workspace_id: ws, collection_id: collection, position, asset_id: 'a' + position, caption: '', alt_text: '', hashtags: [], crop: '4:5',
  qa_status: 'PRELIMINARY_PASS', qa_notes: null, human_decision: 'PENDING', status: 'DRAFT', published_url: null, ...extra,
});
const items = [
  item('i1', 'c1', 1), item('i2', 'c1', 2, { qa_status: 'NEEDS_FIX' }), item('i3', 'c1', 3, { human_decision: 'APPROVED', status: 'READY' }),
  item('i4', 'c2', 4, { human_decision: 'APPROVED', status: 'PUBLISHED', published_url: 'https://www.instagram.com/p/x/' }),
];
const asset = (n: number, created: string, character: string, level?: string) => ({
  id: 'a' + n, workspace_id: ws, object_path: `${ws}/a${n}/original.jpg`, mime_type: 'image/jpeg', sha256: sha, byte_size: 1000,
  external_asset_id: `f${n}.jpg`, metadata: { character_id: character, ...(level ? { content_level: level } : {}) }, created_at: created,
});
const assets = [
  asset(1, '2026-11-15T10:00:00Z', 'vesper-corvus', 'PUBLIC'), asset(2, '2026-11-16T10:00:00Z', 'vesper-corvus', 'NSFW'),
  asset(3, '2026-11-14T10:00:00Z', 'vesper-corvus', 'PUBLIC'), asset(4, '2026-11-12T10:00:00Z', 'raxi-vox'),
];
const overview = () => buildAgency(buildPortfolio(ws, collections, items, assets), buildMedia(ws, assets, items, collections));

test('agency model: what needs Luis, without inventing work', () => {
  const a = overview();
  assert.deepEqual(a.pending.map((p) => [p.itemId, p.kind, p.collectionTitle]), [['i1', 'DECIDE', 'Una noche'], ['i2', 'FIX', 'Una noche']]);
  assert.equal(a.pending[0].assetPath, `${ws}/a1/original.jpg`);
});

test('agency model: productions in progress exclude finished campaigns', () => {
  const a = overview();
  assert.deepEqual(a.productions, [{ id: 'c1', title: 'Una noche', channel: 'INSTAGRAM', character: 'Vesper Corvus', total: 3, approved: 1, published: 0, blocked: 1 }]);
});

test('agency model: talent covers are public-only and newest first', () => {
  const a = overview();
  assert.deepEqual(a.talent, [
    { id: 'raxi-vox', name: 'Raxi Vox', photos: 1, campaigns: 1, coverPath: null },
    { id: 'vesper-corvus', name: 'Vesper Corvus', photos: 3, campaigns: 1, coverPath: `${ws}/a1/original.jpg` },
  ]);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve "../src/agency/agencyModel"`).

- [ ] **Paso 3: Implementar**

`apps/raxi-hq/src/agency/agencyModel.ts`:

```ts
// Agencia: pure read model for the home page, derived only from the validated Fototeca and Multimedia views.
import { canApprove, progress, type PortfolioView } from '../portfolio/portfolioModel';
import { characterLabel, type MediaView } from '../portfolio/mediaModel';

export interface AgencyPending { itemId: string; kind: 'DECIDE' | 'FIX'; collectionId: string; collectionTitle: string; position: number; assetPath: string | null }
export interface AgencyProduction { id: string; title: string; channel: string; character: string; total: number; approved: number; published: number; blocked: number }
export interface AgencyTalent { id: string; name: string; photos: number; campaigns: number; coverPath: string | null }
export interface AgencyView { pending: AgencyPending[]; productions: AgencyProduction[]; talent: AgencyTalent[] }

const FINISHED = new Set(['PUBLISHED', 'ARCHIVED']);

export function buildAgency(portfolio: PortfolioView, media: MediaView): AgencyView {
  const open = portfolio.collections.filter((c) => !FINISHED.has(c.status));
  const pending: AgencyPending[] = open.flatMap((c) => c.items.flatMap((i): AgencyPending[] => {
    if (i.decision !== 'PENDING' || i.status === 'PUBLISHED') return [];
    const blocked = i.qaStatus === 'NEEDS_FIX' || i.qaStatus === 'FAIL';
    if (!blocked && !canApprove(i)) return [];
    return [{ itemId: i.id, kind: blocked ? 'FIX' : 'DECIDE', collectionId: c.id, collectionTitle: c.title, position: i.position, assetPath: i.asset?.objectPath ?? null }];
  }));
  const productions = open.map((c) => ({ id: c.id, title: c.title, channel: c.channel, character: characterLabel(c.characterId), ...progress(c.items) }));
  const ids = [...new Set([...portfolio.collections.map((c) => c.characterId), ...media.characters])].sort();
  const talent = ids.map((id): AgencyTalent => {
    const photos = media.assets.filter((a) => a.characterId === id);
    return {
      id, name: characterLabel(id), photos: photos.length,
      campaigns: portfolio.collections.filter((c) => c.characterId === id).length,
      coverPath: photos.find((a) => a.level === 'PUBLIC')?.objectPath ?? null, // media.assets is newest first
    };
  });
  return { pending, productions, talent };
}
```

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1003 pruebas, 0 fallos.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/agency/agencyModel.ts apps/raxi-hq/tests/agency.test.tsx
git commit -m "feat(agencia): modelo de la portada derivado de Fototeca y Multimedia"
```

---

### Tarea 5: Portada Agencia

**Archivos:**
- Crear: `apps/raxi-hq/src/agency/AgenciaPage.tsx`, `apps/raxi-hq/src/agency/AgenciaRoute.tsx`
- Modificar: `apps/raxi-hq/src/agency/agency.css`, `apps/raxi-hq/tests/agency.test.tsx`

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade a `apps/raxi-hq/tests/agency.test.tsx`:

```tsx
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgenciaPage } from '../src/agency/AgenciaPage';

function fakeClient(tables: Record<string, unknown[]>) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => { calls.push('rpc:' + name); return { data: { id: ws, ownerId: owner, name: 'raxi-hq' }, error: null }; },
    from: (name: string) => ({ select: () => ({ eq: async () => ({ data: tables[name], error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: 'https://signed.example/' + p })), error: null }) }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const render = async (client: SupabaseClient) => {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<MemoryRouter><AgenciaPage client={client} ownerId={owner} /></MemoryRouter>); await new Promise((res) => setTimeout(res, 20)); });
  return r;
};

test('Agencia page: shows pending decisions, productions and talent, read-only', async () => {
  const { client, calls } = fakeClient({ raxi_portfolio_collections: collections, raxi_portfolio_items: items, raxi_assets: assets });
  const r = await render(client);
  const text = JSON.stringify(r.toJSON());
  assert.match(text, /2 decisiones esperan por ti/);
  assert.match(text, /Una noche/);
  assert.match(text, /Vesper Corvus/);
  assert.match(text, /Raxi Vox/);
  assert.ok(!text.includes('Setup nuevo'), 'finished campaigns are not in progress');
  assert.deepEqual(r.root.findAllByType('img').map((i) => i.props.src).filter((s: string) => s.includes('/a2/')), [], 'NSFW asset never used as a cover');
  assert.ok(r.root.findAllByType('img').every((i) => typeof i.props.alt === 'string' && i.props.alt.length > 0));
  assert.deepEqual(calls, ['rpc:raxi_get_workspace'], 'no write RPCs');
});

test('Agencia page: empty workspace says so instead of inventing content', async () => {
  const { client } = fakeClient({ raxi_portfolio_collections: [], raxi_portfolio_items: [], raxi_assets: [] });
  const text = JSON.stringify((await render(client)).toJSON());
  assert.match(text, /Nada espera tu decisión/);
  assert.match(text, /Aún no hay producciones en curso/);
});
```

- [ ] **Paso 2: Ejecutar y ver que falla**

```bash
cd apps/raxi-hq && npm test 2>&1 | tail -6
```

Esperado: FALLA al compilar (`Could not resolve "../src/agency/AgenciaPage"`).

- [ ] **Paso 3: Implementar**

`apps/raxi-hq/src/agency/AgenciaPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseWorkspace } from '../persistence/supabaseIdeaRepository';
import { buildPortfolio } from '../portfolio/portfolioModel';
import { buildMedia } from '../portfolio/mediaModel';
import { AgencyNav } from './AgencyNav';
import { buildAgency, type AgencyView } from './agencyModel';
import './agency.css';

const BUCKET = 'raxi-hq-private';
type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; view: AgencyView; urls: Record<string, string> };
const CHANNEL_LABEL: Record<string, string> = { INSTAGRAM: 'Instagram', INSTAGRAM_STORY: 'Stories', TEASER: 'Teaser', FANVUE_FEED: 'FanView feed', FANVUE_CHAT: 'FanView chatting' };

/** Owner-only reads (RLS). Read-only page: no writes, no generation, no cost. */
export async function loadAgency(client: SupabaseClient, ownerId: string): Promise<{ view: AgencyView; urls: Record<string, string> }> {
  const ws = await client.rpc('raxi_get_workspace');
  if (ws.error || !ws.data) throw new Error('No se encontró tu workspace.');
  const workspaceId = parseWorkspace(ws.data, ownerId).id;
  const [c, i, a] = await Promise.all([
    client.from('raxi_portfolio_collections').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_portfolio_items').select('*').eq('workspace_id', workspaceId),
    client.from('raxi_assets').select('id,workspace_id,object_path,mime_type,sha256,byte_size,external_asset_id,metadata,created_at').eq('workspace_id', workspaceId),
  ]);
  if (c.error || i.error || a.error) throw new Error('No se pudo leer la agencia.');
  const view = buildAgency(buildPortfolio(workspaceId, c.data, i.data, a.data), buildMedia(workspaceId, a.data, i.data, c.data));
  const paths = [...new Set(view.talent.flatMap((t) => (t.coverPath ? [t.coverPath] : [])))];
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data } = await client.storage.from(BUCKET).createSignedUrls(paths, 60 * 30);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  }
  return { view, urls };
}

export function AgenciaPage({ client, ownerId }: { client: SupabaseClient; ownerId: string }) {
  const [state, setState] = useState<Load>({ phase: 'loading' });
  useEffect(() => {
    let alive = true;
    loadAgency(client, ownerId)
      .then((r) => { if (alive) setState({ phase: 'ready', ...r }); })
      .catch((cause) => { if (alive) setState({ phase: 'error', message: cause instanceof Error ? cause.message : 'No se pudo leer la agencia.' }); });
    return () => { alive = false; };
  }, [client, ownerId]);

  return <div className="agency">
    <header className="agency-header"><Link to="/" className="agency-brand">Raxi HQ</Link><AgencyNav /></header>
    <main className="agency-main">
      {state.phase === 'loading' && <p role="status">Cargando la agencia…</p>}
      {state.phase === 'error' && <p role="alert">{state.message}</p>}
      {state.phase === 'ready' && <>
        <section className="agency-hero">
          <p className="agency-eyebrow">Agencia</p>
          <h1>Tu agencia, hoy</h1>
          <p className="agency-lead">{state.view.pending.length === 0 ? 'Nada espera tu decisión.' : state.view.pending.length === 1 ? '1 decisión espera por ti.' : `${state.view.pending.length} decisiones esperan por ti.`}</p>
        </section>

        <section aria-labelledby="ag-toca" className="agency-section">
          <h2 id="ag-toca">Te toca</h2>
          {state.view.pending.length === 0 ? <p className="agency-empty">Todo lo pendiente está decidido.</p> : <ul className="agency-cards">
            {state.view.pending.slice(0, 6).map((p) => <li key={p.itemId} className="agency-card">
              <p className={`agency-tag agency-tag-${p.kind.toLowerCase()}`}>{p.kind === 'FIX' ? 'QA pide corrección' : 'Lista para tu decisión'}</p>
              <h3>{p.collectionTitle}</h3>
              <p className="agency-meta">Foto {p.position}</p>
              <Link to="/fototeca" className="agency-action">Revisar en Fototeca</Link>
            </li>)}
          </ul>}
          {state.view.pending.length > 6 && <p className="agency-meta">Y {state.view.pending.length - 6} más en la Fototeca.</p>}
        </section>

        <section aria-labelledby="ag-talento" className="agency-section">
          <h2 id="ag-talento">Talento</h2>
          {state.view.talent.length === 0 ? <p className="agency-empty">Aún no hay modelos con fotos archivadas.</p> : <ul className="agency-talent">
            {state.view.talent.map((t) => <li key={t.id}>
              {t.coverPath && state.urls[t.coverPath]
                ? <img src={state.urls[t.coverPath]} alt={`Foto reciente de ${t.name}`} className="agency-cover" loading="lazy" />
                : <div className="agency-cover agency-cover-empty" role="img" aria-label={`${t.name}: sin foto pública archivada`} />}
              <h3 className="agency-talent-name">{t.name}</h3>
              <p className="agency-meta">{t.photos} {t.photos === 1 ? 'foto' : 'fotos'} en archivo · {t.campaigns} {t.campaigns === 1 ? 'campaña' : 'campañas'}</p>
            </li>)}
          </ul>}
        </section>

        <section aria-labelledby="ag-prod" className="agency-section">
          <h2 id="ag-prod">Producción en curso</h2>
          {state.view.productions.length === 0 ? <p className="agency-empty">Aún no hay producciones en curso.</p> : <ul className="agency-cards">
            {state.view.productions.map((p) => <li key={p.id} className="agency-card">
              <p className="agency-tag">{p.character} · {CHANNEL_LABEL[p.channel] ?? p.channel}</p>
              <h3>{p.title}</h3>
              <p className="agency-meta">{p.approved} de {p.total} aprobadas · {p.published} publicadas{p.blocked > 0 ? ` · ${p.blocked} por corregir` : ''}</p>
              <div className="agency-bar" role="img" aria-label={`${p.approved} de ${p.total} fotos aprobadas`}><span style={{ width: `${p.total ? Math.round((p.approved / p.total) * 100) : 0}%` }} /></div>
              <Link to="/fototeca" className="agency-action">Abrir en Fototeca</Link>
            </li>)}
          </ul>}
        </section>
      </>}
    </main>
  </div>;
}
```

`apps/raxi-hq/src/agency/AgenciaRoute.tsx`:

```tsx
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../auth/client';
import { AgenciaPage } from './AgenciaPage';

export default function AgenciaRoute() {
  const { user } = useAuth();
  if (!supabase || !user) return <main className="agency-main"><p role="alert">La agencia necesita una sesión conectada a Supabase.</p></main>;
  return <AgenciaPage key={user.id} client={supabase} ownerId={user.id} />;
}
```

Añade al final de `apps/raxi-hq/src/agency/agency.css`:

```css
.agency { min-height: 100vh; background: var(--bg); color: var(--ink); font-family: var(--font-ui); font-size: var(--text-md); line-height: 1.5; }
.agency-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3) var(--space-6); max-width: 1240px; margin: 0 auto; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border); }
.agency-brand { font-family: var(--font-display); font-size: var(--text-xl); color: var(--ink); text-decoration: none; }
.agency-main { max-width: 1240px; margin: 0 auto; padding: var(--space-7) var(--space-5) var(--space-8); display: flex; flex-direction: column; gap: var(--space-8); }
.agency-hero { display: flex; flex-direction: column; gap: var(--space-3); max-width: 820px; }
.agency-hero h1 { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: var(--text-display); line-height: 1.05; }
.agency-eyebrow { margin: 0; font-size: var(--text-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.agency-lead { margin: 0; font-size: var(--text-lg); color: var(--ink); }
.agency-section { display: flex; flex-direction: column; gap: var(--space-5); }
.agency-section h2 { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: var(--text-xl); }
.agency-section h3 { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.agency-cards, .agency-talent { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-5); }
.agency-cards { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.agency-talent { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-6); }
.agency-talent li { display: flex; flex-direction: column; gap: var(--space-3); }
.agency-card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-md); }
.agency-tag { margin: 0; font-size: var(--text-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.agency-tag-fix { color: var(--status-warn); }
.agency-meta, .agency-empty { margin: 0; font-size: var(--text-sm); color: var(--muted); }
.agency-action { margin-top: auto; align-self: flex-start; display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--ink); text-decoration: none; font-weight: 600; font-size: var(--text-sm); }
.agency-action:hover { border-color: var(--accent); color: var(--accent); }
.agency-action:focus-visible, .agency-brand:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.agency-cover { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; object-position: top; border-radius: var(--radius-md); display: block; background: var(--surface-2); }
.agency-cover-empty { border: 1px dashed var(--border-strong); }
.agency-talent-name { font-family: var(--font-display); font-weight: 400; font-size: var(--text-2xl); line-height: 1.1; }
.agency-bar { height: 6px; border-radius: var(--radius-pill); background: var(--border); overflow: hidden; }
.agency-bar span { display: block; height: 100%; background: var(--accent); }
```

Nota: `.agency-section h3` y `.agency-talent-name` conviven; la segunda gana por ir después. Si en la revisión visual el nombre no sale en serif, sube su especificidad a `.agency-talent .agency-talent-name`.

- [ ] **Paso 4: Ejecutar y ver que pasa**

```bash
cd apps/raxi-hq && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"
```

Esperado: 1005 pruebas, 0 fallos.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src/agency apps/raxi-hq/tests/agency.test.tsx
git commit -m "feat(agencia): portada de solo lectura con decisiones, talento y producción"
```

---

### Tarea 6: Rutas y navegación en las páginas existentes

**Archivos:**
- Modificar: `apps/raxi-hq/src/auth/AuthRoutes.tsx`, `apps/raxi-hq/src/App.tsx`, `apps/raxi-hq/src/portfolio/FototecaPage.tsx`, `apps/raxi-hq/src/portfolio/MultimediaPage.tsx`, `apps/raxi-hq/src/connections/ConexionesPage.tsx`

- [ ] **Paso 1: Rutas**

En `apps/raxi-hq/src/auth/AuthRoutes.tsx`:

Bajo `const Conexiones = lazy(...)` añade:

```tsx
const Agencia = lazy(() => import('../agency/AgenciaRoute'));
```

Reemplaza

```tsx
      <Route path="/" element={<AuthenticatedOffice />} />
```

por

```tsx
      <Route path="/" element={<Suspense fallback={<Loading />}><Agencia /></Suspense>} />
      <Route path="/estudio" element={<AuthenticatedOffice />} />
```

- [ ] **Paso 2: Oficina (`App.tsx`)**

Añade el import `import { AgencyNav } from './agency/AgencyNav';` y reemplaza estas dos líneas del encabezado

```tsx
        <Link className="hq-nav-link" to="/fototeca">Fototeca</Link>
        <Link className="hq-nav-link" to="/multimedia">Multimedia</Link>
```

por

```tsx
        <AgencyNav />
```

Si `Link` deja de usarse en `App.tsx`, quita su import (el `typecheck` lo indicará).

- [ ] **Paso 3: Fototeca, Multimedia y Conexiones**

En cada archivo añade `import { AgencyNav } from '../agency/AgencyNav';` y reemplaza solo el bloque de enlaces:

`FototecaPage.tsx`:
```tsx
    <div className="hq-session-controls"><Link to="/multimedia">Multimedia</Link><Link to="/conexiones">Conexiones</Link><Link to="/">Oficina</Link></div>
```
→
```tsx
    <AgencyNav />
```

`MultimediaPage.tsx`:
```tsx
    <div className="hq-session-controls"><Link to="/fototeca">Fototeca</Link><Link to="/conexiones">Conexiones</Link><Link to="/">Oficina</Link></div>
```
→
```tsx
    <AgencyNav />
```

`ConexionesPage.tsx`:
```tsx
      <nav aria-label="Secciones" className="hq-session-controls"><Link to="/fototeca">Fototeca</Link><Link to="/multimedia">Multimedia</Link><Link to="/">Oficina</Link></nav>
```
→
```tsx
      <AgencyNav />
```

Quita los imports de `Link` que queden sin uso. No cambies nada más de esas páginas.

- [ ] **Paso 4: Verificar**

```bash
cd apps/raxi-hq && npm run typecheck && npm test 2>&1 | grep -E "^not ok|^# (pass|fail)" && npm run build 2>&1 | tail -3
```

Esperado: tipos correctos, 1005 pruebas y 0 fallos, build correcto. Si falla alguna prueba existente de `fototeca`, `multimedia`, `connections`, `officeUX` o `auth`, **no cambies su aserción**: detente e informa qué esperaba.

- [ ] **Paso 5: Commit**

```bash
git add apps/raxi-hq/src
git commit -m "feat(agencia): portada en /, oficina en /estudio y navegación común en todas las páginas"
```

---

### Tarea 7: Revisión visual con Luis

- [ ] **Paso 1:** subir la rama y esperar la vista previa de Vercel del proyecto `raxi-hq-staging`.
- [ ] **Paso 2:** comprobar que `/`, `/fototeca`, `/multimedia`, `/conexiones` y `/estudio` responden 200 al abrirse directo.
- [ ] **Paso 3:** Luis revisa en su teléfono y en escritorio: portada, navegación, que Fototeca y Multimedia hacen lo mismo que antes, y que la oficina sigue intacta en "Estudio en vivo".
- [ ] **Paso 4:** registrar sus cambios y abrir el PR `feat/v11-agencia` → `feat/claude-team-office`.

---

## Autorrevisión del plan

- **Cobertura del diseño:** tokens, fuentes, corrección de `var(--text)`, navegación de agencia, portada y Estudio en vivo están cubiertos. Talento como página, Equipo, gasto del mes, restyling de Fototeca/Multimedia y la migración de colores quedan para la Fase 2, como indica la tabla de alcance.
- **Diferencias con la maqueta:** sin saludo con nombre y hora ni "gasto de noviembre" (no hay datos todavía); la sección "Te toca" muestra decisiones reales de la Fototeca, no tareas de configuración.
- **Riesgos:** (1) los nombres de familia de las fuentes se comprueban en la Tarea 2 antes de usarlos; (2) alguna prueba existente puede depender de los enlaces antiguos del encabezado: la Tarea 6 obliga a detenerse en vez de editar aserciones; (3) el recuento de pruebas esperado (996 → 1005) supone la base con Conexiones.
- **Consistencia de nombres:** `AgencyNav`, `AGENCY_SECTIONS`, `buildAgency`, `AgencyView`, `loadAgency`, `AgenciaPage`, `AgenciaRoute` se usan igual en todas las tareas.
