import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RealIdeaStore, type RealIdeaRepository, type PersistedIdea, type CreateRealIdea } from '../src/persistence/realIdeaStore';
import { RealIdeaCenter } from '../src/persistence/RealIdeaCenter';
import { validateCreateCommand } from '../../../supabase/functions/_shared/ideaCommand';
import { createIdeaHandler } from '../../../supabase/functions/create-real-idea/handler';
import { readFileSync } from 'node:fs';
import { parsePersistedIdea, parseWorkspace } from '../src/persistence/supabaseIdeaRepository';
import { IdeaCenterPanel } from '../src/ideas/IdeaCenterPanel';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { renderToStaticMarkup } from 'react-dom/server';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true });

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspace = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: owner, name: 'raxi-hq' };
const input = { title: 'Primera idea real de Raxi HQ', note: 'Entrada manual. Sin investigación verificada.', priority: 'MEDIUM' as const };
const command: CreateRealIdea = { workspaceId: workspace.id, externalId: 'IDEA-REAL-cccccccc-cccc-4ccc-8ccc-cccccccccccc', operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', input };
function canonical(cmd: CreateRealIdea): PersistedIdea {
  return { databaseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', workspaceId: workspace.id, ownerId: owner, auditId: 'audit-1', provenance: 'MANUAL_LUIS',
    idea: { id: cmd.externalId, title: cmd.input.title, summary: cmd.input.note, priority: cmd.input.priority, reason: 'Captura manual', source: 'MANUAL_LUIS', status: 'PROPOSED', createdAt: '2026-10-19T20:00:00Z', updatedAt: '2026-10-19T20:00:00Z', fitScore: 0, confidenceScore: 0, suggestedChannels: [], tags: [], evidence: [] } };
}
function fixture() {
  let exists = true, failure = false, creates = 0;
  const rows: PersistedIdea[] = [];
  const commands: CreateRealIdea[] = [];
  const repository: RealIdeaRepository = {
    findWorkspace: async () => exists ? workspace : null,
    createWorkspace: async () => { exists = true; creates++; return workspace; },
    listIdeas: async () => rows,
    createIdea: async cmd => { commands.push(structuredClone(cmd)); if (failure) throw new Error('Red no disponible'); const row = canonical(cmd); rows.push(row); return row; },
  };
  let next = 0;
  const uuid = () => ++next === 1 ? command.externalId.slice(10) : command.operationId;
  return { repository, rows, commands, store: new RealIdeaStore(repository, owner, uuid), fail: (value: boolean) => { failure = value; }, absent: () => { exists = false; }, creates: () => creates };
}

test('REAL starts empty, loads only persisted rows and requires explicit workspace creation', async () => {
  const f = fixture(); f.absent(); await f.store.load();
  assert.equal(f.store.getSnapshot().phase, 'needsWorkspace'); assert.equal(f.creates(), 0); assert.deepEqual(f.store.getSnapshot().ideas, []);
  await f.store.createWorkspace(); assert.equal(f.creates(), 1); assert.equal(f.store.getSnapshot().phase, 'ready');
  await f.store.save(input); assert.equal(f.rows.length, 1);
  const reloaded = new RealIdeaStore(f.repository, owner); await reloaded.load();
  assert.deepEqual(reloaded.getSnapshot().ideas[0], f.store.getSnapshot().ideas[0]);
});
test('failure is never marked saved and retries reuse the exact operation and external ID', async () => {
  const f = fixture(); await f.store.load(); f.fail(true);
  assert.equal(await f.store.save(input), false); assert.equal(f.store.getSnapshot().savedId, null); assert.equal(f.store.getSnapshot().ideas.length, 0);
  assert.equal(await f.store.save({ ...input, note: 'changed' }), false); assert.equal(f.commands.length, 1);
  f.fail(false); assert.equal(await f.store.save(input), true);
  assert.deepEqual(f.commands[0], f.commands[1]); assert.equal(f.store.getSnapshot().savedId, command.externalId);
});
test('simultaneous clicks do not issue a second write or optimistic success', async () => {
  const f = fixture(); await f.store.load(); let resolve!: (row: PersistedIdea) => void;
  let calls = 0;
  f.repository.createIdea = cmd => { calls++; return new Promise(r => { resolve = r; }); };
  const first = f.store.save(input); assert.equal(f.store.getSnapshot().phase, 'saving');
  assert.equal(await f.store.save(input), false); assert.equal(calls, 1); assert.equal(f.store.getSnapshot().savedId, null);
  resolve(canonical(command)); assert.equal(await first, true);
});
test('logout/unmount ignores an old save response; another workspace is rejected', async () => {
  const f = fixture(); await f.store.load(); let resolve!: (row: PersistedIdea) => void;
  f.repository.createIdea = () => new Promise(r => { resolve = r; });
  const pending = f.store.save(input); f.store.dispose(); resolve(canonical(command));
  assert.equal(await pending, false); assert.equal(f.store.getSnapshot().ideas.length, 0);
  const other = new RealIdeaStore(f.repository, 'other-owner'); await other.load(); assert.equal(other.getSnapshot().phase, 'error'); assert.equal(other.getSnapshot().ideas.length, 0);
});
test('a response without audit or with the wrong original ID cannot confirm saving', async () => {
  const f = fixture(); await f.store.load();
  f.repository.createIdea = async cmd => ({ ...canonical(cmd), auditId: '' });
  assert.equal(await f.store.save(input), false); assert.equal(f.store.getSnapshot().savedId, null);
  f.repository.createIdea = async cmd => ({ ...canonical(cmd), idea: { ...canonical(cmd).idea, id: 'IDEA-REAL-other' } });
  assert.equal(await f.store.save(input), false); assert.equal(f.store.getSnapshot().ideas.length, 0);
});
test('untrusted inputs cannot set source, approval state, identity or seed IDs', () => {
  assert.deepEqual(validateCreateCommand(command), command);
  for (const invalid of [{ ...command, ownerId: owner }, { ...command, status: 'APPROVED_FOR_HQ' }, { ...command, externalId: 'IDEA-MANUAL-001' }, { ...command, input: { ...input, source: 'TREND_RADAR' } }, { ...command, input: { ...input, note: '' } }]) assert.throws(() => validateCreateCommand(invalid));
});
test('canonical read adapter preserves the frontend ID and refuses foreign or unverified records', () => {
  const row = canonical(command);
  assert.deepEqual(parseWorkspace(workspace, owner), workspace);
  assert.deepEqual(JSON.parse(JSON.stringify(parsePersistedIdea(row, owner, workspace.id))), row);
  assert.throws(() => parseWorkspace(workspace, 'foreign-owner'));
  assert.throws(() => parsePersistedIdea(row, 'foreign-owner', workspace.id));
  assert.throws(() => parsePersistedIdea({ ...row, auditId: '' }, owner, workspace.id));
  assert.throws(() => parsePersistedIdea({ ...row, idea: { ...row.idea, source: 'TREND_RADAR' } }, owner, workspace.id));
});
function request(body: unknown = command, bearer = true) {
  return new Request('https://example.test/create-real-idea', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer mock-session' } : {}) }, body: JSON.stringify(body) });
}
test('Edge boundary rejects anonymous or invalid JWTs before touching persistence', async () => {
  let writes = 0;
  const handler = createIdeaHandler({ verifyUser: async () => null, commit: async () => { writes++; } });
  assert.equal((await handler(request(command, false))).status, 401);
  assert.equal((await handler(request())).status, 401); assert.equal(writes, 0);
  const anonymous = createIdeaHandler({ verifyUser: async () => ({ id: owner, isAnonymous: true }), commit: async () => { writes++; } });
  assert.equal((await anonymous(request())).status, 401); assert.equal(writes, 0);
});
test('Edge boundary uses the verified JWT identity and propagates a committed response only', async () => {
  const handler = createIdeaHandler({ verifyUser: async () => ({ id: owner, isAnonymous: false }), commit: async (id, cmd) => {
    assert.equal(id, owner); assert.deepEqual(cmd, command); return canonical(command);
  } });
  const response = await handler(request()); assert.equal(response.status, 200); assert.deepEqual(await response.json(), canonical(command));
  const failed = createIdeaHandler({ verifyUser: async () => ({ id: owner, isAnonymous: false }), commit: async () => { throw new Error('private SQL diagnostics'); } });
  const failure = await failed(request()); assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('private SQL'));
});
test('Edge boundary limits bytes and refuses malformed requests before writing', async () => {
  let writes = 0;
  const handler = createIdeaHandler({ verifyUser: async () => ({ id: owner, isAnonymous: false }), commit: async () => { writes++; } });
  assert.equal((await handler(request({ ...command, extra: true }))).status, 400);
  assert.equal((await handler(request({ ...command, input: { ...input, note: 'x'.repeat(13000) } }))).status, 413);
  assert.equal((await handler(new Request('https://example.test', { method: 'GET' }))).status, 405);
  assert.equal(writes, 0);
});
test('REAL form preserves its contents and shows an error after a failed save', async () => {
  const f = fixture(); f.fail(true); let view!: ReactTestRenderer;
  await act(async () => { view = create(<RealIdeaCenter store={f.store} />); });
  await act(async () => { view.root.findAllByType('button').find(node => node.children.join('') === '+ Nueva idea')!.props.onClick(); });
  const form = view.root.findByProps({ 'aria-label': 'Nueva idea de Luis' });
  await act(async () => { form.findAllByType('input')[0].props.onChange({ target: { value: input.title } }); form.findByType('textarea').props.onChange({ target: { value: input.note } }); });
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
  assert.equal(form.findAllByType('input')[0].props.value, input.title);
  assert.ok(view.root.findAllByProps({ role: 'alert' }).length > 0);
  assert.equal(f.store.getSnapshot().savedId, null); await act(async () => view.unmount());
});
test('production write modules do not import DEMO or expose privileged keys', () => {
  const source = readFileSync('src/persistence/realIdeaStore.ts', 'utf8') + readFileSync('src/persistence/RealIdeaCenter.tsx', 'utf8');
  assert.ok(!source.includes('mockIdeas')); assert.ok(!source.includes('SERVICE_ROLE')); assert.ok(!source.includes('restartDemo'));
});
test('shared REAL presentation keeps cards, metrics and detail without fabricated evaluations or enabled transitions', () => {
  const row = canonical(command);
  const markup = renderToStaticMarkup(<IdeaCenterPanel id="real" ideas={[row.idea]} open persistence={{ traces: { [row.idea.id]: row }, saving: false, savedId: null, selectedId: row.idea.id, onSelect() {}, onCreate: async () => false }} />);
  assert.match(markup, /idea-metrics/); assert.match(markup, /idea-panel-body/); assert.match(markup, /idea-card/); assert.match(markup, /Detalle de idea seleccionada/);
  assert.match(markup, /Pendiente de evaluación/); assert.ok(!markup.includes('<meter')); assert.ok(!markup.includes('0%'));
  assert.match(markup, /Trazabilidad técnica/); assert.match(markup, /<details class="idea-trace">/);
  assert.equal((markup.match(/title="Transición persistente todavía no implementada"/g) ?? []).length, 4);
  assert.match(markup, /Historial y auditoría/); assert.ok(!markup.includes('MOCK + SESIÓN LOCAL'));
});
test('shared DEMO presentation retains all seven isolated mock ideas and its explicit label', () => {
  const ideas = loadMockIdeaCenter().ideas;
  const markup = renderToStaticMarkup(<IdeaCenterPanel id="demo" ideas={ideas} open />);
  assert.equal(ideas.length, 7); assert.match(markup, /MOCK \+ SESIÓN LOCAL/); assert.match(markup, /<meter/);
  assert.ok(!markup.includes('REAL · SUPABASE'));
});
test('a confirmed save refreshes the real list, selects the new idea and preserves the original', async () => {
  const f = fixture();
  const first = canonical({ ...command, externalId: 'IDEA-REAL-11111111-1111-4111-8111-111111111111', input: { ...input, title: 'Original intacta' } });
  first.databaseId = '11111111-1111-4111-8111-111111111111';
  f.rows.push(first); const before = structuredClone(first); let view!: ReactTestRenderer;
  await act(async () => { view = create(<RealIdeaCenter store={f.store} />); });
  await act(async () => { view.root.findAllByType('button').find(node => node.children.join('') === '+ Nueva idea')!.props.onClick(); });
  const form = view.root.findByProps({ 'aria-label': 'Nueva idea de Luis' });
  await act(async () => { form.findAllByType('input')[0].props.onChange({ target: { value: input.title } }); form.findByType('textarea').props.onChange({ target: { value: input.note } }); });
  await act(async () => { form.props.onSubmit({ preventDefault() {} }); });
  const cards = () => view.root.findAllByType('button').filter(node => node.props.className === 'idea-card');
  assert.equal(cards().length, 2);
  assert.equal(cards().find(node => node.props['aria-pressed'])!.findByType('strong').children.join(''), input.title);
  assert.equal(view.root.findAllByProps({ 'aria-label': 'Nueva idea de Luis' }).length, 0);
  assert.deepEqual(f.rows[0], before);
  await act(async () => { cards()[0].props.onClick(); });
  const chosen = cards().find(node => node.props['aria-pressed'])!.findByType('strong').children.join('');
  const toggle = () => view.root.findByProps({ 'aria-controls': 'real-idea-center-panel' });
  await act(async () => { toggle().props.onClick(); });
  assert.equal(view.root.findByProps({ id: 'real-idea-center-panel' }).props.open, false);
  await act(async () => { toggle().props.onClick(); });
  assert.equal(cards().find(node => node.props['aria-pressed'])!.findByType('strong').children.join(''), chosen);
  await act(async () => view.unmount());
});
test('a refresh failure after commit retains the canonical saved row and reports only the read failure', async () => {
  const f = fixture(); await f.store.load();
  f.repository.listIdeas = async () => { throw new Error('offline after commit'); };
  assert.equal(await f.store.save(input), true);
  assert.equal(f.store.getSnapshot().savedId, command.externalId); assert.equal(f.store.getSnapshot().ideas.length, 1);
  assert.match(f.store.getSnapshot().refreshWarning!, /se guardó/); assert.equal(f.store.getSnapshot().error, null);
});
