(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlatformSearchUI = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
  'use strict';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireFunction(value, name) {
    if (typeof value !== 'function') throw new TypeError(name + ' is required');
    return value;
  }

  function optionalFunction(value) {
    return typeof value === 'function' ? value : function() {};
  }

  function createController(options) {
    options = isRecord(options) ? options : {};
    var stateApi = options.stateApi
      || (root && root.MineradioPlatformSearch);
    if (!stateApi || typeof stateApi.createSession !== 'function') {
      throw new TypeError('stateApi is required');
    }
    var requestJson = requireFunction(options.requestJson, 'requestJson');
    var onUpdate = optionalFunction(options.onUpdate);
    var onComplete = optionalFunction(options.onComplete);
    var capabilityMap = null;
    var capabilityPromise = null;
    var activeSession = null;
    var generation = 0;

    function notify(session, meta) {
      try {
        onUpdate(session, meta || {});
      } catch (_) {}
    }

    function complete(session, meta) {
      try {
        onComplete(session, meta || {});
      } catch (_) {}
    }

    function loadCapabilities(force) {
      if (!force && capabilityMap) return Promise.resolve(capabilityMap);
      if (!force && capabilityPromise) return capabilityPromise;
      capabilityPromise = Promise.resolve()
        .then(function() {
          return requestJson('/api/platform/capabilities');
        })
        .then(function(snapshot) {
          capabilityMap = stateApi.normalizeCapabilitySnapshot(snapshot);
          return capabilityMap;
        })
        .catch(function() {
          capabilityMap = stateApi.normalizeCapabilitySnapshot(null);
          return capabilityMap;
        })
        .finally(function() {
          capabilityPromise = null;
        });
      return capabilityPromise;
    }

    function isActive(session, token) {
      return token === generation && activeSession === session;
    }

    function runRequests(session, requests, token, phase) {
      var tasks = requests.map(function(request) {
        return Promise.resolve()
          .then(function() {
            return requestJson(request.url);
          })
          .then(function(payload) {
            if (!isActive(session, token)) return;
            stateApi.applyProviderResponse(
              session,
              request.provider,
              payload
            );
            notify(session, {
              phase: 'provider',
              provider: request.provider,
              append: phase === 'more'
            });
          })
          .catch(function(error) {
            if (!isActive(session, token)) return;
            stateApi.applyProviderFailure(
              session,
              request.provider,
              error
            );
            notify(session, {
              phase: 'provider',
              provider: request.provider,
              append: phase === 'more'
            });
          });
      });
      return Promise.allSettled(tasks).then(function() {
        var stale = !isActive(session, token);
        if (!stale) {
          notify(session, {
            phase: phase === 'more' ? 'more-complete' : 'complete',
            provider: '',
            append: phase === 'more'
          });
          complete(session, {
            phase: phase,
            stale: false
          });
        }
        return {
          session: session,
          stale: stale
        };
      });
    }

    function search(searchOptions) {
      searchOptions = isRecord(searchOptions) ? searchOptions : {};
      var token = ++generation;
      return loadCapabilities(searchOptions.refreshCapabilities === true)
        .then(function(capabilities) {
          if (token !== generation) {
            return {
              session: null,
              stale: true
            };
          }
          var session = stateApi.createSession({
            query: searchOptions.query,
            mode: searchOptions.mode,
            capabilities: capabilities,
            pageLimits: searchOptions.pageLimits,
            maxResults: searchOptions.maxResults
          });
          activeSession = session;
          notify(session, {
            phase: 'start',
            provider: '',
            append: false
          });
          var requests = stateApi.takeProviderRequests(session);
          if (!requests.length) {
            notify(session, {
              phase: 'complete',
              provider: '',
              append: false
            });
            complete(session, {
              phase: 'search',
              stale: false
            });
            return {
              session: session,
              stale: false
            };
          }
          return runRequests(session, requests, token, 'search');
        });
    }

    function loadMore() {
      var session = activeSession;
      var token = generation;
      if (!session) {
        return Promise.resolve({
          session: null,
          stale: true
        });
      }
      var requests = stateApi.takeProviderRequests(session, {
        nextPage: true
      });
      if (!requests.length) {
        return Promise.resolve({
          session: session,
          stale: false
        });
      }
      notify(session, {
        phase: 'more-start',
        provider: '',
        append: true
      });
      return runRequests(session, requests, token, 'more');
    }

    function cancel() {
      generation += 1;
      activeSession = null;
    }

    return {
      cancel: cancel,
      getSession: function() {
        return activeSession;
      },
      loadCapabilities: loadCapabilities,
      loadMore: loadMore,
      search: search
    };
  }

  return {
    createController: createController
  };
});
