const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createThreeLyricPerformanceBudget,
} = require('../public/folia-native/three/performance-budget');

test('performance budget degrades after two consecutive five-second bad windows', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  budget.pushWindowForTest({ p95: 25, quality: 'balanced', endedAt: 5000 });
  assert.equal(budget.snapshot().level, 0);
  assert.equal(budget.snapshot().badWindows, 1);

  budget.pushWindowForTest({ p95: 25, quality: 'balanced', endedAt: 10000 });
  assert.equal(budget.snapshot().level, 1);
  assert.equal(budget.snapshot().fallback, false);
  assert.equal(budget.snapshot().badWindows, 0);
});

test('performance budget reaches fallback only after level three remains over budget', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  for (let window = 0; window < 8; window += 1) {
    budget.pushWindowForTest({
      p95: 45,
      quality: 'balanced',
      endedAt: (window + 1) * 5000,
    });
  }

  assert.equal(budget.snapshot().level, 3);
  assert.equal(budget.snapshot().fallback, true);
  assert.equal(budget.snapshot().reason, 'sustained-frame-budget');
});

test('battery mode uses the forty millisecond p95 threshold', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  budget.pushWindowForTest({ p95: 39.9, quality: 'battery', endedAt: 5000 });
  budget.pushWindowForTest({ p95: 41, quality: 'battery', endedAt: 10000 });
  budget.pushWindowForTest({ p95: 41, quality: 'battery', endedAt: 15000 });

  assert.equal(budget.snapshot().level, 1);
  assert.equal(budget.snapshot().thresholdMs, 40);
});

test('good windows break the consecutive over-budget streak', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  budget.pushWindowForTest({ p95: 25, quality: 'quality', endedAt: 5000 });
  budget.pushWindowForTest({ p95: 18, quality: 'quality', endedAt: 10000 });
  budget.pushWindowForTest({ p95: 25, quality: 'quality', endedAt: 15000 });

  assert.equal(budget.snapshot().level, 0);
  assert.equal(budget.snapshot().badWindows, 1);
});

test('performance budget cannot degrade twice without a full window interval', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  budget.pushWindowForTest({ p95: 30, quality: 'balanced', endedAt: 5000 });
  budget.pushWindowForTest({ p95: 30, quality: 'balanced', endedAt: 5001 });
  assert.equal(budget.snapshot().level, 0);

  budget.pushWindowForTest({ p95: 30, quality: 'balanced', endedAt: 10000 });
  assert.equal(budget.snapshot().level, 1);
});

test('suspension ignores warmup samples and resetTrack clears degradation', () => {
  const budget = createThreeLyricPerformanceBudget({ windowMs: 5000 });

  budget.suspend(1000, 2000);
  budget.push({ now: 1500, frameMs: 90, quality: 'balanced' });
  assert.equal(budget.snapshot().sampleCount, 0);
  assert.equal(budget.snapshot().suspendedUntil, 3000);

  budget.pushWindowForTest({ p95: 30, quality: 'balanced', endedAt: 8000 });
  budget.pushWindowForTest({ p95: 30, quality: 'balanced', endedAt: 13000 });
  assert.equal(budget.snapshot().level, 1);

  budget.resetTrack();
  assert.equal(budget.snapshot().level, 0);
  assert.equal(budget.snapshot().fallback, false);
  assert.equal(budget.snapshot().sampleCount, 0);
});
