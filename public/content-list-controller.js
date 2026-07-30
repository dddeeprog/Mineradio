/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioContentListController = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var LIST_PROFILES = Object.freeze({
    search: Object.freeze({ itemSize: 61, maxNodes: 18, overscan: 3 }),
    recommendation: Object.freeze({ itemSize: 176, maxNodes: 12, overscan: 2 }),
    playlist: Object.freeze({ itemSize: 66, maxNodes: 18, overscan: 3 }),
    album: Object.freeze({ itemSize: 62, maxNodes: 18, overscan: 3 }),
    comment: Object.freeze({ itemSize: 86, maxNodes: 16, overscan: 2 }),
  });

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function positiveInteger(value, fallback) {
    return Math.max(1, Math.floor(finiteNumber(value, fallback)));
  }

  function computeVisibleWindow(options) {
    options = options || {};
    var total = Math.max(0, Math.floor(finiteNumber(options.itemCount, 0)));
    var itemSize = positiveInteger(options.itemSize, 56);
    var viewportSize = Math.max(0, finiteNumber(options.viewportSize, itemSize * 6));
    var maxOffset = Math.max(0, total * itemSize - viewportSize);
    var scrollOffset = Math.max(0, Math.min(maxOffset, finiteNumber(options.scrollOffset, 0)));
    var overscan = Math.max(0, Math.floor(finiteNumber(options.overscan, 2)));
    var maxNodes = positiveInteger(options.maxNodes, 24);

    if (!total) {
      return {
        start: 0,
        end: 0,
        count: 0,
        firstVisible: -1,
        lastVisible: -1,
        before: 0,
        after: 0,
        total: 0,
        itemSize: itemSize,
      };
    }

    var firstVisible = Math.min(total - 1, Math.floor(scrollOffset / itemSize));
    var lastVisible = Math.min(
      total - 1,
      Math.max(firstVisible, Math.floor(Math.max(0, scrollOffset + viewportSize - 1) / itemSize))
    );
    var visibleCount = lastVisible - firstVisible + 1;
    var desiredCount = Math.min(maxNodes, Math.max(visibleCount, visibleCount + overscan * 2));
    var start = Math.max(0, firstVisible - overscan);
    var end = Math.min(total, start + desiredCount);

    if (end - start < desiredCount) start = Math.max(0, end - desiredCount);
    if (firstVisible < start) start = firstVisible;
    if (lastVisible >= end) {
      end = lastVisible + 1;
      start = Math.max(0, end - maxNodes);
    }

    return {
      start: start,
      end: end,
      count: end - start,
      firstVisible: firstVisible,
      lastVisible: lastVisible,
      before: start * itemSize,
      after: Math.max(0, (total - end) * itemSize),
      total: total,
      itemSize: itemSize,
    };
  }

  function defaultKey(item, index) {
    if (item && item.key != null && String(item.key)) return String(item.key);
    if (item && item.id != null && String(item.id)) return String(item.id);
    return 'index:' + index;
  }

  function normalizedErrorCode(error) {
    var value = error && (error.code || error.errorCode);
    value = String(value || 'CONTENT_PAGE_FAILED').trim();
    return /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : 'CONTENT_PAGE_FAILED';
  }

  function createController(options) {
    options = options || {};
    var getKey = typeof options.getKey === 'function' ? options.getKey : defaultKey;
    var itemSize = positiveInteger(options.itemSize, 56);
    var overscan = Math.max(0, Math.floor(finiteNumber(options.overscan, 2)));
    var maxNodes = positiveInteger(options.maxNodes, 24);
    var onDispose = typeof options.onDispose === 'function' ? options.onDispose : function() {};
    var loadPage = typeof options.loadPage === 'function' ? options.loadPage : null;
    var list = [];
    var sourceItems = null;
    var sourceLength = -1;
    var keyToIndex = Object.create(null);
    var mounted = [];
    var selectedKey = '';
    var focusedKey = '';
    var anchor = null;
    var released = false;
    var documentGeneration = 0;
    var page = {
      cursor: options.cursor == null ? null : options.cursor,
      errorCode: '',
      hasMore: options.hasMore === true,
      loading: false,
    };
    var inFlight = null;

    function keyFor(item, index) {
      var key = getKey(item, index);
      key = key == null ? '' : String(key);
      return key || ('index:' + index);
    }

    function rebuildIndex() {
      keyToIndex = Object.create(null);
      for (var index = 0; index < list.length; index += 1) {
        keyToIndex[keyFor(list[index], index)] = index;
      }
    }

    function normalizeItems(items) {
      var input = Array.isArray(items) ? items : [];
      var seen = Object.create(null);
      var output = [];
      for (var index = 0; index < input.length; index += 1) {
        var key = keyFor(input[index], index);
        if (seen[key]) continue;
        seen[key] = true;
        output.push(input[index]);
      }
      return output;
    }

    function setItems(items, state) {
      var input = Array.isArray(items) ? items : [];
      if (input !== sourceItems || input.length !== sourceLength) {
        documentGeneration += 1;
        list = normalizeItems(input);
        sourceItems = input;
        sourceLength = input.length;
        rebuildIndex();
      }
      released = false;
      state = state || {};
      if (Object.prototype.hasOwnProperty.call(state, 'cursor')) page.cursor = state.cursor;
      if (Object.prototype.hasOwnProperty.call(state, 'hasMore')) page.hasMore = state.hasMore === true;
      if (state.clearPageError) page.errorCode = '';
      if (selectedKey && keyToIndex[selectedKey] == null) selectedKey = '';
      if (focusedKey && keyToIndex[focusedKey] == null) focusedKey = '';
      return list.slice();
    }

    function appendItems(items) {
      var input = Array.isArray(items) ? items : [];
      var seen = Object.create(null);
      var baseLength = list.length;
      for (var i = 0; i < list.length; i += 1) seen[keyFor(list[i], i)] = true;
      for (var index = 0; index < input.length; index += 1) {
        var key = keyFor(input[index], baseLength + index);
        if (seen[key]) continue;
        seen[key] = true;
        list.push(input[index]);
      }
      sourceItems = null;
      sourceLength = -1;
      rebuildIndex();
    }

    function getWindow(viewport) {
      viewport = viewport || {};
      var windowInfo = computeVisibleWindow({
        itemCount: list.length,
        itemSize: viewport.itemSize || itemSize,
        maxNodes: viewport.maxNodes || maxNodes,
        overscan: viewport.overscan == null ? overscan : viewport.overscan,
        scrollOffset: viewport.scrollOffset,
        viewportSize: viewport.viewportSize,
      });
      var rows = [];
      for (var index = windowInfo.start; index < windowInfo.end; index += 1) {
        rows.push({
          index: index,
          item: list[index],
          key: keyFor(list[index], index),
          selected: keyFor(list[index], index) === selectedKey,
          focused: keyFor(list[index], index) === focusedKey,
        });
      }
      windowInfo.items = rows;
      return windowInfo;
    }

    function reconcile(viewport) {
      var windowInfo = getWindow(viewport);
      var nextMounted = windowInfo.items.map(function(row) { return row.key; });
      var previousSet = Object.create(null);
      var nextSet = Object.create(null);
      mounted.forEach(function(key) { previousSet[key] = true; });
      nextMounted.forEach(function(key) { nextSet[key] = true; });
      var created = nextMounted.filter(function(key) { return !previousSet[key]; });
      var reused = nextMounted.filter(function(key) { return previousSet[key]; });
      var disposed = mounted.filter(function(key) { return !nextSet[key]; });
      disposed.forEach(function(key) { onDispose(key); });
      mounted = nextMounted;
      windowInfo.created = created;
      windowInfo.reused = reused;
      windowInfo.disposed = disposed;
      return windowInfo;
    }

    function select(key) {
      key = key == null ? '' : String(key);
      selectedKey = key && keyToIndex[key] != null ? key : '';
      return selectedKey;
    }

    function focus(key) {
      key = key == null ? '' : String(key);
      focusedKey = key && keyToIndex[key] != null ? key : '';
      return focusedKey;
    }

    function captureAnchor(value) {
      value = value || {};
      var key = value.key == null ? '' : String(value.key);
      if (!key || keyToIndex[key] == null) {
        anchor = null;
        return null;
      }
      anchor = {
        key: key,
        offset: finiteNumber(value.offset, 0),
      };
      return { key: anchor.key, offset: anchor.offset };
    }

    function restoreAnchor() {
      if (!anchor || keyToIndex[anchor.key] == null) return null;
      var index = keyToIndex[anchor.key];
      return {
        key: anchor.key,
        index: index,
        scrollOffset: index * itemSize + anchor.offset,
      };
    }

    function loadNextPage() {
      if (inFlight) return inFlight;
      if (!loadPage || !page.hasMore) {
        return Promise.resolve({ ok: true, skipped: true, items: list.slice() });
      }
      page.loading = true;
      page.errorCode = '';
      var cursor = page.cursor;
      var loadGeneration = documentGeneration;
      var request;
      try {
        request = loadPage({ cursor: cursor, items: list.slice() });
      } catch (error) {
        request = Promise.reject(error);
      }
      inFlight = Promise.resolve(request).then(function(result) {
        if (released || loadGeneration !== documentGeneration) {
          return { ok: false, stale: true, items: list.slice(), page: Object.assign({}, page) };
        }
        result = result && typeof result === 'object' ? result : {};
        appendItems(result.items);
        page.cursor = Object.prototype.hasOwnProperty.call(result, 'cursor') ? result.cursor : null;
        page.hasMore = result.hasMore === true;
        page.errorCode = '';
        return { ok: true, items: list.slice(), page: Object.assign({}, page) };
      }).catch(function(error) {
        if (released || loadGeneration !== documentGeneration) {
          return { ok: false, stale: true, items: list.slice(), page: Object.assign({}, page) };
        }
        page.errorCode = normalizedErrorCode(error);
        throw error;
      }).finally(function() {
        page.loading = false;
        inFlight = null;
      });
      return inFlight;
    }

    function release() {
      documentGeneration += 1;
      mounted.forEach(function(key) { onDispose(key); });
      mounted = [];
      list = [];
      sourceItems = null;
      sourceLength = -1;
      keyToIndex = Object.create(null);
      selectedKey = '';
      released = true;
      focusedKey = '';
      anchor = null;
      page.cursor = null;
      page.errorCode = '';
      page.hasMore = false;
      page.loading = false;
    }

    function snapshot() {
      return {
        total: list.length,
        mountedCount: mounted.length,
        mountedKeys: mounted.slice(),
        selectedKey: selectedKey,
        focusedKey: focusedKey,
        anchorKey: anchor && anchor.key || '',
        released: released,
        page: Object.assign({}, page),
      };
    }

    return {
      appendItems: appendItems,
      captureAnchor: captureAnchor,
      focus: focus,
      getWindow: getWindow,
      items: function() { return list.slice(); },
      loadNextPage: loadNextPage,
      reconcile: reconcile,
      release: release,
      restoreAnchor: restoreAnchor,
      select: select,
      setItems: setItems,
      snapshot: snapshot,
    };
  }

  return {
    LIST_PROFILES: LIST_PROFILES,
    computeVisibleWindow: computeVisibleWindow,
    createController: createController,
  };
});
