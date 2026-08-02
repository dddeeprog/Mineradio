(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MineradioSourceNavigation = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  var TARGETS = {
    online: true,
    playlists: true,
    local: true
  };

  function normalizeSourceNavTarget(target) {
    target = String(target || '').toLowerCase();
    return TARGETS[target] ? target : 'online';
  }

  function compactBadge(count) {
    count = Math.max(0, Math.floor(Number(count) || 0));
    if (!count) return '';
    return count > 999 ? '999+' : String(count);
  }

  function sourceNavItems(state) {
    state = state || {};
    return [
      { key: 'online', label: '在线', title: '打开在线搜索' },
      { key: 'playlists', label: '歌单', title: '打开在线歌单库' },
      { key: 'local', label: '本地', title: '导入本地音乐库', badge: compactBadge(state.localCount) }
    ];
  }

  function activeSourceNavTarget(state) {
    state = state || {};
    if (state.searchOpen) return 'online';
    if (state.playlistOpen) return 'playlists';
    if (state.currentSource === 'local') return 'local';
    return 'online';
  }

  return {
    normalizeSourceNavTarget: normalizeSourceNavTarget,
    sourceNavItems: sourceNavItems,
    activeSourceNavTarget: activeSourceNavTarget
  };
});
