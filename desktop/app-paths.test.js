'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const appPathsModule = require('./app-paths');
const {
  APP_OWNED_DIRECTORIES,
  configureStableAppPaths,
} = appPathsModule;

function makeTempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-app-paths-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function expectedPaths(userData) {
  return {
    userData,
    credentialsDirectory: path.join(userData, 'credentials'),
    credentials: path.join(userData, 'credentials', 'platform-credentials.bin'),
    platformCacheDirectory: path.join(userData, 'platform-cache'),
    platformCache: path.join(userData, 'platform-cache', 'platform-cache.json'),
    lyricsDirectory: path.join(userData, 'lyrics'),
    beatmapDirectory: path.join(userData, 'beatmap'),
    updateDirectory: path.join(userData, 'update'),
    localMetadataDirectory: path.join(userData, 'local-metadata'),
    journalDirectory: path.join(userData, 'journal'),
    listenJournal: path.join(userData, 'journal', 'listen-sync-journal.json'),
    migrationJournal: path.join(userData, 'journal', 'data-migration-v1.json'),
  };
}

test('exports only the stable path API and exact owned directory contract', () => {
  assert.deepEqual(Object.keys(appPathsModule).sort(), [
    'APP_OWNED_DIRECTORIES',
    'configureStableAppPaths',
  ]);
  assert.deepEqual(APP_OWNED_DIRECTORIES, [
    'credentials',
    'platform-cache',
    'lyrics',
    'beatmap',
    'update',
    'local-metadata',
    'journal',
  ]);
  assert.equal(Object.isFrozen(APP_OWNED_DIRECTORIES), true);
});

test('creates every stable owned directory before publishing userData', () => {
  const calls = [];
  const appData = path.join('C:', 'Users', 'Tomato', 'AppData', 'Roaming');
  const fakeApp = {
    setName(name) {
      calls.push(['setName', name]);
    },
    getPath(name) {
      calls.push(['getPath', name]);
      if (name !== 'appData') throw new Error(`unexpected path read: ${name}`);
      return appData;
    },
    setPath(name, value) {
      calls.push(['setPath', name, value]);
    },
  };

  const result = configureStableAppPaths(fakeApp, {
    createDirectory(directory, options) {
      calls.push(['createDirectory', directory, options]);
    },
  });

  const userData = path.join(appData, 'Mineradio');
  assert.deepEqual(calls, [
    ['setName', 'Mineradio'],
    ['getPath', 'appData'],
    ['createDirectory', userData, { recursive: true, mode: 0o700 }],
    ...APP_OWNED_DIRECTORIES.map(directory => [
      'createDirectory',
      path.join(userData, directory),
      { recursive: true, mode: 0o700 },
    ]),
    ['setPath', 'userData', userData],
  ]);
  assert.deepEqual(result, expectedPaths(userData));
  assert.equal(Object.isFrozen(result), true);
});

test('default directory creation materializes the complete stable layout', (t) => {
  const appData = makeTempDirectory(t);
  const fakeApp = {
    setName() {},
    getPath: () => appData,
    setPath() {},
  };

  const paths = configureStableAppPaths(fakeApp);

  for (const directory of [
    paths.userData,
    paths.credentialsDirectory,
    paths.platformCacheDirectory,
    paths.lyricsDirectory,
    paths.beatmapDirectory,
    paths.updateDirectory,
    paths.localMetadataDirectory,
    paths.journalDirectory,
  ]) {
    assert.equal(fs.statSync(directory).isDirectory(), true, directory);
  }
  assert.equal(fs.existsSync(paths.credentials), false);
  assert.equal(fs.existsSync(paths.platformCache), false);
  assert.equal(fs.existsSync(paths.listenJournal), false);
});

test('path module contains no plaintext credential names or legacy mtime migration', () => {
  const source = fs.readFileSync(path.join(__dirname, 'app-paths.js'), 'utf8');
  assert.doesNotMatch(source, /\.cookie|\.qq-cookie|mtimeMs|copyFileAtomic|migrateOwnedDataFiles/);

  const packageJson = require('../package.json');
  assert.match(packageJson.scripts.check, /node --check desktop\/app-paths\.js/);
});
