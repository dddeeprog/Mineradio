const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  resolveClassicMotionProfile,
  evaluateClassicEntryProgress,
  resolveClassicGroupPose,
  resolveClassicGraphemeVisual,
  resolveClassicLineExit,
} = require('../public/folia-native/classic-three-motion');

const CHANNELS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotation', 'scale', 'opacity'];
const REQUIRED_EXPORTS = [
  'resolveClassicMotionProfile',
  'evaluateClassicEntryProgress',
  'resolveClassicGroupPose',
  'resolveClassicGraphemeVisual',
  'resolveClassicLineExit',
];
const MOTION_SOURCE_PATH = path.join(__dirname, '..', 'public', 'folia-native', 'classic-three-motion.js');

test('browser UMD exposes the required API and retains pinned Folia AGPL provenance', () => {
  const source = fs.readFileSync(MOTION_SOURCE_PATH, 'utf8');
  const context = { globalThis: {} };

  vm.runInNewContext(source, context, { filename: MOTION_SOURCE_PATH });

  const browserApi = context.globalThis.MineradioNativeLyricClassicThreeMotion;
  assert.ok(browserApi);
  for (const name of REQUIRED_EXPORTS) assert.equal(typeof browserApi[name], 'function', name);
  assert.match(source, /chthollyphile\/folia-major/);
  assert.match(source, /baa5e846b7404f1893e8b7812bca79e959f21d3f/);
  assert.match(source, /AGPL-3\.0-or-later/);
  assert.match(source, /THIRD_PARTY_NOTICES\.md/);
});

test('CommonJS UMD exports the API without polluting the browser global', () => {
  const source = fs.readFileSync(MOTION_SOURCE_PATH, 'utf8');
  const context = { globalThis: {}, module: { exports: {} } };

  vm.runInNewContext(source, context, { filename: MOTION_SOURCE_PATH });

  for (const name of REQUIRED_EXPORTS) assert.equal(typeof context.module.exports[name], 'function', name);
  assert.equal(context.globalThis.MineradioNativeLyricClassicThreeMotion, undefined);
});

function sampleGroup(overrides = {}) {
  return Object.assign({
    startTime: 1,
    endTime: 1.8,
    activeEndTime: 1.22,
    entryPose: { x: -0.3, y: 0.2, z: -0.36, rotationX: -0.14, rotationY: 0.18, rotation: -2, scale: 0.72, opacity: 0 },
    activePose: { x: 0.1, y: -0.1, z: 0.18, rotationX: 0.04, rotationY: -0.06, rotation: 1, scale: 1.18, opacity: 1 },
    passedPose: { x: 0, y: 0, z: -0.08, rotationX: -0.02, rotationY: 0.03, rotation: 0.5, scale: 1, opacity: 0.82 },
    driftRotation: 3,
  }, overrides);
}

function assertUnit(value, label) {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(value >= 0 && value <= 1, `${label} must be in [0, 1]`);
}

for (const [mode, entryDurationMs, lookahead, passedDurationMs, colorReturnDurationMs] of [
  ['normal', 420, 0.15, 500, 800],
  ['fast', 240, 0.08, 240, 240],
  ['instant', 120, 0.03, 120, 120],
]) {
  test(`${mode} resolves pinned durations and an exact spring endpoint`, () => {
    const profile = resolveClassicMotionProfile({ wordRevealMode: mode });
    assert.equal(profile.wordRevealMode, mode);
    assert.equal(profile.entryDurationMs, entryDurationMs);
    assert.equal(profile.lookahead, lookahead);
    assert.equal(profile.passedDurationMs, passedDurationMs);
    assert.equal(profile.colorReturnDurationMs, colorReturnDurationMs);
    assert.equal(evaluateClassicEntryProgress(entryDurationMs / 1000, profile), 1);
    assert.ok(Math.abs(evaluateClassicEntryProgress((entryDurationMs - 1) / 1000, profile) - 1) <= 0.005);
  });
}

