const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createFakeThree } = require('./helpers/fake-three');
const { buildNativeLyricDocument } = require('../public/folia-native/state');
const classicThreeState = require('../public/folia-native/classic-three-state');
const {
  buildClassicThreeModel,
  resolveClassicThreeFrame,
} = classicThreeState;
const { createClassicThreeDirector } = require('../public/folia-native/renderers/classic-three');

function lyricLine(raw) {
  return buildNativeLyricDocument([raw], { id: 'classic-three-song' }).lines[0];
}

function buildOptions(overrides = {}) {
  return {
    viewport: { width: 1366, height: 768 },
    worldPerPixel: 0.006,
    config: {
      intensity: 'normal',
      spread: 0.72,
      wordGlow: 0.8,
      breathing: 1,
      fontSize: 72,
      measureText: text => Array.from(text).length * 42,
    },
    ...overrides,
  };
}

const STATE_PATH = path.join(__dirname, '..', 'public', 'folia-native', 'classic-three-state.js');
const RENDERER_PATH = path.join(__dirname, '..', 'public', 'folia-native', 'renderers', 'classic-three.js');
const POSE_CHANNELS = ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotation', 'scale', 'opacity'];

function worldDistance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function worldDistance3d(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
}

function assertInside(bounds, viewport, safeArea) {
  assert.ok(bounds.left >= safeArea.left - 1e-6, `left ${bounds.left}`);
  assert.ok(bounds.right <= viewport.width - safeArea.right + 1e-6, `right ${bounds.right}`);
  assert.ok(bounds.top >= safeArea.top - 1e-6, `top ${bounds.top}`);
  assert.ok(bounds.bottom <= viewport.height - safeArea.bottom + 1e-6, `bottom ${bounds.bottom}`);
}

function scaleBoundsFromViewportCenter(bounds, viewport, scale) {
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return {
    left: centerX + (bounds.left - centerX) * scale,
    right: centerX + (bounds.right - centerX) * scale,
    top: centerY + (bounds.top - centerY) * scale,
    bottom: centerY + (bounds.bottom - centerY) * scale,
  };
}

test('browser UMD exposes the API and retains pinned Folia provenance', () => {
  const source = fs.readFileSync(STATE_PATH, 'utf8');
  const context = { globalThis: {} };

  vm.runInNewContext(source, context, { filename: STATE_PATH });

  assert.equal(typeof context.globalThis.MineradioNativeLyricClassicThreeState.buildClassicThreeModel, 'function');
  assert.equal(typeof context.globalThis.MineradioNativeLyricClassicThreeState.resolveClassicThreeFrame, 'function');
  assert.match(source, /chthollyphile\/folia-major/);
  assert.match(source, /baa5e846b7404f1893e8b7812bca79e959f21d3f/);
  assert.match(source, /AGPL-3\.0-or-later/);
});

test('CommonJS export resolves dependencies and produces model/frame behavior', () => {
  const model = classicThreeState.buildClassicThreeModel(
    lyricLine({ t: 0, duration: 1, text: '光' }),
    buildOptions(),
  );
  const frame = classicThreeState.resolveClassicThreeFrame(model, 0.5);

  assert.equal(model.glyphs.map(glyph => glyph.char).join(''), '光');
  assert.equal(frame.glyphs.map(glyph => glyph.char).join(''), '光');
});

test('browser API reports missing group and motion dependencies when invoked', () => {
  const source = fs.readFileSync(STATE_PATH, 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: STATE_PATH });
  const api = context.globalThis.MineradioNativeLyricClassicThreeState;

  assert.throws(
    () => api.buildClassicThreeModel({}, {}),
    error => error && error.message === 'CLASSIC_THREE_GROUPS_UNAVAILABLE',
  );
  assert.throws(
    () => api.resolveClassicThreeFrame({}, 0),
    error => error && error.message === 'CLASSIC_THREE_MOTION_UNAVAILABLE',
  );
});

test('Classic Three renderer browser API reports a missing direct motion dependency', () => {
  const source = fs.readFileSync(RENDERER_PATH, 'utf8');
  const context = {
    globalThis: {
      MineradioNativeLyricClassicThreeState: {
        buildClassicThreeModel() {},
        resolveClassicThreeFrame() {},
      },
      MineradioNativeLyricThreePerformance: {
        createThreeLyricPerformanceBudget: () => fixedLevelBudget(),
      },
      MineradioNativeLyricAdaptiveThree: { createAdaptiveThreeRenderer() {} },
      MineradioNativeLyricClassic: { createClassicRenderer() {} },
    },
  };
  vm.runInNewContext(source, context, { filename: RENDERER_PATH });

  assert.throws(
    () => context.globalThis.MineradioNativeLyricClassicThree.createClassicThreeDirector({ host: fakeClassicHost() }),
    error => error && error.message === 'Classic Three renderer motion is unavailable',
  );
});

test('model is deterministic and consists of rigid semantic groups', () => {
  const line = lyricLine({
    t: 1,
    duration: 4,
    text: '流光 穿过 city lights',
    words: [
      { text: '流光', t: 1, d: 1 },
      { text: '穿过', t: 2, d: 1 },
      { text: 'city', t: 3, d: 1 },
      { text: 'lights', t: 4, d: 1 },
    ],
  });
  const options = buildOptions({
    config: {
      ...buildOptions().config,
      intensity: 'chaotic',
      spread: 1,
    },
  });
  const first = buildClassicThreeModel(line, options);
  const second = buildClassicThreeModel(line, options);

  assert.deepEqual(first, second);
  assert.deepEqual(
    Object.keys(first.config).filter(key => ['fontFamily', 'fontWeight', 'fontSize', 'letterSpacing', 'dpr', 'glowPaddingTier'].includes(key)).sort(),
    ['dpr', 'fontFamily', 'fontSize', 'fontWeight', 'glowPaddingTier', 'letterSpacing'],
  );
  assert.equal(first.config.dpr, options.viewport.dpr || 1);
  assert.ok(first.groups.length >= 3);
  assert.equal(first.groups.every(group => group.localGlyphs.every(glyph => glyph.z === 0)), true);
  const stableDepths = first.groups.map(group => group.basePose.z);
  const stableScales = first.groups.map(group => group.basePose.scale);
  const stableYs = first.groups.map(group => group.basePose.y);
  assert.ok(Math.max(...stableDepths) - Math.min(...stableDepths) >= 0.36);
  assert.ok(Math.max(...stableScales) - Math.min(...stableScales) >= 0.12);
  assert.ok(Math.max(...stableYs) - Math.min(...stableYs) >= 0.08);
  assert.equal(first.groups.every(group => Math.abs(group.basePose.z) <= 0.34), true);
  assert.equal(first.groups.every(group => Math.abs(group.basePose.rotation) <= 7 * Math.PI / 180), true);
  assert.equal(first.groups.every(group => Math.abs(group.basePose.rotationX) <= 6 * Math.PI / 180), true);
  assert.equal(first.groups.every(group => Math.abs(group.basePose.rotationY) <= 9 * Math.PI / 180), true);
  assert.equal(first.groups.every(group => group.activePose.scale <= 1.32), true);
  assert.equal(first.groups.every(group => group.entryPose.scale < group.basePose.scale * 0.78), true);
  assert.equal(first.groups.every(group => group.entryPose.z <= group.basePose.z - 0.28), true);
  assert.equal(first.groups.every(group => group.activePose.z >= group.basePose.z + 0.14), true);
  assert.equal(first.groups.every(group => group.passedPose.z <= group.basePose.z - 0.08), true);
  assert.equal(first.groups.every(group => group.passedPose.opacity >= 0.82), true);
  assert.equal(first.glyphs.map(glyph => glyph.char).join('').replace(/\s/g, ''), line.fullText.replace(/\s/g, ''));
  assert.equal('orbit' in first, false);
  assert.equal(first.groups.every(group => !('radius' in group) && !('angle' in group)), true);
  assert.equal(first.ripple.targets.every(target => !('radius' in target) && !('angle' in target)), true);
});

test('calm groups keep shallow spatial depth while normal groups remain visibly layered', () => {
  const line = lyricLine({
    t: 0,
    duration: 2,
    text: '平静 流动',
    words: [
      { text: '平静', t: 0, d: 0.7 },
      { text: '流动', t: 1, d: 0.7 },
    ],
  });
  const calm = buildClassicThreeModel(line, buildOptions({
    config: { ...buildOptions().config, intensity: 'calm', spread: 1 },
  }));
  const normal = buildClassicThreeModel(line, buildOptions());

  const calmDepths = calm.groups.map(group => group.basePose.z);
  const normalDepths = normal.groups.map(group => group.basePose.z);
  assert.ok(Math.max(...calmDepths) - Math.min(...calmDepths) > 0);
  assert.equal(calm.groups.every(group => Math.abs(group.basePose.z) <= 0.14), true);
  assert.equal(calm.groups.every(group => Math.abs(group.basePose.rotationX) <= 2 * Math.PI / 180), true);
  assert.equal(calm.groups.every(group => Math.abs(group.basePose.rotationY) <= 3 * Math.PI / 180), true);
  assert.ok(Math.max(...normalDepths) - Math.min(...normalDepths) >= 0.36);
});

test('normal, fast and instant profiles preserve their active-end contracts', () => {
  const sourceLine = {
    index: 0,
    startTime: 1,
    endTime: 1.05,
    fullText: '光',
    translation: '',
    words: [{ text: '光', startTime: 1, endTime: 1.05 }],
    graphemes: [{ char: '光', startTime: 1, endTime: 1.05 }],
    renderHints: { wordRevealMode: 'normal', lineTransitionMode: 'normal', renderEndTime: 1.4 },
  };
  const normal = buildClassicThreeModel(sourceLine, buildOptions());
  const fast = buildClassicThreeModel({
    ...sourceLine,
    renderHints: { wordRevealMode: 'fast', lineTransitionMode: 'fast', renderEndTime: 1.4 },
  }, buildOptions());
  const instant = buildClassicThreeModel({
    ...sourceLine,
    renderHints: { wordRevealMode: 'instant', lineTransitionMode: 'none', renderEndTime: 1.4 },
  }, buildOptions());

  assert.equal(normal.groups[0].activeEndTime, 1.05);
  assert.equal(fast.groups[0].activeEndTime, 1.12);
  assert.equal(instant.groups[0].activeEndTime, 1.4);
  assert.equal(resolveClassicThreeFrame(normal, 1.2).glyphs[0].wordStatus, 'passed');
  assert.notEqual(resolveClassicThreeFrame(fast, 1.1).glyphs[0].wordStatus, 'passed');
  assert.notEqual(resolveClassicThreeFrame(instant, 1.3).glyphs[0].wordStatus, 'passed');
  assert.equal(instant.renderProfile.wordRevealMode, 'instant');
});

