const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clampContentIndex,
  contentListStableKey,
  contentListViewportProfile,
  contentIndexFromPlayableIndex,
  detailChromeKind,
  normalizeDetailView,
  normalizeShelfViewportLock,
  playableIndexFromContentIndex,
  recordStageStep,
  recordCardLayout,
  recordShelfCardAction,
  recordToolbarLayout,
  resolveDetailOrientation,
  isShelfViewportProjectionSafe,
  canRevealBottomControlsForShelf,
  shelfControlBounds,
  shelfParallaxValue,
  shelfViewportScaleFactor,
  shouldApplyStartupStarfieldPreview,
  shouldCaptureShelfViewportAnchor,
  shouldContentShelfHandleWheel,
  shouldBindShelfToPresetCamera,
  shouldBindShelfToBackgroundMotion,
  shouldUsePresetShelfLayout,
  resolveShelfLayoutPreset,
  shelfReferenceCameraOrbit,
  shouldResetShelfAnchorForContentOpen,
  shouldResetShelfAnchorForContentClose,
  shouldResetShelfAnchorForPlaybackVisual,
  shouldSnapShelfControlsLift,
  shouldPreserveShelfViewportAnchorOnReset,
  playlistShelfCardAction,
  shelfBeatMotion,
  shelfMotionBinding,
  shelfRenderCameraMode,
  stageShelfControlsLift,
} = require('../public/content-shelf-state');

test('normalizes unsupported detail views to list', () => {
  assert.equal(normalizeDetailView('record'), 'record');
  assert.equal(normalizeDetailView('list'), 'list');
  assert.equal(normalizeDetailView('records'), 'list');
  assert.equal(normalizeDetailView(null), 'list');
});

test('record detail orientation follows shelf mode', () => {
  assert.equal(resolveDetailOrientation('side', 'record'), 'side');
  assert.equal(resolveDetailOrientation('stage', 'record'), 'stage');
  assert.equal(resolveDetailOrientation('off', 'record'), 'side');
  assert.equal(resolveDetailOrientation('stage', 'list'), 'list');
});

test('selects chrome kind for detail views', () => {
  assert.equal(detailChromeKind('playlist', 'record'), 'toolbar');
  assert.equal(detailChromeKind('playlist', 'list'), 'panel');
  assert.equal(detailChromeKind('podcast', 'record'), 'panel');
  assert.equal(detailChromeKind('podcast', 'list'), 'panel');
});

test('scales record stage spacing to match shelf card density', () => {
  assert.equal(recordStageStep(1.55), 1.55 * 0.98 / 2.05);
  assert.equal(recordStageStep('bad'), 0);
});

test('uses a fixed floating action stack for record toolbar controls', () => {
  assert.equal(recordToolbarLayout('stage'), 'fab-stack');
  assert.equal(recordToolbarLayout('side'), 'fab-stack');
  assert.equal(recordToolbarLayout('off'), 'fab-stack');
});

test('selects shelf motion binding from independent viewport lock', () => {
  assert.equal(shelfMotionBinding(true), 'locked');
  assert.equal(shelfMotionBinding(undefined), 'locked');
  assert.equal(shelfMotionBinding(false), 'dynamic');
  assert.equal(shelfMotionBinding('off'), 'dynamic');
});

test('keeps preset shelf camera binding out of independent viewport lock', () => {
  assert.equal(shouldBindShelfToPresetCamera(true), false);
  assert.equal(shouldBindShelfToPresetCamera(undefined), false);
  assert.equal(shouldBindShelfToPresetCamera(false), true);
  assert.equal(shouldBindShelfToPresetCamera('off'), true);
});

test('keeps background motion binding out of independent viewport lock', () => {
  assert.equal(shouldBindShelfToBackgroundMotion(true), false);
  assert.equal(shouldBindShelfToBackgroundMotion(undefined), false);
  assert.equal(shouldBindShelfToBackgroundMotion(false), true);
  assert.equal(shouldBindShelfToBackgroundMotion('off'), true);
});

