const test = require('node:test');
const assert = require('node:assert/strict');

const localLibrary = require('./local-library');

function fileRecord(name, relativePath, extra) {
  return Object.assign({
    name,
    relativePath,
    webkitRelativePath: relativePath,
    fullPath: `C:/Music/${relativePath}`,
    filePath: `C:/Music/${relativePath}`,
    url: `mineradio-local://file/?path=${encodeURIComponent(`C:/Music/${relativePath}`)}`,
    size: 1234,
    lastModified: 5678,
    type: '',
  }, extra || {});
}

test('buildLocalLibrarySongs converts scan records to local queue songs', () => {
  const result = localLibrary.buildLocalLibrarySongs({
    ok: true,
    folderPath: 'C:/Music',
    files: [
      fileRecord('01 Alpha.mp3', 'Album/01 Alpha.mp3', { type: 'audio/mpeg', size: 100 }),
      fileRecord('02 Beta.flac', 'Album/02 Beta.flac', { type: 'audio/flac', size: 200 }),
    ],
    assets: [],
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((song) => ({
      type: song.type,
      source: song.source,
      provider: song.provider,
      name: song.name,
      artist: song.artist,
      localUrl: song.localUrl,
      localFilePath: song.localFilePath,
      pathKey: song.localLibraryPathKey,
      signature: song.localLibraryFileSignature,
      localKey: song.localKey,
    })),
    [
      {
        type: 'local',
        source: 'local-library',
        provider: 'local',
        name: '01 Alpha',
        artist: '本地文件',
        localUrl: 'mineradio-local://file/?path=C%3A%2FMusic%2FAlbum%2F01%20Alpha.mp3',
        localFilePath: 'C:/Music/Album/01 Alpha.mp3',
        pathKey: 'album/01 alpha.mp3',
        signature: 'album/01 alpha.mp3:100:5678',
        localKey: 'library:album/01 alpha.mp3:100:5678',
      },
      {
        type: 'local',
        source: 'local-library',
        provider: 'local',
        name: '02 Beta',
        artist: '本地文件',
        localUrl: 'mineradio-local://file/?path=C%3A%2FMusic%2FAlbum%2F02%20Beta.flac',
        localFilePath: 'C:/Music/Album/02 Beta.flac',
        pathKey: 'album/02 beta.flac',
        signature: 'album/02 beta.flac:200:5678',
        localKey: 'library:album/02 beta.flac:200:5678',
      },
    ],
  );
});

test('buildLocalLibrarySongs attaches same-directory lyrics and cover assets', () => {
  const alpha = fileRecord('01 Alpha.mp3', 'Album/01 Alpha.mp3');
  const beta = fileRecord('02 Beta.flac', 'Album/02 Beta.flac');
  const alphaLrc = fileRecord('01 Alpha.lrc', 'Album/01 Alpha.lrc', { type: 'text/plain' });
  const folderCover = fileRecord('cover.jpg', 'Album/cover.jpg', { type: 'image/jpeg' });
  const betaCover = fileRecord('02 Beta.png', 'Album/02 Beta.png', { type: 'image/png' });
  const wrongDirLrc = fileRecord('02 Beta.lrc', 'Other/02 Beta.lrc', { type: 'text/plain' });

  const result = localLibrary.buildLocalLibrarySongs({
    ok: true,
    folderPath: 'C:/Music',
    files: [alpha, beta],
    assets: [wrongDirLrc, folderCover, betaCover, alphaLrc],
  });

  assert.equal(result[0].localAdjacentLyricFile, alphaLrc);
  assert.equal(result[0].localAdjacentCoverFile, folderCover);
  assert.equal(result[1].localAdjacentLyricFile, null);
  assert.equal(result[1].localAdjacentCoverFile, betaCover);
});

test('buildLocalLibrarySongs orders same-stem TTML before LRC regardless of scan order', () => {
  const audio = fileRecord('Track.flac', 'Album/Track.flac');
  const plainLrc = fileRecord('Track.lrc', 'Album/Track.lrc', { type: 'text/plain' });
  const ttml = fileRecord('Track.ttml', 'Album/Track.ttml', { type: 'application/ttml+xml' });
  const [song] = localLibrary.buildLocalLibrarySongs({
    ok: true,
    files: [audio],
    assets: [plainLrc, ttml],
  });
  assert.equal(song.localAdjacentLyricFile, ttml);
  assert.deepEqual(song.localAdjacentLyricCandidates, [ttml, plainLrc]);
});

test('buildLocalLibrarySongs stabilizes same-priority case-only lyric path conflicts', () => {
  const audio = fileRecord('Track.flac', 'Album/Track.flac');
  const upper = fileRecord('Track.LRC', 'Album/Track.LRC', { type: 'text/plain' });
  const lower = fileRecord('track.lrc', 'album/track.lrc', { type: 'text/plain' });
  function orderedPaths(assets) {
    return localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets })[0]
      .localAdjacentLyricCandidates.map((file) => file.relativePath);
  }
  assert.deepEqual(orderedPaths([upper, lower]), ['Album/Track.LRC', 'album/track.lrc']);
  assert.deepEqual(orderedPaths([lower, upper]), ['Album/Track.LRC', 'album/track.lrc']);
});

