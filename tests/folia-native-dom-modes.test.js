const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNativeLyricDocument } = require('../public/folia-native/state');
const {
  buildClassicLineModel,
  resolveClassicLineFrame,
  buildPartitaLineModel,
  buildTiltLineModel,
  resolveTiltCharacterFrame,
} = require('../public/folia-native/dom-state');

function line(raw) {
  return buildNativeLyricDocument([raw], { id: 'dom-song' }).lines[0];
}

test('Classic layout is deterministic and resolves waiting active passed word states', () => {
  const source = line({
    t: 1,
    duration: 3,
    text: '流光 穿过 夜色',
    isChorus: true,
    words: [
      { text: '流光', t: 1, d: 1 },
      { text: '穿过', t: 2, d: 1 },
      { text: '夜色', t: 3, d: 1 },
    ],
  });
  const first = buildClassicLineModel(source, { width: 1366, height: 768 }, { spread: 0.7 });
  const second = buildClassicLineModel(source, { width: 1366, height: 768 }, { spread: 0.7 });
  const frame = resolveClassicLineFrame(first, 2.4);

  assert.deepEqual(first, second);
  assert.equal(first.isChorus, true);
  assert.deepEqual(frame.items.map(item => item.status), ['passed', 'active', 'waiting']);
  assert.equal(frame.items[1].graphemes.some(grapheme => grapheme.status === 'active'), true);
  assert.equal(first.items.every(item => Number.isFinite(item.x) && Number.isFinite(item.rotate)), true);
});

test('Classic micro lines use instant reveal without zero-duration values', () => {
  const source = line({ t: 5, duration: 0.05, text: '啊' });
  const model = buildClassicLineModel(source, { width: 960, height: 540 }, {});
  const frame = resolveClassicLineFrame(model, 5.02);
  assert.equal(model.renderHints.wordRevealMode, 'instant');
  assert.equal(frame.items[0].status, 'active');
  assert.equal(frame.items[0].endTime > frame.items[0].startTime, true);
});