test('local glyph geometry stays rigid while one group pose drives every flattened member', () => {
  const line = lyricLine({
    t: 1,
    duration: 2,
    text: '倾诉',
    words: [{ text: '倾诉', t: 1, d: 2 }],
  });
  const model = buildClassicThreeModel(line, buildOptions({
    config: { ...buildOptions().config, enableWordRotation: false },
  }));
  const sourceGroup = model.groups[0];
  const localDistance = worldDistance(sourceGroup.localGlyphs[0], sourceGroup.localGlyphs[1]);

  for (const now of [0, 1.5, 4]) {
    const frame = resolveClassicThreeFrame(model, now);
    const group = frame.groups[0];
    const flattened = frame.glyphs.filter(glyph => glyph.groupIndex === 0);
    assert.strictEqual(group.localGlyphs, sourceGroup.localGlyphs);
    assert.equal(worldDistance(group.localGlyphs[0], group.localGlyphs[1]), localDistance);
    assert.ok(Math.abs(worldDistance(flattened[0], flattened[1]) - localDistance * group.pose.scale) < 1e-10);
    assert.equal(flattened.every(glyph => glyph.z === group.pose.z), true);
    assert.equal(flattened.every(glyph => glyph.rotationX === group.pose.rotationX), true);
    assert.equal(flattened.every(glyph => glyph.rotationY === group.pose.rotationY), true);
    assert.equal(flattened.every(glyph => glyph.rotation === group.pose.rotation), true);
    assert.equal(flattened.every(glyph => glyph.scale === group.pose.scale), true);
    assert.equal(flattened.every(glyph => glyph.opacity === group.pose.opacity), true);
  }
});

test('three-axis group pose rotates local glyph centers as one rigid plane', () => {
  const line = lyricLine({
    t: 1,
    duration: 2,
    text: '流光',
    words: [{ text: '流光', t: 1, d: 2 }],
  });
  const model = buildClassicThreeModel(line, buildOptions());
  const sourceGroup = model.groups[0];
  const localDistance = worldDistance3d(sourceGroup.localGlyphs[0], sourceGroup.localGlyphs[1]);
  const frame = resolveClassicThreeFrame(model, 1.5);
  const group = frame.groups[0];
  const flattened = frame.glyphs.filter(glyph => glyph.groupIndex === 0);
  const center = flattened.reduce((result, glyph) => ({
    x: result.x + glyph.x / flattened.length,
    y: result.y + glyph.y / flattened.length,
    z: result.z + glyph.z / flattened.length,
  }), { x: 0, y: 0, z: 0 });

  assert.ok(Math.abs(group.pose.rotationX) > 1e-3 || Math.abs(group.pose.rotationY) > 1e-3);
  assert.ok(Math.abs(worldDistance3d(flattened[0], flattened[1]) - localDistance * group.pose.scale) < 1e-10);
  assert.ok(Math.abs(center.x - group.pose.x) < 1e-10);
  assert.ok(Math.abs(center.y - group.pose.y) < 1e-10);
  assert.ok(Math.abs(center.z - group.pose.z) < 1e-10);
  assert.ok(Math.abs(flattened[0].z - flattened[1].z) > 1e-4);
  assert.equal(flattened.every(glyph => glyph.rotationX === group.pose.rotationX), true);
  assert.equal(flattened.every(glyph => glyph.rotationY === group.pose.rotationY), true);
  assert.equal(flattened.every(glyph => glyph.rotation === group.pose.rotation), true);
});

test('depth degradation keeps each semantic group rigid while reducing spatial tilt', () => {
  const line = lyricLine({
    t: 1,
    duration: 2,
    text: '流光',
    words: [{ text: '流光', t: 1, d: 2 }],
  });
  const model = buildClassicThreeModel(line, buildOptions());
  const sourceGroup = model.groups[0];
  const localDistance = worldDistance3d(sourceGroup.localGlyphs[0], sourceGroup.localGlyphs[1]);
  const full = resolveClassicThreeFrame(model, 1.5, { depthScale: 1 });
  const degraded = resolveClassicThreeFrame(model, 1.5, { depthScale: 0.5 });
  const fullGroup = full.groups[0];
  const degradedGroup = degraded.groups[0];
  const degradedGlyphs = degraded.glyphs.filter(glyph => glyph.groupIndex === 0);
  const center = degradedGlyphs.reduce((result, glyph) => ({
    x: result.x + glyph.x / degradedGlyphs.length,
    y: result.y + glyph.y / degradedGlyphs.length,
    z: result.z + glyph.z / degradedGlyphs.length,
  }), { x: 0, y: 0, z: 0 });

  assert.ok(Math.abs(degradedGroup.pose.z - fullGroup.pose.z * 0.5) < 1e-12);
  assert.ok(Math.abs(degradedGroup.pose.rotationX - fullGroup.pose.rotationX * 0.5) < 1e-12);
  assert.ok(Math.abs(degradedGroup.pose.rotationY - fullGroup.pose.rotationY * 0.5) < 1e-12);
  assert.ok(Math.abs(worldDistance3d(degradedGlyphs[0], degradedGlyphs[1]) - localDistance * degradedGroup.pose.scale) < 1e-10);
  assert.ok(Math.abs(center.x - degradedGroup.pose.x) < 1e-10);
  assert.ok(Math.abs(center.y - degradedGroup.pose.y) < 1e-10);
  assert.ok(Math.abs(center.z - degradedGroup.pose.z) < 1e-10);
});

test('separated groups enter independently instead of moving as one sentence', () => {
  const line = lyricLine({
    t: 1,
    duration: 3,
    text: '甲 乙 丙',
    words: [
      { text: '甲', t: 1, d: 0.2 },
      { text: '乙', t: 2, d: 0.2 },
      { text: '丙', t: 3, d: 0.2 },
    ],
  });
  const model = buildClassicThreeModel(line, buildOptions());

  assert.deepEqual(resolveClassicThreeFrame(model, 0.9).groups.map(group => group.pose.phase), ['entering', 'waiting', 'waiting']);
  assert.deepEqual(resolveClassicThreeFrame(model, 1.9).groups.map(group => group.pose.phase), ['passed', 'entering', 'waiting']);
  assert.deepEqual(resolveClassicThreeFrame(model, 2.9).groups.map(group => group.pose.phase), ['passed', 'passed', 'entering']);
});

test('flattened transforms are continuous at a short activeEnd boundary', () => {
  const line = {
    index: 0,
    startTime: 1,
    endTime: 1.05,
    fullText: '光',
    translation: '',
    words: [{ text: '光', startTime: 1, endTime: 1.05 }],
    graphemes: [{ char: '光', startTime: 1, endTime: 1.05 }],
    renderHints: { wordRevealMode: 'normal', lineTransitionMode: 'normal', renderEndTime: 1.4 },
  };
  const model = buildClassicThreeModel(line, buildOptions());
  const epsilon = 1e-7;
  const before = resolveClassicThreeFrame(model, model.groups[0].activeEndTime - epsilon).glyphs[0];
  const exact = resolveClassicThreeFrame(model, model.groups[0].activeEndTime).glyphs[0];
  const after = resolveClassicThreeFrame(model, model.groups[0].activeEndTime + epsilon).glyphs[0];

  for (const channel of POSE_CHANNELS) {
    assert.ok(Math.abs(before[channel] - exact[channel]) < 1e-5, `${channel} before`);
    assert.ok(Math.abs(after[channel] - exact[channel]) < 1e-5, `${channel} after`);
  }
});

test('reduced motion stays finite and removes rotation, depth, ripple and breathing', () => {
  const line = lyricLine({ t: 1, duration: 2, text: '副歌', isChorus: true });
  const model = buildClassicThreeModel(line, buildOptions());
  const normal = resolveClassicThreeFrame(model, 1.2, { ambientTime: 1.2 });
  const reduced = resolveClassicThreeFrame(model, 1.2, { reducedMotion: true, ambientTime: 1.2 });

  assert.equal(normal.ripple.enabled, true);
  assert.equal(normal.group.breathing !== 1, true);
  assert.equal(reduced.ripple.enabled, false);
  assert.equal(reduced.group.breathing, 1);
  assert.equal(reduced.groups.every(group => (
    group.pose.z === 0
    && group.pose.rotationX === 0
    && group.pose.rotationY === 0
    && group.pose.rotation === 0
  )), true);
  assert.equal(reduced.glyphs.every(glyph => POSE_CHANNELS.every(channel => Number.isFinite(glyph[channel]))), true);
});

test('Classic 3D chorus ripple is bounded and follows active word timing', () => {
  const line = lyricLine({ t: 2, duration: 2, text: '一起 唱', isChorus: true });
  const model = buildClassicThreeModel(line, buildOptions({
    config: { ...buildOptions().config, chorusRipple: true },
  }));
  const before = resolveClassicThreeFrame(model, 1);
  const active = resolveClassicThreeFrame(model, 2.1);
  const after = resolveClassicThreeFrame(model, 5);

  assert.equal(before.ripple.opacity, 0);
  assert.ok(active.ripple.opacity > 0 && active.ripple.opacity <= 0.72);
  assert.ok(active.ripple.scale >= 0.2 && active.ripple.scale <= model.ripple.maxScale);
  assert.equal(after.ripple.opacity, 0);
});

test('main and translation envelopes are nonintersecting and safe on mobile and desktop', () => {
  const line = lyricLine({
    t: 0,
    duration: 3,
    text: '流光穿过很长很长的夜色直到城市另一端',
    translation: 'The streaming light crosses the city to the other side.',
  });
  for (const viewport of [
    { width: 390, height: 844, dpr: 3 },
    { width: 960, height: 540, dpr: 1 },
    { width: 1366, height: 768, dpr: 1 },
    { width: 1920, height: 1080, dpr: 2 },
  ]) {
    const safeArea = viewport.width === 390
      ? { left: 24, right: 24, top: 80, bottom: 150 }
      : { left: 48, right: 48, top: 48, bottom: 72 };
    const model = buildClassicThreeModel(line, buildOptions({
      viewport,
      safeArea,
      config: { ...buildOptions().config, fontSize: 64 },
    }));
    assertInside(model.projectedBounds, viewport, safeArea);
    assertInside(model.translation.projectedBounds, viewport, safeArea);
    assert.ok(model.projectedBounds.bottom < model.translation.projectedBounds.top);
    assert.ok(model.projectedBounds.width <= (viewport.width - safeArea.left - safeArea.right) * 0.92 + 1e-6);
  }

  const hidden = buildClassicThreeModel(line, buildOptions({
    config: { ...buildOptions().config, translationMode: 'off' },
  }));
  assert.equal(hidden.translation.visible, false);
  assert.equal(hidden.translation.text, '');
});

test('stage scale reserves asymmetric shelf safe area before the Three root is enlarged', () => {
  const viewport = { width: 960, height: 540, dpr: 1 };
  const safeArea = { left: 64, right: 300, top: 52, bottom: 96 };
  const stageScale = 1.8;
  const line = lyricLine({
    t: 0,
    duration: 3,
    text: '流光穿过很长很长的夜色直到城市另一端',
    translation: 'The streaming light crosses the city to the other side.',
  });
  const model = buildClassicThreeModel(line, buildOptions({
    viewport,
    safeArea,
    stageScale,
    config: { ...buildOptions().config, fontSize: 64 },
  }));
  const mainBounds = scaleBoundsFromViewportCenter(model.projectedBounds, viewport, stageScale);
  const translationBounds = scaleBoundsFromViewportCenter(model.translation.projectedBounds, viewport, stageScale);

  assertInside(mainBounds, viewport, safeArea);
  assertInside(translationBounds, viewport, safeArea);
  assert.ok(mainBounds.bottom < translationBounds.top);
  assert.notEqual(
    model.cacheKey,
    buildClassicThreeModel(line, buildOptions({ viewport, safeArea, stageScale: 1 })).cacheKey,
  );
});

