'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPlatformRoutes,
} = require('../server/routes/platform');
const {
  providerCapability,
} = require('../server/platform/capabilities');

function createResponseHarness(options) {
  let response = null;
  const routes = createPlatformRoutes({
    sendJSON(_res, body, status) {
      response = {
        body,
        status: status || 200,
      };
    },
    getAccountStatuses: options && options.getAccountStatuses
      ? options.getAccountStatuses
      : async () => ({}),
  });
  return {
    routes,
    response: () => response,
  };
}

test('platform route returns a complete sanitized capability snapshot', async () => {
  const harness = createResponseHarness({
    getAccountStatuses: async () => ({
      netease: {
        loggedIn: true,
        accountId: '1001',
        nickname: 'Tomato',
        cookie: 'MUSIC_U=route-secret',
        membership: {
          vipLevel: 'svip',
          isVip: true,
          token: 'membership-secret',
        },
      },
      qq: {
        loggedIn: true,
        userId: '2002',
        nickname: 'QQ Tomato',
        musicKey: 'qq-secret',
      },
    }),
  });

  assert.equal(await harness.routes.handleRoute(
    '/api/platform/capabilities',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/capabilities'),
  ), true);

  const response = harness.response();
  assert.equal(response.status, 200);
  assert.equal(response.body.schema, 1);
  assert.deepEqual(
    response.body.providers.map(provider => provider.provider),
    ['netease', 'qq', 'kugou', 'qishui', 'spotify'],
  );
  assert.equal(
    providerCapability(response.body, 'netease').account.loggedIn,
    true,
  );
  assert.equal(
    providerCapability(response.body, 'qq').account.accountId,
    '2002',
  );
  const serialized = JSON.stringify(response.body);
  for (const secret of [
    'route-secret',
    'membership-secret',
    'qq-secret',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('platform route fails soft with a complete logged-out snapshot', async () => {
  const harness = createResponseHarness({
    getAccountStatuses: async () => {
      throw new Error('MUSIC_U=status-secret');
    },
  });

  assert.equal(await harness.routes.handleRoute(
    '/api/platform/capabilities',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/capabilities'),
  ), true);

  const response = harness.response();
  assert.equal(response.status, 200);
  assert.equal(response.body.providers.length, 5);
  assert.equal(
    response.body.providers.every(provider => !provider.account.loggedIn),
    true,
  );
  assert.equal(JSON.stringify(response.body).includes('status-secret'), false);
});

test('request data cannot enable metadata-provider playback or writes', async () => {
  const harness = createResponseHarness({
    getAccountStatuses: async () => ({
      kugou: {
        loggedIn: true,
        enabledCapabilities: ['playback', 'playlistWrite'],
        availability: { playback: true, playlistWrite: true },
      },
      qishui: {
        loggedIn: true,
        enabledCapabilities: ['playback', 'playlistWrite'],
        availability: { playback: true, playlistWrite: true },
      },
      spotify: {
        loggedIn: true,
        enabledCapabilities: ['playback', 'playlistWrite'],
        availability: { playback: true, playlistWrite: true },
      },
    }),
  });
  const request = {
    method: 'GET',
    body: {
      enabledCapabilities: {
        kugou: ['playback', 'playlistWrite'],
        qishui: ['playback', 'playlistWrite'],
        spotify: ['playback', 'playlistWrite'],
      },
    },
    enabledCapabilities: {
      kugou: ['playback', 'playlistWrite'],
      qishui: ['playback', 'playlistWrite'],
      spotify: ['playback', 'playlistWrite'],
    },
  };
  const url = new URL(
    'http://localhost/api/platform/capabilities'
      + '?enabledCapabilities[kugou]=playback'
      + '&enabledCapabilities[qishui]=playlistWrite'
      + '&enabledCapabilities[spotify]=playback',
  );

  await harness.routes.handleRoute(
    '/api/platform/capabilities',
    request,
    {},
    url,
  );

  for (const provider of ['kugou', 'qishui', 'spotify']) {
    const capability = providerCapability(harness.response().body, provider);
    assert.equal(capability.capabilities.search, true, provider);
    assert.equal(capability.availability.search, true, provider);
    assert.equal(capability.capabilities.playback, false, provider);
    assert.equal(capability.availability.playback, false, provider);
    assert.equal(capability.availability.playlistWrite, false, provider);
  }
});

test('platform route rejects non-GET methods without loading account state', async () => {
  let statusCalls = 0;
  const harness = createResponseHarness({
    getAccountStatuses: async () => {
      statusCalls += 1;
      return {};
    },
  });

  assert.equal(await harness.routes.handleRoute(
    '/api/platform/capabilities',
    { method: 'POST' },
    {},
    new URL('http://localhost/api/platform/capabilities'),
  ), true);
  assert.deepEqual(harness.response(), {
    status: 405,
    body: {
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
    },
  });
  assert.equal(statusCalls, 0);
});

test('platform route ignores unrelated paths', async () => {
  const harness = createResponseHarness();

  assert.equal(await harness.routes.handleRoute(
    '/api/search',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/search'),
  ), false);
  assert.equal(harness.response(), null);
});
