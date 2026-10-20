import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import App from '../src/App';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { AuthStore } from '../src/auth/authStore';
import { ProtectedRoute } from '../src/auth/AuthRoutes';
import { RealIdeaStore, type CreateRealIdea, type PersistedIdea, type RealIdeaRepository } from '../src/persistence/realIdeaStore';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });
const storage = new Map<string, string>();
Object.assign(globalThis, { window: {
  setInterval, clearInterval, addEventListener() {}, removeEventListener() {},
  sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } },
} });
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOwner = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const title = 'Captura de prueba de navegación';
const note = 'Solo repositorio de pruebas; ninguna escritura de producción.';

function SessionOffice({ repository, revision }: { repository: (id: string) => RealIdeaRepository; revision: number }) {
  const { user } = useAuth();
  return <App key={`${user!.id}:${revision}`} ideaRepository={repository} />;
}
function fixture() {
  let user: User | null = { id: owner } as User;
  const auth = new AuthStore({
    getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => { user = null; return { error: null }; },
  } as unknown as SupabaseClient['auth']);
  const ledger = new Map<string, PersistedIdea>();
  const commands: CreateRealIdea[] = [];
  const requests: Array<{ cmd: CreateRealIdea; ownerId: string; resolve: (row: PersistedIdea) => void; reject: (error: Error) => void }> = [];
  let visible = true;
  const repository = (ownerId: string): RealIdeaRepository => ({
    findWorkspace: async () => ({ id: `workspace-${ownerId}`, ownerId, name: 'raxi-hq' }),
    createWorkspace: async () => { throw new Error('Workspace already exists'); },
    listIdeas: async () => visible ? [...ledger.values()].filter(row => row.ownerId === ownerId).map(row => structuredClone(row)) : [],
    createIdea: cmd => {
      commands.push(structuredClone(cmd));
      return new Promise((resolve, reject) => requests.push({ cmd: structuredClone(cmd), ownerId, resolve, reject }));
    },
  });
  const complete = (index: number, lost = false) => {
    const request = requests[index]; const { cmd, ownerId } = request;
    let row = ledger.get(cmd.operationId);
    if (!row) {
      row = { databaseId: cmd.externalId.slice(10), workspaceId: cmd.workspaceId, ownerId, auditId: String(ledger.size + 1), provenance: 'MANUAL_LUIS',
        idea: { id: cmd.externalId, title: cmd.input.title, summary: cmd.input.note, priority: cmd.input.priority,
          source: 'MANUAL_LUIS', status: 'PROPOSED', reason: 'Captura manual de prueba', createdAt: '2026-10-20T18:00:00Z', updatedAt: '2026-10-20T18:00:00Z',
          fitScore: 0, confidenceScore: 0, suggestedChannels: [], tags: [], evidence: [] } };
      ledger.set(cmd.operationId, row);
    }
    if (lost) request.reject(new Error('HTTP response lost after commit')); else request.resolve(structuredClone(row));
  };
  let view!: ReactTestRenderer;
  const tree = (revision = 0) => <StrictMode><AuthProvider store={auth}><MemoryRouter><Routes>
    <Route element={<ProtectedRoute />}><Route path="/" element={<SessionOffice repository={repository} revision={revision} />} /></Route>
    <Route path="/login" element={<p>Sesión cerrada</p>} />
  </Routes></MemoryRouter></AuthProvider></StrictMode>;
  const button = (label: string) => view.root.findAllByType('button').find(node => node.children.join('') === label)!;
  const click = async (label: string) => { await act(async () => { button(label).props.onClick(); }); };
  const real = () => view.root.findAllByProps({ 'aria-label': 'Raxi HQ Campus REAL' });
  const store = () => auth.getRealIdeaStore(() => { throw new Error('App should own factory initialization'); });
  const begin = async (newTitle = title) => {
    await click('+ Nueva idea');
    const form = view.root.findByProps({ 'aria-label': 'Nueva idea de Luis' });
    await act(async () => {
      form.findAllByType('input')[0].props.onChange({ target: { value: newTitle } });
      form.findByType('textarea').props.onChange({ target: { value: note } });
    });
    await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
  };
  return { auth, ledger, commands, requests, complete, click, button, real, store, begin,
    hideRows: (hidden: boolean) => { visible = !hidden; },
    mount: async () => { await act(async () => { view = create(tree()); }); },
    remountApp: async () => { await act(async () => { view.update(tree(1)); }); },
    remountTree: async () => { await act(async () => { view.unmount(); }); await act(async () => { view = create(tree()); }); },
    changeUser: async (id: string) => { user = { id } as User; await act(async () => { await auth.validate(); }); },
    close: async () => { await act(async () => { await auth.signOut(); view.unmount(); }); },
    view: () => view,
  };
}