test('mixed CJK, Latin and joined emoji preserve grapheme identity and source indices', () => {
  const family = '👨‍👩‍👧‍👦';
  const line = lyricLine({ t: 0, duration: 2, text: `爱A${family}光` });
  const model = buildClassicThreeModel(line, buildOptions());

  assert.deepEqual(model.glyphs.map(glyph => glyph.char), ['爱', 'A', family, '光']);
  assert.equal(model.groups.flatMap(group => group.localGlyphs).every(glyph => (
    Number.isInteger(glyph.groupIndex) && Number.isInteger(glyph.graphemeIndex) && Number.isInteger(glyph.sourceGraphemeIndex)
  )), true);
});

test('source grapheme indices retain whitespace and joined emoji positions', () => {
  const family = '👨‍👩‍👧‍👦';
  const line = lyricLine({ t: 0, duration: 2, text: `A ${family} B` });
  const model = buildClassicThreeModel(line, buildOptions());
  const familyGlyph = model.glyphs.find(glyph => glyph.char === family);
  const bGlyph = model.glyphs.find(glyph => glyph.char === 'B');

  assert.equal(line.graphemes.length, 5);
  assert.deepEqual(model.glyphs.map(glyph => glyph.char), ['A', family, 'B']);
  assert.equal(familyGlyph.graphemeIndex, 2);
  assert.equal(familyGlyph.sourceGraphemeIndex, 2);
  assert.equal(bGlyph.graphemeIndex, 4);
  assert.equal(bGlyph.sourceGraphemeIndex, 4);
});

function separatedWordLine(text, words) {
  return {
    index: 8,
    startTime: 0,
    endTime: 1.2,
    fullText: text,
    translation: '',
    words: words.map((word, index) => ({
      text: word,
      startTime: index * 0.4,
      endTime: index * 0.4 + 0.1,
    })),
    renderHints: {
      timingClass: 'normal',
      renderEndTime: 1.4,
      wordRevealMode: 'normal',
      lineTransitionMode: 'normal',
    },
  };
}

for (const [label, text, words] of [
  ['separator whitespace', 'A B C', ['A', 'B', 'C']],
  ['joined emoji separators', 'A 👨‍👩‍👧‍👦 B', ['A', '👨‍👩‍👧‍👦', 'B']],
  ['repeated graphemes', 'A A A', ['A', 'A', 'A']],
]) {
  test(`separate groups align ${label} monotonically to line source indices`, () => {
    const model = buildClassicThreeModel(separatedWordLine(text, words), buildOptions());

    assert.equal(model.groups.length, 3);
    assert.deepEqual(model.glyphs.map(glyph => glyph.char), words);
    assert.deepEqual(model.glyphs.map(glyph => glyph.graphemeIndex), [0, 2, 4]);
    assert.deepEqual(model.glyphs.map(glyph => glyph.sourceGraphemeIndex), [0, 2, 4]);
  });
}

test('cache key covers spatial/config inputs and excludes playback time', () => {
  const line = lyricLine({ t: 0, duration: 2, text: '流光' });
  const base = buildClassicThreeModel(line, buildOptions());
  const variants = [
    buildOptions({ viewport: { width: 960, height: 540, dpr: 2 } }),
    buildOptions({ safeArea: { left: 80, right: 48, top: 48, bottom: 72 } }),
    buildOptions({ worldPerPixel: 0.004 }),
    buildOptions({ config: { ...buildOptions().config, fontFamily: 'Inter' } }),
    buildOptions({ config: { ...buildOptions().config, fontWeight: 600 } }),
    buildOptions({ config: { ...buildOptions().config, letterSpacing: 4 } }),
    buildOptions({ config: { ...buildOptions().config, glowPaddingTier: 'high' } }),
    buildOptions({ config: { ...buildOptions().config, translationGap: 40 } }),
    buildOptions({ config: { ...buildOptions().config, translationMode: 'off' } }),
    buildOptions({ config: { ...buildOptions().config, intensity: 'chaotic' } }),
    buildOptions({ config: { ...buildOptions().config, spread: 0.2 } }),
    buildOptions({ config: { ...buildOptions().config, wordSpacing: 1.4 } }),
    buildOptions({ config: { ...buildOptions().config, enableWordRotation: false } }),
  ];

  for (const options of variants) assert.notEqual(buildClassicThreeModel(line, options).cacheKey, base.cacheKey);
  assert.notEqual(buildClassicThreeModel(lyricLine({ t: 0, duration: 2, text: '星光' }), buildOptions()).cacheKey, base.cacheKey);
  assert.equal(buildClassicThreeModel(line, { ...buildOptions(), now: 999, rafDeltaMs: 3 }).cacheKey, base.cacheKey);
});

test('Classic Three model preserves bounded negative letter spacing and finite nonnegative width', () => {
  const line = lyricLine({ t: 0, duration: 2, text: 'ABCD' });
  const modelWithSpacing = (letterSpacing, measureText) => buildClassicThreeModel(line, buildOptions({
    config: {
      ...buildOptions().config,
      fontSize: 50,
      letterSpacing,
      measureText,
    },
  }));
  const zero = modelWithSpacing(0, () => 20);
  const negative = modelWithSpacing(-50 * 0.04, () => 20);
  const extreme = modelWithSpacing(-999, () => 0);

  assert.equal(zero.config.letterSpacing, 0);
  assert.equal(negative.config.letterSpacing, -2);
  assert.ok(negative.projectedBounds.width < zero.projectedBounds.width);
  assert.ok(Number.isFinite(extreme.projectedBounds.width));
  assert.ok(extreme.projectedBounds.width >= 0);
  assert.ok(extreme.groups.every(group => Number.isFinite(group.projectedBounds.width) && group.projectedBounds.width >= 0));
});

for (const [setting, value] of [
  ['layoutTuning', 'compact'],
  ['useLegacyLayout', true],
]) {
  test(`cache key ignores unused ${setting}`, () => {
    const line = lyricLine({ t: 0, duration: 2, text: '流光' });
    const base = buildClassicThreeModel(line, buildOptions()).cacheKey;
    const config = { ...buildOptions().config, [setting]: value };

    assert.equal(buildClassicThreeModel(line, buildOptions({ config })).cacheKey, base);
  });
}

function timingCacheLine() {
  return {
    index: 7,
    startTime: 1,
    endTime: 3,
    fullText: '流光',
    translation: '',
    words: [
      {
        text: '流',
        startTime: 1,
        endTime: 2,
        syllables: [{ text: '流', startTime: 1, endTime: 2 }],
      },
      {
        text: '光',
        startTime: 2,
        endTime: 3,
        syllables: [{ text: '光', startTime: 2, endTime: 3 }],
      },
    ],
    graphemes: [
      { char: '流', startTime: 1, endTime: 2 },
      { char: '光', startTime: 2, endTime: 3 },
    ],
    renderHints: {
      timingClass: 'normal',
      renderEndTime: 3.4,
      wordRevealMode: 'normal',
      lineTransitionMode: 'normal',
    },
  };
}

function cloned(value) {
  return JSON.parse(JSON.stringify(value));
}

test('cache key remains collision-safe when the 32-bit hash prefix collides', () => {
  const source = fs.readFileSync(STATE_PATH, 'utf8');
  const layoutApi = require('../public/folia-native/layout');
  const context = {
    globalThis: {
      MineradioNativeLyricDomState: require('../public/folia-native/dom-state'),
      MineradioNativeLyricLayout: { ...layoutApi, hash32: () => parseInt('mps78z', 36) },
      MineradioNativeLyricClassicThreeGroups: require('../public/folia-native/classic-three-groups'),
      MineradioNativeLyricClassicThreeMotion: require('../public/folia-native/classic-three-motion'),
    },
  };
  vm.runInNewContext(source, context, { filename: STATE_PATH });
  const api = context.globalThis.MineradioNativeLyricClassicThreeState;
  const firstLine = lyricLine({ t: 0, duration: 2, text: 'xzxi' });
  const secondLine = lyricLine({ t: 0, duration: 2, text: 'x116i' });
  const first = api.buildClassicThreeModel(firstLine, buildOptions());
  const second = api.buildClassicThreeModel(secondLine, buildOptions());

  assert.equal(first.glyphs.map(glyph => glyph.char).join(''), 'xzxi');
  assert.equal(second.glyphs.map(glyph => glyph.char).join(''), 'x116i');
  assert.notDeepEqual(first.glyphs.map(glyph => glyph.char), second.glyphs.map(glyph => glyph.char));
  assert.notEqual(first.cacheKey, second.cacheKey);
  assert.equal(api.buildClassicThreeModel(cloned(firstLine), buildOptions()).cacheKey, first.cacheKey);
  assert.equal(api.buildClassicThreeModel(cloned(secondLine), buildOptions()).cacheKey, second.cacheKey);
});

test('cache key retains canonical timing when the inner 32-bit signature collides', () => {
  const source = fs.readFileSync(STATE_PATH, 'utf8');
  const layoutApi = require('../public/folia-native/layout');
  const context = {
    globalThis: {
      MineradioNativeLyricDomState: require('../public/folia-native/dom-state'),
      MineradioNativeLyricLayout: { ...layoutApi, hash32: () => parseInt('1c22ytc', 36) },
      MineradioNativeLyricClassicThreeGroups: require('../public/folia-native/classic-three-groups'),
      MineradioNativeLyricClassicThreeMotion: require('../public/folia-native/classic-three-motion'),
    },
  };
  vm.runInNewContext(source, context, { filename: STATE_PATH });
  const api = context.globalThis.MineradioNativeLyricClassicThreeState;
  const collisionLine = activeEndTime => ({
    index: 9,
    startTime: 0,
    endTime: 1,
    fullText: 'x',
    translation: '',
    words: [{ text: 'x', startTime: 0, endTime: activeEndTime }],
    graphemes: [{ char: 'x', startTime: 0, endTime: activeEndTime }],
    renderHints: {
      timingClass: 'normal',
      renderEndTime: 1.2,
      wordRevealMode: 'normal',
      lineTransitionMode: 'normal',
    },
  });
  const firstLine = collisionLine(0.433565);
  const secondLine = collisionLine(0.560175);
  const first = api.buildClassicThreeModel(firstLine, buildOptions());
  const second = api.buildClassicThreeModel(secondLine, buildOptions());

  assert.equal(first.groups[0].activeEndTime, 0.433565);
  assert.equal(second.groups[0].activeEndTime, 0.560175);
  assert.notEqual(first.cacheKey, second.cacheKey);
  assert.equal(api.buildClassicThreeModel(cloned(firstLine), buildOptions()).cacheKey, first.cacheKey);
  assert.equal(api.buildClassicThreeModel(cloned(secondLine), buildOptions()).cacheKey, second.cacheKey);
});

for (const [label, mutate] of [
  ['word start/end timing', line => { line.words[0].endTime = 2.1; }],
  ['syllable timing', line => { line.words[0].syllables[0].endTime = 1.95; }],
  ['line grapheme timing', line => { line.graphemes[0].endTime = 1.8; }],
  ['render hint timingClass', line => { line.renderHints.timingClass = 'micro'; }],
  ['render hint wordRevealMode', line => { line.renderHints.wordRevealMode = 'fast'; }],
  ['render hint lineTransitionMode', line => { line.renderHints.lineTransitionMode = 'fast'; }],
  ['render hint renderEndTime', line => { line.renderHints.renderEndTime = 3.8; }],
]) {
  test(`cache key changes with ${label}`, () => {
    const source = timingCacheLine();
    const changed = cloned(source);
    mutate(changed);

    assert.notEqual(
      buildClassicThreeModel(changed, buildOptions()).cacheKey,
      buildClassicThreeModel(source, buildOptions()).cacheKey,
    );
  });
}

