/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioApplicationAssembly = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
  'use strict';

  function optionsRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function requireMethod(api, method, label) {
    if (!api || typeof api[method] !== 'function') {
      throw new TypeError(label + '.' + method + ' is required');
    }
    return api[method];
  }

  function createPlatformSearchController(options) {
    options = optionsRecord(options);
    var uiApi = options.uiApi || (root && root.MineradioPlatformSearchUI);
    return requireMethod(uiApi, 'createController', 'Platform search UI').call(uiApi, {
      stateApi: options.stateApi || (root && root.MineradioPlatformSearch),
      requestJson: options.requestJson,
      onUpdate: options.onUpdate,
    });
  }

  function createPlatformLoginState(options) {
    options = optionsRecord(options);
    var stateApi = options.stateApi || (root && root.MineradioPlatformLogin);
    return requireMethod(stateApi, 'createLoginState', 'Platform login state').call(
      stateApi,
      options.snapshot,
      { selectedProvider: options.selectedProvider },
    );
  }

  function mountPlatformLoginCenter(options) {
    options = optionsRecord(options);
    var uiApi = options.uiApi || (root && root.MineradioPlatformLoginUI);
    return requireMethod(uiApi, 'mountLoginCenter', 'Platform login UI').call(uiApi, {
      providerRoot: options.providerRoot,
      methodRoot: options.methodRoot,
      state: options.state,
      onProvider: options.onProvider,
      onMethod: options.onMethod,
    });
  }

  function createPlaybackTransactionManager(options) {
    options = optionsRecord(options);
    var transactionApi = options.transactionApi || (root && root.MineradioPlaybackTransaction);
    return requireMethod(
      transactionApi,
      'createPlaybackTransactionManager',
      'Playback transaction API',
    ).call(transactionApi, {
      capture: options.capture,
      restore: options.restore,
    });
  }

  return Object.freeze({
    createPlatformSearchController: createPlatformSearchController,
    createPlatformLoginState: createPlatformLoginState,
    mountPlatformLoginCenter: mountPlatformLoginCenter,
    createPlaybackTransactionManager: createPlaybackTransactionManager,
  });
});
