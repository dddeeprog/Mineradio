const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function loadGovernor() {
  return require('../public/resource-governor');
}

function activeInput(overrides = {}) {
  return Object.assign({
    now: 0,
    hidden: false,
    minimized: false,
    windowVisible: true,
    focused: true,
    locked: false,
    suspended: false,
    backgroundMode: 'auto',
    requestedQuality: 'high',
    wallpaperFrameRate: 60,
    system: {
      pressure: 'normal',
      onBattery: false,
      thermalState: 'nominal',
      speedLimit: 100,
    },
    activeFeatures: {
      autoMix: true,
      standbyMedia: true,
      sonicTopography: true,
      nativeLyrics: true,
      wallpaper: true,
      completeDesktop: true,
    },
  }, overrides);
}

test('foreground keeps requested quality without owning a second frame scheduler', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor({ recoveryHoldMs: 3000 });

  const decision = governor.update(activeInput());

  assert.equal(decision.mode, 'active');
  assert.equal(decision.qualityTier, 'high');
  assert.equal(decision.targetFps, 0);
  assert.equal(decision.wallpaperFps, 60);
  assert.deepEqual(decision.releaseSet, []);
  assert.deepEqual(decision.restoreSet, []);
  assert.equal(governor.snapshot().frameOwner, 'host');
  assert.equal(typeof governor.start, 'undefined');
});

test('hidden auto mode releases resources in order and restores them once in reverse order', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor({ recoveryHoldMs: 3000 });
  governor.update(activeInput());

  const hidden = governor.update(activeInput({ now: 100, hidden: true }));
  assert.equal(hidden.mode, 'released');
  assert.equal(hidden.qualityTier, 'eco');
  assert.equal(hidden.targetFps, 1);
  assert.equal(hidden.wallpaperFps, 12);
  assert.deepEqual(hidden.releaseSet, [
    'autoMix',
    'standbyMedia',
    'sonicTopography',
    'nativeLyrics',
  ]);
  assert.deepEqual(hidden.restoreSet, []);

  const hiddenAgain = governor.update(activeInput({ now: 200, hidden: true }));
  assert.deepEqual(hiddenAgain.releaseSet, []);
  assert.deepEqual(hiddenAgain.restoreSet, []);

  const restored = governor.update(activeInput({ now: 300, hidden: false }));
  assert.deepEqual(restored.releaseSet, []);
  assert.deepEqual(restored.restoreSet, [
    'nativeLyrics',
    'sonicTopography',
    'standbyMedia',
    'autoMix',
  ]);

  const restoredAgain = governor.update(activeInput({ now: 400 }));
  assert.deepEqual(restoredAgain.restoreSet, []);
  assert.equal(governor.snapshot().releaseCount, 4);
  assert.equal(governor.snapshot().restoreCount, 4);
});

test('locked and suspended states override keep-running background preference', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor();

  const locked = governor.update(activeInput({
    now: 100,
    locked: true,
    backgroundMode: 'keep',
  }));
  assert.equal(locked.mode, 'suspended');
  assert.equal(locked.targetFps, 1);
  assert.equal(locked.wallpaperFps, 1);
  assert.deepEqual(locked.releaseSet, [
    'autoMix',
    'standbyMedia',
    'sonicTopography',
    'nativeLyrics',
  ]);

  const resumed = governor.update(activeInput({ now: 200, backgroundMode: 'keep' }));
  assert.equal(resumed.mode, 'active');
  assert.deepEqual(resumed.restoreSet, [
    'nativeLyrics',
    'sonicTopography',
    'standbyMedia',
    'autoMix',
  ]);
});

test('power memory and frame pressure lower quality immediately but recover with hysteresis', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor({ recoveryHoldMs: 3000 });

  assert.equal(governor.update(activeInput({ now: 0 })).qualityTier, 'high');
  const constrained = governor.update(activeInput({
    now: 100,
    frameP95Ms: 38,
    system: {
      pressure: 'critical',
      onBattery: true,
      thermalState: 'serious',
      speedLimit: 60,
    },
  }));
  assert.equal(constrained.mode, 'constrained');
  assert.equal(constrained.qualityTier, 'eco');
  assert.equal(constrained.targetFps, 24);
  assert.deepEqual(constrained.releaseSet, [
    'autoMix',
    'standbyMedia',
    'sonicTopography',
  ]);

  const earlyRecovery = governor.update(activeInput({ now: 2000, frameP95Ms: 12 }));
  assert.equal(earlyRecovery.qualityTier, 'eco');
  const recovered = governor.update(activeInput({ now: 5101, frameP95Ms: 12 }));
  assert.equal(recovered.qualityTier, 'high');
  assert.deepEqual(recovered.restoreSet, ['sonicTopography', 'standbyMedia', 'autoMix']);
});

