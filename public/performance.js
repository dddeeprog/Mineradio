(function(root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPerformance = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(globalRoot) {
  function createLyricLineFinder() {
    var currentLines = null;
    var index = -1;

    function binaryFind(lines, t) {
      var lo = 0;
      var hi = lines.length - 1;
      var found = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var lineTime = Number(lines[mid] && lines[mid].t);
        if (Number.isFinite(lineTime) && lineTime <= t) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found;
    }

    function find(lines, time, offset) {
      if (!Array.isArray(lines) || !lines.length) {
        currentLines = lines;
        index = -1;
        return -1;
      }
      var t = Number(time) + (Number(offset) || 0);
      if (!Number.isFinite(t)) t = 0;
      if (lines !== currentLines) {
        currentLines = lines;
        index = -1;
      }

      var current = index >= 0 ? lines[index] : null;
      var next = index + 1 < lines.length ? lines[index + 1] : null;
      if (current && Number(current.t) <= t && (!next || Number(next.t) > t)) return index;
      if (index >= 0 && current && Number(current.t) <= t) {
        while (index + 1 < lines.length && Number(lines[index + 1].t) <= t) index++;
        return index;
      }

      index = binaryFind(lines, t);
      return index;
    }

    return {
      find: find,
      reset: function() {
        currentLines = null;
        index = -1;
      },
    };
  }

  function cloneRect(rect) {
    if (!rect) return null;
    return {
      left: Number(rect.left) || 0,
      right: Number(rect.right) || 0,
      top: Number(rect.top) || 0,
      bottom: Number(rect.bottom) || 0,
      width: Number(rect.width) || Math.max(0, (Number(rect.right) || 0) - (Number(rect.left) || 0)),
      height: Number(rect.height) || Math.max(0, (Number(rect.bottom) || 0) - (Number(rect.top) || 0)),
    };
  }

  function createMeasuredRectCache() {
    var rects = new Map();
    function get(key, measure) {
      key = String(key || '');
      if (!key) return null;
      if (rects.has(key)) return rects.get(key);
      if (typeof measure !== 'function') return null;
      var rect = cloneRect(measure());
      if (rect) rects.set(key, rect);
      return rect;
    }
    function invalidate(key) {
      if (key == null) rects.clear();
      else rects.delete(String(key));
    }
    return {
      get: get,
      invalidate: invalidate,
      size: function() { return rects.size; },
    };
  }

  function createFrameCoalescer(options, consume) {
    options = options || {};
    var raf = options.requestAnimationFrame || globalRoot.requestAnimationFrame;
    var scheduled = false;
    var latest = null;
    function flush(now) {
      scheduled = false;
      var payload = latest;
      latest = null;
      if (payload && typeof consume === 'function') consume(payload, now);
    }
    function push(payload) {
      latest = payload;
      if (scheduled) return;
      scheduled = true;
      if (typeof raf === 'function') raf(flush);
      else setTimeout(function() { flush(Date.now()); }, 16);
    }
    return {
      flush: flush,
      push: push,
      pending: function() { return scheduled; },
    };
  }

  function createRollingFrameStats(options) {
    options = options || {};
    var maxSamples = Math.max(1, Math.floor(Number(options.maxSamples) || 120));
    var samples = [];
    function percentile(sorted, ratio) {
      if (!sorted.length) return 0;
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
    }
    function record(value) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 60000) return false;
      samples.push(value);
      if (samples.length > maxSamples) samples.splice(0, samples.length - maxSamples);
      return true;
    }
    function snapshot() {
      var sorted = samples.slice().sort(function(a, b) { return a - b; });
      var total = samples.reduce(function(sum, value) { return sum + value; }, 0);
      return {
        count: samples.length,
        averageMs: samples.length ? total / samples.length : 0,
        p50Ms: percentile(sorted, 0.50),
        p95Ms: percentile(sorted, 0.95),
        p99Ms: percentile(sorted, 0.99),
        maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
      };
    }
    return {
      clear: function() { samples.length = 0; },
      record: record,
      snapshot: snapshot,
    };
  }

  return {
    createFrameCoalescer: createFrameCoalescer,
    createLyricLineFinder: createLyricLineFinder,
    createMeasuredRectCache: createMeasuredRectCache,
    createRollingFrameStats: createRollingFrameStats,
  };
});
