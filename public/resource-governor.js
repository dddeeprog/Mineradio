(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioResourceGovernor = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var QUALITY_ORDER = ['eco', 'balanced', 'high', 'ultra'];
  var RELEASE_ORDER = ['autoMix', 'standbyMedia', 'sonicTopography', 'nativeLyrics'];
  var RESTORE_ORDER = ['nativeLyrics', 'sonicTopography', 'standbyMedia', 'autoMix'];
  var CACHE_NAMES = [
    'playlistCovers',
    'coverDepth',
    'beatMaps',
    'djBeatMaps',
    'commentBarrage',
    'foliaThemes',
    'lyricTextures',
    'localBeatMaps',
    'layoutCaches'
  ];
  var MB = 1024 * 1024;
  var CACHE_PROFILES = {
    active: {
      playlistCovers: [180, 48 * MB],
      coverDepth: [10, 96 * MB],
      beatMaps: [36, 12 * MB],
      djBeatMaps: [12, 4 * MB],
      commentBarrage: [8, 4 * MB],
      foliaThemes: [48, 8 * MB],
      lyricTextures: [24, 64 * MB],
      localBeatMaps: [80, 24 * MB],
      layoutCaches: [96, 24 * MB]
    },
    balanced: {
      playlistCovers: [120, 32 * MB],
      coverDepth: [8, 64 * MB],
      beatMaps: [28, 8 * MB],
      djBeatMaps: [8, 3 * MB],
      commentBarrage: [6, 3 * MB],
      foliaThemes: [32, 5 * MB],
      lyricTextures: [16, 40 * MB],
      localBeatMaps: [56, 16 * MB],
      layoutCaches: [64, 16 * MB]
    },
    eco: {
      playlistCovers: [72, 20 * MB],
      coverDepth: [4, 32 * MB],
      beatMaps: [16, 5 * MB],
      djBeatMaps: [4, 2 * MB],
      commentBarrage: [4, 2 * MB],
      foliaThemes: [20, 3 * MB],
      lyricTextures: [8, 20 * MB],
      localBeatMaps: [32, 9 * MB],
      layoutCaches: [32, 8 * MB]
    },
    release: {
      playlistCovers: [24, 8 * MB],
      coverDepth: [2, 16 * MB],
      beatMaps: [8, 3 * MB],
      djBeatMaps: [2, 1 * MB],
      commentBarrage: [2, 1 * MB],
      foliaThemes: [12, 2 * MB],
      lyricTextures: [2, 8 * MB],
      localBeatMaps: [16, 5 * MB],
      layoutCaches: [12, 3 * MB]
    }
  };

  function finite(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : fallback;
  }

  function boundedInteger(value, fallback, min, max) {
    value = Math.floor(finite(value, fallback));
    return Math.max(min, Math.min(max, value));
  }

  function qualityRank(value) {
    var index = QUALITY_ORDER.indexOf(String(value || '').toLowerCase());
    return index >= 0 ? index : 2;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  }

  function frameSummary(values) {
    var sum = values.reduce(function(total, value) { return total + value; }, 0);
    return {
      count: values.length,
      averageMs: values.length ? sum / values.length : 0,
      p50Ms: percentile(values, 0.50),
      p95Ms: percentile(values, 0.95),
      p99Ms: percentile(values, 0.99),
      maxMs: values.length ? Math.max.apply(Math, values) : 0
    };
  }

  function cloneCacheBudget(profileName) {
    var profile = CACHE_PROFILES[profileName] || CACHE_PROFILES.active;
    var output = {};
    CACHE_NAMES.forEach(function(name) {
      output[name] = {
        maxCount: profile[name][0],
        maxBytes: profile[name][1]
      };
    });
    return output;
  }

  function normalizeSystem(value) {
    value = value || {};
    var pressure = String(value.pressure || 'normal').toLowerCase();
    if (!/^(normal|moderate|critical)$/.test(pressure)) pressure = 'normal';
    var thermalState = String(value.thermalState || 'nominal').toLowerCase();
    if (!/^(unknown|nominal|fair|serious|critical)$/.test(thermalState)) thermalState = 'unknown';
    return {
      pressure: pressure,
      onBattery: value.onBattery === true,
      thermalState: thermalState,
      speedLimit: Math.max(0, Math.min(100, finite(value.speedLimit, 100)))
    };
  }

  function constrainedQualityRank(input, frameP95Ms) {
    var rank = qualityRank(input.requestedQuality);
    var system = normalizeSystem(input.system);
    if (input.hidden || input.minimized || input.windowVisible === false || input.locked || input.suspended) rank = 0;
    if (input.focused === false) rank = Math.min(rank, 1);
    if (system.onBattery) rank = Math.min(rank, 1);
    if (system.pressure === 'moderate') rank = Math.min(rank, 1);
    if (system.pressure === 'critical') rank = 0;
    if (system.thermalState === 'fair') rank = Math.min(rank, 2);
    if (system.thermalState === 'serious') rank = Math.min(rank, 1);
    if (system.thermalState === 'critical') rank = 0;
    if (system.speedLimit < 50) rank = 0;
    else if (system.speedLimit < 80) rank = Math.min(rank, 1);
    if (frameP95Ms >= 34) rank = 0;
    else if (frameP95Ms >= 22) rank = Math.min(rank, 1);
    return rank;
  }

  function createResourceGovernor(options) {
    options = options || {};
    var maxFrameSamples = boundedInteger(options.maxFrameSamples, 120, 4, 600);
    var recoveryHoldMs = Math.max(0, finite(options.recoveryHoldMs, 5000));
    var frameTimes = [];
    var effectiveQualityRank = null;
    var qualityRecoverySince = null;
    var qualityRecoveryTarget = null;
    var criticalResourcesLatched = false;
    var criticalRecoverySince = null;
    var releasedResources = Object.create(null);
    var releaseCount = 0;
    var restoreCount = 0;
    var releaseCycles = 0;
    var restoreCycles = 0;
    var revision = 0;
    var lastDecision = null;
    var lastUpdatedAt = 0;
    var previousHardStop = false;
    var previousDeepBackground = false;

    function recordFrame(durationMs) {
      durationMs = finite(durationMs, 0);
      if (durationMs < 0 || durationMs > 60000) return false;
      frameTimes.push(durationMs);
      if (frameTimes.length > maxFrameSamples) frameTimes.splice(0, frameTimes.length - maxFrameSamples);
      return true;
    }

    function updateQuality(desiredRank, now) {
      if (effectiveQualityRank == null) {
        effectiveQualityRank = desiredRank;
        return;
      }
      if (desiredRank < effectiveQualityRank) {
        effectiveQualityRank = desiredRank;
        qualityRecoverySince = null;
        qualityRecoveryTarget = null;
        return;
      }
      if (desiredRank === effectiveQualityRank) {
        qualityRecoverySince = null;
        qualityRecoveryTarget = null;
        return;
      }
      if (qualityRecoveryTarget !== desiredRank) {
        qualityRecoveryTarget = desiredRank;
        qualityRecoverySince = now;
      }
      if (now - qualityRecoverySince >= recoveryHoldMs) {
        effectiveQualityRank = desiredRank;
        qualityRecoverySince = null;
        qualityRecoveryTarget = null;
      }
    }

    function updateCriticalLatch(critical, now) {
      if (critical) {
        criticalResourcesLatched = true;
        criticalRecoverySince = null;
        return;
      }
      if (!criticalResourcesLatched) return;
      if (criticalRecoverySince == null) criticalRecoverySince = now;
      if (now - criticalRecoverySince >= recoveryHoldMs) {
        criticalResourcesLatched = false;
        criticalRecoverySince = null;
      }
    }

    function desiredReleasedResources(input, hardStop, releaseBackground) {
      var desired = Object.create(null);
      var active = input.activeFeatures || {};
      RELEASE_ORDER.forEach(function(name) {
        var release = hardStop || releaseBackground;
        if (!release && criticalResourcesLatched) release = name !== 'nativeLyrics';
        if (release && active[name] !== false) desired[name] = true;
      });
      return desired;
    }

    function resourceTransitions(input, desired) {
      var active = input.activeFeatures || {};
      var releaseSet = [];
      var restoreSet = [];
      RELEASE_ORDER.forEach(function(name) {
        if (!desired[name]) return;
        if (!releasedResources[name]) {
          releasedResources[name] = true;
          releaseSet.push(name);
        }
      });
      RESTORE_ORDER.forEach(function(name) {
        if (!releasedResources[name] || desired[name]) return;
        delete releasedResources[name];
        if (active[name] !== false) restoreSet.push(name);
      });
      if (releaseSet.length) {
        releaseCount += releaseSet.length;
        releaseCycles += 1;
      }
      if (restoreSet.length) {
        restoreCount += restoreSet.length;
        restoreCycles += 1;
      }
      return { releaseSet: releaseSet, restoreSet: restoreSet };
    }

    function update(input) {
      input = input || {};
      var now = Math.max(lastUpdatedAt, finite(input.now, lastUpdatedAt));
      lastUpdatedAt = now;
      if (Object.prototype.hasOwnProperty.call(input, 'frameMs')) recordFrame(input.frameMs);
      var frames = frameSummary(frameTimes);
      var frameP95Ms = Math.max(0, finite(input.frameP95Ms, frames.p95Ms));
      var system = normalizeSystem(input.system);
      var hardStop = input.locked === true || input.suspended === true;
      var deepBackground = input.hidden === true || input.minimized === true || input.windowVisible === false;
      var backgroundMode = /^(auto|keep|release)$/.test(String(input.backgroundMode || ''))
        ? String(input.backgroundMode)
        : 'auto';
      var releaseBackground = deepBackground && backgroundMode !== 'keep';
      var desiredRank = constrainedQualityRank(Object.assign({}, input, { system: system }), frameP95Ms);
      var leavingSleep = (previousHardStop || previousDeepBackground) && !hardStop && !deepBackground;
      if (leavingSleep && system.pressure !== 'critical' && frameP95Ms < 22) {
        effectiveQualityRank = desiredRank;
        qualityRecoverySince = null;
        qualityRecoveryTarget = null;
      } else {
        updateQuality(desiredRank, now);
      }
      updateCriticalLatch(system.pressure === 'critical', now);
      previousHardStop = hardStop;
      previousDeepBackground = deepBackground;

      var mode = 'active';
      if (hardStop) mode = 'suspended';
      else if (releaseBackground) mode = 'released';
      else if (deepBackground) mode = 'background';
      else if (effectiveQualityRank < qualityRank(input.requestedQuality) || criticalResourcesLatched) mode = 'constrained';

      var targetFps = 0;
      if (mode === 'suspended' || mode === 'released') targetFps = 1;
      else if (mode === 'background') targetFps = 15;
      else if (system.pressure === 'critical' || system.thermalState === 'critical' || system.speedLimit < 50) targetFps = 24;
      else if (input.focused === false || effectiveQualityRank === 0 || system.thermalState === 'serious') targetFps = 30;
      else if (effectiveQualityRank === 1 || system.onBattery || system.speedLimit < 80) targetFps = system.onBattery ? 45 : 60;

      var configuredWallpaperFps = boundedInteger(input.wallpaperFrameRate, 30, 1, 60);
      var wallpaperFps = configuredWallpaperFps;
      if (hardStop) wallpaperFps = 1;
      else if (deepBackground || criticalResourcesLatched) wallpaperFps = Math.min(configuredWallpaperFps, 12);
      else if (targetFps > 0) wallpaperFps = Math.min(configuredWallpaperFps, Math.max(12, targetFps));

      var desired = desiredReleasedResources(input, hardStop, releaseBackground);
      var transitions = resourceTransitions(input, desired);
      var cacheProfile = 'active';
      if (mode === 'suspended' || mode === 'released' || criticalResourcesLatched) cacheProfile = 'release';
      else if (effectiveQualityRank === 0) cacheProfile = 'eco';
      else if (effectiveQualityRank === 1) cacheProfile = 'balanced';

      revision += 1;
      lastDecision = {
        revision: revision,
        mode: mode,
        qualityTier: QUALITY_ORDER[effectiveQualityRank],
        targetFps: targetFps,
        wallpaperFps: wallpaperFps,
        cacheProfile: cacheProfile,
        cacheBudgets: cloneCacheBudget(cacheProfile),
        releaseSet: transitions.releaseSet,
        restoreSet: transitions.restoreSet,
        desiredReleased: RELEASE_ORDER.filter(function(name) { return !!desired[name]; }),
        reason: String(input.reason || ''),
        frameP95Ms: frameP95Ms,
        system: system
      };
      return lastDecision;
    }

    function snapshot() {
      var frames = frameSummary(frameTimes);
      return {
        revision: revision,
        mode: lastDecision ? lastDecision.mode : 'active',
        qualityTier: lastDecision ? lastDecision.qualityTier : null,
        targetFps: lastDecision ? lastDecision.targetFps : 0,
        wallpaperFps: lastDecision ? lastDecision.wallpaperFps : 0,
        cacheProfile: lastDecision ? lastDecision.cacheProfile : 'active',
        frameOwner: 'host',
        frameSamples: frames.count,
        frameAverageMs: frames.averageMs,
        frameP50Ms: frames.p50Ms,
        frameP95Ms: frames.p95Ms,
        frameP99Ms: frames.p99Ms,
        frameMaxMs: frames.maxMs,
        releasedResources: RELEASE_ORDER.filter(function(name) { return !!releasedResources[name]; }),
        releaseCount: releaseCount,
        restoreCount: restoreCount,
        releaseCycles: releaseCycles,
        restoreCycles: restoreCycles,
        updatedAt: lastUpdatedAt
      };
    }

    return {
      recordFrame: recordFrame,
      snapshot: snapshot,
      update: update
    };
  }

  return {
    CACHE_NAMES: CACHE_NAMES.slice(),
    QUALITY_ORDER: QUALITY_ORDER.slice(),
    RELEASE_ORDER: RELEASE_ORDER.slice(),
    RESTORE_ORDER: RESTORE_ORDER.slice(),
    createResourceGovernor: createResourceGovernor,
    qualityRank: qualityRank
  };
});
