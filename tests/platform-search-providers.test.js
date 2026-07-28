'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createLegacySearchAdapter,
} = require('../server/platform/providers/legacy-search');
const {
  createKugouSearchAdapter,
} = require('../server/platform/providers/kugou-search');
const {
  createQishuiSearchAdapter,
} = require('../server/platform/providers/qishui-search');
const {
  createSpotifySearchAdapter,
} = require('../server/platform/providers/spotify-search');

test('legacy adapter passes native offsets and produces playable standard records', async () => {
  const calls = [];
  const adapter = createLegacySearchAdapter({
    provider: 'netease',
    supportsOffset: true,
    playbackAvailable: true,
    async search(query, limit, offset) {
      calls.push({ query, limit, offset });
      return {
        songs: [{
          id: 10,
          name: 'Native Page',
          artist: 'Artist',
          playable: false,
        }],
        total: 50,
        hasMore: true,
      };
    },
  });

  const page = await adapter.search({
    query: 'native',
    limit: 8,
    offset: 16,
  });

  assert.deepEqual(calls, [{ query: 'native', limit: 8, offset: 16 }]);
  assert.equal(page.records[0].playable, true);
  assert.deepEqual(page.pagination, {
    offset: 16,
    limit: 8,
    nextOffset: 17,
    hasMore: true,
    total: 50,
  });
});

test('legacy adapter overfetches and slices providers without native offsets', async () => {
  const calls = [];
  const adapter = createLegacySearchAdapter({
    provider: 'qq',
    playbackAvailable: true,
    async search(query, limit) {
      calls.push({ query, limit });
      return Array.from({ length: limit }, (_, index) => ({
        mid: 'qq-' + index,
        name: 'Track ' + index,
        artist: 'Artist',
        playable: false,
      }));
    },
  });

  const page = await adapter.search({
    query: 'page',
    limit: 3,
    offset: 4,
  });

  assert.deepEqual(calls, [{ query: 'page', limit: 7 }]);
  assert.deepEqual(
    page.records.map(record => record.sourceId),
    ['qq-4', 'qq-5', 'qq-6'],
  );
  assert.equal(page.pagination.nextOffset, 7);
  assert.equal(page.pagination.hasMore, true);
});

test('Kugou adapter uses the bounded public catalogue request and metadata model', async () => {
  const calls = [];
  const adapter = createKugouSearchAdapter({
    mid: 'fixed-mid',
    async requestJson(url, options) {
      calls.push({ url, options });
      return {
        data: {
          total: 30,
          lists: [{
            FileHash: 'KUGOU-HASH',
            SongName: '<em>Signal</em>',
            SingerName: 'Artist A、Artist B',
            AlbumName: 'Album',
            AlbumID: 12,
            MixSongID: 34,
            Duration: 215,
            Image: 'https://img.example/{size}/cover.jpg',
            Privilege: 10,
          }],
        },
      };
    },
  });

  const page = await adapter.search({
    query: 'signal',
    limit: 10,
    offset: 20,
  });
  const parsed = new URL(calls[0].url);

  assert.equal(parsed.protocol, 'http:');
  assert.equal(parsed.hostname, 'songsearch.kugou.com');
  assert.equal(parsed.searchParams.get('keyword'), 'signal');
  assert.equal(parsed.searchParams.get('page'), '3');
  assert.equal(parsed.searchParams.get('pagesize'), '10');
  assert.equal(parsed.searchParams.get('appid'), '1014');
  assert.equal(parsed.searchParams.get('mid'), 'fixed-mid');
  assert.equal(calls[0].options.headers.Referer, 'https://www.kugou.com/');
  assert.equal(page.records[0].title, 'Signal');
  assert.deepEqual(
    page.records[0].artists.map(artist => artist.name),
    ['Artist A', 'Artist B'],
  );
  assert.equal(page.records[0].cover, 'https://img.example/240/cover.jpg');
  assert.equal(page.records[0].durationMs, 215000);
  assert.equal(page.records[0].playable, false);
  assert.equal(page.pagination.total, 30);
  assert.equal(page.pagination.hasMore, true);
});

