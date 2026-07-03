(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioFoliaStageUi = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  var DEFAULT_STAGE_SRC = 'folia-stage/index.html?mineradioBridge=1';
  var LOAD_TIMEOUT_MS = 12000;

  function noop() {}

  function stageSrcWithBridgeMode(src) {
    src = String(src || DEFAULT_STAGE_SRC);
    if (/[?&]mineradioBridge=1(?:&|$)/.test(src)) return src;
    return src + (src.indexOf('?') >= 0 ? '&' : '?') + 'mineradioBridge=1';
  }

  function init(context) {
    context = context || {};
    var doc = context.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    var root = context.root || doc.getElementById('folia-stage-root');
    var frame = context.frame || doc.getElementById('folia-stage-frame');
    var button = context.button || doc.getElementById('folia-stage-btn');
    var bridge = context.bridge || (typeof window !== 'undefined' ? window.MineradioFoliaBridge : null);
    var body = doc.body;
    var showToast = typeof context.showToast === 'function' ? context.showToast : noop;
    var fetchImpl = context.fetch || (typeof fetch === 'function' ? fetch.bind(typeof window !== 'undefined' ? window : null) : null);
    var source = stageSrcWithBridgeMode(context.source || DEFAULT_STAGE_SRC);
    var state = {
      open: false,
      loaded: false,
      token: 0,
      timer: null,
      detachBridge: null,
    };

    function syncButton() {
      if (!button) return;
      button.classList.toggle('active', state.open);
      button.setAttribute('aria-pressed', state.open ? 'true' : 'false');
      button.title = state.open ? '关闭 Folia 歌词舞台' : '打开 Folia 歌词舞台';
    }

    function clearLoadTimer() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }

    function detachBridge() {
      if (typeof state.detachBridge === 'function') state.detachBridge();
      state.detachBridge = null;
    }

    function setClasses(open, extra) {
      if (!root) return;
      root.classList.toggle('show', !!open);
      root.classList.toggle('loading', extra === 'loading');
      root.classList.toggle('ready', extra === 'ready');
      root.classList.toggle('error', extra === 'error');
      root.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (body) body.classList.toggle('folia-stage-open', !!open);
      syncButton();
    }

    function close(reason) {
      state.token++;
      state.open = false;
      state.loaded = false;
      clearLoadTimer();
      detachBridge();
      setClasses(false);
      if (frame) {
        try { frame.removeAttribute('src'); } catch (e) {}
      }
      if (bridge && typeof bridge.push === 'function') bridge.push('folia-stage-close-' + (reason || 'manual'), { force: true });
    }

    function fallback(reason) {
      setClasses(true, 'error');
      close(reason || 'error');
      showToast(reason === 'missing'
        ? 'Folia 舞台未构建，请先运行 npm run folia:build'
        : 'Folia 舞台加载失败，已回退到 Mineradio 原歌词');
    }

    function stageAvailable() {
      if (!fetchImpl) return Promise.resolve(true);
      return fetchImpl(source, { method: 'GET', cache: 'no-store' }).then(function(res) {
        return !!(res && res.ok);
      }).catch(function() {
        return false;
      });
    }

    function handleFrameLoad(token) {
      if (token !== state.token || !state.open || !frame) return;
      state.loaded = true;
      clearLoadTimer();
      setClasses(true, 'ready');
      detachBridge();
      if (bridge && typeof bridge.registerTarget === 'function' && frame.contentWindow) {
        state.detachBridge = bridge.registerTarget(frame.contentWindow, (typeof window !== 'undefined' && window.location && window.location.origin) || '*');
      }
      if (bridge && typeof bridge.push === 'function') bridge.push('folia-stage-load', { force: true });
    }

    function open() {
      if (state.open) return;
      state.open = true;
      state.loaded = false;
      var token = ++state.token;
      setClasses(true, 'loading');
      stageAvailable().then(function(ok) {
        if (token !== state.token || !state.open) return;
        if (!ok) {
          fallback('missing');
          return;
        }
        if (!frame) {
          fallback('missing-frame');
          return;
        }
        frame.onload = function() { handleFrameLoad(token); };
        frame.onerror = function() { if (token === state.token) fallback('error'); };
        frame.src = source;
        clearLoadTimer();
        state.timer = setTimeout(function() {
          if (token === state.token && state.open && !state.loaded) fallback('timeout');
        }, LOAD_TIMEOUT_MS);
      });
    }

    function toggle() {
      if (state.open) close('toggle');
      else open();
    }

    if (button && !button._mineradioFoliaStageBound) {
      button._mineradioFoliaStageBound = true;
      button.addEventListener('click', function(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        toggle();
      });
    }

    if (root && !root._mineradioFoliaStageBound) {
      root._mineradioFoliaStageBound = true;
      root.addEventListener('click', function(e) {
        if (e.target && e.target.getAttribute && e.target.getAttribute('data-folia-stage-action') === 'close') close('button');
      });
    }

    if (doc && !doc._mineradioFoliaStageKeyBound) {
      doc._mineradioFoliaStageKeyBound = true;
      doc.addEventListener('keydown', function(e) {
        if (state.open && e.key === 'Escape') close('escape');
      });
    }

    syncButton();
    return {
      close: close,
      isOpen: function() { return state.open; },
      open: open,
      toggle: toggle,
    };
  }

  return {
    DEFAULT_STAGE_SRC: DEFAULT_STAGE_SRC,
    stageSrcWithBridgeMode: stageSrcWithBridgeMode,
    init: init,
  };
});
