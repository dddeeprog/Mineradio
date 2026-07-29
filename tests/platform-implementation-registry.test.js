'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  IMPLEMENTATION_CAPABILITIES,
  IMPLEMENTATION_PROVIDERS,
  PLATFORM_IMPLEMENTATION_SCHEMA,
  createBaselineImplementationRegistry,
  createImplementationRegistry,
  isImplementationRegistry,
} = require('../server/platform/implementation-registry');
const {
  DEFAULT_FEATURE_FLAG_VALUES,
  FEATURE_FLAG_KEYS,
  createFeatureFlags,
  isFeatureFlags,
} = require('../server/platform/feature-flags');

test('implementation registry registers and unregisters known capabilities idempotently', () => {
  const registry = createImplementationRegistry();

  assert.equal(isImplementationRegistry(registry), true);
  assert.equal(registry.has('netease', 'search'), false);
  assert.equal(registry.register('netease', 'search'), true);
  assert.equal(registry.register('netease', 'search'), false);
  assert.equal(registry.has('netease', 'search'), true);
  assert.equal(registry.unregister('netease', 'search'), true);
  assert.equal(registry.unregister('netease', 'search'), false);
  assert.equal(registry.has('netease', 'search'), false);
});

test('implementation registry rejects unknown registration keys without exposing internals', () => {
  const registry = createImplementationRegistry();

  assert.throws(
    () => registry.register('tidal', 'search'),
    /unknown provider/i,
  );
  assert.throws(
    () => registry.register('netease', 'imaginaryWrite'),
    /unknown capability/i,
  );
  assert.equal(registry.has('tidal', 'search'), false);
  assert.equal(registry.has('netease', 'imaginaryWrite'), false);
  assert.equal(registry.unregister('tidal', 'search'), false);
  assert.equal(registry.unregister('netease', 'imaginaryWrite'), false);
});

test('registry identity cannot be copied, proxied or recovered from a snapshot', () => {
  const registry = createImplementationRegistry();
  const lookalike = {
    register: registry.register,
    unregister: registry.unregister,
    has: registry.has,
    snapshot: registry.snapshot,
  };

  assert.equal(isImplementationRegistry(registry), true);
  assert.equal(isImplementationRegistry(lookalike), false);
  assert.equal(isImplementationRegistry(new Proxy(registry, {})), false);
  assert.equal(isImplementationRegistry(registry.snapshot()), false);
});

test('registry snapshots are stable immutable copies and preserve capability order', () => {
  const registry = createImplementationRegistry();
  registry.register('qq', 'commentsRead');
  registry.register('qq', 'search');
  registry.register('netease', 'playback');

  const snapshot = registry.snapshot();
  assert.equal(snapshot.schema, PLATFORM_IMPLEMENTATION_SCHEMA);
  assert.deepEqual(
    snapshot.providers.map(item => item.provider),
    IMPLEMENTATION_PROVIDERS,
  );
  assert.deepEqual(snapshot.providers[0].capabilities, ['playback']);
  assert.deepEqual(snapshot.providers[1].capabilities, ['search', 'commentsRead']);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.providers), true);
  assert.equal(Object.isFrozen(snapshot.providers[0]), true);
  assert.equal(Object.isFrozen(snapshot.providers[0].capabilities), true);
  assert.throws(() => {
    snapshot.providers[0].capabilities.push('search');
  }, TypeError);
  assert.equal(registry.has('netease', 'search'), false);
  assert.deepEqual(Object.keys(snapshot), ['schema', 'providers']);
});

test('baseline registry matches the currently wired provider implementations', () => {
  const registry = createBaselineImplementationRegistry();
  const available = Object.fromEntries(IMPLEMENTATION_PROVIDERS.map(provider => [
    provider,
    IMPLEMENTATION_CAPABILITIES.filter(capability => (
      registry.has(provider, capability)
    )),
  ]));

  assert.deepEqual(available, {
    netease: ['search', 'playback', 'sourceMatch', 'playlistWrite', 'commentsRead'],
    qq: ['search', 'playback', 'sourceMatch', 'commentsRead'],
    kugou: ['search'],
    qishui: ['search'],
    spotify: ['search'],
  });
});

test('feature flags expose eight fixed booleans through an unforgeable identity', () => {
  const flags = createFeatureFlags({
    platformWrites: false,
    cuefield: true,
  });
  const snapshot = flags.snapshot();

  assert.deepEqual(FEATURE_FLAG_KEYS, [
    'platformWrites',
    'spotifyPkce',
    'enhancedPlayback',
    'listenReporting',
    'cuefield',
    'sonicTopography',
    'desktopWallpaper',
    'resourceGovernor',
  ]);
  assert.deepEqual(Object.keys(DEFAULT_FEATURE_FLAG_VALUES), FEATURE_FLAG_KEYS);
  assert.deepEqual(Object.keys(snapshot), FEATURE_FLAG_KEYS);
  assert.equal(flags.isEnabled('platformWrites'), false);
  assert.equal(flags.isEnabled('cuefield'), true);
  assert.equal(flags.isEnabled('unknown'), false);
  assert.equal(isFeatureFlags(flags), true);
  assert.equal(isFeatureFlags(snapshot), false);
  assert.equal(isFeatureFlags({ ...flags }), false);
  assert.equal(isFeatureFlags(new Proxy(flags, {})), false);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('feature flag configuration rejects unknown and non-boolean values', () => {
  assert.throws(
    () => createFeatureFlags({ imaginaryFeature: true }),
    /unknown feature flag/i,
  );
  assert.throws(
    () => createFeatureFlags({ cuefield: 1 }),
    /boolean/i,
  );
  assert.throws(
    () => createFeatureFlags(null),
    /plain object/i,
  );
});
