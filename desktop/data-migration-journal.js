'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const lockfile = require('proper-lockfile');

const DATA_MIGRATION_SCHEMA = 'mineradio-data-migration-v1';
const MAX_MIGRATION_FILE_SIZE = 16 * 1024 * 1024;
const JOURNAL_FILE_NAME = 'data-migration-v1.json';
const ENTRY_STATUS = Object.freeze({
  PENDING: 'pending',
  SOURCE_REMOVAL_PENDING: 'source-removal-pending',
  COMPLETE: 'complete',
});
const FIXED_MANIFEST_METADATA = new WeakMap();
const IDENTITY_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function createMigrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createCorruptJournalError() {
  return createMigrationError(
    'DATA_MIGRATION_JOURNAL_CORRUPT',
    'Data migration journal is corrupt',
  );
}

function createJournalWriteError() {
  return createMigrationError(
    'DATA_MIGRATION_JOURNAL_WRITE_FAILED',
    'Data migration journal could not be written',
  );
}

function normalizePath(filePath) {
  const resolved = path.resolve(filePath);
  return path.sep === '\\' ? resolved.toLowerCase() : resolved;
}

function pathsEqual(left, right) {
  return normalizePath(left) === normalizePath(right);
}

function assertAbsolutePath(filePath, label) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError(`${label} must be absolute`);
  }
  return path.resolve(filePath);
}

function assertStableLayoutPath(root, filePath, relativePath, label) {
  const resolved = assertAbsolutePath(filePath, label);
  const expected = path.join(root, ...relativePath);
  if (!pathsEqual(resolved, expected)) {
    throw new Error(`${label} must use the stable layout`);
  }
  return resolved;
}

function createDefaultMigrationManifest(paths) {
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new TypeError('Stable application paths are required');
  }

  const userData = assertAbsolutePath(paths.userData, 'Stable user data path');
  const credentials = assertStableLayoutPath(
    userData,
    paths.credentials,
    ['credentials', 'platform-credentials.bin'],
    'Credential path',
  );
  const platformCache = assertStableLayoutPath(
    userData,
    paths.platformCache,
    ['platform-cache', 'platform-cache.json'],
    'Platform cache path',
  );
  const listenJournal = assertStableLayoutPath(
    userData,
    paths.listenJournal,
    ['journal', 'listen-sync-journal.json'],
    'Listen journal path',
  );

  const manifest = Object.freeze([
    Object.freeze({
      id: 'encrypted-credentials',
      kind: 'file',
      sourceName: 'platform-credentials.bin',
      targetPath: credentials,
    }),
    Object.freeze({
      id: 'platform-cache',
      kind: 'file',
      sourceName: 'platform-cache.json',
      targetPath: platformCache,
    }),
    Object.freeze({
      id: 'listen-sync-journal',
      kind: 'file',
      sourceName: 'listen-sync-journal.json',
      targetPath: listenJournal,
    }),
    Object.freeze({
      id: 'desktop-shell-settings',
      kind: 'file',
      sourceName: 'desktop-shell-settings.json',
      targetPath: path.join(userData, 'desktop-shell-settings.json'),
    }),
    Object.freeze({
      id: 'desktop-ui-state',
      kind: 'file',
      sourceName: 'desktop-ui-state.json',
      targetPath: path.join(userData, 'desktop-ui-state.json'),
    }),
    Object.freeze({
      id: 'netease-cookie',
      kind: 'credential-import',
      sourceName: '.cookie',
      provider: 'netease',
    }),
    Object.freeze({
      id: 'qq-cookie',
      kind: 'credential-import',
      sourceName: '.qq-cookie',
      provider: 'qq',
    }),
  ]);

  FIXED_MANIFEST_METADATA.set(manifest, Object.freeze({ userData }));
  return manifest;
}

function requireFixedManifest(manifest) {
  const metadata = FIXED_MANIFEST_METADATA.get(manifest);
  if (!metadata) {
    throw new TypeError('Migration requires the fixed allowlist manifest');
  }
  return metadata;
}

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createRuntimeEntries(manifest, sourceRoots) {
  const entries = [];
  const ids = new Set();
  for (const entry of manifest) {
    if (ids.has(entry.id)) {
      throw new Error('Migration manifest contains a duplicate entry id');
    }
    ids.add(entry.id);
    if (entry.kind === 'file') {
      entries.push(Object.freeze({
        id: entry.id,
        kind: entry.kind,
        sourceName: entry.sourceName,
        targetPath: entry.targetPath,
      }));
      continue;
    }

    const sources = sourceRoots.map(sourceRoot => Object.freeze({
      sourceId: hashIdentifier(normalizePath(sourceRoot)),
      sourcePath: path.join(sourceRoot, entry.sourceName),
    }));
    entries.push(Object.freeze({
      id: entry.id,
      kind: entry.kind,
      sourceName: entry.sourceName,
      provider: entry.provider,
      sources: Object.freeze(sources),
    }));
  }
  return Object.freeze(entries);
}
const PROCESS_MIGRATION_QUEUES = new Map();

