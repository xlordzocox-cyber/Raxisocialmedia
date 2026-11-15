import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRuntime } from '../src/runtime/runtimeOfficeStore';
import { deliveryFrame, routeLength } from '../src/office/effects/visualTimelines';
import { deliveryRoute } from '../src/office/effects/DeliveryEffect';
import { zones } from '../src/office/zones';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workspace = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lease = '2099-01-01T00:00:00Z';
const ev = (id: number, agent: string, type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, workspace_id: workspace, agent_id: agent, task_id: 't1', event_type: type, source_kind: 'AGENT_EXECUTOR', evidence_status: 'VERIFIED',
  occurred_at: '2026-11-15T16:00:00Z', payload: { simulated: false, leaseUntil: lease, ...payload }, ...extra,
});
const snap = (events: unknown[]) => ({ workspaceId: workspace, ownerId: owner, serverTime: '2026-11-15T16:00:05Z',
  tasks: [{ id: 't1', status: 'RUNNING', title: 'Diseñar', simulated: false, result: null }], events,
  profiles: [{ id: 'res', role: 'RESEARCHER', display_name: 'Investigador', runtime_status: 'CONNECTED' },
    { id: 'cre', role: 'CREATIVE', display_name: 'Director Creativo', runtime_status: 'CONNECTED' }] });
const handoff = { stage: 'RESEARCHER', targetAgentId: 'cre', artifact: 'RESEARCH_REPORT' };

test('research delivery: verified handoff becomes a delivery event without changing anyone status', () => {
  const { hq } = projectRuntime(snap([ev(1, 'res', 'RUNTIME_HANDOFF', handoff), ev(2, 'cre', 'RUNTIME_ACKNOWLEDGED', { stage: 'CREATIVE' })]), owner, workspace);
  const delivery = hq.events.find((e) => e.type === 'HANDOFF_SENT');
  assert.equal(delivery?.actorId, 'res'); assert.equal(delivery?.targetId, 'cre'); assert.equal(delivery?.verified, true);
  assert.equal(hq.agents.res.status, 'IDLE', 'the researcher is not marked as working by a handoff');
  assert.equal(hq.agents.cre.status, 'RUNNING');
});

test('research delivery: unverified, simulated, wrong stage, self or foreign-artifact handoffs are ignored', () => {
  for (const bad of [
    ev(1, 'res', 'RUNTIME_HANDOFF', handoff, { evidence_status: 'UNVERIFIED' }),
    ev(1, 'res', 'RUNTIME_HANDOFF', { ...handoff, simulated: true }),
    ev(1, 'res', 'RUNTIME_HANDOFF', { ...handoff, stage: 'CREATIVE' }),
    ev(1, 'res', 'RUNTIME_HANDOFF', { ...handoff, targetAgentId: 'res' }),
    ev(1, 'res', 'RUNTIME_HANDOFF', { ...handoff, artifact: 'OTHER' }),
    ev(1, 'res', 'RUNTIME_HANDOFF', handoff, { source_kind: 'MOCK' }),
  ]) assert.equal(projectRuntime(snap([bad]), owner, workspace).hq.events.length, 0, JSON.stringify(bad));
});

test('research delivery: the researcher walks over, hands the papers, and walks back to the desk', () => {
  const from = zones.RESEARCH_LAB.workPoints[0], to = zones.WAR_ROOM.workPoints[1] ?? zones.WAR_ROOM.workPoints[0];
  const route = deliveryRoute(from, to, 'RESEARCH_LAB', 'WAR_ROOM');
  assert.deepEqual(route[0], from);
  const stop = route[route.length - 1];
  assert.ok(Math.hypot(stop.x - to.x, stop.y - to.y) < 40, 'stops beside the receiver, not on top of them');
  const walkMs = routeLength(route) / 0.13;
  const start = deliveryFrame(0, route, to), mid = deliveryFrame(walkMs / 2, route, to);
  assert.equal(start.phase, 'walk'); assert.equal(start.walking, true);
  assert.deepEqual(start.senderOffset, { x: 0, y: 0 });
  assert.ok(Math.hypot(mid.senderOffset.x, mid.senderOffset.y) > 10, 'actually walks');
  const give = deliveryFrame(walkMs + 1500, route, to);
  assert.equal(give.phase, 'give'); assert.equal(give.walking, false); assert.equal(give.papers.alpha, 1);
  assert.ok(give.papers.x !== deliveryFrame(walkMs + 10, route, to).papers.x, 'the papers move from one hand to the other');
  const done = deliveryFrame(walkMs * 2 + 1800, route, to);
  assert.equal(done.phase, 'done'); assert.deepEqual(done.senderOffset, { x: 0, y: 0 }); assert.equal(done.papers.alpha, 0);
});
