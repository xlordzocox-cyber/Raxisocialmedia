import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMime, reelDuration, reelFrameAt } from '../src/portfolio/reelVideo';
import { packText, parsePack } from '../src/portfolio/portfolioModel';

test('reel video: timeline follows the montage seconds, with a short crossfade', () => {
  const d = [1, 1, 1.5];
  assert.equal(reelDuration(d), 3.5);
  assert.equal(reelFrameAt(0.5, d).index, 0);
  assert.equal(reelFrameAt(1.05, d).index, 1);
  assert.ok(reelFrameAt(1.05, d).fadeIn < 1);
  assert.equal(reelFrameAt(1.5, d).fadeIn, 1);
  assert.equal(reelFrameAt(99, d).index, 2);
});

test('reel video: prefers MP4 for Instagram and falls back to WebM', () => {
  assert.equal(pickMime((m) => m.startsWith('video/mp4')), 'video/mp4;codecs=avc1.42E01E');
  assert.equal(pickMime((m) => m === 'video/webm'), 'video/webm');
  assert.equal(pickMime(() => false), null);
});

test('publish pack: parsed leniently; only Instagram links kept; hashtags normalized', () => {
  const p = parsePack({ format: 'REEL', copy: { caption: 'Hola', hashtags: ['vesper', '#noche', 5], primer_comentario: 'c', audio_sugerido: 'lluvia' },
    final: { qa_estado: 'APPROVED', qa_resumen: 'ok' }, published_url: 'javascript:alert(1)' });
  assert.equal(p.format, 'REEL'); assert.deepEqual(p.hashtags, ['#vesper', '#noche']); assert.equal(p.publishedUrl, null);
  assert.equal(packText(p), 'Hola\n\n#vesper #noche'); assert.equal(p.qa, 'APPROVED · ok');
  assert.equal(parsePack(null).caption, '');
  assert.equal(parsePack({ published_url: 'https://www.instagram.com/reel/ABCDE/' }).publishedUrl, 'https://www.instagram.com/reel/ABCDE/');
});