test('cache timing/profile signature is value-based and property-order independent', () => {
  const source = timingCacheLine();
  const equivalent = cloned(source);
  equivalent.renderHints = {
    lineTransitionMode: 'normal',
    wordRevealMode: 'normal',
    renderEndTime: 3.4,
    timingClass: 'normal',
  };

  assert.notStrictEqual(equivalent, source);
  assert.notStrictEqual(equivalent.words, source.words);
  assert.equal(
    buildClassicThreeModel(equivalent, buildOptions()).cacheKey,
    buildClassicThreeModel(source, buildOptions()).cacheKey,
  );
});

test('cache key tracks normalized chorus state and stays stable for equivalent clones', () => {
  const nonChorusLine = { ...timingCacheLine(), isChorus: false };
  const chorusLine = { ...timingCacheLine(), isChorus: true };
  const nonChorus = buildClassicThreeModel(nonChorusLine, buildOptions());
  const chorus = buildClassicThreeModel(chorusLine, buildOptions());

  assert.equal(nonChorus.ripple.enabled, false);
  assert.equal(chorus.ripple.enabled, true);
  assert.notEqual(chorus.cacheKey, nonChorus.cacheKey);
  assert.equal(buildClassicThreeModel(cloned(nonChorusLine), buildOptions()).cacheKey, nonChorus.cacheKey);
  assert.equal(buildClassicThreeModel(cloned(chorusLine), buildOptions()).cacheKey, chorus.cacheKey);
});

test('ambientTime changes only whole-line breathing, not playback pose or glyph light', () => {
  const model = buildClassicThreeModel(lyricLine({ t: 1, duration: 2, text: '流光' }), buildOptions());
  const first = resolveClassicThreeFrame(model, 1.3, { ambientTime: 0 });
  const second = resolveClassicThreeFrame(model, 1.3, { ambientTime: 1.25 });

  assert.notDeepEqual(second.group, first.group);
  assert.deepEqual(second.groups, first.groups);
  assert.deepEqual(second.glyphs, first.glyphs);
  assert.ok(Math.abs(second.group.y) <= 6 * model.worldPerPixel + 1e-12);
});

function transformNode() {
  return {
    name: '',
    parent: null,
    children: [],
    visible: true,
    position: { values: [], set(...values) { this.values = values; } },
    scale: { values: [], set(...values) { this.values = values; }, setScalar(value) { this.values = [value, value, value]; } },
    rotation: { x: 0, y: 0, z: 0 },
    userData: {},
    add(...nodes) {
      nodes.forEach(node => {
        if (!node) return;
        if (node.parent && typeof node.parent.remove === 'function') node.parent.remove(node);
        node.parent = this;
        this.children.push(node);
      });
    },
    remove(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) this.children.splice(index, 1);
      if (node) node.parent = null;
    },
  };
}

function fakeClassicHost() {
  const calls = [];
  const leases = [];
  const atlasAcquires = [];
  const atlasEvents = [];
  const batches = [];
  const blocks = [];
  const scopes = [];
  const transitions = [];
  let contextListener = null;
  const atlas = {
    acquire(char, inputStyle = {}) {
      const style = { ...inputStyle };
      const acquire = { char, style, order: atlasEvents.length };
      atlasAcquires.push(acquire);
      atlasEvents.push({ type: 'acquire', char, style });
      calls.push(`atlas:acquire:${char}`);
      const lease = {
        char,
        style,
        releases: 0,
        entry: {
          pageId: 'page-1',
          texture: { id: 'texture-1' },
          uv: { u0: 0.25, v0: 0.3, u1: 0.65, v1: 0.8 },
          sampleUv: { u0: 0.2, v0: 0.2, u1: 0.7, v1: 0.9 },
          sampleClampUv: { u0: 0.21, v0: 0.21, u1: 0.69, v1: 0.89 },
          width: 40,
          height: 50,
          sampleWidth: 40 + Math.max(0, Number(style.glowPadding) || 0) * 2,
          sampleHeight: 50 + Math.max(0, Number(style.glowPadding) || 0) * 2,
        },
        release() {
          if (this.releases) return;
          this.releases = 1;
          atlasEvents.push({ type: 'release', char: this.char, style: this.style });
          calls.push(`atlas:release:${this.char}`);
        },
      };
      leases.push(lease);
      return lease;
    },
  };
  const host = {
    calls,
    leases,
    atlasAcquires,
    atlasEvents,
    batches,
    blocks,
    scopes,
    transitions,
    getAtlas() { return atlas; },
    createModeScope(mode) {
      calls.push(`scope:${mode}`);
      const group = transformNode();
      const resources = [];
      const scope = {
        group,
        releases: 0,
        track(resource) {
          resources.push(resource);
          return resource;
        },
        released() { return this.releases > 0; },
        release() {
          if (this.releases) return;
          this.releases = 1;
          for (let index = resources.length - 1; index >= 0; index -= 1) resources[index].release();
          resources.length = 0;
        },
      };
      scopes.push(scope);
      return scope;
    },
    createGlyphBatch(scope, options = {}) {
      const role = String(options.role || `batch-${batches.length}`);
      calls.push(`batch:create:${role}`);
      const batch = {
        role,
        renderOrder: options.renderOrder,
        updates: [],
        releases: 0,
        setInstances(instances) {
          calls.push(`batch:update:${this.role}`);
          this.updates.push(instances);
        },
        snapshot() {
          const last = this.updates.at(-1) || [];
          return { instances: last.length, drawBatches: last.length ? 1 : 0 };
        },
        release() {
          if (this.releases) return;
          this.releases = 1;
        },
      };
      batches.push(batch);
      return scope.track(batch);
    },
    createBlockPlane(scope, options) {
      calls.push(`block:create:${options.role}`);
      const mesh = transformNode();
      const parent = options.parent || scope.group;
      parent.add(mesh);
      const block = {
        role: options.role,
        contents: [],
        visibility: [],
        opacity: [],
        releases: 0,
        setContent(key, draw) {
          const canvas = { width: options.width, height: options.height };
          const context = {
            font: '',
            fillStyle: '',
            strokeStyle: '',
            globalAlpha: 1,
            lineWidth: 1,
            textAlign: '',
            textBaseline: '',
            fillTextCalls: [],
            save() {},
            restore() {},
            beginPath() {},
            arc() {},
            stroke() {},
            fillText(...args) { this.fillTextCalls.push({ args, font: this.font }); },
          };
          if (typeof draw === 'function') draw(context, canvas);
          this.contents.push({ key, context, canvas });
        },
        setVisible(value) { this.visibility.push(value); },
        setOpacity(value) { this.opacity.push(value); },
        getMesh() { return mesh; },
        snapshot() { return { redraws: this.contents.length }; },
        release() {
          if (this.releases) return;
          this.releases = 1;
          if (mesh.parent) mesh.parent.remove(mesh);
        },
      };
      blocks.push(block);
      return scope.track(block);
    },
    updateAnchor(frame) { calls.push(`anchor:${frame.lineIndex}`); },
    captureTransition(scope, options = {}) {
      const purpose = options.purpose || 'mode-switch';
      calls.push(`capture:${purpose}`);
      const transition = {
        kind: 'managed-three-transition',
        scope,
        purpose,
        visualUpdates: [],
        releases: 0,
        setVisualState(value) { this.visualUpdates.push({ ...value }); },
        release() {
          if (this.releases) return;
          this.releases = 1;
          calls.push(`transition:release:${this.purpose}`);
        },
      };
      transitions.push(transition);
      return transition;
    },
    subscribeContext(listener) {
      calls.push('context:subscribe');
      contextListener = listener;
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        calls.push('context:unsubscribe');
        contextListener = null;
      };
    },
    emitContext(type) { if (contextListener) contextListener({ type }); },
    trim(level) { calls.push(`trim:${level}`); },
    snapshot() {
      const activeScope = scopes.findLast(candidate => !candidate.released());
      const native = activeScope && activeScope.group.userData.nativeLyricSnapshot || {};
      return {
        atlasPages: 1,
        atlasBytes: 4096,
        glyphInstances: Number(native.instances) || 0,
        drawBatches: Number(native.drawBatches) || 0,
        transitionLayers: transitions.filter(transition => transition.releases === 0).length,
      };
    },
  };
  return host;
}

function classicDocument() {
  return buildNativeLyricDocument([
    { t: 0, duration: 2, text: '流光', translation: 'Streaming light', isChorus: true },
    { t: 2, duration: 2, text: '穿过夜色', translation: 'Across the night' },
  ], { id: 'classic-director-song' });
}

function classicFrame(document, overrides = {}) {
  return {
    now: 0.6,
    lineIndex: 0,
    line: document.lines[0],
    nextLine: document.lines[1],
    viewport: { width: 960, height: 540, dpr: 1 },
    quality: 'balanced',
    rafDeltaMs: 16.7,
    reducedMotion: false,
    theme: { primary: '#d6f8ff', highlight: '#fff0b8' },
    config: {
      common: { scale: 1, opacity: 1, glow: 0.55, translationMode: 'auto', performanceMode: 'balanced' },
      modes: { classic: { intensity: 'normal', spread: 0.72, wordGlow: 0.82, breathing: 1, chorusRipple: true } },
    },
    ...overrides,
  };
}

function fixedLevelBudget(level = 0) {
  return {
    push() { return { level, fallback: false, p95FrameMs: 0 }; },
    suspend() {},
    resetTrack() {},
    snapshot() { return { level, fallback: false }; },
  };
}

function batchByRole(host, role) {
  const batch = host.batches.find(candidate => candidate.role === role);
  assert.ok(batch, `expected ${role} glyph batch`);
  return batch;
}

test('Classic Three director uses crisp body and bounded glow batches with one shared padded matrix', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([
    {
      t: 0,
      duration: 1,
      text: '光',
      words: [{ text: '光', t: 0, d: 1 }],
    },
  ], { id: 'classic-batches' });
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const frame = classicFrame(document, { now: 0.04, nextLine: null });

  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);

  assert.equal(host.batches.length, 2);
  assert.deepEqual(
    host.batches.map(batch => ({ role: batch.role, renderOrder: batch.renderOrder })),
    [
      { role: 'body', renderOrder: 38 },
      { role: 'glow', renderOrder: 37 },
    ],
  );
  const body = batchByRole(host, 'body').updates.at(-1);
  const glow = batchByRole(host, 'glow').updates.at(-1);
  assert.ok(body.length > 0);
  assert.equal(glow.length, body.length);
  assert.equal(body.every(item => item.variant === 'body'), true);
  assert.equal(glow.every(item => item.variant === 'glow-5'), true);
  body.forEach((item, index) => {
    assert.strictEqual(glow[index].matrix, item.matrix);
    assert.strictEqual(item.uv, host.leases[index].entry.uv);
    assert.strictEqual(item.sampleUv, host.leases[index].entry.sampleUv);
    assert.strictEqual(item.sampleClampUv, host.leases[index].entry.sampleClampUv);
    assert.strictEqual(glow[index].uv, item.uv);
    assert.strictEqual(glow[index].sampleUv, item.sampleUv);
    assert.strictEqual(glow[index].sampleClampUv, item.sampleClampUv);
  });

  const expectedModel = buildClassicThreeModel(document.lines[0], {
    viewport: frame.viewport,
    safeArea: {},
    worldPerPixel: 0.006,
    config: {
      ...frame.config.modes.classic,
      fontSize: 56,
      translationMode: 'auto',
      glowPaddingTier: 8,
    },
  });
  const expectedGlyph = resolveClassicThreeFrame(expectedModel, frame.now).glyphs[0];
  const entry = host.leases[0].entry;
  const matrix = body[0].matrix;
  assert.ok(Math.abs(Math.hypot(matrix[0], matrix[1], matrix[2])
    - expectedGlyph.width * expectedGlyph.scale * entry.sampleWidth / entry.width) < 1e-10);
  assert.ok(Math.abs(Math.hypot(matrix[4], matrix[5], matrix[6])
    - expectedGlyph.height * expectedGlyph.scale * entry.sampleHeight / entry.height) < 1e-10);
  assert.ok(Math.abs(matrix[2]) > 1e-6 || Math.abs(matrix[6]) > 1e-6);
  assert.equal(matrix[12], expectedGlyph.x);
  assert.equal(matrix[13], expectedGlyph.y);
  const primary = [0xd6 / 255, 0xf8 / 255, 1];
  const highlight = [1, 0xf0 / 255, 0xb8 / 255];
  assert.deepEqual(
    body[0].tint,
    primary.map((value, index) => value + (highlight[index] - value) * body[0].progress),
  );
  director.destroy();
});

