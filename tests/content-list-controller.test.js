'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LIST_PROFILES,
  computeVisibleWindow,
  createController,
} = require('../public/content-list-controller');

function rows(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: 'row-' + (index + offset),
    title: 'Row ' + (index + offset),
  }));
}

test('computes a bounded visible window with overscan and spacers', () => {
  const window = computeVisibleWindow({
    itemCount: 10000,
    itemSize: 50,
    maxNodes: 12,
    overscan: 2,
    scrollOffset: 5000,
    viewportSize: 300,
  });

  assert.deepEqual(window, {
    start: 98,
    end: 108,
    count: 10,
    firstVisible: 100,
    lastVisible: 105,
    before: 4900,
    after: 494600,
    total: 10000,
    itemSize: 50,
  });
  assert.ok(window.count <= 12);
});

test('keeps every supported content profile below its DOM node budget', () => {
  for (const kind of ['search', 'recommendation', 'playlist', 'album', 'comment']) {
    const profile = LIST_PROFILES[kind];
    assert.ok(profile, 'missing profile for ' + kind);
    const window = computeVisibleWindow({
      itemCount: 2500,
      itemSize: profile.itemSize,
      maxNodes: profile.maxNodes,
      overscan: profile.overscan,
      scrollOffset: profile.itemSize * 900,
      viewportSize: profile.itemSize * 8,
    });
    assert.ok(window.count <= profile.maxNodes, kind + ' exceeded its node budget');
    assert.ok(window.start > 0, kind + ' did not recycle leading rows');
    assert.ok(window.end < 2500, kind + ' did not recycle trailing rows');
  }
});

test('preserves stable selection, focus, and scroll anchors as items change', () => {
  const controller = createController({
    getKey: item => item.id,
    itemSize: 40,
    maxNodes: 14,
    overscan: 2,
  });
  const initial = rows(100);
  controller.setItems(initial);
  controller.select('row-75');
  controller.focus('row-76');
  controller.captureAnchor({ key: 'row-20', offset: 7 });

  controller.setItems([{ id: 'prepended' }, ...initial]);
  const snapshot = controller.snapshot();

  assert.equal(snapshot.selectedKey, 'row-75');
  assert.equal(snapshot.focusedKey, 'row-76');
  assert.deepEqual(controller.restoreAnchor(), {
    key: 'row-20',
    index: 21,
    scrollOffset: 847,
  });
});

test('reconciles stable keys and disposes rows that leave the visible window', () => {
  const disposed = [];
  const controller = createController({
    getKey: item => item.id,
    itemSize: 50,
    maxNodes: 10,
    overscan: 1,
    onDispose(key) {
      disposed.push(key);
    },
  });
  controller.setItems(rows(100));

  const first = controller.reconcile({ scrollOffset: 0, viewportSize: 200 });
  const second = controller.reconcile({ scrollOffset: 500, viewportSize: 200 });

  assert.ok(first.created.length > 0);
  assert.ok(second.created.length > 0);
  assert.ok(second.disposed.length > 0);
  assert.deepEqual(disposed, second.disposed);
  assert.ok(controller.snapshot().mountedCount <= 10);
});

test('retains loaded rows and exposes retry state after a partial page failure', async () => {
  let attempts = 0;
  const controller = createController({
    getKey: item => item.id,
    itemSize: 48,
    loadPage: async ({ cursor }) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('provider timeout');
        error.code = 'PAGE_TIMEOUT';
        throw error;
      }
      assert.equal(cursor, 'page-2');
      return {
        items: [
          { id: 'row-1', title: 'duplicate' },
          { id: 'row-2', title: 'new' },
        ],
        cursor: null,
        hasMore: false,
      };
    },
  });
  controller.setItems(rows(2), { cursor: 'page-2', hasMore: true });

  await assert.rejects(controller.loadNextPage(), /provider timeout/);
  assert.deepEqual(controller.items().map(item => item.id), ['row-0', 'row-1']);
  assert.equal(controller.snapshot().page.errorCode, 'PAGE_TIMEOUT');
  assert.equal(controller.snapshot().page.hasMore, true);

  const loaded = await controller.loadNextPage();
  assert.equal(loaded.ok, true);
  assert.deepEqual(controller.items().map(item => item.id), ['row-0', 'row-1', 'row-2']);
  assert.equal(controller.snapshot().page.errorCode, '');
  assert.equal(controller.snapshot().page.hasMore, false);
});

test('deduplicates concurrent page requests and releases mounted rows', async () => {
  let resolvePage;
  let calls = 0;
  const disposed = [];
  const controller = createController({
    getKey: item => item.id,
    itemSize: 50,
    onDispose(key) {
      disposed.push(key);
    },
    loadPage: () => {
      calls += 1;
      return new Promise(resolve => {
        resolvePage = resolve;
      });
    },
  });
  controller.setItems(rows(20), { cursor: 20, hasMore: true });
  controller.reconcile({ scrollOffset: 0, viewportSize: 200 });

  const first = controller.loadNextPage();
  const second = controller.loadNextPage();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolvePage({ items: [], cursor: null, hasMore: false });
  await first;

  controller.release();
  assert.equal(controller.snapshot().mountedCount, 0);
  assert.equal(controller.snapshot().total, 0);
  assert.ok(disposed.length > 0);
});

test('ignores a page result that arrives after the controller is released', async () => {
  let resolvePage;
  const controller = createController({
    getKey: item => item.id,
    loadPage: () => new Promise(resolve => {
      resolvePage = resolve;
    }),
  });
  controller.setItems(rows(3), { cursor: 3, hasMore: true });

  const pending = controller.loadNextPage();
  controller.release();
  resolvePage({
    items: rows(2, 3),
    cursor: null,
    hasMore: false,
  });

  const result = await pending;
  assert.equal(result.stale, true);
  assert.deepEqual(controller.items(), []);
  assert.equal(controller.snapshot().total, 0);
});

test('keeps fallback indexes sequential while appending id-less page items', async () => {
  const controller = createController({
    itemSize: 50,
    loadPage: async () => ({
      items: [{ title: 'third' }, { title: 'fourth' }],
      cursor: null,
      hasMore: false,
    }),
  });
  controller.setItems([{ title: 'first' }, { title: 'second' }], {
    cursor: 'page-2',
    hasMore: true,
  });

  await controller.loadNextPage();
  const window = controller.getWindow({ viewportSize: 400 });

  assert.deepEqual(window.items.map(row => row.key), [
    'index:0',
    'index:1',
    'index:2',
    'index:3',
  ]);
});

test('does not re-normalize an unchanged source array on scroll renders', () => {
  let keyCalls = 0;
  const source = rows(500);
  const controller = createController({
    getKey(item) {
      keyCalls += 1;
      return item.id;
    },
  });

  controller.setItems(source);
  const firstPassCalls = keyCalls;
  controller.setItems(source);

  assert.equal(keyCalls, firstPassCalls);
});
