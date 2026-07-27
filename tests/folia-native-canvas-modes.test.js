const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNativeLyricDocument } = require('../public/folia-native/state');
const {
  buildCadenzaLineLayout,
  resolveCadenzaLineFrame,
} = require('../public/folia-native/cadenza-state');
const {
  buildFumeArticleLayout,
  resolveFumePrintedProgress,
  resolveFumeCameraFrame,
  buildFumePreheatQueue,
  createFumeSnapshotCache,
} = require('../public/folia-native/fume-state');

function documentFixture(count = 12) {
  return buildNativeLyricDocument(Array.from({ length: count }, (_, index) => ({
    t: index * 2.4,
    duration: 2.2,
    text: index === 5 ? '让这一句成为整篇文章的标题' : `第 ${index + 1} 行，在纸面继续向前`,
    translation: `Line ${index + 1}`,
    isChorus: index === 5,
    words: [
      { text: `第 ${index + 1} 行`, t: index * 2.4, d: 1.1 },
      { text: index === 5 ? '成为标题' : '继续向前', t: index * 2.4 + 1.1, d: 1.1 },
    ],
  })), { id: 'canvas-modes', title: '纸上心象', artist: 'Mineradio' });
}

test('Cadenza prelayout is deterministic, bounded and keeps grapheme timings', () => {
  const line = documentFixture(1).lines[0];
  const options = { fontScale: 1.12, widthRatio: 0.72, motionAmount: 1 };
  const measureText = text => Array.from(text).length * 34;
  const first = buildCadenzaLineLayout(line, { width: 1366, height: 768 }, options, measureText);
  const second = buildCadenzaLineLayout(line, { width: 1366, height: 768 }, options, measureText);

  assert.deepEqual(first, second);
  assert.equal(first.placements.length >= 2, true);
  assert.equal(first.placements.every(item => Number.isFinite(item.x) && Number.isFinite(item.y)), true);
  assert.equal(first.placements.every(item => Math.abs(item.x) <= 683 && Math.abs(item.y) <= 384), true);
  assert.equal(first.placements.flatMap(item => item.graphemes).every(item => item.endTime > item.startTime), true);
  assert.match(first.cacheKey, /^cadenza\|/);
});

test('Cadenza frame drives Canvas body and DOM glow from one timing model', () => {
  const line = documentFixture(1).lines[0];
  const model = buildCadenzaLineLayout(line, { width: 960, height: 540 }, {}, text => Array.from(text).length * 28);
  const frame = resolveCadenzaLineFrame(model, 1.35, {
    beam: 0.8,
    trails: 0.7,
    ripple: 0.6,
    glowIntensity: 0.9,
    motionAmount: 1,
  }, { beatPulse: 0.5 });

  assert.equal(frame.placements.some(item => item.status === 'active'), true);
  assert.equal(frame.placements.every(item => item.bodyMix >= 0 && item.bodyMix <= 1), true);
  assert.equal(frame.placements.every(item => item.glow >= 0 && item.glow <= 1), true);
  assert.equal(frame.placements.every(item => item.trails.length <= 6), true);
  assert.equal(Number.isFinite(frame.beam.x) && Number.isFinite(frame.beam.y), true);
  assert.equal(frame.beam.alpha > 0 && frame.beam.alpha <= 1, true);
  assert.equal(frame.ripple.radius >= 0 && frame.ripple.alpha >= 0 && frame.ripple.alpha <= 1, true);
});

test('Fume lays the whole lyric document into deterministic columns with a hero block', () => {
  const document = documentFixture();
  const config = { columns: 3, heroScale: 1, cacheEntries: 24, cacheBytes: 33554432 };
  const measureText = (text, fontPx) => Array.from(text).length * fontPx * 0.58;
  const first = buildFumeArticleLayout(document, { width: 1366, height: 768 }, config, measureText);
  const second = buildFumeArticleLayout(document, { width: 1366, height: 768 }, config, measureText);

  assert.deepEqual(first, second);
  assert.equal(first.blocks.length, document.lines.length);
  assert.equal(first.blocks.filter(block => block.variant === 'hero').length >= 1, true);
  assert.equal(new Set(first.blocks.map(block => block.column)).size >= 2, true);
  assert.equal(first.blocks.every(block => block.x >= 0 && block.y >= 0 && block.width > 0 && block.height > 0), true);
  assert.deepEqual(first.chronologicalBlockIndexes, document.lines.map((_, index) => index));
});

