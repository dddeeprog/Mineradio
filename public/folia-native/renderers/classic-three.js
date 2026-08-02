/*
 * Classic Three.js lyric director adapted from Folia behavior.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricClassicThreeState;
  var motion = root && root.MineradioNativeLyricClassicThreeMotion;
  var performance = root && root.MineradioNativeLyricThreePerformance;
  var adaptive = root && root.MineradioNativeLyricAdaptiveThree;
  var fallback = root && root.MineradioNativeLyricClassic;
  var sparks = root && root.MineradioNativeLyricThreeSparkField;
  var cachePolicy = root && root.MineradioNativeLyricCachePolicy;
  if (typeof module === 'object' && module.exports) {
    state = require('../classic-three-state');
    motion = require('../classic-three-motion');
    performance = require('../three/performance-budget');
    adaptive = require('./adaptive-three');
    fallback = require('./classic');
    sparks = require('../three/spark-field');
    cachePolicy = require('../cache-policy');
  }
  var api = factory(state || {}, motion || {}, performance || {}, adaptive || {}, fallback || {}, sparks || {}, cachePolicy || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricClassicThree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state, motion, performanceApi, adaptiveApi, fallbackApi, sparkApi, cachePolicy) {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function colorToRgb(value, fallback) {
    value = String(value || fallback || '#ffffff').trim();
    var short = /^#([0-9a-f]{3})$/i.exec(value);
    if (short) value = '#' + short[1].split('').map(function(char) { return char + char; }).join('');
    var match = /^#([0-9a-f]{6})$/i.exec(value);
    if (!match) return [1, 1, 1];
    var number = parseInt(match[1], 16);
    return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
  }

  function matrixFor(glyph, sourceGlyph, entry) {
    var baseScale = Math.max(0.0001, finite(sourceGlyph && sourceGlyph.baseScale, 1));
    var stateScale = Math.max(0.0001, finite(glyph.scale, baseScale));
    var ratio = stateScale / baseScale;
    var contentWidth = Math.max(0.0001, finite(entry && entry.width, 1));
    var contentHeight = Math.max(0.0001, finite(entry && entry.height, 1));
    var sampleWidth = Math.max(contentWidth, finite(entry && entry.sampleWidth, contentWidth));
    var sampleHeight = Math.max(contentHeight, finite(entry && entry.sampleHeight, contentHeight));
    var width = Math.max(0.0001, finite(glyph.width, 1)) * ratio * sampleWidth / contentWidth;
    var height = Math.max(0.0001, finite(glyph.height, 1)) * ratio * sampleHeight / contentHeight;
    var rotationX = finite(glyph.rotationX, 0);
    var rotationY = finite(glyph.rotationY, 0);
    var rotationZ = finite(glyph.rotation, 0);
    var halfX = rotationX * 0.5;
    var halfY = rotationY * 0.5;
    var halfZ = rotationZ * 0.5;
    var sinX = Math.sin(halfX);
    var cosX = Math.cos(halfX);
    var sinY = Math.sin(halfY);
    var cosY = Math.cos(halfY);
    var sinZ = Math.sin(halfZ);
    var cosZ = Math.cos(halfZ);
    var qx = sinX * cosY * cosZ + cosX * sinY * sinZ;
    var qy = cosX * sinY * cosZ - sinX * cosY * sinZ;
    var qz = cosX * cosY * sinZ + sinX * sinY * cosZ;
    var qw = cosX * cosY * cosZ - sinX * sinY * sinZ;
    var xx = qx * qx;
    var yy = qy * qy;
    var zz = qz * qz;
    var xy = qx * qy;
    var xz = qx * qz;
    var yz = qy * qz;
    var wx = qw * qx;
    var wy = qw * qy;
    var wz = qw * qz;
    return [
      (1 - 2 * (yy + zz)) * width, 2 * (xy + wz) * width, 2 * (xz - wy) * width, 0,
      2 * (xy - wz) * height, (1 - 2 * (xx + zz)) * height, 2 * (yz + wx) * height, 0,
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
      finite(glyph.x, 0), finite(glyph.y, 0), finite(glyph.z, 0), 1,
    ];
  }

  function setNodeTransform(node, position, scale, rotation) {
    if (!node) return;
    if (node.position && typeof node.position.set === 'function') node.position.set(position[0], position[1], position[2]);
    if (node.scale && typeof node.scale.set === 'function') node.scale.set(scale[0], scale[1], scale[2]);
    if (node.rotation && rotation != null) {
      if (typeof rotation === 'object') {
        node.rotation.x = finite(rotation.x, 0);
        node.rotation.y = finite(rotation.y, 0);
        node.rotation.z = finite(rotation.z, 0);
      } else {
        node.rotation.z = finite(rotation, 0);
      }
    }
  }

  function createFallbackError(reason) {
    var error = new Error(reason || 'Classic Three lyric performance fallback');
    error.code = 'THREE_LYRIC_PERFORMANCE_FALLBACK';
    return error;
  }

  function createClassicThreeDirector(options) {
    options = options || {};
    var host = options.host;
    if (!host || typeof host.createModeScope !== 'function') throw new Error('Classic Three renderer requires a ThreeLyricHost');
    if (typeof state.buildClassicThreeModel !== 'function' || typeof state.resolveClassicThreeFrame !== 'function') {
      throw new Error('Classic Three renderer state is unavailable');
    }
    if (typeof motion.resolveClassicLineExit !== 'function') {
      throw new Error('Classic Three renderer motion is unavailable');
    }
    var createBudget = options.createPerformanceBudget || performanceApi.createThreeLyricPerformanceBudget;
    if (typeof createBudget !== 'function') throw new Error('Classic Three renderer performance budget is unavailable');
    var budget = createBudget(options.performanceOptions || {});
    var scope = null;
    var bodyBatch = null;
    var glowBatch = null;
    var wordEffectLayer = null;
    var sparkField = null;
    var translationBlock = null;
    var rippleBlock = null;
    var unsubscribeContext = null;
    var lyricDocument = null;
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var modelCache = new Map();
    var mountContext = null;
    var released = true;
    var destroyed = false;
    var performanceClock = 0;
    var degradationLevel = 0;
    var ambientTime = 0;
    var layoutEnvironmentKey = null;
    var lastTypography = null;
    var lastParallax = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
    var lastGlowVariant = 'none';
    var lastGroupStates = [];
    var lastActiveGroupKeys = [];
    var lineTransition = null;
    var lastRenderedLineKey = null;
    var lastRenderedRecord = null;
    var lastFrame = null;
    var resourcePolicy = null;

    function releaseRecord(record) {
      if (!record || record.released) return;
      record.released = true;
      record.leases.forEach(function(lease) { if (lease && typeof lease.release === 'function') lease.release(); });
      record.leases.length = 0;
    }

    function clearModelCache() {
      modelCache.forEach(releaseRecord);
      modelCache.clear();
    }

    function trimResourceCaches() {
      var result = null;
      if (typeof cachePolicy.trimMapToPolicy === 'function') {
        result = cachePolicy.trimMapToPolicy(modelCache, resourcePolicy, {
          maxCount: 3,
          maxBytes: 3 * 65536,
          bytesPerEntry: 65536,
          dispose: releaseRecord,
        });
      } else {
        while (modelCache.size > 3) {
          var oldestKey = modelCache.keys().next().value;
          var oldest = modelCache.get(oldestKey);
          modelCache.delete(oldestKey);
          releaseRecord(oldest);
        }
      }
      var atlas = typeof host.getAtlas === 'function' ? host.getAtlas() : null;
      if (atlas && typeof atlas.trim === 'function' && typeof cachePolicy.resolveCacheBudget === 'function') {
        var budgetLimit = cachePolicy.resolveCacheBudget(resourcePolicy, { maxCount: 3, maxBytes: 32 * 1024 * 1024 });
        atlas.trim({ maxBytes: Math.max(0, budgetLimit.maxBytes - modelCache.size * 65536) });
      }
      return result;
    }

    function setResourcePolicy(policy) {
      resourcePolicy = policy || null;
      trimResourceCaches();
      return true;
    }

    function batchSnapshot(batch) {
      return batch && typeof batch.snapshot === 'function' ? batch.snapshot() : {};
    }

    function nativeDiagnostics() {
      var body = batchSnapshot(bodyBatch);
      var glow = batchSnapshot(glowBatch);
      var spark = sparkField && typeof sparkField.snapshot === 'function' ? sparkField.snapshot() : {};
      var bodyInstances = Math.max(0, finite(body.instances, 0));
      var glowInstances = Math.max(0, finite(glow.instances, 0));
      var bodyDrawBatches = Math.max(0, finite(body.drawBatches, 0));
      var glowDrawBatches = Math.max(0, finite(glow.drawBatches, 0));
      var typography = lastTypography || { fontFamily: 'sans-serif', fontWeight: 800 };
      return {
        instances: bodyInstances + glowInstances,
        glyphInstances: bodyInstances + glowInstances,
        drawBatches: bodyDrawBatches + glowDrawBatches,
        bodyInstances: bodyInstances,
        glowInstances: glowInstances,
        bodyDrawBatches: bodyDrawBatches,
        glowDrawBatches: glowDrawBatches,
        sparkPoints: Math.max(0, finite(spark.points, 0)),
        sparkCapacity: Math.max(0, finite(spark.capacity, 0)),
        sparkDrawBatches: spark.visible && finite(spark.points, 0) > 0 ? 1 : 0,
        sparkVisible: spark.visible === true,
        sparkGeometryDisposals: Math.max(0, finite(spark.geometryDisposals, 0)),
        sparkMaterialDisposals: Math.max(0, finite(spark.materialDisposals, 0)),
        groupCount: lastGroupStates.length,
        groupStates: lastGroupStates.slice(),
        activeGroupKeys: lastActiveGroupKeys.slice(),
        fontFamily: String(typography.fontFamily || 'sans-serif'),
        fontWeight: finite(typography.fontWeight, 800),
        glowVariant: lastGlowVariant,
        parallax: {
          x: finite(lastParallax.x, 0),
          y: finite(lastParallax.y, 0),
          rotationX: finite(lastParallax.rotationX, 0),
          rotationY: finite(lastParallax.rotationY, 0),
        },
        lineTransitionActive: lineTransition !== null,
        cachedLines: modelCache.size,
        degradationLevel: degradationLevel,
      };
    }

    function publishNativeDiagnostics(diagnostics) {
      diagnostics = diagnostics || nativeDiagnostics();
      if (scope && scope.group) {
        scope.group.userData = scope.group.userData || {};
        scope.group.userData.nativeLyricSnapshot = diagnostics;
      }
      return diagnostics;
    }

    function lineKey(line) {
      if (!line) return null;
      return JSON.stringify([
        line.id == null ? '' : String(line.id),
        line.key == null ? '' : String(line.key),
        line.index == null ? '' : String(line.index),
        line.startTime == null ? '' : String(line.startTime),
        line.endTime == null ? '' : String(line.endTime),
        line.fullText == null ? '' : String(line.fullText),
      ]);
    }

    function releaseLineTransition() {
      if (!lineTransition) return;
      var handle = lineTransition.handle;
      lineTransition = null;
      if (handle && typeof handle.release === 'function') handle.release();
    }

    function applyLineTransition(reducedMotion) {
      if (!lineTransition) return;
      var visual = motion.resolveClassicLineExit(lineTransition.mode, lineTransition.elapsedMs, reducedMotion);
      if (lineTransition.handle && typeof lineTransition.handle.setVisualState === 'function') {
        lineTransition.handle.setVisualState({
          opacity: visual.opacity,
          scale: visual.scale,
          blurPx: visual.blurPx,
        });
      }
      if (visual.done || lineTransition.elapsedMs >= 340) releaseLineTransition();
    }

    function advanceLineTransition(frame, reducedMotion) {
      if (!lineTransition) return;
      lineTransition.elapsedMs += Math.max(0, finite(frame && frame.rafDeltaMs, 0));
      applyLineTransition(reducedMotion);
    }

    function startLineTransition(record, reducedMotion) {
      releaseLineTransition();
      if (!record || !record.model) return;
      var handle = host.captureTransition(scope, { purpose: 'line' });
      if (!handle) return;
      lineTransition = {
        handle: handle,
        mode: record.model.renderProfile && record.model.renderProfile.lineTransitionMode || 'normal',
        elapsedMs: 0,
      };
      applyLineTransition(reducedMotion);
    }

    function onContext(event) {
      if (!event || event.type !== 'lost' || typeof options.requestFallback !== 'function') return;
      var error = new Error('WebGL context lost while rendering Classic lyrics');
      error.code = 'THREE_LYRIC_CONTEXT_LOST';
      options.requestFallback(error);
    }

    function createWordEffectLayer() {
      var THREE = options.THREE;
      if (!THREE || typeof THREE.Group !== 'function' || !scope.group || typeof scope.group.add !== 'function') {
        return scope.group;
      }
      var layer = new THREE.Group();
      layer.name = 'ClassicThreeWordEffects';
      scope.group.add(layer);
      var layerReleased = false;
      scope.track({
        release: function() {
          if (layerReleased) return;
          layerReleased = true;
          if (layer.parent && typeof layer.parent.remove === 'function') layer.parent.remove(layer);
        },
      });
      return layer;
    }

    function acquireScope() {
      if (scope && !(typeof scope.released === 'function' && scope.released())) return;
      scope = host.createModeScope('classic');
      try {
        wordEffectLayer = createWordEffectLayer();
        bodyBatch = host.createGlyphBatch(scope, { parent: wordEffectLayer, renderOrder: 38, role: 'body' });
        glowBatch = host.createGlyphBatch(scope, { parent: wordEffectLayer, renderOrder: 37, role: 'glow' });
        translationBlock = host.createBlockPlane(scope, { width: 1024, height: 256, renderOrder: 38, role: 'translation' });
        rippleBlock = host.createBlockPlane(scope, { parent: wordEffectLayer, width: 512, height: 512, renderOrder: 37, role: 'ripple' });
        var createSparkField = options.createSparkField || sparkApi.createClassicSparkField;
        if (options.THREE && typeof createSparkField === 'function') {
          sparkField = scope.track(createSparkField({
            THREE: options.THREE,
            parent: wordEffectLayer,
            maxPoints: 48,
            renderOrder: 36,
          }));
        }
        if (translationBlock.getMesh()) translationBlock.getMesh().name = 'ClassicThreeTranslation';
        if (rippleBlock.getMesh()) rippleBlock.getMesh().name = 'ClassicThreeRipple';
        unsubscribeContext = host.subscribeContext(onContext);
        released = false;
        publishNativeDiagnostics();
        if (budget && typeof budget.suspend === 'function') budget.suspend(performanceClock, 2000);
      } catch (error) {
        if (unsubscribeContext) {
          try { unsubscribeContext(); } catch (cleanupError) {
            if (typeof options.onError === 'function') options.onError(cleanupError, { mode: 'classic', phase: 'mount-cleanup' });
          }
        }
        unsubscribeContext = null;
        if (scope && typeof scope.release === 'function') scope.release();
        released = true;
        scope = null;
        bodyBatch = null;
        glowBatch = null;
        wordEffectLayer = null;
        sparkField = null;
        translationBlock = null;
        rippleBlock = null;
        throw error;
      }
    }

    function commonConfig(frame) {
      return frame && frame.config && frame.config.common || {};
    }

    function classicConfig(frame) {
      return frame && frame.config && frame.config.modes && frame.config.modes.classic || {};
    }

    function safeAreaFor(frame) {
      if (typeof options.getSafeArea === 'function') return options.getSafeArea(frame) || {};
      return frame && frame.safeArea || {};
    }

    function worldPerPixelFor(frame) {
      if (typeof options.getWorldPerPixel === 'function') return options.getWorldPerPixel(frame);
      return finite(options.worldPerPixel, 0.006);
    }

    function fontSizeFor(frame) {
      var width = viewport.width;
      return width < 640 ? 42 : width < 1000 ? 56 : 72;
    }

    function typographyFor(frame) {
      var source = typeof options.getTypography === 'function' ? options.getTypography(frame) : null;
      source = source && typeof source === 'object' ? source : {};
      var family = String(source.fontFamily || options.fontFamily || 'sans-serif').trim() || 'sans-serif';
      var weight = Math.round(clamp(source.fontWeight == null ? options.fontWeight : source.fontWeight, 100, 900, 800));
      var letterSpacing = clamp(source.letterSpacing, -0.04, 0.18, 0);
      var key = source.key == null || source.key === ''
        ? [family, weight, letterSpacing].join('|')
        : String(source.key);
      return {
        fontFamily: family,
        fontWeight: weight,
        letterSpacing: letterSpacing,
        key: key,
      };
    }

    function qualityProfile(frame) {
      var quality = String(frame && frame.quality || commonConfig(frame).performanceMode || 'balanced');
      if (quality !== 'quality' && quality !== 'battery') quality = 'balanced';
      var profile = quality === 'quality'
        ? { glowVariant: 'glow-9', glowPadding: 10, dprCap: 2 }
        : quality === 'battery'
          ? { glowVariant: 'glow-3', glowPadding: 6, dprCap: 1 }
          : { glowVariant: 'glow-5', glowPadding: 8, dprCap: 1.5 };
      if (degradationLevel >= 1 && profile.glowVariant === 'glow-9') {
        profile = { glowVariant: 'glow-5', glowPadding: 8, dprCap: profile.dprCap };
      } else if (degradationLevel >= 1 && profile.glowVariant === 'glow-5') {
        profile = { glowVariant: 'glow-3', glowPadding: 6, dprCap: profile.dprCap };
      }
      if (degradationLevel >= 2) profile.dprCap = 1;
      return profile;
    }

    function layoutEnvironmentFor(frame, typography) {
      var common = commonConfig(frame);
      var classic = classicConfig(frame);
      var safeArea = safeAreaFor(frame);
      var profile = qualityProfile(frame);
      var fontSize = fontSizeFor(frame);
      var worldPerPixel = Math.max(0.0001, finite(worldPerPixelFor(frame), 0.006));
      var stageScale = clamp(common.scale, 0.65, 1.8, 1);
      var normalizedSafeArea = {
        left: finite(safeArea.left, 0),
        right: finite(safeArea.right, 0),
        top: finite(safeArea.top, 0),
        bottom: finite(safeArea.bottom, 0),
        shelfOpen: safeArea.shelfOpen === true,
        shelfConflict: safeArea.shelfConflict === true || safeArea.shelfConflicted === true,
      };
      var tuning = {
        intensity: String(classic.intensity || 'normal'),
        spread: clamp(classic.spread, 0, 1, 0.72),
        wordSpacing: clamp(classic.wordSpacing, 0, 2, 0.7),
        enableWordRotation: classic.enableWordRotation !== false,
        wordGlow: clamp(classic.wordGlow, 0, 1, 0.82),
        breathing: clamp(classic.breathing, 0, 1, 1),
        chorusRipple: classic.chorusRipple !== false,
        translationGap: clamp(classic.translationGap, 4, 80, Math.max(12, fontSize * 0.18)),
      };
      var key = JSON.stringify({
        typography: [typography.key, typography.fontFamily, typography.fontWeight, typography.letterSpacing],
        fontSize: fontSize,
        viewport: [finite(viewport.width, 1280), finite(viewport.height, 720), finite(viewport.dpr, 1)],
        safeArea: normalizedSafeArea,
        worldPerPixel: worldPerPixel,
        stageScale: stageScale,
        translationMode: String(common.translationMode || 'auto'),
        glow: [profile.glowPadding, profile.glowVariant, profile.dprCap],
        degradation: [degradationLevel, degradationLevel >= 2 ? 0.5 : 1],
        tuning: tuning,
      });
      return {
        key: key,
        typography: typography,
        fontSize: fontSize,
        safeArea: safeArea,
        normalizedSafeArea: normalizedSafeArea,
        worldPerPixel: worldPerPixel,
        stageScale: stageScale,
        translationMode: String(common.translationMode || 'auto'),
        profile: profile,
        tuning: tuning,
      };
    }

    function atlasStyle(glyph, environment) {
      var profile = environment.profile;
      var typography = environment.typography;
      return {
        fontFamily: typography.fontFamily,
        weight: typography.fontWeight,
        size: glyph.fontSize || environment.fontSize,
        strokeWidth: 0,
        fillMode: 'fill',
        language: /[\u3400-\u9fff]/.test(glyph.char) ? 'zh' : '',
        dpr: Math.min(viewport.dpr || 1, profile.dprCap),
        glowPadding: profile.glowPadding,
      };
    }

    function cacheRecord(line, frame, environment) {
      if (!line) return null;
      var typography = environment.typography;
      var fontSize = environment.fontSize;
      var config = Object.assign({}, classicConfig(frame), {
        fontFamily: typography.fontFamily,
        fontWeight: typography.fontWeight,
        fontSize: fontSize,
        letterSpacing: typography.letterSpacing * fontSize,
        translationMode: environment.translationMode,
        glowPaddingTier: environment.profile.glowPadding,
      });
      if (typeof options.measureText === 'function') {
        config.measureText = function(text) { return options.measureText(text, typography, fontSize); };
      }
      var model = state.buildClassicThreeModel(line, {
        viewport: viewport,
        safeArea: environment.safeArea,
        worldPerPixel: environment.worldPerPixel,
        stageScale: environment.stageScale,
        config: config,
      });
      var recordKey = model.cacheKey + ':typography:' + typography.key + ':d' + degradationLevel;
      if (modelCache.has(recordKey)) {
        var existing = modelCache.get(recordKey);
        modelCache.delete(recordKey);
        modelCache.set(recordKey, existing);
        return existing;
      }
      var atlas = host.getAtlas();
      var leases = [];
      var entries = new Map();
      try {
        model.glyphs.forEach(function(glyph) {
          var lease = atlas.acquire(glyph.char, atlasStyle(glyph, environment));
          leases.push(lease);
          entries.set(glyph.key, lease.entry);
        });
      } catch (error) {
        leases.forEach(function(lease) { if (lease && typeof lease.release === 'function') lease.release(); });
        throw error;
      }
      var glyphs = new Map();
      model.glyphs.forEach(function(glyph) { glyphs.set(glyph.key, glyph); });
      var record = {
        key: recordKey,
        model: model,
        entries: entries,
        glyphs: glyphs,
        leases: leases,
        typography: typography,
        environmentKey: environment.key,
        released: false,
      };
      modelCache.set(recordKey, record);
      trimResourceCaches();
      return record;
    }

    function descriptorTint(glyph, theme) {
      var primary = colorToRgb(theme.primary, '#d6f8ff');
      var highlight = colorToRgb(theme.highlight, '#fff0b8');
      var progress = clamp(glyph.highlight == null ? glyph.progress : glyph.highlight, 0, 1, 0);
      return primary.map(function(value, index) {
        return value + (highlight[index] - value) * progress;
      });
    }

    function parallaxFor(frame, environment, reducedMotion) {
      var source = typeof options.getParallax === 'function' ? options.getParallax(frame) : null;
      source = source && typeof source === 'object' ? source : {};
      var parallax = {
        x: clamp(source.x, -0.03, 0.03, 0),
        y: clamp(source.y, -0.03, 0.03, 0),
        rotationX: clamp(source.rotationX, -4 * Math.PI / 180, 4 * Math.PI / 180, 0),
        rotationY: clamp(source.rotationY, -4 * Math.PI / 180, 4 * Math.PI / 180, 0),
      };
      var common = commonConfig(frame);
      var shelfConflict = environment.normalizedSafeArea.shelfOpen || environment.normalizedSafeArea.shelfConflict;
      if (reducedMotion || frame.quality === 'battery' || common.performanceMode === 'battery' || shelfConflict || degradationLevel >= 2) {
        return { x: 0, y: 0, rotationX: 0, rotationY: 0 };
      }
      return parallax;
    }

    function updateGlyphs(record, resolved, frame, parallax) {
      var common = commonConfig(frame);
      var opacity = clamp(common.opacity, 0.2, 1, 1);
      var commonGlow = clamp(common.glow, 0, 1, 0.55);
      var configuredWordGlow = clamp(classicConfig(frame).wordGlow, 0, 1, 0.82);
      var profile = qualityProfile(frame);
      var glowEnabled = degradationLevel < 3 && commonGlow > 0 && configuredWordGlow > 0;
      var theme = frame.theme || {};
      var bodyDescriptors = [];
      var glowDescriptors = [];
      resolved.glyphs.forEach(function(glyph) {
        var entry = record.entries.get(glyph.key);
        var sourceGlyph = record.glyphs.get(glyph.key);
        var matrix = matrixFor(glyph, sourceGlyph, entry);
        var tint = descriptorTint(glyph, theme);
        var descriptor = {
          pageId: entry.pageId,
          texture: entry.texture,
          uv: entry.uv,
          sampleUv: entry.sampleUv,
          sampleClampUv: entry.sampleClampUv,
          matrix: matrix,
          tint: tint,
          opacity: glyph.opacity * opacity,
          progress: glyph.progress,
        };
        bodyDescriptors.push(Object.assign({}, descriptor, { variant: 'body', glow: 0 }));
        if (glowEnabled) {
          var glyphGlow = clamp(glyph.glow, 0, 1, 0);
          if (degradationLevel >= 1) {
            var glowEnvelope = clamp(glyph.highlight == null ? glyph.progress : glyph.highlight, 0, 1, 0);
            glyphGlow = clamp((glowEnvelope - 0.16) / 0.84, 0, 1, 0) * 0.65 * configuredWordGlow;
          }
          glowDescriptors.push(Object.assign({}, descriptor, {
            variant: profile.glowVariant,
            glow: glyphGlow * commonGlow,
          }));
        }
      });
      bodyBatch.setInstances(bodyDescriptors);
      glowBatch.setInstances(glowDescriptors);
      lastGlowVariant = profile.glowVariant;
      lastGroupStates = resolved.groups.map(function(group) {
        return { key: String(group.key || ''), phase: String(group.pose && group.pose.phase || 'waiting') };
      });
      lastActiveGroupKeys = lastGroupStates.filter(function(group) {
        return group.phase === 'entering' || group.phase === 'active';
      }).map(function(group) { return group.key; });
      if (scope.group && wordEffectLayer && wordEffectLayer !== scope.group) {
        setNodeTransform(
          scope.group,
          [resolved.group.x, resolved.group.y, resolved.group.z],
          [resolved.group.scale, resolved.group.scale, resolved.group.scale],
          { x: 0, y: 0, z: 0 }
        );
        setNodeTransform(
          wordEffectLayer,
          [parallax.x, parallax.y, 0],
          [1, 1, 1],
          { x: parallax.rotationX, y: parallax.rotationY, z: 0 }
        );
      } else if (scope.group) {
        setNodeTransform(
          scope.group,
          [resolved.group.x + parallax.x, resolved.group.y + parallax.y, resolved.group.z],
          [resolved.group.scale, resolved.group.scale, resolved.group.scale],
          { x: parallax.rotationX, y: parallax.rotationY, z: 0 }
        );
      }
    }

    function hideSparkField(frame) {
      if (!sparkField || typeof sparkField.update !== 'function') return;
      sparkField.update({
        opacity: 0,
        quality: frame && frame.quality || 'balanced',
        reducedMotion: true,
        degradationLevel: degradationLevel,
      });
    }

    function updateSparkField(resolved, frame, reducedMotion) {
      if (!sparkField || typeof sparkField.update !== 'function') return;
      var active = null;
      var activeScore = -Infinity;
      resolved.groups.forEach(function(group) {
        var pose = group && group.pose || {};
        if (pose.phase !== 'entering' && pose.phase !== 'active') return;
        var glow = clamp(group.light && group.light.glow, 0, 1, 0);
        var score = (pose.phase === 'active' ? 2 : 1) + glow + clamp(pose.opacity, 0, 1, 0) * 0.1;
        if (score > activeScore) {
          active = group;
          activeScore = score;
        }
      });
      if (!active) {
        hideSparkField(frame);
        return;
      }
      var pose = active.pose;
      var glow = clamp(active.light && active.light.glow, 0, 1, 0);
      var common = commonConfig(frame);
      var opacity = clamp((0.16 + glow * 0.68 + clamp(pose.opacity, 0, 1, 0) * 0.16) * clamp(common.opacity, 0.2, 1, 1), 0, 0.86, 0);
      sparkField.update({
        position: { x: pose.x, y: pose.y, z: pose.z - 0.04 },
        scale: clamp(pose.scale * 1.08, 0.5, 1.8, 1),
        opacity: opacity,
        energy: clamp(0.24 + glow * 0.76, 0, 1, 0.24),
        color: frame.theme && (frame.theme.highlight || frame.theme.primary) || '#fff0b8',
        time: Math.max(0, finite(frame.now, 0)),
        quality: frame.quality || common.performanceMode || 'balanced',
        reducedMotion: reducedMotion,
        degradationLevel: degradationLevel,
      });
    }

    function translationWeight(typography) {
      return Math.round(clamp(Math.round(typography.fontWeight * 0.75 / 50) * 50, 450, 700, 600));
    }

    function drawTranslation(context, canvas, translation, theme, typography) {
      if (!context || !canvas) return;
      context.save();
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = translationWeight(typography) + ' ' + Math.max(48, canvas.height * 0.52) + 'px ' + typography.fontFamily;
      context.fillStyle = theme.secondary || theme.primary || '#d6f8ff';
      context.globalAlpha = 0.82;
      context.fillText(translation.text, canvas.width / 2, canvas.height / 2, canvas.width * 0.92);
      context.restore();
    }

    function updateTranslation(record, frame) {
      var translation = record.model.translation;
      var visible = !!(translation && translation.visible && translation.text);
      translationBlock.setVisible(visible);
      if (!visible) return;
      var theme = frame.theme || {};
      var typography = record.typography;
      var key = [record.model.cacheKey, record.environmentKey, typography.key, typography.fontFamily, typography.fontWeight, typography.letterSpacing, translation.text, theme.primary, theme.secondary].join('|');
      translationBlock.setContent(key, function(context, canvas) { drawTranslation(context, canvas, translation, theme, typography); });
      setNodeTransform(
        translationBlock.getMesh(),
        [translation.x, translation.y, translation.z],
        [Math.max(0.001, translation.width), Math.max(0.001, translation.height), 1],
        0
      );
    }

    function drawRipple(context, canvas, theme) {
      if (!context || !canvas) return;
      var radius = Math.min(canvas.width, canvas.height) * 0.38;
      context.save();
      context.strokeStyle = theme.highlight || '#fff0b8';
      context.lineWidth = Math.max(2, canvas.width * 0.008);
      context.beginPath();
      context.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    function updateRipple(record, resolved, frame) {
      var ripple = resolved.ripple;
      var visible = degradationLevel < 1 && ripple.enabled && ripple.opacity > 0;
      rippleBlock.setVisible(visible);
      if (!visible) return;
      var theme = frame.theme || {};
      rippleBlock.setContent('ripple|' + String(theme.highlight || ''), function(context, canvas) { drawRipple(context, canvas, theme); });
      rippleBlock.setOpacity(ripple.opacity);
      var size = Math.max(0.01, 0.62 * ripple.scale);
      setNodeTransform(rippleBlock.getMesh(), [ripple.x, ripple.y, ripple.z], [size, size, 1], 0);
    }

    function updatePerformance(frame) {
      var frameMs = Math.max(0, finite(frame.rafDeltaMs, 0));
      performanceClock += frameMs;
      var result = budget.push({
        now: performanceClock,
        frameMs: frameMs,
        quality: frame.quality || commonConfig(frame).performanceMode || 'balanced',
      });
      var nextLevel = Math.max(0, Math.min(3, Math.round(finite(result && result.level, degradationLevel))));
      var levelChanged = nextLevel !== degradationLevel;
      if (levelChanged) degradationLevel = nextLevel;
      if (result && result.fallback) throw createFallbackError(result.reason);
      return levelChanged;
    }

    function mount(context) {
      if (destroyed) throw new Error('Classic Three renderer is destroyed');
      mountContext = context || mountContext || {};
      acquireScope();
    }

    function setDocument(document) {
      lyricDocument = document || null;
      releaseLineTransition();
      clearModelCache();
      performanceClock = 0;
      degradationLevel = 0;
      ambientTime = 0;
      layoutEnvironmentKey = null;
      lastTypography = null;
      lastParallax = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
      lastGlowVariant = 'none';
      lastGroupStates = [];
      lastActiveGroupKeys = [];
      lastRenderedLineKey = null;
      lastRenderedRecord = null;
      lastFrame = null;
      hideSparkField();
      publishNativeDiagnostics();
      if (budget && typeof budget.resetTrack === 'function') budget.resetTrack();
    }

    function update(frame) {
      if (destroyed || released || !scope) return;
      frame = frame || {};
      lastFrame = frame;
      if (frame.viewport) viewport = Object.assign({}, viewport, frame.viewport);
      ambientTime += Math.max(0, finite(frame.rafDeltaMs, 0)) / 1000;
      host.updateAnchor(frame);
      var levelChanged = updatePerformance(frame);
      var reducedMotion = frame.reducedMotion === true || commonConfig(frame).reduceMotion === true;
      if (!frame.line) {
        if (levelChanged) {
          clearModelCache();
          layoutEnvironmentKey = null;
          if (typeof host.trim === 'function') host.trim(degradationLevel);
        }
        releaseLineTransition();
        bodyBatch.setInstances([]);
        glowBatch.setInstances([]);
        translationBlock.setVisible(false);
        rippleBlock.setVisible(false);
        hideSparkField(frame);
        lastParallax = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
        lastGlowVariant = 'none';
        lastGroupStates = [];
        lastActiveGroupKeys = [];
        lastRenderedLineKey = null;
        lastRenderedRecord = null;
        if (scope.group) setNodeTransform(scope.group, [0, 0, 0], [1, 1, 1], { x: 0, y: 0, z: 0 });
        if (wordEffectLayer && wordEffectLayer !== scope.group) {
          setNodeTransform(wordEffectLayer, [0, 0, 0], [1, 1, 1], { x: 0, y: 0, z: 0 });
        }
        publishNativeDiagnostics();
        return;
      }
      var incomingLineKey = lineKey(frame.line);
      if (lastRenderedRecord && lastRenderedLineKey !== incomingLineKey) {
        startLineTransition(lastRenderedRecord, reducedMotion);
      } else {
        advanceLineTransition(frame, reducedMotion);
      }
      var typography = typographyFor(frame);
      var environment = layoutEnvironmentFor(frame, typography);
      if (layoutEnvironmentKey !== null && layoutEnvironmentKey !== environment.key) clearModelCache();
      if (levelChanged && typeof host.trim === 'function') host.trim(degradationLevel);
      layoutEnvironmentKey = environment.key;
      lastTypography = typography;
      var current = cacheRecord(frame.line, frame, environment);
      if (frame.nextLine && degradationLevel < 3) cacheRecord(frame.nextLine, frame, environment);
      var resolved = state.resolveClassicThreeFrame(current.model, frame.now, {
        reducedMotion: reducedMotion,
        ambientTime: ambientTime,
        depthScale: degradationLevel >= 2 ? 0.5 : 1,
      });
      lastParallax = parallaxFor(frame, environment, reducedMotion);
      updateGlyphs(current, resolved, frame, lastParallax);
      updateTranslation(current, frame);
      updateRipple(current, resolved, frame);
      updateSparkField(resolved, frame, reducedMotion);
      lastRenderedLineKey = incomingLineKey;
      lastRenderedRecord = current;
      publishNativeDiagnostics();
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      clearModelCache();
      layoutEnvironmentKey = null;
      if (budget && typeof budget.suspend === 'function') budget.suspend(performanceClock, 2000);
    }

    function captureTransition() {
      return scope ? host.captureTransition(scope) : null;
    }

    function release() {
      if (released) return;
      released = true;
      releaseLineTransition();
      clearModelCache();
      layoutEnvironmentKey = null;
      lastTypography = null;
      lastParallax = { x: 0, y: 0, rotationX: 0, rotationY: 0 };
      lastGlowVariant = 'none';
      lastGroupStates = [];
      lastActiveGroupKeys = [];
      lastRenderedLineKey = null;
      lastRenderedRecord = null;
      if (unsubscribeContext) unsubscribeContext();
      unsubscribeContext = null;
      if (bodyBatch && typeof bodyBatch.release === 'function') bodyBatch.release();
      if (glowBatch && typeof glowBatch.release === 'function') glowBatch.release();
      if (scope && typeof scope.release === 'function') scope.release();
      scope = null;
      bodyBatch = null;
      glowBatch = null;
      wordEffectLayer = null;
      sparkField = null;
      translationBlock = null;
      rippleBlock = null;
    }

    function resume() {
      if (destroyed) return false;
      acquireScope();
      return true;
    }

    function snapshot() {
      var diagnostics = publishNativeDiagnostics(nativeDiagnostics());
      var hostSnapshot = typeof host.snapshot === 'function' ? host.snapshot() : {};
      var performanceSnapshot = budget && typeof budget.snapshot === 'function' ? budget.snapshot() : {};
      return Object.assign({}, hostSnapshot, performanceSnapshot, diagnostics, {
        mode: 'classic',
        backend: 'three',
        released: released,
        cacheEntries: modelCache.size,
        cacheBytes: modelCache.size * 65536 + (Number(hostSnapshot.atlasBytes) || 0),
      });
    }

    function destroy() {
      if (destroyed) return;
      release();
      destroyed = true;
      lyricDocument = null;
      mountContext = null;
      lastFrame = null;
    }

    return {
      kind: 'three',
      mount: mount,
      setDocument: setDocument,
      update: update,
      resize: resize,
      setResourcePolicy: setResourcePolicy,
      captureTransition: captureTransition,
      release: release,
      resume: resume,
      snapshot: snapshot,
      destroy: destroy,
    };
  }

  function createClassicThreeRenderer(context) {
    context = context || {};
    if (typeof adaptiveApi.createAdaptiveThreeRenderer !== 'function') throw new Error('Adaptive Three renderer is unavailable');
    return adaptiveApi.createAdaptiveThreeRenderer({
      mode: 'classic',
      onFallback: context.onFallback,
      onError: context.onError,
      createPrimary: function(input) {
        return createClassicThreeDirector(Object.assign({}, context, { requestFallback: input.requestFallback }));
      },
      createFallback: function() {
        if (typeof fallbackApi.createClassicRenderer !== 'function') throw new Error('Classic DOM fallback is unavailable');
        return fallbackApi.createClassicRenderer(context);
      },
    });
  }

  return {
    createClassicThreeDirector: createClassicThreeDirector,
    createClassicThreeRenderer: createClassicThreeRenderer,
  };
});
