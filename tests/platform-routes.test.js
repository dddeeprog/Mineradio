'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createPlatformRoutes,
} = require('../server/routes/platform');
const {
  providerCapability,
} = require('../server/platform/capabilities');
const {
  createImplementationRegistry,
} = require('../server/platform/implementation-registry');
const {
  createFeatureFlags,
} = require('../server/platform/feature-flags');

function createResponseHarness(options) {
  options = options || {};
  let response = null;
  const calls = [];
  const deps = {
    sendJSON(_res, body, status) {
      response = {
        body,
        status: status || 200,
      };
    },
    getAccountStatuses: options.getAccountStatuses
      ? options.getAccountStatuses
      : async () => ({}),
    readRequestBody: options.readRequestBody
      ? options.readRequestBody
      : async req => req.body || {},
    loginCredential: options.loginCredential
      ? options.loginCredential
      : async (provider, credential, method) => {
        calls.push({ type: 'login', provider, credential, method });
        return { provider, loggedIn: true, accountId: `${provider}-user` };
      },
    logoutCredential: options.logoutCredential
      ? options.logoutCredential
      : async provider => {
        calls.push({ type: 'logout', provider });
        return { provider, loggedIn: false };
      },
  };
  for (const dependency of [
    'implementationRegistry',
    'featureFlags',
    'createCapabilitySnapshot',
  ]) {
    if (Object.prototype.hasOwnProperty.call(options, dependency)) {
      deps[dependency] = options[dependency];
    }
  }
  const routes = createPlatformRoutes(deps);
  return {
    routes,
    calls,
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

test('platform route only uses a constructor-captured private registry and flags', async () => {
  const implementationRegistry = createImplementationRegistry();
  implementationRegistry.register('netease', 'albumDetail');
  implementationRegistry.register('netease', 'albumCollect');
  const featureFlags = createFeatureFlags({ platformWrites: false });
  const harness = createResponseHarness({
    implementationRegistry,
    featureFlags,
    getAccountStatuses: async () => ({
      netease: { loggedIn: true },
    }),
  });

  await harness.routes.handleRoute(
    '/api/platform/capabilities',
    {
      method: 'GET',
      implementationRegistry: createImplementationRegistry(),
      featureFlags: createFeatureFlags({ platformWrites: true }),
      body: {
        enabledCapabilities: { netease: ['albumCollect'] },
      },
    },
    {},
    new URL(
      'http://localhost/api/platform/capabilities'
        + '?enabledCapabilities[netease]=albumCollect',
    ),
  );

  const netease = providerCapability(harness.response().body, 'netease');
  assert.equal(netease.availability.albumDetail, true);
  assert.equal(netease.availability.albumCollect, false);
  assert.equal(netease.availability.search, false);
});

test('platform route fails closed for lookalike registry and feature flag objects', async () => {
  const harness = createResponseHarness({
    implementationRegistry: {
      has() {
        return true;
      },
      snapshot() {
        return {};
      },
    },
    featureFlags: {
      isEnabled() {
        return true;
      },
      snapshot() {
        return {};
      },
    },
    getAccountStatuses: async () => ({
      netease: { loggedIn: true },
    }),
  });

  await harness.routes.handleRoute(
    '/api/platform/capabilities',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/capabilities'),
  );

  assert.equal(
    Object.values(
      providerCapability(harness.response().body, 'netease').availability,
    ).some(Boolean),
    false,
  );
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

test('platform login import validates the provider method and returns no credential', async () => {
  const harness = createResponseHarness();

  assert.equal(await harness.routes.handleRoute(
    '/api/platform/login/import',
    {
      method: 'POST',
      body: {
        provider: 'qishui',
        method: 'token',
        value: '  qishui-token-value  ',
      },
    },
    {},
    new URL('http://localhost/api/platform/login/import'),
  ), true);

  assert.deepEqual(harness.calls, [{
    type: 'login',
    provider: 'qishui',
    credential: { token: 'qishui-token-value' },
    method: 'token',
  }]);
  assert.deepEqual(harness.response(), {
    status: 200,
    body: {
      ok: true,
      provider: 'qishui',
      loggedIn: true,
      accountId: 'qishui-user',
      nickname: '',
      avatar: '',
      membership: {
        vipLevel: 'none',
        isVip: false,
        isSvip: false,
        known: false,
      },
    },
  });
  assert.equal(
    JSON.stringify(harness.response()).includes('qishui-token-value'),
    false,
  );
});

test('platform login import rejects unknown providers and unsupported methods', async () => {
  for (const body of [
    { provider: 'unknown', method: 'cookie', value: 'a=b' },
    { provider: 'spotify', method: 'token', value: 'token-value' },
    { provider: 'qq', method: 'cookie', value: '' },
    { provider: 'netease', method: 'cookie', value: 'not-a-cookie' },
  ]) {
    const harness = createResponseHarness();
    await harness.routes.handleRoute(
      '/api/platform/login/import',
      { method: 'POST', body },
      {},
      new URL('http://localhost/api/platform/login/import'),
    );
    assert.equal(harness.response().status, 400);
    assert.match(
      harness.response().body.error,
      /^PLATFORM_LOGIN_(?:PROVIDER_UNKNOWN|METHOD_UNAVAILABLE|VALUE_INVALID)$/,
    );
    assert.equal(harness.calls.length, 0);
  }
});

test('platform PKCE import accepts structured tokens only through the PKCE method', async () => {
  const harness = createResponseHarness();
  const credential = {
    accessToken: 'spotify-access',
    refreshToken: 'spotify-refresh',
    expiresAt: Date.now() + 3600000,
    clientId: 'public-client',
    scope: 'user-read-private',
  };

  await harness.routes.handleRoute(
    '/api/platform/login/import',
    {
      method: 'POST',
      body: {
        provider: 'spotify',
        method: 'pkce',
        credential,
      },
    },
    {},
    new URL('http://localhost/api/platform/login/import'),
  );

  assert.deepEqual(harness.calls[0], {
    type: 'login',
    provider: 'spotify',
    credential: {
      ...credential,
      tokenType: 'Bearer',
    },
    method: 'pkce',
  });
  assert.equal(
    JSON.stringify(harness.response()).includes('spotify-access'),
    false,
  );
});

test('platform logout is per-provider and unknown providers do not fall back', async () => {
  const harness = createResponseHarness();
  await harness.routes.handleRoute(
    '/api/platform/logout',
    {
      method: 'POST',
      body: { provider: 'kugou' },
    },
    {},
    new URL('http://localhost/api/platform/logout'),
  );

  assert.deepEqual(harness.calls, [{
    type: 'logout',
    provider: 'kugou',
  }]);
  assert.equal(harness.response().body.provider, 'kugou');

  const unknown = createResponseHarness();
  await unknown.routes.handleRoute(
    '/api/platform/logout',
    {
      method: 'POST',
      body: { provider: 'unknown' },
    },
    {},
    new URL('http://localhost/api/platform/logout'),
  );
  assert.equal(unknown.response().status, 400);
  assert.equal(
    unknown.response().body.error,
    'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
  );
  assert.equal(unknown.calls.length, 0);
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