test('buildLocalLibrarySongs never treats bare-name records as same-directory lyric matches', () => {
  const audio = fileRecord('Track.flac', 'Track.flac');
  const ttml = fileRecord('Track.ttml', 'Track.ttml', { type: 'application/ttml+xml' });
  const [song] = localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets: [ttml] });
  assert.equal(song.localAdjacentLyricFile, null);
  assert.deepEqual(song.localAdjacentLyricCandidates, []);
});

test('buildLocalLibrarySongs keeps legacy TXT only as a fallback outside lyricCandidates', () => {
  const audio = fileRecord('Track.flac', 'Album/Track.flac');
  const legacyTxt = fileRecord('Track.txt', 'Album/Track.txt', { type: 'text/plain' });
  const lrc = fileRecord('Track.lrc', 'Album/Track.lrc', { type: 'text/plain' });
  const [txtFallback] = localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets: [legacyTxt] });
  const [preferredLrc] = localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets: [legacyTxt, lrc] });
  assert.equal(txtFallback.localAdjacentLyricFile, legacyTxt);
  assert.deepEqual(txtFallback.localAdjacentLyricCandidates, []);
  assert.equal(preferredLrc.localAdjacentLyricFile, lrc);
  assert.deepEqual(preferredLrc.localAdjacentLyricCandidates, [lrc]);
  assert.equal(preferredLrc.localAdjacentLegacyTxtFile, legacyTxt);
});

test('buildLocalLibrarySongs rejects traversal-path TTML, LRC and legacy TXT candidates', () => {
  const audio = fileRecord('Track.flac', 'Album/../Other/Track.flac');
  const ttml = fileRecord('Track.ttml', 'Album/../Other/Track.ttml', { type: 'application/ttml+xml' });
  const lrc = fileRecord('Track.lrc', 'Album/../Other/Track.lrc', { type: 'text/plain' });
  const legacyTxt = fileRecord('Track.txt', 'Album/../Other/Track.txt', { type: 'text/plain' });
  const [song] = localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets: [ttml, lrc, legacyTxt] });
  assert.equal(song.localAdjacentLyricFile, null);
  assert.deepEqual(song.localAdjacentLyricCandidates, []);
});

test('buildLocalLibrarySongs retains the existing bare-name cover selection', () => {
  const audio = fileRecord('Track.flac', 'Track.flac');
  const cover = fileRecord('Track.jpg', 'Track.jpg', { type: 'image/jpeg' });
  const [song] = localLibrary.buildLocalLibrarySongs({ ok: true, files: [audio], assets: [cover] });
  assert.equal(song.localAdjacentCoverFile, cover);
});

test('buildLocalLibrarySongs returns an empty list for canceled or invalid scans', () => {
  assert.deepEqual(localLibrary.buildLocalLibrarySongs(null), []);
  assert.deepEqual(localLibrary.buildLocalLibrarySongs({ ok: false, files: [] }), []);
  assert.deepEqual(localLibrary.buildLocalLibrarySongs({ ok: true, files: null }), []);
});

