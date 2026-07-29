'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const capabilityModule = require('../server/platform/capabilities');
const {
  PLATFORM_CAPABILITY_SCHEMA,
  PLATFORM_ORDER,
  createCapabilitySnapshot,
  providerCapability,
} = capabilityModule;
const {
  createBaselineImplementationRegistry,
  createImplementationRegistry,
} = require('../server/platform/implementation-registry');
const {
  createFeatureFlags,
} = require('../server/platform/feature-flags');

const CAPABILITY_KEYS = [
  'search',
  'playback',
  'sourceMatch',
  'albumDetail',
  'albumCollect',
  'playlistSubscribe',
  'playlistWrite',
  'commentsRead',
  'commentsLike',
  'commentsCreate',
  'recentPlayReport',
  'listenDurationReport',
];

const PLATFORM_CONTRACT = [
  {
    provider: 'netease',
    label: '网易云音乐',
    authMethods: ['qr', 'cookie', 'external-window'],
    enabledCapabilities: CAPABILITY_KEYS,
  },
  {
    provider: 'qq',
    label: 'QQ 音乐',
    authMethods: ['cookie', 'external-window'],
    enabledCapabilities: ['search', 'playback', 'sourceMatch', 'commentsRead'],
  },
  {
    provider: 'kugou',
    label: '酷狗音乐',
    authMethods: ['cookie', 'external-window'],
    enabledCapabilities: ['search'],
  },
  {
    provider: 'qishui',
    label: '汽水音乐',
    authMethods: ['token', 'cookie', 'external-window'],
    enabledCapabilities: ['search'],
  },
  {
    provider: 'spotify',
    label: 'Spotify',
    authMethods: ['pkce', 'external-window'],
    enabledCapabilities: ['search'],
  },
];

function expectedCapabilityMatrix(enabledCapabilities) {
  const enabled = new Set(enabledCapabilities);
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, enabled.has(key)]));
}

test('exports the capability schema and fixed provider order', () => {
  assert.equal(PLATFORM_CAPABILITY_SCHEMA, 1);
  assert.deepEqual(PLATFORM_ORDER, PLATFORM_CONTRACT.map(item => item.provider));
  assert.equal(Object.isFrozen(PLATFORM_ORDER), true);
});

test('creates all five providers in stable order with fixed labels, auth methods and matrices', () => {
  const snapshot = createCapabilitySnapshot({}, { now: () => 123456789 });

  assert.equal(snapshot.schema, PLATFORM_CAPABILITY_SCHEMA);
  assert.equal(snapshot.generatedAt, 123456789);
  assert.deepEqual(snapshot.providers.map(item => item.provider), PLATFORM_ORDER);

  for (const expected of PLATFORM_CONTRACT) {
    const actual = providerCapability(snapshot, expected.provider);
    assert.equal(actual.label, expected.label);
    assert.deepEqual(actual.authMethods, expected.authMethods);
    assert.deepEqual(Object.keys(actual.capabilities), CAPABILITY_KEYS);
    assert.deepEqual(
      actual.capabilities,
      expectedCapabilityMatrix(expected.enabledCapabilities),
    );
    assert.deepEqual(Object.keys(actual.availability), CAPABILITY_KEYS);
  }
});

test('falls back to a finite timestamp when the injected clock fails', () => {
  const invalidClocks = [
    () => {
      throw new Error('clock-secret');
    },
    () => undefined,
    () => Number.NaN,
    () => Number.POSITIVE_INFINITY,
  ];

  for (const now of invalidClocks) {
    const snapshot = createCapabilitySnapshot({}, { now });
    assert.equal(Number.isFinite(snapshot.generatedAt), true);
    assert.deepEqual(snapshot.providers.map(item => item.provider), PLATFORM_ORDER);
    assert.equal(JSON.stringify(snapshot).includes('clock-secret'), false);
  }

  assert.equal(
    createCapabilitySnapshot({}, { now: () => 987654321 }).generatedAt,
    987654321,
  );
});

