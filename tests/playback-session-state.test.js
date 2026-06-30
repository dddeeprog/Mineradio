const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PLAYBACK_SESSION_SCHEMA,
  createPlaybackSessionSnapshot,
  normalizePlaybackSessionSnapshot,
  sanitizePlaybackSong,
} = require('../public/playback-session-state');

test('creates a restorable playback session while filtering transient queue items', () => {
  const session = createPlaybackSessionSnapshot({
    playQueue: [
      { type: 'local', name: 'Local', artist: 'Disk', localUrl: 'blob:lost' },
      { id: 101, name: 'A', artist: 'NE', cover: 'https://img.test/a.jpg', _lastPlaybackFailAt: 123 },
      { provider: 'qq', mid: 'qq-202', mediaMid: 'media-202', name: 'B', artist: 'QQ', cover: 'blob:cover' },
    ],
    currentIdx: 2,
    currentTime: 96.8,
    duration: 200,
    playing: true,
    now: 123456,
  });

  assert.equal(session.schema, PLAYBACK_SESSION_SCHEMA);
  assert.equal(session.savedAt, 123456);
  assert.equal(session.currentIdx, 1);
  assert.equal(session.currentTime, 96.8);
  assert.equal(session.duration, 200);
  assert.equal(session.wasPlaying, true);
  assert.equal(session.queue.length, 2);
  assert.equal(session.queue[0].id, 101);
  assert.equal(session.queue[0]._lastPlaybackFailAt, undefined);
  assert.equal(session.queue[1].mid, 'qq-202');
  assert.equal(session.queue[1].cover, undefined);
});

test('does not create a playback session when the current song cannot be restored', () => {
  assert.equal(createPlaybackSessionSnapshot({
    playQueue: [{ type: 'local', name: 'Local', localUrl: 'blob:gone' }],
    currentIdx: 0,
    currentTime: 30,
  }), null);
  assert.equal(createPlaybackSessionSnapshot({ playQueue: [], currentIdx: -1 }), null);
});

test('sanitizes playback songs without persisting temporary media fields', () => {
  const song = sanitizePlaybackSong({
    id: 9,
    name: 'Song',
    artist: 'Artist',
    cover: 'data:image/png;base64,huge',
    customCover: 'data:image/png;base64,huge',
    localUrl: 'blob:audio',
    file: { name: 'x.mp3' },
    _runtime: true,
  });

  assert.deepEqual(song, {
    id: 9,
    name: 'Song',
    artist: 'Artist',
  });
});

test('normalizes playback session snapshots and clamps resume time safely', () => {
  const restored = normalizePlaybackSessionSnapshot({
    schema: PLAYBACK_SESSION_SCHEMA,
    queue: [{ id: 1, name: 'A' }],
    currentIdx: 4,
    currentTime: 200,
    duration: 210,
    savedAt: 1000,
  }, { now: 1500 });

  assert.equal(restored.currentIdx, 0);
  assert.equal(restored.currentTime, 200);
  assert.equal(restored.duration, 210);
  assert.equal(restored.queue.length, 1);

  const nearEnd = normalizePlaybackSessionSnapshot({
    schema: PLAYBACK_SESSION_SCHEMA,
    queue: [{ id: 1, name: 'A' }],
    currentIdx: 0,
    currentTime: 299.9,
    duration: 300,
  });
  assert.equal(nearEnd.currentTime, 299.25);
});

test('rejects invalid playback session snapshots', () => {
  assert.equal(normalizePlaybackSessionSnapshot(null), null);
  assert.equal(normalizePlaybackSessionSnapshot({ schema: 0, queue: [{ id: 1 }] }), null);
  assert.equal(normalizePlaybackSessionSnapshot({ schema: PLAYBACK_SESSION_SCHEMA, queue: [] }), null);
  assert.equal(normalizePlaybackSessionSnapshot({
    schema: PLAYBACK_SESSION_SCHEMA,
    queue: [{ type: 'local', localUrl: 'blob:gone' }],
    currentIdx: 0,
  }), null);
});
