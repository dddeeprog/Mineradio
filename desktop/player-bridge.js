const RENDERER_HEARTBEAT_MS = 1_000;
const STATE_TTL_MS = 2_500;
const RENDERER_COMMAND_TIMEOUT_MS = 1_500;
const COMMAND_RESULT_CACHE_TTL_MS = 30_000;
const COMMAND_RESULT_CACHE_MAX_ENTRIES = 256;

function isMediaContextKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /^(audio|stream|music|media|playback|player)$/.test(normalized);
}

function isSensitiveKey(key, inMediaContext = false) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (normalized.includes('cookie') || normalized.includes('account')) return true;
  if (/(audio|stream|music|play)(url|src)$/.test(normalized)) return true;
  if (normalized === 'url') return true;
  if (inMediaContext && ['src', 'source', 'url', 'uri', 'href'].includes(normalized)) return true;
  return false;
}

function normalizeValue(value, inMediaContext = false) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, inMediaContext));
  if (typeof value !== 'object') return null;

  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    if (isSensitiveKey(key, inMediaContext)) continue;
    const next = normalizeValue(value[key], inMediaContext || isMediaContextKey(key));
    if (next !== undefined) normalized[key] = next;
  }
  return normalized;
}

function normalizeSection(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  return normalizeValue(section);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneValue(value) {
  return normalizeValue(value);
}

function cloneSection(section) {
  return section == null ? null : cloneValue(section);
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
  let activeCommand = null;
  const queuedCommands = [];
  const pendingCommands = new Map();
  const resultCache = new Map();
  const makeRequestId = typeof createRequestId === 'function'
    ? createRequestId
    : () => `player-command-${clock()}-${++generatedRequestNumber}`;
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
    const normalized = normalizeSection(error);
    if (normalized && Object.keys(normalized).length > 0) return normalized;
    return { code: fallbackCode };
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
    if (activeCommand || queuedCommands.length === 0) return;

    const command = queuedCommands.shift();
    activeCommand = command;
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

    command.promise = new Promise((resolve) => {
      command.resolve = resolve;
    });
    pendingCommands.set(command.requestId, command);
    queuedCommands.push(command);
    dispatchNextCommand();
    return command.promise;
  }

  function receiveCommandReceipt(receipt) {
    const requestId = receipt?.requestId == null ? '' : String(receipt.requestId);
    if (!activeCommand || activeCommand.requestId !== requestId) return false;

    const response = receipt?.ok === false
      ? {
        requestId,
        ok: false,
        error: normalizeCommandError(receipt.error, 'renderer-command-failed'),
      }
      : {
        requestId,
        ok: true,
        result: cloneValue(receipt?.result),
      };
    return completeCommand(activeCommand, response);
  }

  return {
    enqueueCommand,
    getState,
    receiveCommandReceipt,
    receiveHeartbeat,
  };
}

module.exports = {
  COMMAND_RESULT_CACHE_MAX_ENTRIES,
  COMMAND_RESULT_CACHE_TTL_MS,
  RENDERER_COMMAND_TIMEOUT_MS,
  RENDERER_HEARTBEAT_MS,
  STATE_TTL_MS,
  createPlayerBridge,
};
