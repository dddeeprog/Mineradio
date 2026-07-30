/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
'use strict';

const crypto = require('node:crypto');
const defaultFs = require('node:fs');
const defaultPath = require('node:path');
const {
  isImplementationRegistry,
} = require('./implementation-registry');

const PROVIDERS = new Set(['netease', 'qq', 'kugou', 'qishui', 'spotify', 'local']);
const REMOTE_PLAYBACK_PROVIDERS = new Set(['netease', 'qq']);
const PRIVATE_LOCAL_SOURCE_ID = /^local-v2-[a-f0-9]{64}$/;
const MAX_TIME_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_FIELDS = new Set([
  'sessionId',
  'confirmedPlayback',
  'catalogProvider',
  'playbackProvider',
  'resolutionMode',
  'completeness',
  'sourceIds',
  'catalogSourceId',
  'playbackSourceId',
  'listenMs',
  'durationMs',
  'completion',
  'playedAt',
  'context',
  'reportingBinding',
]);
const REPORTING_BINDING_PATTERN = /^[a-f0-9]{32}\.[a-f0-9]{64}$/;
const CONTEXT_FIELDS = new Set(['type', 'source', 'playlistId', 'radioId', 'position']);
const COMPLETION_FIELDS = new Set(['completed', 'ratio']);
const ACCOUNT_BINDINGS = new WeakMap();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value, max, pattern) {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  if (!result || result.length > max) return '';
  return pattern && !pattern.test(result) ? '' : result;
}

function integer(value, min, max) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max
    ? value
    : null;
}

function reportError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function assertDataRecord(value, fields, code) {
  if (!isRecord(value)) throw reportError(code, 422);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw reportError(code, 422);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (_) {
    throw reportError(code, 422);
  }
  if (Object.getOwnPropertySymbols(value).length) throw reportError(code, 422);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!fields.has(key) || !descriptor.enumerable || !('value' in descriptor)) {
      throw reportError(code, 422);
    }
  }
  return descriptors;
}

function normalizeProvider(value) {
  const provider = cleanString(value, 16).toLowerCase();
  return PROVIDERS.has(provider) ? provider : '';
}

function normalizeContext(value) {
  if (value == null) return null;
  const descriptors = assertDataRecord(value, CONTEXT_FIELDS, 'LISTEN_CONTEXT_INVALID');
  const context = {};
  for (const [key, max] of Object.entries({
    type: 32,
    source: 32,
    playlistId: 128,
    radioId: 128,
  })) {
    if (!descriptors[key]) continue;
    const raw = descriptors[key].value;
    const string = cleanString(raw, max, /^[^\u0000-\u001f\\/\\]*$/);
    if (typeof raw !== 'string' || !string) {
      throw reportError('LISTEN_CONTEXT_INVALID', 422);
    }
    context[key] = string;
  }
  if (descriptors.position) {
    const position = integer(descriptors.position.value, 0, 1_000_000);
    if (typeof descriptors.position.value !== 'number' || position === null) {
      throw reportError('LISTEN_CONTEXT_INVALID', 422);
    }
    context.position = position;
  }
  return Object.keys(context).length ? context : null;
}

function normalizeSourceIds(value) {
  const descriptors = assertDataRecord(
    value,
    PROVIDERS,
    'PLAYBACK_SOURCE_ID_INVALID',
  );
  const output = {};
  for (const provider of PROVIDERS) {
    const descriptor = descriptors[provider];
    if (!descriptor) continue;
    const raw = descriptor.value;
    const id = cleanString(raw, 128, /^[^\u0000-\u001f\\/\\]+$/);
    if (typeof raw !== 'string' || !id) {
      throw reportError('PLAYBACK_SOURCE_ID_INVALID', 422);
    }
    output[provider] = id;
  }
  return output;
}

function normalizeResolution(catalogProvider, playbackProvider, value) {
  const raw = cleanString(value, 32).toLowerCase();
  if (playbackProvider === 'local') {
    if (catalogProvider !== 'local') throw reportError('LISTEN_IDENTITY_INVALID', 422);
    return 'local';
  }
  if (catalogProvider === playbackProvider) {
    if (raw && raw !== 'catalog' && raw !== 'direct') {
      throw reportError('LISTEN_IDENTITY_INVALID', 422);
    }
    return 'direct';
  }
  if (raw !== 'matched-provider') {
    throw reportError('LISTEN_IDENTITY_INVALID', 422);
  }
  return 'matched-provider';
}

