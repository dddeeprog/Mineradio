const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNativeLyricLine,
  buildLineRenderHints,
  buildGraphemeTimeline,
  resolveLineStatus,
  resolveWordStatus,
} = require('../public/folia-native-lyric-state');

test('normalizes Mineradio karaoke words into Folia-like line timing', () => {
  const line = buildNativeLyricLine({
    t: 10,
    duration: 4,
    text: 'Hello world',
    translation: '你好世界',
    words: [
      { text: 'Hello', time: 10, duration: 1.5 },
      { text: 'world', time: 11.5, duration: 2.5 },
    ],
  }, 0);

  assert.equal(line.index, 0);
  assert.equal(line.startTime, 10);
  assert.equal(line.endTime, 14);
  assert.equal(line.fullText, 'Hello world');
  assert.equal(line.translation, '你好世界');
  assert.equal(line.words.length, 2);
  assert.deepEqual(line.words[0], { text: 'Hello', startTime: 10, endTime: 11.5 });
});

test('builds render hints for normal, short and micro lyric lines', () => {
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 3 }).wordRevealMode, 'normal');
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 1.12 }).wordRevealMode, 'fast');
  assert.equal(buildLineRenderHints({ startTime: 1, endTime: 1.05 }).wordRevealMode, 'instant');
});

test('maps word timings back to grapheme timeline including spaces', () => {
  const line = buildNativeLyricLine({
    t: 0,
    duration: 2,
    text: 'A B',
    words: [
      { text: 'A', time: 0, duration: 0.5 },
      { text: 'B', time: 1, duration: 0.5 },
    ],
  }, 0);

  const timeline = buildGraphemeTimeline(line);
  assert.equal(timeline.map(item => item.char).join(''), 'A B');
  assert.equal(timeline[0].startTime, 0);
  assert.equal(timeline[1].startTime, 1);
  assert.equal(timeline[2].startTime, 1);
});

test('resolves line and word state from playback time', () => {
  const line = buildNativeLyricLine({
    t: 5,
    duration: 3,
    text: 'Light',
    words: [{ text: 'Light', time: 5, duration: 3 }],
  }, 0);

  assert.equal(resolveLineStatus(line, 4.9), 'waiting');
  assert.equal(resolveLineStatus(line, 6), 'active');
  assert.equal(resolveLineStatus(line, 9), 'passed');
  assert.equal(resolveWordStatus(line.words[0], 4.9), 'waiting');
  assert.equal(resolveWordStatus(line.words[0], 6), 'active');
  assert.equal(resolveWordStatus(line.words[0], 9), 'passed');
});
