(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioRuntimeFeatureState = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var BROWSER_RUNTIME_FEATURES = Object.freeze([
    'enhancedPlayback',
    'sonicTopography',
    'resourceGovernor',
  ]);

  function createRuntimeFeatureState() {
    var values = {};

    function snapshot() {
      var result = {};
      BROWSER_RUNTIME_FEATURES.forEach(function(name) {
        result[name] = values[name] === true;
      });
      return result;
    }

    function apply(capabilitySnapshot) {
      var features = capabilitySnapshot && capabilitySnapshot.features || {};
      BROWSER_RUNTIME_FEATURES.forEach(function(name) {
        values[name] = features[name] === true;
      });
      return snapshot();
    }

    function isEnabled(name) {
      return BROWSER_RUNTIME_FEATURES.indexOf(String(name || '')) >= 0
        && values[name] === true;
    }

    apply(null);
    return Object.freeze({
      apply: apply,
      isEnabled: isEnabled,
      snapshot: snapshot,
    });
  }

  return Object.freeze({
    BROWSER_RUNTIME_FEATURES: BROWSER_RUNTIME_FEATURES,
    createRuntimeFeatureState: createRuntimeFeatureState,
  });
});
