const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createFrameCoalescer,
  createLyricLineFinder,
  createMeasuredRectCache,
} = require('../public/performance');

test('lyric line finder advances with a cursor and falls back for seeks', () => {
  const finder = createLyricLineFinder();
  const lines = [
    { t: 0, text: 'intro' },
    { t: 2, text: 'verse' },
    { t: 5, text: 'hook' },
    { t: 9, text: 'outro' },
  ];

  assert.equal(finder.find(lines, -0.2, 0.05), -1);
  assert.equal(finder.find(lines, 2.1, 0.05), 1);
  assert.equal(finder.find(lines, 5.2, 0.05), 2);
  assert.equal(finder.find(lines, 1.1, 0.05), 0);
  assert.equal(finder.find([{ t: 4, text: 'new' }], 4.1, 0.05), 0);
});

test('measured rect cache reuses measurements until invalidated', () => {
  const cache = createMeasuredRectCache();
  let reads = 0;
  const readRect = () => ({ left: reads++, right: 100, top: 0, bottom: 40, width: 100, height: 40 });

  assert.equal(cache.get('bar', readRect).left, 0);
  assert.equal(cache.get('bar', readRect).left, 0);
  assert.equal(reads, 1);

  cache.invalidate('bar');
  assert.equal(cache.get('bar', readRect).left, 1);
  cache.invalidate();
  assert.equal(cache.get('bar', readRect).left, 2);
});

test('frame coalescer runs once per animation frame with the latest payload', () => {
  const frames = [];
  const seen = [];
  const coalescer = createFrameCoalescer({
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  }, payload => {
    seen.push(payload);
  });

  coalescer.push({ x: 1 });
  coalescer.push({ x: 2 });
  coalescer.push({ x: 3 });

  assert.equal(frames.length, 1);
  frames[0](16);
  assert.deepEqual(seen, [{ x: 3 }]);
});
