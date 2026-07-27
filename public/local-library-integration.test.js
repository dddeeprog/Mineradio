const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const appCss = fs.readFileSync(path.join(repoRoot, 'public', 'styles', 'app.css'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing ${signature}`);
  const brace = source.indexOf('{', start);
  assert.notEqual(brace, -1, `missing function body for ${signature}`);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function body for ${signature}`);
}

test('local library import entry is wired into the desktop upload actions', () => {
  assert.match(indexHtml, /id="local-library-btn"/);
  assert.match(indexHtml, /onclick="openLocalLibraryImport\(event\)"/);
  assert.match(indexHtml, /id="local-library-count"/);
  assert.match(appCss, /#local-library-btn/);
  assert.match(appCss, /body\.desktop-shell #local-library-btn\.local-library-ready/);
});

test('local lyric candidate state loads before local media and library helpers', () => {
  const lyricStateIndex = indexHtml.indexOf('src="local-lyric-file-state.js"');
  const mediaIndex = indexHtml.indexOf('src="local-media-assets.js"');
  const libraryIndex = indexHtml.indexOf('src="local-library.js"');
  assert.ok(lyricStateIndex >= 0, 'missing local lyric file state script');
  assert.ok(lyricStateIndex < mediaIndex, 'local lyric state must load before local media assets');
  assert.ok(lyricStateIndex < libraryIndex, 'local lyric state must load before local library');
});

test('local library state and import flow use desktop APIs and helper model', () => {
  assert.match(indexHtml, /LOCAL_LIBRARY_STATE_STORE_KEY = 'mineradio-local-library-state-v1'/);
  assert.match(indexHtml, /function canUseLocalLibraryImport\(/);
  assert.match(indexHtml, /function readLocalLibrarySnapshot\(/);
  assert.match(indexHtml, /function writeLocalLibrarySnapshot\(/);
  assert.match(indexHtml, /function importLocalLibrarySongs\(/);

  const body = extractFunction(indexHtml, 'async function openLocalLibraryImport');
  assert.match(body, /chooseLocalMusicFolder\(/);
  assert.match(body, /scanLocalMusicFolder\(previousSnapshot\.folderPath\)/);
  assert.match(body, /MineradioLocalLibrary\.compareLocalLibrarySnapshot/);
  assert.match(body, /writeLocalLibrarySnapshot\(result\)/);
  assert.match(body, /MineradioLocalLibrary\.buildLocalLibrarySongs\(result\)/);
  assert.match(body, /importLocalLibrarySongs\(songs, result/);
});

test('playQueueAt sends local library songs through the shared queue playback path', () => {
  const body = extractFunction(indexHtml, 'async function playQueueAt');
  const localBranch = body.indexOf('if (isLocalPlayback)');
  const onlineLookup = body.indexOf("apiJson('/api/song/url");
  assert.notEqual(localBranch, -1, 'missing local playback branch');
  assert.notEqual(onlineLookup, -1, 'missing online playback lookup');
  assert.ok(localBranch < onlineLookup, 'local playback must bypass online URL lookup');
  assert.match(body, /song\.type === 'local'/);
  assert.match(body, /song\.source === 'local-library'/);
  assert.match(body, /currentLocalSong = song/);
  assert.match(body, /collectLocalImportAssets\(localMedia, localRecord, localSongAssetFiles\(song, localRecord\)\)/);
  assert.match(body, /audio\.src = localUrl/);
  assert.match(body, /setOriginalLyricsState\(localLyricLines, false, localLyricSource\)/);
  assert.match(body, /applyLocalResolvedCover\(localMedia, localImport, false, localCover, localCoverOpts, localUrl\)/);
});

test('direct dropped local files use async metadata and asset parsing', () => {
  assert.match(indexHtml, /handleFiles\(e\.target\.files\)\.catch\(handleLocalFileImportError\)/);
  assert.match(indexHtml, /handleFiles\(e\.dataTransfer\.files\)\.catch\(handleLocalFileImportError\)/);

  const body = extractFunction(indexHtml, 'async function handleFiles');
  assert.match(body, /collectLocalImportAssets\(localMedia, audioFile, files\)/);
  assert.match(body, /localImportFileIdentity\(audioFile\)/);
  assert.match(body, /parseCustomLyricText\(localImport\.lyricText\)/);
  assert.match(body, /applyLocalResolvedCover\(localMedia, localImport, imgFile, localCover, localCoverOpts, url\)/);
});
