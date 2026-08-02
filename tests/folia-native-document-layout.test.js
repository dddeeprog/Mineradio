const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNativeLyricDocument,
  buildNativeLyricFrame,
  findActiveLineIndex,
} = require('../public/folia-native/state');
const {
  splitSemanticChunks,
  splitSentenceLines,
  createStableWordLayout,
  createBoundedCache,
  resolveCanvasPixelRatio,
  buildWordGraphemeTimings,
  buildLineGraphemeTimeline,
  buildPostLyricLayoutUnits,
  buildDisplayWordsFromLayoutUnits,
} = require('../public/folia-native/layout');
const {
  buildClassicLineModel,
  resolveClassicLineRenderProfile,
  getClassicWordActiveEndTime,
} = require('../public/folia-native/dom-state');

const fixture = [
  {
    t: 1,
    duration: 2,
    text: '风吹过 city lights ✨',
    translation: 'Wind through the city lights',
    words: [
      { text: '风吹过', t: 1, d: 0.8 },
      { text: 'city', t: 1.8, d: 0.5 },
      { text: 'lights', t: 2.3, d: 0.5 },
      { text: '✨', t: 2.8, d: 0.2 },
    ],
  },
  { t: 3, duration: 0.05, text: '啊' },
];

test('builds an immutable lyric document with grapheme and render hints', () => {
  const doc = buildNativeLyricDocument(fixture, { id: 'song-1', source: 'online' });

  assert.equal(doc.id, 'song-1');
  assert.equal(doc.source, 'online');
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].translation, 'Wind through the city lights');
  assert.equal(doc.lines[0].graphemes.map(item => item.char).join(''), fixture[0].text);
  assert.equal(doc.lines[1].renderHints.timingClass, 'micro');
  assert.equal(Object.isFrozen(doc.lines), true);
});

test('finds current line after seek and builds a frame with referenced audio data', () => {
  const doc = buildNativeLyricDocument(fixture, { id: 'song-1' });
  const frequencyData = new Uint8Array([1, 2, 3]);
  const index = findActiveLineIndex(doc, 2.4, 1);
  const frame = buildNativeLyricFrame(doc, {
    now: 2.4,
    lineIndex: index,
    playing: true,
    audio: { frequencyData, bass: 0.4 },
    viewport: { width: 1366, height: 768, dpr: 1 },
  });

  assert.equal(index, 0);
  assert.equal(frame.line, doc.lines[0]);
  assert.equal(frame.audio.frequencyData, frequencyData);
  assert.equal(frame.progress > 0 && frame.progress < 1, true);
});

test('native lyric frame exposes a finite RAF delta independent of playback time', () => {
  const doc = buildNativeLyricDocument(fixture, { id: 'song-1' });
  const explicit = buildNativeLyricFrame(doc, { now: 999, rafDeltaMs: 16.7, dt: 4 });
  const fallback = buildNativeLyricFrame(doc, { now: 0.1, dt: 0.02 });
  const invalid = buildNativeLyricFrame(doc, { now: 42, rafDeltaMs: -3, dt: 1 });

  assert.equal(explicit.rafDeltaMs, 16.7);
  assert.equal(fallback.rafDeltaMs, 20);
  assert.equal(invalid.rafDeltaMs, 0);
  assert.notEqual(explicit.rafDeltaMs, explicit.now);
  assert.equal(Number.isFinite(explicit.rafDeltaMs), true);
});

test('semantic and sentence layout handles CJK, Latin and punctuation deterministically', () => {
  assert.deepEqual(splitSemanticChunks('今夜，we stay together。', 6), ['今夜，', 'we ', 'stay ', 'together', '。']);
  assert.deepEqual(splitSentenceLines('第一句，第二句；第三句。', 3), ['第一句，', '第二句；', '第三句。']);

  const line = buildNativeLyricDocument(fixture, { id: 'song-1' }).lines[0];
  const first = createStableWordLayout(line, { width: 960, height: 540 }, 'classic');
  const second = createStableWordLayout(line, { width: 960, height: 540 }, 'classic');
  assert.deepEqual(first, second);
  assert.equal(first.every(item => item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1), true);
});