function enqueueMigrationOperation(filePath, operation) {
  const key = normalizePath(filePath);
  const previous = PROCESS_MIGRATION_QUEUES.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  PROCESS_MIGRATION_QUEUES.set(key, next);
  const cleanup = () => {
    if (PROCESS_MIGRATION_QUEUES.get(key) === next) {
      PROCESS_MIGRATION_QUEUES.delete(key);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}
function timestamp(now) {
  const value = now();
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Migration journal clock must return a timestamp string');
  }
  return value;
}

function createInitialState(runtimeEntries, now) {
  const entries = Object.create(null);
  for (const entry of runtimeEntries) {
    entries[entry.id] = { status: ENTRY_STATUS.PENDING };
  }
  return {
    schema: DATA_MIGRATION_SCHEMA,
    entries,
    updatedAt: timestamp(now),
  };
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every(key => Object.hasOwn(value, key));
}

function selectedEntryPrefix(entry) {
  return `${entry.id}-source-`;
}

function resolveEntryState(entries, entry, options = {}) {
  if (Object.hasOwn(entries, entry.id)) {
    const record = entries[entry.id];
    if (!hasExactKeys(record, ['status'])
      || ![ENTRY_STATUS.PENDING, ENTRY_STATUS.COMPLETE].includes(record.status)) {
      if (options.corrupt) throw createCorruptJournalError();
      throw new Error('Migration journal state is invalid');
    }
    return {
      key: entry.id,
      status: record.status,
      sourceId: null,
      migrationId: null,
    };
  }

  if (entry.kind !== 'credential-import') {
    if (options.corrupt) throw createCorruptJournalError();
    throw new Error('Migration journal state is invalid');
  }
  const prefix = selectedEntryPrefix(entry);
  const matchingKeys = Object.keys(entries).filter(key => key.startsWith(prefix));
  if (matchingKeys.length !== 1) {
    if (options.corrupt) throw createCorruptJournalError();
    throw new Error('Migration journal state is invalid');
  }
  const key = matchingKeys[0];
  const sourceId = key.slice(prefix.length);
  const record = entries[key];
  const sourceExists = entry.sources.some(source => source.sourceId === sourceId);
  const requiresMigrationId = [
    ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
    ENTRY_STATUS.COMPLETE,
  ].includes(record && record.status);
  const validRecord = requiresMigrationId
    ? hasExactKeys(record, ['status', 'migrationId'])
      && IDENTITY_TOKEN_PATTERN.test(record.migrationId)
    : hasExactKeys(record, ['status']);
  if (!IDENTITY_TOKEN_PATTERN.test(sourceId)
    || !sourceExists
    || !validRecord
    || ![
      ENTRY_STATUS.PENDING,
      ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
      ENTRY_STATUS.COMPLETE,
    ].includes(record.status)) {
    if (options.corrupt) throw createCorruptJournalError();
    throw new Error('Migration journal state is invalid');
  }
  return {
    key,
    status: record.status,
    sourceId,
    migrationId: requiresMigrationId ? record.migrationId : null,
  };
}
function validateJournalState(value, runtimeEntries) {
  if (!hasExactKeys(value, ['schema', 'entries', 'updatedAt'])
    || value.schema !== DATA_MIGRATION_SCHEMA
    || typeof value.updatedAt !== 'string'
    || value.updatedAt.length === 0
    || !value.entries
    || typeof value.entries !== 'object'
    || Array.isArray(value.entries)) {
    throw createCorruptJournalError();
  }

  const consumedKeys = new Set();
  const entries = Object.create(null);
  for (const runtimeEntry of runtimeEntries) {
    const resolved = resolveEntryState(value.entries, runtimeEntry, { corrupt: true });
    if (consumedKeys.has(resolved.key)) throw createCorruptJournalError();
    consumedKeys.add(resolved.key);
    entries[resolved.key] = { status: resolved.status };
    if (resolved.migrationId) {
      entries[resolved.key].migrationId = resolved.migrationId;
    }
  }
  if (consumedKeys.size !== Object.keys(value.entries).length) {
    throw createCorruptJournalError();
  }

  return {
    schema: DATA_MIGRATION_SCHEMA,
    entries,
    updatedAt: value.updatedAt,
  };
}

function readJournalState(filePath, runtimeEntries, fileSystem, now) {
  try {
    const stats = lstatOrMissing(filePath, fileSystem);
    if (!stats) return createInitialState(runtimeEntries, now);
    if (!isSafePathStats(stats)
      || (Number.isFinite(stats.nlink) && stats.nlink !== 1)) {
      throw createMigrationError(
        'DATA_MIGRATION_PATH_UNSAFE',
        'Migration journal must be one regular unlinked file',
      );
    }
    const journalRead = readBoundedRegularFile(
      filePath,
      fileSystem,
      'DATA_MIGRATION_JOURNAL_CORRUPT',
      'Data migration journal is corrupt',
    );
    if (Number.isFinite(journalRead.stats.nlink) && journalRead.stats.nlink !== 1) {
      throw createMigrationError(
        'DATA_MIGRATION_PATH_UNSAFE',
        'Migration journal must be one regular unlinked file',
      );
    }
    return validateJournalState(
      JSON.parse(journalRead.value.toString('utf8')),
      runtimeEntries,
    );
  } catch (error) {
    if (error && [
      'DATA_MIGRATION_JOURNAL_CORRUPT',
      'DATA_MIGRATION_PATH_UNSAFE',
    ].includes(error.code)) {
      throw error;
    }
    throw createCorruptJournalError();
  }
}

function createTemporaryPath(filePath) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${suffix}.tmp`,
  );
}

function closeQuietly(fileSystem, descriptor) {
  if (descriptor == null) return;
  try {
    fileSystem.closeSync(descriptor);
  } catch (_error) {
    // Preserve the operation's stable error contract.
  }
}

function unlinkQuietly(fileSystem, filePath) {
  try {
    fileSystem.unlinkSync(filePath);
  } catch (_error) {
    // The path may not exist or may already have been published.
  }
}

function syncDirectory(directory, fileSystem) {
  let descriptor = null;
  try {
    descriptor = fileSystem.openSync(directory, fs.constants.O_RDONLY);
    fileSystem.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform === 'win32'
      && error
      && ['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      return;
    }
    throw error;
  } finally {
    closeQuietly(fileSystem, descriptor);
  }
}

function writeJournalAtomic(filePath, state, fileSystem, assertFence) {
  const temporaryFile = createTemporaryPath(filePath);
  let descriptor = null;
  try {
    const directory = path.dirname(filePath);
    assertDirectoryChainSafe(directory, fileSystem);
    fileSystem.mkdirSync(directory, { recursive: true });
    assertDirectoryChainSafe(directory, fileSystem);
    descriptor = fileSystem.openSync(temporaryFile, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, JSON.stringify(state));
    fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;
    assertFence();
    fileSystem.renameSync(temporaryFile, filePath);
    syncDirectory(directory, fileSystem);
  } catch (error) {
    closeQuietly(fileSystem, descriptor);
    unlinkQuietly(fileSystem, temporaryFile);
    if (error && [
      'DATA_MIGRATION_PATH_UNSAFE',
      'DATA_MIGRATION_LOCK_FAILED',
    ].includes(error.code)) throw error;
    throw createJournalWriteError();
  }
}

function lstatOrMissing(filePath, fileSystem) {
  try {
    return fileSystem.lstatSync(filePath);
  } catch (error) {
    if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
    throw createMigrationError(
      'DATA_MIGRATION_INSPECTION_FAILED',
      'Migration source or target could not be inspected',
    );
  }
}

function assertDirectoryChainSafe(directory, fileSystem) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const segments = path.relative(parsed.root, resolved)
    .split(path.sep)
    .filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = fileSystem.lstatSync(current);
    } catch (error) {
      if (error && ['ENOENT', 'ENOTDIR'].includes(error.code)) return;
      throw createMigrationError(
        'DATA_MIGRATION_PATH_UNSAFE',
        'Migration path could not be validated safely',
      );
    }
    if (!stats
      || typeof stats.isDirectory !== 'function'
      || !stats.isDirectory()
      || typeof stats.isSymbolicLink !== 'function'
      || stats.isSymbolicLink()) {
      throw createMigrationError(
        'DATA_MIGRATION_PATH_UNSAFE',
        'Migration path contains an unsafe linked ancestor',
      );
    }
  }
}
function isBoundedRegularFile(stats) {
  return Boolean(
    stats
    && typeof stats.isFile === 'function'
    && stats.isFile()
    && Number.isFinite(stats.size)
    && stats.size > 0
    && stats.size <= MAX_MIGRATION_FILE_SIZE,
  );
}

function isSafePathStats(stats) {
  return isBoundedRegularFile(stats)
    && typeof stats.isSymbolicLink === 'function'
    && !stats.isSymbolicLink();
}

function comparableStatValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Number.isFinite(value)) return String(value);
  return '';
}

function sameNodeIdentity(left, right) {
  if (!left || !right) return false;
  const leftDev = comparableStatValue(left.dev);
  const rightDev = comparableStatValue(right.dev);
  const leftIno = comparableStatValue(left.ino);
  const rightIno = comparableStatValue(right.ino);
  if (leftDev && rightDev && leftIno && rightIno
    && (leftDev !== '0' || rightDev !== '0' || leftIno !== '0' || rightIno !== '0')) {
    return leftDev === rightDev && leftIno === rightIno;
  }
  return Number.isFinite(left.birthtimeMs)
    && Number.isFinite(right.birthtimeMs)
    && left.birthtimeMs === right.birthtimeMs;
}

function createFencedLockFileSystem(fileSystem, lockPath, fence) {
  function ownsLock(candidate) {
    if (!pathsEqual(candidate, lockPath) || !fence.lockStats) return true;
    try {
      return sameNodeIdentity(fileSystem.lstatSync(candidate), fence.lockStats);
    } catch (_error) {
      return false;
    }
  }

  const lockFileSystem = Object.create(fileSystem);
  lockFileSystem.rmdir = (candidate, callback) => {
    if (!ownsLock(candidate)) {
      fence.compromised = true;
      queueMicrotask(() => callback(null));
      return;
    }
    fileSystem.rmdir(candidate, callback);
  };
  lockFileSystem.rmdirSync = (candidate) => {
    if (!ownsLock(candidate)) {
      fence.compromised = true;
      return;
    }
    fileSystem.rmdirSync(candidate);
  };
  return lockFileSystem;
}

function sameFileObject(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  const leftDev = comparableStatValue(left.dev);
  const rightDev = comparableStatValue(right.dev);
  const leftIno = comparableStatValue(left.ino);
  const rightIno = comparableStatValue(right.ino);
  if (leftDev && rightDev && leftIno && rightIno
    && (leftDev !== '0' || rightDev !== '0' || leftIno !== '0' || rightIno !== '0')) {
    return leftDev === rightDev && leftIno === rightIno;
  }
  return !Number.isFinite(left.mtimeMs)
    || !Number.isFinite(right.mtimeMs)
    || left.mtimeMs === right.mtimeMs;
}

function sameFileSnapshot(left, right) {
  if (!sameFileObject(left, right)) return false;
  for (const field of ['mtimeMs', 'ctimeMs']) {
    if (Number.isFinite(left[field])
      && Number.isFinite(right[field])
      && left[field] !== right[field]) {
      return false;
    }
  }
  return true;
}

function fileIdentityToken(stats) {
  return hashIdentifier(JSON.stringify([
    comparableStatValue(stats.dev),
    comparableStatValue(stats.ino),
    comparableStatValue(stats.size),
    comparableStatValue(stats.mtimeMs),
    comparableStatValue(stats.ctimeMs),
  ]));
}

function descriptorOpenFlags() {
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW)
    ? fs.constants.O_NOFOLLOW
    : 0;
  return fs.constants.O_RDONLY | noFollow;
}

function readDescriptorExact(descriptor, size, fileSystem) {
  const value = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = fileSystem.readSync(
      descriptor,
      value,
      offset,
      size - offset,
      offset,
    );
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) {
      throw new Error('Descriptor read was incomplete');
    }
    offset += bytesRead;
  }
  return value;
}

function readBoundedRegularFile(filePath, fileSystem, code, message) {
  let descriptor = null;
  assertDirectoryChainSafe(path.dirname(filePath), fileSystem);
  try {
    descriptor = fileSystem.openSync(filePath, descriptorOpenFlags());
    const openedStats = fileSystem.fstatSync(descriptor);
    if (!isBoundedRegularFile(openedStats)) {
      throw createMigrationError(code, message);
    }
    const value = readDescriptorExact(descriptor, openedStats.size, fileSystem);
    const finalStats = fileSystem.fstatSync(descriptor);
    const pathStats = lstatOrMissing(filePath, fileSystem);
    if (!isSafePathStats(pathStats)
      || !sameFileSnapshot(openedStats, finalStats)
      || !sameFileSnapshot(finalStats, pathStats)) {
      throw createMigrationError(code, message);
    }
    return {
      value,
      identity: fileIdentityToken(pathStats),
      stats: pathStats,
    };
  } catch (error) {
    if (error && error.code === code) throw error;
    throw createMigrationError(code, message);
  } finally {
    closeQuietly(fileSystem, descriptor);
  }
}

function findSourceFile(sourceRoots, sourceName, fileSystem) {
  for (const root of sourceRoots) {
    assertDirectoryChainSafe(root, fileSystem);
    const candidate = path.join(root, sourceName);
    const stats = lstatOrMissing(candidate, fileSystem);
    if (isSafePathStats(stats)) return candidate;
  }
  return null;
}

function hasSingleLink(stats) {
  return !Number.isFinite(stats && stats.nlink) || stats.nlink === 1;
}

function inspectTarget(targetPath, fileSystem) {
  assertDirectoryChainSafe(path.dirname(targetPath), fileSystem);
  const stats = lstatOrMissing(targetPath, fileSystem);
  if (!stats) return 'missing';
  return isSafePathStats(stats) && hasSingleLink(stats) ? 'valid' : 'blocked';
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function migrationStagingPath(target) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.mineradio-migration.pending`,
  );
}