test('Fume printing follows grapheme timing and completes no later than line end', () => {
  const article = buildFumeArticleLayout(documentFixture(2), { width: 960, height: 540 }, { columns: 2 });
  const block = article.blocks[0];
  const before = resolveFumePrintedProgress(block, block.line.startTime - 0.1);
  const during = resolveFumePrintedProgress(block, block.line.startTime + 1.2);
  const after = resolveFumePrintedProgress(block, block.line.endTime + 0.1);

  assert.equal(before.count, 0);
  assert.equal(during.progress > 0 && during.progress < block.graphemes.length, true);
  assert.equal(after.count, block.graphemes.length);
  assert.equal(after.progress, block.graphemes.length);
});

test('Fume supports smooth and stepped tracking, then flies to article overview', () => {
  const article = buildFumeArticleLayout(documentFixture(6), { width: 1366, height: 768 }, { columns: 3 });
  const now = article.blocks[2].line.startTime + 0.9;
  const previous = { x: 0, y: 0, scale: 1 };
  const smooth = resolveFumeCameraFrame(article, { lineIndex: 2, now, dt: 1 / 60, previous }, { cameraMode: 'smooth', cameraSpeed: 1 });
  const stepped = resolveFumeCameraFrame(article, { lineIndex: 2, now, dt: 1 / 60, previous }, { cameraMode: 'step', cameraSpeed: 1 });
  const overview = resolveFumeCameraFrame(article, { lineIndex: 5, now: article.lastRenderEndTime + 0.5, dt: 1 / 60, previous: smooth }, { cameraMode: 'smooth', cameraSpeed: 1 });

  assert.equal(smooth.mode, 'smooth');
  assert.equal(stepped.mode, 'step');
  assert.notEqual(smooth.targetX, stepped.targetX);
  assert.equal(overview.overview, true);
  assert.equal(overview.targetScale <= 0.72, true);
  assert.equal([smooth, stepped, overview].every(camera => [camera.x, camera.y, camera.scale].every(Number.isFinite)), true);
});

test('Fume active block stays inside a compact viewport while the camera tracks printing', () => {
  const viewport = { width: 960, height: 540 };
  const article = buildFumeArticleLayout(documentFixture(6), viewport, { columns: 3 });
  const sourceLineIndex = 4;
  const block = article.blocks[article.blockBySourceLineIndex[sourceLineIndex]];
  const camera = resolveFumeCameraFrame(article, {
    lineIndex: sourceLineIndex,
    now: block.line.startTime + 1.6,
    dt: 1 / 60,
  }, { cameraMode: 'smooth', cameraSpeed: 1 });
  const left = (block.x - camera.targetX) * camera.targetScale + viewport.width / 2;
  const right = (block.x + block.width - camera.targetX) * camera.targetScale + viewport.width / 2;

  assert.equal(left >= 24, true);
  assert.equal(right <= viewport.width - 24, true);
});

test('Fume preheat and snapshot caches stay bounded and dispose evicted canvases', () => {
  const article = buildFumeArticleLayout(documentFixture(8), { width: 960, height: 540 }, { columns: 2 });
  const queue = buildFumePreheatQueue(article, 3, 4);
  const disposed = [];
  const cache = createFumeSnapshotCache({ maxEntries: 2, maxBytes: 100, dispose: value => disposed.push(value.id) });
  cache.set('a', { id: 'a' }, 40);
  cache.set('b', { id: 'b' }, 40);
  cache.get('a');
  cache.set('c', { id: 'c' }, 40);

  assert.equal(queue.length, 4);
  assert.equal(queue.includes(3), false);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.stats().entries, 2);
  assert.deepEqual(disposed, ['b']);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
  assert.deepEqual(disposed.sort(), ['a', 'b', 'c']);
});