test('Qishui adapter ranks relevant public metadata and paginates locally', async () => {
  const calls = [];
  const adapter = createQishuiSearchAdapter({
    async requestJson(url, options) {
      calls.push({ url, options });
      return {
        data: {
          list: [
            {
              item_id: 'noise',
              title: 'Unrelated',
              author_info: { id: 'n', name: 'Nobody' },
            },
            {
              item_id: 'exact',
              title: 'Signal',
              author_info: { id: 'a', name: 'Target Artist' },
              album_info: { id: 'album', name: 'Target Album' },
              cover_url: { url_list: ['https://img.example/qishui.jpg'] },
              duration: 210000,
            },
            {
              item_id: 'artist',
              title: 'Another Song',
              author_info: { id: 'a', name: 'Signal' },
            },
          ],
        },
      };
    },
  });

  const page = await adapter.search({
    query: 'Signal',
    limit: 2,
    offset: 0,
  });
  const parsed = new URL(calls[0].url);

  assert.equal(parsed.hostname, 'api-vehicle.volcengine.com');
  assert.equal(parsed.searchParams.get('keyword'), 'Signal');
  assert.equal(parsed.searchParams.get('search_type'), 'music');
  assert.equal(parsed.searchParams.get('limit'), '36');
  assert.equal(parsed.searchParams.get('real_offset'), '0');
  assert.equal(parsed.searchParams.get('search_source'), 'qishui');
  assert.equal(calls[0].options.headers.Accept, 'application/json,text/plain,*/*');
  assert.deepEqual(
    page.records.map(record => record.sourceId),
    ['exact', 'artist'],
  );
  assert.equal(page.records[0].cover, 'https://img.example/qishui.jpg');
  assert.equal(page.records[0].durationMs, 210000);
  assert.equal(page.records[0].playable, false);
  assert.equal(page.pagination.nextOffset, 2);
});

test('Spotify adapter exchanges and caches client credentials without exposing them', async () => {
  const calls = [];
  const env = {
    SPOTIFY_CLIENT_ID: 'client-id',
    SPOTIFY_CLIENT_SECRET: 'client-secret',
    SPOTIFY_MARKET: 'GB',
  };
  const adapter = createSpotifySearchAdapter({
    env,
    now: () => 1000,
    async requestJson(url, options, body) {
      calls.push({ url, options, body });
      if (url.endsWith('/api/token')) {
        return {
          access_token: 'client-token',
          expires_in: 3600,
        };
      }
      return {
        tracks: {
          total: 2,
          next: null,
          items: [{
            id: 'spotify-track',
            name: 'Signal',
            artists: [{ id: 'artist', name: 'Artist' }],
            album: {
              id: 'album',
              name: 'Album',
              images: [
                { width: 64, url: 'https://img.example/small.jpg' },
                { width: 640, url: 'https://img.example/large.jpg' },
              ],
            },
            duration_ms: 199000,
            uri: 'spotify:track:spotify-track',
            external_urls: {
              spotify: 'https://open.spotify.com/track/spotify-track',
            },
            explicit: true,
          }],
        },
      };
    },
  });

  const first = await adapter.search({
    query: 'Signal',
    limit: 10,
    offset: 0,
  });
  const second = await adapter.search({
    query: 'Signal',
    limit: 10,
    offset: 10,
  });

  const tokenCalls = calls.filter(call => call.url.endsWith('/api/token'));
  const searchCalls = calls.filter(call => call.url.includes('/search?'));
  assert.equal(tokenCalls.length, 1);
  assert.equal(tokenCalls[0].options.method, 'POST');
  assert.equal(tokenCalls[0].body, 'grant_type=client_credentials');
  assert.equal(
    tokenCalls[0].options.headers.Authorization,
    'Basic ' + Buffer.from('client-id:client-secret').toString('base64'),
  );
  assert.equal(searchCalls.length, 2);
  assert.equal(searchCalls[0].options.headers.Authorization, 'Bearer client-token');
  assert.equal(new URL(searchCalls[0].url).searchParams.get('market'), 'GB');
  assert.equal(new URL(searchCalls[1].url).searchParams.get('offset'), '10');
  assert.equal(first.records[0].cover, 'https://img.example/large.jpg');
  assert.equal(first.records[0].playable, false);
  assert.equal(second.provider, 'spotify');
  assert.equal(JSON.stringify(first).includes('client-secret'), false);
  assert.equal(JSON.stringify(first).includes('client-token'), false);
});

test('Spotify adapter accepts an injected access token without client credentials', async () => {
  const calls = [];
  const adapter = createSpotifySearchAdapter({
    env: {
      SPOTIFY_ACCESS_TOKEN: 'access-only',
    },
    async requestJson(url, options) {
      calls.push({ url, options });
      return { tracks: { total: 0, next: null, items: [] } };
    },
  });

  await adapter.search({ query: 'empty', limit: 5, offset: 0 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access-only');
});

test('Spotify adapter fails with a stable secret-free code when auth is absent', async () => {
  const adapter = createSpotifySearchAdapter({
    env: {},
    async requestJson() {
      throw new Error('must not request');
    },
  });

  await assert.rejects(
    adapter.search({ query: 'Signal', limit: 10, offset: 0 }),
    error => {
      assert.equal(error.code, 'SPOTIFY_AUTH_REQUIRED');
      assert.equal(error.retryable, false);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return true;
    },
  );
});