function migrationStagingRetirementPath(staging) {
  return `${staging}.deleting`;
}

function migrationStagingRetirementPayload(staging) {
  return path.join(migrationStagingRetirementPath(staging), 'payload');
}

function isSafeMigrationDirectory(stats) {
  return Boolean(
    stats
    && typeof stats.isDirectory === 'function'
    && stats.isDirectory()
    && typeof stats.isSymbolicLink === 'function'
    && !stats.isSymbolicLink()
  );
}

function removeStagingRetirementPayload(
  staging,
  expectedStats,
  fileSystem,
  assertFence,
) {
  const retirement = migrationStagingRetirementPath(staging);
  const payload = migrationStagingRetirementPayload(staging);
  const payloadStats = lstatOrMissing(payload, fileSystem);
  if (!isSafePathStats(payloadStats)
    || !sameFileObject(payloadStats, expectedStats)) {
    return false;
  }
  try {
    assertFence();
    fileSystem.unlinkSync(payload);
    syncDirectory(retirement, fileSystem);
    fileSystem.rmdirSync(retirement);
    syncDirectory(path.dirname(staging), fileSystem);
  } catch (_error) {
    return false;
  }
  return !lstatOrMissing(retirement, fileSystem);
}

function retireMigrationStaging(staging, expectedStats, fileSystem, assertFence) {
  let currentStats = lstatOrMissing(staging, fileSystem);
  if (!currentStats || !sameFileObject(currentStats, expectedStats)) return false;
  const retirement = migrationStagingRetirementPath(staging);
  const payload = migrationStagingRetirementPayload(staging);
  let retirementStats = lstatOrMissing(retirement, fileSystem);
  if (!retirementStats) {
    try {
      assertFence();
      fileSystem.mkdirSync(retirement);
    } catch (_error) {
      return false;
    }
    retirementStats = lstatOrMissing(retirement, fileSystem);
  }
  if (!isSafeMigrationDirectory(retirementStats)
    || lstatOrMissing(payload, fileSystem)) {
    return false;
  }
  currentStats = lstatOrMissing(staging, fileSystem);
  if (!currentStats || !sameFileObject(currentStats, expectedStats)) return false;
  try {
    assertFence();
    fileSystem.renameSync(staging, payload);
    syncDirectory(path.dirname(staging), fileSystem);
  } catch (_error) {
    return false;
  }
  if (lstatOrMissing(staging, fileSystem)) return false;
  return removeStagingRetirementPayload(
    staging,
    expectedStats,
    fileSystem,
    assertFence,
  );
}

