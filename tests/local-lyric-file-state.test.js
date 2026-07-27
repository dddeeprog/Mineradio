const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSameDirectoryLyricCandidates,
  compareLocalLyricCandidates,
  normalizeLocalLyricCandidate,
  selectPreferredLocalLyric,
  normalizeParsedLocalLyrics,
} = require('../public/local-lyric-file-state');

test('buildSameDirectoryLyricCandidates returns TTML before LRC for an audio stem', () => {
  const candidates = buildSameDirectoryLyricCandidates('D:\\Music\\Album\\Track.flac');
  assert.deepEqual(candidates.map((candidate) => candidate.lyricPath), [
    'D:/Music/Album/Track.ttml',
    'D:/Music/Album/Track.lrc',
  ]);
});

test('buildSameDirectoryLyricCandidates rejects audio paths with dot or traversal segments', () => {
  assert.deepEqual(buildSameDirectoryLyricCandidates('D:/Music/Album/../Other/Track.flac'), []);
  assert.deepEqual(buildSameDirectoryLyricCandidates('D:/Music/Other/./Track.flac'), []);
});

test('normalizeLocalLyricCandidate accepts only a same-directory TTML or LRC with the audio stem', () => {
  const accepted = normalizeLocalLyricCandidate({
    audioPath: 'D:/Music/Album/Track.flac',
    lyricPath: 'D:/Music/Album/Track.ttml',
  });
  assert.equal(accepted.format, 'ttml');
  assert.equal(accepted.enhanced, true);

  [
    { lyricPath: 'D:/Elsewhere/Track.lrc' },
    { lyricPath: 'D:/Music/Album/Other.lrc' },
    { lyricPath: 'D:/Music/Album/Track.txt' },
    { name: '../Track.lrc' },
    { name: 'Track/../Track.lrc' },
  ].forEach((candidate) => {
    assert.equal(normalizeLocalLyricCandidate({ audioPath: 'D:/Music/Album/Track.flac', ...candidate }), null);
  });
});

test('normalizeLocalLyricCandidate rejects dot and traversal segments in either full path', () => {
  ['ttml', 'lrc'].forEach((format) => {
    assert.equal(normalizeLocalLyricCandidate({
      audioPath: `D:/Music/Album/../Other/Track.flac`,
      lyricPath: `D:/Music/Album/../Other/Track.${format}`,
    }), null);
    assert.equal(normalizeLocalLyricCandidate({
      audioPath: `D:/Music/Other/Track.flac`,
      lyricPath: `D:/Music/Other/./Track.${format}`,
    }), null);
  });
});

test('selectPreferredLocalLyric is deterministic and ranks TTML over enhanced and plain LRC', () => {
  const plain = { format: 'lrc', enhanced: false, exists: true, name: 'Track.lrc' };
  const enhanced = { format: 'lrc', enhanced: true, exists: true, name: 'Track.word.lrc' };
  const ttml = { format: 'ttml', enhanced: false, exists: true, name: 'Track.ttml' };
  assert.equal(selectPreferredLocalLyric([plain, enhanced, ttml]), ttml);
  assert.equal(selectPreferredLocalLyric([ttml, plain, enhanced]), ttml);
  assert.equal(selectPreferredLocalLyric([plain, enhanced]), enhanced);
});

test('same-priority candidates use lowercase then code-unit path ordering independent of input order', () => {
  const upper = { format: 'lrc', enhanced: false, exists: true, lyricPath: 'Album/Track.LRC', name: 'Track.LRC' };
  const lower = { format: 'lrc', enhanced: false, exists: true, lyricPath: 'album/track.lrc', name: 'track.lrc' };
  assert.ok(compareLocalLyricCandidates(upper, lower) < 0);
  assert.ok(compareLocalLyricCandidates(lower, upper) > 0);
  assert.equal(selectPreferredLocalLyric([upper, lower]), upper);
  assert.equal(selectPreferredLocalLyric([lower, upper]), upper);
});

test('normalizeParsedLocalLyrics normalizes Mineradio lines while retaining future word timing fields', () => {
  const result = normalizeParsedLocalLyrics({
    source: 'local-ttml',
    lines: [{
      time: 1.2,
      text: 'hello world',
      words: [{ text: 'hello', time: 1.2, duration: 0.8, c0: 0, c1: 5 }],
    }],
  });
  assert.deepEqual(result.lines[0], {
    t: 1.2,
    duration: 4.8,
    text: 'hello world',
    words: [{ text: 'hello', t: 1.2, d: 0.8, c0: 0, c1: 5 }],
    charCount: 11,
    source: 'local-ttml',
  });
  assert.equal(result.hasNativeKaraoke, true);
  assert.equal(result.sourceLabel, '同目录 TTML');
});
