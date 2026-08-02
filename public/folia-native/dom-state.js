/*
 * Classic, Partita and Tilt lyric models adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var layout = root && root.MineradioNativeLyricLayout;
  if (typeof module === 'object' && module.exports) layout = require('./layout');
  var api = factory(layout || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricDomState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(layout) {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function splitGraphemes(text) {
    return typeof layout.splitGraphemes === 'function' ? layout.splitGraphemes(text) : Array.from(String(text || ''));
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

  function randomFor(seed) {
    if (typeof layout.seededRandom === 'function') return layout.seededRandom(seed);
    var value = hash32(seed);
    return function() { value = Math.imul(value ^ value >>> 15, 1 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  }

  function smoothstep(value) {
    value = clamp(value, 0, 1, 0);
    return value * value * (3 - 2 * value);
  }

  function classicIntensity(value) {
    value = String(value || 'normal');
    return value === 'calm' || value === 'chaotic' ? value : 'normal';
  }

  function classicRenderProfile(line) {
    line = line || {};
    var hints = line.renderHints || {};
    var reveal = String(hints.wordRevealMode || 'normal');
    if (reveal !== 'fast' && reveal !== 'instant') reveal = 'normal';
    var transition = String(hints.lineTransitionMode || 'normal');
    if (transition !== 'fast' && transition !== 'none') transition = 'normal';
    var lineEnd = Math.max(finite(line.startTime, 0), finite(line.endTime, line.startTime || 0));
    return {
      lineRenderEndTime: Math.max(lineEnd, finite(hints.renderEndTime, lineEnd)),
      lineTransitionMode: transition,
      wordRevealMode: reveal,
      wordLookahead: reveal === 'instant' ? 0.03 : reveal === 'fast' ? 0.08 : 0.15,
    };
  }

  function timedGraphemes(text, startTime, endTime, sourceTimings, sourceStartIndex) {
    var characters = splitGraphemes(text);
    var span = Math.max(0.001, endTime - startTime);
    return characters.map(function(character, index) {
      var source = sourceTimings && sourceTimings[sourceStartIndex + index];
      return {
        char: character,
        startTime: source ? finite(source.startTime, startTime) : startTime + span * index / Math.max(1, characters.length),
        endTime: source ? Math.max(finite(source.startTime, startTime), finite(source.endTime, endTime)) : startTime + span * (index + 1) / Math.max(1, characters.length),
      };
    });
  }

  function semanticItems(line) {
    var words = Array.isArray(line.words) ? line.words : [];
    if (words.length > 1 || (words.length === 1 && words[0].text !== line.fullText)) {
      return words.map(function(word) { return { text: word.text, startTime: word.startTime, endTime: word.endTime }; });
    }
    var chunks = typeof layout.splitSemanticChunks === 'function'
      ? layout.splitSemanticChunks(line.fullText, 8)
      : [line.fullText];
    var total = chunks.reduce(function(sum, chunk) { return sum + splitGraphemes(chunk).length; }, 0) || 1;
    var cursor = 0;
    var span = Math.max(0.001, line.endTime - line.startTime);
    return chunks.map(function(text) {
      var count = splitGraphemes(text).length;
      var item = {
        text: text,
        startTime: line.startTime + span * cursor / total,
        endTime: line.startTime + span * (cursor + count) / total,
      };
      cursor += count;
      return item;
    });
  }

  function buildClassicLineModel(line, viewport, config) {
    line = line || { index: 0, fullText: '', startTime: 0, endTime: 0, words: [], graphemes: [], renderHints: {} };
    viewport = viewport || { width: 1280, height: 720 };
    config = config || {};
    var intensity = classicIntensity(config.intensity);
    var chaotic = intensity === 'chaotic';
    var calm = intensity === 'calm';
    var spread = clamp(config.spread, 0, 1, 0.72);
    var random = randomFor(['classic', line.index, line.startTime, line.fullText, viewport.width, viewport.height].join('|'));
    var justifyOptions = calm ? ['center'] : ['flex-start', 'center', 'flex-end', 'space-around', 'space-between'];
    var alignOptions = calm ? ['center'] : ['flex-start', 'center', 'flex-end'];
    var lineLayout = {
      intensity: intensity,
      justifyContent: justifyOptions[Math.floor(random() * justifyOptions.length)],
      alignItems: alignOptions[Math.floor(random() * alignOptions.length)],
      perspective: chaotic ? 500 + Math.round(random() * 500) : 1000,
    };
    var interlude = line.fullText === '......';
    var baseSpread = calm ? 0 : (chaotic ? 84 : 28) * spread;
    var baseRotate = calm ? 0 : chaotic ? 30 : 5;
    var enableWordRotation = config.enableWordRotation !== false;
    var useLegacyLayout = config.useLegacyLayout === true;
    var wordSpacing = clamp(config.wordSpacing, 0, 2, 0.7);
    var wordGlow = clamp(config.wordGlow, 0, 1, 0.82);
    var fontSize = Math.max(12, finite(config.fontSize, viewport.width < 640 ? 42 : viewport.width < 1000 ? 56 : 72));
    var measureText = typeof config.measureText === 'function'
      ? config.measureText
      : function(text) { return splitGraphemes(text).length * fontSize * 0.65; };
    var sourceCursor = 0;
    var items = semanticItems(line).map(function(item, index) {
      var count = splitGraphemes(item.text).length;
      var x = interlude ? 0 : (random() - 0.5) * baseSpread * 2;
      var y = interlude ? (random() - 0.5) * 15 : (random() - 0.5) * baseSpread * 2;
      var rotate = interlude || !enableWordRotation ? 0 : (random() - 0.5) * baseRotate * 2;
      var scale = interlude ? 1.5 : chaotic ? 0.8 + random() * 0.6 : 1.1 + random() * 0.2;
      var result = {
        key: 'classic:' + line.index + ':' + index + ':' + hash32(item.text).toString(36),
        text: item.text,
        startTime: item.startTime,
        endTime: Math.max(item.startTime + 0.001, item.endTime),
        x: x,
        y: y,
        rotate: rotate,
        scale: scale,
        entryX: x + Math.sin(y) * 100,
        entryY: y + Math.cos(x) * 50,
        entryRotate: enableWordRotation ? rotate + 20 : 0,
        passedRotate: enableWordRotation ? (random() - 0.5) * 45 : 0,
        passedOpacity: chaotic ? 0.9 : 0.82,
        rippleScale: 1.5 + random() * 2,
        measuredWidth: Math.max(0, finite(measureText(item.text), count * fontSize * 0.65)),
        graphemes: timedGraphemes(item.text, item.startTime, item.endTime, line.graphemes, sourceCursor),
      };
      sourceCursor += count;
      return result;
    });
    items.forEach(function(item, index) {
      if (useLegacyLayout) {
        item.marginRight = interlude ? '48px' : '12.8px';
        return;
      }
      var next = items[index + 1] || null;
      var activeScale = item.scale * 1.4;
      var nextScale = next ? next.scale * 1.4 : 1;
      var currentOverflow = item.measuredWidth * Math.max(0, activeScale - 1) / 2;
      var nextOverflow = next ? next.measuredWidth * Math.max(0, nextScale - 1) / 2 : 0;
      var offsetDifference = next ? item.x - next.x : 0;
      var gap = fontSize * 0.05;
      var minimum = (chaotic ? fontSize * 0.08 : fontSize * 0.12) * wordSpacing;
      var margin = Math.max(minimum, (currentOverflow + nextOverflow + offsetDifference + gap) * wordSpacing);
      item.marginRight = Math.max(0, margin).toFixed(1) + 'px';
    });
    return {
      mode: 'classic',
      lineIndex: line.index,
      line: line,
      renderHints: line.renderHints || {},
      renderProfile: classicRenderProfile(line),
      lineLayout: lineLayout,
      intensity: intensity,
      useLegacyLayout: useLegacyLayout,
      wordGlow: wordGlow,
      breathing: clamp(config.breathing, 0, 2, 1),
      chorusRipple: config.chorusRipple !== false,
      isChorus: line.isChorus === true,
      items: items,
    };
  }

  function statusAt(startTime, endTime, now, lookahead) {
    if (now < startTime - lookahead) return 'waiting';
    if (now <= endTime) return 'active';
    return 'passed';
  }

  function classicWordActiveEnd(item, profile) {
    if (profile.wordRevealMode === 'instant') return profile.lineRenderEndTime;
    if (profile.wordRevealMode === 'fast') {
      return Math.min(profile.lineRenderEndTime, Math.max(item.endTime, item.startTime + 0.12));
    }
    return item.endTime;
  }

  function classicGraphemeGlow(character, item, profile, now, strength) {
    strength = clamp(strength, 0, 1, 0.82);
    if (strength <= 0 || now < character.startTime) return 0;
    var charDuration = Math.max(0.001, character.endTime - character.startTime);
    var duration;
    var peak;
    if (profile.wordRevealMode === 'instant') {
      duration = Math.min(0.12, Math.max(0.08, classicWordActiveEnd(item, profile) - item.startTime));
      peak = 0.35;
    } else if (profile.wordRevealMode === 'fast') {
      duration = Math.min(0.2, Math.max(0.12, classicWordActiveEnd(item, profile) - item.startTime));
      peak = 0.4;
    } else {
      duration = Math.min(2.4, Math.max(0.18, charDuration * 6));
      peak = 0.3;
    }
    var progress = (now - character.startTime) / Math.max(0.001, duration);
    if (progress < 0 || progress >= 1) return 0;
    var envelope = progress <= peak
      ? smoothstep(progress / Math.max(0.001, peak))
      : 1 - smoothstep((progress - peak) / Math.max(0.001, 1 - peak));
    return clamp(envelope * strength, 0, strength, 0);
  }

  function resolveClassicLineFrame(model, now) {
    model = model || { items: [], renderHints: {} };
    now = finite(now, 0);
    var profile = model.renderProfile || classicRenderProfile(model.line || { renderHints: model.renderHints || {} });
    return {
      lineIndex: model.lineIndex,
      items: model.items.map(function(item) {
        var activeEndTime = classicWordActiveEnd(item, profile);
        return Object.assign({}, item, {
          status: statusAt(item.startTime, activeEndTime, now, profile.wordLookahead),
          graphemes: item.graphemes.map(function(character) {
            return Object.assign({}, character, {
              status: statusAt(character.startTime, character.endTime, now, 0.015),
              glow: classicGraphemeGlow(character, item, profile, now, model.wordGlow),
            });
          }),
        });
      }),
    };
  }

  function buildPartitaLineModel(line, viewport, config) {
    line = line || { index: 0, fullText: '', startTime: 0, endTime: 0 };
    viewport = viewport || { width: 1280, height: 720 };
    config = config || {};
    var chunks = typeof layout.splitSemanticChunks === 'function' ? layout.splitSemanticChunks(line.fullText, 7) : [line.fullText];
    if (!chunks.length) chunks = [line.fullText || ''];
    var requestedColumns = Math.round(clamp(config.columns, 2, 5, 3));
    var columnCount = Math.max(1, Math.min(requestedColumns, Math.ceil(chunks.length / Math.max(1, Math.floor(viewport.height * 0.62 / 88)))));
    var stagger = clamp(config.stagger, 0, 1, 0.55);
    var random = randomFor(['partita', line.index, line.fullText, viewport.width, viewport.height, columnCount].join('|'));
    var timelineCursor = 0;
    var rows = chunks.map(function(text, index) {
      var magnitude = (14 + random() * 46) * (0.35 + stagger * 0.65);
      var characterCount = splitGraphemes(text).length;
      var row = {
        key: 'partita:' + line.index + ':' + index,
        text: text,
        column: index % columnCount,
        row: Math.floor(index / columnCount),
        offsetX: (index % 2 === 0 ? -1 : 1) * magnitude,
        offsetY: (random() - 0.5) * 10,
        rotate: (random() - 0.5) * 4 * stagger,
        characters: timedGraphemes(text, line.startTime, line.endTime, line.graphemes, timelineCursor),
      };
      timelineCursor += characterCount;
      return row;
    });
    var columns = Array.from({ length: columnCount }, function(_, column) {
      return rows.filter(function(row) { return row.column === column; });
    });
    return {
      mode: 'partita',
      lineIndex: line.index,
      line: line,
      cacheKey: ['partita', line.index, line.fullText, Math.round(viewport.height / 24), columnCount, stagger.toFixed(2)].join('|'),
      rows: rows,
      columns: columns,
    };
  }

  function segmentCharacters(line, segments) {
    var timeline = line.graphemes || [];
    var timelineCursor = 0;
    return segments.map(function(segment) {
      var characters = splitGraphemes(segment.text).map(function(char, index) {
        var timing = timeline[timelineCursor + index];
        return {
          char: char,
          index: timelineCursor + index,
          startTime: timing ? timing.startTime : line.startTime,
          endTime: timing ? timing.endTime : line.endTime,
        };
      });
      timelineCursor += characters.length;
      return Object.assign({}, segment, { characters: characters });
    });
  }

  function buildTiltLineModel(line, viewport, config) {
    line = line || { index: 0, fullText: '', startTime: 0, endTime: 0, graphemes: [] };
    viewport = viewport || { width: 1280, height: 720 };
    config = config || {};
    var maxLines = Math.round(clamp(config.maxLines, 1, 4, 4));
    var textLength = splitGraphemes(line.fullText.replace(/\s/g, '')).length;
    var targetLines = Math.max(1, Math.min(maxLines, Math.ceil(textLength / 12)));
    var pieces = typeof layout.splitSentenceLines === 'function'
      ? layout.splitSentenceLines(line.fullText, targetLines)
      : [line.fullText];
    if (!pieces.length) pieces = [line.fullText || ''];
    var emphasisIndex = hash32(['tilt', line.index, line.startTime, line.fullText].join('|')) % pieces.length;
    var segments = segmentCharacters(line, pieces.map(function(text, index) {
      return { text: text, isEmphasis: index === emphasisIndex, index: index };
    }));
    var measureText = typeof config.measureText === 'function'
      ? config.measureText
      : function(text) { return splitGraphemes(text).length * 62; };
    var availableWidth = Math.max(160, viewport.width - 64);
    var widest = segments.reduce(function(maximum, segment) { return Math.max(maximum, finite(measureText(segment.text), 0)); }, 0);
    var scale = widest > availableWidth ? Math.max(0.36, availableWidth / widest) : 1;
    return {
      mode: 'tilt',
      lineIndex: line.index,
      line: line,
      scale: scale,
      segments: segments,
    };
  }

  function pulseAt(now, startTime, endTime) {
    var rawDuration = Math.max(0.05, endTime - startTime);
    var duration = Math.min(0.9, Math.max(0.2, rawDuration));
    var elapsed = now - startTime;
    if (elapsed < 0) return 0;
    if (elapsed <= duration) return Math.sin(elapsed / duration * Math.PI);
    return Math.max(0.25, 1 - (elapsed - duration) / Math.max(0.3, duration * 1.2)) * 0.25;
  }

  function resolveTiltCharacterFrame(model, now, config) {
    model = model || { segments: [] };
    config = config || {};
    var strength = clamp(config.pulse, 0, 1, 0.52);
    return {
      lineIndex: model.lineIndex,
      segments: model.segments.map(function(segment) {
        return Object.assign({}, segment, {
          characters: segment.characters.map(function(character) {
            var pulse = clamp(pulseAt(now, character.startTime, character.endTime) * strength, 0, 1, 0);
            return Object.assign({}, character, {
              pulse: pulse,
              shift: (character.index % 2 === 0 ? -1 : 1) * (3 + pulse * 9),
            });
          }),
        });
      }),
    };
  }

  return {
    resolveClassicLineRenderProfile: classicRenderProfile,
    getClassicWordActiveEndTime: classicWordActiveEnd,
    buildClassicLineModel: buildClassicLineModel,
    resolveClassicLineFrame: resolveClassicLineFrame,
    buildPartitaLineModel: buildPartitaLineModel,
    buildTiltLineModel: buildTiltLineModel,
    resolveTiltCharacterFrame: resolveTiltCharacterFrame,
  };
});
