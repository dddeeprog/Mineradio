(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioVisualCoverState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function visualCoverPolicy(preset) {
    var id = Math.floor(Number(preset));
    if (id === 0 || id === 4) return 'cover-texture';
    if (id === 1 || id === 2) return 'palette-only';
    if (id === 3 || id === 5 || id === 6) return 'static-motion';
    return 'cover-texture';
  }

  function isForceUpdate(state) {
    state = state || {};
    return state.force === true ||
      state.manual === true ||
      state.fromResolutionChange === true ||
      state.presetChangedToCoverTexture === true;
  }

  function shouldApplyCoverTextureForPreset(state) {
    state = state || {};
    if (isForceUpdate(state)) return true;
    return visualCoverPolicy(state.preset) === 'cover-texture';
  }

  function shouldDebounceCoverTextureUpdate(state) {
    state = state || {};
    if (isForceUpdate(state)) return false;
    if (state.firstVisualPlay === true) return false;
    if (state.reason && state.reason !== 'track-switch') return false;
    return visualCoverPolicy(state.preset) === 'cover-texture';
  }

  function shouldKeepPresetMotionOnTrackChange(state) {
    state = state || {};
    if (isForceUpdate(state)) return false;
    if (state.reason && state.reason !== 'track-switch') return false;
    return visualCoverPolicy(state.preset) !== 'cover-texture';
  }

  return {
    shouldApplyCoverTextureForPreset: shouldApplyCoverTextureForPreset,
    shouldDebounceCoverTextureUpdate: shouldDebounceCoverTextureUpdate,
    shouldKeepPresetMotionOnTrackChange: shouldKeepPresetMotionOnTrackChange,
    visualCoverPolicy: visualCoverPolicy,
  };
});
