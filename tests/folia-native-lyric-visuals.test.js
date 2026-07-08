const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveMonetSweep,
  resolveGlowEnvelope,
  resolveCladdaghOrbit,
  resolveNativeLyricVisualFrame,
} = require('../public/folia-native-lyric-visuals');

test('resolves Monet-style sweep progress with soft edge', () => {
  const sweep = resolveMonetSweep({
    startTime: 10,
    endTime: 14,
    now: 12,
    width: 400,
    softnessPx: 16,
  });

  assert.equal(sweep.progress, 0.5);
  assert.equal(sweep.fillWidth, 200);
  assert.equal(sweep.solidEnd, 184);
  assert.equal(sweep.featherEnd, 200);
});

test('keeps glow envelope finite through rise and tail', () => {
  const rising = resolveGlowEnvelope({ startTime: 1, endTime: 3, renderEndTime: 4, now: 2, intensity: 1 });
  const tail = resolveGlowEnvelope({ startTime: 1, endTime: 3, renderEndTime: 4, now: 3.5, intensity: 1 });

  assert.ok(rising > 0);
  assert.ok(tail > 0);
  assert.ok(rising <= 1);
  assert.ok(tail <= 1);
});

test('places Claddagh orbit glyphs with finite pseudo-3D values', () => {
  const orbit = resolveCladdaghOrbit({
    index: 2,
    count: 5,
    progress: 0.5,
    radiusX: 2.8,
    radiusY: 0.9,
    depth: 0.6,
    focus: 0.8,
    audioPower: 0.4,
    effectStrength: 1,
  });

  assert.ok(Number.isFinite(orbit.x));
  assert.ok(Number.isFinite(orbit.y));
  assert.ok(Number.isFinite(orbit.z));
  assert.ok(orbit.opacity >= 0 && orbit.opacity <= 1);
  assert.ok(orbit.scale > 0);
});

test('combines frame values and applies performance reduction', () => {
  const quality = resolveNativeLyricVisualFrame({
    effect: 'hybrid',
    now: 2,
    line: { startTime: 0, endTime: 4, renderHints: { renderEndTime: 4.5 } },
    progress: 0.5,
    audio: { beatPulse: 0.8, energy: 0.5 },
    fx: { glow: 1, wordHighlight: 1, beatMotion: 1, cameraMotion: 1, performanceMode: 'quality' },
  });
  const battery = resolveNativeLyricVisualFrame({
    effect: 'hybrid',
    now: 2,
    line: { startTime: 0, endTime: 4, renderHints: { renderEndTime: 4.5 } },
    progress: 0.5,
    audio: { beatPulse: 0.8, energy: 0.5 },
    fx: { glow: 1, wordHighlight: 1, beatMotion: 1, cameraMotion: 1, performanceMode: 'battery', reduceMotion: true },
  });

  assert.ok(quality.glow >= battery.glow);
  assert.equal(battery.orbitStrength, 0);
});
