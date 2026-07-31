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

  function estimateValueBytes(value, options, state) {
    options = options || {};
    state = state || {
      depth: 0,
      entries: 0,
      maxDepth: normalizeKeep(options.maxDepth, 6),
      maxEntries: Math.max(16, normalizeKeep(options.maxEntries, 1024)),
      seen: typeof WeakSet !== 'undefined' ? new WeakSet() : null
    };
    if (value == null) return 0;
    var type = typeof value;
    if (type === 'string') return value.length * 2;
    if (type === 'number') return 8;
    if (type === 'boolean') return 4;
    if (type === 'bigint') return 8;
    if (type === 'symbol' || type === 'function') return 0;
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return value.byteLength || 0;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) return value.byteLength || 0;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size || 0;
    var width = Number(value.naturalWidth || value.videoWidth || value.width);
    var height = Number(value.naturalHeight || value.videoHeight || value.height);
    if (isFinite(width) && width > 0 && isFinite(height) && height > 0 && (value.src || value.data || value.image)) {
      return Math.round(width * height * 4);
    }
    if (state.seen) {
      if (state.seen.has(value)) return 0;
      state.seen.add(value);
    }
    if (state.depth >= state.maxDepth || state.entries >= state.maxEntries) return 0;
    state.depth += 1;
    var bytes = 0;
    function add(entry, key) {
      if (state.entries >= state.maxEntries) return;
      state.entries += 1;
      if (key != null) bytes += String(key).length * 2;
      bytes += estimateValueBytes(entry, options, state);
    }
    if (Array.isArray(value)) value.forEach(function(entry) { add(entry); });
    else if (typeof Map !== 'undefined' && value instanceof Map) value.forEach(function(entry, key) { add(key); add(entry); });
    else if (typeof Set !== 'undefined' && value instanceof Set) value.forEach(function(entry) { add(entry); });
    else {
      try { Object.keys(value).forEach(function(key) { add(value[key], key); }); } catch (e) {}
    }
    state.depth -= 1;
    return bytes;
  }

  function cacheValues(cache) {
    if (!cache) return [];
    if (typeof Map !== 'undefined' && cache instanceof Map) return Array.from(cache.entries());
    if (typeof Set !== 'undefined' && cache instanceof Set) return Array.from(cache.values()).map(function(value) { return [null, value]; });
    if (Array.isArray(cache)) return cache.map(function(value, index) { return [index, value]; });
    try { return Object.keys(cache).map(function(key) { return [key, cache[key]]; }); } catch (e) { return []; }
  }

  function recordBytes(record, key, options) {
    if (options && typeof options.sizeOf === 'function') {
      try {
        var explicit = Number(options.sizeOf(record, key));
        if (isFinite(explicit)) return Math.max(0, Math.floor(explicit));
      } catch (e) {}
    }
    return estimateValueBytes(record, options || {});
  }

  function cacheApproxBytes(cache, options) {
    if (typeof options === 'function') options = { sizeOf: options };
    options = options || {};
    return cacheValues(cache).reduce(function(total, pair) {
      return total + recordBytes(pair[1], pair[0], options);
    }, 0);
  }

  function normalizeBudget(value) {
    value = Number(value);
    if (!isFinite(value)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor(value));
  }

  function trimEntriesToBudget(entries, access, options) {
    options = options || {};
    var maxCount = normalizeBudget(options.maxCount);
    var maxBytes = normalizeBudget(options.maxBytes);
    var protectedKeys = toProtectedKeyMap(options.protectedKeys);
    var skipRecord = typeof options.skipRecord === 'function' ? options.skipRecord : null;
    var dispose = typeof options.dispose === 'function' ? options.dispose : null;
    var sized = entries.map(function(key) {
      var record = access.get(key);
      return { key: key, record: record, bytes: recordBytes(record, key, options) };
    });
    var beforeCount = sized.length;
    var beforeBytes = sized.reduce(function(total, entry) { return total + entry.bytes; }, 0);
    var afterCount = beforeCount;
    var afterBytes = beforeBytes;
    var droppedCount = 0;
    var droppedBytes = 0;
    sized.forEach(function(entry) {
      if (afterCount <= maxCount && afterBytes <= maxBytes) return;
      if (protectedKeys[String(entry.key)]) return;
      if (skipRecord && skipRecord(entry.record, entry.key)) return;
      if (dispose) {
        try { dispose(entry.record, entry.key); } catch (e) {}
      }
      access.drop(entry.key);
      afterCount -= 1;
      afterBytes = Math.max(0, afterBytes - entry.bytes);
      droppedCount += 1;
      droppedBytes += entry.bytes;
    });
    return {
      beforeCount: beforeCount,
      afterCount: afterCount,
      beforeBytes: beforeBytes,
      afterBytes: afterBytes,
      droppedCount: droppedCount,
      droppedBytes: droppedBytes
    };
  }

  function trimObjectCacheToBudget(cache, options) {
    var keys;
    try { keys = cache ? Object.keys(cache) : []; } catch (e) { keys = []; }
    return trimEntriesToBudget(keys, {
      get: function(key) { return cache[key]; },
      drop: function(key) { delete cache[key]; }
    }, options || {});
  }

  function trimMapCacheToBudget(cache, options) {
    if (!cache || typeof cache.keys !== 'function' || typeof cache.get !== 'function' || typeof cache.delete !== 'function') {
      return { beforeCount: 0, afterCount: 0, beforeBytes: 0, afterBytes: 0, droppedCount: 0, droppedBytes: 0 };
    }
    return trimEntriesToBudget(Array.from(cache.keys()), {
      get: function(key) { return cache.get(key); },
      drop: function(key) { cache.delete(key); }
    }, options || {});
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

  function listRenderWindow(total, options) {
    options = options || {};
    total = normalizeKeep(total, 0);
    if (!total) {
      return { start: 0, end: -1, count: 0, before: 0, after: 0, total: 0 };
    }
    var maxItems = normalizeKeep(options.maxItems, total);
    if (!maxItems || maxItems > total) maxItems = total;
    var maxStart = Math.max(0, total - maxItems);
    var requestedStart = Number(options.requestedStart);
    var start = isFinite(requestedStart) ? Math.floor(requestedStart) : 0;
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

  function listRenderSlice(items, options) {
    items = Array.isArray(items) ? items : [];
    var win = listRenderWindow(items.length, options || {});
    var out = [];
    for (var i = win.start; i <= win.end; i++) {
      out.push({ item: items[i], index: i });
    }
    return { window: win, items: out };
  }

  return {
    cacheApproxBytes: cacheApproxBytes,
    cacheCount: cacheCount,
    estimateValueBytes: estimateValueBytes,
    listRenderSlice: listRenderSlice,
    listRenderWindow: listRenderWindow,
    queueRenderWindow: queueRenderWindow,
    trimMapCache: trimMapCache,
    trimMapCacheToBudget: trimMapCacheToBudget,
    trimObjectCache: trimObjectCache,
    trimObjectCacheToBudget: trimObjectCacheToBudget
  };
});
