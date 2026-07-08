const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

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

test('local beat cache helper is loaded and wired into renderer keys', () => {
  assert.match(indexHtml, /<script src="local-beat-cache\.js"><\/script>/);
  assert.match(pkg.scripts.check, /node --check public\/local-beat-cache\.js/);
  assert.match(indexHtml, /var localBeatCacheTools = window\.MineradioLocalBeatCache \|\| \{\}/);
  assert.match(indexHtml, /function getSongLocalBeatKey\(/);
  assert.match(indexHtml, /function normalizeLocalBeatMode\(/);

  const beatMapSongKey = extractFunction(indexHtml, 'function beatMapSongKey');
  assert.match(beatMapSongKey, /localBeatCacheTools\.playbackBeatMapKey/);
  assert.ok(
    beatMapSongKey.indexOf('localBeatCacheTools.playbackBeatMapKey') < beatMapSongKey.indexOf("song.type === 'local'"),
    'local helper key should run before legacy local fallback',
  );

  const localBeatDiskKey = extractFunction(indexHtml, 'function localBeatDiskKey');
  assert.match(localBeatDiskKey, /localBeatCacheTools\.localBeatDiskKey/);
});

test('local beat analysis uses cache first and then the online MR scheduler without default modal', () => {
  const prepare = extractFunction(indexHtml, 'function prepareLocalBeatAnalysis');
  assert.match(prepare, /pickCachedLocalBeatMap/);
  assert.match(prepare, /readBeatDiskCache\(localBeatDiskKey\(localKey, firstMode\)\)/);
  assert.match(prepare, /storeLocalBeatEntry\(localKey, mode, map, song, \{ skipDisk:true \}\)/);
  assert.match(prepare, /scheduleBeatAnalysis\(beatMapSongKey\(song\), audioUrl, beatMapToken, song\)/);
  assert.doesNotMatch(prepare, /openLocalBeatModal\(song, audioUrl\)/);
});

test('local queue playback schedules beat analysis only after playback starts', () => {
  const body = extractFunction(indexHtml, 'async function playQueueAt');
  const localStart = body.indexOf('var localStarted = await playAudio()');
  const localBeat = body.indexOf('prepareLocalBeatAnalysis(song, localUrl)');
  assert.notEqual(localStart, -1, 'missing local playback start');
  assert.notEqual(localBeat, -1, 'missing local beat scheduling');
  assert.ok(localStart < localBeat, 'local beat scheduling must happen after playAudio resolves');
});

test('dropped local files schedule beat analysis only after playback starts', () => {
  const body = extractFunction(indexHtml, 'async function handleFiles');
  assert.match(body, /playAudio\(\)\.then\(function\(ok\)\{[\s\S]*if \(ok && currentLocalSong && currentLocalSong\.localUrl === url\)[\s\S]*prepareLocalBeatAnalysis\(currentLocalSong, url\)/);
  assert.doesNotMatch(body, /setTimeout\(function\(\)\{[\s\S]*prepareLocalBeatAnalysis\(currentLocalSong, url\)/);
});