test('resolved profiles are shared immutable constants and can be passed through', () => {
  for (const mode of ['normal', 'fast', 'instant']) {
    const first = resolveClassicMotionProfile({ wordRevealMode: mode });
    const second = resolveClassicMotionProfile({ wordRevealMode: mode });
    assert.strictEqual(second, first);
    assert.strictEqual(resolveClassicMotionProfile(first), first);
    assert.equal(Object.isFrozen(first), true);
    assert.throws(() => Object.defineProperty(first, 'entryDurationMs', { value: 1 }), TypeError);
  }

  const group = sampleGroup();
  assert.notStrictEqual(
    resolveClassicGroupPose(group, 1, { wordRevealMode: 'normal' }),
    resolveClassicGroupPose(group, 1, { wordRevealMode: 'normal' })
  );
});

test('normal entry keeps only a mild bounded overshoot', () => {
  const profile = resolveClassicMotionProfile({ wordRevealMode: 'normal' });
  const samples = Array.from({ length: 421 }, (_, index) => (
    evaluateClassicEntryProgress(index / 1000, profile)
  ));
  assert.ok(Math.max(...samples) > 1);
  assert.ok(Math.max(...samples) <= 1.04);
  assert.ok(Math.min(...samples) >= 0);
});

test('unknown profiles safely resolve to normal and malformed elapsed values clamp', () => {
  const profile = resolveClassicMotionProfile({ wordRevealMode: 'surprise' });
  assert.equal(profile.wordRevealMode, 'normal');
  assert.equal(evaluateClassicEntryProgress(-1, profile), 0);
  assert.equal(evaluateClassicEntryProgress(Number.NaN, profile), 0);
  assert.equal(evaluateClassicEntryProgress(Infinity, profile), 0);
});

test('activeEndTime is continuous for every pose channel', () => {
  const group = sampleGroup();
  const epsilon = 1e-6;
  const before = resolveClassicGroupPose(group, group.activeEndTime - epsilon, { wordRevealMode: 'normal' });
  const exact = resolveClassicGroupPose(group, group.activeEndTime, { wordRevealMode: 'normal' });
  const after = resolveClassicGroupPose(group, group.activeEndTime + epsilon, { wordRevealMode: 'normal' });

  for (const channel of CHANNELS) {
    assert.ok(Math.abs(before[channel] - exact[channel]) < 0.0001, `${channel} jumps before boundary`);
    assert.ok(Math.abs(after[channel] - exact[channel]) < 0.0001, `${channel} jumps after boundary`);
  }
  assert.equal(exact.phase, 'passed');
});

test('activeEndTime before entry trigger normalizes to a continuous passed boundary', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 0.5, endTime: 1.8 });
  const trigger = group.startTime - 0.15;
  const epsilon = 1e-7;
  const before = resolveClassicGroupPose(group, trigger - epsilon, { wordRevealMode: 'normal' });
  const exact = resolveClassicGroupPose(group, trigger, { wordRevealMode: 'normal' });
  const after = resolveClassicGroupPose(group, trigger + epsilon, { wordRevealMode: 'normal' });

  assert.equal(before.phase, 'waiting');
  assert.equal(exact.phase, 'passed');
  assert.equal(after.phase, 'passed');
  assert.equal(before.colorReturn, 0);
  assert.equal(exact.colorReturn, 0);
  assert.ok(after.colorReturn > 0);
  for (const channel of CHANNELS) {
    assert.ok(Number.isFinite(before[channel]), `${channel} before must be finite`);
    assert.ok(Number.isFinite(exact[channel]), `${channel} exact must be finite`);
    assert.ok(Number.isFinite(after[channel]), `${channel} after must be finite`);
    assert.ok(Math.abs(before[channel] - exact[channel]) < 1e-10, `${channel} jumps at trigger`);
    assert.ok(Math.abs(after[channel] - exact[channel]) < 0.00001, `${channel} jumps after trigger`);
  }
});

test('a short group passes from its actual unfinished entry boundary', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 0.94, endTime: 1.4 });
  const profile = { wordRevealMode: 'normal' };
  const atBoundary = resolveClassicGroupPose(group, 0.94, profile);
  const entryElapsed = 0.94 - (group.startTime - 0.15);
  const entryProgress = evaluateClassicEntryProgress(entryElapsed, resolveClassicMotionProfile(profile));
  const expectedX = group.entryPose.x + (group.activePose.x - group.entryPose.x) * entryProgress;

  assert.ok(entryProgress < 1);
  assert.ok(Math.abs(atBoundary.x - expectedX) < 1e-12);
  assert.notEqual(atBoundary.x, group.activePose.x);
  assert.equal(atBoundary.colorReturn, 0);
});

