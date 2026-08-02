/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
'use strict';

const crypto = require('node:crypto');
const defaultFs = require('node:fs');
const defaultPath = require('node:path');

const LISTEN_JOURNAL_SCHEMA = 6;
const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_BYTES = 512 * 1024;
const ABSOLUTE_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_STALE_LOCK_MS = 60_000;
const DEFAULT_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CLOCK_ADVANCE_MS = 24 * 60 * 60 * 1000;
const ENTRY_STATUSES = new Set([
  'pending',
  'claimed',
  'submitted',
  'unsupported',
  'uncertain',
]);
const COMPLETENESS = new Set(['complete', 'partial', 'unsupported']);
const PRIVATE_LOCAL_SOURCE_ID = /^local-v2-[a-f0-9]{64}$/;
const PROVIDERS = new Set(['netease', 'qq', 'kugou', 'qishui', 'spotify', 'local']);
const RESOLUTION_MODES = new Set(['direct', 'matched-provider', 'local']);
const ERROR_CODES = new Set([
  'ACCOUNT_CHANGED',
  'LOGIN_REQUIRED',
  'PROVIDER_FAILED',
  'PROVIDER_REJECTED',
  'PROVIDER_UNCERTAIN',
  'REPORTING_UNAVAILABLE',
  'TIMEOUT',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedString(value, max, pattern) {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  if (!result || result.length > max) return '';
  if (pattern && !pattern.test(result)) return '';
  return result;
}

function boundedInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return null;
  return number;
}

function eventDigest(event) {
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
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function sessionAccountScope(reportingBinding, sessionId) {
  reportingBinding = boundedString(
    reportingBinding,
    97,
    /^[a-f0-9]{32}\.[a-f0-9]{64}$/,
  );
  sessionId = boundedString(sessionId, 128, /^[A-Za-z0-9._:-]+$/);
  if (!reportingBinding || !sessionId) return '';
  return crypto
    .createHash('sha256')
    .update(`listen-scope\u0000${reportingBinding.slice(0, 32)}\u0000${sessionId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}

function normalizeContext(value) {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  const context = {};
  const strings = {
    type: 32,
    source: 32,
    playlistId: 128,
    radioId: 128,
  };
  for (const [key, max] of Object.entries(strings)) {
    const normalized = boundedString(value[key], max, /^[^\u0000-\u001f\\/\\]*$/);
    if (normalized) context[key] = normalized;
  }
  const position = boundedInteger(value.position, 0, 1_000_000);
  if (position !== null) context.position = position;
  return Object.keys(context).length ? context : null;
}

function normalizeSourceIds(value) {
  if (!isRecord(value)) return {};
  const sourceIds = {};
  for (const provider of PROVIDERS) {
    const id = boundedString(value[provider], 128, /^[^\u0000-\u001f\\/\\]+$/);
    if (id) sourceIds[provider] = id;
  }
  return sourceIds;
}

function normalizeEvent(value) {
  if (!isRecord(value)) return null;
  if (
    isRecord(value.context)
    && (
      (typeof value.context.type === 'string' && value.context.type.length > 32)
      || (typeof value.context.source === 'string' && value.context.source.length > 32)
      || (typeof value.context.playlistId === 'string' && value.context.playlistId.length > 128)
      || (typeof value.context.radioId === 'string' && value.context.radioId.length > 128)
    )
  ) {
    return null;
  }
  const sessionId = boundedString(value.sessionId, 128, /^[A-Za-z0-9._:-]+$/);
  const catalogProvider = boundedString(value.catalogProvider, 16);
  const playbackProvider = boundedString(value.playbackProvider, 16);
  const resolutionMode = boundedString(value.resolutionMode, 32);
  const completeness = boundedString(value.completeness, 16);
  let playbackSourceId = boundedString(
    value.playbackSourceId,
    128,
    /^[^\u0000-\u001f\\/\\]+$/,
  );
  let catalogSourceId = boundedString(
    value.catalogSourceId,
    128,
    /^[^\u0000-\u001f\\/\\]+$/,
  );
  const listenMs = boundedInteger(value.listenMs, 1, 7 * 24 * 60 * 60 * 1000);
  const durationMs = boundedInteger(value.durationMs, 0, 7 * 24 * 60 * 60 * 1000);
  const playedAt = boundedInteger(value.playedAt, 0, 9_007_199_254_740_991);
  const completion = isRecord(value.completion) ? value.completion : {};
  const ratio = Number(completion.ratio);
  if (
    !sessionId
    || !PROVIDERS.has(catalogProvider)
    || !PROVIDERS.has(playbackProvider)
    || !RESOLUTION_MODES.has(resolutionMode)
    || !COMPLETENESS.has(completeness)
    || !playbackSourceId
    || listenMs === null
    || durationMs === null
    || playedAt === null
    || !Number.isFinite(ratio)
    || ratio < 0
    || ratio > 1
  ) {
    return null;
  }
  let sourceIds = normalizeSourceIds(value.sourceIds);
  if (playbackProvider === 'local' && catalogProvider === 'local') {
    const localSourceId = (
      PRIVATE_LOCAL_SOURCE_ID.test(catalogSourceId)
      && catalogSourceId === playbackSourceId
      && sourceIds.local === playbackSourceId
    )
      ? playbackSourceId
      : `local-${sessionId}`;
    sourceIds = { local: localSourceId };
    catalogSourceId = localSourceId;
    playbackSourceId = localSourceId;
  }
  return {
    sessionId,
    catalogProvider,
    playbackProvider,
    resolutionMode,
    completeness,
    sourceIds,
    catalogSourceId,
    playbackSourceId,
    listenMs,
    durationMs,
    completion: {
      completed: completion.completed === true,
      ratio: Math.round(ratio * 10_000) / 10_000,
    },
    playedAt,
    context: normalizeContext(value.context),
  };
}

function normalizeEntry(value, fallbackKey) {
  if (!isRecord(value)) return null;
  const provider = boundedString(value.provider, 16);
  const sessionId = boundedString(value.sessionId, 128, /^[A-Za-z0-9._:-]+$/);
  const migratedScope = sessionAccountScope(
    value.event && value.event.reportingBinding,
    sessionId,
  );
  const accountScope = migratedScope
    || boundedString(value.accountScope, 64, /^[a-z0-9_-]+$/i);
  const key = migratedScope
    ? `${provider}:${accountScope}:${sessionId}`
    : (boundedString(
      value.key,
      240,
      /^[A-Za-z0-9._:-]+$/,
    ) || (
      provider && accountScope && sessionId
        ? `${provider}:${accountScope}:${sessionId}`
        : boundedString(fallbackKey, 240, /^[A-Za-z0-9._:-]+$/)
    ));
  const status = boundedString(value.status, 16);
  const attempts = boundedInteger(value.attempts, 0, 1_000_000);
  const nextAttemptAt = boundedInteger(value.nextAttemptAt, 0, 9_007_199_254_740_991);
  const createdAt = boundedInteger(value.createdAt, 0, 9_007_199_254_740_991);
  const updatedAt = boundedInteger(value.updatedAt, 0, 9_007_199_254_740_991);
  const event = normalizeEvent(value.event);
  const claimToken = boundedString(value.claimToken, 64, /^[a-f0-9]{64}$/);
  const claimOwner = boundedString(value.claimOwner, 64, /^[a-f0-9]{64}$/);
  const claimPhase = boundedString(value.claimPhase, 16);
  const claimExpiresAt = boundedInteger(
    value.claimExpiresAt,
    0,
    9_007_199_254_740_991,
  );
  if (
    !key
    || !PROVIDERS.has(provider)
    || !accountScope
    || !sessionId
    || !ENTRY_STATUSES.has(status)
    || attempts === null
    || nextAttemptAt === null
    || createdAt === null
    || updatedAt === null
    || !event
    || event.sessionId !== sessionId
    || (
      status === 'claimed'
      && (
        !claimToken
        || !claimOwner
        || !['reserved', 'started'].includes(claimPhase)
        || claimExpiresAt === null
      )
    )
  ) {
    return null;
  }
  return {
    key,
    provider,
    accountScope,
    sessionId,
    status,
    attempts,
    nextAttemptAt,
    lastErrorCode: ERROR_CODES.has(value.lastErrorCode) ? value.lastErrorCode : '',
    createdAt,
    updatedAt,
    eventDigest: migratedScope
      ? eventDigest(event)
      : (boundedString(value.eventDigest, 64, /^[a-f0-9]{64}$/)
        || eventDigest(event)),
    ...(status === 'claimed' ? {
      claimToken,
      claimOwner,
      claimPhase,
      claimExpiresAt,
    } : {}),
    event,
  };
}

function normalizeLegacyEntry(value, fallbackKey) {
  if (!isRecord(value)) return null;
  const key = boundedString(fallbackKey, 240, /^[A-Za-z0-9._:-]+$/);
  const parts = key.split(':');
  const keyProvider = parts.shift();
  const provider = boundedString(value.provider || keyProvider, 16);
  const accountScope = boundedString(parts.shift(), 64, /^[a-f0-9]{8,64}$/i);
  const sessionId = boundedString(parts.join(':'), 128, /^[A-Za-z0-9._:-]+$/);
  const songId = boundedString(
    value.songId,
    128,
    /^[^\u0000-\u001f\\/\\]+$/,
  );
  const submittedAt = boundedInteger(
    value.submittedAt,
    0,
    9_007_199_254_740_991,
  );
  if (
    !key
    || !PROVIDERS.has(provider)
    || !accountScope
    || !sessionId
    || !songId
    || submittedAt === null
  ) {
    return null;
  }
  return normalizeEntry({
    key,
    provider,
    accountScope,
    sessionId,
    status: 'submitted',
    attempts: 0,
    nextAttemptAt: 0,
    lastErrorCode: '',
    createdAt: submittedAt,
    updatedAt: submittedAt,
    event: {
      sessionId,
      catalogProvider: provider,
      playbackProvider: provider,
      resolutionMode: provider === 'local' ? 'local' : 'direct',
      completeness: 'complete',
      sourceIds: { [provider]: songId },
      catalogSourceId: songId,
      playbackSourceId: songId,
      listenMs: 1,
      durationMs: 0,
      completion: { completed: true, ratio: 0 },
      playedAt: submittedAt,
      context: null,
    },
  }, key);
}

function emptyState() {
  return {
    version: LISTEN_JOURNAL_SCHEMA,
    highWaterAt: 0,
    acceptedObservedAt: 0,
    suspectObservedAt: 0,
    recoveryObservedAt: 0,
    entries: {},
  };
}

function normalizeDocument(value) {
  if (
    !isRecord(value)
    || ![1, 2, 3, 4, 5, LISTEN_JOURNAL_SCHEMA].includes(value.version)
  ) {
    return null;
  }
  const entries = {};
  let migrated = value.version !== LISTEN_JOURNAL_SCHEMA;
  if (isRecord(value.entries)) {
    for (const key of Object.keys(value.entries).sort()) {
      const normalized = normalizeEntry(value.entries[key], key)
        || (value.version === 1 ? normalizeLegacyEntry(value.entries[key], key) : null);
      if (normalized) {
        entries[normalized.key] = normalized;
        if (value.entries[key].eventDigest !== normalized.eventDigest) migrated = true;
      }
    }
  }
  let highWaterAt = 0;
  let acceptedObservedAt = 0;
  let suspectObservedAt = 0;
  let recoveryObservedAt = 0;
  if (value.version === LISTEN_JOURNAL_SCHEMA) {
    const clockFields = [
      'highWaterAt',
      'acceptedObservedAt',
      'suspectObservedAt',
      'recoveryObservedAt',
    ];
    const presentClockFields = clockFields.filter(field => (
      Object.hasOwn(value, field)
    ));
    if (presentClockFields.length === 0) {
      migrated = true;
    } else {
      highWaterAt = boundedInteger(value.highWaterAt, 0, Number.MAX_SAFE_INTEGER);
      acceptedObservedAt = boundedInteger(
        value.acceptedObservedAt,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      suspectObservedAt = boundedInteger(
        value.suspectObservedAt,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      recoveryObservedAt = boundedInteger(
        value.recoveryObservedAt,
        0,
        Number.MAX_SAFE_INTEGER,
      );
      if (
        presentClockFields.length !== clockFields.length
        || highWaterAt === null
        || acceptedObservedAt === null
        || suspectObservedAt === null
        || recoveryObservedAt === null
        || acceptedObservedAt > highWaterAt
        || (suspectObservedAt && suspectObservedAt <= acceptedObservedAt)
        || (
          recoveryObservedAt
          && (
            recoveryObservedAt <= acceptedObservedAt
            || !suspectObservedAt
            || recoveryObservedAt > suspectObservedAt
          )
        )
      ) {
        return null;
      }
    }
  }
  return {
    state: {
      version: LISTEN_JOURNAL_SCHEMA,
      highWaterAt,
      acceptedObservedAt,
      suspectObservedAt,
      recoveryObservedAt,
      entries,
    },
    migrated,
  };
}

function serialized(state) {
  return JSON.stringify(state);
}

function capacityError(code) {
  code = code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED'
    ? code
    : 'LISTEN_JOURNAL_CAPACITY';
  const error = new Error(code);
  error.code = code;
  error.status = 503;
  return error;
}

function journalError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status || 503;
  return error;
}

function createListenJournal(options) {
  options = isRecord(options) ? options : {};
  const fs = options.fs || defaultFs;
  const fsp = fs.promises || defaultFs.promises;
  const path = options.path || defaultPath;
  const filePath = path.resolve(String(options.filePath || 'listen-journal.json'));
  const maxEntries = boundedInteger(options.maxEntries, 1, 100_000) || DEFAULT_MAX_ENTRIES;
  const maxBytes = boundedInteger(options.maxBytes, 512, 64 * 1024 * 1024) || DEFAULT_MAX_BYTES;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const baseRetryMs = boundedInteger(options.baseRetryMs, 100, 24 * 60 * 60 * 1000) || 1_000;
  const maxRetryMs = boundedInteger(options.maxRetryMs, baseRetryMs, 7 * 24 * 60 * 60 * 1000)
    || 60 * 60 * 1000;
  const claimLeaseMs = boundedInteger(options.claimLeaseMs, 100, 10 * 60 * 1000)
    || 30_000;
  const terminalRetentionMs = boundedInteger(
    options.terminalRetentionMs,
    1,
    365 * 24 * 60 * 60 * 1000,
  ) || DEFAULT_TERMINAL_RETENTION_MS;
  const configuredClockAdvanceMs = boundedInteger(
    options.maxClockAdvanceMs,
    1,
    365 * 24 * 60 * 60 * 1000,
  ) || DEFAULT_MAX_CLOCK_ADVANCE_MS;
  const maxClockAdvanceMs = Math.min(
    configuredClockAdvanceMs,
    terminalRetentionMs > 1 ? terminalRetentionMs - 1 : 1,
  );
  const trustedOfflineWindowMs = boundedInteger(
    options.trustedOfflineWindowMs,
    1,
    2 * 365 * 24 * 60 * 60 * 1000,
  ) || Math.min(
    2 * 365 * 24 * 60 * 60 * 1000,
    terminalRetentionMs * 2,
  );
  const lockTimeoutMs = boundedInteger(options.lockTimeoutMs, 10, 30_000)
    || DEFAULT_LOCK_TIMEOUT_MS;
  const lockRetryMs = boundedInteger(options.lockRetryMs, 1, 1_000)
    || DEFAULT_LOCK_RETRY_MS;
  const staleLockMs = boundedInteger(options.staleLockMs, 20, 10 * 60 * 1000)
    || DEFAULT_STALE_LOCK_MS;
  const tempPrefix = `${path.basename(filePath)}.tmp-`;
  const modernTempPrefix = `${path.basename(filePath)}.tmp-v2-`;
  const lockPath = `${filePath}.lock`;
  const lockOwnerPath = path.join(lockPath, 'owner.json');
  const instanceToken = crypto.randomBytes(12).toString('hex');
  let state = emptyState();
  let serial = 0;
  let tail = Promise.resolve();

  function enqueue(action) {
    const result = tail.then(action, action);
    tail = result.catch(() => {});
    return result;
  }

  function trustedClockState(input, observedOverride) {
    const observedAt = boundedInteger(
      observedOverride === undefined ? clock() : observedOverride,
      0,
      Number.MAX_SAFE_INTEGER,
    ) || 0;
    let highWaterAt = boundedInteger(
      input.highWaterAt,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    let acceptedObservedAt = boundedInteger(
      input.acceptedObservedAt,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    let suspectObservedAt = boundedInteger(
      input.suspectObservedAt,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    let recoveryObservedAt = boundedInteger(
      input.recoveryObservedAt,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (highWaterAt === null) highWaterAt = state.highWaterAt || 0;
    if (acceptedObservedAt === null) {
      acceptedObservedAt = state.acceptedObservedAt || 0;
    }
    if (suspectObservedAt === null) {
      suspectObservedAt = state.suspectObservedAt || 0;
    }
    if (recoveryObservedAt === null) {
      recoveryObservedAt = state.recoveryObservedAt || 0;
    }
    if (highWaterAt === 0 && acceptedObservedAt === 0) {
      highWaterAt = observedAt;
      acceptedObservedAt = observedAt;
      suspectObservedAt = 0;
      recoveryObservedAt = 0;
    } else if (recoveryObservedAt > acceptedObservedAt) {
      if (
        observedAt > acceptedObservedAt
        && observedAt < recoveryObservedAt
      ) {
        recoveryObservedAt = observedAt;
      }
      const advance = Math.min(
        recoveryObservedAt - acceptedObservedAt,
        maxClockAdvanceMs,
      );
      highWaterAt = Math.min(Number.MAX_SAFE_INTEGER, highWaterAt + advance);
      acceptedObservedAt += advance;
      if (acceptedObservedAt >= recoveryObservedAt) {
        suspectObservedAt = 0;
        recoveryObservedAt = 0;
      }
    } else if (suspectObservedAt) {
      const delta = observedAt - acceptedObservedAt;
      if (
        delta > 0
        && (
          observedAt < suspectObservedAt
          || delta <= trustedOfflineWindowMs
        )
      ) {
        recoveryObservedAt = observedAt;
        const advance = Math.min(delta, maxClockAdvanceMs);
        highWaterAt = Math.min(Number.MAX_SAFE_INTEGER, highWaterAt + advance);
        acceptedObservedAt += advance;
        if (acceptedObservedAt >= recoveryObservedAt) {
          suspectObservedAt = 0;
          recoveryObservedAt = 0;
        }
      }
    } else if (observedAt > acceptedObservedAt) {
      const delta = observedAt - acceptedObservedAt;
      if (delta <= trustedOfflineWindowMs) {
        highWaterAt = Math.min(Number.MAX_SAFE_INTEGER, highWaterAt + delta);
        acceptedObservedAt = observedAt;
      } else {
        suspectObservedAt = observedAt;
      }
    }
    return {
      highWaterAt,
      acceptedObservedAt,
      suspectObservedAt,
      recoveryObservedAt,
    };
  }

  function compact(input, observedAt) {
    const clockState = trustedClockState(input, observedAt);
    const { highWaterAt } = clockState;
    const boundedEntries = Object.values(input.entries).map(item => normalizeEntry({
      ...item,
      createdAt: Math.min(item.createdAt, highWaterAt),
      updatedAt: Math.min(item.updatedAt, highWaterAt),
      nextAttemptAt: Math.min(item.nextAttemptAt, highWaterAt + maxRetryMs),
      ...(item.status === 'claimed' ? {
        claimExpiresAt: Math.min(
          item.claimExpiresAt,
          highWaterAt + claimLeaseMs,
        ),
      } : {}),
    }, item.key));
    const kept = boundedEntries
      .filter(item => (
        item
        && (
        !['submitted', 'unsupported', 'uncertain'].includes(item.status)
        || Math.max(item.createdAt, item.updatedAt) > highWaterAt
        || highWaterAt - Math.max(item.createdAt, item.updatedAt)
          < terminalRetentionMs
        )
      ))
      .sort((left, right) => (
        left.createdAt - right.createdAt
        || left.key.localeCompare(right.key)
      ));
    if (kept.length > maxEntries) throw capacityError();
    const candidate = {
      version: LISTEN_JOURNAL_SCHEMA,
      ...clockState,
      entries: Object.fromEntries(kept.map(item => [item.key, item])),
    };
    if (Buffer.byteLength(serialized(candidate), 'utf8') > maxBytes) {
      throw capacityError();
    }
    return candidate;
  }

  function trustedNow() {
    return boundedInteger(state.highWaterAt, 0, Number.MAX_SAFE_INTEGER) || 0;
  }

  async function listTemps() {
    try {
      const names = await fsp.readdir(path.dirname(filePath));
      return names
        .filter(name => name.startsWith(tempPrefix))
        .sort()
        .map(name => path.join(path.dirname(filePath), name));
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  function sameTempIdentity(left, right) {
    if (!left || !right) return false;
    if (
      Number(left.dev) !== Number(right.dev)
      || Number(left.ino) !== Number(right.ino)
      || Number(left.size) !== Number(right.size)
    ) return false;
    return Number(left.mtimeMs) === Number(right.mtimeMs);
  }

  async function cleanupInspectedTemps(candidates) {
    await Promise.all((candidates || []).map(async candidate => {
      try {
        if (!candidate || !candidate.path || typeof fsp.lstat !== 'function') return;
        const current = await fsp.lstat(candidate.path);
        if (
          !current.isFile()
          || current.isSymbolicLink()
          || !sameTempIdentity(candidate.stats, current)
        ) return;
        await fsp.unlink(candidate.path);
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          // Cleanup is best-effort; a future load still treats leftovers as untrusted.
        }
      }
    }));
  }

  async function cleanupLegacyTemps(inspected) {
    const candidates = (inspected.valid || []).concat(inspected.invalid || []);
    await cleanupInspectedTemps(candidates.filter(candidate => (
      !path.basename(candidate.path).startsWith(modernTempPrefix)
    )));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function readLockOwner() {
    try {
      const body = await fsp.readFile(lockOwnerPath, 'utf8');
      if (Buffer.byteLength(body, 'utf8') > 512) return null;
      const value = JSON.parse(body);
      return isRecord(value) && boundedString(value.token, 128, /^[a-zA-Z0-9-]+$/)
        ? value
        : null;
    } catch (_) {
      return null;
    }
  }

  async function createOwnedLock(token) {
    await fsp.mkdir(lockPath);
    try {
      await fsp.writeFile(lockOwnerPath, JSON.stringify({
        token,
        pid: process.pid,
        createdAt: Date.now(),
      }), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      try { await fsp.unlink(lockOwnerPath); } catch (_) {}
      try { await fsp.rmdir(lockPath); } catch (_) {}
      throw error;
    }
  }

  async function acquireLock() {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const token = `${process.pid}-${instanceToken}-${crypto.randomBytes(8).toString('hex')}`;
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      try {
        await createOwnedLock(token);
        return token;
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
      }

      let stale = false;
      try {
        const stats = await fsp.stat(lockPath);
        stale = Date.now() - Number(stats.mtimeMs || 0) >= staleLockMs;
      } catch (error) {
        if (error && error.code === 'ENOENT') continue;
        throw error;
      }
      if (stale) {
        const owner = await readLockOwner();
        const ownerPid = boundedInteger(owner && owner.pid, 1, 2_147_483_647);
        let ownerAlive = false;
        if (ownerPid !== null) {
          try {
            process.kill(ownerPid, 0);
            ownerAlive = true;
          } catch (error) {
            ownerAlive = !!(error && error.code !== 'ESRCH');
          }
        }
        if (ownerAlive) stale = false;
      }
      if (stale) {
        const quarantine = `${lockPath}.stale-${token}`;
        let moved = false;
        try {
          await fsp.rename(lockPath, quarantine);
          moved = true;
          await createOwnedLock(token);
          try {
            if (typeof fsp.rm === 'function') {
              await fsp.rm(quarantine, { recursive: true, force: true });
            }
          } catch (_) {}
          return token;
        } catch (error) {
          if (moved) {
            try {
              await fsp.rename(quarantine, lockPath);
            } catch (_) {}
          }
          if (!error || !['EEXIST', 'ENOENT', 'EPERM', 'EACCES'].includes(error.code)) {
            throw error;
          }
        }
      }
      if (Date.now() >= deadline) {
        throw journalError('LISTEN_JOURNAL_LOCK_TIMEOUT', 503);
      }
      await delay(Math.min(lockRetryMs, Math.max(1, deadline - Date.now())));
    }
  }

  async function assertLockOwner(token) {
    const owner = await readLockOwner();
    if (!owner || owner.token !== token) {
      throw journalError('LISTEN_JOURNAL_LOCK_LOST', 503);
    }
  }

  async function releaseLock(token) {
    const owner = await readLockOwner();
    if (!owner || owner.token !== token) return;
    try { await fsp.unlink(lockOwnerPath); } catch (_) {}
    try { await fsp.rmdir(lockPath); } catch (_) {}
  }

  async function withLock(action) {
    const token = await acquireLock();
    try {
      return await action(token);
    } finally {
      await releaseLock(token);
    }
  }

  async function fsyncDirectory() {
    let handle;
    try {
      handle = await fsp.open(path.dirname(filePath), 'r');
      if (handle && typeof handle.sync === 'function') await handle.sync();
    } catch (_) {
      // Directory fsync is not supported on every platform/filesystem.
    } finally {
      if (handle) {
        try { await handle.close(); } catch (_) {}
      }
    }
  }

  async function persist(nextState, lockToken) {
    const compacted = compact(nextState);
    const body = serialized(compacted);
    const temp = `${filePath}.tmp-v2-${process.pid}-${instanceToken}-${++serial}-${crypto.randomBytes(8).toString('hex')}`;
    let handle;
    try {
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      handle = await fsp.open(temp, 'wx', 0o600);
      await handle.writeFile(body, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
      await handle.close();
      handle = null;
      await assertLockOwner(lockToken);
      await fsp.rename(temp, filePath);
      await fsyncDirectory();
      state = compacted;
      return clone(state);
    } catch (cause) {
      if (handle) {
        try { await handle.close(); } catch (_) {}
      }
      try { await fsp.unlink(temp); } catch (_) {}
      if (cause && (
        cause.code === 'LISTEN_JOURNAL_LOCK_LOST'
        || cause.code === 'LISTEN_JOURNAL_LOCK_TIMEOUT'
      )) {
        throw cause;
      }
      const error = new Error('JOURNAL_WRITE_FAILED');
      error.code = 'JOURNAL_WRITE_FAILED';
      error.causeCode = boundedString(cause && cause.code, 32, /^[A-Z0-9_]+$/) || '';
      throw error;
    }
  }

  async function readDocument(target) {
    if (typeof fsp.stat === 'function') {
      const stats = await fsp.stat(target);
      if (stats.size > ABSOLUTE_MAX_DOCUMENT_BYTES) {
        throw capacityError('LISTEN_JOURNAL_CAPACITY_EXCEEDED');
      }
    }
    const body = await fsp.readFile(target, 'utf8');
    if (Buffer.byteLength(body, 'utf8') > ABSOLUTE_MAX_DOCUMENT_BYTES) {
      throw capacityError('LISTEN_JOURNAL_CAPACITY_EXCEEDED');
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (_) {
      return null;
    }
    return normalizeDocument(parsed);
  }

  function compactLoaded(document, observedAt) {
    try {
      return compact(document.state, observedAt);
    } catch (error) {
      if (error && error.code === 'LISTEN_JOURNAL_CAPACITY') {
        throw capacityError('LISTEN_JOURNAL_CAPACITY_EXCEEDED');
      }
      throw error;
    }
  }

  async function inspectTempDocuments(temps) {
    const valid = [];
    const invalid = [];
    const protectedTemps = [];
    for (const temp of temps) {
      let before;
      try {
        if (typeof fsp.lstat !== 'function') {
          protectedTemps.push({ path: temp });
          continue;
        }
        before = await fsp.lstat(temp);
        if (!before.isFile() || before.isSymbolicLink()) {
          protectedTemps.push({ path: temp, stats: before });
          continue;
        }
        const document = await readDocument(temp);
        const after = await fsp.lstat(temp);
        if (
          !after.isFile()
          || after.isSymbolicLink()
          || !sameTempIdentity(before, after)
        ) {
          protectedTemps.push({ path: temp, stats: after });
          continue;
        }
        const candidate = { path: temp, document, stats: after };
        if (document) valid.push(candidate);
        else invalid.push(candidate);
      } catch (error) {
        if (error && error.code === 'LISTEN_JOURNAL_CAPACITY_EXCEEDED') {
          protectedTemps.push({ path: temp, stats: before });
          continue;
        }
        if (error && error.code !== 'ENOENT') throw error;
      }
    }
    return { valid, invalid, protected: protectedTemps };
  }

  async function assertRecoveryCandidate(candidate) {
    if (!candidate || !candidate.stats || typeof fsp.lstat !== 'function') {
      throw journalError('LISTEN_JOURNAL_CORRUPT', 503);
    }
    let current;
    try {
      current = await fsp.lstat(candidate.path);
    } catch (_) {
      throw journalError('LISTEN_JOURNAL_CORRUPT', 503);
    }
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || !sameTempIdentity(candidate.stats, current)
    ) {
      throw journalError('LISTEN_JOURNAL_CORRUPT', 503);
    }
  }

  function selectRecoveryCandidate(validTemps, observedAt) {
    if (!validTemps.length) return null;
    const candidates = validTemps.map(candidate => {
      const compacted = compactLoaded(candidate.document, observedAt);
      return {
        ...candidate,
        compacted,
        canonical: serialized(compacted),
      };
    });
    const canonical = candidates[0].canonical;
    if (candidates.some(candidate => candidate.canonical !== canonical)) {
      throw journalError('LISTEN_JOURNAL_CORRUPT', 503);
    }
    return candidates.sort((left, right) => left.path.localeCompare(right.path))[0];
  }

  async function publishRecoveredTemp(candidate, compacted, lockToken, corruptMain) {
    let quarantine = '';
    if (corruptMain) {
      quarantine = `${filePath}.corrupt-${instanceToken}-${crypto.randomBytes(8).toString('hex')}`;
      await assertLockOwner(lockToken);
      await fsp.rename(filePath, quarantine);
    }
    try {
      await assertLockOwner(lockToken);
      await assertRecoveryCandidate(candidate);
      await fsp.rename(candidate.path, filePath);
      state = compacted;
      if (
        candidate.document.migrated
        || serialized(compacted) !== serialized(candidate.document.state)
      ) {
        await persist(compacted, lockToken);
      } else {
        await fsyncDirectory();
      }
    } catch (error) {
      if (quarantine) {
        try {
          await fsp.rename(quarantine, filePath);
        } catch (_) {}
      }
      throw error;
    }
  }

  async function reloadUnderLock(lockToken, deferPersist) {
    const observedAt = boundedInteger(clock(), 0, Number.MAX_SAFE_INTEGER) || 0;
    let mainExists = true;
    let document = null;
    try {
      document = await readDocument(filePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') mainExists = false;
      else throw error;
    }
    const temps = await listTemps();
    const inspected = await inspectTempDocuments(temps);
    if (mainExists && document) {
      const compacted = compactLoaded(document, observedAt);
      if (
        !deferPersist
        && (
          document.migrated
          || serialized(compacted) !== serialized(document.state)
        )
      ) {
        await persist(compacted, lockToken);
      } else {
        state = compacted;
      }
      await cleanupInspectedTemps(inspected.valid.concat(inspected.invalid));
      return clone(state);
    }

    const validTemps = inspected.valid;
    await cleanupInspectedTemps(inspected.invalid);
    if (mainExists && !document) {
      if (validTemps.length) {
        const candidate = selectRecoveryCandidate(validTemps, observedAt);
        await publishRecoveredTemp(candidate, candidate.compacted, lockToken, true);
        await cleanupInspectedTemps(validTemps);
        await cleanupLegacyTemps(inspected);
        return clone(state);
      }
      throw journalError('LISTEN_JOURNAL_CORRUPT', 503);
    }

    if (validTemps.length) {
      const candidate = selectRecoveryCandidate(validTemps, observedAt);
      await publishRecoveredTemp(candidate, candidate.compacted, lockToken, false);
      await cleanupInspectedTemps(validTemps);
      await cleanupLegacyTemps(inspected);
      return clone(state);
    }
    await cleanupLegacyTemps(inspected);
    state = compact(emptyState(), observedAt);
    return clone(state);
  }

  function updateEntry(key, updater) {
    const current = state.entries[key];
    if (!current) return null;
    const next = normalizeEntry(updater(clone(current)), key);
    if (!next) {
      const error = new Error('JOURNAL_ENTRY_INVALID');
      error.code = 'JOURNAL_ENTRY_INVALID';
      throw error;
    }
    return next;
  }

  return Object.freeze({
    load() {
      return enqueue(() => withLock(reloadUnderLock));
    },

    snapshot() {
      return enqueue(() => withLock(reloadUnderLock));
    },

    get(key) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        const value = state.entries[String(key || '')];
        return value ? clone(value) : null;
      }));
    },

    put(value) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken, true);
        const candidate = normalizeEntry(value, value && value.key);
        const now = trustedNow();
        const normalized = candidate && normalizeEntry({
          ...candidate,
          createdAt: now,
          updatedAt: now,
        }, candidate.key);
        if (!normalized) {
          const error = new Error('JOURNAL_ENTRY_INVALID');
          error.code = 'JOURNAL_ENTRY_INVALID';
          throw error;
        }
        const existing = state.entries[normalized.key];
        if (existing) {
          if (existing.eventDigest !== normalized.eventDigest) {
            throw journalError('LISTEN_SESSION_CONFLICT', 409);
          }
          return clone(existing);
        }
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [normalized.key]: normalized },
        }, lockToken);
        return clone(state.entries[normalized.key]);
      }));
    },

    claim(key, digest, owner) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        key = String(key || '');
        digest = boundedString(digest, 64, /^[a-f0-9]{64}$/);
        const current = state.entries[key];
        if (!current || !digest) {
          throw journalError('JOURNAL_ENTRY_INVALID', 422);
        }
        if (current.eventDigest !== digest) {
          throw journalError('LISTEN_SESSION_CONFLICT', 409);
        }
        const now = trustedNow();
        if (
          current.status === 'submitted'
          || current.status === 'unsupported'
          || current.status === 'uncertain'
          || (
            current.status === 'claimed'
            && (
              current.claimPhase === 'started'
              || current.claimExpiresAt > now
            )
          )
          || (current.status === 'pending' && current.nextAttemptAt > now)
        ) {
          return { acquired: false, token: '', entry: clone(current) };
        }
        const token = crypto.randomBytes(32).toString('hex');
        const ownerHash = crypto.createHash('sha256')
          .update(String(owner || ''), 'utf8')
          .digest('hex');
        const claimed = normalizeEntry({
          ...current,
          status: 'claimed',
          claimToken: token,
          claimOwner: ownerHash,
          claimPhase: 'reserved',
          claimExpiresAt: now + claimLeaseMs,
          updatedAt: now,
        }, key);
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [key]: claimed },
        }, lockToken);
        return { acquired: true, token, entry: clone(claimed) };
      }));
    },

    markClaimStarted(key, token, leaseMs) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        key = String(key || '');
        token = boundedString(token, 64, /^[a-f0-9]{64}$/);
        const current = state.entries[key];
        if (
          !current
          || current.status !== 'claimed'
          || current.claimPhase !== 'reserved'
          || !token
          || current.claimToken !== token
        ) {
          throw journalError('LISTEN_PROVIDER_CLAIM_LOST', 409);
        }
        const now = trustedNow();
        const requestedLease = boundedInteger(
          leaseMs,
          1,
          10 * 60 * 1000,
        ) || claimLeaseMs;
        const updated = normalizeEntry({
          ...current,
          claimPhase: 'started',
          claimExpiresAt: now + requestedLease,
          updatedAt: now,
        }, key);
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [key]: updated },
        }, lockToken);
        return clone(updated);
      }));
    },

    markUncertain(key, token, errorCode) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        key = String(key || '');
        token = boundedString(token, 64, /^[a-f0-9]{64}$/);
        const current = state.entries[key];
        if (!current) return null;
        if (current.status === 'uncertain' || current.status === 'submitted') {
          return clone(current);
        }
        if (
          current.status !== 'claimed'
          || !token
          || current.claimToken !== token
        ) {
          throw journalError('LISTEN_PROVIDER_CLAIM_LOST', 409);
        }
        const now = trustedNow();
        const updated = normalizeEntry({
          ...current,
          status: 'uncertain',
          nextAttemptAt: 0,
          lastErrorCode: ERROR_CODES.has(errorCode)
            ? errorCode
            : 'PROVIDER_UNCERTAIN',
          updatedAt: now,
        }, key);
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [key]: updated },
        }, lockToken);
        return clone(updated);
      }));
    },

    releaseClaimFailure(key, token, errorCode) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        key = String(key || '');
        token = boundedString(token, 64, /^[a-f0-9]{64}$/);
        const current = state.entries[key];
        if (
          !current
          || current.status !== 'claimed'
          || !token
          || current.claimToken !== token
        ) {
          throw journalError('LISTEN_PROVIDER_CLAIM_LOST', 409);
        }
        const now = trustedNow();
        const attempts = current.attempts + 1;
        const retryDelay = Math.min(
          maxRetryMs,
          baseRetryMs * (2 ** Math.min(30, attempts - 1)),
        );
        const updated = normalizeEntry({
          ...current,
          status: 'pending',
          attempts,
          nextAttemptAt: now + retryDelay,
          lastErrorCode: ERROR_CODES.has(errorCode)
            ? errorCode
            : 'PROVIDER_FAILED',
          updatedAt: now,
        }, key);
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [key]: updated },
        }, lockToken);
        return clone(updated);
      }));
    },

    markFailure(key, errorCode) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        const now = trustedNow();
        const updated = updateEntry(String(key || ''), current => {
          if (current.status !== 'pending') return current;
          const attempts = current.attempts + 1;
          const delay = Math.min(maxRetryMs, baseRetryMs * (2 ** Math.min(30, attempts - 1)));
          return {
            ...current,
            attempts,
            nextAttemptAt: now + delay,
            lastErrorCode: ERROR_CODES.has(errorCode) ? errorCode : 'PROVIDER_FAILED',
            updatedAt: now,
          };
        });
        if (!updated) return null;
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [updated.key]: updated },
        }, lockToken);
        return clone(updated);
      }));
    },

    markSubmitted(key, token) {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        const current = state.entries[String(key || '')];
        if (
          current
          && current.status === 'claimed'
          && (
            !boundedString(token, 64, /^[a-f0-9]{64}$/)
            || current.claimToken !== token
          )
        ) {
          throw journalError('LISTEN_PROVIDER_CLAIM_LOST', 409);
        }
        const now = trustedNow();
        const updated = updateEntry(String(key || ''), current => ({
          ...current,
          status: 'submitted',
          nextAttemptAt: 0,
          lastErrorCode: '',
          updatedAt: now,
          event: { ...current.event, completeness: 'complete' },
        }));
        if (!updated) return null;
        if (state.entries[updated.key].status === 'submitted') return clone(state.entries[updated.key]);
        await persist({
          version: LISTEN_JOURNAL_SCHEMA,
          entries: { ...state.entries, [updated.key]: updated },
        }, lockToken);
        return clone(updated);
      }));
    },

    due() {
      return enqueue(() => withLock(async lockToken => {
        await reloadUnderLock(lockToken);
        const now = trustedNow();
        let changed = false;
        const entries = { ...state.entries };
        for (const item of Object.values(entries)) {
          if (item.status !== 'claimed' || item.claimExpiresAt > now) continue;
          changed = true;
          entries[item.key] = normalizeEntry({
            ...item,
            status: item.claimPhase === 'started' ? 'uncertain' : 'pending',
            nextAttemptAt: item.claimPhase === 'started' ? 0 : now,
            lastErrorCode: item.claimPhase === 'started'
              ? 'PROVIDER_UNCERTAIN'
              : item.lastErrorCode,
            updatedAt: now,
          }, item.key);
        }
        if (changed) {
          await persist({
            version: LISTEN_JOURNAL_SCHEMA,
            entries,
          }, lockToken);
        }
        return Object.values(state.entries)
          .filter(item => item.status === 'pending' && item.nextAttemptAt <= now)
          .sort((left, right) => (
            left.nextAttemptAt - right.nextAttemptAt
            || left.createdAt - right.createdAt
            || left.key.localeCompare(right.key)
          ))
          .map(clone);
      }));
    },
  });
}

module.exports = {
  LISTEN_JOURNAL_SCHEMA,
  createListenJournal,
};
