/*
 * Native DOM lyric renderer adapted from Folia Classic, Partita and Tilt.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricDomState;
  if (typeof module === 'object' && module.exports) state = require('../dom-state');
  var api = factory(state || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricSharedDom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state) {
  'use strict';

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
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

  function normalizedTransitionMode(value) {
    value = String(value || 'normal');
    return value === 'fast' || value === 'none' ? value : 'normal';
  }

  function createDomRenderer(mode, context) {
    context = context || {};
    var root = context.root || null;
    var ownerDocument = root && root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var stage = null;
    var lineHost = null;
    var translation = null;
    var lyricDocument = null;
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var currentLineIndex = -2;
    var currentModel = null;
    var currentModelKey = '';
    var currentRefs = null;
    var outgoingLine = null;
    var lineExitTimer = null;
    var modelCache = new Map();
    var measureCanvas = null;
    var measureContext = null;
    var released = false;

    function timerHost() {
      return ownerDocument && ownerDocument.defaultView || (typeof globalThis !== 'undefined' ? globalThis : null);
    }

    function clearLineTransition() {
      var host = timerHost();
      if (lineExitTimer != null && host && typeof host.clearTimeout === 'function') host.clearTimeout(lineExitTimer);
      lineExitTimer = null;
      if (outgoingLine && outgoingLine.parentNode) outgoingLine.parentNode.removeChild(outgoingLine);
      outgoingLine = null;
    }

    function clearRoot() {
      if (!root) return;
      while (root.firstChild) root.removeChild(root.firstChild);
    }

    function mount(mountContext) {
      root = root || mountContext && mountContext.root;
      ownerDocument = root && root.ownerDocument || ownerDocument;
      if (!root || !ownerDocument) throw new Error(mode + ' renderer requires a DOM root');
      released = false;
      clearRoot();
      stage = ownerDocument.createElement('section');
      stage.className = 'native-dom-lyric-stage is-' + mode;
      stage.setAttribute('aria-label', mode === 'classic' ? '流光歌词' : mode === 'partita' ? '云阶歌词' : '倾诉歌词');
      lineHost = ownerDocument.createElement('div');
      lineHost.className = 'native-dom-line-host';
      translation = ownerDocument.createElement('div');
      translation.className = 'native-dom-translation';
      stage.appendChild(lineHost);
      stage.appendChild(translation);
      root.appendChild(stage);
      root.setAttribute('aria-hidden', 'false');
      measureCanvas = ownerDocument.createElement('canvas');
      measureContext = measureCanvas.getContext && measureCanvas.getContext('2d');
    }

    function setDocument(nextDocument) {
      lyricDocument = nextDocument || null;
      currentLineIndex = -2;
      currentModel = null;
      currentModelKey = '';
      currentRefs = null;
      clearLineTransition();
      modelCache.clear();
      if (lineHost) lineHost.replaceChildren();
    }

    function modeConfig(frame) {
      return frame.config && frame.config.modes && frame.config.modes[mode] || {};
    }

    function modelKey(line, config, theme) {
      var themeKey = mode === 'classic' ? JSON.stringify({
        wordColors: theme && theme.wordColors || [],
        highlight: theme && (theme.highlight || theme.accentColor) || '',
      }) : '';
      return [mode, line.index, line.fullText, Math.round(viewport.width / 24), Math.round(viewport.height / 24), JSON.stringify(config || {}), themeKey].join('|');
    }

    function buildModel(line, config, key) {
      key = key || modelKey(line, config);
      if (modelCache.has(key)) {
        var cached = modelCache.get(key);
        modelCache.delete(key);
        modelCache.set(key, cached);
        return cached;
      }
      var model;
      if (mode === 'classic') {
        var classicScale = frameFontSize();
        if (measureContext) measureContext.font = '800 ' + classicScale + 'px "Noto Sans SC", Inter, sans-serif';
        model = state.buildClassicLineModel(line, viewport, Object.assign({}, config, {
          fontSize: classicScale,
          measureText: function(text) { return measureContext ? measureContext.measureText(text).width : Array.from(text).length * classicScale * 0.65; },
        }));
      }
      else if (mode === 'partita') model = state.buildPartitaLineModel(line, viewport, config);
      else {
        var scale = frameFontSize();
        if (measureContext) measureContext.font = '400 ' + scale + 'px "Noto Sans SC", Inter, sans-serif';
        model = state.buildTiltLineModel(line, viewport, Object.assign({}, config, {
          measureText: function(text) { return measureContext ? measureContext.measureText(text).width : Array.from(text).length * scale * 0.65; },
        }));
      }
      modelCache.set(key, model);
      while (modelCache.size > 24) modelCache.delete(modelCache.keys().next().value);
      return model;
    }

    function frameFontSize() {
      if (viewport.width < 640) return 42;
      if (viewport.width < 1000) return 56;
      return 72;
    }

    function characterSpan(character, className) {
      var span = ownerDocument.createElement('span');
      span.className = className;
      span.textContent = character.char;
      return span;
    }

    function createClassicLine(model, frame) {
      var line = ownerDocument.createElement('div');
      line.className = 'native-classic-line' + (model.useLegacyLayout ? '' : ' is-adaptive');
      line.style.perspective = model.lineLayout.perspective + 'px';
      line.setAttribute('data-transition-mode', model.renderProfile.lineTransitionMode);
      var content = ownerDocument.createElement('div');
      content.className = 'native-classic-line-content';
      content.style.justifyContent = model.lineLayout.justifyContent;
      content.style.alignItems = model.lineLayout.alignItems;
      content.style.alignContent = model.lineLayout.alignItems;
      line.appendChild(content);
      var refs = [];
      model.items.forEach(function(item) {
        var word = ownerDocument.createElement('span');
        word.className = 'native-classic-word is-waiting';
        word.style.setProperty('--word-x', item.x + 'px');
        word.style.setProperty('--word-y', item.y + 'px');
        word.style.setProperty('--word-rotate', item.rotate + 'deg');
        word.style.setProperty('--word-scale', item.scale);
        word.style.setProperty('--word-entry-x', item.entryX + 'px');
        word.style.setProperty('--word-entry-y', item.entryY + 'px');
        word.style.setProperty('--word-entry-rotate', item.entryRotate + 'deg');
        word.style.setProperty('--word-passed-rotate', item.passedRotate + 'deg');
        word.style.setProperty('--word-passed-opacity', item.passedOpacity);
        word.style.setProperty('--word-ripple-scale', item.rippleScale);
        word.style.setProperty('--word-active-color', resolveWordColor(item.text, frame.theme, frame.theme && (frame.theme.highlight || frame.theme.accentColor) || '#fff0b8'));
        word.style.marginRight = item.marginRight;
        var glow = ownerDocument.createElement('span');
        glow.className = 'native-classic-glow';
        var body = ownerDocument.createElement('span');
        body.className = 'native-classic-body';
        var bodyChars = [];
        var glowChars = [];
        item.graphemes.forEach(function(character) {
          var glowChar = characterSpan(character, 'native-classic-character');
          var bodyChar = characterSpan(character, 'native-classic-character');
          glow.appendChild(glowChar);
          body.appendChild(bodyChar);
          glowChars.push(glowChar);
          bodyChars.push(bodyChar);
        });
        word.appendChild(glow);
        word.appendChild(body);
        var ripple = null;
        if (model.isChorus && model.chorusRipple) {
          ripple = ownerDocument.createElement('span');
          ripple.className = 'native-classic-ripple';
          word.appendChild(ripple);
        }
        content.appendChild(word);
        refs.push({ word: word, bodyChars: bodyChars, glowChars: glowChars, ripple: ripple, status: '' });
      });
      return { element: line, words: refs };
    }

    function createPartitaLine(model) {
      var line = ownerDocument.createElement('div');
      line.className = 'native-partita-columns';
      var rowRefs = [];
      model.columns.forEach(function(rows, columnIndex) {
        var column = ownerDocument.createElement('div');
        column.className = 'native-partita-column';
        column.setAttribute('data-column', columnIndex);
        rows.forEach(function(row) {
          var item = ownerDocument.createElement('div');
          item.className = 'native-partita-row is-waiting';
          item.style.setProperty('--row-x', row.offsetX + 'px');
          item.style.setProperty('--row-y', row.offsetY + 'px');
          item.style.setProperty('--row-rotate', row.rotate + 'deg');
          var guide = ownerDocument.createElement('span');
          guide.className = 'native-partita-guide';
          var text = ownerDocument.createElement('span');
          text.className = 'native-partita-text';
          var characters = row.characters.map(function(character) {
            var span = characterSpan(character, 'native-partita-character is-waiting');
            text.appendChild(span);
            return span;
          });
          item.appendChild(guide);
          item.appendChild(text);
          column.appendChild(item);
          rowRefs.push({ row: row, element: item, characters: characters, status: '' });
        });
        line.appendChild(column);
      });
      return { element: line, rows: rowRefs };
    }

    function createTiltLine(model) {
      var line = ownerDocument.createElement('div');
      line.className = 'native-tilt-line';
      line.style.setProperty('--tilt-fit-scale', model.scale);
      var segmentRefs = [];
      model.segments.forEach(function(segment) {
        var element = ownerDocument.createElement('div');
        element.className = 'native-tilt-segment' + (segment.isEmphasis ? ' is-emphasis' : '');
        var characters = segment.characters.map(function(character) {
          var span = characterSpan(character, 'native-tilt-character');
          element.appendChild(span);
          return span;
        });
        line.appendChild(element);
        segmentRefs.push({ element: element, characters: characters });
      });
      return { element: line, segments: segmentRefs };
    }

    function renderLine(frame, nextModelKey) {
      if (!frame.line) {
        clearLineTransition();
        currentLineIndex = -1;
        currentModel = null;
        currentModelKey = '';
        currentRefs = null;
        lineHost.replaceChildren();
        return;
      }
      var config = modeConfig(frame);
      var previousLineIndex = currentLineIndex;
      var previousModel = currentModel;
      var previousRefs = currentRefs;
      var nextModel = buildModel(frame.line, config, nextModelKey);
      var nextRefs = mode === 'classic'
        ? createClassicLine(nextModel, frame)
        : mode === 'partita'
          ? createPartitaLine(nextModel)
          : createTiltLine(nextModel);
      var lineChanged = previousRefs && previousLineIndex !== frame.lineIndex;
      var animateLineChange = mode === 'classic' && lineChanged && !frame.reducedMotion;
      clearLineTransition();
      if (animateLineChange) {
        var previousMode = normalizedTransitionMode(previousModel && previousModel.renderProfile && previousModel.renderProfile.lineTransitionMode);
        var nextMode = normalizedTransitionMode(nextModel.renderProfile && nextModel.renderProfile.lineTransitionMode);
        previousRefs.element.classList.add('native-classic-line-exit', 'is-transition-' + previousMode);
        nextRefs.element.classList.add('native-classic-line-enter', 'is-transition-' + nextMode);
        lineHost.appendChild(nextRefs.element);
        outgoingLine = previousRefs.element;
        var duration = Math.max(previousMode === 'normal' ? 320 : previousMode === 'fast' ? 180 : 130, nextMode === 'normal' ? 320 : nextMode === 'fast' ? 180 : 0);
        var host = timerHost();
        if (host && typeof host.setTimeout === 'function') {
          lineExitTimer = host.setTimeout(function() {
            if (outgoingLine && outgoingLine.parentNode) outgoingLine.parentNode.removeChild(outgoingLine);
            outgoingLine = null;
            lineExitTimer = null;
          }, duration + 20);
        }
      } else {
        lineHost.replaceChildren(nextRefs.element);
      }
      currentModel = nextModel;
      currentModelKey = nextModelKey;
      currentRefs = nextRefs;
      currentLineIndex = frame.lineIndex;
    }

    function setStatus(element, status) {
      element.classList.toggle('is-waiting', status === 'waiting');
      element.classList.toggle('is-active', status === 'active');
      element.classList.toggle('is-passed', status === 'passed');
    }

    function updateClassic(frame) {
      var resolved = state.resolveClassicLineFrame(currentModel, frame.now);
      resolved.items.forEach(function(item, index) {
        var refs = currentRefs.words[index];
        if (!refs) return;
        if (refs.status !== item.status) {
          setStatus(refs.word, item.status);
          refs.status = item.status;
        }
        item.graphemes.forEach(function(character, charIndex) {
          setStatus(refs.bodyChars[charIndex], character.status);
          setStatus(refs.glowChars[charIndex], character.status);
          refs.glowChars[charIndex].style.setProperty('--classic-char-glow', Number(character.glow || 0).toFixed(3));
        });
      });
      if (frame.nextLine) {
        var config = modeConfig(frame);
        buildModel(frame.nextLine, config, modelKey(frame.nextLine, config, frame.theme));
      }
    }

    function updatePartita(frame) {
      currentRefs.rows.forEach(function(refs) {
        var statuses = refs.row.characters.map(function(character) {
          return frame.now < character.startTime ? 'waiting' : frame.now <= character.endTime ? 'active' : 'passed';
        });
        var rowStatus = statuses.indexOf('active') >= 0 ? 'active' : (statuses.every(function(status) { return status === 'passed'; }) ? 'passed' : 'waiting');
        if (refs.status !== rowStatus) {
          setStatus(refs.element, rowStatus);
          refs.status = rowStatus;
        }
        statuses.forEach(function(status, index) { setStatus(refs.characters[index], status); });
      });
      if (frame.nextLine) buildModel(frame.nextLine, modeConfig(frame));
    }

    function updateTilt(frame) {
      var resolved = state.resolveTiltCharacterFrame(currentModel, frame.now, modeConfig(frame));
      resolved.segments.forEach(function(segment, segmentIndex) {
        var refs = currentRefs.segments[segmentIndex];
        segment.characters.forEach(function(character, charIndex) {
          var node = refs.characters[charIndex];
          node.style.setProperty('--tilt-pulse', character.pulse);
          node.style.setProperty('--tilt-shift', character.shift + 'px');
          node.classList.toggle('is-sung', frame.now >= character.startTime);
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
      stage.style.setProperty('--native-glow', clamp(common.glow, 0, 1, 0.55));
      stage.style.setProperty('--native-scale', clamp(common.scale, 0.65, 1.8, 1));
      stage.style.setProperty('--native-font-size', frameFontSize() + 'px');
      stage.classList.toggle('is-large-surface', viewport.width * viewport.height * Math.pow(viewport.dpr || 1, 2) > 3000000);
      if (mode === 'classic') {
        var classicConfig = modeConfig(frame);
        var breathing = clamp(classicConfig.breathing, 0, 2, 1);
        var intensity = classicConfig.intensity === 'calm' || classicConfig.intensity === 'chaotic' ? classicConfig.intensity : 'normal';
        var distance = (intensity === 'calm' ? 10 : intensity === 'chaotic' ? 18 : 14) * breathing;
        stage.style.setProperty('--classic-breath-up', -distance + 'px');
        stage.style.setProperty('--classic-breath-down', distance * 0.45 + 'px');
        stage.style.setProperty('--classic-breath-scale-up', 1 + 0.01 * breathing);
        stage.style.setProperty('--classic-breath-scale-down', 1 - 0.005 * breathing);
        stage.style.setProperty('--classic-breath-duration', (intensity === 'calm' ? 8.5 : intensity === 'chaotic' ? 5.8 : 7) + 's');
      }
      if (mode === 'partita') stage.style.setProperty('--partita-guide-opacity', clamp(modeConfig(frame).guideOpacity, 0, 1, 0.28));
      if (mode === 'tilt') stage.style.setProperty('--tilt-emphasis', clamp(modeConfig(frame).emphasis, 0, 1, 0.72));
      stage.classList.toggle('is-reduced-motion', !!frame.reducedMotion);
      var translationMode = common.translationMode || 'auto';
      translation.textContent = frame.line && translationMode !== 'off' ? frame.line.translation || '' : '';
      translation.hidden = !translation.textContent;
    }

    function update(frame) {
      if (released || !stage || !lineHost) return;
      updateTheme(frame);
      var config = modeConfig(frame);
      var nextModelKey = frame.line ? modelKey(frame.line, config, frame.theme) : '';
      if (frame.lineIndex !== currentLineIndex || !currentRefs || nextModelKey !== currentModelKey) renderLine(frame, nextModelKey);
      if (!currentRefs) return;
      if (mode === 'classic') updateClassic(frame);
      else if (mode === 'partita') updatePartita(frame);
      else updateTilt(frame);
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      clearLineTransition();
      modelCache.clear();
      currentLineIndex = -2;
      currentModel = null;
      currentModelKey = '';
      currentRefs = null;
    }

    function captureTransition() {
      if (!stage || typeof stage.cloneNode !== 'function') return null;
      var clone = stage.cloneNode(true);
      clone.classList.add('is-transition-capture');
      return clone;
    }

    function release() {
      released = true;
      clearLineTransition();
      currentLineIndex = -2;
      currentModel = null;
      currentModelKey = '';
      currentRefs = null;
      modelCache.clear();
      clearRoot();
      if (root) root.setAttribute('aria-hidden', 'true');
      if (measureCanvas) {
        measureCanvas.width = 1;
        measureCanvas.height = 1;
      }
      measureCanvas = null;
      measureContext = null;
      stage = null;
      lineHost = null;
      translation = null;
    }

    function resume() {
      mount({ root: root });
    }

    function destroy() {
      release();
      lyricDocument = null;
    }

    return {
      kind: 'dom',
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
          canvases: measureCanvas ? 1 : 0,
          cacheEntries: modelCache.size,
          cacheBytes: modelCache.size * 6144,
        };
      },
    };
  }

  return {
    createDomRenderer: createDomRenderer,
  };
});
