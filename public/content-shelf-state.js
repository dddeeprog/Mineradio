(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioContentShelfState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function normalizeDetailView(value) {
    return value === 'record' ? 'record' : 'list';
  }

  function resolveDetailOrientation(shelfMode, detailView) {
    if (normalizeDetailView(detailView) !== 'record') return 'list';
    return shelfMode === 'stage' ? 'stage' : 'side';
  }

  function detailChromeKind(contentKind, detailView) {
    return contentKind === 'playlist' && normalizeDetailView(detailView) === 'record' ? 'toolbar' : 'panel';
  }

  function recordStageStep(stageXStep) {
    var step = Number(stageXStep);
    if (!isFinite(step)) return 0;
    return step * 0.98 / 2.05;
  }

  function recordToolbarLayout(orientation) {
    return orientation === 'stage' ? 'horizontal' : 'vertical';
  }

  function isPlayableTrack(track) {
    if (!track) return false;
    if (!track.id) return false;
    if (track.noCopyrightRcmd) return false;
    if (track.playable === false) return false;
    return true;
  }

  function playableIndexFromContentIndex(tracks, index) {
    var items = Array.isArray(tracks) ? tracks : [];
    var target = Number(index);
    if (!isFinite(target) || target < 0 || target >= items.length) return -1;
    if (!isPlayableTrack(items[target])) return -1;

    var playableIndex = -1;
    for (var i = 0; i <= target; i += 1) {
      if (isPlayableTrack(items[i])) playableIndex += 1;
    }
    return playableIndex;
  }

  function contentIndexFromPlayableIndex(tracks, playableIndex) {
    var items = Array.isArray(tracks) ? tracks : [];
    var target = Number(playableIndex);
    if (!isFinite(target) || target < 0) return -1;

    var current = -1;
    for (var i = 0; i < items.length; i += 1) {
      if (!isPlayableTrack(items[i])) continue;
      current += 1;
      if (current === target) return i;
    }
    return -1;
  }

  function clampContentIndex(total, index) {
    var count = Number(total);
    if (!isFinite(count) || count <= 0) return 0;
    var value = Number(index);
    if (!isFinite(value)) value = 0;
    value = Math.round(value);
    return Math.max(0, Math.min(count - 1, value));
  }

  return {
    clampContentIndex: clampContentIndex,
    contentIndexFromPlayableIndex: contentIndexFromPlayableIndex,
    detailChromeKind: detailChromeKind,
    normalizeDetailView: normalizeDetailView,
    playableIndexFromContentIndex: playableIndexFromContentIndex,
    recordStageStep: recordStageStep,
    recordToolbarLayout: recordToolbarLayout,
    resolveDetailOrientation: resolveDetailOrientation,
  };
});
