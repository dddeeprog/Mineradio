const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');

const { buildNativeLyricDocument } = require('../public/folia-native/state');
const {
  balancedSliceSizes,
  buildClassicThreeGroups,
} = require('../public/folia-native/classic-three-groups');

function parserLine(text, words, overrides = {}) {
  return {
    index: 0,
    fullText: text,
    startTime: words.length ? words[0].startTime : 0,
    endTime: words.length ? words.at(-1).endTime : 0,
    words,
    ...overrides,
  };
}

function oneWord(text, startTime = 1, endTime = 3, overrides = {}) {
  return parserLine(text, [{ text, startTime, endTime, ...overrides }]);
}

function semanticWholeText() {
  return text => [{ segment: text, isWordLike: true }];
}

test('balanced visual slice sizes use the approved deterministic distribution', () => {
  assert.deepEqual(balancedSliceSizes(5, 4), [3, 2]);
  assert.deepEqual(balancedSliceSizes(7, 4), [4, 3]);
  assert.deepEqual(balancedSliceSizes(9, 4), [3, 3, 3]);
  assert.deepEqual(balancedSliceSizes(10, 4), [4, 3, 3]);
});

for (const [text, expected] of [
  ['一二三四五', [3, 2]],
  ['一二三四五六七', [4, 3]],
  ['一二三四五六七八九', [3, 3, 3]],
  ['一二三四五六七八九十', [4, 3, 3]],
]) {
  test(`splits one ${Array.from(text).length}-grapheme parser word deterministically`, () => {
    const groups = buildClassicThreeGroups(oneWord(text), {
      segmentWords: semanticWholeText(),
    });

    assert.deepEqual(groups.map(group => group.bodyGraphemeCount), expected);
    assert.equal(groups.map(group => group.text).join(''), text);
    assert.equal(groups.every(group => group.isVisualSlice), true);
    assert.equal(groups.every((group, index) => (
      index === 0 || group.startTime >= groups[index - 1].endTime
    )), true);
    assert.equal(groups[0].startTime, 1);
    assert.equal(groups.at(-1).endTime, 3);
  });
}

test('word-internal slices keep standalone timing before a following parser word', () => {
  const longWord = { text: '一二三四五', startTime: 1, endTime: 3 };
  const nextWord = { text: '六七', startTime: 3.05, endTime: 4 };
  const groups = buildClassicThreeGroups(parserLine('一二三四五六七', [longWord, nextWord]), {
    segmentWords: semanticWholeText(),
  });

  assert.deepEqual(groups.map(group => group.bodyGraphemeCount), [3, 2, 2]);
  assert.deepEqual(groups.map(group => group.text), ['一二三', '四五', '六七']);
  assert.deepEqual(groups.map(group => group.isVisualSlice), [true, true, false]);
  assert.equal(groups[0].startTime, 1);
  assert.ok(Math.abs(groups[0].endTime - 2.2) < 1e-9);
  assert.ok(Math.abs(groups[1].startTime - 2.2) < 1e-9);
  assert.equal(groups[1].endTime, 3);
  assert.equal(groups[2].startTime, 3.05);
  assert.equal(groups[1].words[0], longWord);
  assert.equal(groups[2].words[0], nextWord);
});

test('visual slices use valid syllable timing and proportionally replace invalid timing', () => {
  const syllableGroups = buildClassicThreeGroups(oneWord('一二三四五', 1, 3, {
    syllables: [
      { text: '一二', startTime: 1, endTime: 1.4 },
      { text: '三', startTime: 1.4, endTime: 2.4 },
      { text: '四五', startTime: 2.4, endTime: 3 },
    ],
  }), { segmentWords: semanticWholeText() });
  const fallbackGroups = buildClassicThreeGroups(oneWord('一二三四五', 1, 3, {
    syllables: [{ text: '一二三四五', startTime: NaN, endTime: 3 }],
  }), { segmentWords: semanticWholeText() });

  assert.deepEqual(syllableGroups.map(group => [group.startTime, group.endTime]), [[1, 2.4], [2.4, 3]]);
  assert.ok(Math.abs(fallbackGroups[0].endTime - 2.2) < 1e-9);
  assert.ok(Math.abs(fallbackGroups[1].startTime - 2.2) < 1e-9);
  assert.equal(fallbackGroups[1].endTime, 3);
});