test('mounted App preserves an active write across REAL/DEMO, App remount and StrictMode; one idea/audit survives reload', async () => {
  const f = fixture(); await f.mount(); await f.begin();
  const originalStore = f.store(); const originalCommand = structuredClone(f.commands[0]);
  await f.click('Campus DEMO · datos ficticios'); assert.equal(f.real().length, 0);
  await f.click('Campus REAL');
  assert.equal(f.store(), originalStore); assert.equal(originalStore.getSnapshot().phase, 'saving');
  assert.equal(f.button('+ Nueva idea').props.disabled, true);
  assert.equal(await originalStore.save({ title: 'Incompatible', note, priority: 'MEDIUM' }), false);
  assert.equal(f.commands.length, 1);
  await f.remountApp(); assert.equal(f.store(), originalStore);
  assert.equal(originalStore.getSnapshot().phase, 'saving'); assert.equal(f.commands.length, 1);
  await act(async () => { f.complete(0); });
  assert.equal(f.ledger.size, 1); assert.equal(new Set([...f.ledger.values()].map(row => row.auditId)).size, 1);
  assert.equal(originalStore.getSnapshot().savedId, originalCommand.externalId);
  await f.click('Campus DEMO · datos ficticios'); await f.click('Campus REAL');
  assert.equal(originalStore.getSnapshot().savedId, originalCommand.externalId);
  await f.click('Recargar desde Supabase');
  assert.equal(originalStore.getSnapshot().ideas.length, 1);
  assert.equal(originalStore.getSnapshot().ideas[0].idea.id, originalCommand.externalId);
  assert.equal(f.commands.length, 1); await f.close();
});

test('a write completed while DEMO is visible remains confirmed when REAL returns', async () => {
  const f = fixture(); await f.mount(); await f.begin(); const original = f.store();
  await f.click('Campus DEMO · datos ficticios');
  await act(async () => { f.complete(0); }); assert.equal(f.real().length, 0);
  await f.click('Campus REAL');
  assert.equal(f.store(), original); assert.equal(original.getSnapshot().savedId, f.commands[0].externalId);
  assert.equal(f.commands.length, 1); assert.equal(f.ledger.size, 1); await f.close();
});

test('lost HTTP response in DEMO is reconciled on REAL return; a different idea gets new keys only after confirmation', async () => {
  const f = fixture(); await f.mount(); await f.begin();
  await f.click('Campus DEMO · datos ficticios'); await act(async () => { f.complete(0, true); });
  assert.equal(f.store().hasPendingWrite(), true);
  await f.click('Campus REAL');
  assert.equal(f.store().getSnapshot().savedId, f.commands[0].externalId); assert.equal(f.store().hasPendingWrite(), false);
  const original = structuredClone([...f.ledger.values()][0]);
  await f.begin('Idea distinta después de recuperar'); assert.equal(f.commands.length, 2);
  assert.notEqual(f.commands[0].operationId, f.commands[1].operationId); assert.notEqual(f.commands[0].externalId, f.commands[1].externalId);
  await act(async () => { f.complete(1); }); assert.equal(f.ledger.size, 2);
  assert.deepEqual([...f.ledger.values()][0], original); await f.close();
});

test('missing read after lost response preserves exact retry keys across navigation and two retries', async () => {
  const f = fixture(); await f.mount(); await f.begin();
  await f.click('Campus DEMO · datos ficticios'); await act(async () => { f.complete(0, true); }); f.hideRows(true);
  await f.click('Campus REAL'); assert.equal(f.store().getSnapshot().savedId, null);
  assert.equal(f.store().hasPendingWrite(), true);
  await f.click('Reintentar guardado pendiente');
  await f.click('Campus DEMO · datos ficticios'); await f.click('Campus REAL');
  assert.equal(f.button('Reintentar guardado pendiente').props.disabled, true);
  await act(async () => { f.complete(1, true); });
  await f.click('Reintentar guardado pendiente'); await act(async () => { f.complete(2); });
  assert.equal(f.commands.length, 3); assert.deepEqual(f.commands[0], f.commands[1]); assert.deepEqual(f.commands[1], f.commands[2]);
  assert.equal(f.ledger.size, 1); assert.equal(f.store().hasPendingWrite(), false);
  f.hideRows(false); await f.click('Recargar desde Supabase'); assert.equal(f.store().getSnapshot().ideas.length, 1); await f.close();
});

