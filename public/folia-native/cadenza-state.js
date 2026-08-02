/*
 * Native Cadenza state adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var layout = root && root.MineradioNativeLyricLayout;
  if (typeof module === 'object' && module.exports) layout = require('./layout');
  var api = factory(layout || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCadenzaState = api;
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
    return typeof layout.splitGraphemes === 'function'
      ? layout.splitGraphemes(text)
      : Array.from(String(text || ''));
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
    var value = hash32(seed) || 1;
    return function() {
      value = Math.imul(value ^ value >>> 15, 1 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function semanticItems(line) {
    var chunks = typeof layout.splitSemanticChunks === 'function'
      ? layout.splitSemanticChunks(line.fullText || '', 7)
      : [line.fullText || ''];
    if (!chunks.length) chunks = [line.fullText || ''];
    var total = chunks.reduce(function(sum, chunk) { return sum + splitGraphemes(chunk).length; }, 0) || 1;
    var cursor = 0;
    var span = Math.max(0.001, finite(line.endTime, 0) - finite(line.startTime, 0));
    return chunks.map(function(text, index) {
      var count = splitGraphemes(text).length;
      var item = {
        index: index,
        text: text,
        startTime: line.startTime + span * cursor / total,
        endTime: line.startTime + span * (cursor + count) / total,
        sourceStart: cursor,
      };
      cursor += count;
      return item;
    });
  }

  function timedGraphemes(line, item) {
    var characters = splitGraphemes(item.text);
    var duration = Math.max(0.001, item.endTime - item.startTime);
    return characters.map(function(character, index) {
      var source = line.graphemes && line.graphemes[item.sourceStart + index];
      var startTime = source ? finite(source.startTime, item.startTime) : item.startTime + duration * index / Math.max(1, characters.length);
      var endTime = source ? finite(source.endTime, item.endTime) : item.startTime + duration * (index + 1) / Math.max(1, characters.length);
      return {
        char: character,
        startTime: startTime,
        endTime: Math.max(startTime + 0.001, endTime),
      };
    });
  }

  function buildCadenzaLineLayout(line, viewport, config, measureText) {
    line = line || { index: 0, fullText: '', startTime: 0, endTime: 0, graphemes: [] };
    viewport = viewport || { width: 1280, height: 720 };
    config = config || {};
    measureText = typeof measureText === 'function'
      ? measureText
      : function(text) { return splitGraphemes(text).length * 32; };
    var fontScale = clamp(config.fontScale, 0.65, 1.8, 1.12);
    var widthRatio = clamp(config.widthRatio, 0.42, 0.92, 0.72);
    var motionAmount = clamp(config.motionAmount, 0, 1.6, 1);
    var items = semanticItems(line);
    var fontPx = clamp(viewport.width * 0.062 * fontScale - Math.max(0, splitGraphemes(line.fullText).length - 18) * 0.7, 28, 112);
    var maxWidth = Math.max(180, Math.min(920, viewport.width * widthRatio));
    var gap = clamp(fontPx * 0.18, 8, 24, 14);
    var rows = [];
    var row = [];
    var rowWidth = 0;
    items.forEach(function(item) {
      var width = Math.max(fontPx * 0.28, finite(measureText(item.text, fontPx), splitGraphemes(item.text).length * fontPx * 0.62));
      width = Math.min(maxWidth, width);
      if (row.length && rowWidth + gap + width > maxWidth) {
        rows.push({ items: row, width: rowWidth });
        row = [];
        rowWidth = 0;
      }
      row.push({ item: item, width: width });
      rowWidth += (row.length > 1 ? gap : 0) + width;
    });
    if (row.length) rows.push({ items: row, width: rowWidth });

    var random = randomFor(['cadenza', line.index, line.startTime, line.fullText, Math.round(viewport.width), Math.round(viewport.height)].join('|'));
    var lineHeight = fontPx * 1.08;
    var totalHeight = Math.max(1, rows.length) * lineHeight;
    var heroIndex = items.length ? hash32(line.fullText + ':' + line.index) % items.length : -1;
    var placements = [];
    rows.forEach(function(rowData, rowIndex) {
      var cursor = -rowData.width / 2;
      rowData.items.forEach(function(entry) {
        var item = entry.item;
        var emphasis = item.index === heroIndex ? 1.08 : 0.96 + random() * 0.07;
        var jitterX = (random() - 0.5) * fontPx * 0.24 * motionAmount;
        var jitterY = (random() - 0.5) * fontPx * 0.2 * motionAmount;
        var x = cursor + entry.width / 2 + jitterX;
        var y = -totalHeight / 2 + rowIndex * lineHeight + lineHeight * 0.62 + jitterY;
        placements.push({
          key: 'cadenza:' + line.index + ':' + item.index + ':' + hash32(item.text).toString(36),
          index: item.index,
          text: item.text,
          startTime: item.startTime,
          endTime: Math.max(item.startTime + 0.001, item.endTime),
          x: clamp(x, -viewport.width * 0.5, viewport.width * 0.5, 0),
          y: clamp(y, -viewport.height * 0.5, viewport.height * 0.5, 0),
          width: entry.width,
          fontPx: fontPx,
          scale: emphasis,
          rotate: (random() - 0.5) * 5.5 * motionAmount,
          seed: random(),
          graphemes: timedGraphemes(line, item),
        });
        cursor += entry.width + gap;
      });
    });

    return {
      mode: 'cadenza',
      cacheKey: ['cadenza', line.index, line.fullText, Math.round(viewport.width / 24), Math.round(viewport.height / 24), fontScale.toFixed(3), widthRatio.toFixed(3)].join('|'),
      lineIndex: line.index,
      line: line,
      fontPx: fontPx,
      width: maxWidth,
      height: totalHeight,
      placements: placements,
    };
  }

  function easeOutCubic(value) {
    value = clamp(value, 0, 1, 0);
    return 1 - Math.pow(1 - value, 3);
  }

  function statusAt(item, now) {
    if (now < item.startTime - 0.12) return 'waiting';
    if (now <= item.endTime) return 'active';
    return 'passed';
  }

  function resolveCadenzaLineFrame(model, now, config, audio) {
    model = model || { placements: [], line: { startTime: 0, endTime: 1 } };
    config = config || {};
    audio = audio || {};
    now = finite(now, 0);
    var trailStrength = clamp(config.trails, 0, 1, 0.62);
    var trailCount = Math.round(trailStrength * 6);
    var motionAmount = clamp(config.motionAmount, 0, 1.6, 1);
    var glowIntensity = clamp(config.glowIntensity, 0, 1.5, 1);
    var beat = clamp(audio.beatPulse, 0, 1, 0);
    var resolved = model.placements.map(function(item) {
      var duration = Math.max(0.001, item.endTime - item.startTime);
      var progress = clamp((now - item.startTime) / duration, 0, 1, 0);
      var status = statusAt(item, now);
      var tail = clamp(1 - (now - item.endTime) / 0.9, 0, 1, 0);
      var glow = status === 'active'
        ? clamp(Math.sin(progress * Math.PI) * 0.54 + 0.46, 0, 1, 0) * glowIntensity
        : status === 'passed' ? tail * 0.42 * glowIntensity : 0;
      glow = clamp(glow, 0, 1, 0);
      var bodyMix = status === 'waiting' ? 0.16 : status === 'active' ? easeOutCubic(progress) : 1;
      var phase = now * 1.4 + item.seed * Math.PI * 2;
      var motionX = Math.sin(phase) * 8 * motionAmount * (0.25 + glow * 0.75);
      var motionY = Math.cos(phase * 0.78) * 5 * motionAmount * (0.25 + glow * 0.75);
      var trails = Array.from({ length: trailCount }, function(_, index) {
        var ratio = (index + 1) / Math.max(1, trailCount);
        return {
          x: item.x + motionX * (1 - ratio) - ratio * 12 * motionAmount,
          y: item.y + motionY * (1 - ratio) + ratio * 4,
          alpha: glow * trailStrength * Math.pow(1 - ratio, 1.6) * 0.4,
        };
      });
      return Object.assign({}, item, {
        status: status,
        progress: progress,
        bodyMix: clamp(bodyMix, 0, 1, 0),
        glow: glow,
        pulse: clamp((Math.sin(now * 10 + item.seed * 8) * 0.5 + 0.5) * glow + beat * 0.28, 0, 1, 0),
        drawX: item.x + motionX,
        drawY: item.y + motionY,
        trails: trails,
      });
    });
    var active = resolved.filter(function(item) { return item.status === 'active'; })[0]
      || resolved.filter(function(item) { return item.status === 'passed'; }).slice(-1)[0]
      || resolved[0]
      || { drawX: 0, drawY: 0, width: 1, fontPx: 32, glow: 0, progress: 0 };
    var beamStrength = clamp(config.beam, 0, 1, 0.72);
    var rippleStrength = clamp(config.ripple, 0, 1, 0.58);
    return {
      lineIndex: model.lineIndex,
      placements: resolved,
      beam: {
        x: active.drawX,
        y: active.drawY,
        width: Math.max(active.width * 1.35, active.fontPx * 2),
        alpha: clamp(beamStrength * (0.34 + active.glow * 0.66), 0, 1, 0),
      },
      ripple: {
        x: active.drawX,
        y: active.drawY,
        radius: 18 + active.fontPx * (0.35 + active.progress * 1.35),
        alpha: clamp(rippleStrength * (1 - active.progress) * (0.6 + beat * 0.4), 0, 1, 0),
      },
    };
  }

  return {
    buildCadenzaLineLayout: buildCadenzaLineLayout,
    resolveCadenzaLineFrame: resolveCadenzaLineFrame,
  };
});
