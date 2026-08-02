/*
 * Semantic lyric layout adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function splitGraphemes(text) {
    text = String(text || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function(item) { return item.segment; });
    }
    return Array.from(text);
  }

  function finiteTime(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function normalizeTimeRange(startTime, endTime) {
    var start = finiteTime(startTime, 0);
    var end = finiteTime(endTime, start);
    return { startTime: start, endTime: Math.max(start, end) };
  }

  function buildEvenGraphemeTimings(text, startTime, endTime, wordIndex) {
    var graphemes = splitGraphemes(text);
    if (!graphemes.length) return [];
    var range = normalizeTimeRange(startTime, endTime);
    startTime = range.startTime;
    endTime = range.endTime;
    var duration = endTime - startTime;
    var unitDuration = duration / graphemes.length;
    return graphemes.map(function(char, index) {
      var timing = {
        char: char,
        startTime: startTime + unitDuration * index,
        endTime: index === graphemes.length - 1 ? endTime : startTime + unitDuration * (index + 1),
      };
      if (typeof wordIndex === 'number') timing.wordIndex = wordIndex;
      return timing;
    });
  }

  function buildWordGraphemeTimings(word, wordIndex) {
    word = word || {};
    var range = normalizeTimeRange(word.startTime, word.endTime);
    if (!Array.isArray(word.syllables) || !word.syllables.length) {
      return buildEvenGraphemeTimings(word.text, range.startTime, range.endTime, wordIndex);
    }
    var previousEnd = range.startTime;
    var syllablesValid = word.syllables.every(function(syllable) {
      var startTime = Number(syllable && syllable.startTime);
      var endTime = Number(syllable && syllable.endTime);
      var valid = isFinite(startTime) && isFinite(endTime)
        && startTime >= range.startTime && endTime <= range.endTime
        && endTime >= startTime && startTime >= previousEnd;
      previousEnd = endTime;
      return valid;
    });
    if (!syllablesValid) {
      return buildEvenGraphemeTimings(word.text, range.startTime, range.endTime, wordIndex);
    }
    return word.syllables.reduce(function(timings, syllable) {
      return timings.concat(buildEvenGraphemeTimings(
        syllable && syllable.text,
        syllable && syllable.startTime,
        syllable && syllable.endTime,
        wordIndex
      ));
    }, []);
  }

  function findGraphemeSequence(source, target, fromIndex) {
    if (!target.length) return fromIndex;
    for (var index = fromIndex; index <= source.length - target.length; index += 1) {
      var matched = true;
      for (var targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
        if (source[index + targetIndex] !== target[targetIndex]) {
          matched = false;
          break;
        }
      }
      if (matched) return index;
    }
    return -1;
  }

  function buildLineGraphemeTimeline(line) {
    line = line || {};
    var lineRange = normalizeTimeRange(line.startTime, line.endTime);
    var lineGraphemes = splitGraphemes(line.fullText);
    if (!lineGraphemes.length) return [];
    var words = Array.isArray(line.words) ? line.words : [];
    if (!words.length) {
      return buildEvenGraphemeTimings(line.fullText, lineRange.startTime, lineRange.endTime);
    }

    var timeline = [];
    var cursor = 0;
    var lastResolvedTime = lineRange.startTime;
    words.forEach(function(word, wordIndex) {
      var wordGraphemes = splitGraphemes(word.text);
      if (!wordGraphemes.length) return;
      var wordRange = normalizeTimeRange(word.startTime, word.endTime);
      var wordTimings = buildWordGraphemeTimings(word, wordIndex);
      var wordStartTime = wordTimings.length ? wordTimings[0].startTime : wordRange.startTime;
      var matchedStart = findGraphemeSequence(lineGraphemes, wordGraphemes, cursor);
      var start = matchedStart >= 0 ? matchedStart : cursor;
      var end = Math.min(start + wordGraphemes.length, lineGraphemes.length);

      for (var gapIndex = cursor; gapIndex < start; gapIndex += 1) {
        timeline[gapIndex] = {
          char: lineGraphemes[gapIndex],
          startTime: wordStartTime,
          endTime: wordStartTime,
        };
      }

      for (var localIndex = 0; localIndex < end - start; localIndex += 1) {
        var timing = wordTimings[localIndex]
          || buildEvenGraphemeTimings(wordGraphemes[localIndex] || '', wordRange.startTime, wordRange.endTime, wordIndex)[0];
        if (!timing) continue;
        var timingRange = normalizeTimeRange(timing.startTime, timing.endTime);
        timeline[start + localIndex] = {
          char: lineGraphemes[start + localIndex],
          startTime: timingRange.startTime,
          endTime: timingRange.endTime,
        };
        if (typeof timing.wordIndex === 'number') timeline[start + localIndex].wordIndex = timing.wordIndex;
        lastResolvedTime = Math.max(lastResolvedTime, timingRange.endTime);
      }
      cursor = Math.max(cursor, end);
    });

    for (var index = 0; index < lineGraphemes.length; index += 1) {
      if (timeline[index]) continue;
      timeline[index] = {
        char: lineGraphemes[index],
        startTime: lastResolvedTime,
        endTime: lastResolvedTime,
      };
    }
    return timeline;
  }

  var CJK_REGEX = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  var WHITESPACE_REGEX = /^\s+$/;
  var APOSTROPHE_ONLY_REGEX = /^['’]\s*$/;
  var CONTRACTION_SUFFIX_REGEX = /^(s|t|m|d|ll|re|ve|em)\s*$/i;
  var DIRECT_CONTRACTION_REGEX = /^['’](s|t|m|d|ll|re|ve|em)\s*$/i;
  var TRAILING_APOSTROPHE_REGEX = /['’]\s*$/;
  var TRAILING_WORD_CHAR_REGEX = /[\p{L}\p{N}]$/u;
  var INLINE_CONTRACTION_REGEX = /[\p{L}\p{N}]+['’](s|t|m|d|ll|re|ve|em)/iu;
  var STICKY_TRAILING_PUNCTUATION_REGEX = /^[,.;:!?，。！？、：；）】》」』〉〕］)}\]"'’”’]+$/u;

  function hasCjkText(text) {
    return CJK_REGEX.test(String(text || ''));
  }

  function createSingleWordLayoutUnits(words) {
    return (Array.isArray(words) ? words : []).map(function(word) {
      return {
        text: word.text,
        words: [word],
        startTime: word.startTime,
        endTime: word.endTime,
        isSemantic: false,
      };
    });
  }

  function normalizeWordSegments(value) {
    if (value == null) return null;
    try {
      return Array.from(value, function(item) {
        if (typeof item === 'string') return { segment: item, isWordLike: true };
        return {
          segment: String(item && item.segment || ''),
          isWordLike: item && item.isWordLike,
        };
      });
    } catch (error) {
      return null;
    }
  }

  function getWordSegments(text, segmentWords) {
    if (typeof segmentWords === 'function') {
      try {
        return normalizeWordSegments(segmentWords(text));
      } catch (error) {
        return null;
      }
    }
    if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
    try {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text), function(segment) {
        return { segment: segment.segment, isWordLike: segment.isWordLike };
      });
    } catch (error) {
      return null;
    }
  }

  function appendWordsToUnit(unit, text, words) {
    unit.text += text;
    Array.prototype.push.apply(unit.words, words);
    unit.endTime = words.length ? words[words.length - 1].endTime : unit.endTime;
  }

  function cloneUnit(unit) {
    var clone = {
      text: unit.text,
      words: unit.words.slice(),
      startTime: unit.startTime,
      endTime: unit.endTime,
      isSemantic: unit.isSemantic,
    };
    if (unit.isSticky) clone.isSticky = true;
    return clone;
  }

  function appendUnitToStickyUnit(target, unit) {
    target.text += unit.text;
    Array.prototype.push.apply(target.words, unit.words);
    target.endTime = unit.endTime;
    target.isSticky = true;
  }

  function canAttachToPrevious(text) {
    return TRAILING_WORD_CHAR_REGEX.test(String(text || '').trimEnd());
  }

  function endsWithApostrophe(text) {
    return TRAILING_APOSTROPHE_REGEX.test(String(text || '').trimEnd());
  }

  function isApostropheOnlyUnit(unit) {
    return APOSTROPHE_ONLY_REGEX.test(String(unit.text || '').trim());
  }

  function isContractionSuffixUnit(unit) {
    return CONTRACTION_SUFFIX_REGEX.test(String(unit.text || '').trim());
  }

  function isDirectContractionUnit(unit) {
    return DIRECT_CONTRACTION_REGEX.test(String(unit.text || '').trim());
  }

  function isStickyTrailingPunctuationUnit(unit) {
    return STICKY_TRAILING_PUNCTUATION_REGEX.test(String(unit.text || '').trim());
  }

  function hasAttachedTrailingPunctuation(unit) {
    if (unit.words.length <= 1) return false;
    var lastWord = unit.words[unit.words.length - 1];
    return Boolean(lastWord && isStickyTrailingPunctuationUnit({ text: lastWord.text }));
  }

  function hasInlineContraction(unit) {
    return unit.words.length > 1 && !unit.isSemantic && INLINE_CONTRACTION_REGEX.test(unit.text);
  }

  function mapSegmentsToWords(segments, words) {
    var units = [];
    var wordIndex = 0;
    for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      var segment = segments[segmentIndex];
      var segmentText = segment.segment;
      if (!segmentText || WHITESPACE_REGEX.test(segmentText)) continue;

      var startWordIndex = wordIndex;
      var collectedText = '';
      while (wordIndex < words.length && collectedText.length < segmentText.length) {
        collectedText += words[wordIndex].text;
        wordIndex += 1;
        if (segmentText.indexOf(collectedText) !== 0) return null;
      }
      if (collectedText !== segmentText) return null;

      var segmentWords = words.slice(startWordIndex, wordIndex);
      var firstWord = segmentWords[0];
      var lastWord = segmentWords[segmentWords.length - 1];
      if (!firstWord || !lastWord) return null;
      if (!segment.isWordLike && units.length) {
        appendWordsToUnit(units[units.length - 1], segmentText, segmentWords);
        continue;
      }
      units.push({
        text: segmentText,
        words: segmentWords,
        startTime: firstWord.startTime,
        endTime: lastWord.endTime,
        isSemantic: Boolean(segment.isWordLike && hasCjkText(segmentText) && segmentWords.length > 1),
      });
    }
    if (wordIndex !== words.length || !units.length) return null;
    return units;
  }

  function buildCjkSemanticLayoutUnits(line, segmentWords) {
    var words = line && Array.isArray(line.words) ? line.words : [];
    if (!words.length) return [];
    var fallbackUnits = createSingleWordLayoutUnits(words);
    if (!hasCjkText(line.fullText)) return fallbackUnits;
    var segments = getWordSegments(line.fullText, segmentWords);
    if (!segments) return fallbackUnits;
    return mapSegmentsToWords(segments, words) || fallbackUnits;
  }

  function applyStickyPunctuationLayoutUnits(units) {
    var merged = [];
    for (var index = 0; index < units.length; index += 1) {
      var current = units[index];
      var previous = merged[merged.length - 1];
      if (!previous) {
        merged.push(cloneUnit(current));
        continue;
      }

      var next = units[index + 1];
      if (isApostropheOnlyUnit(current) && next && canAttachToPrevious(previous.text) && isContractionSuffixUnit(next)) {
        appendUnitToStickyUnit(previous, current);
        appendUnitToStickyUnit(previous, next);
        index += 1;
        continue;
      }
      if (isDirectContractionUnit(current) && canAttachToPrevious(previous.text)) {
        appendUnitToStickyUnit(previous, current);
        continue;
      }
      if (isContractionSuffixUnit(current) && endsWithApostrophe(previous.text)) {
        appendUnitToStickyUnit(previous, current);
        continue;
      }
      if (isStickyTrailingPunctuationUnit(current) && canAttachToPrevious(previous.text)) {
        appendUnitToStickyUnit(previous, current);
        continue;
      }
      merged.push(cloneUnit(current));
    }
    return merged.map(function(unit) {
      if (hasAttachedTrailingPunctuation(unit) || hasInlineContraction(unit)) unit.isSticky = true;
      return unit;
    });
  }

  function buildPostLyricLayoutUnits(line, options) {
    line = line || { fullText: '', words: [] };
    options = options || {};
    var rawUnits = options.semantic
      ? buildCjkSemanticLayoutUnits(line, options.segmentWords)
      : createSingleWordLayoutUnits(line.words);
    return options.sticky ? applyStickyPunctuationLayoutUnits(rawUnits) : rawUnits;
  }

  function buildDisplayWordsFromLayoutUnits(units) {
    return (Array.isArray(units) ? units : []).reduce(function(words, unit) {
      if (!unit.isSticky || unit.isSemantic) return words.concat(unit.words);
      words.push({ text: unit.text, startTime: unit.startTime, endTime: unit.endTime });
      return words;
    }, []);
  }

  function isPunctuation(char) {
    return /[，。！？；：、,.!?;:]/.test(char);
  }

  function isLatinWordChar(char) {
    return /[A-Za-z0-9'_\-]/.test(char);
  }

  function splitSemanticChunks(text, maxChars) {
    var chars = splitGraphemes(text);
    var chunks = [];
    var current = '';
    maxChars = Math.max(2, Number(maxChars) || 8);
    function push() {
      if (current) chunks.push(current);
      current = '';
    }
    for (var i = 0; i < chars.length; i += 1) {
      var char = chars[i];
      if (/\s/.test(char)) {
        if (current) {
          current += char;
          if (/[A-Za-z0-9'_\-]\s$/.test(current)) push();
        }
        continue;
      }
      if (isPunctuation(char)) {
        if (/^[\u3400-\u9fff]+$/.test(current)) current += char;
        else {
          push();
          current = char;
        }
        push();
        continue;
      }
      if (isLatinWordChar(char)) {
        if (current && !/[A-Za-z0-9'_\-\s]$/.test(current)) push();
        current += char;
        continue;
      }
      if (current && /[A-Za-z0-9'_\-\s]$/.test(current)) push();
      current += char;
      if (splitGraphemes(current).length >= maxChars) push();
    }
    push();
    return chunks.filter(Boolean);
  }

  function splitSentenceLines(text, maxLines) {
    var chunks = String(text || '').match(/[^，。！？；：、,.!?;:]+[，。！？；：、,.!?;:]?/g) || [];
    chunks = chunks.map(function(value) { return value.trim(); }).filter(Boolean);
    maxLines = Math.max(1, Math.min(4, Math.floor(Number(maxLines) || 4)));
    if (chunks.length <= maxLines) return chunks;
    var lines = [];
    var totalLength = splitGraphemes(text).length;
    var target = Math.max(1, Math.ceil(totalLength / maxLines));
    var current = '';
    chunks.forEach(function(chunk) {
      if (current && splitGraphemes(current + chunk).length > target && lines.length < maxLines - 1) {
        lines.push(current);
        current = chunk;
      } else {
        current += chunk;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function hash32(value) {
    var hash = 2166136261;
    value = String(value || '');
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededRandom(seed) {
    var value = hash32(seed) || 1;
    return function() {
      value += 0x6d2b79f5;
      var t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function createStableWordLayout(line, viewport, seed) {
    line = line || {};
    viewport = viewport || {};
    var tokens = line.words && line.words.length
      ? line.words.map(function(word) { return word.text; })
      : splitSemanticChunks(line.fullText || '', 8);
    var random = seededRandom([seed, line.index, line.fullText, viewport.width, viewport.height].join('|'));
    var count = Math.max(1, tokens.length);
    return tokens.map(function(text, index) {
      var column = index % Math.min(4, count);
      var row = Math.floor(index / Math.min(4, count));
      var rowCount = Math.max(1, Math.ceil(count / Math.min(4, count)));
      return {
        text: text,
        index: index,
        x: Math.max(0, Math.min(1, (column + 0.5) / Math.min(4, count) + (random() - 0.5) * 0.08)),
        y: Math.max(0, Math.min(1, (row + 0.5) / rowCount + (random() - 0.5) * 0.12)),
        rotate: (random() - 0.5) * 8,
        scale: 0.9 + random() * 0.22,
      };
    });
  }

  function createBoundedCache(options) {
    options = options || {};
    var maxEntries = Math.max(1, Math.floor(Number(options.maxEntries) || 32));
    var maxBytes = Math.max(1, Math.floor(Number(options.maxBytes) || 33554432));
    var entries = new Map();
    var bytes = 0;
    function trim() {
      while (entries.size > maxEntries || bytes > maxBytes) {
        var oldest = entries.keys().next().value;
        if (oldest == null) break;
        bytes -= entries.get(oldest).bytes;
        entries.delete(oldest);
      }
    }
    return {
      get: function(key) {
        if (!entries.has(key)) return undefined;
        var entry = entries.get(key);
        entries.delete(key);
        entries.set(key, entry);
        return entry.value;
      },
      set: function(key, value, estimatedBytes) {
        estimatedBytes = Math.max(0, Math.floor(Number(estimatedBytes) || 0));
        if (entries.has(key)) {
          bytes -= entries.get(key).bytes;
          entries.delete(key);
        }
        if (estimatedBytes > maxBytes) {
          trim();
          return false;
        }
        entries.set(key, { value: value, bytes: estimatedBytes });
        bytes += estimatedBytes;
        trim();
        return entries.has(key);
      },
      has: function(key) { return entries.has(key); },
      delete: function(key) {
        if (!entries.has(key)) return false;
        bytes -= entries.get(key).bytes;
        return entries.delete(key);
      },
      clear: function() { entries.clear(); bytes = 0; },
      stats: function() { return { entries: entries.size, bytes: bytes, maxEntries: maxEntries, maxBytes: maxBytes }; },
    };
  }

  function resolveCanvasPixelRatio(viewport, quality, options) {
    viewport = viewport || {};
    options = options || {};
    var width = Math.max(1, Number(viewport.width) || 1);
    var height = Math.max(1, Number(viewport.height) || 1);
    var deviceRatio = Math.max(0.25, Number(viewport.dpr) || 1);
    var ratioCap = quality === 'quality' ? 2 : quality === 'battery' ? 1 : 1.5;
    var defaultBudget = quality === 'battery'
      ? 1280 * 720
      : quality === 'quality'
        ? 1920 * 1080
        : 1600 * 900;
    var pixelBudget = Math.max(65536, Number(options.maxPixels) || defaultBudget);
    var budgetRatio = Math.sqrt(pixelBudget / (width * height));
    return Math.max(0.25, Math.min(deviceRatio, ratioCap, budgetRatio));
  }

  return {
    splitGraphemes: splitGraphemes,
    buildWordGraphemeTimings: buildWordGraphemeTimings,
    buildLineGraphemeTimeline: buildLineGraphemeTimeline,
    buildPostLyricLayoutUnits: buildPostLyricLayoutUnits,
    buildDisplayWordsFromLayoutUnits: buildDisplayWordsFromLayoutUnits,
    splitSemanticChunks: splitSemanticChunks,
    splitSentenceLines: splitSentenceLines,
    hash32: hash32,
    seededRandom: seededRandom,
    createStableWordLayout: createStableWordLayout,
    createBoundedCache: createBoundedCache,
    resolveCanvasPixelRatio: resolveCanvasPixelRatio,
  };
});
