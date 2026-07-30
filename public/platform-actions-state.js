(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlatformActions = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var AUTHENTICATED_ACTIONS = {
    albumCollect: true,
    playlistSubscribe: true,
    commentsLike: true,
    commentsCreate: true
  };
  var MAX_COMMENT_LENGTH = 500;

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function actionError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function actionAvailability(snapshot, provider, capability) {
    var hidden = { visible: false, enabled: false, loginRequired: false };
    if (!isRecord(snapshot) || !Array.isArray(snapshot.providers)) return hidden;
    var item = snapshot.providers.find(function(candidate) {
      return candidate && candidate.provider === provider;
    });
    if (!item || !isRecord(item.capabilities)
      || item.capabilities[capability] !== true) {
      return hidden;
    }
    if (isRecord(item.availability) && item.availability[capability] === true) {
      return { visible: true, enabled: true, loginRequired: false };
    }
    var loggedIn = item.account && item.account.loggedIn === true;
    if (AUTHENTICATED_ACTIONS[capability] && !loggedIn) {
      return { visible: true, enabled: false, loginRequired: true };
    }
    return hidden;
  }

  function createOptimisticActionStore(initialValues) {
    var values = Object.assign(
      Object.create(null),
      isRecord(initialValues) ? initialValues : {}
    );
    var pending = Object.create(null);
    var sequence = 0;

    function keyFor(value) {
      value = typeof value === 'string' ? value : '';
      if (!value) throw actionError('PLATFORM_ACTION_KEY_INVALID');
      return value;
    }

    function validToken(token) {
      if (!isRecord(token) || typeof token.key !== 'string') return false;
      return pending[token.key] === token;
    }

    return Object.freeze({
      begin: function(key, nextValue) {
        key = keyFor(key);
        if (pending[key]) return null;
        var token = Object.freeze({
          id: ++sequence,
          key: key,
          previous: values[key],
          hadPrevious: Object.prototype.hasOwnProperty.call(values, key),
          optimistic: nextValue
        });
        pending[key] = token;
        values[key] = nextValue;
        return token;
      },

      busy: function(key) {
        return Boolean(pending[keyFor(key)]);
      },

      commit: function(token, serverValue) {
        if (!validToken(token)) return false;
        if (arguments.length > 1) values[token.key] = serverValue;
        delete pending[token.key];
        return true;
      },

      rollback: function(token) {
        if (!validToken(token)) return false;
        if (token.hadPrevious) values[token.key] = token.previous;
        else delete values[token.key];
        delete pending[token.key];
        return true;
      },

      set: function(key, value) {
        key = keyFor(key);
        if (pending[key]) return false;
        values[key] = value;
        return true;
      },

      value: function(key) {
        return values[keyFor(key)];
      },

      snapshot: function() {
        return {
          values: Object.assign({}, values),
          busy: Object.keys(pending)
        };
      }
    });
  }

  function normalizeCommentContent(value) {
    var content = typeof value === 'string' ? value.trim() : '';
    if (!content || content.length > MAX_COMMENT_LENGTH) {
      throw actionError('PLATFORM_COMMENT_CONTENT_INVALID');
    }
    return content;
  }

  return {
    MAX_COMMENT_LENGTH: MAX_COMMENT_LENGTH,
    actionAvailability: actionAvailability,
    createOptimisticActionStore: createOptimisticActionStore,
    normalizeCommentContent: normalizeCommentContent
  };
});