test('keeps preset-specific shelf layout out of independent viewport lock', () => {
  assert.equal(shouldUsePresetShelfLayout(true), false);
  assert.equal(shouldUsePresetShelfLayout(undefined), false);
  assert.equal(shouldUsePresetShelfLayout(false), true);
  assert.equal(shouldUsePresetShelfLayout('off'), true);
});

test('renders independent shelf with the Emily reference camera instead of the preset camera', () => {
  assert.equal(shelfRenderCameraMode(true), 'reference');
  assert.equal(shelfRenderCameraMode(undefined), 'reference');
  assert.equal(shelfRenderCameraMode(false), 'main');
  assert.equal(shelfRenderCameraMode('off'), 'main');
});

test('resolves independent shelf layout to the Emily baseline preset', () => {
  for (const preset of [0, 1, 2, 3, 4, 5, 6]) {
    assert.equal(resolveShelfLayoutPreset(true, preset), 0);
    assert.equal(resolveShelfLayoutPreset(undefined, preset), 0);
  }
  assert.equal(resolveShelfLayoutPreset(false, 5), 5);
  assert.equal(resolveShelfLayoutPreset('off', 6), 6);
  assert.equal(resolveShelfLayoutPreset(false, 'bad'), 0);
});

test('resolves independent shelf reference camera to the Emily baseline camera', () => {
  assert.deepEqual(shelfReferenceCameraOrbit(true, 5), { theta: 0, phi: 0.08, radius: 6.6 });
  assert.deepEqual(shelfReferenceCameraOrbit(undefined, 6), { theta: 0, phi: 0.08, radius: 6.6 });
  assert.deepEqual(shelfReferenceCameraOrbit(false, 5), { theta: -0.52, phi: 0.34, radius: 9.4 });
  assert.deepEqual(shelfReferenceCameraOrbit('off', 6), { theta: 0.18, phi: 0.10, radius: 7.4 });
});

test('routes playlist shelf card clicks to content instead of direct playlist playback', () => {
  assert.equal(playlistShelfCardAction('playlist', true), 'openContent');
  assert.equal(playlistShelfCardAction('playlist', false), 'scroll');
  assert.equal(playlistShelfCardAction('podcastCollection', true), 'openContent');
  assert.equal(playlistShelfCardAction('queue', true), 'playQueue');
  assert.equal(playlistShelfCardAction('empty', true), 'none');
});

test('routes record shelf card clicks through the whole centered card', () => {
  assert.equal(recordShelfCardAction(true, true), 'play');
  assert.equal(recordShelfCardAction(false, true), 'scroll');
  assert.equal(recordShelfCardAction(true, false), 'none');
});

test('exposes record card layout shared by drawing, hit testing and geometry', () => {
  assert.deepEqual(recordCardLayout(), {
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
  });
});

test('normalizes shelf viewport lock as enabled by default', () => {
  assert.equal(normalizeShelfViewportLock(undefined), true);
  assert.equal(normalizeShelfViewportLock(true), true);
  assert.equal(normalizeShelfViewportLock(false), false);
  assert.equal(normalizeShelfViewportLock('off'), false);
  assert.equal(normalizeShelfViewportLock('false'), false);
});

test('lifts the stage shelf when controls are visible or viewport lock reserves playback space', () => {
  assert.equal(stageShelfControlsLift(false, 1080, false), 0);
  assert.equal(stageShelfControlsLift(false, 1080, true), 0.5);
  assert.equal(stageShelfControlsLift(true, 1080, false), 0.5);
  assert.equal(stageShelfControlsLift(true, 780, false), 0.42);
  assert.equal(stageShelfControlsLift(true, 640, false), 0.34);
});

test('computes viewport scale compensation from camera distance and fov', () => {
  assert.equal(shelfViewportScaleFactor(5, 50, 5, 50), 1);
  assert.equal(shelfViewportScaleFactor(10, 50, 5, 50), 2);
  assert.ok(shelfViewportScaleFactor(5, 60, 5, 50) > 1);
  assert.equal(shelfViewportScaleFactor(0, 60, 5, 50), 1);
});