test('default availability only enables implemented capabilities and preserves logged-out playback', () => {
  const snapshot = createCapabilitySnapshot();
  const netease = providerCapability(snapshot, 'netease');
  const qq = providerCapability(snapshot, 'qq');

  assert.deepEqual(
    Object.entries(netease.availability)
      .filter(([, available]) => available)
      .map(([capability]) => capability),
    ['search', 'playback', 'sourceMatch', 'commentsRead'],
  );
  assert.deepEqual(
    Object.entries(qq.availability)
      .filter(([, available]) => available)
      .map(([capability]) => capability),
    ['search', 'playback', 'sourceMatch', 'commentsRead'],
  );

  const loggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }), 'netease');
  assert.equal(loggedIn.availability.playlistWrite, true);
  assert.equal(loggedIn.availability.recentPlayReport, false);
  assert.equal(loggedIn.availability.listenDurationReport, false);
});

test('metadata-only provider search is enabled after the adapters are wired', () => {
  const statuses = {
    kugou: {
      loggedIn: true,
      search: true,
      availability: { search: true },
      enabledCapabilities: ['search'],
    },
    qishui: {
      loggedIn: true,
      search: true,
      availability: { search: true },
      enabledCapabilities: ['search'],
    },
    spotify: {
      loggedIn: true,
      search: true,
      availability: { search: true },
      enabledCapabilities: ['search'],
    },
  };
  const defaultSnapshot = createCapabilitySnapshot(statuses);

  for (const provider of ['kugou', 'qishui', 'spotify']) {
    const capability = providerCapability(defaultSnapshot, provider);
    assert.equal(capability.capabilities.search, true, provider);
    assert.equal(capability.availability.search, true, provider);
  }
});

test('metadata-only providers never advertise playback, matching or writes even when logged in', () => {
  const snapshot = createCapabilitySnapshot({
    kugou: {
      loggedIn: true,
      capabilities: { playback: true, playlistWrite: true },
      enabledCapabilities: ['playback', 'playlistWrite'],
    },
    qishui: { loggedIn: true, playback: true, playlistWrite: true },
    spotify: { loggedIn: true, playback: true, commentsCreate: true },
  }, {
    enabledCapabilities: {
      kugou: ['search', 'playback', 'playlistWrite', 'commentsCreate'],
      qishui: ['search', 'sourceMatch', 'albumCollect', 'recentPlayReport'],
      spotify: ['search', 'playback', 'commentsLike', 'listenDurationReport'],
    },
  });

  for (const provider of ['kugou', 'qishui', 'spotify']) {
    const item = providerCapability(snapshot, provider);
    assert.deepEqual(
      Object.entries(item.capabilities)
        .filter(([, supported]) => supported)
        .map(([capability]) => capability),
      ['search'],
    );
    assert.deepEqual(
      Object.entries(item.availability)
        .filter(([, available]) => available)
        .map(([capability]) => capability),
      ['search'],
    );
  }
});

test('plain options cannot enable unwired Netease operations', () => {
  const unwired = [
    'albumDetail',
    'albumCollect',
    'playlistSubscribe',
    'commentsLike',
    'commentsCreate',
    'recentPlayReport',
    'listenDurationReport',
  ];
  const defaultLoggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }), 'netease');
  const forged = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }, {
    enabledCapabilities: { netease: unwired },
    implementationRegistry: {
      has: () => true,
      snapshot: () => ({ netease: unwired }),
    },
  }), 'netease');

  for (const capability of unwired) {
    assert.equal(defaultLoggedIn.capabilities[capability], true, capability);
    assert.equal(defaultLoggedIn.availability[capability], false, capability);
    assert.equal(forged.availability[capability], false, capability);
  }
});