test('bounded cache evicts least-recent entries by count and estimated bytes', () => {
  const cache = createBoundedCache({ maxEntries: 2, maxBytes: 10 });
  cache.set('a', { value: 1 }, 4);
  cache.set('b', { value: 2 }, 4);
  cache.get('a');
  cache.set('c', { value: 3 }, 4);
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
  assert.equal(cache.has('c'), true);
  cache.set('large', {}, 20);
  assert.equal(cache.stats().bytes <= 10, true);
});

test('canvas pixel ratio respects the 1080p dynamic surface budget at 4K', () => {
  assert.equal(resolveCanvasPixelRatio({ width: 3840, height: 2160, dpr: 1 }, 'quality'), 0.5);
  assert.equal(resolveCanvasPixelRatio({ width: 1920, height: 1080, dpr: 1 }, 'quality'), 1);
  assert.equal(resolveCanvasPixelRatio({ width: 960, height: 540, dpr: 2 }, 'quality'), 2);
});

test('post-lyric units preserve parser timing while sticking contractions', () => {
  const words = [
    { text: 'It', startTime: 1, endTime: 1.2 },
    { text: '’', startTime: 1.2, endTime: 1.25 },
    { text: 's', startTime: 1.25, endTime: 1.4 },
    { text: 'time', startTime: 1.5, endTime: 2 },
  ];
  const snapshot = JSON.stringify(words);
  const units = buildPostLyricLayoutUnits({ fullText: 'It’s time', words }, {
    semantic: true,
    sticky: true,
    segmentWords: () => [
      { segment: 'It', isWordLike: true },
      { segment: '’', isWordLike: false },
      { segment: 's', isWordLike: true },
      { segment: ' ', isWordLike: false },
      { segment: 'time', isWordLike: true },
    ],
  });

  assert.equal(units[0].text, 'It’s');
  assert.deepEqual(units[0].words, words.slice(0, 3));
  assert.equal(units[0].words[0], words[0]);
  assert.equal(units[0].startTime, 1);
  assert.equal(units[0].endTime, 1.4);
  assert.deepEqual(buildDisplayWordsFromLayoutUnits(units)[0], {
    text: 'It’s',
    startTime: 1,
    endTime: 1.4,
  });
  assert.equal(JSON.stringify(words), snapshot);
});

test('word grapheme timings prefer syllables and retain parser word identity', () => {
  const timings = buildWordGraphemeTimings({
    text: '流光',
    startTime: 2,
    endTime: 2.8,
    syllables: [
      { text: '流', startTime: 2, endTime: 2.3 },
      { text: '光', startTime: 2.3, endTime: 2.8 },
    ],
  }, 4);

  assert.deepEqual(timings.map(item => [item.char, item.startTime, item.endTime, item.wordIndex]), [
    ['流', 2, 2.3, 4],
    ['光', 2.3, 2.8, 4],
  ]);
});

test('word grapheme timings normalize nonfinite, reversed and zero-duration word intervals', () => {
  const cases = [
    {
      name: 'nonfinite start and end',
      word: { text: '流光', startTime: NaN, endTime: NaN },
      expected: [[0, 0], [0, 0]],
    },
    {
      name: 'nonfinite start',
      word: { text: '流光', startTime: NaN, endTime: 2 },
      expected: [[0, 1], [1, 2]],
    },
    {
      name: 'reversed interval',
      word: { text: '流光', startTime: 3, endTime: 1 },
      expected: [[3, 3], [3, 3]],
    },
    {
      name: 'zero-duration interval',
      word: { text: '流光', startTime: 4, endTime: 4 },
      expected: [[4, 4], [4, 4]],
    },
  ];

  for (const { name, word, expected } of cases) {
    const timings = buildWordGraphemeTimings(word);
    assert.deepEqual(
      timings.map(item => [item.startTime, item.endTime]),
      expected,
      name,
    );
  }
});

