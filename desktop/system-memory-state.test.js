const assert = require('node:assert/strict');
const test = require('node:test');

function loadMemoryState() {
  return require('./system-memory-state');
}

test('Electron KiB memory samples become bounded non-secret MB diagnostics', () => {
  const { normalizeSystemMemoryInfo } = loadMemoryState();
  const normalized = normalizeSystemMemoryInfo({
    total: 16 * 1024 * 1024,
    free: 4 * 1024 * 1024,
    swapTotal: 8 * 1024 * 1024,
    swapFree: 6 * 1024 * 1024,
    arbitraryPath: 'C:\\private\\file',
  });

  assert.deepEqual(normalized, {
    totalMB: 16384,
    freeMB: 4096,
    availableRatio: 0.25,
    swapTotalMB: 8192,
    swapFreeMB: 6144,
  });
  assert.equal(JSON.stringify(normalized).includes('private'), false);
});

test('memory pressure rises immediately and recovers only after the hold window', () => {
  const { createSystemMemoryState } = loadMemoryState();
  const state = createSystemMemoryState({ recoveryHoldMs: 5000 });

  assert.equal(state.sample({ memoryInfo: { total: 8 * 1024 * 1024, free: 3 * 1024 * 1024 } }, 0).pressure, 'normal');
  assert.equal(state.sample({ memoryInfo: { total: 8 * 1024 * 1024, free: 400 * 1024 } }, 100).pressure, 'critical');
  assert.equal(state.sample({ memoryInfo: { total: 8 * 1024 * 1024, free: 3 * 1024 * 1024 } }, 2000).pressure, 'critical');
  assert.equal(state.sample({ memoryInfo: { total: 8 * 1024 * 1024, free: 3 * 1024 * 1024 } }, 7101).pressure, 'normal');
});

test('power lock and thermal state updates retain the latest memory sample', () => {
  const { createSystemMemoryState } = loadMemoryState();
  const state = createSystemMemoryState({ recoveryHoldMs: 0 });
  state.sample({ memoryInfo: { total: 16 * 1024 * 1024, free: 2 * 1024 * 1024 } }, 0);
  const snapshot = state.sample({
    onBattery: true,
    thermalState: 'serious',
    speedLimit: 62,
    locked: true,
    suspended: false,
  }, 100);

  assert.equal(snapshot.pressure, 'moderate');
  assert.equal(snapshot.totalMB, 16384);
  assert.equal(snapshot.freeMB, 2048);
  assert.equal(snapshot.onBattery, true);
  assert.equal(snapshot.thermalState, 'serious');
  assert.equal(snapshot.speedLimit, 62);
  assert.equal(snapshot.locked, true);
  assert.equal(snapshot.suspended, false);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'availableRatio',
    'freeMB',
    'locked',
    'onBattery',
    'pressure',
    'revision',
    'speedLimit',
    'suspended',
    'swapFreeMB',
    'swapTotalMB',
    'thermalState',
    'totalMB',
    'updatedAt',
  ].sort());
});
