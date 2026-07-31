'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  actionAvailability,
  createOptimisticActionStore,
  normalizeCommentContent,
} = require('../public/platform-actions-state');

function snapshot(loggedIn, available = {}) {
  return {
    providers: [{
      provider: 'netease',
      account: { loggedIn },
      capabilities: {
        albumCollect: true,
        playlistSubscribe: true,
        commentsLike: true,
        commentsCreate: true,
      },
      availability: available,
    }],
  };
}

test('capability-driven actions distinguish available, login, and absent controls', () => {
  assert.deepEqual(
    actionAvailability(snapshot(true, { albumCollect: true }), 'netease', 'albumCollect'),
    { visible: true, enabled: true, loginRequired: false },
  );
  assert.deepEqual(
    actionAvailability(snapshot(false), 'netease', 'albumCollect'),
    { visible: true, enabled: false, loginRequired: true },
  );
  assert.deepEqual(
    actionAvailability(snapshot(true), 'netease', 'albumCollect'),
    { visible: false, enabled: false, loginRequired: false },
  );
  assert.deepEqual(
    actionAvailability(snapshot(true), 'qq', 'albumCollect'),
    { visible: false, enabled: false, loginRequired: false },
  );
});

test('optimistic action store rolls back failed values and blocks duplicate submits', () => {
  const store = createOptimisticActionStore({ 'album:42': false });
  const token = store.begin('album:42', true);

  assert.equal(store.value('album:42'), true);
  assert.equal(store.busy('album:42'), true);
  assert.equal(store.begin('album:42', false), null);
  assert.equal(store.rollback(token), true);
  assert.equal(store.value('album:42'), false);
  assert.equal(store.busy('album:42'), false);
  assert.equal(store.rollback(token), false);
});

test('optimistic action store commits server values and rejects stale tokens', () => {
  const store = createOptimisticActionStore();
  const first = store.begin('comment:7', false);

  assert.equal(store.commit(first, true), true);
  assert.equal(store.value('comment:7'), true);
  assert.equal(store.commit(first, false), false);

  const second = store.begin('comment:7', false);
  assert.notEqual(second.id, first.id);
  assert.equal(store.rollback(first), false);
  assert.equal(store.commit(second), true);
  assert.equal(store.value('comment:7'), false);
  assert.deepEqual(store.snapshot(), {
    values: { 'comment:7': false },
    busy: [],
  });
});

test('comment content normalization enforces the shared 500-character bound', () => {
  assert.equal(normalizeCommentContent('  hello \n world  '), 'hello \n world');
  assert.throws(
    () => normalizeCommentContent('   '),
    error => error && error.code === 'PLATFORM_COMMENT_CONTENT_INVALID',
  );
  assert.throws(
    () => normalizeCommentContent('x'.repeat(501)),
    error => error && error.code === 'PLATFORM_COMMENT_CONTENT_INVALID',
  );
});

test('page wires capability-driven album, playlist, and comment actions', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'styles', 'app.css'), 'utf8');

  assert.match(html, /<script src="platform-actions-state\.js"><\/script>/);
  assert.match(html, /actionAvailability\(/);
  assert.match(html, /openTrackDetailModal\(\\?'album/);
  assert.match(html, /\/api\/album\/detail\?id=/);
  assert.match(html, /\/api\/album\/collect/);
  assert.match(html, /\/api\/playlist\/subscribe/);
  assert.match(html, /resolvePlaylistSubscriptionButton/);
  assert.doesNotMatch(html, /!pl\.subscribed\s*&&\s*!pl\.__subscriptionTouched/);
  assert.match(html, /\/api\/song\/comments\/like/);
  assert.match(html, /submitDetailComment/);
  assert.match(css, /\.detail-comment-composer/);
  assert.match(css, /\.detail-action-toggle/);
});
