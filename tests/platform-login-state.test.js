'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PLATFORM_LOGIN_PROVIDERS,
  createLoginState,
  createManualImportPayload,
  selectLoginProvider,
} = require('../public/platform-login-state');

function capabilitySnapshot() {
  return {
    schema: 1,
    providers: [
      {
        provider: 'netease',
        label: '网易云音乐',
        authMethods: ['qr', 'cookie', 'external-window'],
        account: { loggedIn: true, accountId: 'ne-user' },
        capabilities: { playback: true },
        availability: { playback: true },
      },
      {
        provider: 'qq',
        label: 'QQ 音乐',
        authMethods: ['cookie', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: true },
        availability: { playback: true },
      },
      {
        provider: 'kugou',
        label: '酷狗音乐',
        authMethods: ['cookie', 'external-window'],
        account: { loggedIn: true, accountId: 'kg-user' },
        capabilities: { playback: false },
        availability: { playback: false },
      },
      {
        provider: 'qishui',
        label: '汽水音乐',
        authMethods: ['token', 'cookie', 'external-window'],
        account: { loggedIn: false },
        capabilities: { playback: false },
        availability: { playback: false },
      },
      {
        provider: 'spotify',
        label: 'Spotify',
        authMethods: ['pkce', 'external-window'],
        account: { loggedIn: true, accountId: 'sp-user' },
        capabilities: { playback: false },
        availability: { playback: false },
      },
    ],
  };
}

test('login state derives five provider and auth-method rows from the snapshot', () => {
  const state = createLoginState(capabilitySnapshot(), {
    selectedProvider: 'qishui',
  });

  assert.deepEqual(PLATFORM_LOGIN_PROVIDERS, [
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify',
  ]);
  assert.equal(state.selectedProvider, 'qishui');
  assert.deepEqual(
    state.providers.map(item => [item.provider, item.authMethods]),
    [
      ['netease', ['qr', 'cookie', 'external-window']],
      ['qq', ['cookie', 'external-window']],
      ['kugou', ['cookie', 'external-window']],
      ['qishui', ['token', 'cookie', 'external-window']],
      ['spotify', ['pkce', 'external-window']],
    ],
  );
});

test('metadata-only login never implies playback availability', () => {
  const state = createLoginState(capabilitySnapshot());
  const kugou = state.providers.find(item => item.provider === 'kugou');
  const spotify = state.providers.find(item => item.provider === 'spotify');

  assert.equal(kugou.loggedIn, true);
  assert.equal(kugou.metadataOnly, true);
  assert.equal(kugou.playbackAvailable, false);
  assert.equal(spotify.loggedIn, true);
  assert.equal(spotify.metadataOnly, true);
  assert.equal(spotify.playbackAvailable, false);
});

test('unknown providers never fall back to Netease', () => {
  const state = createLoginState(capabilitySnapshot(), {
    selectedProvider: 'spotify',
  });

  assert.throws(
    () => selectLoginProvider(state, 'unknown'),
    error => error.code === 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
  );
  assert.equal(state.selectedProvider, 'spotify');
  assert.throws(
    () => createLoginState(capabilitySnapshot(), {
      selectedProvider: 'unknown',
    }),
    error => error.code === 'PLATFORM_LOGIN_PROVIDER_UNKNOWN',
  );
});

test('manual imports validate provider-method pairs and bounded values', () => {
  const state = createLoginState(capabilitySnapshot());

  assert.deepEqual(
    createManualImportPayload(state, 'qishui', 'token', '  token-value-123  '),
    {
      provider: 'qishui',
      method: 'token',
      value: 'token-value-123',
    },
  );
  assert.throws(
    () => createManualImportPayload(state, 'spotify', 'token', 'value'),
    error => error.code === 'PLATFORM_LOGIN_METHOD_UNAVAILABLE',
  );
  assert.throws(
    () => createManualImportPayload(state, 'qq', 'cookie', ' '),
    error => error.code === 'PLATFORM_LOGIN_VALUE_INVALID',
  );
  assert.throws(
    () => createManualImportPayload(state, 'qq', 'cookie', 'x'.repeat(32_769)),
    error => error.code === 'PLATFORM_LOGIN_VALUE_INVALID',
  );
});
