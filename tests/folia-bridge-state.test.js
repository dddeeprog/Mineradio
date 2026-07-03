const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FOLIA_BRIDGE_MESSAGE_TYPE,
  createFoliaBridgeMessage,
  createFoliaBridgeSnapshot,
  foliaBridgeSnapshotKey,
  normalizeAudioPayload,
  normalizeLyricsPayload,
  normalizeSongMeta,
} = require('../public/folia-bridge-state');

test('normalizes Mineradio song metadata for the Folia bridge', () => {
  const meta = normalizeSongMeta({
    provider: 'qq',
    mid: '003abc',
    mediaMid: 'media-003',
    name: 'Heartbeat',
    artist: 'Childish Gambino / Slom',
    album: 'Bando Stone',
    cover: 'https://img.test/cover.jpg',
    duration: 213000,
  });

  assert.equal(meta.provider, 'qq');
  assert.equal(meta.title, 'Heartbeat');
  assert.deepEqual(meta.artists, ['Childish Gambino', 'Slom']);
  assert.equal(meta.artist, 'Childish Gambino / Slom');
  assert.equal(meta.mid, '003abc');
  assert.equal(meta.coverUrl, 'https://img.test/cover.jpg');
  assert.equal(meta.duration, 213);
});

test('keeps lyric lines serializable while preserving karaoke words', () => {
  const lyrics = normalizeLyricsPayload({
    timingSource: 'netease-karaoke',
    hasNativeKaraoke: true,
    lines: [
      {
        t: 1.23456,
        duration: 3.456,
        text: 'Lalalala~',
        translation: '啦啦啦',
        words: [{ t: 1.2, duration: 0.3, text: 'La' }],
      },
      { t: 5, text: '   ' },
    ],
  });

  assert.equal(lyrics.timingSource, 'netease-karaoke');
  assert.equal(lyrics.hasNativeKaraoke, true);
  assert.equal(lyrics.lines.length, 1);
  assert.equal(lyrics.lines[0].time, 1.235);
  assert.equal(lyrics.lines[0].duration, 3.456);
  assert.equal(lyrics.lines[0].words[0].text, 'La');
});

test('clamps audio energy payload for stable visual consumption', () => {
  assert.deepEqual(normalizeAudioPayload({
    energy: 9,
    bass: -1,
    mid: 0.33333,
    treble: Number.NaN,
    beatPulse: 0.7777,
    beatOnset: true,
  }), {
    energy: 2,
    bass: 0,
    mid: 0.333,
    treble: 0,
    beatPulse: 0.778,
    beatOnset: true,
  });
});

test('creates stable bridge messages and throttle keys', () => {
  const snapshot = createFoliaBridgeSnapshot({
    now: 1000,
    reason: 'play',
    song: { id: 101, name: 'Song', artist: 'Artist', cover: 'https://img.test/a.jpg' },
    playback: { playing: true, currentTime: 12.3456, duration: 200, queueIndex: 2, queueLength: 9 },
    lyrics: { timingSource: 'lrc', lines: [{ t: 12, text: 'Line' }] },
    audio: { energy: 0.42, beatPulse: 0.3 },
  });
  const message = createFoliaBridgeMessage(snapshot);

  assert.equal(snapshot.bridge, 'mineradio-folia');
  assert.equal(snapshot.generatedAt, 1000);
  assert.equal(snapshot.playback.currentTime, 12.346);
  assert.equal(message.type, FOLIA_BRIDGE_MESSAGE_TYPE);
  assert.equal(message.payload, snapshot);
  assert.match(foliaBridgeSnapshotKey(snapshot), /netease\|101\|49\|400\|1\|lrc\|1/);
});

test('includes sanitized Folia theme state in bridge snapshots', () => {
  const snapshot = createFoliaBridgeSnapshot({
    now: 2000,
    song: { id: 202, name: 'Theme Song' },
    theme: {
      source: 'ai',
      generated: true,
      lyricFont: 'serif-en',
      theme: {
        dark: {
          name: 'Theme Night',
          backgroundColor: '#111827',
          primaryColor: '#ffffff',
          accentColor: '#55ddff',
          secondaryColor: '#cbd5e1',
        },
      },
      particleTint: '#55ddff',
    },
  });

  assert.equal(snapshot.theme.source, 'ai');
  assert.equal(snapshot.theme.generated, true);
  assert.equal(snapshot.theme.lyricFont, 'serif-en');
  assert.equal(snapshot.theme.foliaStageTheme.dark.accentColor, '#55ddff');
  assert.match(foliaBridgeSnapshotKey(snapshot), /#55ddff/);
});
