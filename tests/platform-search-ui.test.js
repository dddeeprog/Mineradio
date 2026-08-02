'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const searchState = require('../public/platform-search-state');

function capabilitySnapshot(overrides) {
  overrides = overrides || {};
  return {
    schema: 1,
    providers: searchState.PROVIDER_ORDER.map(provider => ({
      provider,
      label: provider.toUpperCase(),
      capabilities: {
        search: true,
        playback: provider === 'netease' || provider === 'qq',
        playlistWrite: provider === 'netease',
        commentsRead: provider === 'netease' || provider === 'qq',
      },
      availability: {
        search: overrides[provider]?.search !== false,
        playback: overrides[provider]?.playback === true,
        playlistWrite: overrides[provider]?.playlistWrite === true,
        commentsRead: overrides[provider]?.commentsRead === true,
      },
    })),
  };
}

function record(provider, id, title) {
  return {
    provider,
    sourceId: id,
    title: title || provider + ' ' + id,
    artists: [{ id: provider + '-artist', name: provider + ' artist' }],
    album: { id: provider + '-album', name: provider + ' album' },
    cover: 'https://img.example/' + provider + '.jpg',
    durationMs: 180000,
    playable: provider === 'netease' || provider === 'qq',
    matchHints: {},
    capabilities: {
      playback: provider === 'netease' || provider === 'qq',
    },
    providerData: provider === 'qq'
      ? { mid: id, mediaMid: 'media-' + id, fee: 0 }
      : provider === 'netease'
        ? { id, albumId: 'album', fee: 0 }
        : {},
  };
}

function response(provider, records, page, errors) {
  return {
    schema: 1,
    query: 'Signal',
    results: records,
    pages: {
      [provider]: {
        offset: page?.offset || 0,
        limit: page?.limit || 2,
        nextOffset: page?.nextOffset ?? records.length,
        hasMore: page?.hasMore === true,
        total: page?.total ?? records.length,
        failed: false,
      },
    },
    errors: errors || [],
  };
}

test('normalizes capability snapshots and selects only searchable providers', () => {
  const capabilities = searchState.normalizeCapabilitySnapshot(
    capabilitySnapshot({
      kugou: { search: false },
      spotify: { search: false },
    }),
  );
  const session = searchState.createSession({
    query: ' Signal ',
    mode: 'song',
    capabilities,
  });

  assert.deepEqual(session.providers, ['netease', 'qq', 'qishui']);
  assert.equal(session.key, 'song|Signal');
  assert.equal(capabilities.netease.label, 'NETEASE');
  assert.deepEqual(
    searchState.createSession({
      query: 'Signal',
      mode: 'kugou',
      capabilities,
    }).providers,
    [],
  );
});

test('uses a conservative NetEase and QQ fallback when capability loading fails', () => {
  const capabilities = searchState.normalizeCapabilitySnapshot(null);
  const session = searchState.createSession({
    query: 'fallback',
    mode: 'song',
    capabilities,
  });

  assert.deepEqual(session.providers, ['netease', 'qq']);
  assert.equal(capabilities.netease.availability.search, true);
  assert.equal(capabilities.qq.availability.playback, true);
  assert.equal(capabilities.qishui.availability.search, false);
});

test('builds one unified endpoint request per provider and marks it loading', () => {
  const session = searchState.createSession({
    query: 'A & B',
    mode: 'song',
    capabilities: searchState.normalizeCapabilitySnapshot(
      capabilitySnapshot(),
    ),
    pageLimits: {
      netease: 8,
      qq: 6,
      kugou: 5,
      qishui: 4,
      spotify: 3,
    },
  });
  const requests = searchState.takeProviderRequests(session);

  assert.equal(requests.length, 5);
  assert.equal(
    requests[0].url,
    '/api/platform/search?q=A%20%26%20B&provider=netease&limit=8&offset=0',
  );
  assert.equal(
    requests[4].url,
    '/api/platform/search?q=A%20%26%20B&provider=spotify&limit=3&offset=0',
  );
  assert.equal(session.providerState.netease.status, 'loading');
  assert.deepEqual(searchState.takeProviderRequests(session), []);
});

test('merges out-of-order provider responses in fixed provider order', () => {
  const capabilities = searchState.normalizeCapabilitySnapshot(
    capabilitySnapshot({
      netease: { playback: true },
      qq: { playback: true },
    }),
  );
  const session = searchState.createSession({
    query: 'Signal',
    mode: 'song',
    capabilities,
  });
  searchState.takeProviderRequests(session);

  assert.equal(searchState.applyProviderResponse(
    session,
    'qq',
    response('qq', [record('qq', 'qq-1')]),
  ), true);
  assert.deepEqual(session.songs.map(song => song.provider), ['qq']);

  assert.equal(searchState.applyProviderResponse(
    session,
    'netease',
    response('netease', [record('netease', 'ne-1')]),
  ), true);
  assert.deepEqual(
    session.songs.map(song => song.provider),
    ['netease', 'qq'],
  );
  assert.equal(session.songs[0].name, 'netease ne-1');
  assert.equal(session.songs[1].mid, 'qq-1');
  assert.equal(session.songs[1].mediaMid, 'media-qq-1');
});