function normalizeListenEvent(value) {
  const fields = assertDataRecord(value, EVENT_FIELDS, 'LISTEN_EVENT_FIELDS_INVALID');
  for (const required of EVENT_FIELDS) {
    if (
      required === 'context'
      || required === 'reportingBinding'
    ) continue;
    if (!fields[required]) throw reportError('LISTEN_EVENT_INVALID', 400);
  }
  const sessionId = cleanString(value.sessionId, 128, /^[A-Za-z0-9._:-]+$/);
  const catalogProvider = normalizeProvider(value.catalogProvider);
  const playbackProvider = normalizeProvider(value.playbackProvider);
  const inputCompleteness = cleanString(value.completeness, 16);
  if (
    !sessionId
    || !catalogProvider
    || !playbackProvider
    || !['complete', 'partial', 'unsupported'].includes(inputCompleteness)
  ) {
    throw reportError('LISTEN_EVENT_INVALID', 400);
  }
  if (value.confirmedPlayback !== true) {
    throw reportError('PLAYBACK_NOT_CONFIRMED', 422);
  }
  let sourceIds = normalizeSourceIds(value.sourceIds);
  let catalogSourceId = cleanString(
    value.catalogSourceId,
    128,
    /^[^\u0000-\u001f\\/\\]+$/,
  );
  let playbackSourceId = cleanString(
    value.playbackSourceId,
    128,
    /^[^\u0000-\u001f\\/\\]+$/,
  );
  if (
    !catalogSourceId
    || !playbackSourceId
    || sourceIds[catalogProvider] !== catalogSourceId
    || sourceIds[playbackProvider] !== playbackSourceId
  ) {
    throw reportError('PLAYBACK_SOURCE_ID_INVALID', 422);
  }
  if (playbackProvider === 'netease' && !/^[1-9]\d{0,19}$/.test(playbackSourceId)) {
    throw reportError('PLAYBACK_SOURCE_ID_INVALID', 422);
  }
  if (playbackProvider === 'local') {
    const localSourceId = PRIVATE_LOCAL_SOURCE_ID.test(playbackSourceId)
      ? playbackSourceId
      : `local-${sessionId}`;
    sourceIds = { local: localSourceId };
    catalogSourceId = localSourceId;
    playbackSourceId = localSourceId;
  }
  const listenMs = integer(value.listenMs, 1, MAX_TIME_MS);
  const durationMs = integer(value.durationMs, 0, MAX_TIME_MS);
  const playedAt = integer(value.playedAt, 0, Number.MAX_SAFE_INTEGER);
  const reportingBinding = fields.reportingBinding
    ? cleanString(value.reportingBinding, 97, REPORTING_BINDING_PATTERN)
    : '';
  if (fields.reportingBinding && !reportingBinding) {
    throw reportError('LISTEN_ACCOUNT_BINDING_INVALID', 422);
  }
  if (listenMs === null || durationMs === null || playedAt === null) {
    throw reportError('LISTEN_NUMERIC_FIELD_INVALID', 422);
  }
  const completionFields = assertDataRecord(
    value.completion,
    COMPLETION_FIELDS,
    'LISTEN_EVENT_INVALID',
  );
  if (!completionFields.completed || !completionFields.ratio) {
    throw reportError('LISTEN_EVENT_INVALID', 400);
  }
  const completedValue = completionFields.completed.value;
  const ratioValue = completionFields.ratio.value;
  const ratio = ratioValue;
  if (
    typeof ratioValue !== 'number'
    || !Number.isFinite(ratioValue)
    || ratioValue < 0
    || ratioValue > 1
  ) {
    throw reportError('LISTEN_NUMERIC_FIELD_INVALID', 422);
  }
  if (
    typeof completedValue !== 'boolean'
  ) {
    throw reportError('LISTEN_EVENT_INVALID', 400);
  }
  const completed = completedValue === true;
  const completedMinimum = durationMs > 0
    ? Math.max(1, Math.min(1_000, Math.floor(durationMs * 0.8)))
    : 1_000;
  if (
    (completed && (listenMs < completedMinimum || ratio <= 0))
    || (!completed && listenMs < 45_000 && ratio < 0.5)
  ) {
    throw reportError('LISTEN_DURATION_INEFFECTIVE', 422);
  }
  return Object.freeze({
    sessionId,
    confirmedPlayback: true,
    catalogProvider,
    playbackProvider,
    resolutionMode: normalizeResolution(
      catalogProvider,
      playbackProvider,
      value.resolutionMode,
    ),
    completeness: 'partial',
    sourceIds: Object.freeze(sourceIds),
    catalogSourceId,
    playbackSourceId,
    listenMs,
    durationMs,
    completion: Object.freeze({
      completed,
      ratio: Math.round(ratio * 10_000) / 10_000,
    }),
    playedAt,
    context: normalizeContext(value.context),
    reportingBinding,
  });
}

function normalizeAccount(value) {
  value = isRecord(value) ? value : {};
  const binding = ACCOUNT_BINDINGS.get(value);
  const accountId = cleanString(value.accountId, 128, /^[^\u0000-\u001f\\/\\]+$/);
  const reportingBinding = cleanString(
    value.reportingBinding,
    97,
    REPORTING_BINDING_PATTERN,
  );
  return {
    loggedIn: value.loggedIn === true && !!accountId,
    accountId,
    reportingBinding,
    credentialSnapshot: binding
      ? binding.credentialSnapshot
      : value.credentialSnapshot,
  };
}

function normalizeBindingSecret(value) {
  if (Buffer.isBuffer(value) && value.length >= 32) return Buffer.from(value);
  if (typeof value === 'string' && value.length >= 32) return Buffer.from(value, 'utf8');
  return crypto.randomBytes(32);
}

function bindingSecretError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sameFileIdentity(left, right) {
  return !!left
    && !!right
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs);
}

function waitSynchronously(milliseconds) {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

function sameDirectoryIdentity(left, right) {
  return !!left
    && !!right
    && left.isDirectory()
    && right.isDirectory()
    && Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino);
}

