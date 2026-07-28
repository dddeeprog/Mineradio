const { randomUUID } = require('node:crypto');

const RENDERER_HEARTBEAT_MS = 1_000;
const STATE_TTL_MS = 2_500;
const RENDERER_COMMAND_TIMEOUT_MS = 1_500;
const COMMAND_RESULT_CACHE_TTL_MS = 30_000;
const COMMAND_RESULT_CACHE_MAX_ENTRIES = 256;
const COMMAND_QUEUE_MAX_ENTRIES = 256;

const DROP_VALUE = Symbol('drop-value');
const PUBLIC_CONTAINER_KEYS = new Set([
  'audio',
  'colors',
  'media',
  'metadata',
  'music',
  'playback',
  'playbackstate',
  'player',
  'state',
  'stream',
  'timing',
  'track',
  'transport',
  'variants',
]);
const PUBLIC_VALUE_KEYS = new Set([
  'accepted',
  'album',
  'albumid',
  'artist',
  'at',
  'cover',
  'coverurl',
  'currenttime',
  'duration',
  'enabled',
  'end',
  'glow',
  'highlight',
  'id',
  'index',
  'language',
  'level',
  'line',
  'lines',
  'mode',
  'moved',
  'muted',
  'name',
  'offset',
  'ok',
  'paused',
  'playing',
  'position',
  'primary',
  'progress',
  'rate',
  'repeat',
  'romanized',
  'secondary',
  'seconds',
  'seeked',
  'shuffle',
  'start',
  'status',
  'text',
  'time',
  'timestamp',
  'title',
  'trackid',
  'translation',
  'translations',
  'visible',
  'volume',
]);

const COMMAND_RESULT_BOOLEAN_KEYS = new Set([
  'accepted',
  'current',
  'enabled',
  'moved',
  'muted',
  'paused',
  'playing',
  'repeat',
  'seeked',
  'shuffle',
]);
const COMMAND_RESULT_NUMBER_KEYS = new Set([
  'currenttime',
  'duration',
  'index',
  'position',
  'progress',
  'rate',
  'seconds',
  'volume',
]);
const COMMAND_RESULT_TEXT_KEYS = new Set([
  'album',
  'artist',
  'id',
  'mode',
  'name',
  'status',
  'title',
  'trackid',
]);
const COMMAND_RESULT_SECTION_KEYS = new Set([
  'playbackstate',
  'state',
  'track',
]);

function normalizeKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isExternalUrl(value) {
  return typeof value === 'string' && /^(?:https?|blob|file):|^data:audio\//i.test(value);
}

function isMediaContextKey(key) {
  return /^(audio|stream|music|media|playback|player)$/.test(normalizeKey(key));
}

function isSensitiveTransportKey(key) {
  const normalized = normalizeKey(key);
  if (normalized === 'coverurl') return false;
  if (/(cookie|account|auth|token|credential|secret|header|authorization)/.test(normalized)) return true;
  return /(url|uri|source|src|href)$/.test(normalized);
}

function sanitizeTransportValue(value, inMediaContext = false) {
  if (value === undefined) return DROP_VALUE;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return inMediaContext && isExternalUrl(value) ? DROP_VALUE : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const normalized = [];
    for (const item of value) {
      const next = sanitizeTransportValue(item, inMediaContext);
      if (next !== DROP_VALUE) normalized.push(next);
    }
    return normalized;
  }
  if (typeof value !== 'object') return null;

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (isSensitiveTransportKey(key)) continue;
    const next = sanitizeTransportValue(value[key], inMediaContext || isMediaContextKey(key));
    if (next !== DROP_VALUE) normalized[key] = next;
  }
  return normalized;
}

function projectPublicValue(value, allowUrl = false) {
  if (value === undefined) return DROP_VALUE;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return !allowUrl && isExternalUrl(value) ? DROP_VALUE : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const projected = [];
    for (const item of value) {
      const next = projectPublicValue(item, allowUrl);
      if (next !== DROP_VALUE) projected.push(next);
    }
    return projected;
  }
  if (typeof value !== 'object') return null;

  const projected = {};
  for (const key of Object.keys(value).sort()) {
    const normalizedKey = normalizeKey(key);
    const rawValue = value[key];
    if (PUBLIC_CONTAINER_KEYS.has(normalizedKey)) {
      if (!rawValue || typeof rawValue !== 'object') continue;
      const next = projectPublicValue(rawValue);
      if (next !== DROP_VALUE) projected[key] = next;
      continue;
    }
    if (!PUBLIC_VALUE_KEYS.has(normalizedKey)) continue;
    const next = projectPublicValue(rawValue, normalizedKey === 'coverurl');
    if (next !== DROP_VALUE) projected[key] = next;
  }
  return projected;
}

