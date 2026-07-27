(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricAdaptiveThree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function documentKey(document) {
    if (!document) return '';
    return String(document.fingerprint || document.id || document.source || 'document');
  }

  function reasonFor(error, phase) {
    var code = error && error.code ? String(error.code) : '';
    var message = error && error.message ? String(error.message) : String(error || 'unknown error');
    return [phase || 'runtime', code, message].filter(Boolean).join(': ');
  }

  function createAdaptiveThreeRenderer(options) {
    options = options || {};
    if (typeof options.createPrimary !== 'function') throw new Error('Adaptive Three renderer requires createPrimary');
    if (typeof options.createFallback !== 'function') throw new Error('Adaptive Three renderer requires createFallback');
    var mode = String(options.mode || 'classic');
    var active = null;
    var mountContext = null;
    var currentDocument = null;
    var currentDocumentKey = '';
    var latestViewport = null;
    var latestFrame = null;
    var usingFallback = false;
    var fallbackCount = 0;
    var fallbackReason = '';
    var notifiedKeys = new Set();
    var mounted = false;
    var released = false;
    var destroyed = false;
    var switching = false;
    var pendingFailure = null;

    function notifyFallback(error, phase) {
      var key = currentDocumentKey || '__unbound__';
      if (notifiedKeys.has(key)) return;
      notifiedKeys.add(key);
      if (typeof options.onFallback === 'function') {
        options.onFallback({ mode: mode, reason: reasonFor(error, phase), error: error || null });
      }
    }

    function safeDestroy(renderer) {
      if (!renderer || typeof renderer.destroy !== 'function') return;
      try { renderer.destroy(); } catch (error) {
        if (typeof options.onError === 'function') options.onError(error, { mode: mode, phase: 'destroy' });
      }
    }

    function requestFallback(error) {
      return switchToFallback(error || new Error('Three lyric fallback requested'), error && error.code === 'THREE_LYRIC_CONTEXT_LOST' ? 'context' : 'performance');
    }

    function createPrimary() {
      var renderer = options.createPrimary({ mode: mode, requestFallback: requestFallback });
      if (!renderer) throw new Error('Primary Three lyric renderer factory returned no renderer');
      return renderer;
    }

    function createFallback() {
      var renderer = options.createFallback({ mode: mode });
      if (!renderer) throw new Error('Fallback lyric renderer factory returned no renderer');
      return renderer;
    }

    function replay(renderer) {
      if (currentDocument && typeof renderer.setDocument === 'function') renderer.setDocument(currentDocument);
      if (latestViewport && typeof renderer.resize === 'function') renderer.resize(latestViewport);
      if (latestFrame && typeof renderer.update === 'function') renderer.update(latestFrame);
    }

    function switchToFallback(error, phase) {
      if (destroyed || usingFallback || switching) return false;
      switching = true;
      var previous = active;
      var candidate = null;
      usingFallback = true;
      fallbackCount += 1;
      fallbackReason = reasonFor(error, phase);
      safeDestroy(previous);
      active = null;
      notifyFallback(error, phase);
      try {
        candidate = createFallback();
        if (mounted && !released && typeof candidate.mount === 'function') candidate.mount(mountContext);
        replay(candidate);
        active = candidate;
        pendingFailure = null;
      } catch (fallbackError) {
        safeDestroy(candidate);
        active = null;
        pendingFailure = fallbackError;
        throw fallbackError;
      } finally {
        switching = false;
      }
      return true;
    }

    function invoke(method, value, phase) {
      if (pendingFailure) throw pendingFailure;
      if (!active || typeof active[method] !== 'function') return undefined;
      var target = active;
      try {
        return target[method](value);
      } catch (error) {
        if (target !== active && usingFallback) return undefined;
        if (!usingFallback && (method === 'mount' || method === 'setDocument' || method === 'update' || method === 'resize')) {
          switchToFallback(error, phase || method);
          return undefined;
        }
        throw error;
      }
    }

    function mount(context) {
      if (destroyed) throw new Error('Adaptive Three renderer is destroyed');
      mountContext = context || {};
      mounted = true;
      released = false;
      if (!active) {
        try { active = createPrimary(); }
        catch (error) {
          switchToFallback(error, 'mount');
          return;
        }
      }
      invoke('mount', mountContext, 'mount');
    }

    function retryPrimaryForDocument() {
      var previous = active;
      active = null;
      usingFallback = false;
      fallbackReason = '';
      pendingFailure = null;
      safeDestroy(previous);
      try {
        active = createPrimary();
        if (mounted && !released && typeof active.mount === 'function') active.mount(mountContext);
        replay(active);
      } catch (error) {
        switchToFallback(error, 'document-retry');
      }
    }

    function setDocument(document) {
      if (destroyed) return;
      var nextKey = documentKey(document);
      var shouldRetry = usingFallback && !!currentDocumentKey && nextKey !== currentDocumentKey;
      currentDocument = document || null;
      currentDocumentKey = nextKey;
      latestFrame = null;
      if (shouldRetry) {
        retryPrimaryForDocument();
        return;
      }
      invoke('setDocument', currentDocument, 'document');
    }

    function update(frame) {
      if (destroyed || released) return;
      latestFrame = frame || {};
      invoke('update', latestFrame, 'update');
    }

    function resize(viewport) {
      if (destroyed) return;
      latestViewport = Object.assign({}, viewport || {});
      invoke('resize', latestViewport, 'resize');
    }

    function release(reason) {
      if (destroyed || released) return;
      released = true;
      if (active && typeof active.release === 'function') active.release(reason);
    }

    function resume() {
      if (destroyed) return false;
      released = false;
      if (active && typeof active.resume === 'function') active.resume();
      return true;
    }

    function captureTransition() {
      if (!active || typeof active.captureTransition !== 'function') return null;
      return active.captureTransition();
    }

    function snapshot() {
      var activeSnapshot = active && typeof active.snapshot === 'function' ? active.snapshot() : {};
      return Object.assign({}, activeSnapshot || {}, {
        mode: mode,
        backend: usingFallback ? '2d-fallback' : 'three',
        backendFallbackCount: fallbackCount,
        backendFallbackReason: fallbackReason,
      });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      safeDestroy(active);
      active = null;
      currentDocument = null;
      latestViewport = null;
      latestFrame = null;
      pendingFailure = null;
    }

    var api = {
      mount: mount,
      setDocument: setDocument,
      update: update,
      resize: resize,
      release: release,
      resume: resume,
      captureTransition: captureTransition,
      snapshot: snapshot,
      destroy: destroy,
    };
    Object.defineProperty(api, 'kind', {
      enumerable: true,
      get: function() { return active && active.kind ? active.kind : usingFallback ? 'dom' : 'three'; },
    });
    return api;
  }

  return {
    createAdaptiveThreeRenderer: createAdaptiveThreeRenderer,
  };
});
