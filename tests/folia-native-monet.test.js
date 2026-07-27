const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNativeLyricDocument } = require('../public/folia-native/state');
const {
  buildMonetVisibleEntries,
  buildMonetPosterModel,
  measureMonetGraphemeOffsets,
  resolveMonetSweepModel,
  resolveMonetKeywordColors,
  buildMonetAudioGeometry,
} = require('../public/folia-native/monet-state');

test('Monet lyric rail keeps two context lines on each side with explicit status', () => {
  const doc = buildNativeLyricDocument(Array.from({ length: 7 }, (_, index) => ({
    t: index * 2,
    duration: 2,
    text: `第 ${index + 1} 行`,
    translation: `Line ${index + 1}`,
  })), { id: 'monet-song' });
  const entries = buildMonetVisibleEntries(doc, 3, 6.5);

  assert.deepEqual(entries.map(entry => entry.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(entries.map(entry => entry.status), ['passed', 'passed', 'active', 'waiting', 'waiting']);
  assert.equal(entries[2].line.translation, 'Line 4');
});

test('Monet sweep uses cumulative measured grapheme width instead of equal character steps', () => {
  const line = buildNativeLyricDocument([{
    t: 0,
    duration: 2,
    text: 'Wi',
    words: [
      { text: 'W', t: 0, d: 1 },
      { text: 'i', t: 1, d: 1 },
    ],
  }], { id: 'width-song' }).lines[0];
  const offsets = measureMonetGraphemeOffsets('Wi', text => ({ W: 20, Wi: 25 }[text] || 0));
  const firstHalf = resolveMonetSweepModel(line, 0.5, offsets);
  const secondHalf = resolveMonetSweepModel(line, 1.5, offsets);

  assert.deepEqual(offsets, [0, 20, 25]);
  assert.equal(firstHalf.fillWidth, 10);
  assert.equal(secondHalf.fillWidth, 22.5);
  assert.equal(secondHalf.activeGraphemeIndex, 1);
});

test('Monet keyword coloring maps matched words back to graphemes', () => {
  const colors = resolveMonetKeywordColors('city lights', [
    { word: 'city', color: '#ff3355' },
    { word: 'missing', color: '#00ff00' },
  ]);
  assert.deepEqual(colors.slice(0, 4), ['#ff3355', '#ff3355', '#ff3355', '#ff3355']);
  assert.equal(colors.at(-1), '');
});

test('Monet builds poster metadata and derives portrait/background from the current cover', () => {
  const doc = buildNativeLyricDocument([], { id: 'poster', title: '雨中莫奈', artist: 'Mineradio', cover: 'https://img.example/cover.jpg' });
  const poster = buildMonetPosterModel(doc, { title: '雨中莫奈', artist: 'Mineradio', album: '夜航', cover: doc.cover }, { width: 1366, height: 768 });
  assert.equal(poster.title, '雨中莫奈');
  assert.equal(poster.artist, 'Mineradio');
  assert.equal(poster.portraitUrl, doc.cover);
  assert.equal(poster.backgroundUrl, doc.cover);
  assert.equal(poster.layout, 'poster-wide');
});

test('Monet audio geometry samples the existing spectrum without mutating it', () => {
  const spectrum = Uint8Array.from({ length: 128 }, (_, index) => (index * 13) % 256);
  const before = spectrum.slice();
  const geometry = buildMonetAudioGeometry(spectrum, 360, 54, { count: 72, energy: 0.6 });

  assert.equal(geometry.bars.length, 72);
  assert.equal(geometry.line.length, 72);
  assert.equal(geometry.bars.every(bar => bar.height >= 0 && bar.height <= 54), true);
  assert.equal(geometry.line.every(point => point.x >= 0 && point.x <= 360 && point.y >= 0 && point.y <= 54), true);
  assert.deepEqual(spectrum, before);
});