function isCommandResultCoverUrl(value) {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value);
}

function projectCommandResultSection(value) {
  if (value === undefined) return DROP_VALUE;
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return isExternalUrl(value) ? DROP_VALUE : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const projected = [];
    for (const item of value) {
      const next = projectCommandResultSection(item);
      if (next !== DROP_VALUE) projected.push(next);
    }
    return projected;
  }
  if (typeof value !== 'object') return null;

  const projected = {};
  for (const key of Object.keys(value).sort()) {
    const normalizedKey = normalizeKey(key);
    const rawValue = value[key];
    if (PUBLIC_CONTAINER_KEYS.has(normalizedKey)) {
      if (!rawValue || typeof rawValue !== 'object') continue;
      const next = projectCommandResultSection(rawValue);
      if (next !== DROP_VALUE) projected[key] = next;
      continue;
    }
    if (!PUBLIC_VALUE_KEYS.has(normalizedKey)) continue;
    if (normalizedKey === 'coverurl') {
      if (isCommandResultCoverUrl(rawValue)) projected[key] = rawValue;
      continue;
    }
    const next = projectCommandResultSection(rawValue);
    if (next !== DROP_VALUE) projected[key] = next;
  }
  return Object.keys(projected).length > 0 ? projected : DROP_VALUE;
}

function projectCommandResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const projected = {};
  for (const key of Object.keys(value).sort()) {
    const normalizedKey = normalizeKey(key);
    const rawValue = value[key];
    if (COMMAND_RESULT_BOOLEAN_KEYS.has(normalizedKey)) {
      if (typeof rawValue === 'boolean') projected[key] = rawValue;
      continue;
    }
    if (COMMAND_RESULT_NUMBER_KEYS.has(normalizedKey)) {
      if (
        Number.isFinite(rawValue)
        && (normalizedKey !== 'progress' || (rawValue >= 0 && rawValue <= 1))
      ) projected[key] = rawValue;
      continue;
    }
    if (COMMAND_RESULT_TEXT_KEYS.has(normalizedKey)) {
      if (typeof rawValue === 'string' && rawValue.length <= 512) projected[key] = rawValue;
      continue;
    }
    if (normalizedKey === 'coverurl') {
      if (isCommandResultCoverUrl(rawValue)) projected[key] = rawValue;
      continue;
    }
    if (
      !COMMAND_RESULT_SECTION_KEYS.has(normalizedKey)
      || !rawValue
      || typeof rawValue !== 'object'
      || Array.isArray(rawValue)
    ) continue;
    const section = projectCommandResultSection(rawValue);
    if (section !== DROP_VALUE) projected[key] = section;
  }
  return projected;
}

function projectCommandError(error, fallbackCode) {
  const code = error && typeof error === 'object' && !Array.isArray(error) ? error.code : null;
  if (typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/i.test(code)) return { code };
  return { code: fallbackCode };
}

