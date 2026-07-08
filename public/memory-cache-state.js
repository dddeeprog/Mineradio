(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioMemoryCacheState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function cacheCount(cache) {
    if (!cache) return 0;
    if (typeof cache.length === 'number') return Math.max(0, cache.length);
    if (typeof cache.size === 'number') return Math.max(0, cache.size);
    try { return Object.keys(cache).length; } catch (e) { return 0; }
  }

  function normalizeKeep(value, fallback) {
    var raw = Number(value);
    if (!isFinite(raw)) raw = Number(fallback);
    if (!isFinite(raw)) raw = 0;
    return Math.max(0, Math.floor(raw));
  }

  function toProtectedKeyMap(value) {
    var keep = Object.create(null);
    if (!value) return keep;
    if (Array.isArray(value)) {
      value.forEach(function(key){ if (key) keep[String(key)] = true; });
      return keep;
    }
    if (typeof Set !== 'undefined' && value instanceof Set) {
      value.forEach(function(key){ if (key) keep[String(key)] = true; });
      return keep;
    }
    if (typeof Map !== 'undefined' && value instanceof Map) {
      value.forEach(function(_entry, key){ if (key) keep[String(key)] = true; });
      return keep;
    }
    try {
      Object.keys(value).forEach(function(key){ if (value[key]) keep[String(key)] = true; });
    } catch (e) {}
    return keep;
  }

  function trimObjectCache(cache, options) {
    options = options || {};
    if (!cache) return { before: 0, after: 0, dropped: 0 };
    var keys;
    try { keys = Object.keys(cache); } catch (e) { keys = []; }
    var before = keys.length;
    var keep = normalizeKeep(options.keep, before);
    if (before <= keep) return { before: before, after: before, dropped: 0 };
    var protectedKeys = toProtectedKeyMap(options.protectedKeys);
    var skipRecord = typeof options.skipRecord === 'function' ? options.skipRecord : null;
    var dispose = typeof options.dispose === 'function' ? options.dispose : null;
    var dropBudget = before - keep;
    var dropped = 0;
    keys.some(function(key) {
      if (dropped >= dropBudget) return true;
      if (protectedKeys[String(key)]) return false;
      var record = cache[key];
      if (skipRecord && skipRecord(record, key)) {
        dropBudget--;
        return false;
      }
      if (dispose) {
        try { dispose(record, key); } catch (e) {}
      }
      delete cache[key];
      dropped++;
      return false;
    });
    return { before: before, after: cacheCount(cache), dropped: dropped };
  }

  function trimMapCache(cache, options) {
    options = options || {};
    if (!cache || typeof cache.keys !== 'function' || typeof cache.delete !== 'function') {
      return { before: 0, after: 0, dropped: 0 };
    }
    var keys = Array.from(cache.keys());
    var before = keys.length;
    var keep = normalizeKeep(options.keep, before);
    if (before <= keep) return { before: before, after: before, dropped: 0 };
    var protectedKeys = toProtectedKeyMap(options.protectedKeys);
    var skipRecord = typeof options.skipRecord === 'function' ? options.skipRecord : null;
    var dispose = typeof options.dispose === 'function' ? options.dispose : null;
    var dropBudget = before - keep;
    var dropped = 0;
    keys.some(function(key) {
      if (dropped >= dropBudget) return true;
      if (protectedKeys[String(key)]) return false;
      var record = cache.get(key);
      if (skipRecord && skipRecord(record, key)) {
        dropBudget--;
        return false;
      }
      if (dispose) {
        try { dispose(record, key); } catch (e) {}
      }
      cache.delete(key);
      dropped++;
      return false;
    });
    return { before: before, after: cacheCount(cache), dropped: dropped };
  }

  function queueRenderWindow(total, currentIndex, options) {
    options = options || {};
    total = normalizeKeep(total, 0);
    if (!total) {
      return { start: 0, end: -1, count: 0, before: 0, after: 0, total: 0 };
    }
    var maxItems = normalizeKeep(options.maxItems, total);
    if (!maxItems || maxItems > total) maxItems = total;
    var maxStart = Math.max(0, total - maxItems);
    var requestedStart = Number(options.requestedStart);
    var start;
    if (isFinite(requestedStart)) {
      start = Math.floor(requestedStart);
    } else {
      var current = Number(currentIndex);
      if (!isFinite(current) || current < 0) current = 0;
      if (current >= total) current = total - 1;
      start = Math.floor(current - Math.floor(maxItems / 2) + 1);
    }
    start = Math.max(0, Math.min(maxStart, start));
    var end = Math.min(total - 1, start + maxItems - 1);
    var count = end >= start ? end - start + 1 : 0;
    return {
      start: start,
      end: end,
      count: count,
      before: start,
      after: Math.max(0, total - end - 1),
      total: total
    };
  }

  return {
    cacheCount: cacheCount,
    queueRenderWindow: queueRenderWindow,
    trimMapCache: trimMapCache,
    trimObjectCache: trimObjectCache
  };
});
