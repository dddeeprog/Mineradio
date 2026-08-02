/*
 * Native Cadenza Canvas/DOM renderer adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricCadenzaState;
  var pretext = root && root.MineradioPretext;
  var layout = root && root.MineradioNativeLyricLayout;
  var cachePolicy = root && root.MineradioNativeLyricCachePolicy;
  if (typeof module === 'object' && module.exports) {
    state = require('../cadenza-state');
    layout = require('../layout');
    cachePolicy = require('../cache-policy');
  }
  var api = factory(state || {}, pretext || null, layout || {}, cachePolicy || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCadenza = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state, pretext, layout, cachePolicy) {
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

  function resolveWordColor(text, theme, fallback) {
    var normalized = String(text || '').toLowerCase();
    var entries = theme && Array.isArray(theme.wordColors) ? theme.wordColors : [];
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index] || {};
      if (entry.word && normalized.indexOf(String(entry.word).toLowerCase()) >= 0 && /^#[0-9a-f]{6}$/i.test(entry.color || '')) return entry.color;
    }
    return fallback;
  }

  function createCadenzaRenderer(context) {
    context = context || {};
    var root = context.root || null;
    var ownerDocument = root && root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var stage = null;
    var canvas = null;
    var canvasContext = null;
    var glowLayer = null;
    var translation = null;
    var measureCanvas = null;
    var measureContext = null;
    var lyricDocument = null;
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var canvasDpr = 1;
    var currentLineIndex = -2;
    var currentModel = null;
    var currentModelKey = '';
    var glowRefs = [];
    var modelCache = new Map();
    var released = false;
    var resourcePolicy = null;

    function trimModelCache() {
      if (typeof cachePolicy.trimMapToPolicy === 'function') {
        return cachePolicy.trimMapToPolicy(modelCache, resourcePolicy, {
          maxCount: 16,
          maxBytes: 16 * 12288,
          bytesPerEntry: 12288,
        });
      }
      while (modelCache.size > 16) modelCache.delete(modelCache.keys().next().value);
      return null;
    }

    function setResourcePolicy(policy) {
      resourcePolicy = policy || null;
      trimModelCache();
      return true;
    }

    function clearRoot() {
      if (!root) return;
      while (root.firstChild) root.removeChild(root.firstChild);
    }

    function element(tag, className) {
      var node = ownerDocument.createElement(tag);
      node.className = className;
      return node;
    }

    function mount(mountContext) {
      root = root || mountContext && mountContext.root;
      ownerDocument = root && root.ownerDocument || ownerDocument;
      if (!root || !ownerDocument) throw new Error('Cadenza renderer requires a DOM root');
      released = false;
      clearRoot();
      stage = element('section', 'native-cadenza-stage');
      stage.setAttribute('aria-label', '心象歌词');
      canvas = element('canvas', 'native-cadenza-canvas');
      canvasContext = canvas.getContext && canvas.getContext('2d');
      glowLayer = element('div', 'native-cadenza-glow-layer');
      glowLayer.setAttribute('aria-hidden', 'true');
      translation = element('div', 'native-cadenza-translation');
      stage.appendChild(canvas);
      stage.appendChild(glowLayer);
      stage.appendChild(translation);
      root.appendChild(stage);
      root.setAttribute('aria-hidden', 'false');
      measureCanvas = ownerDocument.createElement('canvas');
      measureContext = measureCanvas.getContext && measureCanvas.getContext('2d');
      resizeCanvas('balanced');
    }

    function setDocument(nextDocument) {
      lyricDocument = nextDocument || null;
      currentLineIndex = -2;
      currentModel = null;
      currentModelKey = '';
      glowRefs = [];
      modelCache.clear();
      if (glowLayer) glowLayer.replaceChildren();
    }

    function modeConfig(frame) {
      return frame.config && frame.config.modes && frame.config.modes.cadenza || {};
    }

    function fontSpec(fontPx) {
      return '700 ' + fontPx + 'px "Noto Sans SC", Inter, sans-serif';
    }

    function measureText(text, fontPx) {
      var font = fontSpec(fontPx);
      if (measureContext) measureContext.font = font;
      if (pretext && typeof pretext.prepareWithSegments === 'function' && typeof pretext.measureNaturalWidth === 'function') {
        try { return pretext.measureNaturalWidth(pretext.prepareWithSegments(String(text || ''), font, { whiteSpace:'pre-wrap' })); } catch (error) {}
      }
      return measureContext ? measureContext.measureText(String(text || '')).width : Array.from(String(text || '')).length * fontPx * 0.62;
    }

    function modelKey(line, config) {
      return [line.index, line.fullText, Math.round(viewport.width / 24), Math.round(viewport.height / 24), config.fontScale, config.widthRatio, config.motionAmount].join('|');
    }

    function buildModel(line, config) {
      var key = modelKey(line, config);
      if (modelCache.has(key)) {
        var cached = modelCache.get(key);
        modelCache.delete(key);
        modelCache.set(key, cached);
        return cached;
      }
      var model = state.buildCadenzaLineLayout(line, viewport, config, measureText);
      modelCache.set(key, model);
      trimModelCache();
      return model;
    }

    function createGlowLayer(model) {
      glowLayer.replaceChildren();
      glowRefs = model.placements.map(function(placement) {
        var word = element('span', 'native-cadenza-glow-word');
        word.style.left = 'calc(50% + ' + placement.x + 'px)';
        word.style.top = 'calc(50% + ' + placement.y + 'px)';
        word.style.fontSize = placement.fontPx + 'px';
        var characters = placement.graphemes.map(function(character) {
          var span = element('span', 'native-cadenza-glow-character');
          span.textContent = character.char;
          word.appendChild(span);
          return span;
        });
        glowLayer.appendChild(word);
        return { word: word, characters: characters, placement: placement };
      });
    }

    function ensureLine(frame) {
      if (!frame.line) {
        currentLineIndex = -1;
        currentModel = null;
        currentModelKey = '';
        glowRefs = [];
        glowLayer.replaceChildren();
        return false;
      }
      var config = modeConfig(frame);
      var key = modelKey(frame.line, config);
      if (frame.lineIndex !== currentLineIndex || key !== currentModelKey || !currentModel) {
        currentModel = buildModel(frame.line, config);
        currentLineIndex = frame.lineIndex;
        currentModelKey = key;
        createGlowLayer(currentModel);
      }
      return true;
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

    function drawBeam(frameModel, color) {
      var beam = frameModel.beam;
      if (!beam.alpha) return;
      var gradient = canvasContext.createRadialGradient(beam.x, beam.y, 0, beam.x, beam.y, Math.max(beam.width, 1));
      gradient.addColorStop(0, rgba(color, beam.alpha * 0.32, '#d6f8ff'));
      gradient.addColorStop(0.32, rgba(color, beam.alpha * 0.14, '#d6f8ff'));
      gradient.addColorStop(1, rgba(color, 0, '#d6f8ff'));
      canvasContext.fillStyle = gradient;
      canvasContext.fillRect(beam.x - beam.width, beam.y - beam.width * 0.5, beam.width * 2, beam.width);
    }

    function drawRipple(frameModel, color) {
      var ripple = frameModel.ripple;
      if (!ripple.alpha) return;
      canvasContext.beginPath();
      canvasContext.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      canvasContext.strokeStyle = rgba(color, ripple.alpha, '#fff0b8');
      canvasContext.lineWidth = 1.2;
      canvasContext.stroke();
    }

    function drawPlacement(item, frame) {
      var theme = frame.theme || {};
      var primary = resolveWordColor(item.text, theme, frame.config && frame.config.common && frame.config.common.accentColor || theme.highlight || theme.primary || '#d6f8ff');
      canvasContext.save();
      canvasContext.translate(item.drawX, item.drawY);
      canvasContext.rotate(item.rotate * Math.PI / 180);
      canvasContext.scale(item.scale, item.scale);
      canvasContext.font = fontSpec(item.fontPx);
      canvasContext.textAlign = 'center';
      canvasContext.textBaseline = 'middle';
      item.trails.forEach(function(trail) {
        if (trail.alpha <= 0) return;
        canvasContext.save();
        canvasContext.translate(trail.x - item.drawX, trail.y - item.drawY);
        canvasContext.fillStyle = rgba(primary, trail.alpha, '#d6f8ff');
        canvasContext.fillText(item.text, 0, 0);
        canvasContext.restore();
      });
      var waitingAlpha = item.status === 'waiting' ? 0.2 : 1;
      canvasContext.globalAlpha = clamp(waitingAlpha * (0.28 + item.bodyMix * 0.72), 0, 1, 1);
      canvasContext.fillStyle = item.status === 'active' ? primary : theme.primary || '#d6f8ff';
      canvasContext.shadowBlur = item.glow * 22;
      canvasContext.shadowColor = rgba(primary, item.glow, '#d6f8ff');
      canvasContext.fillText(item.text, 0, 0);
      canvasContext.restore();
    }

    function draw(frame, frameModel) {
      if (!canvasContext) return;
      canvasContext.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
      canvasContext.clearRect(0, 0, viewport.width, viewport.height);
      canvasContext.save();
      canvasContext.translate(viewport.width * 0.5, viewport.height * 0.5);
      var highlight = frame.config && frame.config.common && frame.config.common.accentColor || frame.theme && frame.theme.highlight || '#fff0b8';
      drawBeam(frameModel, highlight);
      drawRipple(frameModel, highlight);
      frameModel.placements.forEach(function(item) { drawPlacement(item, frame); });
      canvasContext.restore();
    }

    function updateGlow(frame, frameModel) {
      frameModel.placements.forEach(function(item, index) {
        var refs = glowRefs[index];
        if (!refs) return;
        var offsetX = item.drawX - item.x;
        var offsetY = item.drawY - item.y;
        refs.word.style.transform = 'translate(-50%, -50%) translate(' + offsetX + 'px,' + offsetY + 'px) rotate(' + item.rotate + 'deg) scale(' + item.scale + ')';
        refs.word.style.opacity = clamp(item.glow * (0.44 + item.pulse * 0.4), 0, 1, 0);
        refs.word.style.setProperty('--cadenza-glow', item.glow);
        refs.characters.forEach(function(character, charIndex) {
          var timing = item.graphemes[charIndex];
          var active = timing && frame.now >= timing.startTime && frame.now <= timing.endTime;
          var passed = timing && frame.now > timing.endTime;
          character.classList.toggle('is-active', !!active);
          character.classList.toggle('is-passed', !!passed);
        });
      });
    }

    function updateTheme(frame) {
      var common = frame.config && frame.config.common || {};
      var theme = frame.theme || {};
      stage.style.setProperty('--native-primary', theme.primary || '#d6f8ff');
      stage.style.setProperty('--native-secondary', theme.secondary || '#9cffdf');
      stage.style.setProperty('--native-highlight', common.accentColor || theme.highlight || '#fff0b8');
      stage.style.setProperty('--native-opacity', clamp(common.opacity, 0.2, 1, 1));
      stage.style.setProperty('--native-scale', clamp(common.scale, 0.65, 1.8, 1));
      stage.classList.toggle('is-reduced-motion', !!frame.reducedMotion);
      stage.classList.toggle('is-large-surface', viewport.width * viewport.height * Math.pow(viewport.dpr || 1, 2) > 3000000);
      translation.textContent = frame.line && common.translationMode !== 'off' ? frame.line.translation || '' : '';
      translation.hidden = !translation.textContent;
    }

    function update(frame) {
      if (released || !stage || !lyricDocument) return;
      if (canvas && Math.abs(canvas.width / canvasDpr - viewport.width) > 1) resizeCanvas(frame.quality);
      updateTheme(frame);
      if (!ensureLine(frame)) {
        if (canvasContext) canvasContext.clearRect(0, 0, viewport.width, viewport.height);
        return;
      }
      var config = Object.assign({}, modeConfig(frame));
      if (frame.reducedMotion) {
        config.motionAmount = 0;
        config.trails = 0;
        config.ripple *= 0.35;
      } else if (frame.quality === 'battery') {
        config.trails *= 0.45;
      }
      var frameModel = state.resolveCadenzaLineFrame(currentModel, frame.now, config, frame.audio || {});
      draw(frame, frameModel);
      updateGlow(frame, frameModel);
      if (frame.nextLine) buildModel(frame.nextLine, modeConfig(frame));
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      currentLineIndex = -2;
      currentModelKey = '';
      modelCache.clear();
      resizeCanvas('balanced');
    }

    function release() {
      released = true;
      currentLineIndex = -2;
      currentModel = null;
      currentModelKey = '';
      glowRefs = [];
      modelCache.clear();
      if (canvas) { canvas.width = 1; canvas.height = 1; }
      if (measureCanvas) { measureCanvas.width = 1; measureCanvas.height = 1; }
      clearRoot();
      if (root) root.setAttribute('aria-hidden', 'true');
      stage = canvas = canvasContext = glowLayer = translation = measureCanvas = measureContext = null;
    }

    function resume() { mount({ root: root }); }
    function destroy() { release(); lyricDocument = null; }

    function captureTransition() {
      if (!stage || typeof stage.cloneNode !== 'function') return null;
      var clone = stage.cloneNode(true);
      clone.classList.add('is-transition-capture');
      var clonedCanvas = clone.querySelector && clone.querySelector('.native-cadenza-canvas');
      if (clonedCanvas && clonedCanvas.parentNode) clonedCanvas.parentNode.removeChild(clonedCanvas);
      var words = clone.querySelectorAll ? clone.querySelectorAll('.native-cadenza-glow-word') : [];
      Array.prototype.forEach.call(words, function(word) {
        word.style.opacity = Math.max(0.46, Number(word.style.opacity) || 0.46);
      });
      return clone;
    }

    return {
      kind: 'canvas-dom',
      mount: mount,
      setDocument: setDocument,
      update: update,
      resize: resize,
      setResourcePolicy: setResourcePolicy,
      release: release,
      resume: resume,
      destroy: destroy,
      captureTransition: captureTransition,
      snapshot: function() {
        return {
          domNodes: stage ? stage.querySelectorAll('*').length + 1 : 0,
          canvases: canvas ? 2 : 0,
          cacheEntries: modelCache.size,
          cacheBytes: modelCache.size * 12288,
        };
      },
    };
  }

  return { createCadenzaRenderer: createCadenzaRenderer };
});