test('pose evaluation is independent of simulated RAF history and direct seeks do not replay', () => {
  const group = sampleGroup();
  const profile = { wordRevealMode: 'normal' };
  const direct = resolveClassicGroupPose(group, 5.75, profile);
  const histories = [
    [0, 0.5, 0.9, 1.1, 2.4, 5.75],
    [5.7, 5.71, 5.72, 5.73, 5.74, 5.75],
  ];
  const replayed = histories.map(history => {
    let pose;
    for (const now of history) pose = resolveClassicGroupPose(group, now, profile);
    return pose;
  });

  assert.deepEqual(replayed[0], direct);
  assert.deepEqual(replayed[1], direct);
  assert.equal(direct.phase, 'passed');
  assert.equal(direct.colorReturn, 1);
});

test('fixed playback time freezes group and grapheme output', () => {
  const group = sampleGroup();
  const grapheme = { startTime: 1.05, endTime: 1.14 };
  const now = 1.1;
  const originalDateNow = Date.now;
  try {
    Date.now = () => 1;
    const first = {
      pose: resolveClassicGroupPose(group, now, { wordRevealMode: 'normal' }),
      glyph: resolveClassicGraphemeVisual(grapheme, group, now, { wordRevealMode: 'normal' }, 0.7),
    };
    Date.now = () => 999999999;
    const second = {
      pose: resolveClassicGroupPose(group, now, { wordRevealMode: 'normal' }),
      glyph: resolveClassicGraphemeVisual(grapheme, group, now, { wordRevealMode: 'normal' }, 0.7),
    };
    assert.deepEqual(second, first);
  } finally {
    Date.now = originalDateNow;
  }
});

test('passed color return uses profile duration and rotation drift caps at five seconds', () => {
  const group = sampleGroup({ activeEndTime: 2, driftRotation: 20 });
  for (const [mode, passedMs, colorMs] of [
    ['normal', 500, 800],
    ['fast', 240, 240],
    ['instant', 120, 120],
  ]) {
    const start = resolveClassicGroupPose(group, 2, { wordRevealMode: mode });
    const colorEnd = resolveClassicGroupPose(group, 2 + colorMs / 1000, { wordRevealMode: mode });
    const driftStart = resolveClassicGroupPose(group, 2 + passedMs / 1000, { wordRevealMode: mode });
    const halfway = resolveClassicGroupPose(group, 2 + passedMs / 1000 + 2.5, { wordRevealMode: mode });
    const capped = resolveClassicGroupPose(group, 20, { wordRevealMode: mode });
    assert.equal(start.colorReturn, 0);
    assert.equal(colorEnd.colorReturn, 1);
    assert.ok(Math.abs(driftStart.rotation - group.passedPose.rotation) < 1e-12);
    assert.ok(Math.abs(halfway.rotation - (group.passedPose.rotation + 1.5)) < 1e-12);
    assert.ok(Math.abs(capped.rotation - (group.passedPose.rotation + 3)) < 1e-12);
  }
});

test('grapheme envelopes stay bounded and profile tails are ordered', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 2 });
  const grapheme = { startTime: 1.1, endTime: 1.2 };
  const modes = ['normal', 'fast', 'instant'];

  for (const mode of modes) {
    for (let now = 0.9; now <= 1.6; now += 0.005) {
      const visual = resolveClassicGraphemeVisual(grapheme, group, now, { wordRevealMode: mode }, 2);
      assertUnit(visual.highlight, `${mode} highlight`);
      assertUnit(visual.glow, `${mode} glow`);
    }
    assert.deepEqual(resolveClassicGraphemeVisual(grapheme, group, 1, { wordRevealMode: mode }, 1), { highlight: 0, glow: 0 });
  }

  assert.ok(resolveClassicGraphemeVisual(grapheme, group, 1.34, { wordRevealMode: 'normal' }, 1).highlight > 0);
  assert.equal(resolveClassicGraphemeVisual(grapheme, group, 1.34, { wordRevealMode: 'fast' }, 1).highlight, 0);
  assert.equal(resolveClassicGraphemeVisual(grapheme, group, 1.221, { wordRevealMode: 'instant' }, 1).highlight, 0);
  assert.deepEqual(resolveClassicGraphemeVisual(grapheme, group, 9, { wordRevealMode: 'normal' }, 1), { highlight: 0, glow: 0 });
});

