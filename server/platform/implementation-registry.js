'use strict';

const PLATFORM_IMPLEMENTATION_SCHEMA = 1;

const IMPLEMENTATION_PROVIDERS = Object.freeze([
  'netease',
  'qq',
  'kugou',
  'qishui',
  'spotify',
]);

const IMPLEMENTATION_CAPABILITIES = Object.freeze([
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
]);

const BASELINE_IMPLEMENTATIONS = Object.freeze({
  netease: Object.freeze([
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
  ]),
  qq: Object.freeze(['search', 'playback', 'sourceMatch', 'commentsRead']),
  kugou: Object.freeze(['search']),
  qishui: Object.freeze(['search']),
  spotify: Object.freeze(['search']),
});

const registryIdentities = new WeakSet();

function knownProvider(provider) {
  return typeof provider === 'string'
    && IMPLEMENTATION_PROVIDERS.includes(provider);
}

function knownCapability(capability) {
  return typeof capability === 'string'
    && IMPLEMENTATION_CAPABILITIES.includes(capability);
}

function registrationKey(provider, capability) {
  return `${provider}\u0000${capability}`;
}

function assertKnownRegistration(provider, capability) {
  if (!knownProvider(provider)) {
    throw new RangeError(`Unknown provider: ${String(provider)}`);
  }
  if (!knownCapability(capability)) {
    throw new RangeError(`Unknown capability: ${String(capability)}`);
  }
}

function createImplementationRegistry() {
  const registrations = new Set();
  let registry;

  registry = Object.freeze({
    register(provider, capability) {
      if (this !== registry) {
        throw new TypeError('Implementation registry method called with invalid receiver');
      }
      assertKnownRegistration(provider, capability);
      const key = registrationKey(provider, capability);
      if (registrations.has(key)) return false;
      registrations.add(key);
      return true;
    },

    unregister(provider, capability) {
      if (this !== registry) {
        throw new TypeError('Implementation registry method called with invalid receiver');
      }
      if (!knownProvider(provider) || !knownCapability(capability)) return false;
      return registrations.delete(registrationKey(provider, capability));
    },

    has(provider, capability) {
      if (this !== registry) {
        throw new TypeError('Implementation registry method called with invalid receiver');
      }
      if (!knownProvider(provider) || !knownCapability(capability)) return false;
      return registrations.has(registrationKey(provider, capability));
    },

    snapshot() {
      if (this !== registry) {
        throw new TypeError('Implementation registry method called with invalid receiver');
      }
      const providers = IMPLEMENTATION_PROVIDERS.map(provider => Object.freeze({
        provider,
        capabilities: Object.freeze(IMPLEMENTATION_CAPABILITIES.filter(
          capability => registrations.has(registrationKey(provider, capability)),
        )),
      }));
      return Object.freeze({
        schema: PLATFORM_IMPLEMENTATION_SCHEMA,
        providers: Object.freeze(providers),
      });
    },
  });

  registryIdentities.add(registry);
  return registry;
}

function createBaselineImplementationRegistry() {
  const registry = createImplementationRegistry();
  for (const provider of IMPLEMENTATION_PROVIDERS) {
    for (const capability of BASELINE_IMPLEMENTATIONS[provider]) {
      registry.register(provider, capability);
    }
  }
  return registry;
}

function isImplementationRegistry(value) {
  return (
    (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && registryIdentities.has(value)
  );
}

module.exports = {
  IMPLEMENTATION_CAPABILITIES,
  IMPLEMENTATION_PROVIDERS,
  PLATFORM_IMPLEMENTATION_SCHEMA,
  createBaselineImplementationRegistry,
  createImplementationRegistry,
  isImplementationRegistry,
};