test('only a private implementation registry can expose implemented operations', () => {
  const registry = createImplementationRegistry();
  registry.register('netease', 'albumDetail');
  registry.register('netease', 'albumCollect');
  registry.register('kugou', 'playback');
  const featureFlags = createFeatureFlags({ platformWrites: true });

  const loggedOut = createCapabilitySnapshot({}, {
    implementationRegistry: registry,
    featureFlags,
  });
  const loggedIn = createCapabilitySnapshot({
    netease: { loggedIn: true },
    kugou: { loggedIn: true },
  }, {
    implementationRegistry: registry,
    featureFlags,
  });

  assert.equal(
    providerCapability(loggedOut, 'netease').availability.albumDetail,
    true,
  );
  assert.equal(
    providerCapability(loggedOut, 'netease').availability.albumCollect,
    false,
  );
  assert.equal(
    providerCapability(loggedIn, 'netease').availability.albumCollect,
    true,
  );
  assert.equal(
    providerCapability(loggedIn, 'kugou').availability.playback,
    false,
  );
});

test('invalid explicit registry and feature flag objects fail closed', () => {
  const invalidRegistry = {
    register() {},
    unregister() {},
    has() {
      return true;
    },
    snapshot() {
      return {};
    },
  };
  const invalidFlags = {
    isEnabled() {
      return true;
    },
    snapshot() {
      return {};
    },
  };
  const snapshot = createCapabilitySnapshot({
    netease: { loggedIn: true },
  }, {
    implementationRegistry: invalidRegistry,
    featureFlags: invalidFlags,
    enabledCapabilities: { netease: CAPABILITY_KEYS },
  });

  assert.equal(
    Object.values(providerCapability(snapshot, 'netease').availability)
      .some(Boolean),
    false,
  );
});

test('feature flags disable registered operations but never invent platform support', () => {
  const registry = createBaselineImplementationRegistry();
  registry.register('netease', 'recentPlayReport');
  registry.register('kugou', 'playback');

  const writesOff = createFeatureFlags({
    platformWrites: false,
    listenReporting: false,
  });
  const writesOn = createFeatureFlags({
    platformWrites: true,
    listenReporting: true,
  });
  const status = {
    netease: { loggedIn: true },
    kugou: { loggedIn: true },
  };
  const disabled = createCapabilitySnapshot(status, {
    implementationRegistry: registry,
    featureFlags: writesOff,
  });
  const enabled = createCapabilitySnapshot(status, {
    implementationRegistry: registry,
    featureFlags: writesOn,
  });

  assert.equal(
    providerCapability(disabled, 'netease').availability.playlistWrite,
    false,
  );
  assert.equal(
    providerCapability(disabled, 'netease').availability.recentPlayReport,
    false,
  );
  assert.equal(
    providerCapability(enabled, 'netease').availability.playlistWrite,
    true,
  );
  assert.equal(
    providerCapability(enabled, 'netease').availability.recentPlayReport,
    true,
  );
  assert.equal(
    providerCapability(enabled, 'kugou').availability.playback,
    false,
  );
});

test('public reads and playback do not require login while writes and reports do', () => {
  const implementationRegistry = createImplementationRegistry();
  for (const capability of CAPABILITY_KEYS) {
    implementationRegistry.register('netease', capability);
  }
  const featureFlags = createFeatureFlags({
    platformWrites: true,
    listenReporting: true,
  });
  const loggedOut = providerCapability(createCapabilitySnapshot({}, {
    implementationRegistry,
    featureFlags,
  }), 'netease');
  const loggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }, {
    implementationRegistry,
    featureFlags,
  }), 'netease');

  for (const capability of [
    'search',
    'playback',
    'sourceMatch',
    'albumDetail',
    'commentsRead',
  ]) {
    assert.equal(loggedOut.availability[capability], true, capability);
  }
  for (const capability of [
    'albumCollect',
    'playlistSubscribe',
    'playlistWrite',
    'commentsLike',
    'commentsCreate',
    'recentPlayReport',
    'listenDurationReport',
  ]) {
    assert.equal(loggedOut.availability[capability], false, capability);
    assert.equal(loggedIn.availability[capability], true, capability);
  }
});