function normalizeSection(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  return projectPublicValue(section);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue(value) {
  return sanitizeTransportValue(value);
}

function cloneSection(section) {
  return section == null ? null : projectPublicValue(section);
}
function lyricsBelongToTrack(lyrics, track, requiresTrackBinding) {
  if (lyrics == null) return true;
  if (track == null) return false;
  const trackId = track?.id ?? track?.trackId;
  const lyricsTrackId = lyrics.trackId;
  if (requiresTrackBinding) {
    return trackId != null && lyricsTrackId != null && String(trackId) === String(lyricsTrackId);
  }
  return trackId == null || lyricsTrackId == null || String(trackId) === String(lyricsTrackId);
}

function createRequestConflictError(requestId) {
  const error = new Error(`A different command already uses requestId "${requestId}".`);
  error.code = 'request-id-conflict';
  return error;
}

function createPlayerBridge({
  clock = () => Date.now(),
  createRequestId,
  createAttemptId,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  dispatchCommand = () => {},
} = {}) {
  let generatedRequestNumber = 0;
  let updatedAtMs = null;
  let state = null;
  let track = null;
  let lyrics = null;
  let revision = 0;
  let trackRevision = 0;
  let lyricsRevision = 0;
  let requiresTrackBoundLyrics = false;
  let disposed = false;
  let activeCommand = null;
  const queuedCommands = [];
  const pendingCommands = new Map();
  const resultCache = new Map();
  const makeRequestId = typeof createRequestId === 'function'
    ? createRequestId
    : () => `player-command-${clock()}-${++generatedRequestNumber}`;
  const makeAttemptId = typeof createAttemptId === 'function' ? createAttemptId : randomUUID;
  const sendCommand = typeof dispatchCommand === 'function' ? dispatchCommand : () => {};

  function receiveHeartbeat(payload = {}) {
    const nextState = normalizeSection(payload.state);
    const nextTrack = normalizeSection(payload.track);
    const nextLyrics = normalizeSection(payload.lyrics);
    const trackChanged = !sameValue(track, nextTrack);
    const requiresTrackBinding = trackChanged || requiresTrackBoundLyrics;
    const acceptsLyrics = lyricsBelongToTrack(nextLyrics, nextTrack, requiresTrackBinding);
    const nextCurrentLyrics = acceptsLyrics ? nextLyrics : null;

    if (!sameValue(state, nextState)) {
      state = nextState;
      revision += 1;
    }
    if (trackChanged) {
      track = nextTrack;
      trackRevision += 1;
      requiresTrackBoundLyrics = true;
    }
    if (trackChanged && nextCurrentLyrics == null) {
      if (!sameValue(lyrics, null)) {
        lyrics = null;
        lyricsRevision += 1;
      }
    } else if (acceptsLyrics && !sameValue(lyrics, nextCurrentLyrics)) {
      lyrics = nextCurrentLyrics;
      lyricsRevision += 1;
    }
    updatedAtMs = clock();
  }

  function getState() {
    const status = updatedAtMs == null
      ? 'not-ready'
      : clock() - updatedAtMs < STATE_TTL_MS
        ? 'ready'
        : 'stale';
    const isReady = status === 'ready';

    return {
      status,
      updatedAtMs,
      revision,
      trackRevision,
      lyricsRevision,
      state: isReady ? cloneSection(state) : null,
      track: isReady ? cloneSection(track) : null,
      lyrics: isReady ? cloneSection(lyrics) : null,
    };
  }

  function normalizeCommandRequest(request) {
    const command = typeof request?.command === 'string' ? request.command.trim() : '';
    if (!command) throw new TypeError('A renderer command must have a command name.');

    const rawRequestId = request?.requestId == null ? makeRequestId() : request.requestId;
    const requestId = rawRequestId == null ? '' : String(rawRequestId);
    if (!requestId) throw new TypeError('A renderer command must have a requestId.');

    return {
      requestId,
      command,
      payload: cloneValue(request?.payload),
    };
  }

  function commandSignature(command) {
    return JSON.stringify({ command: command.command, payload: command.payload });
  }

  function pruneResultCache() {
    const now = clock();
    for (const [requestId, cached] of resultCache) {
      if (now - cached.completedAtMs >= COMMAND_RESULT_CACHE_TTL_MS) resultCache.delete(requestId);
    }
  }

  function cacheResult(command, response) {
    pruneResultCache();
    resultCache.delete(command.requestId);
    resultCache.set(command.requestId, {
      signature: command.signature,
      completedAtMs: clock(),
      response: cloneValue(response),
    });
    while (resultCache.size > COMMAND_RESULT_CACHE_MAX_ENTRIES) {
      resultCache.delete(resultCache.keys().next().value);
    }
  }

  function normalizeCommandError(error, fallbackCode) {
    return projectCommandError(error, fallbackCode);
  }

  function commandFailure(requestId, code) {
    return {
      requestId,
      ok: false,
      error: { code },
    };
  }

  function completeCommand(command, response) {
    if (activeCommand !== command) return false;
    if (command.timeoutHandle !== undefined && typeof clearTimeoutFn === 'function') {
      clearTimeoutFn(command.timeoutHandle);
    }
    activeCommand = null;
    pendingCommands.delete(command.requestId);
    cacheResult(command, response);
    command.resolve(cloneValue(response));
    dispatchNextCommand();
    return true;
  }

  function dispatchNextCommand() {
    if (disposed || activeCommand || queuedCommands.length === 0) return;

    const command = queuedCommands.shift();
    activeCommand = command;
    try {
      const rawAttempt = makeAttemptId();
      command.attempt = rawAttempt == null ? '' : String(rawAttempt);
      if (!command.attempt) throw new TypeError('A renderer command attempt must have an ID.');
    } catch (error) {
      completeCommand(command, {
        requestId: command.requestId,
        ok: false,
        error: { code: 'renderer-attempt-unavailable' },
      });
      return;
    }
    command.timeoutHandle = setTimeoutFn(() => {
      completeCommand(command, {
        requestId: command.requestId,
        ok: false,
        error: { code: 'renderer-timeout' },
      });
    }, RENDERER_COMMAND_TIMEOUT_MS);

    try {
      const dispatchResult = sendCommand({
        requestId: command.requestId,
        attempt: command.attempt,
        command: command.command,
        payload: cloneValue(command.payload),
      });
      if (dispatchResult && typeof dispatchResult.catch === 'function') {
        dispatchResult.catch(() => {
          completeCommand(command, {
            requestId: command.requestId,
            ok: false,
            error: { code: 'renderer-dispatch-failed' },
          });
        });
      }
    } catch (error) {
      completeCommand(command, {
        requestId: command.requestId,
        ok: false,
        error: normalizeCommandError(error, 'renderer-dispatch-failed'),
      });
    }
  }

  function enqueueCommand(request) {
    let command;
    try {
      command = normalizeCommandRequest(request);
    } catch (error) {
      return Promise.reject(error);
    }
    command.signature = commandSignature(command);
    if (disposed) return Promise.resolve(commandFailure(command.requestId, 'renderer-disposed'));

    pruneResultCache();
    const cached = resultCache.get(command.requestId);
    if (cached) {
      if (cached.signature !== command.signature) return Promise.reject(createRequestConflictError(command.requestId));
      resultCache.delete(command.requestId);
      resultCache.set(command.requestId, cached);
      return Promise.resolve(cloneValue(cached.response));
    }

    const pending = pendingCommands.get(command.requestId);
    if (pending) {
      if (pending.signature !== command.signature) return Promise.reject(createRequestConflictError(command.requestId));
      return pending.promise;
    }
    if (pendingCommands.size >= COMMAND_QUEUE_MAX_ENTRIES) {
      return Promise.resolve({
        requestId: command.requestId,
        ok: false,
        error: { code: 'renderer-queue-full' },
      });
    }

    command.promise = new Promise((resolve) => {
      command.resolve = resolve;
    });
    pendingCommands.set(command.requestId, command);
    queuedCommands.push(command);
    dispatchNextCommand();
    return command.promise;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;

    const active = activeCommand;
    activeCommand = null;
    if (active) {
      if (active.timeoutHandle !== undefined && typeof clearTimeoutFn === 'function') {
        clearTimeoutFn(active.timeoutHandle);
      }
      pendingCommands.delete(active.requestId);
      active.resolve(commandFailure(active.requestId, 'renderer-disposed'));
    }
    while (queuedCommands.length > 0) {
      const queued = queuedCommands.shift();
      pendingCommands.delete(queued.requestId);
      queued.resolve(commandFailure(queued.requestId, 'renderer-disposed'));
    }
    pendingCommands.clear();
    resultCache.clear();
    return true;
  }
  function receiveCommandReceipt(receipt) {
    const requestId = receipt?.requestId == null ? '' : String(receipt.requestId);
    const attempt = receipt?.attempt == null ? '' : String(receipt.attempt);
    if (
      !activeCommand
      || activeCommand.requestId !== requestId
      || activeCommand.attempt !== attempt
    ) return false;

    const response = receipt?.ok === false
      ? {
        requestId,
        ok: false,
        error: normalizeCommandError(receipt.error, 'renderer-command-failed'),
      }
      : {
        requestId,
        ok: true,
        result: projectCommandResult(receipt?.result),
      };
    return completeCommand(activeCommand, response);
  }

  return {
    dispose,
    enqueueCommand,
    getState,
    receiveCommandReceipt,
    receiveHeartbeat,
  };
}

module.exports = {
  COMMAND_QUEUE_MAX_ENTRIES,
  COMMAND_RESULT_CACHE_MAX_ENTRIES,
  COMMAND_RESULT_CACHE_TTL_MS,
  RENDERER_COMMAND_TIMEOUT_MS,
  RENDERER_HEARTBEAT_MS,
  STATE_TTL_MS,
  createPlayerBridge,
};
