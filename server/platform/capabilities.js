'use strict';

const {
  IMPLEMENTATION_CAPABILITIES,
  IMPLEMENTATION_PROVIDERS,
  createBaselineImplementationRegistry,
  createImplementationRegistry,
  isImplementationRegistry,
} = require('./implementation-registry');
const {
  createFeatureFlags,
  isFeatureFlags,
} = require('./feature-flags');

const PLATFORM_CAPABILITY_SCHEMA = 1;

const PLATFORM_ORDER = IMPLEMENTATION_PROVIDERS;
const CAPABILITY_KEYS = IMPLEMENTATION_CAPABILITIES;

const AUTHENTICATED_CAPABILITIES = new Set([
  'albumCollect',
  'playlistSubscribe',
  'playlistWrite',
  'commentsLike',
  'commentsCreate',
  'recentPlayReport',
  'listenDurationReport',
]);

const PLATFORM_WRITE_CAPABILITIES = new Set([
  'albumCollect',
  'playlistSubscribe',
  'playlistWrite',
  'commentsLike',
  'commentsCreate',
]);

const LISTEN_REPORTING_CAPABILITIES = new Set([
  'recentPlayReport',
  'listenDurationReport',
]);

const DEFAULT_IMPLEMENTATION_REGISTRY = createBaselineImplementationRegistry();
const EMPTY_IMPLEMENTATION_REGISTRY = createImplementationRegistry();
const DEFAULT_FEATURE_FLAGS = createFeatureFlags();
const FAIL_CLOSED_FEATURE_FLAGS = createFeatureFlags({
  platformWrites: false,
});

function createCapabilityMap(supportedCapabilities) {
  const supported = new Set(supportedCapabilities);
  return Object.freeze(Object.fromEntries(
    CAPABILITY_KEYS.map(capability => [capability, supported.has(capability)]),
  ));
}

function createDefinition(label, authMethods, supportedCapabilities) {
  return Object.freeze({
    label,
    authMethods: Object.freeze(authMethods.slice()),
    capabilities: createCapabilityMap(supportedCapabilities),
  });
}

