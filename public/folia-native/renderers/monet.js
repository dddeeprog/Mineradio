/*
 * Native Monet renderer adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricMonetState;
  if (typeof module === 'object' && module.exports) state = require('../monet-state');
  var api = factory(state || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricMonet = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state) {
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
    return 'rgba(' + (value >> 16) + ',' + (value >> 8 & 255) + ',' + (value & 255) + ',' + alpha + ')';
  }

  function createMonetRenderer(context) {
    context = context || {};
    var root = context.root || null;
    var ownerDocument = root && root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var stage = null;
    var backdrop = null;
    var title = null;
    var artist = null;
    var album = null;
    var portrait = null;
    var rail = null;
    var audioCanvas = null;
    var audioContext = null;
    var measureCanvas = null;
    var measureContext = null;
    var lyricDocument = null;
    var posterKey = '';
    var railKey = '';
    var railRefs = [];
    var offsetCache = new Map();
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var canvasWidth = 1;
    var canvasHeight = 1;
    var released = false;

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
      if (!root || !ownerDocument) throw new Error('Monet renderer requires a DOM root');
      released = false;
      clearRoot();
      stage = element('section', 'native-monet-stage');
      stage.setAttribute('aria-label', '莫奈歌词');
      backdrop = element('div', 'native-monet-backdrop');
      var poster = element('div', 'native-monet-poster');
      var copy = element('div', 'native-monet-copy');
      artist = element('div', 'native-monet-artist');
      var rule = element('span', 'native-monet-rule');
      title = element('div', 'native-monet-title');
      album = element('div', 'native-monet-album');
      rail = element('div', 'native-monet-lyric-rail');
      copy.appendChild(artist);
      copy.appendChild(rule);
      copy.appendChild(title);
      copy.appendChild(album);
      copy.appendChild(rail);
      var portraitFrame = element('div', 'native-monet-portrait-frame');
      portrait = element('img', 'native-monet-portrait');
      portrait.alt = '';
      portrait.decoding = 'async';
      portraitFrame.appendChild(portrait);
      poster.appendChild(copy);
      poster.appendChild(portraitFrame);
      audioCanvas = element('canvas', 'native-monet-audio');
      audioContext = audioCanvas.getContext && audioCanvas.getContext('2d');
      measureCanvas = ownerDocument.createElement('canvas');
      measureContext = measureCanvas.getContext && measureCanvas.getContext('2d');
      stage.appendChild(backdrop);
      stage.appendChild(poster);
      stage.appendChild(audioCanvas);
      root.appendChild(stage);
      root.setAttribute('aria-hidden', 'false');
      resizeCanvas();
    }

    function setDocument(nextDocument) {
      lyricDocument = nextDocument || null;
      posterKey = '';
      railKey = '';
      railRefs = [];
      offsetCache.clear();
      if (rail) rail.replaceChildren();
    }

    function applyPoster(frame) {
      var poster = state.buildMonetPosterModel(lyricDocument || {}, frame.track || {}, viewport);
      var key = [poster.title, poster.artist, poster.album, poster.portraitUrl, poster.layout].join('|');
      if (key === posterKey) return;
      posterKey = key;
      title.textContent = poster.title;
      artist.textContent = poster.artist;
      album.textContent = poster.album || 'MONET';
      stage.classList.toggle('is-compact', poster.layout === 'poster-compact');
      portrait.src = poster.portraitUrl || '';
      portrait.hidden = !poster.portraitUrl;
      backdrop.style.backgroundImage = poster.backgroundUrl ? 'url("' + String(poster.backgroundUrl).replace(/"/g, '%22') + '")' : 'none';
    }

    function activeFontSize(frame) {
      var scale = clamp(frame.config && frame.config.common && frame.config.common.scale, 0.65, 1.8, 1);
      var base = viewport.width < 640 ? 26 : viewport.width < 1000 ? 31 : 38;
      return base * scale;
    }

    function createGraphemes(line, wordColors, className) {
      var colors = state.resolveMonetKeywordColors(line.fullText, wordColors);
      return line.graphemes.map(function(character, index) {
        var span = element('span', className);
        span.textContent = character.char;
        if (colors[index]) span.style.setProperty('--monet-keyword', colors[index]);
        return span;
      });
    }

    function createRail(frame) {
      var entries = state.buildMonetVisibleEntries(lyricDocument, frame.lineIndex, frame.now);
      rail.replaceChildren();
      railRefs = entries.map(function(entry) {
        var lineNode = element('div', 'native-monet-line is-' + entry.status);
        lineNode.style.setProperty('--monet-offset', entry.offset);
        var text = element('div', 'native-monet-line-text');
        var graphemes = [];
        var tail = null;
        if (entry.status === 'active') {
          var wordColors = frame.config && frame.config.modes && frame.config.modes.monet && frame.config.modes.monet.keywordColor !== false
            ? frame.theme && frame.theme.wordColors || []
            : [];
          graphemes = createGraphemes(entry.line, wordColors, 'native-monet-grapheme');
          graphemes.forEach(function(node) { text.appendChild(node); });
          tail = element('span', 'native-monet-sweep-tail');
          text.appendChild(tail);
        } else {
          text.textContent = entry.line.fullText;
        }
        lineNode.appendChild(text);
        var translation = element('div', 'native-monet-line-translation');
        translation.textContent = entry.status === 'active' ? entry.line.translation || '' : '';
        translation.hidden = !translation.textContent;
        lineNode.appendChild(translation);
        rail.appendChild(lineNode);
        return { entry: entry, element: lineNode, text: text, graphemes: graphemes, tail: tail };
      });
      railKey = [frame.lineIndex, frame.theme && JSON.stringify(frame.theme.wordColors || []), frame.config && frame.config.modes.monet.keywordColor].join('|');
    }

    function measureOffsets(line, frame) {
      var fontSize = activeFontSize(frame);
      var key = [line.index, line.fullText, fontSize.toFixed(2)].join('|');
      if (offsetCache.has(key)) return offsetCache.get(key);
      if (measureContext) measureContext.font = '700 ' + fontSize + 'px "Noto Sans SC", Inter, sans-serif';
      var offsets = state.measureMonetGraphemeOffsets(line.fullText, function(text) {
        return measureContext ? measureContext.measureText(text).width : Array.from(text).length * fontSize * 0.62;
      });
      offsetCache.set(key, offsets);
      while (offsetCache.size > 24) offsetCache.delete(offsetCache.keys().next().value);
      return offsets;
    }

    function updateSweep(frame) {
      var active = railRefs.filter(function(ref) { return ref.entry.status === 'active'; })[0];
      if (!active) return;
      var offsets = measureOffsets(active.entry.line, frame);
      var sweep = state.resolveMonetSweepModel(active.entry.line, frame.now, offsets);
      active.graphemes.forEach(function(node, index) {
        var timing = active.entry.line.graphemes[index];
        var start = timing && timing.startTime || active.entry.line.startTime;
        var end = Math.max(start + 0.001, timing && timing.endTime || active.entry.line.endTime);
        var progress = clamp((frame.now - start) / (end - start), 0, 1, 0);
        node.style.setProperty('--monet-char-fill', Math.round(progress * 100) + '%');
        node.classList.toggle('is-filled', frame.now > end);
        node.classList.toggle('is-active', frame.now >= start && frame.now <= end);
      });
      if (active.tail) {
        var ratio = sweep.totalWidth > 0 ? sweep.fillWidth / sweep.totalWidth : 0;
        active.tail.style.left = Math.round(clamp(ratio, 0, 1, 0) * 1000) / 10 + '%';
        active.tail.classList.toggle('is-visible', sweep.fillWidth > 0 && sweep.fillWidth < sweep.totalWidth);
      }
    }

    function resizeCanvas() {
      if (!audioCanvas || !audioContext) return;
      canvasWidth = Math.max(120, Math.min(450, viewport.width * 0.55));
      canvasHeight = 48;
      var dprCap = viewport.width >= 3000 ? 1.25 : 1.75;
      var dpr = Math.max(1, Math.min(dprCap, viewport.dpr || 1));
      audioCanvas.style.width = canvasWidth + 'px';
      audioCanvas.style.height = canvasHeight + 'px';
      audioCanvas.width = Math.max(1, Math.round(canvasWidth * dpr));
      audioCanvas.height = Math.max(1, Math.round(canvasHeight * dpr));
      audioContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawAudio(frame) {
      if (!audioContext || !audioCanvas) return;
      var config = frame.config && frame.config.modes && frame.config.modes.monet || {};
      var strength = clamp(config.audioOverlay, 0, 1, 0.68);
      var geometry = state.buildMonetAudioGeometry(frame.audio && frame.audio.frequencyData, canvasWidth, canvasHeight, {
        count: 72,
        energy: clamp(frame.audio && frame.audio.energy, 0, 1, 0),
      });
      var primary = frame.theme && frame.theme.primary || '#d6f8ff';
      audioContext.clearRect(0, 0, canvasWidth, canvasHeight);
      audioContext.globalAlpha = strength * 0.72;
      audioContext.fillStyle = rgba(primary, 0.88, '#d6f8ff');
      geometry.bars.forEach(function(bar) {
        audioContext.fillRect(bar.x, canvasHeight - bar.height, bar.width, bar.height);
      });
      audioContext.globalAlpha = strength;
      audioContext.beginPath();
      geometry.line.forEach(function(point, index) {
        if (index === 0) audioContext.moveTo(point.x, point.y);
        else audioContext.lineTo(point.x, point.y);
      });
      audioContext.strokeStyle = rgba(primary, 0.95, '#d6f8ff');
      audioContext.lineWidth = 1.5;
      audioContext.stroke();
      audioContext.globalAlpha = 1;
    }

    function applyTheme(frame) {
      var common = frame.config && frame.config.common || {};
      var monet = frame.config && frame.config.modes && frame.config.modes.monet || {};
      var theme = frame.theme || {};
      var contrast = clamp(monet.posterContrast, 0, 1, 0.66);
      stage.style.setProperty('--native-primary', theme.primary || '#d6f8ff');
      stage.style.setProperty('--native-secondary', theme.secondary || '#9cffdf');
      stage.style.setProperty('--native-highlight', common.accentColor || theme.highlight || '#fff0b8');
      stage.style.setProperty('--monet-contrast', contrast);
      stage.style.setProperty('--monet-backdrop-opacity', (0.12 + contrast * 0.18).toFixed(3));
      stage.style.setProperty('--native-opacity', clamp(common.opacity, 0.2, 1, 1));
      stage.style.setProperty('--monet-active-font', activeFontSize(frame) + 'px');
      stage.classList.toggle('is-reduced-motion', !!frame.reducedMotion);
      stage.classList.toggle('is-large-surface', viewport.width * viewport.height * Math.pow(viewport.dpr || 1, 2) > 3000000);
    }

    function update(frame) {
      if (released || !stage || !lyricDocument) return;
      applyTheme(frame);
      applyPoster(frame);
      var nextRailKey = [frame.lineIndex, frame.theme && JSON.stringify(frame.theme.wordColors || []), frame.config && frame.config.modes.monet.keywordColor].join('|');
      if (nextRailKey !== railKey) createRail(frame);
      updateSweep(frame);
      drawAudio(frame);
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      offsetCache.clear();
      railKey = '';
      resizeCanvas();
    }

    function captureTransition() {
      if (!stage || typeof stage.cloneNode !== 'function') return null;
      var clone = stage.cloneNode(true);
      clone.classList.add('is-transition-capture');
      var clonedBackdrop = clone.querySelector && clone.querySelector('.native-monet-backdrop');
      var clonedCanvas = clone.querySelector && clone.querySelector('.native-monet-audio');
      if (clonedBackdrop && clonedBackdrop.parentNode) clonedBackdrop.parentNode.removeChild(clonedBackdrop);
      if (clonedCanvas && clonedCanvas.parentNode) clonedCanvas.parentNode.removeChild(clonedCanvas);
      return clone;
    }

    function release() {
      released = true;
      railRefs = [];
      offsetCache.clear();
      clearRoot();
      if (root) root.setAttribute('aria-hidden', 'true');
      if (audioCanvas) {
        audioCanvas.width = 1;
        audioCanvas.height = 1;
      }
      if (measureCanvas) {
        measureCanvas.width = 1;
        measureCanvas.height = 1;
      }
      stage = backdrop = title = artist = album = portrait = rail = audioCanvas = audioContext = measureCanvas = measureContext = null;
    }

    function resume() { mount({ root: root }); }
    function destroy() { release(); lyricDocument = null; }

    return {
      kind: 'dom-canvas',
      mount: mount,
      setDocument: setDocument,
      update: update,
      resize: resize,
      release: release,
      resume: resume,
      destroy: destroy,
      captureTransition: captureTransition,
      snapshot: function() {
        return {
          domNodes: stage ? stage.querySelectorAll('*').length + 1 : 0,
          canvases: audioCanvas ? 2 : 0,
          cacheEntries: offsetCache.size,
          cacheBytes: offsetCache.size * 4096,
        };
      },
    };
  }

  return { createMonetRenderer: createMonetRenderer };
});
