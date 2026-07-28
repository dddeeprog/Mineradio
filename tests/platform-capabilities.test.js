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

test('unwired provider search requires the server implementation allowlist', () => {
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
  const enabledSnapshot = createCapabilitySnapshot(statuses, {
    enabledCapabilities: {
      kugou: ['search'],
      qishui: ['search'],
      spotify: ['search'],
    },
  });

  for (const provider of ['kugou', 'qishui', 'spotify']) {
    const unavailable = providerCapability(defaultSnapshot, provider);
    const enabled = providerCapability(enabledSnapshot, provider);
    assert.equal(unavailable.capabilities.search, true, provider);
    assert.equal(unavailable.availability.search, false, provider);
    assert.equal(enabled.availability.search, true, provider);
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

test('unwired Netease operations require an allowlist while only writes require login', () => {
  const unwired = [
    'albumDetail',
    'albumCollect',
    'playlistSubscribe',
    'commentsLike',
    'commentsCreate',
  ];
  const defaultLoggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }), 'netease');
  const explicitlyEnabled = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }, {
    enabledCapabilities: { netease: unwired },
  }), 'netease');
  const loggedOut = providerCapability(createCapabilitySnapshot({}, {
    enabledCapabilities: { netease: unwired },
  }), 'netease');

  for (const capability of unwired) {
    assert.equal(defaultLoggedIn.capabilities[capability], true, capability);
    assert.equal(defaultLoggedIn.availability[capability], false, capability);
    assert.equal(explicitlyEnabled.availability[capability], true, capability);
  }
  assert.equal(loggedOut.availability.albumDetail, true);
  for (const capability of [
    'albumCollect',
    'playlistSubscribe',
    'commentsLike',
    'commentsCreate',
  ]) {
    assert.equal(loggedOut.availability[capability], false, capability);
  }
});

test('public reads and playback do not require login while writes and reports do', () => {
  const enabledCapabilities = {
    netease: CAPABILITY_KEYS,
  };
  const loggedOut = providerCapability(createCapabilitySnapshot({}, {
    enabledCapabilities,
  }), 'netease');
  const loggedIn = providerCapability(createCapabilitySnapshot({
    netease: { loggedIn: true },
  }, {
    enabledCapabilities,
  }), 'netease');

  for (const capability of ['search', 'playback', 'sourceMatch', 'commentsRead']) {
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
  assert.equal(netease.availability.playback, false);
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