test('keeps shelf beat motion available while clamping unsafe input', () => {
  assert.deepEqual(shelfBeatMotion({}), { scale: 1, y: 0, z: 0, rotZ: 0 });
  assert.deepEqual(shelfBeatMotion({ bass: 'bad', beatPulse: NaN, beatPunch: Infinity }), { scale: 1, y: 0, z: 0, rotZ: 0 });

  const motion = shelfBeatMotion({ bass: 0.8, beatPulse: 0.7, beatPunch: 0.4 });
  assert.ok(motion.scale > 1);
  assert.ok(motion.scale <= 1.055);
  assert.ok(motion.y > 0 && motion.y <= 0.045);
  assert.ok(motion.z > 0 && motion.z <= 0.035);
  assert.ok(motion.rotZ > 0 && motion.rotZ <= 0.012);
});

test('preserves pointer parallax for shelf while clamping unsafe input', () => {
  assert.equal(shelfParallaxValue(0.42, true), 0.42);
  assert.equal(shelfParallaxValue(-0.25, false), -0.25);
  assert.equal(shelfParallaxValue('bad', false), 0);
  assert.equal(shelfParallaxValue(3.5, true), 1);
  assert.equal(shelfParallaxValue(-3.5, true), -1);
});

test('routes wheel events to content shelf only when shelf chrome or rows are hit', () => {
  assert.equal(shouldContentShelfHandleWheel({ rowHit: true }), true);
  assert.equal(shouldContentShelfHandleWheel({ rowScreenHit: true }), true);
  assert.equal(shouldContentShelfHandleWheel({ chromeHit: true }), true);
  assert.equal(shouldContentShelfHandleWheel({ chromeScreenHit: true }), true);
  assert.equal(shouldContentShelfHandleWheel({}), false);
});

test('rejects unsafe shelf viewport projections before applying lock compensation', () => {
  assert.equal(isShelfViewportProjectionSafe(0, 0, 0), true);
  assert.equal(isShelfViewportProjectionSafe(1.7, -1.7, 1.1), true);
  assert.equal(isShelfViewportProjectionSafe(2.2, 0, 0), false);
  assert.equal(isShelfViewportProjectionSafe(0, 0, 1.4), false);
  assert.equal(isShelfViewportProjectionSafe(Number.NaN, 0, 0), false);
});

test('exposes expanded shelf control bounds for DIY sliders and persistence', () => {
  assert.deepEqual(shelfControlBounds('shelfSize'), { min: 0.45, max: 1.9 });
  assert.deepEqual(shelfControlBounds('shelfOffsetX'), { min: -2.4, max: 2.4 });
  assert.deepEqual(shelfControlBounds('shelfOffsetY'), { min: -1.8, max: 1.8 });
  assert.deepEqual(shelfControlBounds('shelfOffsetZ'), { min: -1.8, max: 1.8 });
  assert.deepEqual(shelfControlBounds('shelfAngleY'), { min: -50, max: 50 });
  assert.deepEqual(shelfControlBounds('shelfGap'), { min: 0.55, max: 1.7 });
  assert.deepEqual(shelfControlBounds('unknown'), { min: 0, max: 1 });
});

test('defers shelf viewport anchor capture until startup and camera are stable', () => {
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    splashActive: true,
    cameraReady: true,
    now: 1000,
    warmupUntil: 0,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    splashRevealing: true,
    cameraReady: true,
    now: 1000,
    warmupUntil: 0,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    cameraReady: true,
    now: 1000,
    warmupUntil: 1250,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    cameraReady: false,
    now: 1000,
    warmupUntil: 0,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    cameraReady: true,
    presetTransitionActive: true,
    now: 1000,
    warmupUntil: 0,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: false,
    cameraReady: true,
    now: 1000,
    warmupUntil: 0,
  }), false);
  assert.equal(shouldCaptureShelfViewportAnchor({
    viewportLockEnabled: true,
    cameraReady: true,
    now: 1000,
    warmupUntil: 900,
  }), true);
});

