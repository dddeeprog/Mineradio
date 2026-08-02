'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SONIC_TOPOGRAPHY_CONFIG,
  normalizeSonicTopographyConfig,
  resolveSonicQualityTier,
  createSonicTopographyState,
} = require('../public/sonic-topography-state');

function audioFixture(level = 1) {
  return {
    frequencyData: Uint8Array.from({ length: 64 }, (_, index) => (
      Math.round((40 + ((index * 37) % 190)) * level)
    )),
    timeDomainData: Uint8Array.from({ length: 128 }, (_, index) => (
      Math.round(128 + Math.sin(index / 5) * 72 * level)
    )),
    bass: 0.72 * level,
    mid: 0.48 * level,
    treble: 0.36 * level,
    energy: 0.64 * level,
    beatPulse: 0.82 * level,
  };
}

function runFixture(state, options = {}) {
  for (let index = 0; index < (options.frames || 8); index += 1) {
    state.update({
      dt: options.dt || 1 / 30,
      playing: options.playing !== false,
      reducedMotion: options.reducedMotion === true,
      quality: options.quality || 'balanced',
      audio: options.audio || audioFixture(),
      config: options.config || DEFAULT_SONIC_TOPOGRAPHY_CONFIG,
    });
  }
}

test('normalizes Sonic settings to bounded archive-safe values', () => {
  assert.deepEqual(normalizeSonicTopographyConfig({
    enabled: true,
    amplitude: 99,
    motion: -2,
    opacity: 0,
    historySize: 999,
    palette: 'unknown',
  }), {
    enabled: true,
    amplitude: 1.5,
    motion: 0,
    opacity: 0.15,
    historySize: 96,
    palette: 'theme',
  });
});

test('terrain sampling is deterministic for the same seed and audio frames', () => {
  const first = createSonicTopographyState({ seed: 'sonic-fixture' });
  const second = createSonicTopographyState({ seed: 'sonic-fixture' });

  runFixture(first);
  runFixture(second);

  assert.deepEqual(Array.from(first.sampleTerrain()), Array.from(second.sampleTerrain()));
  assert.equal(first.snapshot().seed, second.snapshot().seed);
});

test('history remains within both the configured and quality-tier bounds', () => {
  const state = createSonicTopographyState({ seed: 7 });
  runFixture(state, {
    frames: 180,
    quality: 'quality',
    config: { enabled: true, historySize: 18 },
  });

  const snapshot = state.snapshot();
  assert.equal(snapshot.historyLimit, 18);
  assert.equal(snapshot.historyRows <= 18, true);
  assert.equal(state.sampleTerrain().length, snapshot.columns * snapshot.rows);
});

test('quality tiers reduce grid and history budgets monotonically', () => {
  const quality = resolveSonicQualityTier('quality', false);
  const balanced = resolveSonicQualityTier('balanced', false);
  const battery = resolveSonicQualityTier('battery', false);
  const reduced = resolveSonicQualityTier('quality', true);

  assert.equal(quality.columns > balanced.columns, true);
  assert.equal(balanced.columns > battery.columns, true);
  assert.equal(quality.rows > balanced.rows, true);
  assert.equal(balanced.historyRows > battery.historyRows, true);
  assert.equal(reduced.columns <= battery.columns, true);
  assert.equal(reduced.historyRows <= battery.historyRows, true);
});

test('pause decays retained audio energy and terrain without growing history', () => {
  const state = createSonicTopographyState({ seed: 11 });
  runFixture(state, { frames: 6 });
  const active = state.snapshot();
  const activePeak = Math.max(...state.sampleTerrain());

  runFixture(state, {
    frames: 4,
    dt: 0.25,
    playing: false,
    audio: audioFixture(0),
  });
  const paused = state.snapshot();
  const pausedPeak = Math.max(...state.sampleTerrain());

  assert.equal(paused.energy < active.energy, true);
  assert.equal(pausedPeak < activePeak * 0.75, true);
  assert.equal(paused.historyRows, active.historyRows);
});

test('reduced motion keeps audio response but sharply limits temporal travel', () => {
  const full = createSonicTopographyState({ seed: 13 });
  const reduced = createSonicTopographyState({ seed: 13 });

  runFixture(full, { frames: 12 });
  runFixture(reduced, { frames: 12, reducedMotion: true });

  assert.equal(reduced.snapshot().motionTime < full.snapshot().motionTime * 0.25, true);
  assert.equal(reduced.snapshot().energy > 0, true);
  assert.notDeepEqual(Array.from(reduced.sampleTerrain()), new Array(reduced.sampleTerrain().length).fill(0));
});

test('quality changes resample retained history instead of flattening a paused terrain', () => {
  const state = createSonicTopographyState({ seed: 15 });
  runFixture(state, { frames: 8, quality: 'balanced' });
  const before = state.snapshot();

  state.update({
    dt: 1 / 30,
    playing: false,
    reducedMotion: false,
    quality: 'quality',
    audio: audioFixture(0),
    config: DEFAULT_SONIC_TOPOGRAPHY_CONFIG,
  });
  const after = state.snapshot();
  const terrain = state.sampleTerrain();

  assert.equal(before.historyRows > 0, true);
  assert.equal(after.columns > before.columns, true);
  assert.equal(after.historyRows > 0, true);
  assert.equal(Math.max(...terrain) - Math.min(...terrain) > 0.02, true);
});

test('release drops retained rows and restore permits a clean rebuild', () => {
  const state = createSonicTopographyState({ seed: 17 });
  runFixture(state, { frames: 5 });
  assert.equal(state.snapshot().historyRows > 0, true);

  state.release();
  assert.equal(state.snapshot().released, true);
  assert.equal(state.snapshot().historyRows, 0);
  assert.equal(state.sampleTerrain().length, 0);

  state.restore();
  runFixture(state, { frames: 2 });
  assert.equal(state.snapshot().released, false);
  assert.equal(state.snapshot().historyRows > 0, true);
});