test('Classic Three body tint returns exactly to primary after a glyph has fully passed', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([
    {
      t: 1,
      duration: 1,
      text: '光',
      words: [{ text: '光', t: 1, d: 1 }],
    },
  ], { id: 'classic-passed-tint' });
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const model = buildClassicThreeModel(document.lines[0], buildOptions());
  const waitingState = resolveClassicThreeFrame(model, 0).glyphs[0];
  const passedState = resolveClassicThreeFrame(model, 3).glyphs[0];
  const primary = [0xd6 / 255, 0xf8 / 255, 1];

  assert.equal(waitingState.wordStatus, 'waiting');
  assert.equal(waitingState.progress, 0);
  assert.equal(passedState.wordStatus, 'passed');
  assert.equal(passedState.progress, 0);

  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { now: 0, nextLine: null, rafDeltaMs: 0 }));
  const waitingDescriptor = batchByRole(host, 'body').updates.at(-1)[0];
  director.update(classicFrame(document, { now: 3, nextLine: null, rafDeltaMs: 0 }));
  const passedDescriptor = batchByRole(host, 'body').updates.at(-1)[0];

  assert.equal(waitingDescriptor.progress, passedDescriptor.progress);
  assert.deepEqual(waitingDescriptor.tint, primary);
  assert.deepEqual(passedDescriptor.tint, primary);
  assert.deepEqual(passedDescriptor.tint, waitingDescriptor.tint);
  director.destroy();
});

test('Classic Three director selects bounded quality glow tiers, padding and DPR caps', () => {
  const document = classicDocument();
  for (const [quality, glowVariant, glowPadding, dpr] of [
    ['quality', 'glow-9', 10, 2],
    ['balanced', 'glow-5', 8, 1.5],
    ['battery', 'glow-3', 6, 1],
  ]) {
    const host = fakeClassicHost();
    const director = createClassicThreeDirector({
      host,
      createPerformanceBudget: () => fixedLevelBudget(),
    });
    director.mount({ root: {} });
    director.setDocument(document);
    director.update(classicFrame(document, {
      quality,
      viewport: { width: 960, height: 540, dpr: 3 },
      config: {
        ...classicFrame(document).config,
        common: { ...classicFrame(document).config.common, performanceMode: quality },
      },
    }));

    assert.equal(batchByRole(host, 'glow').updates.at(-1).every(item => item.variant === glowVariant), true);
    assert.equal(host.atlasAcquires.every(acquire => acquire.style.glowPadding === glowPadding), true);
    assert.equal(host.atlasAcquires.every(acquire => acquire.style.dpr === dpr), true);
    director.destroy();
  }
});

test('Classic Three director lowers glow and depth by degradation level', () => {
  const document = classicDocument();
  for (const [quality, degradedVariant, degradedPadding] of [
    ['quality', 'glow-5', 8],
    ['balanced', 'glow-3', 6],
    ['battery', 'glow-3', 6],
  ]) {
    const host = fakeClassicHost();
    let pushes = 0;
    const director = createClassicThreeDirector({
      host,
      createPerformanceBudget: () => ({
        ...fixedLevelBudget(1),
        push() { pushes += 1; return { level: 1, fallback: false }; },
      }),
    });
    const frame = classicFrame(document, { quality, now: 0.04 });
    director.mount({ root: {} });
    director.setDocument(document);
    director.update(frame);
    const glow = batchByRole(host, 'glow').updates.at(-1);
    const snapshot = director.snapshot();
    assert.equal(pushes, 1);
    assert.equal(glow.every(item => item.variant === degradedVariant), true);
    assert.equal(host.atlasAcquires.every(acquire => acquire.style.glowPadding === degradedPadding), true);
    assert.equal(snapshot.degradationLevel, 1);
    assert.equal(snapshot.glowVariant, degradedVariant);
    assert.equal(snapshot.glowInstances, glow.length);
    director.destroy();
  }

  const baselineHost = fakeClassicHost();
  const baselineDirector = createClassicThreeDirector({
    host: baselineHost,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const degradedHost = fakeClassicHost();
  const degradedDirector = createClassicThreeDirector({
    host: degradedHost,
    createPerformanceBudget: () => fixedLevelBudget(2),
  });
  const frame = classicFrame(document, { now: 0.04 });
  baselineDirector.mount({ root: {} });
  baselineDirector.setDocument(document);
  baselineDirector.update(frame);
  degradedDirector.mount({ root: {} });
  degradedDirector.setDocument(document);
  degradedDirector.update(frame);
  const baselineZ = batchByRole(baselineHost, 'body').updates.at(-1)[0].matrix[14];
  const baselineBody = batchByRole(baselineHost, 'body').updates.at(-1);
  const degradedBody = batchByRole(degradedHost, 'body').updates.at(-1);
  const matrixDistance = body => Math.hypot(
    body[1].matrix[12] - body[0].matrix[12],
    body[1].matrix[13] - body[0].matrix[13],
    body[1].matrix[14] - body[0].matrix[14],
  );
  const centerZ = body => (body[0].matrix[14] + body[1].matrix[14]) / 2;
  assert.ok(Math.abs(baselineZ) > 0);
  assert.ok(Math.abs(centerZ(degradedBody) - centerZ(baselineBody) * 0.5) < 1e-12);
  assert.ok(Math.abs(matrixDistance(degradedBody) - matrixDistance(baselineBody)) < 1e-10);
  baselineDirector.destroy();
  degradedDirector.destroy();
});

test('Classic Three level 1 degradation truncates low-strength glow tails in the same frame', () => {
  const document = buildNativeLyricDocument([
    { t: 0, duration: 1, text: '光', words: [{ text: '光', t: 0, d: 1 }] },
  ], { id: 'classic-short-glow-tail' });
  const frame = classicFrame(document, { now: 1.18, nextLine: null, rafDeltaMs: 16 });
  const model = buildClassicThreeModel(document.lines[0], {
    viewport: frame.viewport,
    safeArea: {},
    worldPerPixel: 0.006,
    config: {
      ...frame.config.modes.classic,
      fontFamily: 'sans-serif',
      fontWeight: 800,
      fontSize: 56,
      letterSpacing: 0,
      glowPaddingTier: 8,
      translationMode: 'auto',
    },
  });
  const baseGlow = resolveClassicThreeFrame(model, frame.now).glyphs[0].glow;
  assert.ok(baseGlow > 0 && baseGlow <= 0.16);

  const baselineHost = fakeClassicHost();
  const baselineDirector = createClassicThreeDirector({
    host: baselineHost,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  baselineDirector.mount({ root: {} });
  baselineDirector.setDocument(document);
  baselineDirector.update(frame);
  const baselineGlow = batchByRole(baselineHost, 'glow').updates.at(-1)[0].glow;

  const degradedHost = fakeClassicHost();
  let degradedPushes = 0;
  const degradedDirector = createClassicThreeDirector({
    host: degradedHost,
    createPerformanceBudget: () => ({
      ...fixedLevelBudget(1),
      push() { degradedPushes += 1; return { level: 1, fallback: false }; },
    }),
  });
  degradedDirector.mount({ root: {} });
  degradedDirector.setDocument(document);
  degradedDirector.update(frame);
  const degradedGlow = batchByRole(degradedHost, 'glow').updates.at(-1)[0].glow;

  assert.ok(baselineGlow > 0);
  assert.equal(degradedGlow, 0);
  assert.equal(degradedPushes, 1);
  baselineDirector.destroy();
  degradedDirector.destroy();
});

test('Classic Three level 1 keeps a low wordGlow peak visible while truncating its envelope tail', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([
    { t: 0, duration: 1, text: '光', words: [{ text: '光', t: 0, d: 1 }] },
  ], { id: 'classic-low-word-glow' });
  const baseConfig = classicFrame(document).config;
  const config = {
    common: { ...baseConfig.common },
    modes: { classic: { ...baseConfig.modes.classic, wordGlow: 0.1 } },
  };
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(1),
  });
  director.mount({ root: {} });
  director.setDocument(document);

  director.update(classicFrame(document, { now: 0.2, nextLine: null, rafDeltaMs: 16, config }));
  const peak = batchByRole(host, 'glow').updates.at(-1)[0];
  director.update(classicFrame(document, { now: 1.18, nextLine: null, rafDeltaMs: 16, config }));
  const tail = batchByRole(host, 'glow').updates.at(-1)[0];

  assert.equal(peak.progress, 1);
  assert.ok(peak.glow > 0);
  assert.ok(tail.progress > 0 && tail.progress <= 0.16);
  assert.equal(tail.glow, 0);
  director.destroy();
});

test('Classic Three empty frames push performance once and publish the resulting level', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  let pushes = 0;
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => ({
      ...fixedLevelBudget(2),
      push() { pushes += 1; return { level: 2, fallback: false }; },
    }),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { lineIndex: -1, line: null, nextLine: null }));
  const snapshot = director.snapshot();

  assert.equal(pushes, 1);
  assert.equal(snapshot.degradationLevel, 2);
  assert.equal(snapshot.instances, 0);
  assert.equal(snapshot.glowVariant, 'none');
  director.destroy();
});

test('Classic Three director empties only glow at level 3 or zero configured glow', () => {
  const document = classicDocument();
  const degradedHost = fakeClassicHost();
  const degradedDirector = createClassicThreeDirector({
    host: degradedHost,
    createPerformanceBudget: () => fixedLevelBudget(3),
  });
  const activeFrame = classicFrame(document, { now: 0.04 });
  degradedDirector.mount({ root: {} });
  degradedDirector.setDocument(document);
  degradedDirector.update(activeFrame);
  degradedDirector.update(activeFrame);
  const degradedBody = batchByRole(degradedHost, 'body').updates.at(-1);
  assert.ok(degradedBody.length > 0);
  assert.ok(degradedBody.some(item => item.progress > 0));
  assert.deepEqual(batchByRole(degradedHost, 'glow').updates.at(-1), []);
  degradedDirector.destroy();

  for (const configOverride of [
    { common: { glow: 0 } },
    { classic: { wordGlow: 0 } },
  ]) {
    const host = fakeClassicHost();
    const director = createClassicThreeDirector({
      host,
      createPerformanceBudget: () => fixedLevelBudget(),
    });
    const base = classicFrame(document).config;
    const frame = classicFrame(document, {
      now: 0.04,
      config: {
        common: { ...base.common, ...(configOverride.common || {}) },
        modes: { classic: { ...base.modes.classic, ...(configOverride.classic || {}) } },
      },
    });
    director.mount({ root: {} });
    director.setDocument(document);
    director.update(frame);
    assert.ok(batchByRole(host, 'body').updates.at(-1).length > 0);
    assert.deepEqual(batchByRole(host, 'glow').updates.at(-1), []);
    director.destroy();
  }
});

