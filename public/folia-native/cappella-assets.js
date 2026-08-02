(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricCappellaAssets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var DATABASE_NAME = 'mineradio-native-lyric-assets-v1';
  var STORE_NAME = 'cappella-assets';

  function createObjectUrlPool(urlApi) {
    urlApi = urlApi || (typeof URL !== 'undefined' ? URL : null);
    var urls = [];
    return {
      create: function(blob) {
        if (!urlApi || typeof urlApi.createObjectURL !== 'function') return '';
        var url = urlApi.createObjectURL(blob);
        urls.push(url);
        return url;
      },
      release: function() {
        if (urlApi && typeof urlApi.revokeObjectURL === 'function') {
          urls.forEach(function(url) { urlApi.revokeObjectURL(url); });
        }
        urls.length = 0;
      },
      size: function() { return urls.length; },
    };
  }

  function createCappellaAssetStore(indexedDbApi) {
    indexedDbApi = indexedDbApi || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    var databasePromise = null;

    function open() {
      if (!indexedDbApi) return Promise.reject(new Error('IndexedDB is unavailable'));
      if (databasePromise) return databasePromise;
      databasePromise = new Promise(function(resolve, reject) {
        var request = indexedDbApi.open(DATABASE_NAME, 1);
        request.onupgradeneeded = function() {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        request.onsuccess = function() { resolve(request.result); };
        request.onerror = function() { reject(request.error || new Error('Unable to open Cappella asset store')); };
      });
      return databasePromise;
    }

    function transaction(mode, action) {
      return open().then(function(database) {
        return new Promise(function(resolve, reject) {
          var tx = database.transaction(STORE_NAME, mode);
          var store = tx.objectStore(STORE_NAME);
          var request = action(store);
          request.onsuccess = function() { resolve(request.result); };
          request.onerror = function() { reject(request.error || new Error('Cappella asset transaction failed')); };
        });
      });
    }

    return {
      save: function(kind, asset) {
        asset = asset || {};
        var id = String(asset.id || kind + '-' + Date.now());
        return transaction('readwrite', function(store) {
          return store.put({ id: id, kind: kind === 'emoji' ? 'emoji' : 'avatar', name: String(asset.name || id), blob: asset.blob, updatedAt: Date.now() });
        }).then(function() { return id; });
      },
      list: function(kind) {
        return transaction('readonly', function(store) { return store.getAll(); }).then(function(items) {
          return (items || []).filter(function(item) { return !kind || item.kind === kind; });
        });
      },
      remove: function(id) {
        return transaction('readwrite', function(store) { return store.delete(String(id)); });
      },
      close: function() {
        if (databasePromise) databasePromise.then(function(database) { database.close(); });
        databasePromise = null;
      },
    };
  }

  return {
    DATABASE_NAME: DATABASE_NAME,
    createObjectUrlPool: createObjectUrlPool,
    createCappellaAssetStore: createCappellaAssetStore,
  };
});
