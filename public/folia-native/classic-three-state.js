/*
 * Classic Three.js lyric state adapted from Folia behavior.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var domState = root && root.MineradioNativeLyricDomState;
  var layout = root && root.MineradioNativeLyricLayout;
  var groupsApi = root && root.MineradioNativeLyricClassicThreeGroups;
  var motion = root && root.MineradioNativeLyricClassicThreeMotion;
  if (typeof module === 'object' && module.exports) {
    domState = require('./dom-state');
    layout = require('./layout');
    groupsApi = require('./classic-three-groups');
    motion = require('./classic-three-motion');
  }
  var api = factory(domState || {}, layout || {}, groupsApi || {}, motion || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricClassicThreeState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(domState, layout, groupsApi, motion) {
  'use strict';

  var MAX_ACTIVE_SCALE = 1.32;
  var MAX_DEPTH = 0.34;
  var MAX_ROTATION = 7 * Math.PI / 180;
  var MAX_ROTATION_X = 6 * Math.PI / 180;
  var MAX_ROTATION_Y = 9 * Math.PI / 180;
  var DEPTH_LANES = [-0.28, 0.28, -0.22, 0.22];
  var VERTICAL_LANES = [-20, 18, -12, 22];
  var SCALE_LANES = [1.14, 0.92, 1.08, 0.86];

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1, 0);
    return value * value * (3 - 2 * value);
  }

  function splitGraphemes(text) {
    if (typeof layout.splitGraphemes === 'function') return layout.splitGraphemes(text);
    return Array.from(String(text || ''));
  }

  function hash32(value) {
    if (typeof layout.hash32 === 'function') return layout.hash32(value);
    var hash = 2166136261;
    value = String(value || '');
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededSigned(seed) {
    return hash32(seed) / 4294967295 * 2 - 1;
  }

  function cacheNumber(value) {
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function cacheScalar(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value == null) return value;
    return String(value);
  }

  function timingProfileSignature(line, renderProfile) {
    var words = Array.isArray(line.words) ? line.words : [];
    var graphemes = Array.isArray(line.graphemes) ? line.graphemes : [];
    var hints = line.renderHints || {};
    var signature = [
      words.map(function(word) {
        var syllables = Array.isArray(word && word.syllables) ? word.syllables : [];
        return [
          String(word && word.text || ''),
          cacheNumber(word && word.startTime),
          cacheNumber(word && word.endTime),
          syllables.map(function(syllable) {
            return [
              String(syllable && syllable.text || ''),
              cacheNumber(syllable && syllable.startTime),
              cacheNumber(syllable && syllable.endTime),
            ];
          }),
        ];
      }),
      graphemes.map(function(grapheme) {
        return [
          String(grapheme && grapheme.char || ''),
          cacheNumber(grapheme && grapheme.startTime),
          cacheNumber(grapheme && grapheme.endTime),
        ];
      }),
      [
        String(hints.timingClass || ''),
        cacheNumber(hints.renderEndTime),
        String(hints.wordRevealMode || ''),
        String(hints.lineTransitionMode || ''),
      ],
      Object.keys(renderProfile || {}).sort().map(function(key) {
        return [key, cacheScalar(renderProfile[key])];
      }),
    ];
    return JSON.stringify(signature);
  }

  function normalizeViewport(viewport) {
    viewport = viewport || {};
    return {
      width: Math.max(1, finite(viewport.width, 1280)),
      height: Math.max(1, finite(viewport.height, 720)),
      dpr: Math.max(0.25, finite(viewport.dpr, 1)),
    };
  }

  function normalizeSafeArea(viewport, safeArea) {
    safeArea = safeArea || {};
    var horizontal = Math.max(24, viewport.width * 0.08);
    var top = Math.max(48, viewport.height * 0.1);
    var bottom = Math.max(92, viewport.height * 0.17);
    var result = {
      left: clamp(safeArea.left, 0, viewport.width * 0.4, horizontal),
      right: clamp(safeArea.right, 0, viewport.width * 0.4, horizontal),
      top: clamp(safeArea.top, 0, viewport.height * 0.4, top),
      bottom: clamp(safeArea.bottom, 0, viewport.height * 0.48, bottom),
    };
    if (viewport.width - result.left - result.right < 48) {
      result.left = Math.max(0, (viewport.width - 48) / 2);
      result.right = result.left;
    }
    if (viewport.height - result.top - result.bottom < 96) {
      result.top = Math.max(0, (viewport.height - 96) * 0.4);
      result.bottom = Math.max(0, viewport.height - result.top - 96);
    }
    return result;
  }

  function reserveSafeAreaForStageScale(viewport, safeArea, stageScale) {
    if (stageScale <= 1) return Object.assign({}, safeArea);
    var centerX = viewport.width / 2;
    var centerY = viewport.height / 2;
    var rightEdge = viewport.width - safeArea.right;
    var bottomEdge = viewport.height - safeArea.bottom;
    return {
      left: clamp(centerX + (safeArea.left - centerX) / stageScale, 0, viewport.width, safeArea.left),
      right: clamp(viewport.width - (centerX + (rightEdge - centerX) / stageScale), 0, viewport.width, safeArea.right),
      top: clamp(centerY + (safeArea.top - centerY) / stageScale, 0, viewport.height, safeArea.top),
      bottom: clamp(viewport.height - (centerY + (bottomEdge - centerY) / stageScale), 0, viewport.height, safeArea.bottom),
    };
  }

  function resolveMeasure(config, fontSize) {
    var sourceMeasure = typeof config.measureText === 'function' ? config.measureText : null;
    return function(text) {
      var fallback = splitGraphemes(text).length * fontSize * 0.65;
      return Math.max(0, finite(sourceMeasure && sourceMeasure(text), fallback));
    };
  }

  function glowPadding(config) {
    var tier = config.glowPaddingTier;
    if (typeof tier === 'number') return clamp(tier, 0, 16, 4);
    if (tier === 'high') return 8;
    if (tier === 'low') return 2;
    if (tier === 'off' || tier === 'none') return 0;
    return 4;
  }

  function emptyBounds(viewport, safeArea, y) {
    var centerX = (safeArea.left + viewport.width - safeArea.right) / 2;
    var centerY = finite(y, (safeArea.top + viewport.height - safeArea.bottom) / 2);
    return { left: centerX, right: centerX, top: centerY, bottom: centerY, width: 0, height: 0 };
  }

  function boundsFromEdges(left, right, top, bottom) {
    return {
      left: left,
      right: right,
      top: top,
      bottom: bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function intensityName(value) {
    value = String(value || 'normal');
    return value === 'calm' || value === 'chaotic' ? value : 'normal';
  }

  function createSourceAlignment(line) {
    var graphemes = splitGraphemes(line && line.fullText);
    if (!graphemes.length && Array.isArray(line && line.graphemes)) {
      graphemes = line.graphemes.map(function(grapheme) { return String(grapheme && grapheme.char || ''); });
    }
    return { graphemes: graphemes, cursor: 0 };
  }

  function takeSourceIndex(alignment, char) {
    for (var index = alignment.cursor; index < alignment.graphemes.length; index += 1) {
      if (alignment.graphemes[index] !== char) continue;
      alignment.cursor = index + 1;
      return index;
    }
    var fallback = alignment.cursor;
    alignment.cursor += 1;
    return fallback;
  }

  function measuredGroup(source, groupIndex, sourceAlignment, config, measureText, fontSize, letterSpacing) {
    var timings = Array.isArray(source.graphemes) && source.graphemes.length
      ? source.graphemes
      : splitGraphemes(source.text).map(function(char, index, chars) {
        var duration = Math.max(0, source.endTime - source.startTime);
        return {
          char: char,
          startTime: source.startTime + duration * index / Math.max(1, chars.length),
          endTime: source.startTime + duration * (index + 1) / Math.max(1, chars.length),
        };
      });
    var glyphs = timings.map(function(timing) {
      var char = String(timing && timing.char || '');
      var sourceIndex = takeSourceIndex(sourceAlignment, char);
      return {
        key: source.key + ':' + sourceIndex,
        char: char,
        groupIndex: groupIndex,
        graphemeIndex: sourceIndex,
        sourceGraphemeIndex: sourceIndex,
        wordIndex: typeof timing.wordIndex === 'number' ? timing.wordIndex : -1,
        startTime: finite(timing.startTime, source.startTime),
        endTime: Math.max(finite(timing.startTime, source.startTime), finite(timing.endTime, source.endTime)),
        rawWidth: Math.max(fontSize * 0.18, measureText(timing.char)),
      };
    }).filter(function(glyph) {
      return !/^\s+$/.test(String(glyph.char || ''));
    });
    var width = glyphs.reduce(function(total, glyph) { return total + glyph.rawWidth; }, 0);
    width = Math.max(0, width + Math.max(0, glyphs.length - 1) * letterSpacing);
    return {
      source: source,
      glyphs: glyphs,
      rawWidth: width,
      rawHeight: fontSize,
    };
  }

  function transformLocal(localGlyph, pose) {
    var halfX = finite(pose.rotationX, 0) * 0.5;
    var halfY = finite(pose.rotationY, 0) * 0.5;
    var halfZ = finite(pose.rotation, 0) * 0.5;
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
    var localX = localGlyph.localX * pose.scale;
    var localY = localGlyph.localY * pose.scale;
    var localZ = finite(localGlyph.z, 0) * pose.scale;
    return {
      x: pose.x + (1 - 2 * (yy + zz)) * localX + 2 * (xy - wz) * localY + 2 * (xz + wy) * localZ,
      y: pose.y + 2 * (xy + wz) * localX + (1 - 2 * (xx + zz)) * localY + 2 * (yz - wx) * localZ,
      z: pose.z + 2 * (xz - wy) * localX + 2 * (yz + wx) * localY + (1 - 2 * (xx + yy)) * localZ,
    };
  }

  function modelGlyph(group, groupIndex, localGlyph) {
    var point = transformLocal(localGlyph, group.basePose);
    return {
      key: localGlyph.key,
      char: localGlyph.char,
      groupIndex: groupIndex,
      itemIndex: groupIndex,
      graphemeIndex: localGlyph.graphemeIndex,
      sourceGraphemeIndex: localGlyph.sourceGraphemeIndex,
      wordIndex: localGlyph.wordIndex,
      startTime: localGlyph.startTime,
      endTime: localGlyph.endTime,
      baseX: point.x,
      baseY: point.y,
      x: point.x,
      y: point.y,
      z: point.z,
      rotationX: group.basePose.rotationX,
      rotationY: group.basePose.rotationY,
      rotation: group.basePose.rotation,
      baseScale: 1,
      width: localGlyph.width,
      height: localGlyph.height,
      pixelWidth: localGlyph.pixelWidth,
      pixelHeight: localGlyph.pixelHeight,
      fontSize: localGlyph.fontSize,
    };
  }

  function buildClassicThreeModel(line, options) {
    options = options || {};
    line = line || { index: 0, fullText: '', startTime: 0, endTime: 0, words: [], graphemes: [], renderHints: {} };
    if (typeof groupsApi.buildClassicThreeGroups !== 'function') throw new Error('CLASSIC_THREE_GROUPS_UNAVAILABLE');
    if (typeof domState.resolveClassicLineRenderProfile !== 'function'
      || typeof domState.getClassicWordActiveEndTime !== 'function') {
      throw new Error('CLASSIC_DOM_STATE_PROFILE_UNAVAILABLE');
    }

    var viewport = normalizeViewport(options.viewport);
    var safeArea = normalizeSafeArea(viewport, options.safeArea);
    var stageScale = clamp(options.stageScale, 0.5, 2, 1);
    var layoutSafeArea = reserveSafeAreaForStageScale(viewport, safeArea, stageScale);
    var config = Object.assign({}, options.config || {});
    var worldPerPixel = Math.max(0.0001, finite(options.worldPerPixel, 0.006));
    var fontSize = Math.max(12, finite(config.fontSize, viewport.width < 640 ? 42 : viewport.width < 1000 ? 56 : 72));
    var fontFamily = String(config.fontFamily || 'Noto Sans SC');
    var fontWeight = finite(config.fontWeight, 800);
    var letterSpacing = clamp(config.letterSpacing, -fontSize * 0.04, fontSize * 0.18, 0);
    var padding = glowPadding(config);
    var measureText = resolveMeasure(config, fontSize);
    var intensity = intensityName(config.intensity);
    var spread = clamp(config.spread, 0, 1, 0.72);
    var wordSpacing = clamp(config.wordSpacing, 0, 2, 0.7);
    var rotationEnabled = config.enableWordRotation !== false;
    var renderProfile = domState.resolveClassicLineRenderProfile(line);
    var sourceGroups = groupsApi.buildClassicThreeGroups(line, options);
    var sourceAlignment = createSourceAlignment(line);
    var measured = sourceGroups.map(function(group, index) {
      return measuredGroup(group, index, sourceAlignment, config, measureText, fontSize, letterSpacing);
    });
    var safeWidth = Math.max(1, viewport.width - layoutSafeArea.left - layoutSafeArea.right);
    var safeHeight = Math.max(1, viewport.height - layoutSafeArea.top - layoutSafeArea.bottom);
    var translationMode = String(config.translationMode || 'auto');
    var translationText = translationMode === 'off' ? '' : String(line.translation || '');
    var translationFontSize = Math.max(10, fontSize * 0.34);
    var translationRawWidth = translationText
      ? measureText(translationText) * translationFontSize / fontSize
      : 0;
    var translationFit = translationRawWidth
      ? Math.min(1, safeWidth * 0.92 / translationRawWidth)
      : 1;
    var translationWidth = translationRawWidth * translationFit;
    var translationHeight = translationText ? translationFontSize * 1.35 * translationFit : 0;
    var configuredTranslationGap = clamp(config.translationGap, 4, 80, Math.max(12, fontSize * 0.18));
    var translationGap = translationText ? configuredTranslationGap : 0;
    var spacing = fontSize * (0.12 + wordSpacing * 0.16);
    var lineLaneOffset = hash32([
      line.id == null ? '' : line.id,
      line.index == null ? '' : line.index,
      line.startTime,
      line.fullText,
    ].join('|')) % DEPTH_LANES.length;
    var spatialStrength = intensity === 'calm' ? 0.3 : intensity === 'chaotic' ? 1 : 0.86;
    var compositionStrength = intensity === 'calm' ? 0.3 : intensity === 'chaotic' ? 1 : 0.82 + spread * 0.18;

    measured.forEach(function(item, index) {
      var lane = (lineLaneOffset + index) % DEPTH_LANES.length;
      var angle = rotationEnabled
        ? seededSigned(item.source.key + '|rotation') * MAX_ROTATION * compositionStrength
        : 0;
      var cosine = Math.abs(Math.cos(angle));
      var sine = Math.abs(Math.sin(angle));
      item.rotation = angle;
      item.rotationX = rotationEnabled
        ? seededSigned(item.source.key + '|rotation-x') * MAX_ROTATION_X * compositionStrength
        : 0;
      item.rotationY = rotationEnabled
        ? seededSigned(item.source.key + '|rotation-y') * MAX_ROTATION_Y * compositionStrength
        : 0;
      item.yOffset = VERTICAL_LANES[lane] * compositionStrength
        + seededSigned(item.source.key + '|y') * 3 * compositionStrength;
      item.layoutScale = 1 + (SCALE_LANES[lane] - 1) * compositionStrength;
      item.envelopeWidth = MAX_ACTIVE_SCALE * (item.rawWidth * cosine + item.rawHeight * sine) + padding * 2;
      item.envelopeHeight = MAX_ACTIVE_SCALE * (item.rawHeight * cosine + item.rawWidth * sine) + padding * 2;
      item.depth = DEPTH_LANES[lane] * spatialStrength;
      item.index = index;
    });

    var rawEnvelopeWidth = measured.reduce(function(total, item) {
      return total + item.envelopeWidth;
    }, 0) + Math.max(0, measured.length - 1) * spacing;
    var rawTop = measured.reduce(function(top, item) {
      return Math.min(top, item.yOffset - item.envelopeHeight / 2);
    }, 0);
    var rawBottom = measured.reduce(function(bottom, item) {
      return Math.max(bottom, item.yOffset + item.envelopeHeight / 2);
    }, 0);
    var rawEnvelopeHeight = Math.max(fontSize, rawBottom - rawTop);
    var availableMainHeight = Math.max(1, safeHeight - translationHeight - translationGap);
    var fitScale = Math.min(
      1,
      rawEnvelopeWidth > 0 ? safeWidth * 0.92 / rawEnvelopeWidth : 1,
      availableMainHeight / rawEnvelopeHeight
    );
    fitScale = Math.max(0.01, finite(fitScale, 1));
    var mainWidth = rawEnvelopeWidth * fitScale;
    var mainHeight = rawEnvelopeHeight * fitScale;
    var totalHeight = mainHeight + translationGap + translationHeight;
    var contentTop = layoutSafeArea.top + Math.max(0, (safeHeight - totalHeight) / 2);
    var mainCenterY = contentTop + mainHeight / 2;
    var rawVerticalCenter = (rawTop + rawBottom) / 2;
    var projectedCenterX = layoutSafeArea.left + safeWidth / 2;
    var envelopeCursor = projectedCenterX - mainWidth / 2;
    var groups = measured.map(function(item, groupIndex) {
      var envelopeWidth = item.envelopeWidth * fitScale;
      var envelopeHeight = item.envelopeHeight * fitScale;
      var centerX = envelopeCursor + envelopeWidth / 2;
      var centerY = mainCenterY + (item.yOffset - rawVerticalCenter) * fitScale;
      envelopeCursor += envelopeWidth + spacing * fitScale;
      var baseX = (centerX - viewport.width / 2) * worldPerPixel;
      var baseY = (viewport.height / 2 - centerY) * worldPerPixel;
      var depth = clamp(item.depth, -MAX_DEPTH, MAX_DEPTH, 0);
      var entryDirection = seededSigned(item.source.key + '|entry');
      var entryX = baseX + entryDirection * Math.min(28, fontSize * 0.42) * fitScale * worldPerPixel;
      var entryY = baseY - seededSigned(item.source.key + '|entry-y') * Math.min(20, fontSize * 0.28) * fitScale * worldPerPixel;
      var depthEntry = intensity === 'calm' ? 0.18 : 0.34;
      var depthActive = intensity === 'calm' ? 0.08 : 0.18;
      var depthPassed = intensity === 'calm' ? 0.04 : 0.10;
      var activeScale = item.layoutScale * (intensity === 'calm' ? 1.06 : intensity === 'chaotic' ? 1.14 : 1.11);
      var basePose = Object.freeze({
        x: baseX,
        y: baseY,
        z: depth,
        rotationX: item.rotationX,
        rotationY: item.rotationY,
        rotation: item.rotation,
        scale: item.layoutScale,
        opacity: 1,
      });
      var entryPose = Object.freeze({
        x: entryX,
        y: entryY,
        z: depth - depthEntry,
        rotationX: rotationEnabled
          ? clamp(item.rotationX - entryDirection * MAX_ROTATION_X * 1.2, -MAX_ROTATION_X * 2, MAX_ROTATION_X * 2, 0)
          : 0,
        rotationY: rotationEnabled
          ? clamp(item.rotationY + entryDirection * MAX_ROTATION_Y * 1.15, -MAX_ROTATION_Y * 2, MAX_ROTATION_Y * 2, 0)
          : 0,
        rotation: rotationEnabled
          ? clamp(item.rotation - entryDirection * MAX_ROTATION * 0.35, -MAX_ROTATION, MAX_ROTATION, 0)
          : 0,
        scale: item.layoutScale * 0.68,
        opacity: 0.06,
      });
      var activePose = Object.freeze({
        x: baseX,
        y: baseY,
        z: depth + depthActive,
        rotationX: item.rotationX,
        rotationY: item.rotationY,
        rotation: item.rotation,
        scale: Math.min(MAX_ACTIVE_SCALE, activeScale),
        opacity: 1,
      });
      var passedPose = Object.freeze({
        x: baseX,
        y: baseY,
        z: depth - depthPassed,
        rotationX: item.rotationX * 0.65,
        rotationY: item.rotationY * 0.65,
        rotation: item.rotation * 0.6,
        scale: item.layoutScale * 0.96,
        opacity: intensity === 'chaotic' ? 0.82 : 0.88,
      });
      var localCursor = -item.rawWidth * fitScale / 2;
      var localGlyphs = item.glyphs.map(function(rawGlyph) {
        var pixelWidth = rawGlyph.rawWidth * fitScale;
        var localGlyph = Object.freeze({
          key: rawGlyph.key,
          char: rawGlyph.char,
          groupIndex: groupIndex,
          graphemeIndex: rawGlyph.graphemeIndex,
          sourceGraphemeIndex: rawGlyph.sourceGraphemeIndex,
          wordIndex: rawGlyph.wordIndex,
          localX: (localCursor + pixelWidth / 2) * worldPerPixel,
          localY: 0,
          x: (localCursor + pixelWidth / 2) * worldPerPixel,
          y: 0,
          z: 0,
          width: pixelWidth * worldPerPixel,
          height: fontSize * fitScale * worldPerPixel,
          pixelWidth: pixelWidth,
          pixelHeight: fontSize * fitScale,
          fontSize: fontSize,
          startTime: rawGlyph.startTime,
          endTime: rawGlyph.endTime,
        });
        localCursor += pixelWidth + letterSpacing * fitScale;
        return localGlyph;
      });
      localGlyphs = Object.freeze(localGlyphs);
      var projectedBounds = boundsFromEdges(
        centerX - envelopeWidth / 2,
        centerX + envelopeWidth / 2,
        centerY - envelopeHeight / 2,
        centerY + envelopeHeight / 2
      );
      return Object.freeze({
        key: item.source.key,
        text: item.source.text,
        startTime: item.source.startTime,
        endTime: item.source.endTime,
        activeEndTime: domState.getClassicWordActiveEndTime(item.source, renderProfile),
        basePose: basePose,
        entryPose: entryPose,
        activePose: activePose,
        passedPose: passedPose,
        driftRotation: intensity === 'calm' ? 0 : item.rotation * 0.35,
        localGlyphs: localGlyphs,
        projectedBounds: Object.freeze(projectedBounds),
      });
    });
    groups = Object.freeze(groups);

    var projectedBounds = groups.length
      ? groups.reduce(function(bounds, group) {
        bounds.left = Math.min(bounds.left, group.projectedBounds.left);
        bounds.right = Math.max(bounds.right, group.projectedBounds.right);
        bounds.top = Math.min(bounds.top, group.projectedBounds.top);
        bounds.bottom = Math.max(bounds.bottom, group.projectedBounds.bottom);
        return bounds;
      }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity })
      : emptyBounds(viewport, layoutSafeArea, mainCenterY);
    projectedBounds = boundsFromEdges(projectedBounds.left, projectedBounds.right, projectedBounds.top, projectedBounds.bottom);
    var translationTop = translationText ? projectedBounds.bottom + translationGap : projectedBounds.bottom;
    var translationBounds = translationText
      ? boundsFromEdges(
        projectedCenterX - translationWidth / 2,
        projectedCenterX + translationWidth / 2,
        translationTop,
        translationTop + translationHeight
      )
      : emptyBounds(viewport, layoutSafeArea, translationTop);
    var translationCenterY = (translationBounds.top + translationBounds.bottom) / 2;
    var glyphs = groups.reduce(function(result, group, groupIndex) {
      return result.concat(group.localGlyphs.map(function(localGlyph) {
        return modelGlyph(group, groupIndex, localGlyph);
      }));
    }, []);
    var wordGlow = clamp(config.wordGlow, 0, 1, 0.82);
    var breathing = clamp(config.breathing, 0, 1, 1);
    var chorusRipple = config.chorusRipple !== false;
    var isChorus = Boolean(line.isChorus);
    var rippleTargets = groups.map(function(group, groupIndex) {
      return Object.freeze({
        groupIndex: groupIndex,
        x: group.basePose.x,
        y: group.basePose.y,
        z: group.basePose.z - 0.01,
        startTime: group.startTime,
        endTime: group.activeEndTime,
        maxScale: MAX_ACTIVE_SCALE,
      });
    });
    var cacheInput = {
      line: [line.id, line.key, line.index, line.fullText, line.translation, line.startTime, line.endTime, isChorus],
      timingProfile: timingProfileSignature(line, renderProfile),
      viewport: [viewport.width, viewport.height, viewport.dpr],
      safe: [safeArea.left, safeArea.right, safeArea.top, safeArea.bottom],
      layoutSafe: [layoutSafeArea.left, layoutSafeArea.right, layoutSafeArea.top, layoutSafeArea.bottom],
      stageScale: stageScale,
      worldPerPixel: worldPerPixel,
      typography: [fontFamily, fontWeight, fontSize, letterSpacing, config.glowPaddingTier],
      translation: [configuredTranslationGap, translationMode],
      tuning: [intensity, spread, wordSpacing, rotationEnabled, wordGlow, breathing, chorusRipple],
      measurements: measured.map(function(item) { return item.glyphs.map(function(glyph) { return glyph.rawWidth; }); }),
    };
    var cacheSignature = JSON.stringify(cacheInput);

    return {
      mode: 'classic',
      lineIndex: line.index,
      sourceLine: line,
      renderProfile: renderProfile,
      intensity: intensity,
      viewport: viewport,
      safeArea: safeArea,
      layoutSafeArea: layoutSafeArea,
      stageScale: stageScale,
      worldPerPixel: worldPerPixel,
      fitScale: fitScale,
      config: {
        fontFamily: fontFamily,
        fontWeight: fontWeight,
        fontSize: fontSize,
        letterSpacing: letterSpacing,
        dpr: viewport.dpr,
        glowPaddingTier: config.glowPaddingTier,
        wordGlow: wordGlow,
        breathing: breathing,
      },
      groups: groups,
      glyphs: glyphs,
      translation: {
        text: translationText,
        visible: !!translationText,
        x: (projectedCenterX - viewport.width / 2) * worldPerPixel,
        y: (viewport.height / 2 - translationCenterY) * worldPerPixel,
        z: -0.025,
        width: translationWidth * worldPerPixel,
        height: translationHeight * worldPerPixel,
        fontSize: translationFontSize * translationFit,
        gap: translationGap,
        projectedBounds: translationBounds,
      },
      ripple: {
        enabled: Boolean(isChorus && chorusRipple),
        maxScale: MAX_ACTIVE_SCALE,
        targets: Object.freeze(rippleTargets),
      },
      projectedBounds: projectedBounds,
      cacheKey: 'classic-three:' + hash32(cacheSignature).toString(36) + ':' + cacheSignature,
    };
  }

  function compatibilityStatus(now, glyph) {
    if (now < glyph.startTime) return 'waiting';
    if (now <= glyph.endTime) return 'active';
    return 'passed';
  }

  function resolveRipple(model, now, reducedMotion, depthScale) {
    var disabled = !model.ripple || !model.ripple.enabled || reducedMotion;
    var empty = { enabled: false, x: 0, y: 0, z: 0, scale: 0.2, opacity: 0 };
    if (disabled) return empty;
    var target = null;
    var progress = 0;
    for (var index = 0; index < model.ripple.targets.length; index += 1) {
      var candidate = model.ripple.targets[index];
      var start = candidate.startTime;
      var finish = Math.max(start + 0.001, candidate.endTime + 0.36);
      if (now >= start && now <= finish) {
        target = candidate;
        progress = clamp((now - start) / (finish - start), 0, 1, 0);
        break;
      }
    }
    if (!target) return empty;
    var envelope = Math.sin(Math.PI * progress);
    return {
      enabled: true,
      x: target.x,
      y: target.y,
      z: target.z * depthScale,
      scale: 0.2 + (Math.min(model.ripple.maxScale, target.maxScale) - 0.2) * smoothstep(progress),
      opacity: clamp(envelope * 0.72, 0, 0.72, 0),
      groupIndex: target.groupIndex,
    };
  }

  function resolveClassicThreeFrame(model, now, options) {
    options = options || {};
    model = model || { groups: [], glyphs: [], config: {}, ripple: { enabled: false, targets: [] } };
    if (typeof motion.resolveClassicGroupPose !== 'function'
      || typeof motion.resolveClassicGraphemeVisual !== 'function') {
      throw new Error('CLASSIC_THREE_MOTION_UNAVAILABLE');
    }
    now = finite(now, 0);
    var reducedMotion = options.reducedMotion === true;
    var depthScale = reducedMotion ? 0 : clamp(options.depthScale, 0, 1, 1);
    var wordGlow = clamp(model.config && model.config.wordGlow, 0, 1, 0.82);
    var resolvedGlyphs = [];
    var resolvedGroups = model.groups.map(function(group, groupIndex) {
      var pose = motion.resolveClassicGroupPose(group, now, model.renderProfile, { reducedMotion: reducedMotion });
      if (depthScale < 1) {
        pose = Object.assign({}, pose, {
          z: pose.z * depthScale,
          rotationX: pose.rotationX * depthScale,
          rotationY: pose.rotationY * depthScale,
        });
      }
      var wordStatus = pose.phase === 'waiting' ? 'waiting' : pose.phase === 'passed' ? 'passed' : 'active';
      var maxGlow = 0;
      group.localGlyphs.forEach(function(localGlyph) {
        var visual = motion.resolveClassicGraphemeVisual(localGlyph, group, now, model.renderProfile, wordGlow);
        var point = transformLocal(localGlyph, pose);
        maxGlow = Math.max(maxGlow, visual.glow);
        resolvedGlyphs.push({
          key: localGlyph.key,
          char: localGlyph.char,
          groupIndex: groupIndex,
          itemIndex: groupIndex,
          graphemeIndex: localGlyph.graphemeIndex,
          sourceGraphemeIndex: localGlyph.sourceGraphemeIndex,
          x: point.x,
          y: point.y,
          z: point.z,
          rotationX: pose.rotationX,
          rotationY: pose.rotationY,
          rotation: pose.rotation,
          scale: pose.scale,
          width: localGlyph.width,
          height: localGlyph.height,
          opacity: pose.opacity,
          glow: visual.glow,
          progress: visual.highlight,
          status: compatibilityStatus(now, localGlyph),
          wordStatus: wordStatus,
          baseScale: 1,
        });
      });
      return {
        key: group.key,
        text: group.text,
        startTime: group.startTime,
        endTime: group.endTime,
        activeEndTime: group.activeEndTime,
        pose: pose,
        light: { glow: maxGlow, colorReturn: pose.colorReturn },
        localGlyphs: group.localGlyphs,
        projectedBounds: group.projectedBounds,
      };
    });
    var ambientTime = finite(options.ambientTime, 0);
    var breathingStrength = reducedMotion ? 0 : clamp(model.config && model.config.breathing, 0, 1, 1);
    var breathingWave = Math.sin(ambientTime * Math.PI * 0.74);
    var breathingScale = 1 + breathingWave * 0.008 * breathingStrength;
    var breathingY = breathingWave * 6 * finite(model.worldPerPixel, 0.006) * breathingStrength;
    return {
      lineIndex: model.lineIndex,
      groups: resolvedGroups,
      glyphs: resolvedGlyphs,
      translation: model.translation,
      ripple: resolveRipple(model, now, reducedMotion, depthScale),
      group: {
        x: 0,
        y: breathingY,
        z: 0,
        scale: breathingScale,
        breathing: breathingScale,
      },
    };
  }

  return {
    buildClassicThreeModel: buildClassicThreeModel,
    resolveClassicThreeFrame: resolveClassicThreeFrame,
  };
});