test('snaps shelf controls lift after independent viewport startup or reset', () => {
  assert.equal(shouldSnapShelfControlsLift({ viewportLockEnabled: true, snapPending: true }), true);
  assert.equal(shouldSnapShelfControlsLift({ viewportLockEnabled: true, snapPending: false }), false);
  assert.equal(shouldSnapShelfControlsLift({ viewportLockEnabled: false, snapPending: true }), false);
});

test('allows bottom controls handle to override shelf suppression while keeping auto reveal quiet', () => {
  assert.equal(canRevealBottomControlsForShelf('auto', { shelfPinnedOpen: false, shelfContentOpen: false, suppressActive: false }), true);
  assert.equal(canRevealBottomControlsForShelf('auto', { shelfPinnedOpen: true, shelfContentOpen: false, suppressActive: false }), false);
  assert.equal(canRevealBottomControlsForShelf('auto', { shelfPinnedOpen: false, shelfContentOpen: true, suppressActive: false }), false);
  assert.equal(canRevealBottomControlsForShelf('auto', { shelfPinnedOpen: false, shelfContentOpen: false, suppressActive: true }), false);
  assert.equal(canRevealBottomControlsForShelf('handle', { shelfPinnedOpen: true, shelfContentOpen: true, suppressActive: true }), true);
  assert.equal(canRevealBottomControlsForShelf('handle', { homeControlsLocked: true, shelfContentOpen: true, suppressActive: true }), false);
});

test('keeps startup starfield preview away from visible shelf and restored playback state', () => {
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    shelfAlwaysVisible: false,
    playQueueLength: 0,
    currentIdx: -1,
  }), true);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    shelfAlwaysVisible: false,
    playQueueLength: 0,
    currentIdx: -1,
    splashActive: true,
  }), false);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    shelfAlwaysVisible: false,
    playQueueLength: 0,
    currentIdx: -1,
    splashActive: true,
    ignoreSplash: true,
  }), true);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'stage',
    shelfAlwaysVisible: true,
    playQueueLength: 0,
    currentIdx: -1,
  }), false);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'side',
    shelfAlwaysVisible: true,
    playQueueLength: 0,
    currentIdx: -1,
  }), false);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    playQueueLength: 1,
    currentIdx: -1,
  }), false);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    playQueueLength: 0,
    currentIdx: 0,
  }), false);
  assert.equal(shouldApplyStartupStarfieldPreview({
    shelfMode: 'off',
    playQueueLength: 0,
    currentIdx: -1,
    shelfContentOpen: true,
  }), false);
});

test('keeps shelf viewport anchor during same playback visual track switches', () => {
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    presetChanged: false,
    startupPreviewActive: false,
    homeWallpaperPreviewActive: false,
    homeVisualPresetActive: false,
  }), false);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    presetChanged: true,
  }), true);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    presetChanged: true,
  }), false);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    presetChanged: false,
    homeWallpaperPreviewActive: true,
  }), false);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    presetChanged: false,
    startupPreviewActive: true,
  }), true);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: true,
    presetChanged: false,
    homeWallpaperPreviewActive: true,
  }), true);
  assert.equal(shouldResetShelfAnchorForPlaybackVisual({
    viewportLockEnabled: false,
    presetChanged: false,
  }), true);
});

test('keeps shelf viewport anchor while closing content in independent view', () => {
  assert.equal(shouldResetShelfAnchorForContentClose({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'content-back-button',
  }), false);
  assert.equal(shouldResetShelfAnchorForContentClose({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'shelf-card-return',
  }), false);
  assert.equal(shouldResetShelfAnchorForContentClose({
    viewportLockEnabled: false,
    hasReusableAnchor: true,
    reason: 'content-back-button',
  }), true);
  assert.equal(shouldResetShelfAnchorForContentClose({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'shelf-mode-reset',
  }), true);
  assert.equal(shouldResetShelfAnchorForContentClose({
    viewportLockEnabled: true,
    hasReusableAnchor: false,
    reason: 'content-back-button',
  }), true);
});

