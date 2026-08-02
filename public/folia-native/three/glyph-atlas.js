(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricGlyphAtlas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function finite(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function integer(value, min, max, fallback) {
    return Math.max(min, Math.min(max, Math.round(finite(value, fallback))));
  }

  function normalizeStyle(style) {
    style = style && typeof style === 'object' ? style : {};
    return {
      fontFamily: String(style.fontFamily || style.font || '"Noto Sans SC", "Microsoft YaHei", sans-serif'),
      weight: integer(style.weight, 100, 900, 600),
      size: Math.max(8, finite(style.size, 64)),
      strokeWidth: Math.max(0, finite(style.strokeWidth, 0)),
      fillMode: String(style.fillMode || 'fill'),
      language: String(style.language || ''),
      dpr: Math.max(0.5, Math.min(4, finite(style.dpr, 1))),
      glowPadding: Math.max(0, finite(style.glowPadding, 0)),
    };
  }

  function styleKey(style) {
    return [
      style.fontFamily,
      style.weight,
      style.size.toFixed(2),
      style.strokeWidth.toFixed(2),
      style.fillMode,
      style.language,
      style.dpr.toFixed(2),
      style.glowPadding.toFixed(2),
    ].join('|');
  }

  function capacityError(message) {
    var error = new Error(message || 'Glyph atlas capacity exceeded');
    error.code = 'GLYPH_ATLAS_CAPACITY';
    return error;
  }

  function createGlyphAtlas(options) {
    options = options || {};
    var pageSize = integer(options.pageSize, 32, 4096, 1024);
    var padding = integer(options.padding, 1, Math.max(1, Math.floor(pageSize / 8)), 4);
    var maxPages = integer(options.maxPages, 1, 64, 4);
    var pageBytes = pageSize * pageSize * 4;
    var maxBytes = Math.max(pageBytes, finite(options.maxBytes, pageBytes * maxPages));
    var createCanvas = options.createCanvas || function(width, height) {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    };
    var createTexture = options.createTexture;
    if (typeof createTexture !== 'function') throw new Error('Glyph atlas requires createTexture(canvas)');
    var onDisposePage = typeof options.onDisposePage === 'function' ? options.onDisposePage : null;

    var pages = [];
    var entries = new Map();
    var nextPageId = 1;
    var tick = 0;
    var totalLeases = 0;

    function touch(page) {
      page.lastUsed = ++tick;
    }

    function disposePage(page) {
      if (!page || page.disposed) return false;
      page.disposed = true;
      page.keys.forEach(function(key) { entries.delete(key); });
      page.keys.clear();
      var index = pages.indexOf(page);
      if (index >= 0) pages.splice(index, 1);
      if (onDisposePage) {
        try { onDisposePage(page.id, page.texture); } catch (error) { /* cleanup must continue */ }
      }
      if (page.texture && typeof page.texture.dispose === 'function') page.texture.dispose();
      page.canvas = null;
      page.context = null;
      page.texture = null;
      return true;
    }

    function evictOldestUnlocked() {
      var candidates = pages.filter(function(page) { return !page.disposed && page.leases === 0; });
      candidates.sort(function(a, b) { return a.lastUsed - b.lastUsed; });
      return candidates.length ? disposePage(candidates[0]) : false;
    }

    function makeRoomForPage() {
      while (pages.length + 1 > maxPages || (pages.length + 1) * pageBytes > maxBytes) {
        if (!evictOldestUnlocked()) throw capacityError();
      }
    }

    function createPage() {
      makeRoomForPage();
      var canvas = createCanvas(pageSize, pageSize);
      if (!canvas) throw new Error('Glyph atlas canvas factory returned no canvas');
      canvas.width = pageSize;
      canvas.height = pageSize;
      var context = canvas.getContext && canvas.getContext('2d');
      if (!context) throw new Error('Glyph atlas requires a 2D canvas context');
      if (typeof context.clearRect === 'function') context.clearRect(0, 0, pageSize, pageSize);
      var texture = createTexture(canvas);
      if (!texture) throw new Error('Glyph atlas texture factory returned no texture');
      var page = {
        id: 'glyph-page-' + nextPageId++,
        canvas: canvas,
        context: context,
        texture: texture,
        cursorX: padding,
        cursorY: padding,
        rowHeight: 0,
        leases: 0,
        lastUsed: 0,
        keys: new Set(),
        disposed: false,
      };
      touch(page);
      pages.push(page);
      return page;
    }

    function place(page, width, height) {
      var max = pageSize - padding;
      if (width > pageSize - padding * 2 || height > pageSize - padding * 2) return null;
      if (page.cursorX + width > max) {
        page.cursorX = padding;
        page.cursorY += page.rowHeight + padding;
        page.rowHeight = 0;
      }
      if (page.cursorY + height > max) return null;
      var result = { x: page.cursorX, y: page.cursorY };
      page.cursorX += width + padding;
      page.rowHeight = Math.max(page.rowHeight, height);
      return result;
    }

    function prepareGlyph(grapheme, style) {
      var rasterSize = style.size * style.dpr;
      var font = style.weight + ' ' + rasterSize.toFixed(2) + 'px ' + style.fontFamily;
      var measureCanvas = pages.length ? pages[0].canvas : createCanvas(1, 1);
      var context = measureCanvas && measureCanvas.getContext && measureCanvas.getContext('2d');
      if (!context) throw new Error('Glyph atlas requires a 2D canvas context');
      context.font = font;
      var metrics = context.measureText(grapheme);
      var measuredWidth = Math.max(1, finite(metrics && metrics.width, rasterSize * 0.65));
      var ascent = Math.max(1, finite(metrics && metrics.actualBoundingBoxAscent, rasterSize * 0.8));
      var descent = Math.max(0, finite(metrics && metrics.actualBoundingBoxDescent, rasterSize * 0.2));
      var left = finite(metrics && metrics.actualBoundingBoxLeft, 0);
      var right = finite(metrics && metrics.actualBoundingBoxRight, measuredWidth);
      var rasterStroke = style.strokeWidth * style.dpr;
      var contentWidth = Math.ceil(Math.max(measuredWidth, left + right) + rasterStroke * 2);
      var contentHeight = Math.ceil(ascent + descent + rasterStroke * 2);
      var rasterGlowPadding = Math.ceil(style.glowPadding * style.dpr);
      var sampleWidth = contentWidth + rasterGlowPadding * 2;
      var sampleHeight = contentHeight + rasterGlowPadding * 2;
      return {
        font: font,
        measuredWidth: measuredWidth,
        ascent: ascent,
        descent: descent,
        left: left,
        right: right,
        rasterStroke: rasterStroke,
        contentWidth: contentWidth,
        contentHeight: contentHeight,
        rasterGlowPadding: rasterGlowPadding,
        sampleWidth: sampleWidth,
        sampleHeight: sampleHeight,
        cellWidth: sampleWidth + padding * 2,
        cellHeight: sampleHeight + padding * 2,
      };
    }

    function drawGlyph(page, slot, grapheme, style, prepared) {
      var context = page.context;
      context.save();
      context.font = prepared.font;
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      context.fillStyle = '#fff';
      context.strokeStyle = '#fff';
      context.lineWidth = prepared.rasterStroke;
      var x = slot.x + padding + prepared.rasterGlowPadding + prepared.left + prepared.rasterStroke;
      var y = slot.y + padding + prepared.rasterGlowPadding + prepared.ascent + prepared.rasterStroke;
      if (context.lineWidth > 0 && typeof context.strokeText === 'function') context.strokeText(grapheme, x, y);
      if (typeof context.fillText === 'function') context.fillText(grapheme, x, y);
      context.restore();
      page.texture.needsUpdate = true;
    }

    function acquire(grapheme, inputStyle) {
      grapheme = String(grapheme == null ? '' : grapheme);
      if (!grapheme) throw new Error('Glyph atlas requires a grapheme');
      var style = normalizeStyle(inputStyle);
      var key = grapheme + '|' + styleKey(style);
      var entry = entries.get(key);
      var page;
      if (!entry) {
        var prepared = prepareGlyph(grapheme, style);
        if (prepared.cellWidth > pageSize - padding * 2 || prepared.cellHeight > pageSize - padding * 2) {
          throw capacityError('Glyph is larger than an atlas page');
        }
        var slot = null;
        for (var pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
          slot = place(pages[pageIndex], prepared.cellWidth, prepared.cellHeight);
          if (slot) {
            page = pages[pageIndex];
            break;
          }
        }
        if (!page) {
          page = createPage();
          slot = place(page, prepared.cellWidth, prepared.cellHeight);
        }
        if (!slot) throw capacityError('Unable to place glyph on an empty atlas page');
        drawGlyph(page, slot, grapheme, style, prepared);
        var sampleX = slot.x + padding;
        var sampleY = slot.y + padding;
        var contentX = sampleX + prepared.rasterGlowPadding;
        var contentY = sampleY + prepared.rasterGlowPadding;
        var sampleUv = Object.freeze({
          u0: sampleX / pageSize,
          v0: 1 - (sampleY + prepared.sampleHeight) / pageSize,
          u1: (sampleX + prepared.sampleWidth) / pageSize,
          v1: 1 - sampleY / pageSize,
        });
        var sampleClampUv = Object.freeze({
          u0: (sampleX + 0.5) / pageSize,
          v0: 1 - (sampleY + prepared.sampleHeight - 0.5) / pageSize,
          u1: (sampleX + prepared.sampleWidth - 0.5) / pageSize,
          v1: 1 - (sampleY + 0.5) / pageSize,
        });
        entry = Object.freeze({
          key: key,
          grapheme: grapheme,
          pageId: page.id,
          texture: page.texture,
          uv: Object.freeze({
            u0: contentX / pageSize,
            v0: 1 - (contentY + prepared.contentHeight) / pageSize,
            u1: (contentX + prepared.contentWidth) / pageSize,
            v1: 1 - contentY / pageSize,
          }),
          sampleUv: sampleUv,
          sampleClampUv: sampleClampUv,
          width: prepared.contentWidth / style.dpr,
          height: prepared.contentHeight / style.dpr,
          sampleWidth: prepared.sampleWidth / style.dpr,
          sampleHeight: prepared.sampleHeight / style.dpr,
          glowPadding: style.glowPadding,
          advance: prepared.measuredWidth / style.dpr,
          bearingX: -prepared.left / style.dpr,
          bearingY: prepared.ascent / style.dpr,
        });
        entries.set(key, entry);
        page.keys.add(key);
      } else {
        page = pages.find(function(candidate) { return candidate.id === entry.pageId; });
      }
      if (!page || page.disposed) throw capacityError('Glyph atlas page is unavailable');
      page.leases += 1;
      totalLeases += 1;
      touch(page);
      var released = false;
      return {
        entry: entry,
        release: function() {
          if (released) return;
          released = true;
          page.leases = Math.max(0, page.leases - 1);
          totalLeases = Math.max(0, totalLeases - 1);
          touch(page);
        },
      };
    }

    function trim(limits) {
      limits = limits || {};
      var targetPages = limits.maxPages == null ? maxPages : Math.max(0, Math.floor(finite(limits.maxPages, maxPages)));
      var targetBytes = limits.maxBytes == null ? maxBytes : Math.max(0, finite(limits.maxBytes, maxBytes));
      var evicted = 0;
      while (pages.length > targetPages || pages.length * pageBytes > targetBytes) {
        if (!evictOldestUnlocked()) break;
        evicted += 1;
      }
      return evicted;
    }

    function clear(clearOptions) {
      var force = !!(clearOptions && clearOptions.force);
      pages.slice().forEach(function(page) {
        if (force || page.leases === 0) disposePage(page);
      });
    }

    function snapshot() {
      return {
        pages: pages.length,
        entries: entries.size,
        leases: totalLeases,
        bytes: pages.length * pageBytes,
        maxPages: maxPages,
        maxBytes: maxBytes,
        pageSize: pageSize,
      };
    }

    return {
      acquire: acquire,
      trim: trim,
      clear: clear,
      snapshot: snapshot,
    };
  }

  return {
    createGlyphAtlas: createGlyphAtlas,
  };
});
