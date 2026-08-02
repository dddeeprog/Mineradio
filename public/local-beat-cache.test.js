const test = require('node:test');
const assert = require('node:assert/strict');

const localBeatCache = require('./local-beat-cache');

test('localBeatSongKey keeps explicit local keys and ignores online songs', () => {
  assert.equal(
    localBeatCache.localBeatSongKey({ type: 'local', localKey: 'library:album/a.mp3:10:20' }),
    'library:album/a.mp3:10:20',
  );
  assert.equal(
    localBeatCache.localBeatSongKey({
      source: 'local-library',
      localLibraryFileSignature: 'album/b.flac:30:40',
    }),
    'library:album/b.flac:30:40',
  );
  assert.equal(localBeatCache.localBeatSongKey({ id: 123, name: 'Online' }), '');
});

test('playbackBeatMapKey and localBeatDiskKey normalize local cache keys', () => {
  assert.equal(
    localBeatCache.playbackBeatMapKey({ type: 'local', localKey: 'upload:a.mp3:1:2' }),
    'local:upload:a.mp3:1:2',
  );
  assert.equal(localBeatCache.playbackBeatMapKey({ type: 'local' }), '');
  assert.equal(localBeatCache.localBeatDiskKey('library:album/a.mp3:10:20', 'dj'), 'local:library:album/a.mp3:10:20:dj');
  assert.equal(localBeatCache.localBeatDiskKey('library:album/a.mp3:10:20', 'bad'), 'local:library:album/a.mp3:10:20:mr');
});

test('pickCachedLocalBeatMap follows preference and falls back to another local mode', () => {
  const mrMap = { visualBeatCount: 8 };
  const djMap = { visualBeatCount: 16 };
  const cache = {
    'library:album/a.mp3:10:20': {
      updatedAt: 1700000000000,
      mr: mrMap,
      dj: djMap,
    },
  };

  assert.deepEqual(
    localBeatCache.pickCachedLocalBeatMap(cache, {}, { localKey: 'library:album/a.mp3:10:20' }),
    {
      localKey: 'library:album/a.mp3:10:20',
      mode: 'mr',
      map: mrMap,
    },
  );
  assert.deepEqual(
    localBeatCache.pickCachedLocalBeatMap(cache, { 'library:album/a.mp3:10:20': 'dj' }, { localKey: 'library:album/a.mp3:10:20' }),
    {
      localKey: 'library:album/a.mp3:10:20',
      mode: 'dj',
      map: djMap,
    },
  );
  assert.deepEqual(
    localBeatCache.pickCachedLocalBeatMap({ 'library:album/a.mp3:10:20': { dj: djMap } }, {}, { localKey: 'library:album/a.mp3:10:20' }),
    {
      localKey: 'library:album/a.mp3:10:20',
      mode: 'dj',
      map: djMap,
    },
  );
});

test('storeLocalBeatMapEntry writes normalized entries and current preference', () => {
  const cache = {};
  const prefs = {};
  const map = { visualBeatCount: 4 };

  const stored = localBeatCache.storeLocalBeatMapEntry(cache, prefs, 'library:album/a.mp3:10:20', 'dj', map, {
    now: 1700000000000,
  });

  assert.equal(stored, true);
  assert.deepEqual(cache, {
    'library:album/a.mp3:10:20': {
      dj: map,
      updatedAt: 1700000000000,
    },
  });
  assert.deepEqual(prefs, { 'library:album/a.mp3:10:20': 'dj' });
});
