'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_OWNED_DIRECTORIES = Object.freeze([
  'credentials',
  'platform-cache',
  'lyrics',
  'beatmap',
  'update',
  'local-metadata',
  'journal',
]);
const DIRECTORY_OPTIONS = Object.freeze({
  recursive: true,
  mode: 0o700,
});

function buildStablePaths(userData) {
  const credentialsDirectory = path.join(userData, 'credentials');
  const platformCacheDirectory = path.join(userData, 'platform-cache');
  const journalDirectory = path.join(userData, 'journal');
  return Object.freeze({
    userData,
    credentialsDirectory,
    credentials: path.join(credentialsDirectory, 'platform-credentials.bin'),
    platformCacheDirectory,
    platformCache: path.join(platformCacheDirectory, 'platform-cache.json'),
    lyricsDirectory: path.join(userData, 'lyrics'),
    beatmapDirectory: path.join(userData, 'beatmap'),
    updateDirectory: path.join(userData, 'update'),
    localMetadataDirectory: path.join(userData, 'local-metadata'),
    journalDirectory,
    listenJournal: path.join(journalDirectory, 'listen-sync-journal.json'),
    migrationJournal: path.join(journalDirectory, 'data-migration-v1.json'),
  });
}

function configureStableAppPaths(app, options = {}) {
  const createDirectory = options.createDirectory
    || ((directory, mkdirOptions) => fs.mkdirSync(directory, mkdirOptions));

  app.setName('Mineradio');
  const userData = path.join(app.getPath('appData'), 'Mineradio');
  const stablePaths = buildStablePaths(userData);

  createDirectory(userData, DIRECTORY_OPTIONS);
  for (const directory of APP_OWNED_DIRECTORIES) {
    createDirectory(path.join(userData, directory), DIRECTORY_OPTIONS);
  }
  app.setPath('userData', userData);
  return stablePaths;
}

module.exports = {
  APP_OWNED_DIRECTORIES,
  configureStableAppPaths,
};