test('Classic Three director injects style-aware typography into layout, atlas and translation', () => {
  const host = fakeClassicHost();
  const typography = {
    fontFamily: '"Noto Serif SC", SimSun, serif',
    fontWeight: 850,
    letterSpacing: 0.04,
    key: 'song|serif|850|0.04',
  };
  const measureCalls = [];
  const measureText = (text, receivedTypography, fontSize) => {
    measureCalls.push({ text, typography: receivedTypography, fontSize });
    return Array.from(text).length * 31;
  };
  const document = buildNativeLyricDocument([
    { t: 0, duration: 2, text: 'AB', translation: 'Serif translation' },
  ], { id: 'classic-typography' });
  const director = createClassicThreeDirector({
    host,
    getTypography: () => typography,
    measureText,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const frame = classicFrame(document, { now: 0.3, nextLine: null });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);

  assert.ok(measureCalls.length >= document.lines[0].graphemes.length);
  assert.equal(measureCalls.every(call => call.fontSize === 56), true);
  assert.equal(measureCalls.every(call => (
    call.typography.fontFamily === typography.fontFamily
      && call.typography.fontWeight === typography.fontWeight
      && call.typography.letterSpacing === typography.letterSpacing
      && call.typography.key === typography.key
  )), true);
  assert.equal(host.atlasAcquires.every(acquire => acquire.style.fontFamily === typography.fontFamily), true);
  assert.equal(host.atlasAcquires.every(acquire => acquire.style.weight === 850), true);
  assert.equal(host.atlasAcquires.every(acquire => acquire.style.size === 56), true);

  const expectedModel = buildClassicThreeModel(document.lines[0], {
    viewport: frame.viewport,
    safeArea: {},
    worldPerPixel: 0.006,
    config: {
      ...frame.config.modes.classic,
      fontFamily: typography.fontFamily,
      fontWeight: typography.fontWeight,
      fontSize: 56,
      letterSpacing: typography.letterSpacing * 56,
      glowPaddingTier: 8,
      translationMode: 'auto',
      measureText: text => Array.from(text).length * 31,
    },
  });
  const expected = resolveClassicThreeFrame(expectedModel, frame.now);
  const body = batchByRole(host, 'body').updates.at(-1);
  assert.deepEqual(body.map(item => [item.matrix[12], item.matrix[13]]), expected.glyphs.map(glyph => [glyph.x, glyph.y]));

  const translation = host.blocks.find(block => block.role === 'translation').contents.at(-1);
  const translationFont = translation.context.fillTextCalls[0].font;
  const translationWeight = Number.parseInt(translationFont, 10);
  assert.ok(translationWeight >= 450 && translationWeight <= 700);
  assert.match(translationFont, /"Noto Serif SC", SimSun, serif$/);
  assert.match(translation.key, /song\|serif\|850\|0\.04/);
  director.destroy();

  const defaultHost = fakeClassicHost();
  const defaultDirector = createClassicThreeDirector({
    host: defaultHost,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  defaultDirector.mount({ root: {} });
  defaultDirector.setDocument(document);
  defaultDirector.update(frame);
  assert.equal(defaultHost.atlasAcquires.every(acquire => acquire.style.fontFamily === 'sans-serif'), true);
  defaultDirector.destroy();
});

test('Classic Three director preserves negative typography spacing through measurement, environment and model', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([
    { t: 0, duration: 2, text: 'AB', translation: 'Negative tracking' },
  ], { id: 'classic-negative-spacing' });
  let typography = {
    fontFamily: 'Georgia, serif',
    fontWeight: 650,
    letterSpacing: 0,
    key: 'same-typography-key',
  };
  const measureCalls = [];
  const director = createClassicThreeDirector({
    host,
    getTypography: () => typography,
    measureText(text, receivedTypography, fontSize) {
      measureCalls.push({ text, typography: receivedTypography, fontSize });
      return Array.from(text).length * 31;
    },
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const frame = classicFrame(document, { now: 0.3, nextLine: null, rafDeltaMs: 0 });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);
  const zeroEnvironmentKey = host.blocks.find(block => block.role === 'translation').contents.at(-1).key;
  const zeroSpacingLeases = host.leases.slice();

  typography = { ...typography, letterSpacing: -0.04 };
  measureCalls.length = 0;
  director.update(frame);

  const negativeEnvironmentKey = host.blocks.find(block => block.role === 'translation').contents.at(-1).key;
  assert.ok(measureCalls.length >= document.lines[0].graphemes.length);
  assert.equal(measureCalls.every(call => call.fontSize === 56 && call.typography.letterSpacing === -0.04), true);
  assert.equal(zeroSpacingLeases.every(lease => lease.releases === 1), true);
  assert.notEqual(negativeEnvironmentKey, zeroEnvironmentKey);
  assert.match(negativeEnvironmentKey, /-0\.04/);

  const expectedModel = buildClassicThreeModel(document.lines[0], {
    viewport: frame.viewport,
    safeArea: {},
    worldPerPixel: 0.006,
    config: {
      ...frame.config.modes.classic,
      fontFamily: typography.fontFamily,
      fontWeight: typography.fontWeight,
      fontSize: 56,
      letterSpacing: typography.letterSpacing * 56,
      glowPaddingTier: 8,
      translationMode: 'auto',
      measureText: text => Array.from(text).length * 31,
    },
  });
  assert.equal(expectedModel.config.letterSpacing, -0.04 * 56);
  const expected = resolveClassicThreeFrame(expectedModel, frame.now);
  const body = batchByRole(host, 'body').updates.at(-1);
  assert.deepEqual(body.map(item => [item.matrix[12], item.matrix[13]]), expected.glyphs.map(glyph => [glyph.x, glyph.y]));
  director.destroy();
});

test('Classic Three director forwards common scale into the layout environment', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([{
    t: 0,
    duration: 3,
    text: '流光穿过很长很长的夜色直到城市另一端',
    translation: 'The streaming light crosses the city to the other side.',
  }], { id: 'classic-stage-scale-song' });
  const director = createClassicThreeDirector({
    host,
    getSafeArea: () => ({ left: 64, right: 300, top: 52, bottom: 96, shelfOpen: true }),
    measureText: text => Array.from(text).length * 42,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const frame = classicFrame(document, { line: document.lines[0], nextLine: null, now: 1 });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);
  const baseBody = batchByRole(host, 'body').updates.at(-1);
  const xSpan = body => {
    const positions = body.map(item => item.matrix[12]);
    return Math.max(...positions) - Math.min(...positions);
  };
  const baseSpan = xSpan(baseBody);
  const firstLeaseCount = host.leases.length;

  director.update({
    ...frame,
    config: {
      ...frame.config,
      common: { ...frame.config.common, scale: 1.8 },
    },
  });
  const scaledSpan = xSpan(batchByRole(host, 'body').updates.at(-1));

  assert.ok(scaledSpan < baseSpan * 0.75, `${scaledSpan} should be tighter than ${baseSpan}`);
  assert.equal(host.leases.slice(0, firstLeaseCount).every(lease => lease.releases === 1), true);
  director.destroy();
});

test('Classic Three director releases the old layout before typography or style acquisition', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  let typography = {
    fontFamily: 'Georgia, serif',
    fontWeight: 600,
    letterSpacing: 0.01,
    key: 'layout-a',
  };
  const director = createClassicThreeDirector({
    host,
    getTypography: () => typography,
    measureText: text => Array.from(text).length * 33,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  const frame = classicFrame(document);
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);

  function assertReleasedBeforeAcquire(oldLeases, update) {
    const eventStart = host.atlasEvents.length;
    update();
    const events = host.atlasEvents.slice(eventStart);
    const firstAcquire = events.findIndex(event => event.type === 'acquire');
    assert.ok(firstAcquire >= 0);
    assert.equal(events.slice(0, firstAcquire).filter(event => event.type === 'release').length, oldLeases.length);
    assert.equal(oldLeases.every(lease => lease.releases === 1), true);
  }

  const typographyLeases = host.leases.slice();
  typography = { ...typography, fontWeight: 850, key: 'layout-b' };
  assertReleasedBeforeAcquire(typographyLeases, () => director.update(frame));
  assert.equal(host.atlasAcquires.at(-1).style.weight, 850);

  const styleLeases = host.leases.filter(lease => lease.releases === 0);
  assertReleasedBeforeAcquire(styleLeases, () => director.update(classicFrame(document, { quality: 'quality' })));
  assert.equal(host.atlasAcquires.at(-1).style.glowPadding, 10);
  director.destroy();
});

test('Classic Three director releases old layout leases before trim and acquires afterward', () => {
  const host = fakeClassicHost();
  const document = buildNativeLyricDocument([
    { t: 0, duration: 1, text: '光' },
  ], { id: 'classic-trim-order' });
  let pushes = 0;
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => ({
      ...fixedLevelBudget(),
      push() {
        pushes += 1;
        return { level: pushes === 1 ? 0 : 1, fallback: false };
      },
    }),
  });
  const frame = classicFrame(document, { now: 0.2, nextLine: null, rafDeltaMs: 16 });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(frame);
  const oldLeases = host.leases.slice();
  const eventStart = host.calls.length;

  director.update(frame);

  const events = host.calls.slice(eventStart);
  const releaseIndices = events.map((event, index) => event.startsWith('atlas:release:') ? index : -1).filter(index => index >= 0);
  const acquireIndices = events.map((event, index) => event.startsWith('atlas:acquire:') ? index : -1).filter(index => index >= 0);
  const trimIndex = events.indexOf('trim:1');
  assert.equal(pushes, 2);
  assert.equal(releaseIndices.length, oldLeases.length);
  assert.ok(trimIndex >= 0);
  assert.equal(releaseIndices.every(index => index < trimIndex), true);
  assert.equal(acquireIndices.every(index => index > trimIndex), true);
  assert.equal(oldLeases.every(lease => lease.releases === 1), true);
  director.destroy();
});

test('Classic Three director advances ambient breathing from RAF delta without moving glyph matrices', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  const director = createClassicThreeDirector({
    host,
    getParallax: () => ({ x: 0, y: 0, rotationX: 0, rotationY: 0 }),
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { now: 0.6, rafDeltaMs: 0 }));
  const firstMatrices = batchByRole(host, 'body').updates.at(-1).map(item => item.matrix.slice());
  const firstParent = {
    position: host.scopes[0].group.position.values.slice(),
    scale: host.scopes[0].group.scale.values.slice(),
  };

  director.update(classicFrame(document, { now: 0.6, rafDeltaMs: 500 }));
  const secondMatrices = batchByRole(host, 'body').updates.at(-1).map(item => item.matrix.slice());
  const secondParent = {
    position: host.scopes[0].group.position.values.slice(),
    scale: host.scopes[0].group.scale.values.slice(),
  };

  assert.deepEqual(secondMatrices, firstMatrices);
  assert.notDeepEqual(secondParent, firstParent);
  director.destroy();
});

