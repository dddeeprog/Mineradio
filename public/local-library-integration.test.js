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
  const detector = extractFunction(indexHtml, 'function isTtmlLyricDocument');
  const body = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  assert.match(detector, /<!DOCTYPE/);
  assert.match(detector, /<!--/);
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
    prologTtml: '<?xml version="1.0"?>\n<!-- meta -->\n<!DOCTYPE tt>\n<tt></tt>',
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
  vm.runInNewContext(`${detector}; ${body}; this.ttmlState = parseLocalImportedLyricText('<tt></tt>', { name: 'song.ttml' }); this.xmlTtmlState = parseLocalImportedLyricText('<?xml version="1.0"?>  <tt></tt>', { name: 'song.lrc' }); this.prologTtmlState = parseLocalImportedLyricText(prologTtml, { name: 'song.lrc' }); this.lrcState = parseLocalImportedLyricText('[00:00]line', { name: 'song.lrc' }); this.textState = parseLocalImportedLyricText('[00:00]line', { name: 'song.txt' });`, context);
  [[context.ttmlState, 'local-ttml', '同目录 TTML'], [context.xmlTtmlState, 'local-ttml', '同目录 TTML'], [context.prologTtmlState, 'local-ttml', '同目录 TTML'], [context.lrcState, 'local-lrc', '同目录 LRC'], [context.textState, 'local-text', '同目录 TXT']].forEach(function(entry) {
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
  const transaction = extractFunction(indexHtml, 'async function playQueueAt');
  const resolve = extractFunction(indexHtml, 'async function resolvePlaybackPreparation');
  const prepare = extractFunction(indexHtml, 'async function prepareResolvedPlayback');
  const commit = extractFunction(indexHtml, 'async function commitPreparedPlayback');
  const localBranch = resolve.indexOf('if (isLocal)');
  const onlineLookup = resolve.indexOf('if (!platformLoginCapabilitySnapshot)');
  assert.notEqual(localBranch, -1, 'missing local playback branch');
  assert.notEqual(onlineLookup, -1, 'missing online capability lookup');
  assert.ok(localBranch < onlineLookup, 'local playback must bypass online URL lookup');
  assert.match(transaction, /resolvePlaybackPreparation\(idx, transactionOpts, attempt, requestQueue\)/);
  assert.match(transaction, /prepareResolvedPlayback\(resolved, transactionOpts, attempt\)/);
  assert.match(transaction, /commitPreparedPlayback\(idx, transactionOpts, prepared, attempt\)/);
  assert.match(transaction, /finalizePreparedPlaybackCommit\(value, prepared, attempt\)/);
  assert.match(resolve, /catalogSong\.type === 'local'/);
  assert.match(resolve, /catalogSong\.source === 'local-library'/);
  assert.match(resolve, /collectLocalImportAssets\([\s\S]*localSongAssetFiles\(catalogSong, localRecord\)/);
  assert.match(resolve, /mediaUrl: localUrl/);
  assert.match(prepare, /media\.src = resolved\.mediaUrl/);
  assert.match(commit, /currentLocalSong = song/);
  assert.match(commit, /localImport\.lyricState/);
  assert.doesNotMatch(commit, /parseCustomLyricText\(localImport\.lyricText\)/);
  assert.match(commit, /setOriginalLyricsState\(localLyricLines, localLyricState\.hasNativeKaraoke, localLyricSource\)/);
  assert.match(commit, /applyLocalResolvedCover\(localMedia, localImport, prepared\.localCoverFile \|\| false, localCover, localCoverOpts, localUrl\)/);
});

test('direct dropped local files use async metadata and asset parsing', () => {
  assert.match(indexHtml, /handleFiles\(e\.target\.files\)\.catch\(handleLocalFileImportError\)/);
  assert.match(indexHtml, /handleFiles\(e\.dataTransfer\.files\)\.catch\(handleLocalFileImportError\)/);

  const body = extractFunction(indexHtml, 'async function handleFiles');
  assert.match(body, /collectLocalImportAssets\(localMedia, audioFile, files\)/);
  assert.match(body, /localImportFileIdentity\(audioFile\)/);
  assert.match(body, /requestQueuePlayback\(\[droppedSong\], 0,/);
  assert.match(body, /localImport: localImport/);
  assert.match(body, /ownedObjectUrl: url/);
  assert.doesNotMatch(body, /audio\.pause\(\)/);
  assert.doesNotMatch(body, /audio\.src = url/);
  assert.doesNotMatch(body, /parseCustomLyricText\(localImport\.lyricText\)/);
});

test('local library assets retain ordered lyric candidates and the importer falls back from invalid TTML to LRC', async () => {
  const assets = extractFunction(indexHtml, 'function localSongAssetFiles');
  const candidates = extractFunction(indexHtml, 'function localLyricCandidateFiles');
  const detector = extractFunction(indexHtml, 'function isTtmlLyricDocument');
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
  vm.runInNewContext(`${detector}; ${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
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
  const detector = extractFunction(indexHtml, 'function isTtmlLyricDocument');
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
  vm.runInNewContext(`${detector}; ${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
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

test('local lyric importer tries TXT after invalid TTML and LRC before embedded FLAC', async () => {
  const identity = extractFunction(indexHtml, 'function localImportFileIdentity');
  const detector = extractFunction(indexHtml, 'function isTtmlLyricDocument');
  const parser = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  const importer = extractFunction(indexHtml, 'async function collectLocalImportAssets');
  const reads = [];
  let embeddedReads = 0;
  const ttml = { name: 'song.ttml' };
  const lrc = { name: 'song.lrc' };
  const legacyTxt = { name: 'song.txt' };
  const context = {
    console: { warn() {} },
    window: { MineradioLocalLyricFileState: { normalizeParsedLocalLyrics(input) { return { lines: input.lines, timingSource: input.timingSource, sourceLabel: input.sourceLabel }; } } },
    localImportReadOptions() { return {}; },
    parseFoliaTtmlLyricText() { return []; },
    parseCustomLyricText() { return []; },
  };
  vm.runInNewContext(`${identity}; ${detector}; ${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
  await context.collect({
    findAdjacentLocalAssets() { return { lyricFile: ttml, lyricCandidates: [ttml, lrc], legacyTxtFile: legacyTxt }; },
    async extractLocalMetadata() { return {}; },
    async readTextFile(file) { reads.push(file.name); return ''; },
    async extractFlacEmbeddedLyricsText() { embeddedReads += 1; return ''; },
  }, { name: 'song.flac' }, []);
  assert.deepEqual(reads, ['song.ttml', 'song.lrc', 'song.txt']);
  assert.equal(embeddedReads, 1);
});

test('valid legacy TXT stops local lyric import before embedded FLAC', async () => {
  const identity = extractFunction(indexHtml, 'function localImportFileIdentity');
  const detector = extractFunction(indexHtml, 'function isTtmlLyricDocument');
  const parser = extractFunction(indexHtml, 'function parseLocalImportedLyricText');
  const importer = extractFunction(indexHtml, 'async function collectLocalImportAssets');
  const reads = [];
  let embeddedReads = 0;
  const ttml = { name: 'song.ttml' };
  const lrc = { name: 'song.lrc' };
  const legacyTxt = { name: 'song.txt' };
  const context = {
    console: { warn() {} },
    window: { MineradioLocalLyricFileState: { normalizeParsedLocalLyrics(input) { return { lines: input.lines, hasNativeKaraoke: false, timingSource: input.timingSource, sourceLabel: input.sourceLabel }; } } },
    localImportReadOptions() { return {}; },
    parseFoliaTtmlLyricText() { return []; },
    parseCustomLyricText(text) { return String(text) === 'legacy text' ? [{ text: 'TXT', source: 'custom-text' }] : []; },
  };
  vm.runInNewContext(`${identity}; ${detector}; ${parser}; ${importer}; this.collect = collectLocalImportAssets;`, context);
  const result = await context.collect({
    findAdjacentLocalAssets() { return { lyricFile: ttml, lyricCandidates: [ttml, lrc], legacyTxtFile: legacyTxt }; },
    async extractLocalMetadata() { return {}; },
    async readTextFile(file) {
      reads.push(file.name);
      return file === legacyTxt ? 'legacy text' : '';
    },
    async extractFlacEmbeddedLyricsText() { embeddedReads += 1; return '[00:00]embedded'; },
  }, { name: 'song.flac' }, []);
  assert.deepEqual(reads, ['song.ttml', 'song.lrc', 'song.txt']);
  assert.equal(result.lyricState.timingSource, 'local-text');
  assert.equal(result.lyricState.lines[0].source, 'local-text');
  assert.equal(embeddedReads, 0);
});
