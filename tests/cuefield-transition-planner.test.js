'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { planTransition } = require('../cuefield/transition-planner');

function analysis(overrides = {}) {
  const duration = overrides.duration || 200;
  const bpm = overrides.bpm || 120;
  const downbeats = [];
  for (let time = 0; time <= duration; time += 2) {
    downbeats.push({ time, confidence: 0.9, energy: time < duration / 2 ? 0.48 : 0.66 });
  }
  return {
    duration,
    bpm,
    gridStep: 60 / bpm,
    camelot: '8A',
    downbeats,
    phraseBoundaries: downbeats.filter((_, index) => index % 8 === 0),
    energyCurve: downbeats.map(beat => ({ time: beat.time, value: beat.energy })),
    tempoStability: 0.92,
    beatConfidence: 0.9,
    downbeatStability: 0.88,
    dataConfidence: 0.9,
    ...overrides,
  };
}

test('returns ordinary playback for disabled or missing analysis', () => {
  assert.deepEqual(planTransition({ intensity: 'off' }), {
    mode: 'ordinary',
    reason: 'disabled',
    triggerAtSec: null,
    entryAtSec: 0,
    crossfadeMs: 0,
    confidence: 0,
    tempo: null,
    key: null,
    energy: null,
  });
  assert.equal(planTransition({ intensity: 'balanced', from: null, to: analysis() }).reason, 'missing-analysis');
});

test('plans only on supplied phrase or downbeat boundaries and caps Task 7 crossfade duration', () => {
  const from = analysis();
  const to = analysis({ duration: 180, bpm: 121, camelot: '9A' });
  const plan = planTransition({
    intensity: 'balanced',
    currentTimeSec: 80,
    from,
    to,
  });

  assert.equal(plan.mode, 'beat-crossfade');
  assert.ok(plan.crossfadeMs > 0 && plan.crossfadeMs <= 1200);
  assert.ok(from.downbeats.some(boundary => Math.abs(boundary.time - (plan.triggerAtSec + plan.crossfadeMs / 1000)) < 0.0001));
  assert.ok(to.downbeats.some(boundary => boundary.time === plan.entryAtSec));
  assert.equal(plan.tempo.compatible, true);
  assert.equal(plan.key.score, 0.92);
  assert.ok(plan.confidence >= 0.58);
});

test('accepts half and double tempo relationships but rejects incompatible tempo safely', () => {
  const from = analysis({ bpm: 120 });
  const half = planTransition({ intensity: 'club', currentTimeSec: 50, from, to: analysis({ bpm: 60 }) });
  const double = planTransition({ intensity: 'club', currentTimeSec: 50, from: analysis({ bpm: 60 }), to: from });
  const mismatch = planTransition({ intensity: 'balanced', currentTimeSec: 50, from, to: analysis({ bpm: 137 }) });

  assert.equal(half.mode, 'beat-crossfade');
  assert.equal(half.tempo.targetScale, 2);
  assert.equal(double.mode, 'beat-crossfade');
  assert.equal(double.tempo.targetScale, 0.5);
  assert.equal(mismatch.mode, 'ordinary');
  assert.equal(mismatch.reason, 'tempo-incompatible');
});

test('uses intensity-specific policy and energy arcs deterministically', () => {
  const from = analysis();
  const to = analysis({
    camelot: '8B',
    energyCurve: [
      { time: 0, value: 0.2 },
      { time: 4, value: 0.64 },
      { time: 8, value: 0.9 },
    ],
  });
  const subtle = planTransition({ intensity: 'subtle', currentTimeSec: 90, from, to });
  const balanced = planTransition({ intensity: 'balanced', currentTimeSec: 90, from, to });
  const clubA = planTransition({ intensity: 'club', currentTimeSec: 90, from, to });
  const clubB = planTransition({ intensity: 'club', currentTimeSec: 90, from, to });

  assert.equal(subtle.mode, 'crossfade');
  assert.equal(balanced.mode, 'beat-crossfade');
  assert.equal(clubA.mode, 'beat-crossfade');
  assert.ok(subtle.crossfadeMs < balanced.crossfadeMs);
  assert.ok(balanced.crossfadeMs < clubA.crossfadeMs);
  assert.ok(clubA.energy.entry >= 0 && clubA.energy.entry <= 1);
  assert.deepEqual(clubA, clubB);
});

test('falls back when there is no safe future boundary after a seek', () => {
  const from = analysis({ duration: 30 });
  const result = planTransition({
    intensity: 'balanced',
    currentTimeSec: 29.8,
    from,
    to: analysis(),
  });
  assert.equal(result.mode, 'ordinary');
  assert.equal(result.reason, 'no-safe-boundary');
});

test('plans from phrase boundaries when explicit downbeats are unavailable', () => {
  const from = analysis({
    downbeats: [],
    phraseBoundaries: [
      { time: 0, confidence: 0.9, energy: 0.5 },
      { time: 64, confidence: 0.9, energy: 0.6 },
      { time: 128, confidence: 0.9, energy: 0.64 },
      { time: 192, confidence: 0.9, energy: 0.66 },
    ],
  });
  const to = analysis({
    downbeats: [],
    phraseBoundaries: [
      { time: 0, confidence: 0.9, energy: 0.62 },
      { time: 8, confidence: 0.9, energy: 0.64 },
    ],
  });
  const result = planTransition({
    intensity: 'balanced',
    currentTimeSec: 80,
    from,
    to,
  });

  assert.equal(result.mode, 'beat-crossfade');
  assert.equal(result.triggerAtSec + result.crossfadeMs / 1000, 192);
  assert.ok([0, 8].includes(result.entryAtSec));
});

test('applies intensity-specific key compatibility thresholds but allows missing keys', () => {
  const from = analysis({ camelot: '8A' });
  const incompatible = analysis({ camelot: '6A' });
  const balanced = planTransition({
    intensity: 'balanced',
    currentTimeSec: 80,
    from,
    to: incompatible,
  });
  const club = planTransition({
    intensity: 'club',
    currentTimeSec: 80,
    from,
    to: incompatible,
  });
  const unknown = planTransition({
    intensity: 'balanced',
    currentTimeSec: 80,
    from: analysis({ camelot: '' }),
    to: analysis({ camelot: '' }),
  });

  assert.equal(balanced.mode, 'ordinary');
  assert.equal(balanced.reason, 'key-incompatible');
  assert.equal(club.mode, 'beat-crossfade');
  assert.equal(unknown.mode, 'beat-crossfade');
});