test('Classic Three director bounds parallax and disables it for constrained frames', () => {
  const document = classicDocument();
  const limit = 4 * Math.PI / 180;
  const host = fakeClassicHost();
  const director = createClassicThreeDirector({
    host,
    getParallax: () => ({ x: 2, y: -2, rotationX: 1, rotationY: -1 }),
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { rafDeltaMs: 0 }));
  assert.deepEqual(host.scopes[0].group.position.values.slice(0, 2), [0.03, -0.03]);
  assert.equal(host.scopes[0].group.rotation.x, limit);
  assert.equal(host.scopes[0].group.rotation.y, -limit);
  director.destroy();

  for (const [label, directorOptions, frameOverrides] of [
    ['reduced motion', {}, { reducedMotion: true }],
    ['battery quality', {}, { quality: 'battery' }],
    ['battery performance mode', {}, {
      config: {
        ...classicFrame(document).config,
        common: { ...classicFrame(document).config.common, performanceMode: 'battery' },
      },
    }],
    ['open shelf', { getSafeArea: () => ({ shelfOpen: true }) }, {}],
  ]) {
    const constrainedHost = fakeClassicHost();
    const constrained = createClassicThreeDirector({
      host: constrainedHost,
      getParallax: () => ({ x: 0.02, y: -0.01, rotationX: 0.008, rotationY: -0.01 }),
      createPerformanceBudget: () => fixedLevelBudget(),
      ...directorOptions,
    });
    constrained.mount({ root: {} });
    constrained.setDocument(document);
    constrained.update(classicFrame(document, { rafDeltaMs: 0, ...frameOverrides }));
    assert.equal(constrainedHost.scopes[0].group.position.values[0], 0, label);
    assert.equal(constrainedHost.scopes[0].group.position.values[1], 0, label);
    assert.equal(constrainedHost.scopes[0].group.rotation.x, 0, label);
    assert.equal(constrainedHost.scopes[0].group.rotation.y, 0, label);
    constrained.destroy();
  }

  const degradedHost = fakeClassicHost();
  const degraded = createClassicThreeDirector({
    host: degradedHost,
    getParallax: () => ({ x: 0.02, y: -0.01, rotationX: 0.008, rotationY: -0.01 }),
    createPerformanceBudget: () => fixedLevelBudget(2),
  });
  degraded.mount({ root: {} });
  degraded.setDocument(document);
  const degradedFrame = classicFrame(document, { rafDeltaMs: 0 });
  degraded.update(degradedFrame);
  degraded.update(degradedFrame);
  assert.equal(degradedHost.scopes[0].group.position.values[0], 0);
  assert.equal(degradedHost.scopes[0].group.position.values[1], 0);
  assert.equal(degradedHost.scopes[0].group.rotation.x, 0);
  assert.equal(degradedHost.scopes[0].group.rotation.y, 0);
  degraded.destroy();
});

function transitionLine(index, text, startTime, options = {}) {
  const endTime = startTime + 0.8;
  return {
    id: `transition-line-${index}`,
    key: `transition-line-${index}`,
    index,
    startTime,
    endTime,
    fullText: text,
    translation: '',
    words: [{ text, startTime, endTime }],
    graphemes: [{ char: text, startTime, endTime }],
    renderHints: {
      timingClass: 'normal',
      renderEndTime: endTime + 0.4,
      wordRevealMode: options.wordRevealMode || 'normal',
      lineTransitionMode: options.lineTransitionMode || 'normal',
    },
  };
}

function transitionDocument(outgoingMode = 'normal') {
  return {
    fingerprint: `transition-${outgoingMode}`,
    lines: [
      transitionLine(0, '甲', 0, { lineTransitionMode: outgoingMode }),
      transitionLine(1, '乙', 1, { wordRevealMode: 'instant', lineTransitionMode: 'fast' }),
      transitionLine(2, '丙', 2, { lineTransitionMode: 'none' }),
    ],
  };
}

function transitionFrame(document, lineIndex, overrides = {}) {
  return classicFrame(document, {
    lineIndex,
    line: document.lines[lineIndex],
    nextLine: document.lines[lineIndex + 1] || null,
    now: document.lines[lineIndex].startTime + 0.2,
    rafDeltaMs: 0,
    ...overrides,
  });
}

test('Classic Three director treats duplicate line ids as distinct when content identity changes', () => {
  const first = transitionLine(0, '甲', 0, { lineTransitionMode: 'normal' });
  const second = transitionLine(1, '乙', 1, { lineTransitionMode: 'fast' });
  first.id = second.id = 'duplicate-line-id';
  first.key = second.key = 'duplicate-line-key';
  const document = { fingerprint: 'duplicate-line-identity', lines: [first, second] };
  const host = fakeClassicHost();
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(transitionFrame(document, 0));

  const eventStart = host.calls.length;
  director.update(transitionFrame(document, 1));
  const replacementEvents = host.calls.slice(eventStart);

  assert.equal(host.transitions.length, 1);
  assert.equal(host.transitions[0].purpose, 'line');
  assert.ok(replacementEvents.indexOf('capture:line') < replacementEvents.indexOf('batch:update:body'));
  director.destroy();
});

for (const [mode, durationMs] of [
  ['normal', 300],
  ['fast', 160],
  ['none', 120],
]) {
  test(`Classic Three director runs outgoing ${mode} line exit for ${durationMs}ms`, () => {
    const host = fakeClassicHost();
    const document = transitionDocument(mode);
    const director = createClassicThreeDirector({
      host,
      createPerformanceBudget: () => fixedLevelBudget(),
    });
    director.mount({ root: {} });
    director.setDocument(document);
    director.update(transitionFrame(document, 0));

    const eventStart = host.calls.length;
    director.update(transitionFrame(document, 1));
    const replacementEvents = host.calls.slice(eventStart);
    assert.equal(host.transitions.length, 1);
    const transition = host.transitions[0];
    assert.equal(transition.purpose, 'line');
    assert.deepEqual(transition.visualUpdates[0], { opacity: 1, scale: 1, blurPx: 0 });
    assert.ok(replacementEvents.indexOf('capture:line') < replacementEvents.indexOf('batch:update:body'));
    assert.ok(replacementEvents.indexOf('capture:line') < replacementEvents.indexOf('batch:update:glow'));

    director.update(transitionFrame(document, 1, { rafDeltaMs: durationMs - 1 }));
    assert.equal(transition.releases, 0);
    director.update(transitionFrame(document, 1, { rafDeltaMs: 1 }));
    assert.equal(transition.releases, 1);
    assert.equal(transition.visualUpdates.at(-1).opacity, 0);
    director.destroy();
  });
}

test('Classic Three line exit keeps outgoing mode independent from instant incoming groups', () => {
  const host = fakeClassicHost();
  const document = transitionDocument('normal');
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(transitionFrame(document, 0));
  const incomingNow = document.lines[1].startTime + 0.09;
  director.update(transitionFrame(document, 1, { now: incomingNow }));

  const transition = host.transitions[0];
  const body = batchByRole(host, 'body').updates.at(-1);
  const entry = host.leases.find(lease => lease.char === '乙' && lease.releases === 0).entry;
  const expectedModel = buildClassicThreeModel(document.lines[1], {
    viewport: { width: 960, height: 540, dpr: 1 },
    safeArea: {},
    worldPerPixel: 0.006,
    config: {
      ...classicFrame(document).config.modes.classic,
      fontFamily: 'sans-serif',
      fontWeight: 800,
      fontSize: 56,
      letterSpacing: 0,
      glowPaddingTier: 8,
      translationMode: 'auto',
    },
  });
  const expectedGlyph = resolveClassicThreeFrame(expectedModel, incomingNow).glyphs[0];
  const renderedWidth = Math.hypot(body[0].matrix[0], body[0].matrix[1], body[0].matrix[2]);
  const expectedWidth = expectedGlyph.width * expectedGlyph.scale * entry.sampleWidth / entry.width;
  assert.equal(expectedModel.renderProfile.wordRevealMode, 'instant');
  assert.equal(expectedModel.groups[0].activePose.scale, expectedGlyph.scale);
  assert.ok(Math.abs(renderedWidth - expectedWidth) < 1e-10);

  director.update(transitionFrame(document, 1, { now: incomingNow, rafDeltaMs: 120 }));
  assert.equal(transition.releases, 0);
  assert.ok(transition.visualUpdates.at(-1).opacity > 0);
  director.destroy();
});

test('Classic Three director replaces and clears managed line transitions idempotently', () => {
  const host = fakeClassicHost();
  const document = transitionDocument('normal');
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(transitionFrame(document, 0));
  director.update(transitionFrame(document, 1));
  const first = host.transitions[0];

  const eventStart = host.calls.length;
  director.update(transitionFrame(document, 2));
  const replacementEvents = host.calls.slice(eventStart);
  const second = host.transitions[1];
  assert.equal(first.releases, 1);
  assert.ok(replacementEvents.indexOf('transition:release:line') < replacementEvents.indexOf('capture:line'));
  assert.equal(second.releases, 0);

  director.setDocument(document);
  assert.equal(second.releases, 1);
  const transitionCount = host.transitions.length;
  director.update(transitionFrame(document, 1));
  assert.equal(host.transitions.length, transitionCount);
  director.update(transitionFrame(document, 2));
  const releaseTransition = host.transitions.at(-1);
  director.release();
  director.release();
  assert.equal(releaseTransition.releases, 1);
  director.destroy();

  const destroyHost = fakeClassicHost();
  const destroyDirector = createClassicThreeDirector({
    host: destroyHost,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  destroyDirector.mount({ root: {} });
  destroyDirector.setDocument(document);
  destroyDirector.update(transitionFrame(document, 0));
  destroyDirector.update(transitionFrame(document, 1));
  const destroyTransition = destroyHost.transitions[0];
  destroyDirector.destroy();
  destroyDirector.destroy();
  assert.equal(destroyTransition.releases, 1);
});

test('Classic Three keeps translation billboarded and owns one bounded spark field in the word layer', () => {
  const THREE = createFakeThree();
  const host = fakeClassicHost();
  const document = classicDocument();
  const parallax = { x: 0.02, y: -0.01, rotationX: 0.04, rotationY: -0.05 };
  const director = createClassicThreeDirector({
    THREE,
    host,
    getParallax: () => parallax,
    createPerformanceBudget: () => fixedLevelBudget(),
  });

  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { now: 0.6, rafDeltaMs: 0 }));

  const root = host.scopes[0].group;
  const wordLayer = root.children.find(node => node.name === 'ClassicThreeWordEffects');
  assert.ok(wordLayer);
  assert.deepEqual([root.rotation.x, root.rotation.y], [0, 0]);
  assert.deepEqual([wordLayer.position.x, wordLayer.position.y], [parallax.x, parallax.y]);
  assert.deepEqual([wordLayer.rotation.x, wordLayer.rotation.y], [parallax.rotationX, parallax.rotationY]);

  const translation = host.blocks.find(block => block.role === 'translation').getMesh();
  assert.strictEqual(translation.parent, root);
  assert.deepEqual([translation.rotation.x, translation.rotation.y], [0, 0]);

  const spark = wordLayer.children.find(node => node.name === 'ClassicThreeSparkField');
  assert.ok(spark);
  assert.equal(spark.visible, true);
  assert.equal(spark.geometry.drawRange.count, 32);
  assert.equal(director.snapshot().sparkPoints, 32);
  assert.equal(director.snapshot().sparkDrawBatches, 1);

  const geometry = spark.geometry;
  const material = spark.material;
  director.release();
  director.release();
  assert.equal(geometry.disposeCount, 1);
  assert.equal(material.disposeCount, 1);
  assert.equal(director.snapshot().sparkPoints, 0);

  assert.equal(director.resume(), true);
  const resumedRoot = host.scopes[1].group;
  const resumedWordLayer = resumedRoot.children.find(node => node.name === 'ClassicThreeWordEffects');
  assert.ok(resumedWordLayer.children.some(node => node.name === 'ClassicThreeSparkField'));
  director.destroy();
});

