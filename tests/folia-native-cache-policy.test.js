const test = require('node:test');
const assert = require('node:assert/strict');

const {
  effectiveEntryLimit,
  resolveCacheBudget,
  trimMapToPolicy,
} = require('../public/folia-native/cache-policy');

test('native lyric cache policy intersects renderer defaults with count and byte budgets', () => {
  assert.deepEqual(resolveCacheBudget({ cacheBudget: { maxCount: 7, maxBytes: 4096 } }, {
    maxCount: 24,
    maxBytes: 16384,
  }), { maxCount: 7, maxBytes: 4096 });
  assert.deepEqual(effectiveEntryLimit({ cacheBudget: { maxCount: 7, maxBytes: 4096 } }, {
    maxCount: 24,
    maxBytes: 16384,
  }, 1024), { maxCount: 4, maxBytes: 4096, bytesPerEntry: 1024 });
  assert.deepEqual(effectiveEntryLimit({ cacheBudget: { maxCount: 96, maxBytes: 1048576 } }, {
    maxCount: 24,
    maxBytes: 16384,
  }, 1024), { maxCount: 16, maxBytes: 16384, bytesPerEntry: 1024 });
});

test('native lyric cache policy evicts oldest map entries and disposes them', () => {
  const cache = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
  const disposed = [];
  const result = trimMapToPolicy(cache, { cacheBudget: { maxCount: 3, maxBytes: 2048 } }, {
    maxCount: 24,
    maxBytes: 16384,
    bytesPerEntry: 1024,
    dispose: (value, key) => disposed.push([key, value]),
  });

  assert.deepEqual(Array.from(cache.entries()), [['c', 3], ['d', 4]]);
  assert.deepEqual(disposed, [['a', 1], ['b', 2]]);
  assert.deepEqual(result, { dropped: 2, maxCount: 2, maxBytes: 2048, estimatedBytes: 2048 });
});