function recoverRetiredMigrationStaging(
  source,
  target,
  staging,
  fileSystem,
  assertFence,
) {
  const retirement = migrationStagingRetirementPath(staging);
  const payload = migrationStagingRetirementPayload(staging);
  const retirementStats = lstatOrMissing(retirement, fileSystem);
  if (!retirementStats) return 'none';
  if (!isSafeMigrationDirectory(retirementStats)) return 'blocked';
  const payloadStats = lstatOrMissing(payload, fileSystem);
  if (!payloadStats) {
    try {
      assertFence();
      fileSystem.rmdirSync(retirement);
      syncDirectory(path.dirname(staging), fileSystem);
      return 'none';
    } catch (_error) {
      return 'blocked';
    }
  }
  if (!isSafePathStats(payloadStats)) return 'blocked';
  const targetStats = lstatOrMissing(target, fileSystem);
  if (targetStats) {
    if (!sameFileObject(payloadStats, targetStats)) return 'blocked';
    const payloadRead = readMigrationPayload(payload, fileSystem);
    if (!removeStagingRetirementPayload(
      staging,
      payloadStats,
      fileSystem,
      assertFence,
    )) return 'blocked';
    const recoveredTarget = readMigrationPayload(target, fileSystem);
    return hasSingleLink(recoveredTarget.stats)
      && digest(recoveredTarget.value) === digest(payloadRead.value)
      ? 'recovered'
      : 'blocked';
  }
  if (!source || !hasSingleLink(payloadStats)) return 'blocked';
  const sourceRead = readMigrationPayload(source, fileSystem);
  const payloadRead = readMigrationPayload(payload, fileSystem);
  if (digest(sourceRead.value) !== digest(payloadRead.value)) return 'blocked';
  return removeStagingRetirementPayload(
    staging,
    payloadStats,
    fileSystem,
    assertFence,
  ) ? 'none' : 'blocked';
}

function readMigrationPayload(filePath, fileSystem) {
  return readBoundedRegularFile(
    filePath,
    fileSystem,
    'DATA_MIGRATION_COPY_FAILED',
    'Migration file could not be copied',
  );
}

function recoverMigrationFilePublication(source, target, fileSystem, assertFence) {
  assertFence();
  const staging = migrationStagingPath(target);
  const stagingStats = lstatOrMissing(staging, fileSystem);
  if (!stagingStats) {
    return recoverRetiredMigrationStaging(
      source,
      target,
      staging,
      fileSystem,
      assertFence,
    );
  }
  if (!isSafePathStats(stagingStats)) return 'blocked';

  const targetStats = lstatOrMissing(target, fileSystem);
  if (targetStats && sameFileObject(stagingStats, targetStats)) {
    const stagingRead = readMigrationPayload(staging, fileSystem);
    try {
      assertFence();
      const currentStagingStats = lstatOrMissing(staging, fileSystem);
      const currentTargetStats = lstatOrMissing(target, fileSystem);
      if (!sameFileSnapshot(currentStagingStats, stagingRead.stats)
        || !sameFileObject(currentStagingStats, currentTargetStats)
        || !retireMigrationStaging(
          staging,
          currentStagingStats,
          fileSystem,
          assertFence,
        )) {
        return 'blocked';
      }
    } catch (_error) {
      return 'blocked';
    }
    const recoveredTarget = readMigrationPayload(target, fileSystem);
    return hasSingleLink(recoveredTarget.stats)
      && digest(recoveredTarget.value) === digest(stagingRead.value)
      ? 'recovered'
      : 'blocked';
  }

  if (targetStats) {
    if (inspectTarget(target, fileSystem) !== 'valid'
      || !hasSingleLink(stagingStats)) {
      return 'blocked';
    }
    const targetRead = readMigrationPayload(target, fileSystem);
    const stagingRead = readMigrationPayload(staging, fileSystem);
    if (digest(targetRead.value) !== digest(stagingRead.value)) return 'blocked';
    if (!retireMigrationStaging(
      staging,
      stagingRead.stats,
      fileSystem,
      assertFence,
    )) return 'blocked';
    return 'target';
  }

  if (!source || !hasSingleLink(stagingStats)) return 'blocked';
  const sourceRead = readMigrationPayload(source, fileSystem);
  const stagingRead = readMigrationPayload(staging, fileSystem);
  if (digest(sourceRead.value) !== digest(stagingRead.value)) return 'blocked';
  try {
    assertFence();
    fileSystem.linkSync(staging, target);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return recoverMigrationFilePublication(
        source,
        target,
        fileSystem,
        assertFence,
      );
    }
    throw createMigrationError(
      'DATA_MIGRATION_COPY_FAILED',
      'Migration file could not be copied',
    );
  }
  const publishedStats = lstatOrMissing(target, fileSystem);
  if (!isSafePathStats(publishedStats)
    || !sameFileObject(stagingStats, publishedStats)) {
    return 'blocked';
  }
  if (!retireMigrationStaging(
    staging,
    publishedStats,
    fileSystem,
    assertFence,
  )) return 'blocked';
  const recoveredTarget = readMigrationPayload(target, fileSystem);
  return hasSingleLink(recoveredTarget.stats)
    && digest(recoveredTarget.value) === digest(sourceRead.value)
    ? 'recovered'
    : 'blocked';
}

function cleanupOwnedStaging(staging, ownedStats, fileSystem, assertFence) {
  if (!ownedStats) return;
  try {
    assertFence();
    const currentStats = lstatOrMissing(staging, fileSystem);
    if (!currentStats || !sameFileObject(currentStats, ownedStats)) return;
    retireMigrationStaging(staging, currentStats, fileSystem, assertFence);
  } catch (_error) {
    // Recovery owns deterministic staging cleanup on the next locked run.
  }
}

