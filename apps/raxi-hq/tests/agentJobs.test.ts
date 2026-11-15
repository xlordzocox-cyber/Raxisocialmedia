import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignCost, failedCost, canRun, friendlyError, needsOwner, parseJobs, parsePipelines, stepState } from '../src/ideas/agentJobs';

const job = (id: string, kind: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, proposal_id: 'p1', kind, status, cost_usd: '0.0500', error: null, created_at: `2026-11-15T1${id}:00:00Z`,
  output: { markdown: 'texto', sources: [{ url: 'https://ok.example/a', title: 'A' }, { url: 'javascript:alert(1)' }] }, ...extra,
});

test('agent jobs: parsed safely, unknown kinds and unsafe sources dropped, newest first', () => {
  const jobs = parseJobs([job('1', 'RESEARCH', 'SUCCEEDED'), job('2', 'GENERATE', 'PENDING'), job('3', 'DESIGN', 'BOGUS'), { id: 9 }]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].sources, [{ url: 'https://ok.example/a', title: 'A' }]);
  assert.deepEqual(parseJobs('nope'), []);
});

test('agent jobs: Investigar before Diseñar, nothing new while a step runs, costs add up', () => {
  assert.equal(canRun([], 'p1', 'BRIEF'), true);
  assert.equal(canRun([], 'p1', 'RESEARCH'), false);
  assert.equal(canRun(parseJobs([job('0', 'BRIEF', 'SUCCEEDED')]), 'p1', 'RESEARCH'), true);
  assert.equal(canRun([], 'p1', 'DESIGN'), false);
  const done = parseJobs([job('1', 'RESEARCH', 'SUCCEEDED')]);
  assert.equal(canRun(done, 'p1', 'DESIGN'), true);
  const running = parseJobs([job('1', 'RESEARCH', 'SUCCEEDED'), job('2', 'DESIGN', 'RUNNING')]);
  assert.equal(canRun(running, 'p1', 'RESEARCH'), false);
  assert.equal(canRun(running, 'p1', 'DESIGN'), false);
  assert.equal(campaignCost(running, 'p1'), 0.1);
  assert.equal(friendlyError('ERROR: campaign budget reached'), 'Esta campaña alcanzó su tope de gasto.');
  assert.equal(friendlyError(undefined), 'No se pudo iniciar el paso.');
});

test('agent jobs: the Director reviews only after a finished design; verdict and created campaign are read safely', () => {
  const designed = parseJobs([job('1', 'RESEARCH', 'SUCCEEDED'), job('2', 'DESIGN', 'SUCCEEDED')]);
  assert.equal(canRun(parseJobs([job('1', 'RESEARCH', 'SUCCEEDED')]), 'p1', 'REVIEW'), false);
  assert.equal(canRun(designed, 'p1', 'REVIEW'), true);
  const [review] = parseJobs([job('3', 'REVIEW', 'SUCCEEDED', { output: { markdown: 'ok', data: { veredicto: 'APROBADA' }, campaign: { externalId: 'CAMP-X', items: 9, kept: false } } })]);
  assert.equal(review.verdict, 'APROBADA'); assert.deepEqual(review.campaign, { externalId: 'CAMP-X', items: 9, kept: false });
  const [weird] = parseJobs([job('4', 'REVIEW', 'SUCCEEDED', { output: { data: { veredicto: 'TAL VEZ' }, campaign: { externalId: 5 } } })]);
  assert.equal(weird.verdict, null); assert.equal(weird.campaign, null);
});

test('campaign pipeline: rows validated; route shows done/current/te toca/failed honestly', () => {
  const [p] = parsePipelines([{ proposal_id: 'p1', status: 'WAITING_APPROVAL', stage: 'STRATEGY', gate: 'STRATEGY_APPROVAL', note: null }, { proposal_id: 'x', status: 'BOGUS', stage: 'BRIEF' }, null]);
  assert.equal(parsePipelines([{ proposal_id: 'x', status: 'BOGUS', stage: 'BRIEF' }]).length, 0);
  assert.equal(stepState(p, 'RESEARCH'), 'done'); assert.equal(stepState(p, 'STRATEGY'), 'done');
  assert.equal(stepState(p, 'GATE'), 'waiting'); assert.equal(stepState(p, 'DESIGN'), 'todo');
  assert.equal(needsOwner(p), true);
  const running = { ...p, status: 'RUNNING' as const, stage: 'DESIGN' as const, gate: null };
  assert.equal(stepState(running, 'GATE'), 'done'); assert.equal(stepState(running, 'DESIGN'), 'current'); assert.equal(needsOwner(running), false);
  const failed = { ...running, status: 'FAILED' as const };
  assert.equal(stepState(failed, 'DESIGN'), 'failed'); assert.equal(needsOwner(failed), true);
  const ready = { ...running, status: 'READY_FOR_PRODUCTION' as const, stage: 'DONE' as const };
  assert.equal(stepState(ready, 'DONE'), 'done');
});

test('agent jobs: failed steps do not count toward the campaign cap; reused and rescued results are flagged', () => {
  const jobs = parseJobs([job('1', 'RESEARCH', 'FAILED'), job('2', 'RESEARCH', 'SUCCEEDED', { cost_usd: '0', output: { data: { modelos: [] }, reused_from: 'abc' } }),
    job('3', 'DESIGN', 'SUCCEEDED', { output: { data: { concepto: 'x' }, rescued: true } })]);
  assert.equal(campaignCost(jobs, 'p1'), 0.05); assert.equal(failedCost(jobs, 'p1'), 0.05);
  const research = jobs.find((j) => j.kind === 'RESEARCH' && j.status === 'SUCCEEDED')!;
  assert.equal(research.reused, true); assert.equal(research.rescued, false);
  assert.equal(jobs.find((j) => j.kind === 'DESIGN')!.rescued, true);
  assert.deepEqual(jobs.find((j) => j.kind === 'DESIGN')!.data, { concepto: 'x' });
});
