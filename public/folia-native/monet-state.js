/*
 * Monet lyric rail and audio geometry adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricMonetState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, finite(value, fallback)));
  }

  function splitGraphemes(text) {
    text = String(text || '');
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), function(item) { return item.segment; });
    }
    return Array.from(text);
  }

  function buildMonetVisibleEntries(document, currentLineIndex, now, options) {
    options = options || {};
    var lines = document && document.lines || [];
    if (!lines.length) return [];
    currentLineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor(finite(currentLineIndex, 0))));
    var before = Math.max(0, Math.floor(finite(options.before, 2)));
    var after = Math.max(0, Math.floor(finite(options.after, 2)));
    var start = Math.max(0, currentLineIndex - before);
    var end = Math.min(lines.length - 1, currentLineIndex + after);
    var entries = [];
    for (var index = start; index <= end; index += 1) {
      var status = index === currentLineIndex ? 'active' : index < currentLineIndex ? 'passed' : 'waiting';
      if (currentLineIndex < 0) status = now > lines[index].endTime ? 'passed' : now >= lines[index].startTime ? 'active' : 'waiting';
      entries.push({
        key: 'monet:' + index + ':' + lines[index].startTime + ':' + lines[index].fullText,
        line: lines[index],
        index: index,
        offset: index - currentLineIndex,
        status: status,
      });
    }
    return entries;
  }

  function measureMonetGraphemeOffsets(text, measureText) {
    var characters = splitGraphemes(text);
    measureText = typeof measureText === 'function' ? measureText : function(value) { return splitGraphemes(value).length; };
    var offsets = [0];
    for (var index = 1; index <= characters.length; index += 1) {
      offsets.push(Math.max(offsets[index - 1], finite(measureText(characters.slice(0, index).join('')), offsets[index - 1])));
    }
    return offsets;
  }

  function resolveMonetSweepModel(line, now, offsets) {
    line = line || { graphemes: [], startTime: 0, endTime: 0 };
    offsets = Array.isArray(offsets) ? offsets : [0];
    now = finite(now, 0);
    var activeIndex = -1;
    var fillWidth = 0;
    var states = (line.graphemes || []).map(function(character, index) {
      var start = finite(character.startTime, line.startTime);
      var end = Math.max(start + 0.001, finite(character.endTime, line.endTime));
      if (now < start) return 'waiting';
      if (now <= end) {
        activeIndex = index;
        var progress = clamp((now - start) / (end - start), 0, 1, 0);
        fillWidth = finite(offsets[index], 0) + (finite(offsets[index + 1], offsets[index]) - finite(offsets[index], 0)) * progress;
        return 'active';
      }
      fillWidth = finite(offsets[index + 1], fillWidth);
      return 'passed';
    });
    if (now >= line.endTime && offsets.length) fillWidth = offsets[offsets.length - 1];
    return {
      fillWidth: fillWidth,
      totalWidth: offsets.length ? offsets[offsets.length - 1] : 0,
      activeGraphemeIndex: activeIndex,
      states: states,
      glowStart: Math.max(0, fillWidth - 24),
      glowEnd: fillWidth + 10,
    };
  }

  function resolveMonetKeywordColors(text, wordColors) {
    var characters = splitGraphemes(text);
    var colors = characters.map(function() { return ''; });
    var lower = String(text || '').toLowerCase();
    (Array.isArray(wordColors) ? wordColors : []).forEach(function(entry) {
      var word = String(entry && entry.word || '').trim();
      var color = String(entry && entry.color || '').trim();
      if (!word || !/^#[0-9a-f]{6}$/i.test(color)) return;
      var start = lower.indexOf(word.toLowerCase());
      if (start < 0) return;
      var end = start + word.length;
      var codeUnitCursor = 0;
      characters.forEach(function(character, index) {
        var charEnd = codeUnitCursor + character.length;
        if (charEnd > start && codeUnitCursor < end) colors[index] = color;
        codeUnitCursor = charEnd;
      });
    });
    return colors;
  }

  function buildMonetPosterModel(document, track, viewport) {
    document = document || {};
    track = track || {};
    viewport = viewport || { width: 1280, height: 720 };
    var cover = String(track.cover || document.cover || '');
    return {
      title: String(track.title || document.title || 'Monet'),
      artist: String(track.artist || document.artist || 'Mineradio'),
      album: String(track.album || ''),
      portraitUrl: cover,
      backgroundUrl: cover,
      layout: viewport.width >= 900 ? 'poster-wide' : 'poster-compact',
    };
  }

  function sampleSpectrum(spectrum, normalizedIndex) {
    if (!spectrum || spectrum.length <= 6) return 0;
    normalizedIndex = clamp(normalizedIndex, 0, 1, 0);
    var usable = Math.max(1, spectrum.length - 6);
    var center = 6 + Math.expm1(normalizedIndex * Math.log(usable + 1));
    var radius = Math.max(1, Math.round(4 - Math.abs(normalizedIndex - 0.5) * 4));
    var start = Math.max(6, Math.floor(center - radius));
    var end = Math.min(spectrum.length - 1, Math.ceil(center + radius));
    var sum = 0;
    var weights = 0;
    for (var index = start; index <= end; index += 1) {
      var weight = Math.max(0.1, 1 - Math.abs(index - center) / (radius + 1));
      sum += spectrum[index] * weight;
      weights += weight;
    }
    var raw = weights ? sum / weights : 0;
    var floor = 16 + (1 - normalizedIndex) * 12;
    return Math.pow(clamp((raw - floor) / (255 - floor), 0, 1, 0), 1.8 + (1 - normalizedIndex) * 0.4);
  }

  function buildMonetAudioGeometry(spectrum, width, height, options) {
    options = options || {};
    width = Math.max(1, finite(width, 1));
    height = Math.max(1, finite(height, 1));
    var count = Math.max(8, Math.floor(finite(options.count, 72)));
    var energy = clamp(options.energy, 0, 1, 0.5);
    var bars = [];
    var line = [];
    for (var index = 0; index < count; index += 1) {
      var normalized = count === 1 ? 0 : index / (count - 1);
      var envelope = Math.sin(normalized * Math.PI);
      var sample = sampleSpectrum(spectrum, normalized);
      var barHeight = clamp(height * (0.025 + (sample * 0.86 + energy * 0.05) * envelope), 0, height, 0);
      var x = normalized * width;
      bars.push({ x: x, width: Math.max(1, width / count * 0.34), height: barHeight });
      line.push({ x: x, y: height - barHeight });
    }
    return { bars: bars, line: line };
  }

  return {
    splitMonetGraphemes: splitGraphemes,
    buildMonetVisibleEntries: buildMonetVisibleEntries,
    buildMonetPosterModel: buildMonetPosterModel,
    measureMonetGraphemeOffsets: measureMonetGraphemeOffsets,
    resolveMonetSweepModel: resolveMonetSweepModel,
    resolveMonetKeywordColors: resolveMonetKeywordColors,
    buildMonetAudioGeometry: buildMonetAudioGeometry,
  };
});
