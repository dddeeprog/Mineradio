(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaNativeLyricState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var MICRO_LINE_DURATION_THRESHOLD = 0.10;
  var SHORT_LINE_DURATION_THRESHOLD = 0.18;
  var MICRO_LINE_RENDER_FLOOR = 0.067;

  function finite(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function splitGraphemes(text) {
    text = String(text || '');
    if (!text) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function(item) {
        return item.segment;
      });
    }
    return Array.from(text);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function buildWord(word, lineStart, lineEnd) {
    word = word || {};
    var text = normalizeText(word.text || word.word);
    var start = finite(word.time != null ? word.time : (word.t != null ? word.t : word.start), lineStart);
    var duration = finite(word.duration != null ? word.duration : word.d, Math.max(0, lineEnd - start));
    var end = finite(word.endTime, start + Math.max(0, duration));
    return text ? { text: text, startTime: start, endTime: Math.max(start, end) } : null;
  }

  function buildLineRenderHints(line) {
    line = line || {};
    var start = finite(line.startTime, 0);
    var end = finite(line.endTime, start);
    var rawDuration = Math.max(end - start, 0);
    var timingClass = rawDuration < MICRO_LINE_DURATION_THRESHOLD ? 'micro' : rawDuration < SHORT_LINE_DURATION_THRESHOLD ? 'short' : 'normal';
    var lineTransitionMode = timingClass === 'micro' ? 'none' : timingClass === 'short' ? 'fast' : 'normal';
    var wordRevealMode = timingClass === 'micro' ? 'instant' : timingClass === 'short' ? 'fast' : 'normal';
    var renderEndTime = lineTransitionMode === 'none'
      ? Math.max(end, start + MICRO_LINE_RENDER_FLOOR)
      : Math.max(end, end + (lineTransitionMode === 'fast' ? 0.04 : 0.18));

    return {
      rawDuration: rawDuration,
      timingClass: timingClass,
      renderEndTime: renderEndTime,
      lineTransitionMode: lineTransitionMode,
      wordRevealMode: wordRevealMode,
    };
  }

  function buildNativeLyricLine(line, index) {
    line = line || {};
    var start = finite(line.t != null ? line.t : (line.time != null ? line.time : line.start), 0);
    var duration = finite(line.duration != null ? line.duration : line.d, 0);
    var text = normalizeText(line.text || line.content || line.fullText);
    var fallbackEnd = duration > 0 ? start + duration : start + Math.max(1.2, text.length * 0.12);
    var end = Math.max(start, finite(line.endTime, fallbackEnd));
    var words = Array.isArray(line.words)
      ? line.words.map(function(word) { return buildWord(word, start, end); }).filter(Boolean)
      : [];

    if (!words.length && text) {
      words = [{ text: text, startTime: start, endTime: end }];
    }

    var out = {
      index: Math.max(0, Math.floor(finite(index, 0))),
      startTime: start,
      endTime: end,
      fullText: text,
      translation: normalizeText(line.translation || line.translated || line.tl),
      words: words,
      fallback: line.fallback === true,
    };
    out.renderHints = buildLineRenderHints(out);
    return out;
  }

  function buildGraphemeTimeline(line) {
    var fullText = line && line.fullText || '';
    var graphemes = splitGraphemes(fullText);
    if (!line || !graphemes.length) return [];

    var timeline = new Array(graphemes.length);
    var cursor = 0;
    var lastTime = line.startTime;

    (line.words || []).forEach(function(word, wordIndex) {
      var wordChars = splitGraphemes(word.text);
      var match = fullText.indexOf(word.text, graphemes.slice(0, cursor).join('').length);
      if (match < 0) match = graphemes.slice(0, cursor).join('').length;
      var startIndex = splitGraphemes(fullText.slice(0, match)).length;

      for (var gap = cursor; gap < startIndex && gap < graphemes.length; gap += 1) {
        timeline[gap] = {
          char: graphemes[gap],
          startTime: word.startTime,
          endTime: word.startTime,
          wordIndex: wordIndex,
        };
      }

      var unit = Math.max(0, word.endTime - word.startTime) / Math.max(1, wordChars.length);
      for (var i = 0; i < wordChars.length && startIndex + i < timeline.length; i += 1) {
        timeline[startIndex + i] = {
          char: graphemes[startIndex + i],
          startTime: word.startTime + unit * i,
          endTime: word.startTime + unit * (i + 1),
          wordIndex: wordIndex,
        };
        lastTime = timeline[startIndex + i].endTime;
      }
      cursor = Math.max(cursor, startIndex + wordChars.length);
    });

    for (var j = 0; j < graphemes.length; j += 1) {
      if (!timeline[j]) {
        timeline[j] = { char: graphemes[j], startTime: lastTime, endTime: lastTime };
      }
    }
    return timeline;
  }

  function resolveLineStatus(line, now) {
    if (!line) return 'waiting';
    if (now < line.startTime) return 'waiting';
    if (now <= ((line.renderHints && line.renderHints.renderEndTime) || line.endTime)) return 'active';
    return 'passed';
  }

  function resolveWordStatus(word, now) {
    if (!word) return 'waiting';
    if (now < word.startTime) return 'waiting';
    if (now <= word.endTime) return 'active';
    return 'passed';
  }

  return {
    splitGraphemes: splitGraphemes,
    buildNativeLyricLine: buildNativeLyricLine,
    buildLineRenderHints: buildLineRenderHints,
    buildGraphemeTimeline: buildGraphemeTimeline,
    resolveLineStatus: resolveLineStatus,
    resolveWordStatus: resolveWordStatus,
  };
});