test('Classic Three director exposes bounded two-batch and semantic-group diagnostics', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  const typography = {
    fontFamily: 'Georgia, serif',
    fontWeight: 650,
    letterSpacing: 0.02,
    key: 'diagnostic-serif',
  };
  const budget = {
    push() { return { level: 0, fallback: false }; },
    suspend() {},
    resetTrack() {},
    snapshot() { return { level: 0, fallback: false, p95FrameMs: 12.5, budgetMarker: 'preserved' }; },
  };
  const director = createClassicThreeDirector({
    host,
    getTypography: () => typography,
    getParallax: () => ({ x: 0.02, y: -0.01, rotationX: 0.008, rotationY: -0.01 }),
    createPerformanceBudget: () => budget,
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { now: 0.04, rafDeltaMs: 0 }));

  const snapshot = director.snapshot();
  const groupSnapshot = host.scopes[0].group.userData.nativeLyricSnapshot;
  assert.equal(snapshot.instances, snapshot.bodyInstances + snapshot.glowInstances);
  assert.equal(snapshot.glyphInstances, snapshot.instances);
  assert.equal(snapshot.drawBatches, snapshot.bodyDrawBatches + snapshot.glowDrawBatches);
  assert.equal(snapshot.bodyInstances, batchByRole(host, 'body').updates.at(-1).length);
  assert.equal(snapshot.glowInstances, batchByRole(host, 'glow').updates.at(-1).length);
  assert.equal(snapshot.groupCount, snapshot.groupStates.length);
  assert.ok(snapshot.groupCount > 0);
  assert.equal(snapshot.groupStates.every(state => (
    Object.keys(state).sort().join('|') === 'key|phase' && !('text' in state) && !('fullText' in state)
  )), true);
  assert.deepEqual(
    snapshot.activeGroupKeys,
    snapshot.groupStates.filter(state => state.phase === 'entering' || state.phase === 'active').map(state => state.key),
  );
  assert.equal(snapshot.fontFamily, typography.fontFamily);
  assert.equal(snapshot.fontWeight, typography.fontWeight);
  assert.equal(snapshot.glowVariant, 'glow-5');
  assert.deepEqual(snapshot.parallax, { x: 0.02, y: -0.01, rotationX: 0.008, rotationY: -0.01 });
  assert.equal(snapshot.lineTransitionActive, false);
  assert.equal(snapshot.cachedLines, 2);
  assert.equal(snapshot.degradationLevel, 0);
  assert.equal(snapshot.p95FrameMs, 12.5);
  assert.equal(snapshot.budgetMarker, 'preserved');
  for (const key of [
    'instances', 'drawBatches', 'bodyInstances', 'glowInstances', 'bodyDrawBatches', 'glowDrawBatches',
    'groupCount', 'groupStates', 'activeGroupKeys', 'fontFamily', 'fontWeight', 'glowVariant', 'parallax',
    'lineTransitionActive', 'cachedLines', 'degradationLevel',
  ]) assert.deepEqual(groupSnapshot[key], snapshot[key], key);
  director.destroy();
});

test('Classic Three diagnostics track managed line transition activity', () => {
  const host = fakeClassicHost();
  const document = transitionDocument('normal');
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(transitionFrame(document, 0));
  director.update(transitionFrame(document, 1));
  assert.equal(director.snapshot().lineTransitionActive, true);
  assert.equal(host.scopes[0].group.userData.nativeLyricSnapshot.lineTransitionActive, true);
  director.update(transitionFrame(document, 1, { rafDeltaMs: 300 }));
  assert.equal(director.snapshot().lineTransitionActive, false);
  assert.equal(host.scopes[0].group.userData.nativeLyricSnapshot.lineTransitionActive, false);
  director.destroy();
});

test('Classic Three director clears both batches and publishes finite empty diagnostics without a line', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document));
  director.update(classicFrame(document, { lineIndex: -1, line: null, nextLine: null }));

  const snapshot = director.snapshot();
  const groupSnapshot = host.scopes[0].group.userData.nativeLyricSnapshot;
  assert.deepEqual(batchByRole(host, 'body').updates.at(-1), []);
  assert.deepEqual(batchByRole(host, 'glow').updates.at(-1), []);
  assert.equal(snapshot.instances, 0);
  assert.equal(snapshot.glyphInstances, 0);
  assert.equal(snapshot.drawBatches, 0);
  assert.equal(snapshot.bodyInstances, 0);
  assert.equal(snapshot.glowInstances, 0);
  assert.equal(snapshot.bodyDrawBatches, 0);
  assert.equal(snapshot.glowDrawBatches, 0);
  assert.equal(snapshot.groupCount, 0);
  assert.deepEqual(snapshot.groupStates, []);
  assert.deepEqual(snapshot.activeGroupKeys, []);
  assert.equal(snapshot.lineTransitionActive, false);
  assert.equal([
    snapshot.instances,
    snapshot.drawBatches,
    snapshot.bodyInstances,
    snapshot.glowInstances,
    snapshot.bodyDrawBatches,
    snapshot.glowDrawBatches,
    snapshot.groupCount,
    snapshot.cachedLines,
    snapshot.degradationLevel,
    snapshot.parallax.x,
    snapshot.parallax.y,
    snapshot.parallax.rotationX,
    snapshot.parallax.rotationY,
  ].every(Number.isFinite), true);
  assert.equal(groupSnapshot.instances, 0);
  assert.equal(groupSnapshot.glowInstances, 0);
  director.destroy();
});

test('Classic Three director keeps at most three cached lines within one layout environment', () => {
  const host = fakeClassicHost();
  const document = {
    fingerprint: 'classic-cache-lru',
    lines: Array.from({ length: 5 }, (_, index) => transitionLine(index, String(index), index)),
  };
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => fixedLevelBudget(),
  });
  director.mount({ root: {} });
  director.setDocument(document);
  document.lines.forEach((line, index) => {
    director.update(classicFrame(document, {
      lineIndex: index,
      line,
      nextLine: null,
      now: line.startTime + 0.2,
      rafDeltaMs: 0,
    }));
  });

  assert.equal(director.snapshot().cachedLines, 3);
  assert.equal(host.leases.length, 5);
  assert.equal(host.leases.slice(0, 2).every(lease => lease.releases === 1), true);
  assert.equal(host.leases.slice(2).every(lease => lease.releases === 0), true);
  director.destroy();
});

test('Classic Three director preheats adjacent lines and rebuilds a fresh scope after release', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  const budgetPushes = [];
  const budget = {
    push(input) { budgetPushes.push(input); return { level: 0, fallback: false, p95FrameMs: 0 }; },
    suspend() {},
    resetTrack() {},
    snapshot() { return { level: 0, fallback: false }; },
  };
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => budget,
  });

  director.mount({ root: {} });
  director.setDocument(document);
  director.update(classicFrame(document, { now: 0.2 }));
  director.update(classicFrame(document, { now: 0.8 }));
  director.resize({ width: 1366, height: 768, dpr: 1 });
  const transition = director.captureTransition();
  const firstLeaseCount = host.leases.length;
  director.release();

  assert.equal(host.scopes.length, 1);
  assert.equal(host.batches.length, 2);
  assert.equal(host.batches.every(batch => batch.updates.length === 2), true);
  assert.equal(host.blocks.find(block => block.role === 'translation').contents.length > 0, true);
  assert.equal(host.blocks.find(block => block.role === 'ripple').visibility.includes(true), true);
  assert.equal(firstLeaseCount >= document.lines[0].graphemes.length + document.lines[1].graphemes.length, true);
  assert.equal(host.leases.slice(0, firstLeaseCount).every(lease => lease.releases === 1), true);
  assert.equal(host.batches.every(batch => batch.releases === 1), true);
  assert.equal(host.blocks.every(block => block.releases === 1), true);
  assert.equal(budgetPushes.every(push => push.frameMs === 16.7), true);
  assert.equal(transition.kind, 'managed-three-transition');
  assert.equal(transition.purpose, 'mode-switch');

  director.resume();
  director.setDocument(document);
  director.update(classicFrame(document));
  director.destroy();
  director.destroy();

  assert.equal(host.scopes.length, 2);
  assert.equal(host.scopes.every(scope => scope.releases === 1), true);
  assert.equal(host.batches.length, 4);
  assert.equal(host.batches.every(batch => batch.releases === 1), true);
  assert.equal(host.blocks.length, 4);
  assert.equal(host.blocks.every(block => block.releases === 1), true);
  assert.equal(host.leases.every(lease => lease.releases === 1), true);
  assert.equal(host.calls.filter(call => call === 'context:subscribe').length, 2);
  assert.equal(host.calls.filter(call => call === 'context:unsubscribe').length, 2);
});

test('Classic Three director unsubscribes context when mount fails after subscription', () => {
  const host = fakeClassicHost();
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => ({
      ...fixedLevelBudget(),
      suspend() { throw new Error('budget suspend failed'); },
    }),
  });

  assert.throws(() => director.mount({ root: {} }), /budget suspend failed/);
  assert.equal(host.calls.filter(call => call === 'context:subscribe').length, 1);
  assert.equal(host.calls.filter(call => call === 'context:unsubscribe').length, 1);
  assert.equal(host.scopes[0].releases, 1);

  director.destroy();
  assert.equal(host.calls.filter(call => call === 'context:unsubscribe').length, 1);
  assert.equal(host.scopes[0].releases, 1);
});

test('Classic Three director requests same-mode fallback on context loss', () => {
  const host = fakeClassicHost();
  const fallbacks = [];
  const director = createClassicThreeDirector({ host, requestFallback: error => fallbacks.push(error) });
  director.mount({ root: {} });

  host.emitContext('lost');

  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].code, 'THREE_LYRIC_CONTEXT_LOST');
  director.destroy();
});

test('Classic Three director feeds explicit RAF delta to the budget and throws typed fallback', () => {
  const host = fakeClassicHost();
  const document = classicDocument();
  const pushes = [];
  const director = createClassicThreeDirector({
    host,
    createPerformanceBudget: () => ({
      push(input) {
        pushes.push(input);
        return { level: 3, fallback: true, reason: 'sustained-frame-budget' };
      },
      suspend() {},
      resetTrack() {},
      snapshot() { return { level: 3, fallback: true }; },
    }),
  });
  director.mount({ root: {} });
  director.setDocument(document);

  assert.throws(
    () => director.update(classicFrame(document, { now: 999, rafDeltaMs: 41 })),
    error => error.code === 'THREE_LYRIC_PERFORMANCE_FALLBACK',
  );
  assert.equal(pushes[0].frameMs, 41);
  assert.notEqual(pushes[0].now, 999);
  director.destroy();
});