test('oversized semantic CJK units balance only at parser-word boundaries', () => {
  const words = [
    { text: '春风', startTime: 0, endTime: 0.4 },
    { text: '细', startTime: 0.4, endTime: 0.6 },
    { text: '雨', startTime: 0.6, endTime: 0.8 },
    { text: '来', startTime: 0.8, endTime: 1 },
  ];
  const groups = buildClassicThreeGroups(parserLine('春风细雨来', words), {
    segmentWords: semanticWholeText(),
  });

  assert.deepEqual(groups.map(group => group.text), ['春风细', '雨来']);
  assert.deepEqual(groups.map(group => group.bodyGraphemeCount), [3, 2]);
  assert.deepEqual(groups[0].words, words.slice(0, 2));
  assert.deepEqual(groups[1].words, words.slice(2));
});

test('CJK grouping merges at 0.12 seconds and hard-breaks above it', () => {
  const closeWords = [
    { text: '流', startTime: 0, endTime: 0.5 },
    { text: '光', startTime: 0.62, endTime: 1 },
  ];
  const farWords = [
    { text: '流', startTime: 0, endTime: 0.5 },
    { text: '光', startTime: 0.621, endTime: 1 },
  ];

  assert.deepEqual(
    buildClassicThreeGroups(parserLine('流光', closeWords), { segmentWords: () => null }).map(group => group.text),
    ['流光'],
  );
  assert.deepEqual(
    buildClassicThreeGroups(parserLine('流光', farWords), { segmentWords: () => null }).map(group => group.text),
    ['流', '光'],
  );
});

test('semantic CJK grouping preserves parser gaps above 0.12 seconds', () => {
  const words = [
    { text: '流', startTime: 0, endTime: 0.5 },
    { text: '光', startTime: 0.621, endTime: 1 },
  ];
  const groups = buildClassicThreeGroups(parserLine('流光', words), {
    segmentWords: semanticWholeText(),
  });

  assert.deepEqual(groups.map(group => group.text), ['流', '光']);
});

test('semantic CJK grouping preserves sentence-punctuation boundaries', () => {
  const words = [
    { text: '春', startTime: 0, endTime: 0.3 },
    { text: '。', startTime: 0.3, endTime: 0.35 },
    { text: '夜', startTime: 0.35, endTime: 0.7 },
  ];
  const groups = buildClassicThreeGroups(parserLine('春。夜', words), {
    segmentWords: semanticWholeText(),
  });

  assert.deepEqual(groups.map(group => group.text), ['春。', '夜']);
  assert.equal(groups[0].isSticky, true);
});

test('sentence punctuation attaches backward without consuming body capacity', () => {
  const words = [
    { text: '春', startTime: 0, endTime: 0.2 },
    { text: '风', startTime: 0.2, endTime: 0.4 },
    { text: '。', startTime: 0.4, endTime: 0.45 },
    { text: '夜', startTime: 0.45, endTime: 0.8 },
  ];
  const groups = buildClassicThreeGroups(parserLine('春风。夜', words), {
    segmentWords: () => null,
  });

  assert.deepEqual(groups.map(group => group.text), ['春风。', '夜']);
  assert.deepEqual(groups.map(group => group.bodyGraphemeCount), [2, 1]);
  assert.equal(groups[0].endTime, 0.45);
  assert.equal(groups[0].isSticky, true);
});

test('sticky Latin contractions remain one display group with original words', () => {
  const words = [
    { text: 'It', startTime: 1, endTime: 1.2 },
    { text: '’', startTime: 1.2, endTime: 1.25 },
    { text: 's', startTime: 1.25, endTime: 1.4 },
    { text: 'time', startTime: 1.5, endTime: 2 },
  ];
  const groups = buildClassicThreeGroups(parserLine('It’s time', words), {
    segmentWords: () => null,
  });

  assert.deepEqual(groups.map(group => group.text), ['It’s', 'time']);
  assert.deepEqual(groups[0].words, words.slice(0, 3));
  assert.equal(groups[0].isSticky, true);
  assert.equal(groups[0].isCjk, false);
});

test('unavailable word segmentation still balances continuous CJK parser words', () => {
  const words = Array.from('一二三四五', (text, index) => ({
    text,
    startTime: index * 0.2,
    endTime: (index + 1) * 0.2,
  }));
  const first = buildClassicThreeGroups(parserLine('一二三四五', words), {
    segmentWords: () => null,
  });
  const second = buildClassicThreeGroups(parserLine('一二三四五', words), {
    segmentWords: () => null,
  });

  assert.deepEqual(first.map(group => group.bodyGraphemeCount), [3, 2]);
  assert.deepEqual(first, second);
});

