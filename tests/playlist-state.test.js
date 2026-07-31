const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findPlaylistShelfFocus,
  normalizePlaylistId,
  normalizePlaylistDetailResult,
  resolvePlaylistSubscriptionButton,
  resolvePlaylistSubscriptionMutation,
} = require('../public/playlist-state');

function playlist(id, opts = {}) {
  return {
    id,
    provider: opts.provider || 'netease',
    subscribed: !!opts.subscribed,
    name: opts.name || `playlist-${id}`,
  };
}

test('normalizes netease and QQ playlist ids', () => {
  assert.equal(normalizePlaylistId('123'), '123');
  assert.equal(normalizePlaylistId('qq', 'abc'), 'qq:abc');
  assert.equal(normalizePlaylistId('qq:abc'), 'qq:abc');
  assert.equal(normalizePlaylistId(playlist('42')), '42');
  assert.equal(normalizePlaylistId(playlist('abc', { provider: 'qq' })), 'qq:abc');
});

test('finds the fifth netease playlist in mine pane', () => {
  const playlists = ['1', '2', '3', '4', '5'].map((id) => playlist(id));

  assert.deepEqual(findPlaylistShelfFocus(playlists, '5'), {
    pane: 'mine',
    index: 4,
    playlistId: '5',
    merged: false,
  });
});

test('finds subscribed playlists in fav pane', () => {
  const playlists = [
    playlist('mine-1'),
    playlist('fav-1', { subscribed: true }),
    playlist('fav-2', { subscribed: true }),
  ];

  assert.deepEqual(findPlaylistShelfFocus(playlists, 'fav-2'), {
    pane: 'fav',
    index: 1,
    playlistId: 'fav-2',
    merged: false,
  });
});

test('matches QQ playlists by qq-prefixed id', () => {
  const playlists = [
    playlist('100'),
    playlist('abc', { provider: 'qq' }),
  ];

  assert.deepEqual(findPlaylistShelfFocus(playlists, 'qq:abc'), {
    pane: 'mine',
    index: 1,
    playlistId: 'qq:abc',
    merged: false,
  });
});

test('returns merged index when collections are merged', () => {
  const playlists = [
    playlist('mine-1'),
    playlist('mine-2'),
    playlist('fav-1', { subscribed: true }),
  ];

  assert.deepEqual(findPlaylistShelfFocus(playlists, 'fav-1', {
    currentPane: 'fav',
    mergeCollections: true,
  }), {
    pane: 'fav',
    index: 2,
    playlistId: 'fav-1',
    merged: true,
  });
});

test('returns null when playlist cannot be found', () => {
  assert.equal(findPlaylistShelfFocus([playlist('1')], 'missing'), null);
});

test('distinguishes an empty playlist from a failed playlist response', () => {
  assert.deepEqual(normalizePlaylistDetailResult({ tracks: [] }), {
    ok: true,
    tracks: [],
    errorCode: '',
  });
  assert.deepEqual(normalizePlaylistDetailResult({ error: 'UPSTREAM_TIMEOUT' }), {
    ok: false,
    tracks: [],
    errorCode: 'UPSTREAM_TIMEOUT',
  });
  assert.deepEqual(normalizePlaylistDetailResult({}), {
    ok: false,
    tracks: [],
    errorCode: 'PLAYLIST_DETAIL_INVALID_RESPONSE',
  });
});

test('rolls playlist subscription state back after rejected feedback', () => {
  assert.deepEqual(resolvePlaylistSubscriptionMutation(false, true, { success: true }), {
    ok: true,
    value: true,
    errorCode: '',
  });
  assert.deepEqual(resolvePlaylistSubscriptionMutation(true, false, { error: 'WRITE_FAILED' }), {
    ok: false,
    value: true,
    errorCode: 'WRITE_FAILED',
  });
  assert.deepEqual(resolvePlaylistSubscriptionMutation(false, true, null), {
    ok: false,
    value: false,
    errorCode: 'PLAYLIST_SUBSCRIBE_INVALID_RESPONSE',
  });
  assert.deepEqual(resolvePlaylistSubscriptionMutation(false, true, {}), {
    ok: false,
    value: false,
    errorCode: 'PLAYLIST_SUBSCRIBE_INVALID_RESPONSE',
  });
});

function subscriptionButton(playlistValue, access) {
  assert.equal(typeof resolvePlaylistSubscriptionButton, 'function');
  return resolvePlaylistSubscriptionButton(playlistValue, access);
}

test('shows subscribe for an unowned unsubscribed Netease playlist', () => {
  assert.deepEqual(subscriptionButton({
    provider: 'netease',
    owned: false,
    subscribed: false,
  }, {
    visible: true,
    enabled: true,
    loginRequired: false,
  }), {
    visible: true,
    enabled: true,
    subscribed: false,
    label: '订阅歌单',
  });
});

test('shows unsubscribe for a subscribed Netease playlist', () => {
  assert.deepEqual(subscriptionButton({
    provider: 'netease',
    owned: false,
    subscribed: true,
  }, {
    visible: true,
    enabled: true,
    loginRequired: false,
  }), {
    visible: true,
    enabled: true,
    subscribed: true,
    label: '取消订阅',
  });
});

test('hides subscription control for an owned Netease playlist', () => {
  assert.deepEqual(subscriptionButton({
    provider: 'netease',
    owned: true,
    subscribed: false,
  }, {
    visible: true,
    enabled: true,
    loginRequired: false,
  }), {
    visible: false,
    enabled: false,
    subscribed: false,
    label: '',
  });
});

test('hides and disables subscription control without write capability', () => {
  assert.deepEqual(subscriptionButton({
    provider: 'netease',
    owned: false,
    subscribed: false,
  }, {
    visible: false,
    enabled: false,
    loginRequired: false,
  }), {
    visible: false,
    enabled: false,
    subscribed: false,
    label: '',
  });
});