test('conflicting recovery stays blocked through REAL/DEMO and preserves the original retry command', async () => {
  const f = fixture(); await f.mount(); await f.begin();
  await f.click('Campus DEMO · datos ficticios'); await act(async () => { f.complete(0, true); });
  const row = [...f.ledger.values()][0]; const original = structuredClone(row); row.idea.title = 'Incompatible';
  await f.click('Campus REAL');
  assert.equal(f.store().getSnapshot().phase, 'error'); assert.match(f.store().getSnapshot().error!, /Conflicto/);
  await f.click('Campus DEMO · datos ficticios'); await f.click('Campus REAL');
  assert.match(f.store().getSnapshot().error!, /Conflicto/); assert.equal(f.store().hasPendingWrite(), true);
  await f.begin('No puede reemplazar la pendiente'); assert.equal(f.commands.length, 1);
  f.ledger.set(f.commands[0].operationId, original);
  await f.click('Reintentar guardado pendiente'); await act(async () => { f.complete(1); });
  assert.deepEqual(f.commands[0], f.commands[1]); assert.equal(f.ledger.size, 1); await f.close();
});

for (const lost of [false, true]) test(`logout invalidates old App store before late ${lost ? 'failure' : 'success'}; next user sees no old state`, async () => {
  const f = fixture(); await f.mount(); await f.begin(); const old = f.store();
  await f.click('Cerrar sesión'); assert.equal(f.real().length, 0); assert.equal(old.getSnapshot().workspace, null);
  assert.throws(() => f.store(), /sesión verificada/);
  await act(async () => { f.complete(0, lost); });
  assert.equal(old.getSnapshot().savedId, null); assert.equal(old.getSnapshot().ideas.length, 0);
  assert.equal(await old.save({ title, note, priority: 'MEDIUM' }), false);
  assert.equal(f.commands.length, 1);
  await f.changeUser(otherOwner); // Login route remains visible; resource can only be created for the new owner.
  const next = f.auth.getRealIdeaStore(id => {
    assert.equal(id, otherOwner); return new RealIdeaStore({
      findWorkspace: async () => null, createWorkspace: async () => { throw new Error('unused'); }, listIdeas: async () => [], createIdea: async () => { throw new Error('unused'); },
    }, id);
  });
  assert.notEqual(next, old); assert.deepEqual(next.getSnapshot().ideas, []); await f.close();
});

test('direct account change while App is mounted isolates requests completed in reverse order', async () => {
  const f = fixture(); await f.mount(); await f.begin(); const old = f.store();
  await f.changeUser(otherOwner); const next = f.store(); assert.notEqual(next, old);
  assert.equal(next.getSnapshot().workspace?.ownerId, otherOwner); assert.deepEqual(next.getSnapshot().ideas, []);
  await f.begin('Captura del segundo usuario');
  await act(async () => { f.complete(1); }); const snapshot = next.getSnapshot();
  await act(async () => { f.complete(0); });
  assert.equal(next.getSnapshot(), snapshot); assert.equal(next.getSnapshot().ideas.length, 1);
  assert.equal(next.getSnapshot().ideas[0].ownerId, otherOwner); assert.equal(old.getSnapshot().savedId, null);
  await f.close();
});

test('a server failure before commit stays retryable with the same keys after REAL/DEMO navigation', async () => {
  const f = fixture(); await f.mount(); await f.begin();
  await f.click('Campus DEMO · datos ficticios');
  await act(async () => { f.requests[0].reject(new Error('Server did not commit')); });
  assert.equal(f.ledger.size, 0);
  await f.click('Campus REAL'); assert.equal(f.store().hasPendingWrite(), true);
  assert.equal(f.store().getSnapshot().savedId, null);
  await f.click('Reintentar guardado pendiente'); await act(async () => { f.complete(1); });
  assert.deepEqual(f.commands[0], f.commands[1]); assert.equal(f.ledger.size, 1);
  assert.equal(f.store().getSnapshot().savedId, f.commands[0].externalId); await f.close();
});

test('provider visual cleanup/remount for the same verified session cannot retire an active write', async () => {
  const f = fixture(); await f.mount(); await f.begin(); const original = f.store();
  await f.remountTree(); assert.equal(f.store(), original);
  assert.equal(original.getSnapshot().phase, 'saving'); assert.equal(f.button('+ Nueva idea').props.disabled, true);
  assert.equal(await original.save({ title: 'Blocked duplicate', note, priority: 'MEDIUM' }), false);
  await act(async () => { f.complete(0); });
  assert.equal(f.commands.length, 1); assert.equal(f.ledger.size, 1);
  assert.equal(original.getSnapshot().savedId, f.commands[0].externalId); await f.close();
});
