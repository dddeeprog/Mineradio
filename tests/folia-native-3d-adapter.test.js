const test = require('node:test');
const assert = require('node:assert/strict');

const { createMineradio3DRenderer } = require('../public/folia-native/renderers/mineradio-3d');

test('Mineradio 3D adapter keeps the existing renderer under unified lifecycle', () => {
  const calls = [];
  const renderer = createMineradio3DRenderer({
    setVisible: value => calls.push(`visible:${value}`),
    clear: () => calls.push('clear'),
    setResourcePolicy: policy => calls.push(`budget:${policy.cacheBudget.maxCount}`),
    snapshot: () => ({ domNodes: 0, canvases: 0, cacheEntries: 3 }),
  });

  renderer.mount();
  renderer.setDocument({ id: 'song', lines: [] });
  renderer.update({ now: 1 });
  renderer.resize({ width: 960, height: 540 });
  renderer.setResourcePolicy({ cacheBudget: { maxCount: 2, maxBytes: 4096 } });
  renderer.release('background');
  renderer.destroy();

  assert.equal(renderer.kind, 'three');
  assert.deepEqual(calls, ['visible:true', 'budget:2', 'visible:false', 'clear', 'visible:false']);
  assert.equal(renderer.snapshot().cacheEntries, 3);
});
