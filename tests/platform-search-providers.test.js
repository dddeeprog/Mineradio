'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createLegacySearchAdapter,
} = require('../server/platform/providers/legacy-search');
const kugouProvider = require('../server/platform/providers/kugou-search');
const {
  createKugouSearchAdapter,
} = kugouProvider;
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
            SingerName: '<em>Artist A</em>、Artist B',
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

test('Kugou account verification requires a matching remote user id', async () => {
  assert.equal(typeof kugouProvider.createKugouAccountVerifier, 'function');
  const credential = {
    cookie: 'userid=12345; token=kugou-secret; kg_mid=fixed-mid; kg_dfid=fixed-dfid',
  };
  const calls = [];
  const verify = kugouProvider.createKugouAccountVerifier({
    now: () => 1_700_000_000_000,
    async requestJson(url, options, body) {
      calls.push({ url, options, body });
      return {
        status: 1,
        error_code: 0,
        data: {
          info: {
            self: [{
              list_create_userid: '12345',
              list_create_username: 'Verified Listener',
            }],
          },
        },
      };
    },
  });

  const account = await verify(credential);
  const requestUrl = new URL(calls[0].url);
  const requestBody = JSON.parse(calls[0].body);

  assert.equal(requestUrl.origin, 'https://gateway.kugou.com');
  assert.equal(requestUrl.pathname, '/v7/get_all_list');
  assert.equal(calls[0].options.headers['x-router'], 'cloudlist.service.kugou.com');
  assert.equal(requestBody.userid, 12345);
  assert.equal(requestBody.token, 'kugou-secret');
  assert.equal(account.loggedIn, true);
  assert.equal(account.verified, true);
  assert.equal(account.accountId, '12345');
  assert.equal(account.nickname, 'Verified Listener');
  assert.equal(JSON.stringify(account).includes('kugou-secret'), false);
});