test('Classic mirrors Folia adaptive layout and intensity tuning deterministically', () => {
  const source = line({
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
  const config = {
    intensity: 'chaotic',
    spread: 1,
    enableWordRotation: true,
    useLegacyLayout: false,
    wordSpacing: 0.7,
    wordGlow: 0.6,
    breathing: 1.2,
    chorusRipple: false,
    measureText: text => Array.from(text).length * 42,
    fontSize: 72,
  };
  const first = buildClassicLineModel(source, { width: 1366, height: 768 }, config);
  const second = buildClassicLineModel(source, { width: 1366, height: 768 }, config);
  const calm = buildClassicLineModel(source, { width: 1366, height: 768 }, {
    ...config,
    intensity: 'calm',
  });

  assert.deepEqual(first, second);
  assert.equal(first.lineLayout.intensity, 'chaotic');
  assert.match(first.lineLayout.justifyContent, /^flex-(?:start|end)$|^(?:center|space-around|space-between)$/);
  assert.match(first.lineLayout.alignItems, /^flex-(?:start|end)$|^center$/);
  assert.equal(first.items.every(item => /^\d+(?:\.\d+)?px$/.test(item.marginRight)), true);
  assert.equal(first.items.every(item => Number.isFinite(item.passedRotate)), true);
  assert.equal(first.items.some(item => Math.abs(item.x) > 1 || Math.abs(item.y) > 1), true);
  assert.equal(first.wordGlow, 0.6);
  assert.equal(first.chorusRipple, false);
  assert.equal(calm.items.every(item => item.x === 0 && item.y === 0 && item.rotate === 0), true);
});

test('Classic honors render-end timing and keeps a bounded grapheme glow tail', () => {
  const instantLine = {
    index: 0,
    startTime: 5,
    endTime: 5.05,
    fullText: '啊',
    words: [{ text: '啊', startTime: 5, endTime: 5.05 }],
    graphemes: [{ char: '啊', startTime: 5, endTime: 5.05 }],
    renderHints: { wordRevealMode: 'instant', lineTransitionMode: 'none', renderEndTime: 5.4 },
  };
  const instantModel = buildClassicLineModel(instantLine, { width: 960, height: 540 }, { wordGlow: 1 });
  const heldFrame = resolveClassicLineFrame(instantModel, 5.3);

  assert.equal(instantModel.renderProfile.lineTransitionMode, 'none');
  assert.equal(instantModel.renderProfile.lineRenderEndTime, 5.4);
  assert.equal(heldFrame.items[0].status, 'active');

  const normalLine = {
    index: 1,
    startTime: 1,
    endTime: 1.2,
    fullText: '光',
    words: [{ text: '光', startTime: 1, endTime: 1.2 }],
    graphemes: [{ char: '光', startTime: 1, endTime: 1.2 }],
    renderHints: { wordRevealMode: 'normal', lineTransitionMode: 'normal', renderEndTime: 1.5 },
  };
  const glowingModel = buildClassicLineModel(normalLine, { width: 960, height: 540 }, { wordGlow: 0.8 });
  const tailFrame = resolveClassicLineFrame(glowingModel, 1.55);
  const disabledFrame = resolveClassicLineFrame(
    buildClassicLineModel(normalLine, { width: 960, height: 540 }, { wordGlow: 0 }),
    1.55,
  );

  assert.equal(tailFrame.items[0].graphemes[0].status, 'passed');
  assert.ok(tailFrame.items[0].graphemes[0].glow > 0);
  assert.ok(tailFrame.items[0].graphemes[0].glow <= 0.8);
  assert.equal(disabledFrame.items[0].graphemes[0].glow, 0);
});

test('Partita builds deterministic semantic chunks in staggered bounded columns', () => {
  const source = line({ t: 0, duration: 5, text: '今夜，we stay together；直到天亮。' });
  const first = buildPartitaLineModel(source, { width: 1366, height: 768 }, { columns: 3, stagger: 0.6 });
  const second = buildPartitaLineModel(source, { width: 1366, height: 768 }, { columns: 3, stagger: 0.6 });

  assert.deepEqual(first, second);
  assert.equal(first.columns.length <= 3, true);
  assert.equal(first.rows.length > 1, true);
  assert.equal(first.rows.every((row, index) => index === 0 || Math.sign(row.offsetX) !== Math.sign(first.rows[index - 1].offsetX)), true);
  assert.equal(first.rows.map(row => row.text).join('').replace(/\s/g, ''), source.fullText.replace(/\s/g, ''));
  assert.match(first.cacheKey, /partita/);
});

test('Tilt creates one emphasized segment, caps lines and scales long text to fit', () => {
  const source = line({ t: 0, duration: 6, text: '第一句很长，第二句继续延伸；第三句仍然唱着，第四句终于落下。' });
  const model = buildTiltLineModel(source, { width: 640, height: 540 }, {
    maxLines: 4,
    emphasis: 0.8,
    measureText: text => Array.from(text).length * 80,
  });

  assert.equal(model.segments.length >= 1 && model.segments.length <= 4, true);
  assert.equal(model.segments.filter(segment => segment.isEmphasis).length, 1);
  assert.equal(model.scale > 0 && model.scale <= 1, true);
  assert.equal(model.segments.map(segment => segment.text).join('').replace(/\s/g, ''), source.fullText.replace(/\s/g, ''));
});

test('Tilt character pulse remains bounded and alternates horizontal shift', () => {
  const source = line({ t: 1, duration: 2, text: '倾诉', words: [{ text: '倾诉', t: 1, d: 2 }] });
  const model = buildTiltLineModel(source, { width: 960, height: 540 }, { maxLines: 2, emphasis: 0.7 });
  const frame = resolveTiltCharacterFrame(model, 1.5, { pulse: 0.8 });
  const characters = frame.segments.flatMap(segment => segment.characters).filter(character => !/^\s+$/.test(character.char));

  assert.equal(characters.every(character => character.pulse >= 0 && character.pulse <= 1), true);
  assert.equal(characters.length >= 2, true);
  assert.notEqual(Math.sign(characters[0].shift), Math.sign(characters[1].shift));
});
