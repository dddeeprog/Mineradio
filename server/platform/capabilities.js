'use strict';

const PLATFORM_CAPABILITY_SCHEMA = 1;

const PLATFORM_ORDER = Object.freeze([
  'netease',
  'qq',
  'kugou',
  'qishui',
  'spotify',
]);

const CAPABILITY_KEYS = Object.freeze([
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

const AUTHENTICATED_CAPABILITIES = new Set([
  'albumCollect',
  'playlistSubscribe',
  'playlistWrite',
  'commentsLike',
  'commentsCreate',
  'recentPlayReport',
  'listenDurationReport',
]);

const NETEASE_UNWIRED_CAPABILITIES = new Set([
  'albumDetail',
  'albumCollect',
  'playlistSubscribe',
  'commentsLike',
  'commentsCreate',
]);

function createCapabilityMap(enabledCapabilities) {
  const enabled = new Set(enabledCapabilities);
  return Object.freeze(Object.fromEntries(
    CAPABILITY_KEYS.map(capability => [capability, enabled.has(capability)]),
  ));
}

function createDefinition(label, authMethods, enabledCapabilities) {
  return Object.freeze({
    label,
    authMethods: Object.freeze(authMethods.slice()),
    capabilities: createCapabilityMap(enabledCapabilities),
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

const DEFAULT_ENABLED_CAPABILITIES = Object.freeze({
  netease: Object.freeze([
    'search',
    'playback',
    'sourceMatch',
    'playlistWrite',
    'commentsRead',
  ]),
  qq: Object.freeze(['search', 'playback', 'sourceMatch', 'commentsRead']),
  kugou: Object.freeze([]),
  qishui: Object.freeze([]),
  spotify: Object.freeze([]),
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

  return {
    loggedIn: status.loggedIn === true,
    accountId: safeString(accountId),
    nickname: safeString(status.nickname),
    avatar: safeString(status.avatar),
    membership: sanitizeMembership(status),
  };
}

function enabledCapabilitiesFor(provider, options) {
  const configured = isRecord(options) && isRecord(options.enabledCapabilities)
    ? options.enabledCapabilities
    : null;
  const selected = configured && hasOwn(configured, provider)
    ? configured[provider]
    : DEFAULT_ENABLED_CAPABILITIES[provider];

  if (!Array.isArray(selected)) return new Set();
  return new Set(selected.filter(capability => (
    typeof capability === 'string'
    && CAPABILITY_KEYS.includes(capability)
  )));
}

function requiresLogin(provider, capability) {
  return AUTHENTICATED_CAPABILITIES.has(capability)
    || (provider === 'netease' && NETEASE_UNWIRED_CAPABILITIES.has(capability));
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

function createProviderCapability(provider, status, options) {
  const definition = PLATFORM_DEFINITIONS[provider];
  const account = sanitizeAccount(status);
  const enabled = enabledCapabilitiesFor(provider, options);
  const capabilities = cloneCapabilityMap(definition.capabilities);
  const availability = Object.fromEntries(CAPABILITY_KEYS.map(capability => [
    capability,
    capabilities[capability]
      && enabled.has(capability)
      && (!requiresLogin(provider, capability) || account.loggedIn),
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

  return {
    schema: PLATFORM_CAPABILITY_SCHEMA,
    generatedAt: now(),
    providers: PLATFORM_ORDER.map(provider => createProviderCapability(
      provider,
      hasOwn(statusByProvider, provider) ? statusByProvider[provider] : {},
      options,
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

module.exports = {
  PLATFORM_CAPABILITY_SCHEMA,
  PLATFORM_ORDER,
  createCapabilitySnapshot,
  providerCapability,
};