test('cache budgets include monotonic count and byte caps for every owned cache', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor();
  const active = governor.update(activeInput({ now: 0 })).cacheBudgets;
  const released = governor.update(activeInput({ now: 1, hidden: true })).cacheBudgets;
  const expectedCaches = [
    'playlistCovers',
    'coverDepth',
    'beatMaps',
    'djBeatMaps',
    'commentBarrage',
    'foliaThemes',
    'lyricTextures',
    'localBeatMaps',
    'layoutCaches',
  ];

  assert.deepEqual(Object.keys(active), expectedCaches);
  assert.deepEqual(Object.keys(released), expectedCaches);
  for (const name of expectedCaches) {
    assert.equal(Number.isInteger(active[name].maxCount), true, name);
    assert.equal(Number.isInteger(active[name].maxBytes), true, name);
    assert.equal(active[name].maxCount > 0, true, name);
    assert.equal(active[name].maxBytes > 0, true, name);
    assert.equal(released[name].maxCount <= active[name].maxCount, true, name);
    assert.equal(released[name].maxBytes <= active[name].maxBytes, true, name);
  }
});

test('frame samples are bounded and expose useful percentiles without a RAF', () => {
  const { createResourceGovernor } = loadGovernor();
  const governor = createResourceGovernor({ maxFrameSamples: 4 });
  [8, 12, 20, 40, 16].forEach((duration, index) => governor.recordFrame(duration, index * 16));

  const snapshot = governor.snapshot();
  assert.equal(snapshot.frameSamples, 4);
  assert.equal(snapshot.frameAverageMs, 22);
  assert.equal(snapshot.frameP50Ms, 20);
  assert.equal(snapshot.frameP95Ms, 40);
  assert.equal(snapshot.frameOwner, 'host');
});

test('renderer wiring uses the governor from the existing animation owner', () => {
  const root = path.join(__dirname, '..');
  const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const governor = fs.readFileSync(path.join(root, 'public', 'resource-governor.js'), 'utf8');

  assert.match(index, /<script src="resource-governor\.js"><\/script>/);
  assert.match(index, /resourceGovernor\.recordFrame\(/);
  assert.match(index, /syncResourceGovernor\(/);
  assert.match(index, /cancelCuefieldAutoMix\([^)]*resource/);
  assert.match(index, /cancelNextTrackPreload\([^)]*resource/);
  assert.match(index, /nativeLyricRuntime\.setResourcePolicy/);
  assert.match(index, /isGovernedResourceReleased\('nativeLyrics'\)/);
  assert.match(index, /isGovernedResourceReleased\('sonicTopography'\)/);
  assert.doesNotMatch(governor, /requestAnimationFrame|setInterval|setTimeout/);
});

test('desktop samples sanitized system resources and exposes a main-only read channel', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'desktop', 'preload.js'), 'utf8');
  const ipcAuth = fs.readFileSync(path.join(root, 'desktop', 'ipc-auth.js'), 'utf8');

  assert.match(main, /require\('\.\/system-memory-state'\)/);
  assert.match(main, /process\.getSystemMemoryInfo\(\)/);
  assert.match(main, /powerMonitor\.on\('thermal-state-change', \(details\) => sampleSystemResourceState\(\{ thermalState: details && details\.state \}\)\)/);
  assert.match(main, /powerMonitor\.on\('speed-limit-change', \(details\) => sampleSystemResourceState\(\{ speedLimit: details && details\.limit \}\)\)/);
  assert.match(main, /handleIpc\('mineradio-system-resource-get-state'/);
  assert.match(preload, /getSystemResourceState/);
  assert.match(preload, /onSystemResourceState/);
  assert.match(ipcAuth, /mineradio-system-resource-get-state/);
  assert.doesNotMatch(preload, /getSystemMemoryInfo|process\.memoryUsage/);
});