test('Kugou account verification fails closed for rejected or unbound sessions', async t => {
  assert.equal(typeof kugouProvider.createKugouAccountVerifier, 'function');
  const credential = {
    cookie: 'userid=12345; token=kugou-secret; kg_mid=fixed-mid; kg_dfid=fixed-dfid',
  };
  const fixtures = {
    'http 401': () => {
      const error = new Error('401 with kugou-secret');
      error.statusCode = 401;
      throw error;
    },
    'provider error': () => ({
      status: 1,
      error_code: 1001,
      data: { userid: '12345' },
    }),
    'missing user id': () => ({ status: 1, error_code: 0, data: {} }),
    'different user id': () => ({
      status: 1,
      error_code: 0,
      data: { userid: '54321' },
    }),
  };

  for (const [name, response] of Object.entries(fixtures)) {
    await t.test(name, async () => {
      let accountLifecycleCalls = 0;
      const verify = kugouProvider.createKugouAccountVerifier({
        async requestJson() {
          return response();
        },
      });
      const account = await verify(credential);
      if (account.loggedIn === true) accountLifecycleCalls += 1;

      assert.equal(account.loggedIn, false);
      assert.equal(account.verified, false);
      assert.equal(accountLifecycleCalls, 0);
      assert.equal(JSON.stringify(account).includes('kugou-secret'), false);
    });
  }
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

test('Spotify adapter searches with the encrypted-session access token', async () => {
  const calls = [];
  const adapter = createSpotifySearchAdapter({
    env: { SPOTIFY_MARKET: 'GB' },
    now: () => 1000,
    getCredential() {
      return {
        accessToken: 'session-access',
        refreshToken: 'session-refresh',
        expiresAt: 3_601_000,
        clientId: 'public-client',
        scope: 'user-read-private',
      };
    },
    async requestJson(url, options) {
      calls.push({ url, options });
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

  const searchCalls = calls.filter(call => call.url.includes('/search?'));
  assert.equal(calls.filter(call => call.url.endsWith('/api/token')).length, 0);
  assert.equal(searchCalls.length, 2);
  assert.equal(searchCalls[0].options.headers.Authorization, 'Bearer session-access');
  assert.equal(new URL(searchCalls[0].url).searchParams.get('market'), 'GB');
  assert.equal(new URL(searchCalls[1].url).searchParams.get('offset'), '10');
  assert.equal(first.records[0].cover, 'https://img.example/large.jpg');
  assert.equal(first.records[0].playable, false);
  assert.equal(second.provider, 'spotify');
  assert.equal(JSON.stringify(first).includes('session-access'), false);
  assert.equal(JSON.stringify(first).includes('session-refresh'), false);
});

test('Spotify adapter refreshes expired PKCE credentials and persists the rotation', async () => {
  const calls = [];
  const persisted = [];
  const adapter = createSpotifySearchAdapter({
    now: () => 100_000,
    getCredential() {
      return {
        accessToken: 'expired-access',
        refreshToken: 'refresh-value',
        expiresAt: 99_000,
        clientId: 'public-client',
        scope: 'user-read-private',
      };
    },
    async persistCredential(credential) {
      persisted.push(credential);
    },
    async requestJson(url, options, body) {
      calls.push({ url, options, body });
      if (url.endsWith('/api/token')) {
        return {
          access_token: 'refreshed-access',
          expires_in: 1800,
          token_type: 'Bearer',
        };
      }
      return { tracks: { total: 0, next: null, items: [] } };
    },
  });

  await adapter.search({ query: 'empty', limit: 5, offset: 0 });

  assert.equal(calls.length, 2);
  const tokenBody = new URLSearchParams(calls[0].body);
  assert.equal(calls[0].url, 'https://accounts.spotify.com/api/token');
  assert.equal(tokenBody.get('grant_type'), 'refresh_token');
  assert.equal(tokenBody.get('refresh_token'), 'refresh-value');
  assert.equal(tokenBody.get('client_id'), 'public-client');
  assert.equal(tokenBody.has('client_secret'), false);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer refreshed-access');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].accessToken, 'refreshed-access');
  assert.equal(persisted[0].refreshToken, 'refresh-value');
});

test('Spotify adapter rejects a refreshed credential when its conditional write is stale', async () => {
  const calls = [];
  const adapter = createSpotifySearchAdapter({
    now: () => 100_000,
    getCredential() {
      return {
        accessToken: 'expired-access',
        refreshToken: 'refresh-value',
        expiresAt: 99_000,
        clientId: 'public-client',
        scope: 'user-read-private',
        sessionRevision: 7,
      };
    },
    async persistCredential(nextCredential, previousCredential) {
      assert.equal(nextCredential.accessToken, 'refreshed-access');
      assert.equal(previousCredential.sessionRevision, 7);
      return { replaced: false, revision: 8 };
    },
    async requestJson(url) {
      calls.push(url);
      if (url.endsWith('/api/token')) {
        return {
          access_token: 'refreshed-access',
          expires_in: 1800,
          token_type: 'Bearer',
        };
      }
      return { tracks: { total: 0, next: null, items: [] } };
    },
  });

  await assert.rejects(
    adapter.search({ query: 'stale', limit: 5, offset: 0 }),
    error => error.code === 'AUTH_REQUIRED',
  );
  assert.deepEqual(calls, ['https://accounts.spotify.com/api/token']);
});

test('Spotify adapter rejects a refresh response that expands the minimal scope', async () => {
  const persisted = [];
  const adapter = createSpotifySearchAdapter({
    now: () => 100_000,
    getCredential() {
      return {
        accessToken: 'expired-access',
        refreshToken: 'refresh-value',
        expiresAt: 99_000,
        clientId: 'public-client',
        scope: 'user-read-private',
      };
    },
    async persistCredential(credential) {
      persisted.push(credential);
    },
    async requestJson(url) {
      assert.equal(url, 'https://accounts.spotify.com/api/token');
      return {
        access_token: 'expanded-access',
        expires_in: 1800,
        scope: 'user-read-private user-library-read',
      };
    },
  });

  await assert.rejects(
    adapter.search({ query: 'scope', limit: 5, offset: 0 }),
    error => error.code === 'AUTH_REQUIRED',
  );
  assert.deepEqual(persisted, []);
});

test('Spotify adapter fails with a stable secret-free code when auth is absent', async () => {
  const adapter = createSpotifySearchAdapter({
    getCredential: () => null,
    async requestJson() {
      throw new Error('must not request');
    },
  });

  await assert.rejects(
    adapter.search({ query: 'Signal', limit: 10, offset: 0 }),
    error => {
      assert.equal(error.code, 'AUTH_REQUIRED');
      assert.equal(error.provider, 'spotify');
      assert.equal(error.retryable, false);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return true;
    },
  );
});

test('Spotify adapter treats an empty search payload as an empty page', async () => {
  const adapter = createSpotifySearchAdapter({
    now: () => 100_000,
    getCredential() {
      return {
        accessToken: 'session-access',
        refreshToken: 'session-refresh',
        expiresAt: 200_000,
        clientId: 'public-client',
        scope: 'user-read-private',
      };
    },
    async requestJson() {
      return null;
    },
  });

  const page = await adapter.search({
    query: 'empty',
    limit: 10,
    offset: 0,
  });

  assert.equal(page.provider, 'spotify');
  assert.deepEqual(page.records, []);
  assert.equal(page.pagination.total, 0);
  assert.equal(page.pagination.hasMore, false);
});

test('Spotify adapter source has no client-secret or client-credentials path', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'server',
      'platform',
      'providers',
      'spotify-search.js',
    ),
    'utf8',
  );

  assert.doesNotMatch(source, /client_secret|client_credentials/i);
});
