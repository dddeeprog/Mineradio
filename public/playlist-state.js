(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlaylistState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function normalizePlaylistId(providerOrId, id) {
    var provider = '';
    var value = id;

    if (providerOrId && typeof providerOrId === 'object') {
      provider = providerOrId.provider === 'qq' || providerOrId.source === 'qq' ? 'qq' : 'netease';
      value = providerOrId.id;
    } else if (arguments.length > 1) {
      provider = providerOrId === 'qq' ? 'qq' : 'netease';
    } else {
      value = providerOrId;
    }

    if (value == null) return '';
    var text = String(value).trim();
    if (!text) return '';
    if (text.indexOf('qq:') === 0) return text;
    return provider === 'qq' ? ('qq:' + text) : text;
  }

  function splitPlaylists(playlists) {
    var mine = [];
    var fav = [];
    (Array.isArray(playlists) ? playlists : []).forEach(function(pl) {
      if (!pl) return;
      (pl.subscribed ? fav : mine).push(pl);
    });
    return { mine: mine, fav: fav };
  }

  function findIndexByPlaylistId(items, playlistId) {
    for (var i = 0; i < items.length; i += 1) {
      if (normalizePlaylistId(items[i]) === playlistId) return i;
    }
    return -1;
  }

  function findPlaylistShelfFocus(playlists, playlistId, options) {
    var normalizedId = normalizePlaylistId(playlistId);
    if (!normalizedId) return null;

    options = options || {};
    var panes = splitPlaylists(playlists);
    var currentPane = options.currentPane === 'fav' ? 'fav' : 'mine';

    if (options.mergeCollections) {
      var merged = panes.mine.concat(panes.fav);
      var mergedIndex = findIndexByPlaylistId(merged, normalizedId);
      return mergedIndex >= 0
        ? { pane: currentPane, index: mergedIndex, playlistId: normalizedId, merged: true }
        : null;
    }

    var mineIndex = findIndexByPlaylistId(panes.mine, normalizedId);
    if (mineIndex >= 0) return { pane: 'mine', index: mineIndex, playlistId: normalizedId, merged: false };

    var favIndex = findIndexByPlaylistId(panes.fav, normalizedId);
    if (favIndex >= 0) return { pane: 'fav', index: favIndex, playlistId: normalizedId, merged: false };

    return null;
  }

  function safeErrorCode(value, fallback) {
    var code = String(value || fallback || '').trim();
    return /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : fallback;
  }

  function normalizePlaylistDetailResult(result) {
    if (!result || typeof result !== 'object') {
      return { ok: false, tracks: [], errorCode: 'PLAYLIST_DETAIL_INVALID_RESPONSE' };
    }
    if (result.error || result.success === false) {
      return {
        ok: false,
        tracks: [],
        errorCode: safeErrorCode(result.error || result.errorCode, 'PLAYLIST_DETAIL_FAILED'),
      };
    }
    if (!Array.isArray(result.tracks)) {
      return { ok: false, tracks: [], errorCode: 'PLAYLIST_DETAIL_INVALID_RESPONSE' };
    }
    return { ok: true, tracks: result.tracks, errorCode: '' };
  }

  function resolvePlaylistSubscriptionButton(playlist, access) {
    var hidden = {
      visible: false,
      enabled: false,
      subscribed: false,
      label: '',
    };
    if (!playlist || typeof playlist !== 'object'
      || playlist.provider !== 'netease'
      || playlist.owned === true
      || !access || access.visible !== true) {
      return hidden;
    }
    var subscribed = playlist.subscribed === true;
    return {
      visible: true,
      enabled: access.enabled === true,
      subscribed: subscribed,
      label: access.loginRequired === true
        ? '登录后管理'
        : (subscribed ? '取消订阅' : '订阅歌单'),
    };
  }

  function resolvePlaylistSubscriptionMutation(previous, optimistic, result) {
    if (result && typeof result === 'object' && !result.error && result.success === true) {
      return { ok: true, value: !!optimistic, errorCode: '' };
    }
    var hasFailureSignal = result && typeof result === 'object'
      && (result.error || result.errorCode || result.success === false);
    var fallback = hasFailureSignal
      ? 'PLAYLIST_SUBSCRIBE_FAILED'
      : 'PLAYLIST_SUBSCRIBE_INVALID_RESPONSE';
    return {
      ok: false,
      value: !!previous,
      errorCode: safeErrorCode(result && (result.error || result.errorCode), fallback),
    };
  }

  return {
    findPlaylistShelfFocus: findPlaylistShelfFocus,
    normalizePlaylistId: normalizePlaylistId,
    normalizePlaylistDetailResult: normalizePlaylistDetailResult,
    resolvePlaylistSubscriptionButton: resolvePlaylistSubscriptionButton,
    resolvePlaylistSubscriptionMutation: resolvePlaylistSubscriptionMutation,
  };
});
