/*
 * Native Cappella renderer adapted from Folia.
 * Source: chthollyphile/folia-major@baa5e846b7404f1893e8b7812bca79e959f21d3f
 * License: AGPL-3.0-or-later. See THIRD_PARTY_NOTICES.md.
 */
(function(root, factory) {
  var state = root && root.MineradioNativeLyricCappellaState;
  if (typeof module === 'object' && module.exports) state = require('../cappella-state');
  var api = factory(state);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCappella = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(state) {
  'use strict';

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function createCappellaRenderer(context) {
    context = context || {};
    var root = context.root || null;
    var ownerDocument = root && root.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var stage = null;
    var list = null;
    var lyricDocument = null;
    var model = null;
    var nodes = new Map();
    var metricsCache = new Map();
    var viewport = { width: 1280, height: 720, dpr: 1 };
    var measureCanvas = null;
    var measureContext = null;
    var released = false;
    var assetStore = null;
    var assetUrlPool = null;
    var customEmojiUrls = [];
    var assetModeKey = '';
    var assetChangeBound = false;
    var layoutSignature = '';
    var layoutAnimation = null;

    function rebuildModel(config) {
      var cappella = config && config.modes && config.modes.cappella || {};
      model = state && state.buildCappellaModel ? state.buildCappellaModel(lyricDocument || { lines: [] }, {
        emojiUrls: cappella.emojiPackId === 'custom-local' ? customEmojiUrls : [],
      }) : { messages: [] };
      assetModeKey = [cappella.emojiPackId || '', customEmojiUrls.length].join('|');
    }

    function loadCustomAssets() {
      var assetsApi = typeof globalThis !== 'undefined' && globalThis.MineradioNativeLyricCappellaAssets || {};
      if (!assetsApi.createCappellaAssetStore || !assetsApi.createObjectUrlPool) return;
      if (assetUrlPool) assetUrlPool.release();
      if (assetStore) assetStore.close();
      assetStore = assetsApi.createCappellaAssetStore();
      assetUrlPool = assetsApi.createObjectUrlPool();
      assetStore.list('emoji').then(function(items) {
        if (released || !assetUrlPool) return;
        customEmojiUrls = [];
        (items || []).forEach(function(item) {
          if (!item || item.kind !== 'emoji' || !item.blob) return;
          var url = assetUrlPool.create(item.blob);
          if (!url) return;
          customEmojiUrls.push(url);
        });
        assetModeKey = '';
      }).catch(function() {});
    }

    function clearRoot() {
      if (!root) return;
      while (root.firstChild) root.removeChild(root.firstChild);
    }

    function mount(mountContext) {
      root = root || mountContext && mountContext.root;
      ownerDocument = root && root.ownerDocument || ownerDocument;
      if (!root || !ownerDocument) throw new Error('Cappella renderer requires a DOM root');
      released = false;
      clearRoot();
      stage = ownerDocument.createElement('section');
      stage.className = 'native-cappella-stage';
      stage.setAttribute('aria-label', '群唱歌词');
      list = ownerDocument.createElement('div');
      list.className = 'native-cappella-list';
      stage.appendChild(list);
      root.appendChild(stage);
      root.setAttribute('aria-hidden', 'false');
      if (ownerDocument.createElement) {
        measureCanvas = ownerDocument.createElement('canvas');
        measureContext = measureCanvas.getContext && measureCanvas.getContext('2d');
      }
      loadCustomAssets();
      if (!assetChangeBound && typeof globalThis !== 'undefined' && globalThis.addEventListener) {
        globalThis.addEventListener('mineradio-cappella-assets-changed', loadCustomAssets);
        assetChangeBound = true;
      }
    }

    function setDocument(nextDocument) {
      lyricDocument = nextDocument || null;
      rebuildModel(null);
      metricsCache.clear();
      cancelLayoutAnimation();
      layoutSignature = '';
      nodes.forEach(function(node) { if (node.parentNode) node.parentNode.removeChild(node); });
      nodes.clear();
    }

    function cancelLayoutAnimation() {
      if (!layoutAnimation) return;
      try { layoutAnimation.cancel(); } catch (error) {}
      layoutAnimation = null;
    }

    function captureLayoutPositions() {
      var positions = new Map();
      if (!list) return positions;
      Array.from(list.children).forEach(function(node) {
        var key = node.getAttribute && node.getAttribute('data-message-key');
        if (key && node.getBoundingClientRect) positions.set(key, node.getBoundingClientRect().top);
      });
      return positions;
    }

    function animateLayoutShift(previousPositions, reducedMotion) {
      if (!list || reducedMotion || !previousPositions || !previousPositions.size || typeof list.animate !== 'function') return;
      var delta = 0;
      var found = Array.from(list.children).some(function(node) {
        var key = node.getAttribute && node.getAttribute('data-message-key');
        if (!key || !previousPositions.has(key) || !node.getBoundingClientRect) return false;
        delta = previousPositions.get(key) - node.getBoundingClientRect().top;
        return true;
      });
      if (!found || Math.abs(delta) < 0.5) return;
      var animation = list.animate([
        { transform: 'translateY(' + delta + 'px)' },
        { transform: 'translateY(0)' },
      ], {
        duration: 280,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'both',
      });
      layoutAnimation = animation;
      animation.onfinish = function() {
        if (layoutAnimation === animation) layoutAnimation = null;
        try { animation.cancel(); } catch (error) {}
      };
    }

    function createAvatar(message) {
      var avatar = ownerDocument.createElement('span');
      avatar.className = 'native-cappella-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      return avatar;
    }

    function createMessageNode(message) {
      var row = ownerDocument.createElement('div');
      row.className = 'native-cappella-message is-' + message.side;
      row.setAttribute('data-message-key', message.key);
      var avatar = createAvatar(message);
      var content = ownerDocument.createElement('div');
      content.className = 'native-cappella-content';
      var bubble = ownerDocument.createElement('div');
      bubble.className = 'native-cappella-bubble is-' + message.kind;
      var characters = [];
      var emoji = null;
      if (message.kind === 'emoji') {
        emoji = ownerDocument.createElement('img');
        emoji.className = 'native-cappella-emoji';
        emoji.src = message.assetUrl;
        emoji.alt = '';
        emoji.decoding = 'async';
        bubble.appendChild(emoji);
      } else if (message.kind === 'lyric') {
        message.characters.forEach(function(character, index) {
          var span = ownerDocument.createElement('span');
          span.className = 'native-cappella-character';
          span.textContent = character;
          span.style.setProperty('--char-fade', Math.max(0.04, message.fadeDurations[index] || 0.22) + 's');
          bubble.appendChild(span);
          characters.push(span);
        });
      } else {
        bubble.textContent = message.text;
      }
      var translation = ownerDocument.createElement('small');
      translation.className = 'native-cappella-translation';
      var timestamp = ownerDocument.createElement('time');
      timestamp.className = 'native-cappella-timestamp';
      timestamp.textContent = message.timestamp || '';
      content.appendChild(bubble);
      content.appendChild(translation);
      content.appendChild(timestamp);
      row.appendChild(avatar);
      row.appendChild(content);
      row.__cappella = {
        avatar: avatar,
        bubble: bubble,
        characters: characters,
        emoji: emoji,
        translation: translation,
        timestamp: timestamp,
        visibleCount: -1,
      };
      return row;
    }

    function bubbleMetrics(message, frame) {
      if (!message.line || !state || !state.prepareCappellaBubbleMetrics) return null;
      var scale = clamp(frame.config && frame.config.common && frame.config.common.scale, 0.65, 1.8, 1);
      var fontSize = clamp((message.role === 'active' ? 20 : 17) * scale, 15, 28, 18);
      var panelWidth = Math.min(896, Math.max(1, viewport.width - 32));
      var maxTextWidth = Math.max(96, Math.min(360, Math.floor(panelWidth - 88)));
      var key = [message.key, Math.round(viewport.width), fontSize.toFixed(2), maxTextWidth].join('|');
      if (metricsCache.has(key)) {
        var cached = metricsCache.get(key);
        metricsCache.delete(key);
        metricsCache.set(key, cached);
        return cached;
      }
      if (measureContext) measureContext.font = '600 ' + fontSize + 'px "Noto Sans SC", Inter, sans-serif';
      var metrics = state.prepareCappellaBubbleMetrics(message.line, {
        fontSize: fontSize,
        lineHeight: fontSize * 1.45,
        maxTextWidth: maxTextWidth,
        paddingX: 16,
        paddingY: 12,
        wrapSafety: viewport.width < 480 ? 0.78 : 0.88,
        measureText: function(text) { return measureContext ? measureContext.measureText(text || ' ').width : Array.from(text || ' ').length * fontSize; },
      });
      metricsCache.set(key, metrics);
      while (metricsCache.size > 32) metricsCache.delete(metricsCache.keys().next().value);
      return metrics;
    }

    function updateCharacters(refs, message) {
      var nextCount = Math.max(0, Math.min(refs.characters.length, message.visibleCharacterCount || 0));
      if (nextCount === refs.visibleCount) return;
      var start = Math.min(nextCount, Math.max(0, refs.visibleCount));
      var end = Math.max(nextCount, Math.max(0, refs.visibleCount));
      for (var index = start; index < end; index += 1) refs.characters[index].classList.toggle('is-visible', index < nextCount);
      if (refs.visibleCount < 0) {
        refs.characters.forEach(function(character, index) { character.classList.toggle('is-visible', index < nextCount); });
      }
      refs.visibleCount = nextCount;
    }

    function updateMessageNode(node, message, frame) {
      var refs = node.__cappella;
      node.className = 'native-cappella-message is-' + message.side + ' is-' + message.role + ' is-' + message.kind;
      if (message.kind === 'lyric') {
        updateCharacters(refs, message);
        var metrics = bubbleMetrics(message, frame);
        if (metrics) {
          var size = metrics.sizes[0];
          refs.bubble.style.width = size.width + 'px';
          refs.bubble.style.minHeight = size.height + 'px';
          refs.bubble.style.fontSize = metrics.fontSize + 'px';
          refs.bubble.style.lineHeight = metrics.lineHeight + 'px';
        }
        var translationMode = frame.config && frame.config.common && frame.config.common.translationMode || 'auto';
        var translation = message.line && message.line.translation || '';
        refs.translation.textContent = translationMode !== 'off' && message.role === 'active' ? translation : '';
        refs.translation.hidden = !refs.translation.textContent;
      }
      refs.timestamp.classList.toggle('is-visible', !!message.timestampVisible);
    }

    function applyTheme(frame) {
      if (!stage) return;
      var theme = frame.theme || {};
      var common = frame.config && frame.config.common || {};
      stage.style.setProperty('--native-primary', theme.primary || '#d6f8ff');
      stage.style.setProperty('--native-secondary', theme.secondary || '#9cffdf');
      stage.style.setProperty('--native-highlight', common.accentColor || theme.highlight || '#fff0b8');
      stage.style.setProperty('--native-opacity', clamp(common.opacity, 0.2, 1, 1));
      stage.style.setProperty('--native-glow', clamp(common.glow, 0, 1, 0.55));
      stage.classList.toggle('is-reduced-motion', !!frame.reducedMotion);
    }

    function update(frame) {
      if (released || !list || !model || !state || !state.resolveCappellaFrame) return;
      applyTheme(frame || {});
      var config = frame.config && frame.config.modes && frame.config.modes.cappella || {};
      var nextAssetModeKey = [config.emojiPackId || '', customEmojiUrls.length].join('|');
      if (nextAssetModeKey !== assetModeKey) rebuildModel(frame.config);
      var resolved = state.resolveCappellaFrame(model, frame, {
        maxMessages: config.maxMessages,
        viewportHeight: viewport.height,
      });
      var nextLayoutSignature = resolved.activeLineIndex + '|' + resolved.messages.map(function(message) { return message.key; }).join('|');
      var layoutChanged = nextLayoutSignature !== layoutSignature;
      var previousPositions = layoutChanged ? captureLayoutPositions() : null;
      if (layoutChanged) cancelLayoutAnimation();
      var visibleKeys = Object.create(null);
      resolved.messages.forEach(function(message) { visibleKeys[message.key] = true; });
      nodes.forEach(function(node, key) {
        if (visibleKeys[key]) return;
        if (node.parentNode) node.parentNode.removeChild(node);
        nodes.delete(key);
      });
      resolved.messages.forEach(function(message, index) {
        var node = nodes.get(message.key);
        if (!node) {
          node = createMessageNode(message);
          nodes.set(message.key, node);
        }
        updateMessageNode(node, message, frame);
        var reference = list.children[index] || null;
        if (reference !== node) list.insertBefore(node, reference);
      });
      if (layoutChanged) animateLayoutShift(previousPositions, !!frame.reducedMotion);
      layoutSignature = nextLayoutSignature;
    }

    function resize(nextViewport) {
      viewport = Object.assign({}, viewport, nextViewport || {});
      metricsCache.clear();
    }

    function release() {
      released = true;
      cancelLayoutAnimation();
      layoutSignature = '';
      nodes.clear();
      metricsCache.clear();
      clearRoot();
      if (root) root.setAttribute('aria-hidden', 'true');
      stage = null;
      list = null;
      if (measureCanvas) {
        measureCanvas.width = 1;
        measureCanvas.height = 1;
      }
      measureCanvas = null;
      measureContext = null;
      customEmojiUrls = [];
      if (assetUrlPool) assetUrlPool.release();
      if (assetStore) assetStore.close();
      assetUrlPool = null;
      assetStore = null;
      if (assetChangeBound && typeof globalThis !== 'undefined' && globalThis.removeEventListener) {
        globalThis.removeEventListener('mineradio-cappella-assets-changed', loadCustomAssets);
        assetChangeBound = false;
      }
    }

    function destroy() {
      cancelLayoutAnimation();
      layoutSignature = '';
      release();
      lyricDocument = null;
      model = null;
    }

    function resume() {
      mount({ root: root });
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
      snapshot: function() {
        return {
          domNodes: list ? list.querySelectorAll('*').length + 2 : 0,
          canvases: measureCanvas ? 1 : 0,
          cacheEntries: metricsCache.size,
          cacheBytes: metricsCache.size * 4096,
        };
      },
    };
  }

  return {
    createCappellaRenderer: createCappellaRenderer,
  };
});
