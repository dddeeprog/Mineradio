'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SEARCH_PROVIDER_ORDER,
  normalizeSearchPage,
  normalizeSearchRecord,
  searchRecordKey,
} = require('../server/platform/search-model');

test('exports the fixed five-provider search order', () => {
  assert.deepEqual(SEARCH_PROVIDER_ORDER, [
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify',
  ]);
  assert.equal(Object.isFrozen(SEARCH_PROVIDER_ORDER), true);
});

test('normalizes a playable NetEase record into the public search model', () => {
  const record = normalizeSearchRecord('netease', {
    id: 42,
    name: 'Blue Hour',
    artists: [{ id: 7, name: 'Example Artist', cookie: 'secret' }],
    album: 'Example Album',
    albumId: 9,
    cover: 'https://img.example/cover.jpg',
    duration: 201234,
    fee: 1,
    cookie: 'MUSIC_U=secret',
  }, {
    playbackAvailable: true,
  });

  assert.deepEqual(record, {
    provider: 'netease',
    sourceId: '42',
    title: 'Blue Hour',
    artists: [{ id: '7', name: 'Example Artist' }],
    album: { id: '9', name: 'Example Album' },
    cover: 'https://img.example/cover.jpg',
    durationMs: 201234,
    playable: true,
    matchHints: {
      title: 'bluehour',
      artists: ['exampleartist'],
      album: 'examplealbum',
      durationMs: 201234,
    },
    capabilities: { playback: true },
    providerData: {
      id: '42',
      albumId: '9',
      fee: 1,
    },
  });
  assert.equal(JSON.stringify(record).includes('secret'), false);
});

test('keeps QQ playback identifiers without copying unknown response fields', () => {
  const record = normalizeSearchRecord('qq', {
    id: 'fallback',
    mid: 'song-mid',
    mediaMid: 'media-mid',
    qqId: 18,
    name: 'Signal',
    artist: 'A / B',
    album: { id: 'album-id', name: 'Signals' },
    durationMs: 123000,
    fee: 0,
    qm_keyst: 'secret',
  }, {
    playbackAvailable: true,
  });

  assert.equal(record.sourceId, 'song-mid');
  assert.equal(record.playable, true);
  assert.deepEqual(record.artists, [{ id: '', name: 'A / B' }]);
  assert.deepEqual(record.providerData, {
    mid: 'song-mid',
    mediaMid: 'media-mid',
    qqId: '18',
    albumId: 'album-id',
    fee: 0,
  });
  assert.equal(Object.hasOwn(record.providerData, 'qm_keyst'), false);
});

test('metadata-only providers never become playable through input flags', () => {
  for (const provider of ['kugou', 'qishui', 'spotify']) {
    const record = normalizeSearchRecord(provider, {
      id: provider + '-1',
      name: 'Metadata Track',
      artist: 'Metadata Artist',
      durationMs: 180000,
      playable: true,
      capabilities: { playback: true },
    }, {
      playbackAvailable: true,
    });

    assert.equal(record.playable, false, provider);
    assert.deepEqual(record.capabilities, { playback: false }, provider);
  }
});

test('copies only provider-specific metadata from explicit allowlists', () => {
  const kugou = normalizeSearchRecord('kugou', {
    hash: 'HASH',
    albumId: '11',
    albumAudioId: '22',
    name: 'Kugou',
    artist: 'Artist',
    fee: 1,
    token: 'secret',
  });
  const qishui = normalizeSearchRecord('qishui', {
    providerSongId: 'qs-1',
    name: 'Qishui',
    artist: 'Artist',
    qishuiRank: 4,
    accessToken: 'secret',
  });
  const spotify = normalizeSearchRecord('spotify', {
    spotifyId: 'sp-1',
    name: 'Spotify',
    artist: 'Artist',
    uri: 'spotify:track:sp-1',
    spotifyUrl: 'https://open.spotify.com/track/sp-1',
    explicit: true,
    clientSecret: 'secret',
  });

  assert.deepEqual(kugou.providerData, {
    hash: 'HASH',
    albumId: '11',
    albumAudioId: '22',
    fee: 1,
  });
  assert.deepEqual(qishui.providerData, {
    providerSongId: 'qs-1',
    rank: 4,
  });
  assert.deepEqual(spotify.providerData, {
    spotifyId: 'sp-1',
    uri: 'spotify:track:sp-1',
    externalUrl: 'https://open.spotify.com/track/sp-1',
    explicit: true,
  });
  assert.equal(JSON.stringify([kugou, qishui, spotify]).includes('secret'), false);
});

test('rejects unknown providers and incomplete records', () => {
  assert.equal(normalizeSearchRecord('unknown', { id: 1, name: 'Nope' }), null);
  assert.equal(normalizeSearchRecord('netease', { id: 1 }), null);
  assert.equal(normalizeSearchRecord('netease', { name: 'Missing id' }), null);
});

test('normalizes page bounds and derives stable pagination defaults', () => {
  const page = normalizeSearchPage('qishui', {
    songs: [
      { providerSongId: 'a', name: 'A', artist: 'One' },
      { providerSongId: 'b', name: 'B', artist: 'Two' },
      { providerSongId: 'b', name: 'Duplicate B', artist: 'Two' },
      { providerSongId: 'invalid' },
    ],
    total: 21,
    offset: 5,
    limit: 3,
    nextOffset: 8,
    hasMore: true,
  });

  assert.equal(page.provider, 'qishui');
  assert.deepEqual(page.records.map(record => record.sourceId), ['a', 'b']);
  assert.deepEqual(page.pagination, {
    offset: 5,
    limit: 3,
    nextOffset: 8,
    hasMore: true,
    total: 21,
  });
  assert.equal(searchRecordKey(page.records[0]), 'qishui:a');
});

test('normalized records do not retain mutable raw objects', () => {
  const raw = {
    id: 1,
    name: 'Stable',
    artists: [{ id: 2, name: 'Before' }],
    album: { id: 3, name: 'Album' },
  };
  const record = normalizeSearchRecord('netease', raw, {
    playbackAvailable: true,
  });

  raw.artists[0].name = 'After';
  raw.album.name = 'Changed';
  assert.equal(record.artists[0].name, 'Before');
  assert.equal(record.album.name, 'Album');
});
