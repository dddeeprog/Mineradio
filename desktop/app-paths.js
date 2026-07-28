'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_OWNED_DATA_FILE_SIZE = 16 * 1024 * 1024;

const APP_OWNED_DATA_FILES = Object.freeze([
  '.cookie',
  '.qq-cookie',
  '.kugou-cookie',
  '.qishui-cookie',
  '.qishui-token',
  '.spotify-token.json',
  'platform-credentials.bin',
  'platform-cache.json',
  'listen-sync-journal.json',
  'desktop-shell-settings.json',
  'desktop-ui-state.json',
]);

function configureStableAppPaths(app, options = {}) {
  const createDirectory = options.createDirectory
    || (directory => fs.mkdirSync(directory, { recursive: true }));

  app.setName('Mineradio');
  const userData = path.join(app.getPath('appData'), 'Mineradio');
  createDirectory(userData);
  app.setPath('userData', userData);

  return {
    userData,
    credentials: path.join(userData, 'platform-credentials.bin'),
    platformCache: path.join(userData, 'platform-cache.json'),
    listenJournal: path.join(userData, 'listen-sync-journal.json'),
  };
}

function normalizePathForComparison(filePath, pathModule = path) {
  const resolved = pathModule.resolve(filePath);
  return pathModule.sep === '\\' ? resolved.toLowerCase() : resolved;
}

function pathsAreEqual(left, right, pathModule = path) {
  return normalizePathForComparison(left, pathModule)
    === normalizePathForComparison(right, pathModule);
}

function resolveOwnedDataFile(root, fileName, pathModule = path) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('Owned data root must be a non-empty string');
  }
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new TypeError('Owned data file name must be a non-empty string');
  }

  const resolvedRoot = pathModule.resolve(root);
  const resolvedFile = pathModule.resolve(resolvedRoot, fileName);
  if (!pathsAreEqual(pathModule.dirname(resolvedFile), resolvedRoot, pathModule)) {
    throw new Error(`Owned data file must be a direct child of its root: ${fileName}`);
  }
  return resolvedFile;
}

function readFileStats(file, statFile) {
  try {
    return statFile(file);
  } catch (_error) {
    return null;
  }
}

function isValidOwnedFileStats(stats) {
  if (!stats) return false;
  const isFile = typeof stats.isFile === 'function' ? stats.isFile() : stats.isFile === true;
  return isFile
    && Number.isFinite(stats.size)
    && stats.size > 0
    && stats.size <= MAX_OWNED_DATA_FILE_SIZE
    && Number.isFinite(stats.mtimeMs);
}

function validOwnedFile(fileName, file, statFile, validateFile) {
  const stats = readFileStats(file, statFile);
  if (!isValidOwnedFileStats(stats)) return null;
  try {
    return validateFile(fileName, file, stats) ? stats : null;
  } catch (_error) {
    return null;
  }
}

function defaultStatFile(file) {
  try {
    return fs.lstatSync(file);
  } catch (_error) {
    return null;
  }
}

function createAtomicTemporaryPath(target) {
  const directory = path.dirname(target);
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return path.join(directory, `.${path.basename(target)}.${suffix}.tmp`);
}

function copyFileAtomic(source, target, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(target);
  if (pathsAreEqual(resolvedSource, resolvedTarget)) {
    throw new Error('Atomic copy source and target must differ');
  }

  const targetDirectory = path.dirname(resolvedTarget);
  const temporaryFile = createAtomicTemporaryPath(resolvedTarget);
  if (!pathsAreEqual(path.dirname(temporaryFile), targetDirectory)) {
    throw new Error('Atomic copy temporary file must share the target directory');
  }

  let descriptor = null;
  try {
    const sourceStats = fileSystem.statSync(resolvedSource);
    if (!isValidOwnedFileStats(sourceStats)) {
      throw new Error('Atomic copy source is not a valid owned data file');
    }

    fileSystem.copyFileSync(
      resolvedSource,
      temporaryFile,
      fs.constants.COPYFILE_EXCL,
    );
    descriptor = fileSystem.openSync(temporaryFile, 'r+');
    try {
      fileSystem.fsyncSync(descriptor);
    } finally {
      fileSystem.closeSync(descriptor);
      descriptor = null;
    }

    const copiedStats = fileSystem.statSync(temporaryFile);
    if (!copiedStats || copiedStats.size !== sourceStats.size) {
      throw new Error('Atomic copy size mismatch');
    }

    fileSystem.renameSync(temporaryFile, resolvedTarget);
    return resolvedTarget;
  } catch (error) {
    if (descriptor != null) {
      try {
        fileSystem.closeSync(descriptor);
      } catch (_closeError) {
        // Preserve the original copy error.
      }
    }
    try {
      fileSystem.unlinkSync(temporaryFile);
    } catch (_cleanupError) {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function migrateOwnedDataFiles(options = {}) {
  const pathModule = options.pathModule || path;
  const targetRoot = pathModule.resolve(options.targetRoot);
  const sourceRoots = (options.sourceRoots || []).map(root => pathModule.resolve(root));
  const statFile = options.statFile || defaultStatFile;
  const validateFile = options.validateFile || (() => true);
  const atomicCopy = options.copyFileAtomic || copyFileAtomic;
  const copied = [];

  for (const fileName of APP_OWNED_DATA_FILES) {
    const target = resolveOwnedDataFile(targetRoot, fileName, pathModule);
    let selectedStats = validOwnedFile(fileName, target, statFile, validateFile);
    let selectedPath = selectedStats ? target : '';

    for (const sourceRoot of sourceRoots) {
      if (pathsAreEqual(sourceRoot, targetRoot, pathModule)) continue;
      const source = resolveOwnedDataFile(sourceRoot, fileName, pathModule);
      const sourceStats = validOwnedFile(fileName, source, statFile, validateFile);
      if (!sourceStats) continue;
      if (!selectedStats || sourceStats.mtimeMs > selectedStats.mtimeMs) {
        selectedStats = sourceStats;
        selectedPath = source;
      }
    }

    if (!selectedPath || pathsAreEqual(selectedPath, target, pathModule)) continue;
    atomicCopy(selectedPath, target);
    copied.push(fileName);
  }

  return copied;
}

module.exports = {
  APP_OWNED_DATA_FILES,
  MAX_OWNED_DATA_FILE_SIZE,
  configureStableAppPaths,
  copyFileAtomic,
  isValidOwnedFileStats,
  migrateOwnedDataFiles,
  pathsAreEqual,
  resolveOwnedDataFile,
};
