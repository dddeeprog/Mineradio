const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

test('local lyric imports parse TTML and LRC into one normalized lyric state', () => {
  const body = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  assert.match(body, /MineradioLocalLyricFileState/);
  assert.match(body, /normalizeParsedLocalLyrics/);
  assert.match(body, /parseFoliaTtmlLyricText/);
  assert.match(body, /'local-ttml'/);
  assert.match(body, /'同目录 TTML'/);
  assert.match(body, /parseCustomLyricText/);
  assert.match(body, /'local-lrc'/);
  assert.match(body, /'同目录 LRC'/);
  assert.match(body, /\.txt/);
  assert.match(body, /lines\.map\(function\(line\) \{[\s\S]*source: source/);

  const context = {
    window: {
      MineradioLocalLyricFileState: {
        normalizeParsedLocalLyrics(input) {
          return {
            lines: input.lines,
            hasNativeKaraoke: false,
            timingSource: input.timingSource,
            sourceLabel: input.sourceLabel,
          };
        },
      },
    },
    parseFoliaTtmlLyricText() { return [{ text: 'TTML', source: 'folia-ttml' }]; },
    parseCustomLyricText() { return [{ text: 'LRC', source: 'custom-lrc' }]; },
  };
  vm.runInNewContext(`${body}; this.ttmlState = parseLocalImportedLyricText('<tt></tt>', { name: 'song.ttml' }); this.xmlTtmlState = parseLocalImportedLyricText('<?xml version="1.0"?>  <tt></tt>', { name: 'song.lrc' }); this.lrcState = parseLocalImportedLyricText('[00:00]line', { name: 'song.lrc' }); this.textState = parseLocalImportedLyricText('[00:00]line', { name: 'song.txt' });`, context);
  [[context.ttmlState, 'local-ttml', '同目录 TTML'], [context.xmlTtmlState, 'local-ttml', '同目录 TTML'], [context.lrcState, 'local-lrc', '同目录 LRC'], [context.textState, 'local-text', '同目录 TXT']].forEach(function(entry) {
    assert.equal(entry[0].hasNativeKaraoke, false);
    assert.equal(entry[0].timingSource, entry[1]);
    assert.equal(entry[0].sourceLabel, entry[2]);
    assert.equal(entry[0].lines[0].source, entry[1]);
  });
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
  assert.match(body, /localImport\.lyricState/);
  assert.doesNotMatch(body, /parseCustomLyricText\(localImport\.lyricText\)/);
  assert.match(body, /setOriginalLyricsState\(localLyricLines, localLyricState\.hasNativeKaraoke, localLyricSource\)/);
  assert.match(body, /applyLocalResolvedCover\(localMedia, localImport, false, localCover, localCoverOpts, localUrl\)/);
});

test('direct dropped local files use async metadata and asset parsing', () => {
  assert.match(indexHtml, /handleFiles\(e\.target\.files\)\.catch\(handleLocalFileImportError\)/);
  assert.match(indexHtml, /handleFiles\(e\.dataTransfer\.files\)\.catch\(handleLocalFileImportError\)/);

  const body = extractFunction(indexHtml, 'async function handleFiles');
  assert.match(body, /collectLocalImportAssets\(localMedia, audioFile, files\)/);
  assert.match(body, /localImportFileIdentity\(audioFile\)/);
  assert.match(body, /localImport\.lyricState/);
  assert.doesNotMatch(body, /parseCustomLyricText\(localImport\.lyricText\)/);
  assert.match(body, /applyLocalResolvedCover\(localMedia, localImport, imgFile, localCover, localCoverOpts, url\)/);
});

test('local library assets retain ordered lyric candidates and the importer falls back from invalid TTML to LRC', async () => {
  const assets = extractFunction(indexHtml, 'function localSongAssetFiles');
  const candidates = extractFunction(indexHtml, 'function localLyricCandidateFiles');
  const parser = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  const importer = extractFunction(indexHtml, 'async function collectLocalImportAssets');

  assert.match(assets, /localLyricCandidateFiles/);
  assert.match(candidates, /song && song\.localAdjacentLyricCandidates/);
  assert.match(assets, /coverFile/);
  assert.match(importer, /result\.adjacent\.lyricCandidates/);
  assert.match(importer, /for \(var lyricIndex = 0; lyricIndex < lyricCandidates\.length; lyricIndex \+= 1\)/);
  assert.match(importer, /parseLocalImportedLyricText\(lyricText, lyricCandidate\)/);
  assert.match(importer, /parsedLyric\.lines\.length/);
  assert.match(importer, /\.flac\$/i);

  const reads = [];
  const ttml = { name: 'song.ttml' };
  const lrc = { name: 'song.lrc' };
  const context = {
    console: { warn() {} },
    window: {
      MineradioLocalLyricFileState: {
        normalizeParsedLocalLyrics(input) {
          return { lines: input.lines, hasNativeKaraoke: false, timingSource: input.timingSource, sourceLabel: input.sourceLabel };
        },
      },
    },
    localImportReadOptions() { return {}; },
    parseFoliaTtmlLyricText() { return []; },
    parseCustomLyricText() { return [{ text: 'LRC', source: 'custom-lrc' }]; },
  };
  vm.runInNewContext(`${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
  const result = await context.collect({
    findAdjacentLocalAssets() { return { lyricFile: ttml, lyricCandidates: [ttml, lrc] }; },
    async extractLocalMetadata() { return {}; },
    async readTextFile(file) {
      reads.push(file.name);
      return file === ttml ? '<tt></tt>' : '[00:00]LRC';
    },
  }, { name: 'song.mp3' }, []);
  assert.deepEqual(reads, ['song.ttml', 'song.lrc']);
  assert.equal(result.lyricState.timingSource, 'local-lrc');
  assert.equal(result.lyricState.lines[0].source, 'local-lrc');
});

test('valid local LRC avoids FLAC embedded lyric fallback', async () => {
  const parser = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  const importer = extractFunction(indexHtml, 'async function collectLocalImportAssets');
  let embeddedReads = 0;
  const lrc = { name: 'song.lrc' };
  const context = {
    console: { warn() {} },
    window: {
      MineradioLocalLyricFileState: {
        normalizeParsedLocalLyrics(input) {
          return { lines: input.lines, hasNativeKaraoke: false, timingSource: input.timingSource, sourceLabel: input.sourceLabel };
        },
      },
    },
    localImportReadOptions() { return {}; },
    parseFoliaTtmlLyricText() { return []; },
    parseCustomLyricText() { return [{ text: 'LRC', source: 'custom-lrc' }]; },
  };
  vm.runInNewContext(`${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
  const result = await context.collect({
    findAdjacentLocalAssets() { return { lyricFile: lrc, lyricCandidates: [lrc] }; },
    async extractLocalMetadata() { return {}; },
    async readTextFile() { return '[00:00]LRC'; },
    async extractFlacEmbeddedLyricsText() {
      embeddedReads += 1;
      return '[00:00]embedded';
    },
  }, { name: 'song.flac' }, []);
  assert.equal(result.lyricState.timingSource, 'local-lrc');
  assert.equal(embeddedReads, 0);
});
