/*
 * Native lyric timing model adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var timing = root && root.MineradioFoliaNativeLyricState;
  if (typeof module === 'object' && module.exports) timing = require('../folia-native-lyric-state');
  var api = factory(timing);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(timing) {
  'use strict';

  timing = timing || {};

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function fallbackLine(raw, index) {
    raw = raw || {};
    var start = finite(raw.t != null ? raw.t : raw.startTime, 0);
    var duration = Math.max(0, finite(raw.duration, 0));
    var text = normalizeText(raw.text || raw.fullText);
    var end = Math.max(start, finite(raw.endTime, start + (duration || Math.max(1.2, text.length * 0.12))));
    return {
      index: index,
      startTime: start,
      endTime: end,
      fullText: text,
      translation: normalizeText(raw.translation),
      words: [{ text: text, startTime: start, endTime: end }],
      renderHints: { timingClass: 'normal', renderEndTime: end + 0.18, lineTransitionMode: 'normal', wordRevealMode: 'normal' },
    };
  }

  function hashText(value) {
    var hash = 2166136261;
    value = String(value || '');
    for (var i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function freezeLine(line) {
    Object.freeze(line.words);
    Object.freeze(line.graphemes);
    Object.freeze(line.renderHints);
    return Object.freeze(line);
  }

  function buildNativeLyricDocument(lines, metadata) {
    metadata = metadata && typeof metadata === 'object' ? metadata : {};
    var normalized = (Array.isArray(lines) ? lines : []).map(function(raw, index) {
      var line = typeof timing.buildNativeLyricLine === 'function'
        ? timing.buildNativeLyricLine(raw || {}, index)
        : fallbackLine(raw, index);
      line.agentId = normalizeText(raw && (raw.agentId || raw.agent || raw.voiceId));
      line.isChorus = !!(raw && (raw.isChorus || raw.chorus));
      line.graphemes = typeof timing.buildGraphemeTimeline === 'function'
        ? timing.buildGraphemeTimeline(line)
        : Array.from(line.fullText || '').map(function(char) { return { char: char, startTime: line.startTime, endTime: line.endTime }; });
      return freezeLine(line);
    });
    var fingerprint = hashText(normalized.map(function(line) {
      return [line.startTime, line.endTime, line.fullText, line.translation].join('|');
    }).join('\n'));
    Object.freeze(normalized);
    return Object.freeze({
      version: 1,
      id: normalizeText(metadata.id || metadata.songId || fingerprint),
      source: normalizeText(metadata.source || 'unknown'),
      title: normalizeText(metadata.title),
      artist: normalizeText(metadata.artist),
      cover: String(metadata.cover || ''),
      fingerprint: fingerprint,
      duration: Math.max(0, finite(metadata.duration, normalized.length ? normalized[normalized.length - 1].endTime : 0)),
      lines: normalized,
    });
  }

  function findActiveLineIndex(document, now, hint) {
    var lines = document && Array.isArray(document.lines) ? document.lines : [];
    if (!lines.length) return -1;
    now = finite(now, 0);
    hint = Math.max(0, Math.min(lines.length - 1, Math.floor(finite(hint, 0))));
    if (now >= lines[hint].startTime && (hint === lines.length - 1 || now < lines[hint + 1].startTime)) return hint;
    var low = 0;
    var high = lines.length - 1;
    var result = -1;
    while (low <= high) {
      var middle = (low + high) >> 1;
      if (lines[middle].startTime <= now) {
        result = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return result;
  }

  function buildNativeLyricFrame(document, input) {
    input = input && typeof input === 'object' ? input : {};
    var now = Math.max(0, finite(input.now, 0));
    var lineIndex = Number.isInteger(input.lineIndex)
      ? input.lineIndex
      : findActiveLineIndex(document, now, input.previousLineIndex);
    var lines = document && document.lines || [];
    var line = lineIndex >= 0 ? lines[lineIndex] || null : null;
    var span = line ? Math.max(0.001, line.endTime - line.startTime) : 1;
    var progress = line ? Math.max(0, Math.min(1, (now - line.startTime) / span)) : 0;
    return {
      now: now,
      playing: input.playing === true,
      lineIndex: lineIndex,
      line: line,
      previousLine: lineIndex > 0 ? lines[lineIndex - 1] : null,
      nextLine: lineIndex >= 0 ? lines[lineIndex + 1] || null : lines[0] || null,
      progress: progress,
      audio: input.audio || {},
      theme: input.theme || {},
      viewport: input.viewport || { width: 0, height: 0, dpr: 1 },
      quality: input.quality || 'balanced',
      reducedMotion: input.reducedMotion === true,
      track: input.track || null,
      config: input.config || null,
      dt: Math.max(0, finite(input.dt, 0)),
      rafDeltaMs: Math.max(0, finite(input.rafDeltaMs, finite(input.dt, 0) * 1000)),
    };
  }

  return {
    buildNativeLyricDocument: buildNativeLyricDocument,
    findActiveLineIndex: findActiveLineIndex,
    buildNativeLyricFrame: buildNativeLyricFrame,
  };
});
