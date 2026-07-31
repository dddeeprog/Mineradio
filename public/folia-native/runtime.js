(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function clock() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  }

  function createNativeLyricRuntime(options) {
    options = options || {};
    var registry = options.registry;
    if (!registry || typeof registry.create !== 'function') throw new Error('A renderer registry is required');
    var fallbackMode = options.fallbackMode || 'mineradio-3d';
    var root = options.root || null;
    var active = null;
    var activeMode = '';
    var document = null;
    var viewport = null;
    var released = false;
    var destroyed = false;
    var fallbackCount = 0;
    var fallbackNotified = Object.create(null);
    var frameTimes = [];
    var layoutMs = 0;
    var switchToken = 0;
    var transitionLayers = [];
    var resourcePolicy = null;
    var scheduleTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    var cancelTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
    var transitionMaxPixels = Math.max(65536, Number(options.transitionMaxPixels) || 1920 * 1080);

    function call(renderer, method, value) {
      if (renderer && typeof renderer[method] === 'function') return renderer[method](value);
    }

    function cloneResourcePolicy(value) {
      if (!value || typeof value !== 'object') return null;
      var policy = {};
      if (value.qualityTier != null) policy.qualityTier = String(value.qualityTier);
      if (value.targetFps != null && isFinite(Number(value.targetFps))) policy.targetFps = Math.max(0, Number(value.targetFps));
      if (value.cacheBudget && typeof value.cacheBudget === 'object') {
        policy.cacheBudget = {
          maxCount: Math.max(0, Math.floor(Number(value.cacheBudget.maxCount) || 0)),
          maxBytes: Math.max(0, Math.floor(Number(value.cacheBudget.maxBytes) || 0)),
        };
      }
      if (value.textureCacheBudget && typeof value.textureCacheBudget === 'object') {
        policy.textureCacheBudget = {
          maxCount: Math.max(0, Math.floor(Number(value.textureCacheBudget.maxCount) || 0)),
          maxBytes: Math.max(0, Math.floor(Number(value.textureCacheBudget.maxBytes) || 0)),
        };
      }
      return policy;
    }

    function applyResourcePolicy() {
      if (!active || !resourcePolicy) return false;
      call(active, 'setResourcePolicy', resourcePolicy);
      return true;
    }

    function setResourcePolicy(nextPolicy) {
      resourcePolicy = cloneResourcePolicy(nextPolicy);
      try { return applyResourcePolicy(); } catch (error) {
        if (options.onError) options.onError(error, { phase: 'resource-policy', mode: activeMode });
        return false;
      }
    }

    function destroyActive() {
      if (!active) return;
      var old = active;
      active = null;
      activeMode = '';
      try { call(old, 'destroy'); } catch (error) {
        if (options.onError) options.onError(error, { phase: 'destroy' });
      }
    }

    function copyCanvasPixels(sourceRoot, cloneRoot) {
      if (!sourceRoot || !cloneRoot || typeof sourceRoot.querySelectorAll !== 'function' || typeof cloneRoot.querySelectorAll !== 'function') return;
      var sources = sourceRoot.querySelectorAll('canvas');
      var clones = cloneRoot.querySelectorAll('canvas');
      for (var index = 0; index < Math.min(sources.length, clones.length); index += 1) {
        var source = sources[index];
        var clone = clones[index];
        try {
          var sourceWidth = Math.max(1, Number(source.width) || 1);
          var sourceHeight = Math.max(1, Number(source.height) || 1);
          var rasterScale = Math.min(1, Math.sqrt(transitionMaxPixels / (sourceWidth * sourceHeight)));
          clone.width = Math.max(1, Math.round(sourceWidth * rasterScale));
          clone.height = Math.max(1, Math.round(sourceHeight * rasterScale));
          if (rasterScale < 1 && clone.style) {
            if (!clone.style.width && source.clientWidth) clone.style.width = source.clientWidth + 'px';
            if (!clone.style.height && source.clientHeight) clone.style.height = source.clientHeight + 'px';
          }
          var context = clone.getContext && clone.getContext('2d');
          if (context && sourceWidth && sourceHeight) {
            context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, clone.width, clone.height);
          }
        } catch (error) {}
      }
    }

    function captureTransitionLayer() {
      if (!active || !root) return null;
      if (typeof active.captureTransition === 'function') {
        try {
          var captured = active.captureTransition();
          if (captured) return captured;
        } catch (error) {
          if (options.onError) options.onError(error, { phase: 'capture-transition', mode: activeMode });
        }
      }
      var source = root.firstElementChild || root.firstChild;
      if (!source || typeof source.cloneNode !== 'function') return null;
      var clone = source.cloneNode(true);
      copyCanvasPixels(source, clone);
      return clone;
    }

    function isManagedTransition(value) {
      return !!(value && value.kind === 'managed-three-transition' && typeof value.release === 'function');
    }

    function releaseCapturedTransition(value) {
      if (!isManagedTransition(value)) return;
      try { value.release(); } catch (error) {
        if (options.onError) options.onError(error, { phase: 'release-unattached-transition' });
      }
    }

    function removeTransition(record) {
      var index = transitionLayers.indexOf(record);
      if (index >= 0) transitionLayers.splice(index, 1);
      if (record && record.release && !record.released) {
        record.released = true;
        try { record.release(); } catch (error) {
          if (options.onError) options.onError(error, { phase: 'release-transition' });
        }
      }
      if (record && record.node && record.node.parentNode && typeof record.node.parentNode.removeChild === 'function') {
        record.node.parentNode.removeChild(record.node);
      }
    }

    function attachTransition(node, mode) {
      clearTransitions();
      if (!node) return;
      var managed = isManagedTransition(node);
      if (!managed && (!root || typeof root.appendChild !== 'function')) return;
      var record = {
        node: managed ? null : node,
        release: managed ? node.release : null,
        released: false,
        timer: null,
      };
      if (managed) {
        transitionLayers.push(record);
        record.timer = scheduleTimeout(function() { removeTransition(record); }, 340);
        return;
      }
      if (node.classList && typeof node.classList.add === 'function') node.classList.add('native-lyric-transition-ghost');
      if (typeof node.setAttribute === 'function') {
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('data-native-lyric-transition-from', mode || '');
      }
      root.appendChild(node);
      transitionLayers.push(record);
      record.timer = scheduleTimeout(function() { removeTransition(record); }, 340);
    }

    function clearTransitions() {
      transitionLayers.slice().forEach(function(record) {
        if (record.timer != null) {
          try { cancelTimeout(record.timer); } catch (error) {}
        }
        removeTransition(record);
      });
      transitionLayers.length = 0;
    }

    function notifyFallback(mode, error) {
      fallbackCount += 1;
      if (!fallbackNotified[mode]) {
        fallbackNotified[mode] = true;
        if (typeof options.onFallback === 'function') options.onFallback({ mode: mode, error: error });
      }
    }

    function fallback(mode, error) {
      notifyFallback(mode, error);
      if (mode === fallbackMode) {
        destroyActive();
        return Promise.resolve(false);
      }
      return setMode(fallbackMode, { fallback: true });
    }

    function setMode(mode, metadata) {
      if (destroyed) return Promise.resolve(false);
      mode = String(mode || fallbackMode);
      if (active && activeMode === mode) return Promise.resolve(true);
      var token = ++switchToken;
      var started = clock();
      return registry.create(mode, { root: root, mode: mode, runtime: api }).then(function(renderer) {
        if (destroyed || token !== switchToken) {
          call(renderer, 'destroy');
          return false;
        }
        var previousMode = activeMode;
        var transition = captureTransitionLayer();
        destroyActive();
        active = renderer;
        activeMode = mode;
        try {
          call(active, 'mount', { root: root, mode: mode, runtime: api });
          if (document) call(active, 'setDocument', document);
          if (viewport) call(active, 'resize', viewport);
          applyResourcePolicy();
          if (released) call(active, 'release', 'runtime-released');
          attachTransition(transition, previousMode);
          transition = null;
          layoutMs = clock() - started;
          return true;
        } catch (error) {
          releaseCapturedTransition(transition);
          throw error;
        }
      }).catch(function(error) {
        if (metadata && metadata.fallback) {
          destroyActive();
          if (options.onError) options.onError(error, { phase: 'fallback', mode: mode });
          return false;
        }
        return fallback(mode, error);
      });
    }

    function setDocument(nextDocument) {
      document = nextDocument || null;
      if (!active) return;
      try {
        call(active, 'setDocument', document);
      } catch (error) {
        return fallback(activeMode, error);
      }
    }

    function update(frame) {
      if (!active || released || destroyed) return false;
      var started = clock();
      try {
        call(active, 'update', frame);
      } catch (error) {
        return fallback(activeMode, error);
      }
      frameTimes.push(clock() - started);
      if (frameTimes.length > 120) frameTimes.shift();
      return true;
    }

    function resize(nextViewport) {
      viewport = nextViewport || viewport;
      if (!active || !viewport) return;
      try { call(active, 'resize', viewport); } catch (error) { return fallback(activeMode, error); }
    }

    function release(reason) {
      released = true;
      clearTransitions();
      if (!active) return;
      try { call(active, 'release', reason); } catch (error) {
        if (options.onError) options.onError(error, { phase: 'release', mode: activeMode });
      }
    }

    function resume() {
      if (!active || destroyed) return false;
      released = false;
      if (typeof active.resume === 'function') active.resume();
      if (document) call(active, 'setDocument', document);
      if (viewport) call(active, 'resize', viewport);
      applyResourcePolicy();
      return true;
    }

    function destroy() {
      destroyed = true;
      released = true;
      switchToken += 1;
      clearTransitions();
      destroyActive();
      document = null;
      resourcePolicy = null;
      frameTimes.length = 0;
    }

    function snapshot() {
      var rendererSnapshot = {};
      if (active && typeof active.snapshot === 'function') {
        try { rendererSnapshot = active.snapshot() || {}; } catch (error) { rendererSnapshot = {}; }
      }
      var total = frameTimes.reduce(function(sum, value) { return sum + value; }, 0);
      return Object.assign({}, rendererSnapshot, {
        mode: activeMode || null,
        rendererKind: active && active.kind || null,
        activeRenderers: active ? 1 : 0,
        released: released,
        fallbackCount: fallbackCount,
        domNodes: Number(rendererSnapshot.domNodes) || 0,
        canvases: Number(rendererSnapshot.canvases) || 0,
        cacheEntries: Number(rendererSnapshot.cacheEntries) || 0,
        cacheBytes: Number(rendererSnapshot.cacheBytes) || 0,
        transitionLayers: Math.max(transitionLayers.length, Number(rendererSnapshot.transitionLayers) || 0),
        averageFrameMs: frameTimes.length ? total / frameTimes.length : 0,
        p95FrameMs: percentile(frameTimes, 0.95),
        layoutMs: layoutMs,
        resourcePolicy: cloneResourcePolicy(resourcePolicy),
      });
    }

    var api = {
      setMode: setMode,
      setDocument: setDocument,
      update: update,
      resize: resize,
      setResourcePolicy: setResourcePolicy,
      release: release,
      resume: resume,
      destroy: destroy,
      snapshot: snapshot,
      getMode: function() { return activeMode || null; },
      getDocument: function() { return document; },
    };
    return api;
  }

  return {
    createNativeLyricRuntime: createNativeLyricRuntime,
  };
});