function loadOrCreateReportingBindingSecretInternal(filePath, options) {
  options = isRecord(options) ? options : {};
  const fs = options.fs || defaultFs;
  const path = options.path || defaultPath;
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : crypto.randomBytes;
  const wallClock = typeof options.clock === 'function' ? options.clock : Date.now;
  const staleLockMs = integer(options.staleLockMs, 20, 10 * 60 * 1000) || 10_000;
  const requestedLockTimeoutMs = integer(
    options.lockTimeoutMs,
    25,
    10 * 60 * 1000,
  ) || 12_000;
  const lockTimeoutMs = Math.max(requestedLockTimeoutMs, staleLockMs + 25);
  filePath = path.resolve(String(filePath || 'listen.binding-secret'));
  const directory = path.dirname(filePath);
  const lockPath = `${filePath}.lock`;
  const lockOwnerPath = path.join(lockPath, 'owner.json');
  const ownTempPrefix = `${path.basename(filePath)}.tmp-v1-`;
  const flags = fs.constants || defaultFs.constants;

  function comparablePath(value) {
    const resolved = path.resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  function inspectDirectory(target) {
    const before = fs.lstatSync(target);
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    const canonical = fs.realpathSync(target);
    if (comparablePath(canonical) !== comparablePath(target)) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    let descriptor = null;
    try {
      descriptor = fs.openSync(target, 'r');
      const opened = fs.fstatSync(descriptor);
      const after = fs.lstatSync(target);
      if (
        !sameDirectoryIdentity(before, opened)
        || !sameDirectoryIdentity(opened, after)
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      return after;
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
    }
  }
  function inspectDirectoryChain(allowMissing) {
    const parsed = path.parse(directory);
    const relative = path.relative(parsed.root, directory);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    let current = parsed.root;
    let missing = false;
    let parentIdentity = null;
    for (const part of parts) {
      current = path.join(current, part);
      if (missing) continue;
      try {
        parentIdentity = inspectDirectory(current);
      } catch (error) {
        if (allowMissing && error && error.code === 'ENOENT') {
          missing = true;
          continue;
        }
        throw error;
      }
    }
    if (!parts.length) parentIdentity = inspectDirectory(parsed.root);
    if (!allowMissing && missing) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_PATH_FAILED');
    }
    return missing ? null : parentIdentity;
  }
  inspectDirectoryChain(true);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parentIdentity = inspectDirectoryChain(false);
  function openAncestorGuards() {
    const parsed = path.parse(directory);
    const relative = path.relative(parsed.root, directory);
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    const targets = [parsed.root];
    for (const part of parts) {
      targets.push(path.join(targets[targets.length - 1], part));
    }
    const guards = [];
    try {
      for (const target of targets) {
        const before = fs.lstatSync(target);
        const descriptor = fs.openSync(target, 'r');
        const opened = fs.fstatSync(descriptor);
        const after = fs.lstatSync(target);
        if (
          !sameDirectoryIdentity(before, opened)
          || !sameDirectoryIdentity(opened, after)
        ) {
          try { fs.closeSync(descriptor); } catch (_) {}
          throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
        }
        guards.push({ target, descriptor, identity: opened });
      }
      return guards;
    } catch (error) {
      for (const guard of guards.reverse()) {
        try { fs.closeSync(guard.descriptor); } catch (_) {}
      }
      throw error;
    }
  }
  const ancestorGuards = openAncestorGuards();
  function closeAncestorGuards() {
    for (const guard of ancestorGuards.slice().reverse()) {
      try { fs.closeSync(guard.descriptor); } catch (_) {}
    }
    ancestorGuards.length = 0;
  }
  function assertAncestorGuards() {
    for (const guard of ancestorGuards) {
      const opened = fs.fstatSync(guard.descriptor);
      const current = fs.lstatSync(guard.target);
      if (
        !sameDirectoryIdentity(guard.identity, opened)
        || !sameDirectoryIdentity(opened, current)
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
    }
  }
  function assertSafeParent() {
    assertAncestorGuards();
    const current = inspectDirectoryChain(false);
    if (!sameDirectoryIdentity(parentIdentity, current)) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
  }
  function fsyncDirectory(target) {
    let descriptor = null;
    try {
      descriptor = fs.openSync(target, 'r');
      fs.fsyncSync(descriptor);
    } catch (error) {
      if (
        process.platform !== 'win32'
        || !error
        || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(error.code)
      ) {
        throw error;
      }
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
    }
  }
  function readRegularFile(target, maxBytes) {
    const before = fs.lstatSync(target);
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.size > maxBytes
    ) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    let descriptor = null;
    try {
      descriptor = fs.openSync(
        target,
        flags.O_RDONLY | (flags.O_NOFOLLOW || 0),
      );
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || !sameFileIdentity(before, opened)) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      const body = fs.readFileSync(descriptor, 'utf8');
      const after = fs.fstatSync(descriptor);
      const current = fs.lstatSync(target);
      if (
        !sameFileIdentity(opened, after)
        || !sameFileIdentity(after, current)
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      return { body, stats: current };
    } finally {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
    }
  }
  function readLockOwner() {
    try {
      const { body } = readRegularFile(lockOwnerPath, 512);
      const value = JSON.parse(body);
      if (
        !isRecord(value)
        || value.version !== 1
        || integer(value.pid, 1, 2_147_483_647) === null
        || !cleanString(value.nonce, 128, /^[A-Za-z0-9_-]{8,128}$/)
        || integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER) === null
      ) {
        return null;
      }
      return value;
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      if (error && error.code === 'LISTEN_BINDING_SECRET_UNSAFE') throw error;
      return null;
    }
  }
  function processStatus(pid) {
    if (typeof options.isProcessAlive === 'function') {
      const result = options.isProcessAlive(pid);
      return result === true ? true : (result === false ? false : null);
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error && error.code === 'ESRCH') return false;
      return null;
    }
  }
  function lockIdentity(target) {
    const stats = fs.lstatSync(target);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    return stats;
  }
  function createOwnedLock(nonce) {
    assertSafeParent();
    fs.mkdirSync(lockPath, { mode: 0o700 });
    const identity = lockIdentity(lockPath);
    let descriptor = null;
    try {
      const owner = JSON.stringify({
        version: 1,
        pid: process.pid,
        nonce,
        createdAt: integer(wallClock(), 0, Number.MAX_SAFE_INTEGER) || 0,
      });
      descriptor = fs.openSync(lockOwnerPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, owner, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      assertSafeParent();
      const current = lockIdentity(lockPath);
      const published = readLockOwner();
      if (
        !sameDirectoryIdentity(identity, current)
        || !published
        || published.nonce !== nonce
        || published.pid !== process.pid
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_LOCK_FAILED');
      }
      return current;
    } catch (error) {
      if (descriptor !== null) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
      try {
        const owner = readLockOwner();
        if (!owner || (owner.nonce === nonce && owner.pid === process.pid)) {
          cleanupOwnedLock(lockPath, identity);
        }
      } catch (_) {}
      throw error;
    }
  }
  function cleanupOwnedLock(target, expectedIdentity) {
    let current;
    try {
      current = lockIdentity(target);
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      return;
    }
    if (!sameDirectoryIdentity(expectedIdentity, current)) return;
    let names;
    try {
      names = fs.readdirSync(target);
    } catch (_) {
      return;
    }
    if (names.some(name => name !== 'owner.json')) return;
    const owner = path.join(target, 'owner.json');
    try {
      const stats = fs.lstatSync(owner);
      if (stats.isFile() && !stats.isSymbolicLink()) fs.unlinkSync(owner);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') return;
    }
    try { fs.rmdirSync(target); } catch (_) {}
  }
  function acquireLock() {
    const nonce = randomBytes(16).toString('hex');
    const deadline = wallClock() + lockTimeoutMs;
    while (true) {
      try {
        return { nonce, identity: createOwnedLock(nonce) };
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          if (error && /^LISTEN_BINDING_SECRET_/.test(error.code || '')) throw error;
          throw bindingSecretError('LISTEN_BINDING_SECRET_LOCK_FAILED');
        }
      }
      assertSafeParent();
      let existingIdentity;
      try {
        existingIdentity = lockIdentity(lockPath);
      } catch (error) {
        if (error && error.code === 'ENOENT') continue;
        throw error;
      }
      const owner = readLockOwner();
      const observedAt = integer(wallClock(), 0, Number.MAX_SAFE_INTEGER) || 0;
      const age = Math.max(
        0,
        observedAt - (
          integer(owner && owner.createdAt, 0, Number.MAX_SAFE_INTEGER)
          || Math.floor(existingIdentity.mtimeMs || 0)
        ),
      );
      const status = owner ? processStatus(owner.pid) : null;
      const reclaimable = status === false || (!owner && age >= staleLockMs);
      if (reclaimable) {
        const quarantine = `${lockPath}.stale-v1-${process.pid}-${nonce}`;
        let moved = false;
        try {
          assertSafeParent();
          const current = lockIdentity(lockPath);
          if (!sameDirectoryIdentity(existingIdentity, current)) continue;
          fs.renameSync(lockPath, quarantine);
          moved = true;
          const quarantined = lockIdentity(quarantine);
          if (!sameDirectoryIdentity(existingIdentity, quarantined)) {
            throw bindingSecretError('LISTEN_BINDING_SECRET_LOCK_FAILED');
          }
          const acquired = createOwnedLock(nonce);
          cleanupOwnedLock(quarantine, quarantined);
          return { nonce, identity: acquired };
        } catch (error) {
          if (moved) {
            try {
              fs.lstatSync(lockPath);
            } catch (missing) {
              if (missing && missing.code === 'ENOENT') {
                try { fs.renameSync(quarantine, lockPath); } catch (_) {}
              }
            }
          }
          if (
            !error
            || !['EEXIST', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code)
          ) {
            throw error;
          }
        }
      }
      if (wallClock() >= deadline) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_LOCK_FAILED');
      }
      waitSynchronously(Math.min(10, Math.max(1, deadline - wallClock())));
    }
  }
  function releaseLock(lock) {
    try {
      assertSafeParent();
      const current = lockIdentity(lockPath);
      const owner = readLockOwner();
      if (
        !sameDirectoryIdentity(lock.identity, current)
        || !owner
        || owner.nonce !== lock.nonce
        || owner.pid !== process.pid
      ) {
        return;
      }
      fs.unlinkSync(lockOwnerPath);
      fs.rmdirSync(lockPath);
    } catch (_) {}
  }

  let lock;
  try {
    lock = acquireLock();
  } catch (error) {
    closeAncestorGuards();
    throw error;
  }
  let descriptor = null;
  let tempPath = '';
  let quarantinePath = '';
  function closeDescriptor() {
    if (descriptor === null) return;
    try { fs.closeSync(descriptor); } catch (_) {}
    descriptor = null;
  }
  function inspectCanonical() {
    assertSafeParent();
    let before;
    try {
      before = fs.lstatSync(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { exists: false };
      throw bindingSecretError('LISTEN_BINDING_SECRET_READ_FAILED');
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    if (before.size !== 64) return { exists: true, stats: before, secret: null };
    try {
      descriptor = fs.openSync(filePath, 'r');
      const opened = fs.fstatSync(descriptor);
      if (!opened.isFile() || !sameFileIdentity(before, opened)) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      const body = fs.readFileSync(descriptor, 'utf8');
      const after = fs.fstatSync(descriptor);
      closeDescriptor();
      const current = fs.lstatSync(filePath);
      if (
        !sameFileIdentity(opened, after)
        || !sameFileIdentity(after, current)
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      return {
        exists: true,
        stats: current,
        secret: /^[a-f0-9]{64}$/.test(body)
          ? Buffer.from(body, 'hex')
          : null,
      };
    } catch (error) {
      closeDescriptor();
      if (error && /^LISTEN_BINDING_SECRET_/.test(error.code || '')) throw error;
      throw bindingSecretError('LISTEN_BINDING_SECRET_READ_FAILED');
    }
  }
  function ownTempCandidates() {
    const candidates = [];
    for (const name of fs.readdirSync(directory).sort()) {
      if (!name.startsWith(ownTempPrefix)) continue;
      const target = path.join(directory, name);
      try {
        const result = readRegularFile(target, 64);
        if (/^[a-f0-9]{64}$/.test(result.body)) {
          candidates.push({
            path: target,
            secret: Buffer.from(result.body, 'hex'),
            stats: result.stats,
          });
        }
      } catch (error) {
        if (error && error.code === 'LISTEN_BINDING_SECRET_UNSAFE') continue;
        if (!error || error.code !== 'ENOENT') throw error;
      }
    }
    if (
      candidates.length > 1
      && candidates.some(candidate => (
        !candidate.secret.equals(candidates[0].secret)
      ))
    ) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
    }
    return candidates;
  }
  function cleanupOwnTemps(exceptPath) {
    for (const name of fs.readdirSync(directory)) {
      if (!name.startsWith(ownTempPrefix)) continue;
      const target = path.join(directory, name);
      if (target === exceptPath) continue;
      try {
        const before = fs.lstatSync(target);
        if (!before.isFile() || before.isSymbolicLink()) continue;
        const after = fs.lstatSync(target);
        if (!sameFileIdentity(before, after)) continue;
        fs.unlinkSync(target);
      } catch (_) {}
    }
  }

  try {
    const existing = inspectCanonical();
    if (existing.secret) {
      fs.chmodSync(filePath, 0o600);
      cleanupOwnTemps('');
      return existing.secret;
    }

    const recoveryTemps = ownTempCandidates();
    const recovery = recoveryTemps[0] || null;
    const secret = recovery ? recovery.secret : randomBytes(32);
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_WRITE_FAILED');
    }
    const suffix = `${process.pid}-${randomBytes(12).toString('hex')}`;
    if (recovery) {
      tempPath = recovery.path;
      descriptor = fs.openSync(
        tempPath,
        flags.O_RDWR | (flags.O_NOFOLLOW || 0),
      );
      const opened = fs.fstatSync(descriptor);
      if (!sameFileIdentity(recovery.stats, opened)) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      fs.fsyncSync(descriptor);
      closeDescriptor();
    } else {
      tempPath = `${filePath}.tmp-v1-${suffix}`;
      assertSafeParent();
      descriptor = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(descriptor, secret.toString('hex'), 'utf8');
      fs.fsyncSync(descriptor);
      closeDescriptor();
    }
    assertSafeParent();

    if (existing.exists) {
      const current = fs.lstatSync(filePath);
      if (
        !current.isFile()
        || current.isSymbolicLink()
        || !sameFileIdentity(existing.stats, current)
      ) {
        throw bindingSecretError('LISTEN_BINDING_SECRET_UNSAFE');
      }
      quarantinePath = `${filePath}.corrupt-v1-${suffix}`;
      fs.renameSync(filePath, quarantinePath);
    }
    assertSafeParent();
    fs.renameSync(tempPath, filePath);
    tempPath = '';
    fs.chmodSync(filePath, 0o600);
    assertSafeParent();
    const published = inspectCanonical();
    if (!published.secret || !published.secret.equals(secret)) {
      throw bindingSecretError('LISTEN_BINDING_SECRET_WRITE_FAILED');
    }
    fsyncDirectory(directory);
    if (quarantinePath) {
      try { fs.unlinkSync(quarantinePath); } catch (_) {}
      quarantinePath = '';
    }
    cleanupOwnTemps('');
    return secret;
  } catch (error) {
    closeDescriptor();
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
    if (quarantinePath) {
      try {
        fs.lstatSync(filePath);
      } catch (missing) {
        if (missing && missing.code === 'ENOENT') {
          try { fs.renameSync(quarantinePath, filePath); } catch (_) {}
        }
      }
    }
    if (error && /^LISTEN_BINDING_SECRET_/.test(error.code || '')) throw error;
    throw bindingSecretError('LISTEN_BINDING_SECRET_WRITE_FAILED');
  } finally {
    releaseLock(lock);
    closeAncestorGuards();
  }
}

