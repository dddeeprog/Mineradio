'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../cuefield/core');
const analysisAdapter = require('../cuefield/analysis-adapter');

test('normalizes the four public intensity levels and defaults unknown values to off', () => {
  assert.equal(core.normalizeIntensity('off'), 'off');
  assert.equal(core.normalizeIntensity('SUBTLE'), 'subtle');
  assert.equal(core.normalizeIntensity(' balanced '), 'balanced');
  assert.equal(core.normalizeIntensity('club'), 'club');
  assert.equal(core.normalizeIntensity('maximum'), 'off');
  assert.equal(core.normalizeIntensity(null), 'off');
});

test('matches same, half, and double tempos without accepting invalid BPM data', () => {
  const same = core.normalizeTempoPair(120, 121, { maxRelativeDiff: 0.03 });
  assert.equal(same.valid, true);
  assert.equal(same.compatible, true);
  assert.equal(same.targetScale, 1);
  assert.equal(same.matchedTargetBpm, 121);

  const half = core.normalizeTempoPair(120, 60, { maxRelativeDiff: 0.03 });
  assert.equal(half.compatible, true);
  assert.equal(half.targetScale, 2);
  assert.equal(half.matchedTargetBpm, 120);

  const double = core.normalizeTempoPair(60, 120, { maxRelativeDiff: 0.03 });
  assert.equal(double.compatible, true);
  assert.equal(double.targetScale, 0.5);
  assert.equal(double.matchedTargetBpm, 60);

  assert.equal(core.normalizeTempoPair(120, 132, { maxRelativeDiff: 0.05 }).compatible, false);
  assert.equal(core.normalizeTempoPair(NaN, 120).valid, false);
  assert.equal(core.normalizeTempoPair(0, 120).valid, false);
});

test('parses Camelot and musical key notation and scores compatible neighbours', () => {
  assert.deepEqual(core.parseCamelot('8A'), { number: 8, mode: 'A', code: '8A' });
  assert.deepEqual(core.parseCamelot('C major'), { number: 8, mode: 'B', code: '8B' });
  assert.deepEqual(core.parseCamelot('A minor'), { number: 8, mode: 'A', code: '8A' });
  assert.deepEqual(core.parseCamelot('C#m'), { number: 12, mode: 'A', code: '12A' });
  assert.equal(core.parseCamelot('not-a-key'), null);

  assert.equal(core.scoreKeyCompatibility('8A', '8A'), 1);
  assert.equal(core.scoreKeyCompatibility('8A', '9A'), 0.92);
  assert.equal(core.scoreKeyCompatibility('8A', '8B'), 0.86);
  assert.equal(core.scoreKeyCompatibility('1A', '12A'), 0.92);
  assert.equal(core.scoreKeyCompatibility('', '8A'), null);
  assert.ok(core.scoreKeyCompatibility('8A', '2B') < 0.5);
});

test('adapts object and compressed Mineradio beat maps deterministically without mutating input', () => {
  const input = {
    track: {
      id: 'track-1',
      name: 'Fixture',
      artist: 'Mineradio',
      duration: 180000,
      key: 'must-not-be-used',
    },
    map: {
      duration: 180000,
      gridStep: 500,
      key: 'also-must-not-be-used',
      cameraBeats: [
        [3000, 0.8, 0.9, 0.7, 0.6, 0.5, 0.4, 0, 1, 0.2, 0.1, 500],
        [1000, 0.9, 0.95, 0.8, 0.7, 0.4, 0.3, 1, 1, 0.3, 0.2, 500],
        [1000, 0.2, 0.2, 0.1, 0.1, 0.1, 0.1, 0, 0, 0.1, 0.1, 500],
        { time: 2000, strength: 0.6, confidence: 0.8, impact: 0.65 },
        { time: 4000, strength: 0.7, confidence: 0.9, phrase: true },
        { time: 'invalid', strength: 1 },
      ],
      partial: true,
    },
    musicalKey: 'C major',
  };
  const before = structuredClone(input);

  const adapted = analysisAdapter.adaptBeatMap(input);

  assert.deepEqual(input, before);
  assert.equal(adapted.duration, 180);
  assert.equal(adapted.gridStep, 0.5);
  assert.equal(adapted.bpm, 120);
  assert.deepEqual(adapted.beats.map(beat => beat.time), [1, 2, 3, 4]);
  assert.equal(adapted.beats[0].downbeat, true);
  assert.deepEqual(adapted.downbeats.map(beat => beat.time), [1]);
  assert.deepEqual(adapted.phraseBoundaries.map(boundary => boundary.time), [1, 4]);
  assert.equal(adapted.camelot, '8B');
  assert.equal(adapted.musicalKey, 'C major');
  assert.equal(adapted.partial, true);
  assert.ok(adapted.dataConfidence > 0 && adapted.dataConfidence < 1);
});