const PLATFORM_DEFINITIONS = Object.freeze({
  netease: createDefinition(
    '网易云音乐',
    ['qr', 'cookie', 'external-window'],
    CAPABILITY_KEYS,
  ),
  qq: createDefinition(
    'QQ 音乐',
    ['cookie', 'external-window'],
    ['search', 'playback', 'sourceMatch', 'commentsRead'],
  ),
  kugou: createDefinition(
    '酷狗音乐',
    ['cookie', 'external-window'],
    ['search'],
  ),
  qishui: createDefinition(
    '汽水音乐',
    ['token', 'cookie', 'external-window'],
    ['search'],
  ),
  spotify: createDefinition(
    'Spotify',
    ['pkce', 'external-window'],
    ['search'],
  ),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return '';
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveFlag(value) {
  return value === true || finiteNumber(value) > 0;
}

function membershipValue(status, membership, key) {
  if (hasOwn(membership, key)) return membership[key];
  if (hasOwn(status, key)) return status[key];
  return undefined;
}

function membershipHas(status, membership, key) {
  return hasOwn(membership, key) || hasOwn(status, key);
}

function sanitizeMembership(status) {
  const membership = isRecord(status.membership) ? status.membership : {};
  const vipType = finiteNumber(membershipValue(status, membership, 'vipType'));
  const rawVipLevel = membershipValue(status, membership, 'vipLevel');
  const rawIsVip = membershipValue(status, membership, 'isVip');
  const rawIsSvip = membershipValue(status, membership, 'isSvip');
  const isSvip = positiveFlag(rawIsSvip) || vipType >= 10;
  const isVip = isSvip || positiveFlag(rawIsVip) || vipType > 0;
  const vipLevel = safeString(rawVipLevel)
    || (isSvip ? 'svip' : (isVip ? 'vip' : 'none'));
  const rawKnown = membershipValue(status, membership, 'known');
  const known = membershipHas(status, membership, 'known')
    ? rawKnown === true
    : ['vipLevel', 'isVip', 'isSvip', 'vipType']
      .some(key => membershipHas(status, membership, key));

  return {
    vipLevel,
    isVip,
    isSvip,
    known,
  };
}

function sanitizeAccount(status) {
  status = isRecord(status) ? status : {};
  const accountId = hasOwn(status, 'accountId')
    ? status.accountId
    : status.userId;

  const account = {
    loggedIn: status.loggedIn === true,
    accountId: safeString(accountId),
    nickname: safeString(status.nickname),
    avatar: safeString(status.avatar),
    membership: sanitizeMembership(status),
  };
  if (hasOwn(status, 'reportingBinding')) {
    account.reportingBinding = typeof status.reportingBinding === 'string'
      && /^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(status.reportingBinding)
      ? status.reportingBinding
      : '';
  }
  return account;
}

function readExplicitOption(options, key) {
  if (!isRecord(options)) return { present: false, value: undefined };
  try {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      return { present: false, value: undefined };
    }
    return { present: true, value: options[key] };
  } catch (_) {
    return { present: true, value: undefined };
  }
}

function implementationRegistryFor(options) {
  const configured = readExplicitOption(options, 'implementationRegistry');
  if (!configured.present) return DEFAULT_IMPLEMENTATION_REGISTRY;
  return isImplementationRegistry(configured.value)
    ? configured.value
    : EMPTY_IMPLEMENTATION_REGISTRY;
}

function featureFlagsFor(options) {
  const configured = readExplicitOption(options, 'featureFlags');
  if (!configured.present) return DEFAULT_FEATURE_FLAGS;
  return isFeatureFlags(configured.value)
    ? configured.value
    : FAIL_CLOSED_FEATURE_FLAGS;
}

function featureAllowsCapability(capability, featureFlags) {
  if (PLATFORM_WRITE_CAPABILITIES.has(capability)) {
    return featureFlags.isEnabled('platformWrites');
  }
  if (LISTEN_REPORTING_CAPABILITIES.has(capability)) {
    return featureFlags.isEnabled('listenReporting');
  }
  return true;
}

function requiresLogin(capability) {
  return AUTHENTICATED_CAPABILITIES.has(capability);
}

function cloneCapabilityMap(capabilities) {
  return Object.fromEntries(CAPABILITY_KEYS.map(capability => [
    capability,
    capabilities && capabilities[capability] === true,
  ]));
}

function cloneAccount(account) {
  return sanitizeAccount(account);
}

function cloneProvider(item) {
  return {
    provider: safeString(item.provider),
    label: safeString(item.label),
    authMethods: Array.isArray(item.authMethods)
      ? item.authMethods.map(safeString)
      : [],
    account: cloneAccount(item.account),
    capabilities: cloneCapabilityMap(item.capabilities),
    availability: cloneCapabilityMap(item.availability),
  };
}

function createProviderCapability(
  provider,
  status,
  implementationRegistry,
  featureFlags,
) {
  const definition = PLATFORM_DEFINITIONS[provider];
  const account = sanitizeAccount(status);
  const capabilities = cloneCapabilityMap(definition.capabilities);
  const availability = Object.fromEntries(CAPABILITY_KEYS.map(capability => [
    capability,
    capabilities[capability]
      && implementationRegistry.has(provider, capability)
      && featureAllowsCapability(capability, featureFlags)
      && (!requiresLogin(capability) || account.loggedIn),
  ]));

  return {
    provider,
    label: definition.label,
    authMethods: definition.authMethods.slice(),
    account,
    capabilities,
    availability,
  };
}

function createCapabilitySnapshot(statusByProvider, options) {
  statusByProvider = isRecord(statusByProvider) ? statusByProvider : {};
  options = isRecord(options) ? options : {};
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const implementationRegistry = implementationRegistryFor(options);
  const featureFlags = featureFlagsFor(options);

  return {
    schema: PLATFORM_CAPABILITY_SCHEMA,
    generatedAt: safeGeneratedAt(now),
    providers: PLATFORM_ORDER.map(provider => createProviderCapability(
      provider,
      hasOwn(statusByProvider, provider) ? statusByProvider[provider] : {},
      implementationRegistry,
      featureFlags,
    )),
  };
}

function providerCapability(snapshot, provider) {
  if (!PLATFORM_ORDER.includes(provider) || !isRecord(snapshot)) return null;
  if (!Array.isArray(snapshot.providers)) return null;
  const item = snapshot.providers.find(candidate => (
    isRecord(candidate) && candidate.provider === provider
  ));
  return item ? cloneProvider(item) : null;
}

function safeGeneratedAt(now) {
  try {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
  } catch (_) {
    return Date.now();
  }
}

module.exports = {
  PLATFORM_CAPABILITY_SCHEMA,
  PLATFORM_ORDER,
  createCapabilitySnapshot,
  providerCapability,
};