function writeMigrationFileAtomic(source, target, fileSystem, assertFence) {
  const staging = migrationStagingPath(target);
  let descriptor = null;
  let published = false;
  let stagingOwned = false;
  let ownedStats = null;
  const recovery = recoverMigrationFilePublication(
    source,
    target,
    fileSystem,
    assertFence,
  );
  if (recovery === 'recovered' || recovery === 'target') return false;
  if (recovery === 'blocked') {
    throw createMigrationError(
      'DATA_MIGRATION_COPY_FAILED',
      'Migration file could not be copied',
    );
  }

  try {
    const sourceRead = readMigrationPayload(source, fileSystem);
    const directory = path.dirname(target);
    assertDirectoryChainSafe(directory, fileSystem);
    assertFence();
    fileSystem.mkdirSync(directory, { recursive: true });
    assertDirectoryChainSafe(directory, fileSystem);
    assertFence();
    descriptor = fileSystem.openSync(staging, 'wx+', 0o600);
    stagingOwned = true;
    fileSystem.writeFileSync(descriptor, sourceRead.value);
    fileSystem.fsyncSync(descriptor);

    const stagingStats = fileSystem.fstatSync(descriptor);
    ownedStats = stagingStats;
    if (!isBoundedRegularFile(stagingStats)
      || !hasSingleLink(stagingStats)
      || stagingStats.size !== sourceRead.value.length) {
      throw new Error('Staged migration file is invalid');
    }
    const stagedValue = readDescriptorExact(descriptor, stagingStats.size, fileSystem);
    if (digest(stagedValue) !== digest(sourceRead.value)) {
      throw new Error('Staged migration file could not be verified');
    }

    try {
      assertFence();
      fileSystem.linkSync(staging, target);
      published = true;
    } catch (error) {
      if (error && error.code === 'EEXIST') return false;
      throw error;
    }

    const finalStagingStats = fileSystem.fstatSync(descriptor);
    ownedStats = finalStagingStats;
    const targetStats = lstatOrMissing(target, fileSystem);
    if (!isSafePathStats(targetStats)
      || !sameFileObject(finalStagingStats, targetStats)) {
      throw new Error('Published migration target identity mismatch');
    }
    const publishedValue = readDescriptorExact(
      descriptor,
      finalStagingStats.size,
      fileSystem,
    );
    if (!sameFileObject(stagingStats, finalStagingStats)
      || digest(publishedValue) !== digest(sourceRead.value)) {
      throw new Error('Published migration target content mismatch');
    }

    fileSystem.closeSync(descriptor);
    descriptor = null;
    if (!retireMigrationStaging(
      staging,
      finalStagingStats,
      fileSystem,
      assertFence,
    )) {
      throw new Error('Published migration staging could not be retired');
    }

    const finalTarget = readMigrationPayload(target, fileSystem);
    if (!hasSingleLink(finalTarget.stats)
      || digest(finalTarget.value) !== digest(sourceRead.value)) {
      throw new Error('Published migration target could not be finalized');
    }
    syncDirectory(directory, fileSystem);
    return true;
  } catch (error) {
    if (error && [
      'DATA_MIGRATION_COPY_FAILED',
      'DATA_MIGRATION_LOCK_FAILED',
      'DATA_MIGRATION_PATH_UNSAFE',
    ].includes(error.code)) throw error;
    throw createMigrationError(
      'DATA_MIGRATION_COPY_FAILED',
      'Migration file could not be copied',
    );
  } finally {
    if (stagingOwned && descriptor != null) {
      try {
        ownedStats = fileSystem.fstatSync(descriptor);
      } catch (_error) {
        // Preserve the operation error and leave staging for recovery.
      }
    }
    closeQuietly(fileSystem, descriptor);
    if (!published && stagingOwned) {
      cleanupOwnedStaging(staging, ownedStats, fileSystem, assertFence);
    }
  }
}
function createDataMigrationJournal(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const now = options.now || (() => new Date().toISOString());
  const manifestMetadata = requireFixedManifest(options.manifest);
  const filePath = assertAbsolutePath(options.filePath, 'Migration journal file path');
  const expectedJournalPath = path.join(
    manifestMetadata.userData,
    'journal',
    JOURNAL_FILE_NAME,
  );
  if (!pathsEqual(filePath, expectedJournalPath)) {
    throw new Error('Migration journal path must use the stable layout');
  }
  if (!Array.isArray(options.sourceRoots)
    || options.sourceRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) {
    throw new TypeError('Migration source roots must be absolute paths');
  }
  if (typeof now !== 'function') {
    throw new TypeError('Migration journal clock must be a function');
  }

  const resolvedSourceRoots = options.sourceRoots.map(root => path.resolve(root));
  const uniqueSourceRoots = new Set(resolvedSourceRoots.map(normalizePath));
  if (uniqueSourceRoots.size !== resolvedSourceRoots.length) {
    throw new Error('Migration source roots contain a duplicate source root');
  }
  const sourceRoots = Object.freeze(resolvedSourceRoots);
  const guardedDirectories = [
    manifestMetadata.userData,
    path.dirname(filePath),
    ...sourceRoots,
    ...options.manifest
      .filter(entry => entry.kind === 'file')
      .map(entry => path.dirname(entry.targetPath)),
  ];
  const guardedDirectoryKeys = new Set();
  for (const directory of guardedDirectories) {
    const key = normalizePath(directory);
    if (guardedDirectoryKeys.has(key)) continue;
    guardedDirectoryKeys.add(key);
    assertDirectoryChainSafe(directory, fileSystem);
  }
  const runtimeEntries = createRuntimeEntries(options.manifest, sourceRoots);
  let state = readJournalState(filePath, runtimeEntries, fileSystem, now);
  let activeFence = null;

  function lockError(message) {
    return createMigrationError('DATA_MIGRATION_LOCK_FAILED', message);
  }

  function assertMigrationFence() {
    if (!activeFence || activeFence.compromised) {
      throw lockError('Data migration lock is no longer owned');
    }
    try {
      const currentLockStats = fileSystem.lstatSync(activeFence.lockPath);
      if (!currentLockStats
        || typeof currentLockStats.isDirectory !== 'function'
        || !currentLockStats.isDirectory()
        || (typeof currentLockStats.isSymbolicLink === 'function'
          && currentLockStats.isSymbolicLink())
        || !sameNodeIdentity(currentLockStats, activeFence.lockStats)) {
        activeFence.compromised = true;
        throw lockError('Data migration lock is no longer owned');
      }
    } catch (error) {
      activeFence.compromised = true;
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      throw lockError('Data migration lock is no longer owned');
    }
  }
  function runExclusive(operation) {
    return enqueueMigrationOperation(filePath, async () => {
      let release = null;
      let operationError = null;
      const lockPath = `${filePath}.lock`;
      const fence = {
        compromised: false,
        lockPath,
        lockStats: null,
      };
      const lockFileSystem = createFencedLockFileSystem(
        fileSystem,
        lockPath,
        fence,
      );
      try {
        release = await lockfile.lock(filePath, {
          fs: lockFileSystem,
          lockfilePath: lockPath,
          onCompromised: () => { fence.compromised = true; },
          realpath: false,
          retries: {
            factor: 1,
            maxTimeout: 50,
            minTimeout: 10,
            retries: 50,
          },
          stale: 30_000,
          update: 10_000,
        });
        fence.lockStats = fileSystem.lstatSync(lockPath);
      } catch (_error) {
        if (release) {
          try { await release(); } catch (_releaseError) {}
        }
        throw lockError('Data migration lock could not be acquired');
      }

      activeFence = fence;
      try {
        assertMigrationFence();
        state = readJournalState(filePath, runtimeEntries, fileSystem, now);
        const result = await operation();
        assertMigrationFence();
        return result;
      } catch (error) {
        operationError = error;
        throw error;
      } finally {
        let shouldRelease = false;
        if (activeFence === fence) {
          try {
            assertMigrationFence();
            shouldRelease = true;
          } catch (_error) {
            fence.compromised = true;
          }
          activeFence = null;
        }
        if (shouldRelease) {
          try {
            await release();
          } catch (_error) {
            if (!operationError) {
              throw lockError('Data migration lock could not be released');
            }
          }
        }
      }
    });
  }
  function updateStatus(
    entry,
    nextStatus,
    sourceId = null,
    migrationId = null,
  ) {
    assertMigrationFence();
    const current = resolveEntryState(state.entries, entry);
    const usesSelectedSource = entry.kind === 'credential-import'
      && sourceId != null;
    const requiresMigrationId = usesSelectedSource
      && [
        ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
        ENTRY_STATUS.COMPLETE,
      ].includes(nextStatus);
    if (usesSelectedSource
      && (!IDENTITY_TOKEN_PATTERN.test(sourceId)
        || !entry.sources.some(source => source.sourceId === sourceId)
        || ![
          ENTRY_STATUS.PENDING,
          ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
          ENTRY_STATUS.COMPLETE,
        ].includes(nextStatus))) {
      throw new Error('Credential migration state requires a known source');
    }
    if (requiresMigrationId !== IDENTITY_TOKEN_PATTERN.test(migrationId || '')) {
      throw new Error('Credential migration state requires a verified migration id');
    }
    if (!usesSelectedSource
      && (migrationId != null
        || ![ENTRY_STATUS.PENDING, ENTRY_STATUS.COMPLETE].includes(nextStatus))) {
      throw new Error('Migration journal state transition is invalid');
    }
    const nextKey = usesSelectedSource
      ? `${selectedEntryPrefix(entry)}${sourceId}`
      : entry.id;
    if (current.key === nextKey
      && current.status === nextStatus
      && current.migrationId === migrationId) return;

    const entries = Object.create(null);
    for (const [key, record] of Object.entries(state.entries)) {
      if (key !== current.key) entries[key] = { ...record };
    }
    if (Object.hasOwn(entries, nextKey)) {
      throw new Error('Migration journal state id collision');
    }
    entries[nextKey] = { status: nextStatus };
    if (requiresMigrationId) entries[nextKey].migrationId = migrationId;
    const nextState = {
      schema: DATA_MIGRATION_SCHEMA,
      entries,
      updatedAt: timestamp(now),
    };
    writeJournalAtomic(filePath, nextState, fileSystem, assertMigrationFence);
    state = nextState;
  }

  async function resumeFilesUnlocked() {
    for (const entry of runtimeEntries) {
      if (entry.kind !== 'file') continue;
      const current = resolveEntryState(state.entries, entry);
      const source = findSourceFile(sourceRoots, entry.sourceName, fileSystem);
      const recovery = recoverMigrationFilePublication(
        source,
        entry.targetPath,
        fileSystem,
        assertMigrationFence,
      );
      const targetState = inspectTarget(entry.targetPath, fileSystem);
      if (recovery === 'blocked') {
        if (current.status === ENTRY_STATUS.COMPLETE) {
          updateStatus(entry, ENTRY_STATUS.PENDING);
        }
        continue;
      }
      if (targetState === 'valid') {
        if (current.status !== ENTRY_STATUS.COMPLETE) {
          updateStatus(entry, ENTRY_STATUS.COMPLETE);
        }
        continue;
      }
      if (current.status === ENTRY_STATUS.COMPLETE) {
        updateStatus(entry, ENTRY_STATUS.PENDING);
      }
      if (targetState === 'blocked' || !source) continue;

      const wasPublished = writeMigrationFileAtomic(
        source,
        entry.targetPath,
        fileSystem,
        assertMigrationFence,
      );
      const finalTargetState = inspectTarget(entry.targetPath, fileSystem);
      if (wasPublished || finalTargetState === 'valid') {
        updateStatus(entry, ENTRY_STATUS.COMPLETE);
      }
    }
    return status();
  }
  function sourceForId(entry, sourceId) {
    return entry.sources.find(source => source.sourceId === sourceId) || null;
  }

  function credentialQuarantinePath(entry, source) {
    return path.join(
      path.dirname(source.sourcePath),
      `.${path.basename(source.sourcePath)}.mineradio-removal-${hashIdentifier(`${entry.id}:${source.sourceId}`)}.pending`,
    );
  }

  function credentialTombstonePath(entry, source) {
    return `${credentialQuarantinePath(entry, source)}.deleting`;
  }

  function credentialRemovalPaths(entry, source) {
    return [
      credentialQuarantinePath(entry, source),
      credentialTombstonePath(entry, source),
    ];
  }

  function moveCredentialSourceNoReplace(sourcePath, destinationPath) {
    try {
      assertMigrationFence();
      fileSystem.linkSync(sourcePath, destinationPath);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      return false;
    }
    const linkedSourceStats = lstatOrMissing(sourcePath, fileSystem);
    const linkedDestinationStats = lstatOrMissing(destinationPath, fileSystem);
    if (!isSafePathStats(linkedSourceStats)
      || !isSafePathStats(linkedDestinationStats)
      || !sameFileObject(linkedSourceStats, linkedDestinationStats)) {
      return false;
    }
    try {
      assertMigrationFence();
      fileSystem.renameSync(sourcePath, destinationPath);
      syncDirectory(path.dirname(sourcePath), fileSystem);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      return false;
    }
    return !lstatOrMissing(sourcePath, fileSystem)
      && sameFileObject(
        linkedDestinationStats,
        lstatOrMissing(destinationPath, fileSystem),
      );
  }

  function selectCredentialSource(entry) {
    const candidates = [];
    for (const source of entry.sources) {
      const stats = lstatOrMissing(source.sourcePath, fileSystem);
      if (isSafePathStats(stats)) candidates.push({ source, stats });
    }
    candidates.sort((left, right) => {
      const leftTime = Number.isFinite(left.stats.mtimeMs) ? left.stats.mtimeMs : 0;
      const rightTime = Number.isFinite(right.stats.mtimeMs) ? right.stats.mtimeMs : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.source.sourceId.localeCompare(right.source.sourceId);
    });
    return candidates.length > 0 ? candidates[0].source : null;
  }

  function readCredentialSource(file) {
    const sourceRead = readBoundedRegularFile(
      file,
      fileSystem,
      'DATA_MIGRATION_CREDENTIAL_SOURCE_INVALID',
      'Legacy credential source is invalid',
    );
    if (!hasSingleLink(sourceRead.stats)) {
      throw createMigrationError(
        'DATA_MIGRATION_CREDENTIAL_SOURCE_INVALID',
        'Legacy credential source is invalid',
      );
    }
    return sourceRead;
  }

  function credentialMigrationId(entry, source, value) {
    const canonicalCookie = Buffer.from(
      Buffer.from(value).toString('utf8').trim(),
      'utf8',
    );
    return hashIdentifier([
      DATA_MIGRATION_SCHEMA,
      entry.id,
      source.sourceId,
      digest(canonicalCookie),
    ].join(':'));
  }

  async function credentialImportIsVerified(importOptions, entry, migrationId) {
    try {
      const verified = await importOptions.verifyCredentialImport(
        entry.provider,
        migrationId,
      ) === true;
      assertMigrationFence();
      return verified;
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      throw createMigrationError(
        'DATA_MIGRATION_CREDENTIAL_IMPORT_FAILED',
        'Legacy credentials could not be imported',
      );
    }
  }
  function restoreQuarantinedSource(entry, source, candidatePath) {
    let candidateStats;
    let sourceStats;
    try {
      candidateStats = lstatOrMissing(candidatePath, fileSystem);
      if (!isSafePathStats(candidateStats)) return false;
      sourceStats = lstatOrMissing(source.sourcePath, fileSystem);
      if (sourceStats && sameFileObject(sourceStats, candidateStats)) {
        assertMigrationFence();
        fileSystem.unlinkSync(candidatePath);
        syncDirectory(path.dirname(source.sourcePath), fileSystem);
        updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
        return true;
      }
      if (sourceStats) return false;
      if (!hasSingleLink(candidateStats)) return false;
      assertMigrationFence();
      fileSystem.linkSync(candidatePath, source.sourcePath);
      syncDirectory(path.dirname(source.sourcePath), fileSystem);
      sourceStats = lstatOrMissing(source.sourcePath, fileSystem);
      if (!isSafePathStats(sourceStats)
        || !sameFileObject(sourceStats, candidateStats)) {
        return false;
      }
      assertMigrationFence();
      fileSystem.unlinkSync(candidatePath);
      syncDirectory(path.dirname(source.sourcePath), fileSystem);
      updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
      return true;
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      return false;
    }
  }

  async function finishQuarantinedRemoval(
    entry,
    source,
    importOptions,
    expectedMigrationId = null,
  ) {
    const removalPaths = credentialRemovalPaths(entry, source);
    let existingPaths = removalPaths.filter(candidate => (
      isSafePathStats(lstatOrMissing(candidate, fileSystem))
    ));
    if (existingPaths.length === 2) {
      const firstStats = lstatOrMissing(existingPaths[0], fileSystem);
      const secondStats = lstatOrMissing(existingPaths[1], fileSystem);
      if (!sameFileObject(firstStats, secondStats)) {
        const snapshots = [];
        for (const candidatePath of existingPaths) {
          let candidateRead;
          try {
            candidateRead = readCredentialSource(candidatePath);
          } catch (_error) {
            return;
          }
          const migrationId = credentialMigrationId(
            entry,
            source,
            candidateRead.value,
          );
          const verified = await credentialImportIsVerified(
            importOptions,
            entry,
            migrationId,
          );
          snapshots.push({ candidatePath, migrationId, verified });
        }
        const importedSnapshot = snapshots.find(snapshot => (
          snapshot.verified
          && (!expectedMigrationId
            || snapshot.migrationId === expectedMigrationId)
        ));
        if (!importedSnapshot) return;
        const preservedSnapshot = snapshots.find(
          snapshot => snapshot.candidatePath !== importedSnapshot.candidatePath,
        );
        if (!preservedSnapshot
          || !restoreQuarantinedSource(
            entry,
            source,
            preservedSnapshot.candidatePath,
          )) return;
        await finishQuarantinedRemoval(
          entry,
          source,
          importOptions,
          importedSnapshot.migrationId,
        );
        return;
      }
      try {
        assertMigrationFence();
        fileSystem.unlinkSync(existingPaths[1]);
        syncDirectory(path.dirname(source.sourcePath), fileSystem);
      } catch (error) {
        if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
        return;
      }
      existingPaths = [existingPaths[0]];
    }
    if (existingPaths.length !== 1) return;
    const candidatePath = existingPaths[0];
    const destinationPath = removalPaths.find(candidate => candidate !== candidatePath);

    let sourceStats = lstatOrMissing(source.sourcePath, fileSystem);
    let candidateStats = lstatOrMissing(candidatePath, fileSystem);
    if (sourceStats && candidateStats && sameFileObject(sourceStats, candidateStats)) {
      let linkedRead;
      try {
        linkedRead = readBoundedRegularFile(
          candidatePath,
          fileSystem,
          'DATA_MIGRATION_CREDENTIAL_SOURCE_INVALID',
          'Legacy credential source is invalid',
        );
      } catch (_error) {
        return;
      }
      const linkedMigrationId = credentialMigrationId(
        entry,
        source,
        linkedRead.value,
      );
      const expectedMatches = !expectedMigrationId
        || linkedMigrationId === expectedMigrationId;
      if (!expectedMatches
        || !await credentialImportIsVerified(
          importOptions,
          entry,
          linkedMigrationId,
        )) {
        restoreQuarantinedSource(entry, source, candidatePath);
        return;
      }
      if (!moveCredentialSourceNoReplace(source.sourcePath, destinationPath)) return;
      sourceStats = lstatOrMissing(source.sourcePath, fileSystem);
      candidateStats = lstatOrMissing(candidatePath, fileSystem);
      const destinationStats = lstatOrMissing(destinationPath, fileSystem);
      if (sourceStats
        || !isSafePathStats(candidateStats)
        || !isSafePathStats(destinationStats)
        || !sameFileObject(candidateStats, destinationStats)) {
        if (!sourceStats && isSafePathStats(destinationStats)) {
          restoreQuarantinedSource(entry, source, destinationPath);
        }
        return;
      }
      return finishQuarantinedRemoval(
        entry,
        source,
        importOptions,
        linkedMigrationId,
      );
    }

    let candidateRead;
    try {
      candidateRead = readCredentialSource(candidatePath);
    } catch (_error) {
      return;
    }
    const migrationId = credentialMigrationId(entry, source, candidateRead.value);
    if (expectedMigrationId && migrationId !== expectedMigrationId) {
      restoreQuarantinedSource(entry, source, candidatePath);
      return;
    }
    if (!await credentialImportIsVerified(importOptions, entry, migrationId)) {
      restoreQuarantinedSource(entry, source, candidatePath);
      return;
    }

    try {
      assertMigrationFence();
      fileSystem.linkSync(candidatePath, destinationPath);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      if (error && error.code === 'EEXIST') return;
      return;
    }
    const linkedCandidateStats = lstatOrMissing(candidatePath, fileSystem);
    const linkedDestinationStats = lstatOrMissing(destinationPath, fileSystem);
    if (!isSafePathStats(linkedCandidateStats)
      || !isSafePathStats(linkedDestinationStats)
      || !sameFileObject(linkedCandidateStats, linkedDestinationStats)) {
      return;
    }
    try {
      assertMigrationFence();
      fileSystem.unlinkSync(candidatePath);
      syncDirectory(path.dirname(source.sourcePath), fileSystem);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      return;
    }

    let movedRead;
    try {
      movedRead = readCredentialSource(destinationPath);
    } catch (_error) {
      return;
    }
    const movedMigrationId = credentialMigrationId(entry, source, movedRead.value);
    if (movedMigrationId !== migrationId
      || (expectedMigrationId && movedMigrationId !== expectedMigrationId)) {
      restoreQuarantinedSource(entry, source, destinationPath);
      return;
    }

    try {
      assertMigrationFence();
      fileSystem.unlinkSync(destinationPath);
      syncDirectory(path.dirname(source.sourcePath), fileSystem);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      if (!error || error.code !== 'ENOENT') return;
    }

    let remainingSource;
    try {
      remainingSource = lstatOrMissing(source.sourcePath, fileSystem);
    } catch (_error) {
      return;
    }
    if (!remainingSource) {
      updateStatus(
        entry,
        ENTRY_STATUS.COMPLETE,
        source.sourceId,
        migrationId,
      );
    } else {
      updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
    }
  }
  function findCredentialRemovalSource(entry) {
    const matches = entry.sources.filter(source => credentialRemovalPaths(entry, source)
      .some(candidate => isSafePathStats(lstatOrMissing(candidate, fileSystem))));
    matches.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    return matches.length > 0 ? matches[0] : null;
  }

  async function removeImportedSource(
    entry,
    source,
    importOptions,
    expectedMigrationId = null,
  ) {
    assertDirectoryChainSafe(path.dirname(source.sourcePath), fileSystem);
    if (credentialRemovalPaths(entry, source)
      .some(candidate => lstatOrMissing(candidate, fileSystem))) {
      await finishQuarantinedRemoval(
        entry,
        source,
        importOptions,
        expectedMigrationId,
      );
      return;
    }

    const currentStats = lstatOrMissing(source.sourcePath, fileSystem);
    if (!currentStats) {
      if (expectedMigrationId
        && await credentialImportIsVerified(
          importOptions,
          entry,
          expectedMigrationId,
        )) {
        updateStatus(
          entry,
          ENTRY_STATUS.COMPLETE,
          source.sourceId,
          expectedMigrationId,
        );
      }
      return;
    }
    if (!isSafePathStats(currentStats)) {
      updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
      return;
    }

    const currentRead = readCredentialSource(source.sourcePath);
    const migrationId = credentialMigrationId(entry, source, currentRead.value);
    if ((expectedMigrationId && migrationId !== expectedMigrationId)
      || !await credentialImportIsVerified(importOptions, entry, migrationId)) {
      updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
      return;
    }

    const quarantinePath = credentialQuarantinePath(entry, source);
    try {
      assertMigrationFence();
      fileSystem.linkSync(source.sourcePath, quarantinePath);
    } catch (error) {
      if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
      if (error && error.code === 'EEXIST') return;
      return;
    }
    const linkedSourceStats = lstatOrMissing(source.sourcePath, fileSystem);
    const linkedQuarantineStats = lstatOrMissing(quarantinePath, fileSystem);
    if (!isSafePathStats(linkedSourceStats)
      || !isSafePathStats(linkedQuarantineStats)
      || !sameFileObject(linkedSourceStats, linkedQuarantineStats)) {
      return;
    }
    const tombstonePath = credentialTombstonePath(entry, source);
    if (!moveCredentialSourceNoReplace(source.sourcePath, tombstonePath)) return;
    const movedSourceStats = lstatOrMissing(source.sourcePath, fileSystem);
    const movedQuarantineStats = lstatOrMissing(quarantinePath, fileSystem);
    const movedTombstoneStats = lstatOrMissing(tombstonePath, fileSystem);
    if (movedSourceStats
      || !isSafePathStats(movedQuarantineStats)
      || !isSafePathStats(movedTombstoneStats)
      || !sameFileObject(movedQuarantineStats, movedTombstoneStats)) {
      if (!movedSourceStats && isSafePathStats(movedTombstoneStats)) {
        restoreQuarantinedSource(entry, source, tombstonePath);
      }
      return;
    }
    await finishQuarantinedRemoval(
      entry,
      source,
      importOptions,
      migrationId,
    );
  }

  async function resumeCredentialImportsUnlocked(importOptions = {}) {
    if (typeof importOptions.importCredential !== 'function') {
      throw new TypeError('Credential import callback is required');
    }
    if (typeof importOptions.verifyCredentialImport !== 'function') {
      throw new TypeError('Credential import verification callback is required');
    }

    for (const entry of runtimeEntries) {
      if (entry.kind !== 'credential-import') continue;
      let current = resolveEntryState(state.entries, entry);
      const recoverySource = findCredentialRemovalSource(entry);
      if (recoverySource) {
        let recoveryMigrationId = current.sourceId === recoverySource.sourceId
          ? current.migrationId
          : null;
        if (!recoveryMigrationId) {
          const recoveryPath = credentialRemovalPaths(entry, recoverySource)
            .find(candidate => isSafePathStats(lstatOrMissing(candidate, fileSystem)));
          const recoveryRead = readCredentialSource(recoveryPath);
          recoveryMigrationId = credentialMigrationId(
            entry,
            recoverySource,
            recoveryRead.value,
          );
        }
        if (current.status !== ENTRY_STATUS.SOURCE_REMOVAL_PENDING
          || current.sourceId !== recoverySource.sourceId
          || current.migrationId !== recoveryMigrationId) {
          updateStatus(
            entry,
            ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
            recoverySource.sourceId,
            recoveryMigrationId,
          );
        }
        await removeImportedSource(
          entry,
          recoverySource,
          importOptions,
          recoveryMigrationId,
        );
        continue;
      }
      if (current.status === ENTRY_STATUS.COMPLETE) continue;

      let source = current.sourceId ? sourceForId(entry, current.sourceId) : null;
      if (current.status === ENTRY_STATUS.SOURCE_REMOVAL_PENDING) {
        await removeImportedSource(
          entry,
          source,
          importOptions,
          current.migrationId,
        );
        continue;
      }
      if (!source) {
        source = selectCredentialSource(entry);
        if (!source) continue;
        updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
        current = resolveEntryState(state.entries, entry);
      }

      const sourceStats = lstatOrMissing(source.sourcePath, fileSystem);
      if (!isSafePathStats(sourceStats)) {
        updateStatus(entry, ENTRY_STATUS.PENDING, source.sourceId);
        continue;
      }

      const sourceRead = readCredentialSource(source.sourcePath);
      const cookie = sourceRead.value.toString('utf8').trim();
      if (!cookie) continue;
      const migrationId = credentialMigrationId(entry, source, sourceRead.value);
      let persisted = await credentialImportIsVerified(
        importOptions,
        entry,
        migrationId,
      );
      if (!persisted) {
        let result;
        try {
          result = await importOptions.importCredential(
            entry.provider,
            { cookie },
            Object.freeze({ migrationId }),
          );
          assertMigrationFence();
        } catch (error) {
          if (error && error.code === 'DATA_MIGRATION_LOCK_FAILED') throw error;
          throw createMigrationError(
            'DATA_MIGRATION_CREDENTIAL_IMPORT_FAILED',
            'Legacy credentials could not be imported',
          );
        }
        if (!result || result.persisted !== true || result.verified !== true) continue;
        persisted = await credentialImportIsVerified(
          importOptions,
          entry,
          migrationId,
        );
      }
      if (!persisted) continue;

      updateStatus(
        entry,
        ENTRY_STATUS.SOURCE_REMOVAL_PENDING,
        source.sourceId,
        migrationId,
      );
      await removeImportedSource(
        entry,
        source,
        importOptions,
        migrationId,
      );
    }
    return status();
  }
  function pendingEntryExists(entry, current) {
    try {
      if (entry.kind === 'file') {
        return Boolean(findSourceFile(sourceRoots, entry.sourceName, fileSystem));
      }
      const selectedSource = current.sourceId
        ? sourceForId(entry, current.sourceId)
        : null;
      const sources = selectedSource ? [selectedSource] : entry.sources;
      return sources.some(source => {
        if (isSafePathStats(lstatOrMissing(source.sourcePath, fileSystem))) return true;
        return credentialRemovalPaths(entry, source)
          .some(candidate => isSafePathStats(lstatOrMissing(candidate, fileSystem)));
      });
    } catch (_error) {
      return true;
    }
  }

  function resumeFiles() {
    return runExclusive(resumeFilesUnlocked);
  }

  function resumeCredentialImports(importOptions = {}) {
    return runExclusive(() => resumeCredentialImportsUnlocked(importOptions));
  }

  function credentialEntryHasResidualData(entry) {
    return entry.sources.some(source => {
      if (lstatOrMissing(source.sourcePath, fileSystem)) return true;
      return credentialRemovalPaths(entry, source)
        .some(candidate => lstatOrMissing(candidate, fileSystem));
    });
  }

  function status() {
    state = readJournalState(filePath, runtimeEntries, fileSystem, now);
    let pending = 0;
    let sourceRemovalPending = 0;
    let complete = 0;
    let degraded = 0;
    for (const entry of runtimeEntries) {
      const current = resolveEntryState(state.entries, entry);
      if (current.status === ENTRY_STATUS.COMPLETE) {
        if (entry.kind === 'file') {
          if (inspectTarget(entry.targetPath, fileSystem) === 'valid') {
            complete += 1;
          } else {
            degraded += 1;
          }
        } else {
          try {
            if (credentialEntryHasResidualData(entry)) {
              degraded += 1;
            } else {
              complete += 1;
            }
          } catch (_error) {
            degraded += 1;
          }
        }
      } else if (current.status === ENTRY_STATUS.SOURCE_REMOVAL_PENDING) {
        if (pendingEntryExists(entry, current)) {
          sourceRemovalPending += 1;
        } else {
          degraded += 1;
        }
      } else if (pendingEntryExists(entry, current)) {
        pending += 1;
      } else if (current.sourceId) {
        degraded += 1;
      }
    }
    return {
      schema: DATA_MIGRATION_SCHEMA,
      total: pending + sourceRemovalPending + complete + degraded,
      pending,
      sourceRemovalPending,
      complete,
      degraded,
    };
  }
  return Object.freeze({
    resumeFiles,
    resumeCredentialImports,
    status,
  });
}

module.exports = {
  DATA_MIGRATION_SCHEMA,
  MAX_MIGRATION_FILE_SIZE,
  createDataMigrationJournal,
  createDefaultMigrationManifest,
};