test('invalid syllable intervals fall back across the normalized whole-word interval', () => {
  const invalidSyllables = [
    {
      name: 'overlapping',
      syllables: [
        { text: '流', startTime: 1, endTime: 2.2 },
        { text: '光', startTime: 2, endTime: 3 },
      ],
    },
    {
      name: 'nonfinite',
      syllables: [
        { text: '流', startTime: 1, endTime: NaN },
        { text: '光', startTime: 2, endTime: 3 },
      ],
    },
    {
      name: 'before word bounds',
      syllables: [
        { text: '流', startTime: 0.9, endTime: 2 },
        { text: '光', startTime: 2, endTime: 3 },
      ],
    },
    {
      name: 'after word bounds',
      syllables: [
        { text: '流', startTime: 1, endTime: 2 },
        { text: '光', startTime: 2, endTime: 3.1 },
      ],
    },
    {
      name: 'reversed',
      syllables: [
        { text: '流', startTime: 2, endTime: 1.5 },
        { text: '光', startTime: 2, endTime: 3 },
      ],
    },
  ];

  for (const { name, syllables } of invalidSyllables) {
    const timings = buildWordGraphemeTimings({
      text: '流光',
      startTime: 1,
      endTime: 3,
      syllables,
    });
    assert.deepEqual(
      timings.map(item => [item.startTime, item.endTime]),
      [[1, 2], [2, 3]],
      name,
    );
  }
});

test('line grapheme timeline aligns parser words and fills display-only gaps', () => {
  const timeline = buildLineGraphemeTimeline({
    fullText: 'A B',
    startTime: 1,
    endTime: 4,
    words: [
      { text: 'A', startTime: 1, endTime: 2 },
      { text: 'B', startTime: 3, endTime: 4 },
    ],
  });

  assert.deepEqual(timeline.map(item => item.char), ['A', ' ', 'B']);
  assert.deepEqual(timeline.map(item => [item.startTime, item.endTime]), [[1, 2], [3, 3], [3, 4]]);
  assert.equal(timeline[0].wordIndex, 0);
  assert.equal(timeline[2].wordIndex, 1);
});

test('line grapheme timeline never emits nonfinite or reversed timings', () => {
  const timeline = buildLineGraphemeTimeline({
    fullText: 'A B ',
    startTime: NaN,
    endTime: NaN,
    words: [
      { text: 'A', startTime: NaN, endTime: NaN },
      { text: 'B', startTime: 4, endTime: 2 },
    ],
  });

  assert.deepEqual(timeline.map(item => item.char), ['A', ' ', 'B', ' ']);
  assert.equal(timeline.every(item => (
    Number.isFinite(item.startTime)
      && Number.isFinite(item.endTime)
      && item.endTime >= item.startTime
  )), true);
});

test('semantic layout falls back to parser words when segment alignment fails', () => {
  const words = [
    { text: '春', startTime: 0, endTime: 0.4 },
    { text: '风', startTime: 0.4, endTime: 0.8 },
  ];
  const units = buildPostLyricLayoutUnits({ fullText: '春风', words }, {
    semantic: true,
    sticky: false,
    segmentWords: () => [{ segment: '春雨', isWordLike: true }],
  });

  assert.deepEqual(units.map(unit => unit.text), ['春', '风']);
  assert.equal(units[0].words[0], words[0]);
  assert.equal(units[1].words[0], words[1]);
  assert.equal(units.every(unit => unit.isSemantic === false), true);
});

test('Classic timing helpers expose the existing render profile behavior', () => {
  const line = {
    index: 0,
    fullText: '光',
    startTime: 1,
    endTime: 1.05,
    words: [{ text: '光', startTime: 1, endTime: 1.05 }],
    graphemes: [{ char: '光', startTime: 1, endTime: 1.05 }],
    renderHints: { wordRevealMode: 'instant', lineTransitionMode: 'none', renderEndTime: 1.4 },
  };
  const model = buildClassicLineModel(line, { width: 960, height: 540 }, {});
  const profile = resolveClassicLineRenderProfile(line);

  assert.deepEqual(profile, model.renderProfile);
  assert.equal(getClassicWordActiveEndTime(model.items[0], profile), 1.4);
});
