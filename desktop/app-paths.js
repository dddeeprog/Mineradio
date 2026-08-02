/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
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
const BUILD_IDENTITIES = Object.freeze({
  stable: Object.freeze({
    channel: 'stable',
    productName: 'Mineradio',
    appId: 'com.mineradio.desktop',
    userDataRoot: 'Mineradio',
  }),
  beta: Object.freeze({
    channel: 'beta',
    productName: 'Mineradio Beta',
    appId: 'com.mineradio.desktop.beta',
    userDataRoot: 'Mineradio Beta',
  }),
});

function packageMetadata() {
  try {
    return require('../package.json');
  } catch (_) {
    return {};
  }
}

function requireIdentityText(value, label, pattern) {
  const normalized = String(value || '').trim();
  if (!normalized || !pattern.test(normalized)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return normalized;
}

function resolveDesktopBuildIdentity(options = {}) {
  const metadata = options.packageMetadata || packageMetadata();
  const env = options.env || process.env;
  const declared = metadata && metadata.mineradioBuild && typeof metadata.mineradioBuild === 'object'
    ? metadata.mineradioBuild
    : {};
  const channel = String(
    options.channel
      || declared.channel
      || env.MINERADIO_BUILD_CHANNEL
      || 'stable',
  ).trim().toLowerCase();
  if (options.channel && declared.channel
      && channel !== String(declared.channel).trim().toLowerCase()) {
    throw new Error('Explicit desktop channel disagrees with packaged build metadata');
  }
  const fallback = BUILD_IDENTITIES[channel];
  if (!fallback) throw new Error(`Unsupported Mineradio build channel: ${channel}`);

  const identity = {
    channel,
    productName: requireIdentityText(
      declared.productName || fallback.productName,
      'Desktop product name',
      /^[0-9A-Za-z][0-9A-Za-z ._-]{0,63}$/,
    ),
    appId: requireIdentityText(
      declared.appId || fallback.appId,
      'Desktop application ID',
      /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/,
    ),
    userDataRoot: requireIdentityText(
      declared.userDataRoot || fallback.userDataRoot,
      'Desktop user data root',
      /^[0-9A-Za-z][0-9A-Za-z _-]{0,63}$/,
    ),
  };
  if (/^(?:\.|\.\.)$/.test(identity.userDataRoot)) {
    throw new Error('Desktop user data root must be an owned directory name');
  }
  return Object.freeze(identity);
}

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

  const identity = options.identity || resolveDesktopBuildIdentity(options);
  app.setName(identity.productName);
  const userData = path.join(app.getPath('appData'), identity.userDataRoot);
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
  resolveDesktopBuildIdentity,
};