test('ignores generic song key fields and derives fallback meter only without explicit downbeats', () => {
  const adapted = analysisAdapter.adaptBeatMap({
    track: { duration: 8, key: '8A' },
    map: {
      duration: 8,
      key: '9A',
      gridStep: 0.5,
      beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    },
  });

  assert.equal(adapted.camelot, '');
  assert.equal(adapted.musicalKey, '');
  assert.deepEqual(adapted.downbeats.map(beat => beat.time), [0, 2]);
  assert.deepEqual(adapted.phraseBoundaries.map(boundary => boundary.time), [0]);
});

test('normalizes track, map, beat, and step units independently', () => {
  const secondsMap = analysisAdapter.adaptBeatMap({
    track: { id: 'mixed-seconds', duration: 180000 },
    map: {
      duration: 180,
      gridStep: 0.5,
      beats: [0, 0.5, 1, 1.5, 2],
    },
  });
  assert.equal(secondsMap.duration, 180);
  assert.equal(secondsMap.gridStep, 0.5);
  assert.deepEqual(secondsMap.beats.map(beat => beat.time), [0, 0.5, 1, 1.5, 2]);

  const millisecondsMap = analysisAdapter.adaptBeatMap({
    track: { id: 'mixed-milliseconds', duration: 180 },
    map: {
      duration: 180000,
      gridStep: 500,
      beats: [0, 500, 1000, 1500, 2000],
    },
  });
  assert.equal(millisecondsMap.duration, 180);
  assert.equal(millisecondsMap.gridStep, 0.5);
  assert.deepEqual(millisecondsMap.beats.map(beat => beat.time), [0, 0.5, 1, 1.5, 2]);

  const millisecondDurationWithSecondBeats = analysisAdapter.adaptBeatMap({
    track: { id: 'duration-ms-beats-seconds', duration: 180 },
    map: {
      duration: 180000,
      gridStep: 0.5,
      beats: [0, 0.5, 1, 1.5, 2],
    },
  });
  assert.deepEqual(
    millisecondDurationWithSecondBeats.beats.map(beat => beat.time),
    [0, 0.5, 1, 1.5, 2],
  );

  const secondDurationWithMillisecondBeats = analysisAdapter.adaptBeatMap({
    track: { id: 'duration-seconds-beats-ms', duration: 180000 },
    map: {
      duration: 180,
      gridStep: 500,
      beats: [0, 500, 1000, 1500, 2000],
    },
  });
  assert.deepEqual(
    secondDurationWithMillisecondBeats.beats.map(beat => beat.time),
    [0, 0.5, 1, 1.5, 2],
  );
});

test('does not invent four-beat meter when the map supplies phrase semantics', () => {
  const adapted = analysisAdapter.adaptBeatMap({
    track: { duration: 6 },
    map: {
      duration: 6,
      gridStep: 0.5,
      beats: [
        { time: 0, combo: 'push' },
        { time: 0.5 },
        { time: 1 },
        { time: 1.5 },
        { time: 2, phrase: true },
        { time: 2.5 },
      ],
    },
  });

  assert.deepEqual(adapted.downbeats.map(beat => beat.time), [2]);
  assert.deepEqual(adapted.phraseBoundaries.map(boundary => boundary.time), [2]);
});