test('short grapheme envelope is continuous at endTime', () => {
  const group = sampleGroup({ startTime: 1, endTime: 2 });
  const grapheme = { startTime: 1, endTime: 1.02 };
  const epsilon = 1e-8;
  const before = resolveClassicGraphemeVisual(grapheme, group, grapheme.endTime - epsilon, { wordRevealMode: 'normal' }, 1);
  const exact = resolveClassicGraphemeVisual(grapheme, group, grapheme.endTime, { wordRevealMode: 'normal' }, 1);
  const after = resolveClassicGraphemeVisual(grapheme, group, grapheme.endTime + epsilon, { wordRevealMode: 'normal' }, 1);

  for (const channel of ['highlight', 'glow']) {
    assert.ok(Math.abs(before[channel] - exact[channel]) < 0.00001, `${channel} jumps before endTime`);
    assert.ok(Math.abs(after[channel] - exact[channel]) < 0.00001, `${channel} jumps after endTime`);
  }
});

test('zero-duration grapheme uses a deterministic no-flash envelope', () => {
  const group = sampleGroup({ startTime: 1, endTime: 2 });
  const grapheme = { startTime: 1.1, endTime: 1.1 };
  for (const now of [1.1 - 1e-8, 1.1, 1.1 + 1e-8, 2]) {
    assert.deepEqual(
      resolveClassicGraphemeVisual(grapheme, group, now, { wordRevealMode: 'normal' }, 1),
      { highlight: 0, glow: 0 }
    );
  }
});

test('grapheme glow is strength-normalized and direct late seeks stay dark', () => {
  const group = sampleGroup();
  const grapheme = { startTime: 1.05, endTime: 1.15 };
  const full = resolveClassicGraphemeVisual(grapheme, group, 1.1, { wordRevealMode: 'normal' }, 1);
  const half = resolveClassicGraphemeVisual(grapheme, group, 1.1, { wordRevealMode: 'normal' }, 0.5);
  const invalid = resolveClassicGraphemeVisual(grapheme, group, 1.1, { wordRevealMode: 'normal' }, Number.NaN);
  assert.ok(full.highlight > 0);
  assert.ok(Math.abs(half.glow - full.glow * 0.5) < 1e-12);
  assert.equal(invalid.glow, 0);
  assert.deepEqual(resolveClassicGraphemeVisual(grapheme, group, 8, { wordRevealMode: 'normal' }, 1), { highlight: 0, glow: 0 });
});

test('reduced motion removes overshoot, depth and rotation while preserving a 120ms fade', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 2 });
  const trigger = 1 - 0.15;
  const start = resolveClassicGroupPose(group, trigger, { wordRevealMode: 'normal' }, { reducedMotion: true });
  const middle = resolveClassicGroupPose(group, trigger + 0.06, { wordRevealMode: 'normal' }, { reducedMotion: true });
  const end = resolveClassicGroupPose(group, trigger + 0.12, { wordRevealMode: 'normal' }, { reducedMotion: true });
  for (const pose of [start, middle, end]) {
    assert.equal(pose.z, 0);
    assert.equal(pose.rotationX, 0);
    assert.equal(pose.rotationY, 0);
    assert.equal(pose.rotation, 0);
    for (const channel of CHANNELS) assert.ok(Number.isFinite(pose[channel]));
  }
  assert.equal(start.opacity, 0);
  assert.ok(middle.opacity > 0 && middle.opacity < 1);
  assert.equal(end.opacity, 1);
  assert.ok(middle.scale <= Math.max(group.entryPose.scale, group.activePose.scale));

  const exit = resolveClassicLineExit('normal', 60, true);
  assert.equal(exit.durationMs, 120);
  assert.equal(exit.scale, 1);
  assert.equal(exit.blurPx, 0);
});

