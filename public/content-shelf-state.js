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

  function recordCardLayout() {
    return {
      canvasW: 620,
      canvasH: 760,
      worldW: 0.98,
      worldH: 1.2,
      coverX: 0,
      coverY: 0,
      coverSize: 620,
      textX: 34,
      titleY: 676,
      artistY: 718,
    };
  }

  function normalizeShelfViewportLock(value) {
    return !(value === false || value === 0 || value === '0' || value === 'false' || value === 'off');
  }

  function shelfMotionBinding(viewportLockEnabled) {
    return normalizeShelfViewportLock(viewportLockEnabled) ? 'locked' : 'dynamic';
  }

  function playlistShelfCardAction(itemType, isCenter) {
    if (!isCenter) return 'scroll';
    if (itemType === 'playlist' || itemType === 'podcastCollection') return 'openContent';
    if (itemType === 'queue') return 'playQueue';
    return 'none';
  }

  function recordShelfCardAction(isCenter, playable) {
    if (!isCenter) return 'scroll';
    return playable ? 'play' : 'none';
  }

  function stageShelfControlsLift(controlsVisible, viewportHeight, viewportLockEnabled) {
    if (!controlsVisible && viewportLockEnabled !== true) return 0;
    var h = Number(viewportHeight);
    if (!isFinite(h)) h = 1080;
    if (h <= 700) return 0.34;
    if (h <= 860) return 0.42;
    return 0.5;
  }

  function isShelfViewportProjectionSafe(x, y, z) {
    var nx = Number(x);
    var ny = Number(y);
    var nz = Number(z);
    if (!isFinite(nx) || !isFinite(ny) || !isFinite(nz)) return false;
    return Math.abs(nx) <= 1.75 && Math.abs(ny) <= 1.75 && nz >= -1.2 && nz <= 1.2;
  }

  var SHELF_CONTROL_BOUNDS = {
    shelfSize: { min: 0.45, max: 1.9 },
    shelfOffsetX: { min: -2.4, max: 2.4 },
    shelfOffsetY: { min: -1.8, max: 1.8 },
    shelfOffsetZ: { min: -1.8, max: 1.8 },
    shelfAngleY: { min: -50, max: 50 },
  };

  function shelfControlBounds(key) {
    var bounds = SHELF_CONTROL_BOUNDS[key];
    return bounds ? { min: bounds.min, max: bounds.max } : { min: 0, max: 1 };
  }

  function shouldCaptureShelfViewportAnchor(state) {
    state = state || {};
    if (!normalizeShelfViewportLock(state.viewportLockEnabled)) return false;
    if (state.splashActive || state.splashRevealing || state.warmupActive) return false;
    if (state.cameraReady === false) return false;
    var now = Number(state.now);
    var warmupUntil = Number(state.warmupUntil);
    if (isFinite(now) && isFinite(warmupUntil) && now < warmupUntil) return false;
    return true;
  }

  function shouldSnapShelfControlsLift(state) {
    state = state || {};
    return normalizeShelfViewportLock(state.viewportLockEnabled) && state.snapPending === true;
  }

  function canRevealBottomControlsForShelf(source, state) {
    state = state || {};
    if (state.homeControlsLocked) return false;
    if (source === 'handle' || source === 'force') return true;
    return !(state.shelfPinnedOpen || state.shelfContentOpen || state.suppressActive);
  }

  function shouldApplyStartupStarfieldPreview(state) {
    state = state || {};
    if (state.splashActive && state.ignoreSplash !== true) return false;
    if (state.immersiveMode || state.playing || state.audioActive) return false;
    if (state.shelfPinnedOpen || state.shelfContentOpen) return false;
    if (Number(state.currentIdx) >= 0) return false;
    if (Number(state.playQueueLength) > 0) return false;
    var shelfMode = String(state.shelfMode || 'off');
    if (shelfMode === 'stage') return false;
    if (shelfMode === 'side' && state.shelfAlwaysVisible !== false) return false;
    return true;
  }

  function shouldResetShelfAnchorForPlaybackVisual(state) {
    state = state || {};
    if (!normalizeShelfViewportLock(state.viewportLockEnabled)) return true;
    if (state.presetChanged === true) return true;
    return !!(state.startupPreviewActive || state.homeWallpaperPreviewActive || state.homeVisualPresetActive);
  }

  function shouldResetShelfAnchorForContentClose(state) {
    state = state || {};
    if (!normalizeShelfViewportLock(state.viewportLockEnabled)) return true;
    if (state.reason === 'shelf-mode-reset') return true;
    return state.hasReusableAnchor !== true;
  }

  function shelfViewportScaleFactor(currentDistance, currentFov, anchorDistance, anchorFov) {
    var cd = Math.abs(Number(currentDistance));
    var ad = Math.abs(Number(anchorDistance));
    var cf = Number(currentFov);
    var af = Number(anchorFov);
    if (!isFinite(cd) || !isFinite(ad) || !isFinite(cf) || !isFinite(af) || cd <= 0 || ad <= 0) return 1;
    var currentSpan = cd * Math.tan(cf * Math.PI / 360);
    var anchorSpan = ad * Math.tan(af * Math.PI / 360);
    if (!isFinite(currentSpan) || !isFinite(anchorSpan) || anchorSpan <= 0) return 1;
    return currentSpan / anchorSpan;
  }

  function shelfParallaxValue(value, viewportLockEnabled) {
    if (normalizeShelfViewportLock(viewportLockEnabled)) return 0;
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function shouldContentShelfHandleWheel(hitState) {
    hitState = hitState || {};
    return !!(hitState.rowHit || hitState.rowScreenHit || hitState.chromeHit || hitState.chromeScreenHit);
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
    isShelfViewportProjectionSafe: isShelfViewportProjectionSafe,
    normalizeDetailView: normalizeDetailView,
    normalizeShelfViewportLock: normalizeShelfViewportLock,
    playableIndexFromContentIndex: playableIndexFromContentIndex,
    playlistShelfCardAction: playlistShelfCardAction,
    recordCardLayout: recordCardLayout,
    recordShelfCardAction: recordShelfCardAction,
    recordStageStep: recordStageStep,
    recordToolbarLayout: recordToolbarLayout,
    resolveDetailOrientation: resolveDetailOrientation,
    shelfControlBounds: shelfControlBounds,
    shelfMotionBinding: shelfMotionBinding,
    shelfParallaxValue: shelfParallaxValue,
    shelfViewportScaleFactor: shelfViewportScaleFactor,
    canRevealBottomControlsForShelf: canRevealBottomControlsForShelf,
    shouldApplyStartupStarfieldPreview: shouldApplyStartupStarfieldPreview,
    shouldCaptureShelfViewportAnchor: shouldCaptureShelfViewportAnchor,
    shouldContentShelfHandleWheel: shouldContentShelfHandleWheel,
    shouldResetShelfAnchorForContentClose: shouldResetShelfAnchorForContentClose,
    shouldResetShelfAnchorForPlaybackVisual: shouldResetShelfAnchorForPlaybackVisual,
    shouldSnapShelfControlsLift: shouldSnapShelfControlsLift,
    stageShelfControlsLift: stageShelfControlsLift,
  };
});
