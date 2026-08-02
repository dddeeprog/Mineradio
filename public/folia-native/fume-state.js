/*
 * Native Fume article, printing and camera state adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var layout = root && root.MineradioNativeLyricLayout;
  if (typeof module === 'object' && module.exports) layout = require('./layout');
  var api = factory(layout || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricFumeState = api;
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

  function countText(text) {
    return splitGraphemes(String(text || '').replace(/\s/g, '')).length;
  }

  function chooseHeroIndex(lines) {
    var natural = -1;
    lines.forEach(function(line, index) {
      var count = countText(line.fullText);
      if (natural < 0 && line.isChorus && count >= 4 && count <= 32) natural = index;
    });
    if (natural >= 0) return natural;
    var bestIndex = -1;
    var bestScore = -Infinity;
    lines.forEach(function(line, index) {
      var count = countText(line.fullText);
      if (!count || count > 38) return;
      var center = 1 - Math.abs(index - (lines.length - 1) * 0.5) / Math.max(1, lines.length * 0.5);
      var length = count >= 6 && count <= 24 ? 1 : 0.45;
      var score = center * 0.65 + length * 0.35 + (hash32(line.fullText + ':' + index) % 100) / 10000;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex >= 0 ? bestIndex : 0;
  }

  function defaultMeasure(text, fontPx) {
    return splitGraphemes(text).length * fontPx * 0.58;
  }

  function wrapText(text, maxWidth, fontPx, measureText) {
    var graphemes = splitGraphemes(text);
    if (!graphemes.length) return [{ text: '', start: 0, end: 0, width: 0 }];
    var lines = [];
    var start = 0;
    var current = '';
    graphemes.forEach(function(character, index) {
      var candidate = current + character;
      if (current && measureText(candidate, fontPx) > maxWidth) {
        lines.push({ text: current, start: start, end: index, width: measureText(current, fontPx) });
        current = character;
        start = index;
      } else {
        current = candidate;
      }
    });
    if (current || !lines.length) lines.push({ text: current, start: start, end: graphemes.length, width: measureText(current, fontPx) });
    return lines;
  }

  function chooseFontPx(line, variant, width, config, measureText) {
    var heroScale = clamp(config.heroScale, 0.7, 1.5, 1);
    var min = variant === 'hero' ? 24 : 15;
    var max = variant === 'hero' ? 64 : 31;
    var fontPx = variant === 'hero' ? 48 * heroScale : 24;
    while (fontPx > min && measureText(line.fullText, fontPx) > width * (variant === 'hero' ? 1.8 : 1.25)) fontPx -= 1;
    return clamp(fontPx, min, max, min);
  }

  function buildFumeArticleLayout(document, viewport, config, measureText) {
    document = document || { id: '', fingerprint: '', lines: [] };
    viewport = viewport || { width: 1280, height: 720 };
    config = config || {};
    measureText = typeof measureText === 'function' ? measureText : defaultMeasure;
    var lines = Array.isArray(document.lines) ? document.lines : [];
    var columns = Math.round(clamp(config.columns, 2, 5, 3));
    var gutter = clamp(viewport.width * 0.032, 32, 72, 48);
    var paperPadding = clamp(viewport.width * 0.07, 56, 144, 84);
    var columnWidth = clamp((Math.max(viewport.width, 900) - paperPadding * 2 - gutter * (columns - 1)) / columns, 230, 460, 320);
    var columnHeights = Array.from({ length: columns }, function() { return paperPadding; });
    var heroIndex = chooseHeroIndex(lines);
    var blocks = [];

    lines.forEach(function(line, index) {
      var variant = index === heroIndex ? 'hero' : 'body';
      var span = variant === 'hero' && columns >= 3 ? 2 : 1;
      var selectedColumn = 0;
      var selectedY = Infinity;
      for (var column = 0; column <= columns - span; column += 1) {
        var candidateY = Math.max.apply(Math, columnHeights.slice(column, column + span));
        if (candidateY < selectedY) {
          selectedY = candidateY;
          selectedColumn = column;
        }
      }
      var width = columnWidth * span + gutter * (span - 1);
      var innerWidth = Math.max(80, width - (variant === 'hero' ? 36 : 24));
      var fontPx = chooseFontPx(line, variant, innerWidth, config, measureText);
      var lineHeight = fontPx * (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(line.fullText) ? 1.18 : 1.1);
      var renderLines = wrapText(line.fullText, innerWidth, fontPx, measureText);
      var height = Math.max(lineHeight + 24, renderLines.length * lineHeight + (variant === 'hero' ? 44 : 30));
      var x = paperPadding + selectedColumn * (columnWidth + gutter);
      var y = selectedY;
      var graphemes = (line.graphemes || []).map(function(item) {
        return {
          char: item.char,
          startTime: finite(item.startTime, line.startTime),
          endTime: Math.max(finite(item.startTime, line.startTime) + 0.001, finite(item.endTime, line.endTime)),
        };
      });
      var block = {
        key: 'fume:' + document.fingerprint + ':' + index,
        index: index,
        sourceLineIndex: line.index == null ? index : line.index,
        column: selectedColumn,
        columnSpan: span,
        variant: variant,
        line: line,
        text: line.fullText,
        translation: line.translation || '',
        x: x,
        y: y,
        width: width,
        height: height,
        innerWidth: innerWidth,
        fontPx: fontPx,
        lineHeight: lineHeight,
        renderLines: renderLines,
        graphemes: graphemes,
        snapshotKey: [document.fingerprint, index, variant, Math.round(width), Math.round(fontPx * 10)].join('|'),
      };
      blocks.push(block);
      for (var usedColumn = selectedColumn; usedColumn < selectedColumn + span; usedColumn += 1) {
        columnHeights[usedColumn] = y + height + clamp(fontPx * 0.9, 28, 64, 42);
      }
    });

    var width = paperPadding * 2 + columns * columnWidth + (columns - 1) * gutter;
    var height = Math.max(viewport.height, Math.max.apply(Math, columnHeights.concat([paperPadding])) + paperPadding * 0.45);
    var blockBySourceLineIndex = {};
    blocks.forEach(function(block, index) { blockBySourceLineIndex[block.sourceLineIndex] = index; });
    var lastRenderEndTime = lines.length
      ? Math.max.apply(Math, lines.map(function(line) { return finite(line.renderHints && line.renderHints.renderEndTime, line.endTime); }))
      : 0;
    return {
      mode: 'fume',
      key: ['fume', document.fingerprint || document.id, Math.round(viewport.width / 24), Math.round(viewport.height / 24), columns, clamp(config.heroScale, 0.7, 1.5, 1).toFixed(3)].join('|'),
      viewport: { width: viewport.width, height: viewport.height },
      columns: columns,
      columnWidth: columnWidth,
      gutter: gutter,
      paperPadding: paperPadding,
      width: width,
      height: height,
      blocks: blocks,
      blockBySourceLineIndex: blockBySourceLineIndex,
      chronologicalBlockIndexes: blocks.map(function(_, index) { return index; }),
      lastRenderEndTime: lastRenderEndTime,
    };
  }

  function resolveFumePrintedProgress(block, now) {
    block = block || { graphemes: [], line: { startTime: 0, endTime: 0 } };
    now = finite(now, 0);
    var graphemes = block.graphemes || [];
    if (!graphemes.length || now < block.line.startTime) return { count: 0, progress: 0, ratio: 0 };
    if (now >= block.line.endTime) return { count: graphemes.length, progress: graphemes.length, ratio: graphemes.length ? 1 : 0 };
    var progress = 0;
    for (var index = 0; index < graphemes.length; index += 1) {
      var timing = graphemes[index];
      if (now < timing.startTime) break;
      if (now >= timing.endTime) {
        progress = index + 1;
        continue;
      }
      progress = index + clamp((now - timing.startTime) / Math.max(0.001, timing.endTime - timing.startTime), 0, 1, 0);
      break;
    }
    return {
      count: Math.max(0, Math.min(graphemes.length, Math.floor(progress + 0.000001))),
      progress: clamp(progress, 0, graphemes.length, 0),
      ratio: graphemes.length ? clamp(progress / graphemes.length, 0, 1, 0) : 0,
    };
  }

  function resolveOverview(article) {
    var viewport = article.viewport || { width: 1280, height: 720 };
    var fit = Math.min(viewport.width / Math.max(article.width, 1), viewport.height / Math.max(article.height, 1)) * 0.9;
    return {
      x: article.width * 0.5,
      y: article.height * 0.5,
      scale: clamp(fit, 0.22, 0.72, 0.5),
    };
  }

  function resolveFumeCameraFrame(article, input, config) {
    article = article || { blocks: [], blockBySourceLineIndex: {}, viewport: { width: 1280, height: 720 }, width: 1, height: 1, lastRenderEndTime: 0 };
    input = input || {};
    config = config || {};
    var mode = config.cameraMode === 'step' || config.cameraTrackingMode === 'stepped' ? 'step' : 'smooth';
    var now = finite(input.now, 0);
    var overview = article.blocks.length === 0 || now >= finite(article.lastRenderEndTime, 0) + 0.28;
    var target;
    if (overview) {
      target = resolveOverview(article);
    } else {
      var blockIndex = article.blockBySourceLineIndex && article.blockBySourceLineIndex[input.lineIndex];
      if (blockIndex == null) blockIndex = Math.max(0, Math.min(article.blocks.length - 1, Math.floor(finite(input.lineIndex, 0))));
      var block = article.blocks[blockIndex] || article.blocks[0];
      var printed = resolveFumePrintedProgress(block, now);
      var offset = mode === 'step' ? Math.floor(printed.progress) : printed.progress;
      var ratio = block.graphemes.length ? clamp(offset / block.graphemes.length, 0, 1, 0) : 0.5;
      var lineCount = Math.max(1, block.renderLines.length);
      var lineIndex = Math.min(lineCount - 1, Math.floor(ratio * lineCount));
      var line = block.renderLines[lineIndex] || { start: 0, end: block.graphemes.length };
      var localSpan = Math.max(1, line.end - line.start);
      var localRatio = clamp((offset - line.start) / localSpan, 0, 1, 0);
      var minSide = Math.max(1, Math.min(article.viewport.width, article.viewport.height));
      target = {
        x: block.x + 12 + block.innerWidth * localRatio,
        y: block.y + 15 + block.lineHeight * (lineIndex + 0.5),
        scale: clamp(minSide * 0.115 / Math.max(block.lineHeight, 1), 0.88, 2.2, 1),
      };
    }
    var previous = input.previous || target;
    var speed = clamp(config.cameraSpeed, 0.35, 2.5, 1);
    var dt = clamp(input.dt, 0, 0.1, 1 / 60);
    var amount = overview ? 1 - Math.exp(-dt * 3.8 * speed) : 1 - Math.exp(-dt * 10 * speed);
    return {
      mode: mode,
      overview: overview,
      targetX: target.x,
      targetY: target.y,
      targetScale: target.scale,
      x: finite(previous.x, target.x) + (target.x - finite(previous.x, target.x)) * amount,
      y: finite(previous.y, target.y) + (target.y - finite(previous.y, target.y)) * amount,
      scale: finite(previous.scale, target.scale) + (target.scale - finite(previous.scale, target.scale)) * amount,
    };
  }

  function buildFumePreheatQueue(article, currentLineIndex, limit) {
    article = article || { blocks: [] };
    limit = Math.max(0, Math.floor(finite(limit, 6)));
    return article.blocks.map(function(block, index) {
      return { index: index, distance: Math.abs(block.sourceLineIndex - currentLineIndex) };
    }).filter(function(item) {
      return article.blocks[item.index].sourceLineIndex !== currentLineIndex;
    }).sort(function(left, right) {
      return left.distance - right.distance || left.index - right.index;
    }).slice(0, limit).map(function(item) { return item.index; });
  }

  function createFumeSnapshotCache(options) {
    options = options || {};
    var maxEntries = Math.max(1, Math.floor(finite(options.maxEntries, 24)));
    var maxBytes = Math.max(1, Math.floor(finite(options.maxBytes, 33554432)));
    var dispose = typeof options.dispose === 'function' ? options.dispose : function() {};
    var entries = new Map();
    var bytes = 0;

    function remove(key) {
      if (!entries.has(key)) return false;
      var entry = entries.get(key);
      entries.delete(key);
      bytes -= entry.bytes;
      dispose(entry.value);
      return true;
    }

    function trim() {
      while (entries.size > maxEntries || bytes > maxBytes) {
        var oldest = entries.keys().next().value;
        if (oldest == null) break;
        remove(oldest);
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
        estimatedBytes = Math.max(0, Math.floor(finite(estimatedBytes, 0)));
        if (entries.has(key)) remove(key);
        if (estimatedBytes > maxBytes) {
          dispose(value);
          return false;
        }
        entries.set(key, { value: value, bytes: estimatedBytes });
        bytes += estimatedBytes;
        trim();
        return entries.has(key);
      },
      has: function(key) { return entries.has(key); },
      delete: remove,
      clear: function() {
        Array.from(entries.keys()).forEach(remove);
        bytes = 0;
      },
      stats: function() { return { entries: entries.size, bytes: bytes, maxEntries: maxEntries, maxBytes: maxBytes }; },
    };
  }

  return {
    buildFumeArticleLayout: buildFumeArticleLayout,
    resolveFumePrintedProgress: resolveFumePrintedProgress,
    resolveFumeCameraFrame: resolveFumeCameraFrame,
    buildFumePreheatQueue: buildFumePreheatQueue,
    createFumeSnapshotCache: createFumeSnapshotCache,
  };
});
