/*
 * Native Fume Canvas renderer adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricFumeState;
  var pretext = root && root.MineradioPretext;
  var layout = root && root.MineradioNativeLyricLayout;
  if (typeof module === 'object' && module.exports) state = require('../fume-state');
  if (typeof module === 'object' && module.exports) layout = require('../layout');
  var api = factory(state || {}, pretext || null, layout || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricFume = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state, pretext, layout) {
  'use strict';

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function rgba(hex, alpha, fallback) {
    var match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) match = /^#([0-9a-f]{6})$/i.exec(fallback || '#d6f8ff');
    var value = parseInt(match[1], 16);
    return 'rgba(' + (value >> 16) + ',' + (value >> 8 & 255) + ',' + (value & 255) + ',' + clamp(alpha, 0, 1, 1) + ')';
  }

  function createFumeRenderer(context) {
    context = context || {};
    var root = context.root || null;
    var ownerDocument = root && root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var stage = null;
    var canvas = null;
    var canvasContext = null;
    var measureCanvas = null;
    var measureContext = null;
    var lyricDocument = null;
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var canvasDpr = 1;
    var article = null;
    var articleSignature = '';
    var layoutPendingSignature = '';
    var camera = null;
    var snapshotCache = null;
    var snapshotCacheSignature = '';
    var pendingJobs = [];
    var workToken = 0;
    var preheatQueue = [];
    var preheatActive = false;
    var lastPreheatLine = -2;
    var lastFrame = null;
    var released = false;

    function clearRoot() {
      if (!root) return;
      while (root.firstChild) root.removeChild(root.firstChild);
    }

    function windowObject() {
      return ownerDocument && ownerDocument.defaultView || (typeof window !== 'undefined' ? window : null);
    }

    function scheduleIdle(callback) {
      var target = windowObject();
      var job;
      if (target && typeof target.requestIdleCallback === 'function') {
        job = { kind: 'idle', target: target, id: target.requestIdleCallback(callback, { timeout: 120 }) };
      } else {
        var timerTarget = target || globalThis;
        job = { kind: 'timeout', target: timerTarget, id: timerTarget.setTimeout(callback, 0) };
      }
      pendingJobs.push(job);
      return job;
    }

    function cancelJobs() {
      pendingJobs.forEach(function(job) {
        if (job.kind === 'idle' && typeof job.target.cancelIdleCallback === 'function') job.target.cancelIdleCallback(job.id);
        else if (typeof job.target.clearTimeout === 'function') job.target.clearTimeout(job.id);
      });
      pendingJobs.length = 0;
      preheatActive = false;
      preheatQueue.length = 0;
    }

    function disposeSnapshot(snapshot) {
      if (snapshot && snapshot.canvas) {
        snapshot.canvas.width = 1;
        snapshot.canvas.height = 1;
      }
    }

    function ensureSnapshotCache(config) {
      var signature = [config.cacheEntries, config.cacheBytes].join('|');
      if (snapshotCache && snapshotCacheSignature === signature) return snapshotCache;
      if (snapshotCache) snapshotCache.clear();
      snapshotCacheSignature = signature;
      snapshotCache = state.createFumeSnapshotCache({
        maxEntries: config.cacheEntries,
        maxBytes: config.cacheBytes,
        dispose: disposeSnapshot,
      });
      return snapshotCache;
    }

    function mount(mountContext) {
      root = root || mountContext && mountContext.root;
      ownerDocument = root && root.ownerDocument || ownerDocument;
      if (!root || !ownerDocument) throw new Error('Fume renderer requires a DOM root');
      released = false;
      clearRoot();
      stage = ownerDocument.createElement('section');
      stage.className = 'native-fume-stage';
      stage.setAttribute('aria-label', '浮名歌词');
      canvas = ownerDocument.createElement('canvas');
      canvas.className = 'native-fume-canvas';
      canvasContext = canvas.getContext && canvas.getContext('2d');
      measureCanvas = ownerDocument.createElement('canvas');
      measureContext = measureCanvas.getContext && measureCanvas.getContext('2d');
      stage.appendChild(canvas);
      root.appendChild(stage);
      root.setAttribute('aria-hidden', 'false');
      resizeCanvas('balanced');
    }

    function setDocument(nextDocument) {
      lyricDocument = nextDocument || null;
      workToken += 1;
      cancelJobs();
      article = null;
      articleSignature = '';
      layoutPendingSignature = '';
      camera = null;
      lastPreheatLine = -2;
      if (snapshotCache) snapshotCache.clear();
    }

    function modeConfig(frame) {
      return frame.config && frame.config.modes && frame.config.modes.fume || {};
    }

    function fontSpec(fontPx, variant) {
      return (variant === 'hero' ? '800 ' : '600 ') + fontPx + 'px "Noto Sans SC", Inter, sans-serif';
    }

    function measureText(text, fontPx, variant) {
      var font = fontSpec(fontPx, variant || 'body');
      if (measureContext) measureContext.font = font;
      if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.measureNaturalWidth === 'function') {
        try { return pretext.measureNaturalWidth(pretext.prepareWithSegments(String(text || ''), font, { whiteSpace:'pre-wrap' })); } catch (error) {}
      }
      return measureContext ? measureContext.measureText(String(text || '')).width : Array.from(String(text || '')).length * fontPx * 0.58;
    }

    function desiredArticleSignature(frame) {
      var config = modeConfig(frame);
      return [
        lyricDocument && lyricDocument.fingerprint || '',
        Math.round(viewport.width / 24),
        Math.round(viewport.height / 24),
        config.columns,
        config.heroScale,
      ].join('|');
    }

    function scheduleArticle(frame) {
      var signature = desiredArticleSignature(frame);
      if (layoutPendingSignature === signature) return;
      layoutPendingSignature = signature;
      var token = ++workToken;
      var documentRef = lyricDocument;
      var viewportRef = Object.assign({}, viewport);
      var configRef = Object.assign({}, modeConfig(frame));
      var frameRef = frame;
      scheduleIdle(function() {
        if (released || token !== workToken || documentRef !== lyricDocument) return;
        ensureSnapshotCache(configRef);
        article = state.buildFumeArticleLayout(documentRef, viewportRef, configRef, measureText);
        articleSignature = signature;
        layoutPendingSignature = '';
        camera = null;
        lastPreheatLine = -2;
        schedulePreheat(frameRef);
      });
    }

    function ensureArticle(frame) {
      var signature = desiredArticleSignature(frame);
      if (article && articleSignature === signature) return true;
      scheduleArticle(frame);
      return false;
    }

    function resizeCanvas(quality) {
      if (!canvas || !canvasContext) return;
      canvasDpr = typeof layout.resolveCanvasPixelRatio === 'function'
        ? layout.resolveCanvasPixelRatio(viewport, quality)
        : Math.max(0.5, Math.min(viewport.dpr || 1, 1.5));
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      canvas.width = Math.max(1, Math.round(viewport.width * canvasDpr));
      canvas.height = Math.max(1, Math.round(viewport.height * canvasDpr));
      canvasContext.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
    }

    function themeSignature(frame) {
      var theme = frame.theme || {};
      var common = frame.config && frame.config.common || {};
      return [theme.primary, theme.secondary, theme.highlight, common.accentColor, frame.quality].join('|');
    }

    function snapshotKey(block, frame) {
      return block.snapshotKey + '|' + themeSignature(frame);
    }

    function drawBlockText(targetContext, block, color, completeProgress, offsetX, offsetY) {
      var progress = clamp(completeProgress, 0, block.graphemes.length, 0);
      targetContext.font = fontSpec(block.fontPx, block.variant);
      targetContext.textAlign = 'left';
      targetContext.textBaseline = 'middle';
      targetContext.fillStyle = color;
      block.renderLines.forEach(function(renderLine, lineIndex) {
        var visible = clamp(progress - renderLine.start, 0, renderLine.end - renderLine.start, 0);
        var complete = Math.floor(visible);
        var fraction = visible - complete;
        var lineCharacters = block.graphemes.slice(renderLine.start, renderLine.end).map(function(item) { return item.char; });
        var completeText = lineCharacters.slice(0, complete).join('');
        var x = offsetX + 12;
        var y = offsetY + 15 + block.lineHeight * (lineIndex + 0.5);
        if (completeText) targetContext.fillText(completeText, x, y);
        if (fraction > 0 && lineCharacters[complete]) {
          var advance = targetContext.measureText(completeText).width;
          targetContext.save();
          targetContext.globalAlpha *= fraction;
          targetContext.fillText(lineCharacters[complete], x + advance, y);
          targetContext.restore();
        }
      });
    }

    function createStaticSnapshot(block, frame) {
      if (!ownerDocument) return null;
      var scale = frame.quality === 'quality' ? 1.5 : frame.quality === 'battery' ? 1 : 1.25;
      var snapshotCanvas = ownerDocument.createElement('canvas');
      snapshotCanvas.width = Math.max(1, Math.ceil(block.width * scale));
      snapshotCanvas.height = Math.max(1, Math.ceil(block.height * scale));
      var target = snapshotCanvas.getContext && snapshotCanvas.getContext('2d');
      if (!target) return null;
      var theme = frame.theme || {};
      target.setTransform(scale, 0, 0, scale, 0, 0);
      target.strokeStyle = rgba(theme.secondary || '#9cffdf', block.variant === 'hero' ? 0.25 : 0.12, '#9cffdf');
      target.lineWidth = 1;
      target.strokeRect(0.5, 0.5, block.width - 1, block.height - 1);
      drawBlockText(target, block, theme.primary || '#d6f8ff', block.graphemes.length, 0, 0);
      return {
        canvas: snapshotCanvas,
        width: block.width,
        height: block.height,
        bytes: snapshotCanvas.width * snapshotCanvas.height * 4,
      };
    }

    function cacheSnapshot(block, frame) {
      var cache = ensureSnapshotCache(modeConfig(frame));
      var key = snapshotKey(block, frame);
      if (cache.has(key)) return cache.get(key);
      var snapshot = createStaticSnapshot(block, frame);
      if (!snapshot) return null;
      cache.set(key, snapshot, snapshot.bytes);
      return cache.get(key) || null;
    }

    function pumpPreheat(frame) {
      if (preheatActive || !preheatQueue.length || released) return;
      preheatActive = true;
      var token = workToken;
      function next() {
        if (released || token !== workToken) {
          preheatActive = false;
          return;
        }
        var blockIndex = preheatQueue.shift();
        if (blockIndex == null) {
          preheatActive = false;
          return;
        }
        scheduleIdle(function() {
          if (!released && token === workToken && article && article.blocks[blockIndex]) cacheSnapshot(article.blocks[blockIndex], frame);
          next();
        });
      }
      next();
    }

    function schedulePreheat(frame) {
      if (!article || !frame) return;
      if (lastPreheatLine === frame.lineIndex && preheatQueue.length) return;
      lastPreheatLine = frame.lineIndex;
      var limit = frame.quality === 'battery' ? 4 : frame.quality === 'quality' ? 12 : 8;
      preheatQueue = state.buildFumePreheatQueue(article, frame.lineIndex, limit);
      pumpPreheat(frame);
    }

    function drawGeometricBackground(frame) {
      var config = modeConfig(frame);
      if (!config.geometricBackground) return;
      var opacity = clamp(config.backgroundObjectOpacity, 0, 1, 0.5) * 0.18;
      var energy = clamp(frame.audio && frame.audio.energy, 0, 1, 0);
      var secondary = frame.theme && frame.theme.secondary || '#9cffdf';
      canvasContext.save();
      canvasContext.strokeStyle = rgba(secondary, opacity, '#9cffdf');
      canvasContext.lineWidth = 1;
      var step = Math.max(72, Math.round(Math.min(viewport.width, viewport.height) / 7));
      for (var x = -step; x < viewport.width + step; x += step) {
        canvasContext.beginPath();
        canvasContext.moveTo(x + energy * 12, 0);
        canvasContext.lineTo(x - step * 0.35, viewport.height);
        canvasContext.stroke();
      }
      for (var y = step; y < viewport.height; y += step * 1.25) canvasContext.strokeRect(24 + energy * 8, y, viewport.width - 48, 1);
      canvasContext.restore();
    }

    function blockIsVisible(block) {
      if (!camera) return true;
      var halfWidth = viewport.width / Math.max(camera.scale, 0.1) * 0.65;
      var halfHeight = viewport.height / Math.max(camera.scale, 0.1) * 0.65;
      return block.x + block.width >= camera.x - halfWidth
        && block.x <= camera.x + halfWidth
        && block.y + block.height >= camera.y - halfHeight
        && block.y <= camera.y + halfHeight;
    }

    function passedOpacity(block, frame, config) {
      if (frame.now <= block.line.endTime) return 1;
      var hold = Math.max(0.25, (block.line.endTime - block.line.startTime) * clamp(config.textHoldRatio, 0.2, 1.8, 1));
      return clamp(1 - (frame.now - block.line.endTime) / hold, 0.18, 1, 1);
    }

    function drawPrintSymbols(block, frame, alpha) {
      var config = modeConfig(frame);
      if (config.hidePrintSymbols) return;
      var secondary = frame.theme && frame.theme.secondary || '#9cffdf';
      canvasContext.save();
      canvasContext.globalAlpha *= alpha * 0.55;
      canvasContext.strokeStyle = secondary;
      canvasContext.lineWidth = 1;
      var mark = block.variant === 'hero' ? 12 : 7;
      canvasContext.beginPath();
      canvasContext.moveTo(block.x, block.y + mark);
      canvasContext.lineTo(block.x, block.y);
      canvasContext.lineTo(block.x + mark, block.y);
      canvasContext.moveTo(block.x + block.width - mark, block.y + block.height);
      canvasContext.lineTo(block.x + block.width, block.y + block.height);
      canvasContext.lineTo(block.x + block.width, block.y + block.height - mark);
      canvasContext.stroke();
      canvasContext.restore();
    }

    function drawDynamicBlock(block, frame, progress, alpha) {
      var config = modeConfig(frame);
      var common = frame.config && frame.config.common || {};
      var theme = frame.theme || {};
      var highlight = common.accentColor || theme.highlight || '#fff0b8';
      canvasContext.save();
      canvasContext.globalAlpha = alpha;
      canvasContext.strokeStyle = rgba(theme.secondary || '#9cffdf', block.variant === 'hero' ? 0.32 : 0.16, '#9cffdf');
      canvasContext.strokeRect(block.x + 0.5, block.y + 0.5, block.width - 1, block.height - 1);
      canvasContext.shadowBlur = clamp(config.glowIntensity, 0, 1.5, 1) * 22;
      canvasContext.shadowColor = rgba(highlight, 0.72, '#fff0b8');
      drawBlockText(canvasContext, block, highlight, progress, block.x, block.y);
      if (block.translation && common.translationMode !== 'off') {
        canvasContext.shadowBlur = 0;
        canvasContext.font = '500 ' + clamp(block.fontPx * 0.42, 10, 15, 12) + 'px "Noto Sans SC", Inter, sans-serif';
        canvasContext.fillStyle = rgba(theme.secondary || '#9cffdf', 0.72, '#9cffdf');
        canvasContext.fillText(block.translation, block.x + 12, block.y + block.height - 10);
      }
      canvasContext.restore();
      drawPrintSymbols(block, frame, alpha);
    }

    function drawStaticBlock(block, frame, alpha) {
      var cache = ensureSnapshotCache(modeConfig(frame));
      var snapshot = cache.get(snapshotKey(block, frame));
      canvasContext.save();
      canvasContext.globalAlpha = alpha;
      if (snapshot) {
        canvasContext.drawImage(snapshot.canvas, 0, 0, snapshot.canvas.width, snapshot.canvas.height, block.x, block.y, block.width, block.height);
      } else {
        canvasContext.strokeStyle = rgba(frame.theme && frame.theme.secondary || '#9cffdf', 0.1, '#9cffdf');
        canvasContext.strokeRect(block.x + 0.5, block.y + 0.5, block.width - 1, block.height - 1);
        drawBlockText(canvasContext, block, frame.theme && frame.theme.primary || '#d6f8ff', block.graphemes.length, block.x, block.y);
      }
      canvasContext.restore();
      drawPrintSymbols(block, frame, alpha);
    }

    function drawArticle(frame) {
      var config = modeConfig(frame);
      camera = state.resolveFumeCameraFrame(article, {
        lineIndex: frame.lineIndex,
        now: frame.now,
        dt: frame.reducedMotion ? 0.1 : frame.dt,
        previous: camera,
      }, Object.assign({}, config, { cameraSpeed: frame.reducedMotion ? 2.5 : config.cameraSpeed }));
      canvasContext.save();
      canvasContext.translate(viewport.width * 0.5, viewport.height * 0.5);
      canvasContext.scale(camera.scale, camera.scale);
      canvasContext.translate(-camera.x, -camera.y);
      var theme = frame.theme || {};
      canvasContext.font = '700 13px "Noto Sans SC", Inter, sans-serif';
      canvasContext.fillStyle = rgba(theme.secondary || '#9cffdf', 0.55, '#9cffdf');
      canvasContext.fillText((lyricDocument.title || 'FUME').toUpperCase(), article.paperPadding, 30);
      article.blocks.forEach(function(block) {
        if (!blockIsVisible(block)) return;
        var isActive = block.sourceLineIndex === frame.lineIndex && !camera.overview;
        if (isActive) {
          var printed = state.resolveFumePrintedProgress(block, frame.now);
          drawDynamicBlock(block, frame, printed.progress, 1);
        } else {
          var alpha = frame.now < block.line.startTime ? 0.18 : passedOpacity(block, frame, config);
          if (camera.overview) alpha = 0.82;
          drawStaticBlock(block, frame, alpha);
        }
      });
      canvasContext.restore();
    }

    function draw(frame) {
      canvasContext.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
      canvasContext.clearRect(0, 0, viewport.width, viewport.height);
      drawGeometricBackground(frame);
      drawArticle(frame);
    }

    function update(frame) {
      if (released || !stage || !canvasContext || !lyricDocument) return;
      lastFrame = frame;
      stage.style.setProperty('--native-opacity', clamp(frame.config && frame.config.common && frame.config.common.opacity, 0.2, 1, 1));
      stage.style.setProperty('--native-scale', clamp(frame.config && frame.config.common && frame.config.common.scale, 0.65, 1.8, 1));
      stage.classList.toggle('is-reduced-motion', !!frame.reducedMotion);
      if (!ensureArticle(frame)) {
        canvasContext.clearRect(0, 0, viewport.width, viewport.height);
        return;
      }
      ensureSnapshotCache(modeConfig(frame));
      if (lastPreheatLine !== frame.lineIndex) schedulePreheat(frame);
      draw(frame);
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      workToken += 1;
      cancelJobs();
      article = null;
      articleSignature = '';
      layoutPendingSignature = '';
      camera = null;
      lastPreheatLine = -2;
      if (snapshotCache) snapshotCache.clear();
      resizeCanvas(lastFrame && lastFrame.quality || 'balanced');
      if (lastFrame && lyricDocument) scheduleArticle(lastFrame);
    }

    function release() {
      released = true;
      workToken += 1;
      cancelJobs();
      if (snapshotCache) snapshotCache.clear();
      snapshotCache = null;
      snapshotCacheSignature = '';
      article = null;
      articleSignature = '';
      layoutPendingSignature = '';
      camera = null;
      lastFrame = null;
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      if (measureCanvas) { measureCanvas.width = 1; measureCanvas.height = 1; }
      clearRoot();
      if (root) root.setAttribute('aria-hidden', 'true');
      stage = canvas = canvasContext = measureCanvas = measureContext = null;
    }

    function resume() { mount({ root: root }); }
    function destroy() { release(); lyricDocument = null; }

    return {
      kind: 'canvas2d',
      mount: mount,
      setDocument: setDocument,
      update: update,
      resize: resize,
      release: release,
      resume: resume,
      destroy: destroy,
      snapshot: function() {
        var stats = snapshotCache ? snapshotCache.stats() : { entries: 0, bytes: 0 };
        return {
          domNodes: stage ? stage.querySelectorAll('*').length + 1 : 0,
          canvases: canvas ? stats.entries + 2 : 0,
          cacheEntries: stats.entries + (article ? 1 : 0),
          cacheBytes: stats.bytes,
        };
      },
    };
  }

  return { createFumeRenderer: createFumeRenderer };
});
