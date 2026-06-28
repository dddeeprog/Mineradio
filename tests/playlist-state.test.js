const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findPlaylistShelfFocus,
  normalizePlaylistId,
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