test('sanitizes account and membership data without leaking credentials or unknown fields', () => {
  const snapshot = createCapabilitySnapshot({
    netease: {
      loggedIn: true,
      userId: 1001,
      nickname: 'Tomato',
      avatar: 'https://example.test/avatar.png',
      cookie: 'MUSIC_U=cookie-secret',
      token: 'token-secret',
      refreshToken: 'refresh-secret',
      unknown: 'unknown-secret',
      membership: {
        vipLevel: 'svip',
        isVip: true,
        isSvip: true,
        known: true,
        token: 'membership-secret',
        extra: 'membership-extra',
      },
    },
  });
  const account = providerCapability(snapshot, 'netease').account;

  assert.deepEqual(account, {
    loggedIn: true,
    accountId: '1001',
    nickname: 'Tomato',
    avatar: 'https://example.test/avatar.png',
    membership: {
      vipLevel: 'svip',
      isVip: true,
      isSvip: true,
      known: true,
    },
  });
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    'cookie-secret',
    'token-secret',
    'refresh-secret',
    'unknown-secret',
    'membership-secret',
    'membership-extra',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('normalizes current top-level membership fields into the public account shape', () => {
  const account = providerCapability(createCapabilitySnapshot({
    netease: {
      loggedIn: true,
      accountId: 'account-1',
      vipLevel: 'vip',
      isVip: true,
      isSvip: false,
    },
  }), 'netease').account;

  assert.deepEqual(account.membership, {
    vipLevel: 'vip',
    isVip: true,
    isSvip: false,
    known: true,
  });
});

test('ignores unknown platforms and unknown capabilities', () => {
  const snapshot = createCapabilitySnapshot({
    tidal: { loggedIn: true },
    netease: { loggedIn: true, imaginaryWrite: true },
  }, {
    enabledCapabilities: {
      tidal: CAPABILITY_KEYS,
      netease: ['search', 'imaginaryWrite'],
    },
  });

  assert.equal(providerCapability(snapshot, 'tidal'), null);
  assert.deepEqual(snapshot.providers.map(item => item.provider), PLATFORM_ORDER);
  const netease = providerCapability(snapshot, 'netease');
  assert.equal(Object.hasOwn(netease.capabilities, 'imaginaryWrite'), false);
  assert.equal(Object.hasOwn(netease.availability, 'imaginaryWrite'), false);
  assert.equal(netease.availability.search, true);
  assert.equal(netease.availability.playback, true);
  assert.equal(netease.availability.albumDetail, false);
});

test('returns fresh deep copies for snapshots and provider lookups', () => {
  const status = {
    netease: {
      loggedIn: true,
      accountId: 'account-1',
      membership: {
        vipLevel: 'vip',
        isVip: true,
        isSvip: false,
        known: true,
      },
    },
  };
  const firstSnapshot = createCapabilitySnapshot(status, { now: () => 1 });
  const firstProvider = providerCapability(firstSnapshot, 'netease');

  firstSnapshot.providers[0].authMethods.push('mutated');
  firstSnapshot.providers[0].account.membership.vipLevel = 'mutated';
  firstSnapshot.providers[0].capabilities.search = false;
  firstSnapshot.providers[0].availability.search = false;
  firstProvider.authMethods.length = 0;
  firstProvider.account.membership.isVip = false;

  const secondProviderLookup = providerCapability(firstSnapshot, 'netease');
  assert.deepEqual(secondProviderLookup.authMethods, [
    'qr',
    'cookie',
    'external-window',
    'mutated',
  ]);
  assert.equal(secondProviderLookup.account.membership.isVip, true);

  const nextSnapshot = createCapabilitySnapshot(status, { now: () => 2 });
  const nextProvider = providerCapability(nextSnapshot, 'netease');
  assert.deepEqual(nextProvider.authMethods, ['qr', 'cookie', 'external-window']);
  assert.equal(nextProvider.account.membership.vipLevel, 'vip');
  assert.equal(nextProvider.capabilities.search, true);
  assert.equal(nextProvider.availability.search, true);
  assert.notStrictEqual(nextSnapshot, firstSnapshot);
  assert.notStrictEqual(nextProvider, providerCapability(nextSnapshot, 'netease'));
  assert.notStrictEqual(
    nextProvider.account.membership,
    providerCapability(nextSnapshot, 'netease').account.membership,
  );
});