test('reduced motion remains drift-free and depth-free throughout the passed phase', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 2, driftRotation: 3 });
  const reducedOptions = { reducedMotion: true };
  const afterPassed = resolveClassicGroupPose(group, 3, { wordRevealMode: 'normal' }, reducedOptions);
  const afterDriftWindow = resolveClassicGroupPose(group, 8, { wordRevealMode: 'normal' }, reducedOptions);
  const repeated = resolveClassicGroupPose(group, 8, { wordRevealMode: 'normal' }, reducedOptions);
  const normalAfterPassed = resolveClassicGroupPose(group, 3, { wordRevealMode: 'normal' });
  const normalAfterDriftWindow = resolveClassicGroupPose(group, 8, { wordRevealMode: 'normal' });

  for (const pose of [afterPassed, afterDriftWindow]) {
    assert.equal(pose.phase, 'passed');
    assert.equal(pose.rotation, 0);
    assert.equal(pose.rotationX, 0);
    assert.equal(pose.rotationY, 0);
    assert.equal(pose.z, 0);
    for (const channel of ['x', 'y', 'opacity']) assert.ok(Number.isFinite(pose[channel]));
  }
  assert.equal(afterPassed.rotation, afterDriftWindow.rotation);
  assert.equal(afterPassed.x, afterDriftWindow.x);
  assert.equal(afterPassed.y, afterDriftWindow.y);
  assert.equal(afterPassed.opacity, afterDriftWindow.opacity);
  assert.deepEqual(repeated, afterDriftWindow);
  assert.notEqual(normalAfterPassed.rotation, normalAfterDriftWindow.rotation);
  assert.ok(normalAfterDriftWindow.rotation > normalAfterPassed.rotation);
});

test('line exit modes use independent smoothstep geometry and safe elapsed values', () => {
  for (const [mode, durationMs, maxScale, maxBlur] of [
    ['normal', 300, 1.04, 12],
    ['fast', 160, 1.02, 6],
    ['none', 120, 1, 0],
  ]) {
    const start = resolveClassicLineExit(mode, -10, false);
    const invalid = resolveClassicLineExit(mode, Number.NaN, false);
    const middle = resolveClassicLineExit(mode, durationMs / 2, false);
    const end = resolveClassicLineExit(mode, durationMs, false);
    assert.deepEqual(start, invalid);
    assert.equal(start.progress, 0);
    assert.equal(start.opacity, 1);
    assert.equal(middle.progress, 0.5);
    assert.equal(end.progress, 1);
    assert.equal(end.opacity, 0);
    assert.equal(end.scale, maxScale);
    assert.equal(end.blurPx, maxBlur);
    assert.equal(end.done, true);
    assert.equal(end.durationMs, durationMs);
  }
});

test('line transition and word reveal cross combinations remain independent', () => {
  const group = sampleGroup({ startTime: 1, activeEndTime: 2 });
  for (const lineTransitionMode of ['normal', 'fast', 'none']) {
    for (const wordRevealMode of ['normal', 'fast', 'instant']) {
      const exit = resolveClassicLineExit(lineTransitionMode, 0, false);
      const profile = resolveClassicMotionProfile({ wordRevealMode, lineTransitionMode });
      assert.equal(exit.durationMs, { normal: 300, fast: 160, none: 120 }[lineTransitionMode]);
      assert.equal(profile.entryDurationMs, { normal: 420, fast: 240, instant: 120 }[wordRevealMode]);
      assert.equal(resolveClassicGroupPose(group, 0.9, { wordRevealMode, lineTransitionMode }).phase,
        wordRevealMode === 'normal' ? 'entering' : 'waiting');
    }
  }
});

test('NaN and reversed group or grapheme timing always returns finite safe output', () => {
  const malformedGroup = {
    startTime: Number.NaN,
    endTime: -4,
    activeEndTime: Number.NaN,
    entryPose: { x: Number.NaN, scale: -Infinity },
    activePose: { y: Infinity, opacity: Number.NaN },
    passedPose: { z: Number.NaN, rotation: Infinity },
    driftRotation: Number.NaN,
  };
  for (const now of [Number.NaN, -10, 0, 10]) {
    const pose = resolveClassicGroupPose(malformedGroup, now, { wordRevealMode: 'invalid' });
    for (const channel of CHANNELS) assert.ok(Number.isFinite(pose[channel]), `${channel} is not finite`);
    assertUnit(pose.colorReturn, 'colorReturn');
  }

  const visual = resolveClassicGraphemeVisual(
    { startTime: 5, endTime: 2 },
    malformedGroup,
    Number.NaN,
    { wordRevealMode: 'normal' },
    Infinity
  );
  assertUnit(visual.highlight, 'highlight');
  assertUnit(visual.glow, 'glow');
});