test('keeps shelf viewport anchor while opening content in independent view', () => {
  assert.equal(shouldResetShelfAnchorForContentOpen({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'content-open',
  }), false);
  assert.equal(shouldResetShelfAnchorForContentOpen({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'content-ready',
  }), false);
  assert.equal(shouldResetShelfAnchorForContentOpen({
    viewportLockEnabled: false,
    hasReusableAnchor: true,
    reason: 'content-open',
  }), true);
  assert.equal(shouldResetShelfAnchorForContentOpen({
    viewportLockEnabled: true,
    hasReusableAnchor: false,
    reason: 'content-ready',
  }), true);
  assert.equal(shouldResetShelfAnchorForContentOpen({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'shelf-mode-reset',
  }), true);
});

test('preserves independent shelf viewport anchor across transient reset reasons', () => {
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'unsafe-projection',
  }), true);
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'shelf-mode',
  }), true);
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: false,
    hasReusableAnchor: true,
    reason: 'unsafe-projection',
  }), false);
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: true,
    hasReusableAnchor: false,
    reason: 'unsafe-projection',
  }), false);
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'splash-end',
  }), false);
  assert.equal(shouldPreserveShelfViewportAnchorOnReset({
    viewportLockEnabled: true,
    hasReusableAnchor: true,
    reason: 'disabled',
  }), false);
});

test('maps content index to playable queue index while skipping unplayable rows', () => {
  const tracks = [
    { id: 1 },
    { id: 2, noCopyrightRcmd: true },
    { id: 3 },
    { id: 4, playable: false },
    { id: 5 },
    { name: 'loading placeholder' },
  ];

  assert.equal(playableIndexFromContentIndex(tracks, 0), 0);
  assert.equal(playableIndexFromContentIndex(tracks, 1), -1);
  assert.equal(playableIndexFromContentIndex(tracks, 2), 1);
  assert.equal(playableIndexFromContentIndex(tracks, 4), 2);
  assert.equal(playableIndexFromContentIndex(tracks, 5), -1);
  assert.equal(playableIndexFromContentIndex(tracks, 99), -1);
});

test('maps playable queue index back to content index', () => {
  const tracks = [
    { id: 1 },
    { id: 2, noCopyrightRcmd: true },
    { id: 3 },
    { id: 4, playable: false },
    { id: 5 },
  ];

  assert.equal(contentIndexFromPlayableIndex(tracks, 0), 0);
  assert.equal(contentIndexFromPlayableIndex(tracks, 1), 2);
  assert.equal(contentIndexFromPlayableIndex(tracks, 2), 4);
  assert.equal(contentIndexFromPlayableIndex(tracks, -1), -1);
  assert.equal(contentIndexFromPlayableIndex(tracks, 3), -1);
});

test('clamps detail indices safely', () => {
  assert.equal(clampContentIndex(0, 3), 0);
  assert.equal(clampContentIndex(5, -4), 0);
  assert.equal(clampContentIndex(5, 99), 4);
  assert.equal(clampContentIndex(5, 2), 2);
});

test('builds stable keys for every bounded content list kind', () => {
  assert.equal(contentListStableKey('search', { provider: 'qq', id: 'abc' }, 4), 'search:qq:abc');
  assert.equal(contentListStableKey('playlist', { provider: 'netease', id: 42 }, 3), 'playlist:netease:42');
  assert.equal(contentListStableKey('comment', { id: 99 }, 1), 'comment:99');
  assert.equal(contentListStableKey('album', { id: 7 }, 2), 'album:7');
  assert.equal(contentListStableKey('recommendation', { key: 'daily' }, 0), 'recommendation:daily');
  assert.equal(contentListStableKey('search', { name: 'missing-id' }, 8), 'search:index:8');
});

test('selects bounded viewport profiles without accepting unbounded overrides', () => {
  assert.deepEqual(contentListViewportProfile('search'), {
    itemSize: 61,
    maxNodes: 18,
    overscan: 3,
  });
  assert.deepEqual(contentListViewportProfile('comment', { maxNodes: 999, overscan: -1 }), {
    itemSize: 86,
    maxNodes: 16,
    overscan: 0,
  });
});
