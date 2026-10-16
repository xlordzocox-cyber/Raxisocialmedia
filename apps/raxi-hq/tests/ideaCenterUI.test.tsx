import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampusOverview } from '../src/campus/CampusOverview';
import { IdeaCenterPanel } from '../src/ideas/IdeaCenterPanel';
import { loadMockIdeaCenter } from '../src/ideas/mockIdeas';
import { getIdeasSortedByPriority, summarizeIdeas } from '../src/ideas/ideaSelectors';
import { ideaChannelLabel, ideaPriorityLabel, ideaSourceLabel, ideaStatusLabel } from '../src/ideas/ideaPresentation';
import { IDEA_CHANNELS, IDEA_PRIORITIES, IDEA_SOURCES, IDEA_STATUSES, type IdeaRecord } from '../src/ideas/ideaContracts';

const renderPanel = (ideas: readonly IdeaRecord[]) => renderToStaticMarkup(<IdeaCenterPanel id="idea-center-panel" ideas={ideas} open />);

test('campus telemetry derives counts from summarizeIdeas and keeps MOCK separate from Office mode', () => {
  const ideas = loadMockIdeaCenter().ideas;
  const summary = summarizeIdeas(ideas);
  const campus = renderToStaticMarkup(<CampusOverview ideas={ideas} />);
  assert.match(campus, new RegExp(`${summary.totalIdeas}</b> ideas`));
  assert.match(campus, new RegExp(`${summary.underReviewCount}</b> en análisis`));
  assert.match(campus, new RegExp(`${summary.approvedForHqCount}</b> lista para HQ`));
  assert.match(campus, /CENTRO DE IDEAS · MOCK/);
  assert.match(campus, /aria-expanded="false"/);
  assert.match(campus, /aria-controls="idea-center-panel"/);
  assert.match(campus, /id="idea-center-panel"[^>]*hidden=""/);
  const subset = [ideas.find(idea => idea.status === 'PROPOSED')!];
  const smaller = renderToStaticMarkup(<CampusOverview ideas={subset} />);
  assert.match(smaller, /1<\/b> idea/);
  assert.match(smaller, /0<\/b> en análisis/);
  assert.match(smaller, /0<\/b> listas para HQ/);
});

test('presentation labels cover every canonical status, priority, source and channel', () => {
  assert.deepEqual(IDEA_STATUSES.map(value => ideaStatusLabel[value]), ['Nueva', 'En análisis', 'Aprobada para HQ', 'Rechazada', 'Archivada', 'Enviada al HQ']);
  assert.deepEqual(IDEA_PRIORITIES.map(value => ideaPriorityLabel[value]), ['Baja', 'Media', 'Alta', 'Urgente']);
  assert.deepEqual(IDEA_SOURCES.map(value => ideaSourceLabel[value]), ['Luis', 'Radar de tendencias', 'Analytics', 'Calendario editorial', 'Insight de memoria', 'Señal externa']);
  assert.deepEqual(IDEA_CHANNELS.map(value => ideaChannelLabel[value]), ['Instagram Feed', 'Instagram Reel', 'Instagram Stories', 'Teaser', 'FanView Feed', 'FanView Chat']);
});

test('read-only panel shows MOCK summaries, keyboard-selectable ideas and approval as a proposal', () => {
  const ideas = loadMockIdeaCenter().ideas;
  const summary = summarizeIdeas(ideas);
  const html = renderPanel(ideas);
  assert.match(html, /aria-label="Centro de Ideas · MOCK"/);
  assert.match(html, /MOCK · solo lectura/);
  assert.match(html, new RegExp(`<strong>${summary.proposedCount}</strong><span>Nuevas`));
  assert.match(html, new RegExp(`<strong>${summary.sentToHqCount}</strong><span>Enviadas al HQ`));
  assert.match(html, /LISTA PARA HQ/);
  assert.match(html, /Una idea todavía no es una campaña/);
  assert.equal((html.match(/class="idea-card"/g) ?? []).length, ideas.length);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<form|<input|Enviar al HQ<\/button|Crear campaña<\/button/i);
});

test('idea cards use deterministic priority and ID order regardless of input order', () => {
  const ideas = loadMockIdeaCenter().ideas;
  const ordered = getIdeasSortedByPriority(ideas);
  const html = renderPanel(ideas);
  const reversed = renderPanel([...ideas].reverse());
  assert.equal(html, reversed);
  const positions = ordered.map(idea => html.indexOf(`<code>${idea.id}</code>`));
  assert.equal(positions.every(position => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('evidence labels and opaque sourceRef render as escaped text, never links or HTML', () => {
  const approved = loadMockIdeaCenter().ideas.find(idea => idea.status === 'APPROVED_FOR_HQ')!;
  const malicious: IdeaRecord = { ...approved, evidence: [{ id: 'EV-MARKUP', kind: 'MANUAL_NOTE',
    label: '<img src=x onerror=alert(1)>', sourceRef: 'opaque:<script>alert(1)</script>', capturedAt: approved.updatedAt }] };
  const html = renderPanel([malicious]);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /opaque:&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|<a\s|href=/i);
  assert.match(html, /EV-MARKUP|MANUAL_NOTE/);
});

test('rendering a panel leaves IdeaRecord unchanged and exposes no write action', () => {
  const ideas = loadMockIdeaCenter().ideas;
  const before = JSON.stringify(ideas);
  renderPanel(ideas);
  assert.equal(JSON.stringify(ideas), before);
  for (const path of ['src/campus/CampusOverview.tsx', 'src/ideas/IdeaCenterPanel.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /transitionIdea|createIdeaHandoff|fetch\s*\(|XMLHttpRequest|dangerouslySetInnerHTML|localStorage|\.\.\/adapters\//);
  }
});