test('group planning does not mutate a NativeLyricDocument line or its words', () => {
  const line = buildNativeLyricDocument([{
    t: 1,
    duration: 2,
    text: '流光。',
    words: [
      { text: '流', t: 1, d: 0.8 },
      { text: '光', t: 1.8, d: 0.9 },
      { text: '。', t: 2.7, d: 0.3 },
    ],
  }], { id: 'immutable-groups' }).lines[0];
  const before = JSON.parse(JSON.stringify(line));
  const groups = buildClassicThreeGroups(line, { segmentWords: () => null });

  assert.deepEqual(line, before);
  assert.equal(groups[0].words[0], line.words[0]);
  assert.equal(Object.isFrozen(groups), true);
  assert.equal(groups.every(group => Object.isFrozen(group)), true);
  assert.equal(groups.every(group => Object.isFrozen(group.words) && Object.isFrozen(group.graphemes)), true);
});

test('mixed CJK, Latin and emoji parser words preserve grapheme integrity', () => {
  const family = '👨‍👩‍👧‍👦';
  const words = [
    { text: '你', startTime: 0, endTime: 0.4 },
    { text: 'love', startTime: 0.45, endTime: 1 },
    { text: family, startTime: 1.05, endTime: 1.5 },
    { text: '光', startTime: 1.55, endTime: 2 },
  ];
  const groups = buildClassicThreeGroups(parserLine(`你love${family}光`, words), {
    segmentWords: text => [
      { segment: text.slice(0, 1), isWordLike: true },
      { segment: 'love', isWordLike: true },
      { segment: family, isWordLike: false },
      { segment: '光', isWordLike: true },
    ],
  });

  assert.deepEqual(groups.map(group => group.text), ['你', 'love', family, '光']);
  assert.equal(groups.flatMap(group => group.graphemes).map(item => item.char).join(''), `你love${family}光`);
  assert.equal(groups[2].graphemes.length, 1);
  assert.deepEqual(groups.map(group => group.isCjk), [true, false, false, true]);
});

test('grapheme fallback keeps a joined emoji intact without Intl.Segmenter', () => {
  const family = '👨‍👩‍👧‍👦';
  const segmenterDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');

  try {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    const groups = buildClassicThreeGroups(oneWord(family, 1, 2), {
      segmentWords: () => null,
    });

    assert.equal(groups.length, 1);
    assert.equal(groups[0].graphemes.length, 1);
    assert.equal(groups[0].graphemes[0].char, family);
  } finally {
    if (segmenterDescriptor) Object.defineProperty(Intl, 'Segmenter', segmenterDescriptor);
    else delete Intl.Segmenter;
  }
});

test('200-token CJK fallback grouping stays bounded and preserves exact DP output', () => {
  const words = Array.from({ length: 200 }, (_, index) => ({
    text: '中',
    startTime: index * 0.01,
    endTime: (index + 1) * 0.01,
  }));
  const line = parserLine(words.map(word => word.text).join(''), words);
  const startedAt = performance.now();
  const groups = buildClassicThreeGroups(line, { segmentWords: () => null });
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 1000, `expected grouping under 1000ms, received ${elapsedMs.toFixed(2)}ms`);
  assert.equal(groups.every(group => group.bodyGraphemeCount <= 4), true);
  assert.equal(groups.map(group => group.text).join(''), line.fullText);
  assert.deepEqual(groups.map(group => group.bodyGraphemeCount), Array(50).fill(4));
});

test('missing layout APIs produce a descriptive dependency error', () => {
  const filename = path.join(__dirname, '../public/folia-native/classic-three-groups.js');
  const source = fs.readFileSync(filename, 'utf8');
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename });

  assert.throws(
    () => sandbox.MineradioNativeLyricClassicThreeGroups.buildClassicThreeGroups(oneWord('流')),
    error => {
      assert.match(error.message, /MineradioNativeLyricLayout/);
      assert.match(error.message, /buildPostLyricLayoutUnits/);
      assert.match(error.message, /buildWordGraphemeTimings/);
      return true;
    },
  );
});
