(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCachePolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : fallback;
  }

  function resolveCacheBudget(policy, defaults) {
    defaults = defaults || {};
    var source = policy && policy.cacheBudget || policy || {};
    var fallbackCount = Math.max(0, Math.floor(finite(defaults.maxCount, 0)));
    var fallbackBytes = Math.max(0, finite(defaults.maxBytes, Number.POSITIVE_INFINITY));
    return {
      maxCount: Math.max(0, Math.floor(finite(source.maxCount, fallbackCount))),
      maxBytes: Math.max(0, finite(source.maxBytes, fallbackBytes)),
    };
  }

  function effectiveEntryLimit(policy, defaults, bytesPerEntry) {
    var budget = resolveCacheBudget(policy, defaults);
    var rendererLimit = resolveCacheBudget(null, defaults);
    var maxBytes = Math.min(rendererLimit.maxBytes, budget.maxBytes);
    bytesPerEntry = Math.max(1, Math.floor(finite(bytesPerEntry, 1)));
    var byteLimit = isFinite(maxBytes)
      ? Math.floor(maxBytes / bytesPerEntry)
      : Math.min(rendererLimit.maxCount, budget.maxCount);
    return {
      maxCount: Math.max(0, Math.min(rendererLimit.maxCount, budget.maxCount, byteLimit)),
      maxBytes: maxBytes,
      bytesPerEntry: bytesPerEntry,
    };
  }

  function trimMapToPolicy(cache, policy, options) {
    options = options || {};
    var limit = effectiveEntryLimit(policy, {
      maxCount: options.maxCount,
      maxBytes: options.maxBytes,
    }, options.bytesPerEntry);
    var dispose = typeof options.dispose === 'function' ? options.dispose : function() {};
    var dropped = 0;
    while (cache && cache.size > limit.maxCount) {
      var key = cache.keys().next().value;
      var value = cache.get(key);
      cache.delete(key);
      dispose(value, key);
      dropped += 1;
    }
    return {
      dropped: dropped,
      maxCount: limit.maxCount,
      maxBytes: limit.maxBytes,
      estimatedBytes: cache ? cache.size * limit.bytesPerEntry : 0,
    };
  }

  return {
    effectiveEntryLimit: effectiveEntryLimit,
    resolveCacheBudget: resolveCacheBudget,
    trimMapToPolicy: trimMapToPolicy,
  };
});
