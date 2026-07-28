const test = require('node:test');
const assert = require('node:assert/strict');
const {
  desktopLyricsStateSignature,
  normalizeDesktopLyricsOpacity,
  shouldIgnoreDesktopLyricsMouse,
} = require('./overlay-state');

test('normalizeDesktopLyricsOpacity clamps to desktop lyrics bounds', () => {
  assert.equal(normalizeDesktopLyricsOpacity(null), 0.92);
  assert.equal(normalizeDesktopLyricsOpacity(0.1), 0.28);
  assert.equal(normalizeDesktopLyricsOpacity(2), 1);
  assert.equal(normalizeDesktopLyricsOpacity(0.5), 0.5);
});

test('desktopLyricsStateSignature is stable for equivalent numeric jitter', () => {
  const a = desktopLyricsStateSignature({
    enabled: true,
    text: 'Hello',
    progress: 0.5012,
    progressSpan: 4.801,
    title: 'Song',
    artist: 'Artist',
    playing: true,
    opacity: 0.9201,
    rows: 'double',
    align: 'center',
    playback: { time: 12.249, duration: 180.02, rate: 1 },
    colors: { primary: '#fff', secondary: '#9cf', highlight: '#ff0', glow: '#0ff' },
  });
  const b = desktopLyricsStateSignature({
    enabled: true,
    text: 'Hello',
    progress: 0.5014,
    progressSpan: 4.804,
    title: 'Song',
    artist: 'Artist',
    playing: true,
    opacity: 0.9204,
    rows: 'double',
    align: 'center',
    playback: { time: 12.251, duration: 180.04, rate: 1 },
    colors: { primary: '#fff', secondary: '#9cf', highlight: '#ff0', glow: '#0ff' },
  });
  assert.equal(a, b);
});

test('desktopLyricsStateSignature changes for user-visible payload changes', () => {
  const base = {
    enabled: true,
    text: 'Line one',
    progress: 0.5,
    title: 'Song',
    artist: 'Artist',
    playing: true,
    rows: 'single',
    align: 'center',
    colors: { primary: '#fff' },
  };
  assert.notEqual(desktopLyricsStateSignature(base), desktopLyricsStateSignature({ ...base, text: 'Line two' }));
  assert.notEqual(desktopLyricsStateSignature(base), desktopLyricsStateSignature({ ...base, rows: 'double' }));
  assert.notEqual(desktopLyricsStateSignature(base), desktopLyricsStateSignature({ ...base, align: 'left' }));
});

test('shouldIgnoreDesktopLyricsMouse follows renderer pointer capture', () => {
  assert.equal(shouldIgnoreDesktopLyricsMouse(false), true);
  assert.equal(shouldIgnoreDesktopLyricsMouse(true), false);
});
