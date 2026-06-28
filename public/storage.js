(function(root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioStorage = api.createMineradioStorage({ root: root });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(globalRoot) {
  var DEFAULT_DEBOUNCE_MS = 320;

  function createMineradioStorage(options) {
    options = options || {};
    var root = options.root || globalRoot || {};
    var localStore = options.localStorage || root.localStorage;
    var setTimer = options.setTimeout || root.setTimeout || setTimeout;
    var clearTimer = options.clearTimeout || root.clearTimeout || clearTimeout;
    var pending = new Map();

    function getItem(key, fallback) {
      try {
        var value = localStore && localStore.getItem(String(key));
        return value == null ? fallback : value;
      } catch (e) {
        return fallback;
      }
    }

    function setItem(key, value) {
      try {
        if (!localStore) return false;
        localStore.setItem(String(key), String(value));
        return true;
      } catch (e) {
        return false;
      }
    }

    function removeItem(key) {
      try {
        if (!localStore) return false;
        localStore.removeItem(String(key));
        return true;
      } catch (e) {
        return false;
      }
    }

    function getJson(key, fallback) {
      var value = getItem(key, null);
      if (value == null || value === '') return fallback;
      try { return JSON.parse(value); } catch (e) { return fallback; }
    }

    function setJson(key, value) {
      try { return setItem(key, JSON.stringify(value)); } catch (e) { return false; }
    }

    function commitPending(key) {
      var entry = pending.get(key);
      if (!entry) return false;
      pending.delete(key);
      return setItem(key, entry.value);
    }

    function setItemDebounced(key, value, delayMs) {
      key = String(key);
      var existing = pending.get(key);
      if (existing && existing.timer) clearTimer(existing.timer);
      var entry = {
        value: String(value),
        timer: null,
      };
      entry.timer = setTimer(function() {
        commitPending(key);
      }, Math.max(0, Number(delayMs) || DEFAULT_DEBOUNCE_MS));
      pending.set(key, entry);
      return true;
    }

    function setJsonDebounced(key, value, delayMs) {
      try { return setItemDebounced(key, JSON.stringify(value), delayMs); } catch (e) { return false; }
    }

    function flush() {
      Array.from(pending.keys()).forEach(function(key) {
        var entry = pending.get(key);
        if (entry && entry.timer) clearTimer(entry.timer);
        commitPending(key);
      });
    }

    if (root && typeof root.addEventListener === 'function') {
      root.addEventListener('pagehide', flush);
      root.addEventListener('beforeunload', flush);
    }

    return {
      DEFAULT_DEBOUNCE_MS: DEFAULT_DEBOUNCE_MS,
      flush: flush,
      getItem: getItem,
      getJson: getJson,
      removeItem: removeItem,
      setItem: setItem,
      setItemDebounced: setItemDebounced,
      setJson: setJson,
      setJsonDebounced: setJsonDebounced,
    };
  }

  return {
    DEFAULT_DEBOUNCE_MS: DEFAULT_DEBOUNCE_MS,
    createMineradioStorage: createMineradioStorage,
  };
});
