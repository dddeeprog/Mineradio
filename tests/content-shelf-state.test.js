const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clampContentIndex,
  contentIndexFromPlayableIndex,
  detailChromeKind,
  normalizeDetailView,
  playableIndexFromContentIndex,
  recordStageStep,
  recordToolbarLayout,
  resolveDetailOrientation,
} = require('../public/content-shelf-state');

test('normalizes unsupported detail views to list', () => {
  assert.equal(normalizeDetailView('record'), 'record');
  assert.equal(normalizeDetailView('list'), 'list');
  assert.equal(normalizeDetailView('records'), 'list');
  assert.equal(normalizeDetailView(null), 'list');
});

test('record detail orientation follows shelf mode', () => {
  assert.equal(resolveDetailOrientation('side', 'record'), 'side');
  assert.equal(resolveDetailOrientation('stage', 'record'), 'stage');
  assert.equal(resolveDetailOrientation('off', 'record'), 'side');
  assert.equal(resolveDetailOrientation('stage', 'list'), 'list');
});

test('selects chrome kind for detail views', () => {
  assert.equal(detailChromeKind('playlist', 'record'), 'toolbar');
  assert.equal(detailChromeKind('playlist', 'list'), 'panel');
  assert.equal(detailChromeKind('podcast', 'record'), 'panel');
  assert.equal(detailChromeKind('podcast', 'list'), 'panel');
});

test('scales record stage spacing to match shelf card density', () => {
  assert.equal(recordStageStep(1.55), 1.55 * 0.98 / 2.05);
  assert.equal(recordStageStep('bad'), 0);
});

test('selects record toolbar layout by shelf orientation', () => {
  assert.equal(recordToolbarLayout('stage'), 'horizontal');
  assert.equal(recordToolbarLayout('side'), 'vertical');
  assert.equal(recordToolbarLayout('off'), 'vertical');
});

test('maps content index to playable queue index while skipping unplayable rows', () => {
  const tracks = [
    { id: 1 },
    { id: 2, noCopyrightRcmd: true },
    { id: 3 },
    { id: 4, playable: false },
    { id: 5 },
    { name: 'loading placeholder' },
  ];

  assert.equal(playableIndexFromContentIndex(tracks, 0), 0);
  assert.equal(playableIndexFromContentIndex(tracks, 1), -1);
  assert.equal(playableIndexFromContentIndex(tracks, 2), 1);
  assert.equal(playableIndexFromContentIndex(tracks, 4), 2);
  assert.equal(playableIndexFromContentIndex(tracks, 5), -1);
  assert.equal(playableIndexFromContentIndex(tracks, 99), -1);
});

test('maps playable queue index back to content index', () => {
  const tracks = [
    { id: 1 },
    { id: 2, noCopyrightRcmd: true },
    { id: 3 },
    { id: 4, playable: false },
    { id: 5 },
  ];

  assert.equal(contentIndexFromPlayableIndex(tracks, 0), 0);
  assert.equal(contentIndexFromPlayableIndex(tracks, 1), 2);
  assert.equal(contentIndexFromPlayableIndex(tracks, 2), 4);
  assert.equal(contentIndexFromPlayableIndex(tracks, -1), -1);
  assert.equal(contentIndexFromPlayableIndex(tracks, 3), -1);
});

test('clamps detail indices safely', () => {
  assert.equal(clampContentIndex(0, 3), 0);
  assert.equal(clampContentIndex(5, -4), 0);
  assert.equal(clampContentIndex(5, 99), 4);
  assert.equal(clampContentIndex(5, 2), 2);
});
