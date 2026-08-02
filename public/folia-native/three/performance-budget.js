(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricThreePerformance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var THRESHOLDS = {
    quality: 22,
    balanced: 22,
    battery: 40,
  };

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  }

  function qualityName(value) {
    value = String(value || 'balanced');
    return Object.prototype.hasOwnProperty.call(THRESHOLDS, value) ? value : 'balanced';
  }

  function createThreeLyricPerformanceBudget(options) {
    options = options || {};
    var windowMs = Math.max(250, finite(options.windowMs, 5000));
    var level = 0;
    var fallback = false;
    var reason = '';
    var badWindows = 0;
    var badWindowStartedAt = null;
    var samples = [];
    var windowStartedAt = null;
    var suspendedUntil = 0;
    var lastP95 = 0;
    var lastThreshold = THRESHOLDS.balanced;
    var lastQuality = 'balanced';
    var lastWindowEndedAt = 0;

    function applyWindow(input) {
      input = input || {};
      var quality = qualityName(input.quality);
      var threshold = THRESHOLDS[quality];
      var p95 = Math.max(0, finite(input.p95, 0));
      var endedAt = Math.max(lastWindowEndedAt, finite(input.endedAt, lastWindowEndedAt + windowMs));
      lastQuality = quality;
      lastThreshold = threshold;
      lastP95 = p95;
      lastWindowEndedAt = endedAt;

      if (p95 > threshold) {
        if (badWindows === 0) badWindowStartedAt = endedAt;
        badWindows += 1;
      } else {
        badWindows = 0;
        badWindowStartedAt = null;
      }

      if (badWindows < 2 || fallback || endedAt - badWindowStartedAt < windowMs) return snapshot();
      badWindows = 0;
      badWindowStartedAt = null;
      if (level < 3) level += 1;
      else {
        fallback = true;
        reason = 'sustained-frame-budget';
      }
      return snapshot();
    }

    function push(input) {
      input = input || {};
      var now = Math.max(0, finite(input.now, 0));
      if (now < suspendedUntil || fallback) return snapshot();
      var frameMs = finite(input.frameMs, 0);
      if (frameMs <= 0) return snapshot();
      if (windowStartedAt == null) windowStartedAt = now;

      if (now - windowStartedAt >= windowMs) {
        if (samples.length) {
          applyWindow({
            p95: percentile(samples, 0.95),
            quality: input.quality,
            endedAt: now,
          });
        }
        samples.length = 0;
        windowStartedAt = now;
      }
      samples.push(frameMs);
      return snapshot();
    }

    function suspend(now, durationMs) {
      now = Math.max(0, finite(now, 0));
      suspendedUntil = Math.max(suspendedUntil, now + Math.max(0, finite(durationMs, 0)));
      samples.length = 0;
      windowStartedAt = null;
      return snapshot();
    }

    function resetTrack() {
      level = 0;
      fallback = false;
      reason = '';
      badWindows = 0;
      badWindowStartedAt = null;
      samples.length = 0;
      windowStartedAt = null;
      suspendedUntil = 0;
      lastP95 = 0;
      lastThreshold = THRESHOLDS.balanced;
      lastQuality = 'balanced';
      lastWindowEndedAt = 0;
      return snapshot();
    }

    function snapshot() {
      return {
        level: level,
        fallback: fallback,
        reason: reason,
        badWindows: badWindows,
        badWindowStartedAt: badWindowStartedAt,
        sampleCount: samples.length,
        suspendedUntil: suspendedUntil,
        p95FrameMs: lastP95,
        thresholdMs: lastThreshold,
        quality: lastQuality,
        windowMs: windowMs,
        lastWindowEndedAt: lastWindowEndedAt,
      };
    }

    return {
      push: push,
      suspend: suspend,
      resetTrack: resetTrack,
      snapshot: snapshot,
      pushWindowForTest: applyWindow,
    };
  }

  return {
    THRESHOLDS: Object.assign({}, THRESHOLDS),
    createThreeLyricPerformanceBudget: createThreeLyricPerformanceBudget,
  };
});