test('createLocalLibrarySnapshot stores a light summary for recent library state', () => {
  const snapshot = localLibrary.createLocalLibrarySnapshot({
    ok: true,
    folderPath: 'C:/Music',
    truncated: true,
    files: [
      fileRecord('01 Alpha.mp3', 'Album/01 Alpha.mp3', { size: 100, lastModified: 10 }),
      fileRecord('02 Beta.flac', 'Album/02 Beta.flac', { size: 200, lastModified: 20 }),
    ],
    assets: [
      fileRecord('cover.jpg', 'Album/cover.jpg', { type: 'image/jpeg' }),
    ],
  }, { now: 1700000000000, maxRecords: 1 });

  assert.deepEqual(snapshot, {
    version: 1,
    folderPath: 'C:/Music',
    updatedAt: 1700000000000,
    fileCount: 2,
    assetCount: 1,
    scanTruncated: true,
    snapshotTruncated: true,
    files: [
      {
        name: '01 Alpha.mp3',
        pathKey: 'album/01 alpha.mp3',
        signature: 'album/01 alpha.mp3:100:10',
      },
    ],
  });
});

test('normalizeLocalLibrarySnapshot accepts saved JSON and rejects invalid state', () => {
  const raw = JSON.stringify({
    version: 1,
    folderPath: 'C:/Music',
    updatedAt: 1700000000000,
    fileCount: 1,
    assetCount: 2,
    scanTruncated: false,
    snapshotTruncated: false,
    files: [{ name: 'Alpha.mp3', pathKey: 'alpha.mp3', signature: 'alpha.mp3:1:2' }],
  });
  assert.deepEqual(localLibrary.normalizeLocalLibrarySnapshot(raw), JSON.parse(raw));
  assert.equal(localLibrary.normalizeLocalLibrarySnapshot('{bad json'), null);
  assert.equal(localLibrary.normalizeLocalLibrarySnapshot({ version: 1, folderPath: '', files: [] }), null);
});

test('compareLocalLibrarySnapshot reports added missing and changed files', () => {
  const previous = localLibrary.createLocalLibrarySnapshot({
    ok: true,
    folderPath: 'C:/Music',
    files: [
      fileRecord('Alpha.mp3', 'Alpha.mp3', { size: 1, lastModified: 1 }),
      fileRecord('Beta.mp3', 'Beta.mp3', { size: 2, lastModified: 2 }),
      fileRecord('Gamma.mp3', 'Gamma.mp3', { size: 3, lastModified: 3 }),
    ],
    assets: [],
  }, { now: 1 });

  const diff = localLibrary.compareLocalLibrarySnapshot(previous, {
    ok: true,
    folderPath: 'C:/Music',
    files: [
      fileRecord('Alpha.mp3', 'Alpha.mp3', { size: 1, lastModified: 1 }),
      fileRecord('Beta.mp3', 'Beta.mp3', { size: 9, lastModified: 9 }),
      fileRecord('Delta.mp3', 'Delta.mp3', { size: 4, lastModified: 4 }),
    ],
    assets: [],
  }, { now: 2 });

  assert.deepEqual(
    {
      added: diff.added,
      missing: diff.missing,
      changed: diff.changed,
      stable: diff.stable,
      previousFileCount: diff.previousFileCount,
      nextFileCount: diff.nextFileCount,
      folderChanged: diff.folderChanged,
      nextUpdatedAt: diff.nextSnapshot.updatedAt,
    },
    {
      added: 1,
      missing: 1,
      changed: 1,
      stable: 1,
      previousFileCount: 3,
      nextFileCount: 3,
      folderChanged: false,
      nextUpdatedAt: 2,
    },
  );
});

test('localLibraryStatusText summarizes recent import state', () => {
  assert.equal(localLibrary.localLibraryStatusText(null), '');
  assert.equal(localLibrary.localLibraryStatusText({
    folderPath: 'C:/Music',
    fileCount: 12,
    assetCount: 3,
    scanTruncated: false,
    snapshotTruncated: true,
  }), '12 首 · 3 个素材 · 快照已截断 · C:/Music');
});
