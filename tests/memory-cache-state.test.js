const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cacheCount,
  queueRenderWindow,
  trimMapCache,
  trimObjectCache,
} = require('../public/memory-cache-state');

test('trimObjectCache drops oldest non-protected records and calls disposer', () => {
  const disposed = [];
  const cache = {
    a: { value: 1 },
    b: { value: 2 },
    c: { value: 3 },
    d: { value: 4 },
  };

  const result = trimObjectCache(cache, {
    keep: 2,
    protectedKeys: { b: true },
    dispose: (record, key) => disposed.push([key, record.value]),
  });

  assert.deepEqual(result, { before: 4, after: 2, dropped: 2 });
  assert.deepEqual(Object.keys(cache), ['b', 'd']);
  assert.deepEqual(disposed, [['a', 1], ['c', 3]]);
});

test('trimObjectCache keeps loading records when skipRecord returns true', () => {
  const cache = {
    a: { loading: true },
    b: { value: 2 },
    c: { value: 3 },
  };

  const result = trimObjectCache(cache, {
    keep: 1,
    skipRecord: (record) => record && record.loading,
  });

  assert.deepEqual(result, { before: 3, after: 2, dropped: 1 });
  assert.deepEqual(Object.keys(cache), ['a', 'c']);
});

test('cacheCount supports arrays maps sets and plain objects', () => {
  assert.equal(cacheCount([1, 2, 3]), 3);
  assert.equal(cacheCount(new Map([['a', 1], ['b', 2]])), 2);
  assert.equal(cacheCount(new Set(['a', 'b', 'c'])), 3);
  assert.equal(cacheCount({ a: 1, b: 2 }), 2);
  assert.equal(cacheCount(null), 0);
});

test('trimMapCache drops oldest map records and disposes values', () => {
  const disposed = [];
  const cache = new Map([
    ['a', { texture: { dispose: () => disposed.push('a') } }],
    ['b', { texture: { dispose: () => disposed.push('b') } }],
    ['c', { texture: { dispose: () => disposed.push('c') } }],
    ['d', { texture: { dispose: () => disposed.push('d') } }],
  ]);

  const result = trimMapCache(cache, {
    keep: 2,
    protectedKeys: { b: true },
    dispose: (record) => record.texture.dispose(),
  });

  assert.deepEqual(result, { before: 4, after: 2, dropped: 2 });
  assert.deepEqual(Array.from(cache.keys()), ['b', 'd']);
  assert.deepEqual(disposed, ['a', 'c']);
});

test('queueRenderWindow centers current item and honors manual paging', () => {
  assert.deepEqual(queueRenderWindow(0, -1, { maxItems: 20 }), {
    start: 0,
    end: -1,
    count: 0,
    before: 0,
    after: 0,
    total: 0,
  });

  assert.deepEqual(queueRenderWindow(1000, 500, { maxItems: 120 }), {
    start: 441,
    end: 560,
    count: 120,
    before: 441,
    after: 439,
    total: 1000,
  });

  assert.deepEqual(queueRenderWindow(1000, 500, { maxItems: 120, requestedStart: 720 }), {
    start: 720,
    end: 839,
    count: 120,
    before: 720,
    after: 160,
    total: 1000,
  });
});