test('preserves cross-provider records while deduplicating provider source ids', () => {
  const session = searchState.createSession({
    query: 'same',
    mode: 'song',
    capabilities: searchState.normalizeCapabilitySnapshot(
      capabilitySnapshot(),
    ),
  });

  searchState.applyProviderResponse(session, 'netease', response('netease', [
    record('netease', 'same', 'Same Song'),
    record('netease', 'same', 'Duplicate'),
  ]));
  searchState.applyProviderResponse(session, 'qq', response('qq', [
    record('qq', 'same', 'Same Song'),
  ]));

  assert.deepEqual(
    session.songs.map(song => song._searchRecordKey),
    ['netease:same', 'qq:same'],
  );
});

test('appends provider pages and requests only providers that have more data', () => {
  const session = searchState.createSession({
    query: 'Signal',
    mode: 'song',
    capabilities: searchState.normalizeCapabilitySnapshot(
      capabilitySnapshot({
        kugou: { search: false },
        qishui: { search: false },
        spotify: { search: false },
      }),
    ),
    pageLimits: {
      netease: 2,
      qq: 2,
    },
  });
  searchState.takeProviderRequests(session);
  searchState.applyProviderResponse(session, 'netease', response('netease', [
    record('netease', 'ne-1'),
    record('netease', 'ne-2'),
  ], {
    limit: 2,
    nextOffset: 2,
    hasMore: true,
    total: 4,
  }));
  searchState.applyProviderResponse(session, 'qq', response('qq', [
    record('qq', 'qq-1'),
  ], {
    limit: 2,
    nextOffset: 1,
    hasMore: false,
  }));

  assert.equal(searchState.hasMore(session), true);
  const next = searchState.takeProviderRequests(session, {
    nextPage: true,
  });
  assert.deepEqual(next.map(item => item.provider), ['netease']);
  assert.match(next[0].url, /limit=2&offset=2$/);

  searchState.applyProviderResponse(session, 'netease', response('netease', [
    record('netease', 'ne-3'),
    record('netease', 'ne-4'),
  ], {
    offset: 2,
    limit: 2,
    nextOffset: 4,
    hasMore: false,
    total: 4,
  }));
  assert.deepEqual(
    session.songs.filter(song => song.provider === 'netease')
      .map(song => song.id),
    ['ne-1', 'ne-2', 'ne-3', 'ne-4'],
  );
  assert.equal(searchState.hasMore(session), false);
});

test('tracks partial provider failures without exposing raw error messages', () => {
  const session = searchState.createSession({
    query: 'Signal',
    mode: 'spotify',
    capabilities: searchState.normalizeCapabilitySnapshot(
      capabilitySnapshot(),
    ),
  });
  searchState.takeProviderRequests(session);
  searchState.applyProviderResponse(session, 'spotify', response(
    'spotify',
    [],
    {},
    [{
      provider: 'spotify',
      code: 'AUTH_REQUIRED',
      retryable: false,
      message: 'authorization required',
    }],
  ));

  assert.deepEqual(searchState.statusItems(session), [{
    provider: 'spotify',
    label: 'SPOTIFY',
    status: 'error',
    count: 0,
    errorCode: 'AUTH_REQUIRED',
    hasMore: false,
  }]);
  assert.equal(JSON.stringify(session).includes('authorization required'), false);

  const failure = new Error('token=network-secret');
  failure.code = 'SECRET_CODE';
  searchState.applyProviderFailure(session, 'spotify', failure);
  assert.equal(
    session.providerState.spotify.errorCode,
    'PROVIDER_REQUEST_FAILED',
  );
  assert.equal(JSON.stringify(session).includes('network-secret'), false);
});

test('derives row actions from capability availability and record playback', () => {
  const capabilities = searchState.normalizeCapabilitySnapshot(
    capabilitySnapshot({
      netease: { playback: true, playlistWrite: true },
      qq: { playback: true, playlistWrite: false },
      kugou: { playback: true, playlistWrite: true },
    }),
  );
  const session = searchState.createSession({
    query: 'actions',
    mode: 'song',
    capabilities,
  });
  searchState.applyProviderResponse(session, 'netease', response('netease', [
    record('netease', 'ne'),
  ]));
  searchState.applyProviderResponse(session, 'qq', response('qq', [
    record('qq', 'qq'),
  ]));
  searchState.applyProviderResponse(session, 'kugou', response('kugou', [
    record('kugou', 'kg'),
  ]));

  assert.deepEqual(searchState.actionState(session.songs[0]), {
    play: true,
    queue: true,
    like: true,
    collect: true,
    metadataOnly: false,
  });
  assert.deepEqual(searchState.actionState(session.songs[1]), {
    play: true,
    queue: true,
    like: false,
    collect: false,
    metadataOnly: false,
  });
  assert.deepEqual(searchState.actionState(session.songs[2]), {
    play: false,
    queue: false,
    like: false,
    collect: false,
    metadataOnly: true,
  });
});

test('bounds accumulated rows and exposes a stable stale-session key', () => {
  const session = searchState.createSession({
    query: 'bounded',
    mode: 'song',
    maxResults: 3,
    capabilities: searchState.normalizeCapabilitySnapshot(
      capabilitySnapshot(),
    ),
  });
  searchState.applyProviderResponse(session, 'netease', response('netease', [
    record('netease', '1'),
    record('netease', '2'),
  ]));
  searchState.applyProviderResponse(session, 'qq', response('qq', [
    record('qq', '1'),
    record('qq', '2'),
  ]));

  assert.equal(session.songs.length, 3);
  assert.equal(
    searchState.sessionMatches(session, 'song|bounded'),
    true,
  );
  assert.equal(
    searchState.sessionMatches(session, 'song|new-query'),
    false,
  );
});