function loadOrCreateReportingBindingSecret(filePath, options) {
  try {
    return loadOrCreateReportingBindingSecretInternal(filePath, options);
  } catch (error) {
    const code = error && /^LISTEN_BINDING_SECRET_[A-Z_]+$/.test(error.code || '')
      ? error.code
      : 'LISTEN_BINDING_SECRET_IO_FAILED';
    throw bindingSecretError(code);
  }
}

function createReportingBinding(secret, provider, accountId) {
  secret = normalizeBindingSecret(secret);
  provider = normalizeProvider(provider);
  accountId = cleanString(accountId, 128, /^[^\u0000-\u001f\\/\\]+$/);
  if (!provider || provider === 'local' || !accountId) return '';
  const handle = crypto
    .createHmac('sha256', secret)
    .update(`scope\u0000${provider}\u0000${accountId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`binding\u0000${provider}\u0000${handle}`, 'utf8')
    .digest('hex');
  return `${handle}.${signature}`;
}

function verifyReportingBinding(secret, provider, binding) {
  binding = cleanString(binding, 97, REPORTING_BINDING_PATTERN);
  provider = normalizeProvider(provider);
  if (!binding || !provider || provider === 'local') return false;
  const [handle, actual] = binding.split('.');
  const expected = crypto
    .createHmac('sha256', normalizeBindingSecret(secret))
    .update(`binding\u0000${provider}\u0000${handle}`, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function accountScope(account) {
  if (!account.loggedIn || !account.reportingBinding) return 'anonymous';
  return account.reportingBinding.slice(0, 32);
}

function reportingCapability(registry, provider) {
  if (registry.has(provider, 'listenDurationReport')) return 'listenDurationReport';
  if (registry.has(provider, 'recentPlayReport')) return 'recentPlayReport';
  return '';
}

function reportingCapabilities(registry, provider) {
  return ['recentPlayReport', 'listenDurationReport'].filter(
    capability => registry.has(provider, capability),
  );
}

function publicResult(entry, duplicate, capabilities) {
  const status = entry.status === 'claimed'
    ? 'pending'
    : entry.status;
  return {
    accepted: true,
    localRecorded: true,
    completeness: status === 'submitted'
      ? 'complete'
      : (status === 'unsupported' ? 'unsupported' : 'partial'),
    status,
    duplicate: duplicate === true,
    reportedCapabilities: status === 'submitted'
      ? (capabilities || []).slice()
      : [],
  };
}

function normalizedEventDigest(event) {
  const canonical = {
    sessionId: event.sessionId,
    catalogProvider: event.catalogProvider,
    playbackProvider: event.playbackProvider,
    resolutionMode: event.resolutionMode,
    sourceIds: event.sourceIds,
    catalogSourceId: event.catalogSourceId,
    playbackSourceId: event.playbackSourceId,
    listenMs: event.listenMs,
    durationMs: event.durationMs,
    completion: event.completion,
    playedAt: event.playedAt,
    context: event.context,
    reportingBinding: event.reportingBinding,
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function bindReportingAccount(account, reportingBinding, credentialSnapshot) {
  const result = {
    ...account,
    reportingBinding,
  };
  ACCOUNT_BINDINGS.set(result, { credentialSnapshot });
  return result;
}

function createReportingAccountResolver(options) {
  options = isRecord(options) ? options : {};
  const getCredential = typeof options.getCredential === 'function'
    ? options.getCredential
    : () => null;
  const getLiveAccount = typeof options.getLiveAccount === 'function'
    ? options.getLiveAccount
    : async () => null;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const timeoutMs = integer(options.timeoutMs, 10, 10_000) || 2_500;
  const cacheMs = integer(options.cacheMs, 100, 60 * 60 * 1000) || 30_000;
  const accountBindingSecret = normalizeBindingSecret(options.accountBindingSecret);
  const cache = new Map();
  const inflight = new Map();

  function credentialMarker(value) {
    let material = '';
    if (typeof value === 'string') material = value;
    else if (isRecord(value)) {
      material = Object.keys(value).sort().map(key => {
        const item = value[key];
        return typeof item === 'string' || typeof item === 'number'
          ? `${key}:${String(item)}`
          : '';
      }).join('\u0000');
    }
    if (!material) return '';
    return crypto.createHmac('sha256', accountBindingSecret)
      .update(material, 'utf8')
      .digest('hex');
  }

  function snapshotCredential(value) {
    if (typeof value === 'string') return value;
    if (!isRecord(value)) return null;
    try {
      return Object.freeze(JSON.parse(JSON.stringify(value)));
    } catch (_) {
      return null;
    }
  }

  function liveIdentity(value) {
    value = isRecord(value) ? value : {};
    const rawAccountId = value.accountId || value.userId;
    const accountId = cleanString(
      Number.isSafeInteger(rawAccountId) ? String(rawAccountId) : rawAccountId,
      128,
      /^[^\u0000-\u001f\\/\\]+$/,
    );
    return {
      loggedIn: value.loggedIn === true && !!accountId,
      accountId,
    };
  }

  return async function resolveReportingAccount(provider) {
    provider = normalizeProvider(provider);
    if (!provider || provider === 'local') {
      return bindReportingAccount({
        loggedIn: false,
        accountId: '',
      }, '', null);
    }
    let credential;
    try {
      credential = await getCredential(provider);
    } catch (_) {
      return bindReportingAccount({
        loggedIn: false,
        accountId: '',
      }, '', null);
    }
    const marker = credentialMarker(credential);
    const credentialSnapshot = snapshotCredential(credential);
    if (!marker || credentialSnapshot == null) {
      return bindReportingAccount({
        loggedIn: false,
        accountId: '',
      }, '', null);
    }
    const now = integer(clock(), 0, Number.MAX_SAFE_INTEGER) || 0;
    const cached = cache.get(provider);
    if (cached && cached.marker === marker && cached.expiresAt > now) {
      return bindReportingAccount({
        ...cached.account,
      }, cached.reportingBinding, credentialSnapshot);
    }
    const key = `${provider}:${marker}`;
    if (inflight.has(key)) return inflight.get(key);
    const operation = (async () => {
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(reportError('TIMEOUT', 503)), timeoutMs);
          if (timer && typeof timer.unref === 'function') timer.unref();
        });
        const account = liveIdentity(await Promise.race([
          Promise.resolve(getLiveAccount(provider, credentialSnapshot)),
          timeout,
        ]));
        if (account.loggedIn) {
          const reportingBinding = createReportingBinding(
            accountBindingSecret,
            provider,
            account.accountId,
          );
          cache.set(provider, {
            marker,
            account,
            reportingBinding,
            expiresAt: now + cacheMs,
          });
          return bindReportingAccount({
            ...account,
          }, reportingBinding, credentialSnapshot);
        }
        return bindReportingAccount({
          ...account,
        }, '', credentialSnapshot);
      } catch (_) {
        return bindReportingAccount({
          loggedIn: false,
          accountId: '',
        }, '', credentialSnapshot);
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    inflight.set(key, operation);
    try {
      return await operation;
    } finally {
      inflight.delete(key);
    }
  };
}

function providerResultCode(value) {
  if (!isRecord(value)) return 0;
  const body = isRecord(value.body) ? value.body : value;
  return Number(body.code || value.status || 0);
}

function createNeteaseScrobbleAdapter(options) {
  options = isRecord(options) ? options : {};
  const scrobble = options.scrobble;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  if (typeof scrobble !== 'function') throw new TypeError('scrobble is required');

  return async function reportNeteaseListen(event, context) {
    event = isRecord(event) ? event : {};
    context = isRecord(context) ? context : {};
    const snapshot = context.credentialSnapshot;
    const cookie = typeof snapshot === 'string'
      ? snapshot
      : (
        isRecord(snapshot) && typeof snapshot.cookie === 'string'
          ? snapshot.cookie
          : ''
      );
    const id = cleanString(event.playbackSourceId, 20, /^[1-9]\d{0,19}$/);
    const rawSourceId = event.context && event.context.playlistId;
    const sourceid = cleanString(
      rawSourceId == null || rawSourceId === '' ? '0' : rawSourceId,
      20,
      /^\d{1,20}$/,
    );
    const time = Math.floor(Number(event.listenMs) / 1000);
    if (
      typeof cookie !== 'string'
      || !cookie
      || !id
      || !sourceid
      || !Number.isSafeInteger(time)
      || time < 1
      || time > 7 * 24 * 60 * 60
    ) {
      const error = new Error('NETEASE_SCROBBLE_INPUT_INVALID');
      error.code = cookie ? 'PROVIDER_REJECTED' : 'LOGIN_REQUIRED';
      throw error;
    }
    const request = {
      id,
      sourceid,
      time,
      cookie,
      timestamp: integer(clock(), 0, Number.MAX_SAFE_INTEGER) || 0,
    };
    if (context.signal) request.signal = context.signal;
    return scrobble(request);
  };
}

function createListenReporter(options) {
  options = isRecord(options) ? options : {};
  const registry = options.registry;
  const journal = options.journal;
  const adapters = isRecord(options.providerAdapters) ? options.providerAdapters : {};
  const resolveAccount = typeof options.accountResolver === 'function'
    ? options.accountResolver
    : async () => ({ loggedIn: false, accountId: '' });
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const autoRetry = options.autoRetry !== false;
  const retryPollMs = integer(options.retryPollMs, 250, 60 * 60 * 1000) || 30_000;
  const providerTimeoutMs = integer(options.providerTimeoutMs, 10, 30_000) || 5_000;
  const accountBindingSecret = normalizeBindingSecret(options.accountBindingSecret);
  const AbortControllerApi = typeof options.AbortController === 'function'
    ? options.AbortController
    : (typeof AbortController === 'function' ? AbortController : null);
  if (!isImplementationRegistry(registry)) throw new TypeError('registry is required');
  if (!journal || typeof journal.put !== 'function' || typeof journal.due !== 'function') {
    throw new TypeError('journal is required');
  }
  const inflight = new Map();
  const diagnostics = new Set();
  const activeProviders = new Set();
  const reporterOwner = crypto.randomBytes(32).toString('hex');
  let flushPromise = null;
  let timer = null;
  let destroyed = false;

  function diagnose(code) {
    const safeCode = cleanString(code, 48, /^[A-Z0-9_]+$/) || 'PROVIDER_FAILED';
    for (const listener of diagnostics) {
      try { listener(safeCode); } catch (_) {}
    }
  }

  function failureCode(error) {
    const code = cleanString(error && error.code, 48, /^[A-Z0-9_]+$/);
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return 'TIMEOUT';
    if (code === 'LOGIN_REQUIRED') return 'LOGIN_REQUIRED';
    if (code === 'ACCOUNT_CHANGED') return 'ACCOUNT_CHANGED';
    return 'PROVIDER_FAILED';
  }

  async function accountFor(provider) {
    try {
      const account = normalizeAccount(await resolveAccount(provider));
      if (account.loggedIn && !account.reportingBinding) {
        account.reportingBinding = createReportingBinding(
          accountBindingSecret,
          provider,
          account.accountId,
        );
      }
      return account;
    } catch (_) {
      return { loggedIn: false, accountId: '' };
    }
  }

  function journalEntry(event, scope, status) {
    const now = integer(clock(), 0, Number.MAX_SAFE_INTEGER) || 0;
    const completeness = status === 'unsupported' ? 'unsupported' : 'partial';
    return {
      key: `${event.playbackProvider}:${scope}:${event.sessionId}`,
      provider: event.playbackProvider,
      accountScope: scope,
      sessionId: event.sessionId,
      status,
      attempts: 0,
      nextAttemptAt: 0,
      lastErrorCode: '',
      createdAt: now,
      updatedAt: now,
      eventDigest: normalizedEventDigest(event),
      event: { ...event, completeness },
    };
  }

  async function callProvider(adapter, event, account) {
    if (destroyed) throw reportError('TIMEOUT', 503);
    const controller = AbortControllerApi ? new AbortControllerApi() : null;
    let timer = null;
    let cancel = null;
    const cancelled = new Promise((_, reject) => {
      cancel = () => {
        if (controller) {
          try { controller.abort(); } catch (_) {}
        }
        reject(reportError('TIMEOUT', 503));
      };
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (controller) {
          try { controller.abort(); } catch (_) {}
        }
        reject(reportError('TIMEOUT', 503));
      }, providerTimeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    const active = { cancel };
    activeProviders.add(active);
    try {
      return await Promise.race([
        Promise.resolve().then(() => adapter(
          Object.freeze({ ...event }),
          Object.freeze({
            signal: controller ? controller.signal : undefined,
            credentialSnapshot: account.credentialSnapshot,
          }),
        )),
        timeout,
        cancelled,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      activeProviders.delete(active);
    }
  }

  function sameAccountBinding(left, right) {
    return !!left.reportingBinding
      && left.reportingBinding === right.reportingBinding;
  }

  async function uncertainResult(entry, token, errorCode) {
    let uncertain;
    try {
      uncertain = await journal.markUncertain(
        entry.key,
        token,
        errorCode || 'PROVIDER_UNCERTAIN',
      );
    } catch (_) {
      uncertain = {
        ...entry,
        status: 'uncertain',
        lastErrorCode: 'PROVIDER_UNCERTAIN',
      };
    }
    return publicResult(uncertain, false, []);
  }

  async function invoke(entry, account) {
    const capabilities = reportingCapabilities(registry, entry.provider);
    const adapter = adapters[entry.provider];
    if (typeof adapter !== 'function') {
      const failed = await journal.markFailure(entry.key, 'REPORTING_UNAVAILABLE');
      return publicResult(failed, false, []);
    }
    const claim = await journal.claim(
      entry.key,
      entry.eventDigest || normalizedEventDigest(entry.event),
      reporterOwner,
    );
    if (!claim.acquired) {
      return publicResult(claim.entry, true, capabilities);
    }
    const token = claim.token;
    const claimedEntry = claim.entry;
    if (
      entry.accountScope !== accountScope(account)
      || entry.event.reportingBinding !== account.reportingBinding
    ) {
      const changed = await journal.releaseClaimFailure(
        entry.key,
        token,
        'ACCOUNT_CHANGED',
      );
      schedule();
      return publicResult(changed, false, []);
    }
    let started;
    try {
      started = await journal.markClaimStarted(
        entry.key,
        token,
        providerTimeoutMs + 1_000,
      );
    } catch (error) {
      diagnose('LISTEN_PROVIDER_CLAIM_FAILED');
      return publicResult(claimedEntry, false, []);
    }
    try {
      const result = await callProvider(adapter, started.event, account);
      if (providerResultCode(result) !== 200) {
        diagnose('PROVIDER_REJECTED');
        return uncertainResult(started, token, 'PROVIDER_REJECTED');
      }
      const currentAccount = await accountFor(entry.provider);
      if (!sameAccountBinding(account, currentAccount)) {
        diagnose('ACCOUNT_CHANGED');
      }
      try {
        const submitted = await journal.markSubmitted(entry.key, token);
        return publicResult(submitted, false, capabilities);
      } catch (_) {
        diagnose('JOURNAL_WRITE_FAILED');
        return uncertainResult(started, token, 'PROVIDER_UNCERTAIN');
      }
    } catch (error) {
      const code = failureCode(error);
      diagnose(code);
      if (error && error.retrySafe === true) {
        const pending = await journal.releaseClaimFailure(entry.key, token, code);
        schedule();
        return publicResult(pending, false, []);
      }
      return uncertainResult(started, token, 'PROVIDER_UNCERTAIN');
    }
  }

  async function processEvent(event, account, scope) {
    const key = `${event.playbackProvider}:${scope}:${event.sessionId}`;
    const digest = normalizedEventDigest(event);
    const existing = await journal.get(key);
    if (existing) {
      if (existing.eventDigest !== digest) {
        throw reportError('LISTEN_SESSION_CONFLICT', 409);
      }
      if (existing.status !== 'pending' || existing.nextAttemptAt > clock()) {
        return publicResult(
          existing,
          true,
          reportingCapabilities(registry, existing.provider),
        );
      }
      if (!account.loggedIn) return publicResult(existing, true, []);
      return invoke(existing, account);
    }
    if (event.playbackProvider !== 'local' && !REMOTE_PLAYBACK_PROVIDERS.has(event.playbackProvider)) {
      throw reportError('PLAYBACK_PROVIDER_SEARCH_ONLY', 422);
    }
    const capability = reportingCapability(registry, event.playbackProvider);
    if (!capability) {
      const unsupported = await journal.put(journalEntry(event, scope, 'unsupported'));
      return publicResult(unsupported, false, []);
    }
    const pending = await journal.put(journalEntry(event, scope, 'pending'));
    if (
      event.reportingBinding !== account.reportingBinding
      || scope !== accountScope(account)
    ) {
      const failed = await journal.markFailure(pending.key, 'ACCOUNT_CHANGED');
      schedule();
      return publicResult(failed, false, []);
    }
    if (!account.loggedIn) {
      const failed = await journal.markFailure(pending.key, 'LOGIN_REQUIRED');
      schedule();
      return publicResult(failed, false, []);
    }
    return invoke(pending, account);
  }

  async function report(rawEvent) {
    if (destroyed) throw reportError('REPORTER_DESTROYED', 503);
    const event = normalizeListenEvent(rawEvent);
    if (
      event.playbackProvider !== 'local'
      && !registry.has(event.playbackProvider, 'playback')
    ) {
      throw reportError('PLAYBACK_PROVIDER_SEARCH_ONLY', 422);
    }
    const account = await accountFor(event.playbackProvider);
    const capability = reportingCapability(registry, event.playbackProvider);
    if (capability && !event.reportingBinding) {
      throw reportError('REPORTING_BINDING_REQUIRED', 422);
    }
    if (
      capability
      && !verifyReportingBinding(
        accountBindingSecret,
        event.playbackProvider,
        event.reportingBinding,
      )
    ) {
      throw reportError('REPORTING_BINDING_INVALID', 422);
    }
    const scope = event.reportingBinding
      ? event.reportingBinding.slice(0, 32)
      : 'anonymous';
    const key = `${event.playbackProvider}:${scope}:${event.sessionId}`;
    const digest = normalizedEventDigest(event);
    const current = inflight.get(key);
    if (current) {
      if (current.digest !== digest) {
        throw reportError('LISTEN_SESSION_CONFLICT', 409);
      }
      return current.promise;
    }
    const operation = processEvent(event, account, scope);
    inflight.set(key, { digest, promise: operation });
    try {
      return await operation;
    } finally {
      inflight.delete(key);
    }
  }

  async function flushEntry(entry) {
    const account = await accountFor(entry.provider);
    const currentScope = accountScope(account);
    if (
      currentScope !== entry.accountScope
      || entry.event.reportingBinding !== account.reportingBinding
    ) {
      await journal.markFailure(entry.key, 'ACCOUNT_CHANGED');
      return;
    }
    if (!account.loggedIn) {
      await journal.markFailure(entry.key, 'LOGIN_REQUIRED');
      return;
    }
    if (!reportingCapability(registry, entry.provider)) {
      await journal.markFailure(entry.key, 'REPORTING_UNAVAILABLE');
      return;
    }
    const digest = entry.eventDigest || normalizedEventDigest(entry.event);
    const current = inflight.get(entry.key);
    if (current) {
      if (current.digest !== digest) {
        throw reportError('LISTEN_SESSION_CONFLICT', 409);
      }
      await current.promise;
      return;
    }
    const operation = invoke(entry, account);
    inflight.set(entry.key, { digest, promise: operation });
    try {
      await operation;
    } finally {
      inflight.delete(entry.key);
    }
  }

  function flushDue() {
    if (destroyed) return Promise.resolve([]);
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      const due = await journal.due();
      for (const entry of due) await flushEntry(entry);
      return due.map(item => item.sessionId);
    })();
    flushPromise = flushPromise.finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  }

  function schedule() {
    if (!autoRetry || destroyed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void runScheduledFlush();
    }, retryPollMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  async function runScheduledFlush() {
    try {
      await flushDue();
    } catch (_) {
      diagnose('LISTEN_RETRY_FAILED');
    } finally {
      schedule();
    }
  }

  if (autoRetry) {
    Promise.resolve(journal.load()).then(
      () => {
        if (!destroyed) void runScheduledFlush();
      },
      () => {
        diagnose('LISTEN_RETRY_FAILED');
        schedule();
      },
    ).catch(() => {});
  }

  return Object.freeze({
    report,
    flushDue,
    onDiagnostic(listener) {
      if (typeof listener !== 'function') return () => {};
      diagnostics.add(listener);
      return () => diagnostics.delete(listener);
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      for (const active of activeProviders) active.cancel();
      activeProviders.clear();
      diagnostics.clear();
    },
  });
}

module.exports = {
  createReportingBinding,
  createListenReporter,
  createNeteaseScrobbleAdapter,
  createReportingAccountResolver,
  loadOrCreateReportingBindingSecret,
  normalizeListenEvent,
  verifyReportingBinding,
};
