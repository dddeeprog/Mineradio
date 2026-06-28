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

  return {
    findPlaylistShelfFocus: findPlaylistShelfFocus,
    normalizePlaylistId: normalizePlaylistId,
  };
});
