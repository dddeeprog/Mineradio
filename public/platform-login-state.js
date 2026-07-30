(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlatformLogin = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var PLATFORM_LOGIN_PROVIDERS = Object.freeze([
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify'
  ]);
  var MAX_IMPORT_VALUE_LENGTH = 32 * 1024;

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function loginError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function safeText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && isFinite(value)) return String(value);
    return '';
  }

  function knownProvider(provider) {
    return typeof provider === 'string'
      && PLATFORM_LOGIN_PROVIDERS.indexOf(provider) >= 0;
  }

  function normalizeAccount(value) {
    value = isRecord(value) ? value : {};
    var membership = isRecord(value.membership) ? value.membership : {};
    return Object.freeze({
      loggedIn: value.loggedIn === true,
      accountId: safeText(value.accountId || value.userId),
      nickname: safeText(value.nickname),
      avatar: safeText(value.avatar),
      membership: Object.freeze({
        vipLevel: safeText(membership.vipLevel) || 'none',
        isVip: membership.isVip === true,
        isSvip: membership.isSvip === true,
        known: membership.known === true
      })
    });
  }

  function normalizeProvider(value) {
    if (!isRecord(value) || !knownProvider(value.provider)) return null;
    var methods = [];
    (Array.isArray(value.authMethods) ? value.authMethods : [])
      .forEach(function(method) {
        method = safeText(method).trim();
        if (!method || methods.indexOf(method) >= 0) return;
        methods.push(method);
      });
    var capabilities = isRecord(value.capabilities) ? value.capabilities : {};
    var availability = isRecord(value.availability) ? value.availability : {};
    var account = normalizeAccount(value.account);
    var playbackSupported = capabilities.playback === true;
    return Object.freeze({
      provider: value.provider,
      label: safeText(value.label) || value.provider,
      authMethods: Object.freeze(methods),
      account: account,
      loggedIn: account.loggedIn,
      metadataOnly: !playbackSupported,
      playbackSupported: playbackSupported,
      playbackAvailable: playbackSupported && availability.playback === true
    });
  }

  function snapshotProviders(snapshot) {
    snapshot = isRecord(snapshot) ? snapshot : {};
    var source = Array.isArray(snapshot.providers) ? snapshot.providers : [];
    var byProvider = {};
    source.forEach(function(value) {
      var normalized = normalizeProvider(value);
      if (!normalized || byProvider[normalized.provider]) return;
      byProvider[normalized.provider] = normalized;
    });
    return PLATFORM_LOGIN_PROVIDERS
      .filter(function(provider) { return Boolean(byProvider[provider]); })
      .map(function(provider) { return byProvider[provider]; });
  }

  function createState(providers, selectedProvider) {
    var provider = providers.some(function(item) {
      return item.provider === selectedProvider;
    }) ? selectedProvider : '';
    if (!provider && providers.length) provider = providers[0].provider;
    return Object.freeze({
      schema: 1,
      selectedProvider: provider,
      providers: Object.freeze(providers.slice())
    });
  }

  function createLoginState(snapshot, options) {
    options = isRecord(options) ? options : {};
    var providers = snapshotProviders(snapshot);
    var requested = safeText(options.selectedProvider);
    if (requested && (!knownProvider(requested)
      || !providers.some(function(item) { return item.provider === requested; }))) {
      throw loginError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
    }
    return createState(providers, requested);
  }

  function selectLoginProvider(state, provider) {
    state = isRecord(state) ? state : {};
    if (!knownProvider(provider)
      || !Array.isArray(state.providers)
      || !state.providers.some(function(item) {
        return item && item.provider === provider;
      })) {
      throw loginError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
    }
    return createState(state.providers, provider);
  }

  function selectedProvider(state) {
    if (!isRecord(state) || !Array.isArray(state.providers)) return null;
    return state.providers.find(function(item) {
      return item && item.provider === state.selectedProvider;
    }) || null;
  }

  function createManualImportPayload(state, provider, method, value) {
    if (!knownProvider(provider)) {
      throw loginError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
    }
    var item = isRecord(state) && Array.isArray(state.providers)
      ? state.providers.find(function(candidate) {
        return candidate && candidate.provider === provider;
      })
      : null;
    if (!item) throw loginError('PLATFORM_LOGIN_PROVIDER_UNKNOWN');
    method = safeText(method).trim();
    if ((method !== 'cookie' && method !== 'token')
      || item.authMethods.indexOf(method) < 0) {
      throw loginError('PLATFORM_LOGIN_METHOD_UNAVAILABLE');
    }
    value = safeText(value).trim();
    if (!value || value.length > MAX_IMPORT_VALUE_LENGTH) {
      throw loginError('PLATFORM_LOGIN_VALUE_INVALID');
    }
    return Object.freeze({
      provider: provider,
      method: method,
      value: value
    });
  }

  return {
    PLATFORM_LOGIN_PROVIDERS: PLATFORM_LOGIN_PROVIDERS,
    createLoginState: createLoginState,
    createManualImportPayload: createManualImportPayload,
    selectLoginProvider: selectLoginProvider,
    selectedProvider: selectedProvider
  };
});
