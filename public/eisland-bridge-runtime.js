(function exposeEislandBridgeRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioEislandBridgeRuntime = api;
}(typeof globalThis === 'object' ? globalThis : this, function createApi() {
  const TRACK_SOURCES = new Set(['netease', 'qq', 'local', 'podcast']);

  function createEislandBridgeTransitionGate() {
    let activeToken = null;
    let failedToken = null;
    let pending = false;

    function normalizeToken(value) {
      const token = Number(value);
      return Number.isSafeInteger(token) && token >= 0 ? token : null;
    }

    function matches(token) {
      return activeToken !== null && activeToken === normalizeToken(token);
    }

    return {
      begin(token) {
        const normalized = normalizeToken(token);
        if (normalized === null) return false;
        activeToken = normalized;
        failedToken = null;
        pending = true;
        return true;
      },
      complete(token) {
        if (!pending || !matches(token)) return false;
        pending = false;
        failedToken = null;
        return true;
      },
      fail(token) {
        if (!pending || !matches(token)) return false;
        pending = false;
        failedToken = activeToken;
        return true;
      },
      recover(token) {
        if (pending || !matches(token) || failedToken !== activeToken) return false;
        failedToken = null;
        return true;
      },
      getState() {
        return {
          failed: !pending && failedToken === activeToken,
          pending,
          token: activeToken,
        };
      },
    };
  }


  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegativeMilliseconds(value) {
    const number = finiteNumber(value, 0);
    if (number <= 0) return 0;
    return Math.round(number);
  }

  function secondsToMilliseconds(value) {
    const number = finiteNumber(value, 0);
    if (number <= 0) return 0;
    return Math.round(number * 1_000);
  }

  function songDurationMilliseconds(song) {
    if (song?.durationMs != null) return nonNegativeMilliseconds(song.durationMs);
    if (song?.dt != null) return nonNegativeMilliseconds(song.dt);
    return secondsToMilliseconds(song?.duration);
  }

  function lyricStartMilliseconds(line) {
    if (line?.startMs != null) return nonNegativeMilliseconds(line.startMs);
    return secondsToMilliseconds(line?.t ?? line?.start);
  }

  function lyricEndMilliseconds(line) {
    return line?.endMs != null ? nonNegativeMilliseconds(line.endMs) : 0;
  }

  function lyricDurationMilliseconds(line) {
    if (line?.durationMs != null) return nonNegativeMilliseconds(line.durationMs);
    return secondsToMilliseconds(line?.duration);
  }

  function safeText(value, maxLength = 512) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
  }

  function safeIdentifier(value) {
    const identifier = safeText(String(value == null ? '' : value), 256);
    return /^[a-z0-9._:-]+$/i.test(identifier) ? identifier : '';
  }

  function sourceForSong(song) {
    const raw = safeText(song?.source || song?.provider || song?.type, 32).toLowerCase();
    if (raw === 'qq') return 'qq';
    if (raw === 'podcast') return 'podcast';
    if (
      raw === 'local'
      || raw === 'local-library'
      || !!song?.localKey
      || !!song?.localUrl
    ) return 'local';
    return 'netease';
  }

  function artistForSong(song) {
    if (typeof song?.artist === 'string') return safeText(song.artist);
    const artists = Array.isArray(song?.artist)
      ? song.artist
      : Array.isArray(song?.ar)
        ? song.ar
        : [];
    return artists
      .map((artist) => safeText(artist?.name || artist))
      .filter(Boolean)
      .join(' / ')
      .slice(0, 512);
  }

  function isSafeCoverUrl(value) {
    const text = safeText(value, 2_048);
    if (!text) return false;
    let parsed;
    try {
      parsed = new URL(text);
    } catch {
      return false;
    }
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.hash
    ) return false;
    for (const key of parsed.searchParams.keys()) {
      if (/(?:token|auth|secret|cookie|credential|signature|api[-_]?key|session)|(?:^|[-_])sig(?:$|[-_])/i.test(key)) {
        return false;
      }
    }
    let pathname = parsed.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    return !/(?:^|\/)(?:audio|stream)(?:\/|$)|\.(?:mp3|m4a|aac|flac|ogg|opus|wav|webm)$/i.test(pathname);
  }
  function coverUrlForSong(song) {
    const candidates = [song?.cover, song?.coverUrl, song?.picUrl, song?.al?.picUrl];
    for (const candidate of candidates) {
      const value = safeText(candidate, 2_048);
      if (isSafeCoverUrl(value)) return value;
    }
    return '';
  }

  function currentSongForPlayer(player) {
    const queue = Array.isArray(player?.playQueue) ? player.playQueue : [];
    const index = Number.isInteger(player?.currentIdx) ? player.currentIdx : -1;
    if (index >= 0 && queue[index] && typeof queue[index] === 'object') return queue[index];
    if (player?.currentLocalSong && typeof player.currentLocalSong === 'object') return player.currentLocalSong;
    return null;
  }

  function projectTrack(player, audio) {
    const song = currentSongForPlayer(player);
    if (!song) return null;

    const source = sourceForSong(song);
    const rawId = safeIdentifier(song.id ?? song.mid ?? song.songmid ?? song.programId);
    const runtimeToken = Math.max(0, Math.trunc(finiteNumber(player?.trackSwitchToken, 0)));
    const id = rawId ? `${source}:${rawId}` : `${source}:runtime:${runtimeToken}`;
    const durationMs = secondsToMilliseconds(audio?.duration) || songDurationMilliseconds(song);
    const track = {
      id,
      source: TRACK_SOURCES.has(source) ? source : 'netease',
      title: safeText(song.name || song.title),
      artist: artistForSong(song),
      durationMs,
    };
    const album = safeText(song.album || song.al?.name);
    const coverUrl = coverUrlForSong(song);
    if (album) track.album = album;
    if (coverUrl) track.coverUrl = coverUrl;
    return track;
  }

  function projectLyrics(player, track) {
    if (!track) {
      return { trackId: null, status: 'unavailable', lines: [] };
    }
    const sourceLines = Array.isArray(player?.lyricsLines) ? player.lyricsLines : [];
    const visibleLines = sourceLines.filter((line) => line && !line.fallback && safeText(line.text));
    const lines = visibleLines.map((line, index) => {
      const startMs = lyricStartMilliseconds(line);
      const next = visibleLines[index + 1];
      const nextStartMs = next ? lyricStartMilliseconds(next) : 0;
      const explicitEndMs = lyricEndMilliseconds(line);
      const durationMs = lyricDurationMilliseconds(line);
      const endMs = explicitEndMs > startMs
        ? explicitEndMs
        : nextStartMs > startMs
          ? nextStartMs
          : durationMs > 0
            ? startMs + durationMs
            : 0;
      const projected = { startMs, text: safeText(line.text, 4_096) };
      const translation = safeText(line.translation || line.translated || line.trans, 4_096);
      if (endMs > startMs) projected.endMs = endMs;
      if (translation) projected.translation = translation;
      return projected;
    });
    return {
      trackId: track.id,
      status: lines.length ? 'ready' : 'unavailable',
      lines,
    };
  }

  function projectState(player, audio, track) {
    const hasTrack = Boolean(track);
    const durationMs = hasTrack ? secondsToMilliseconds(audio?.duration) || track.durationMs || 0 : 0;
    const positionMs = hasTrack ? Math.min(secondsToMilliseconds(audio?.currentTime), durationMs || Infinity) : 0;
    const rate = finiteNumber(audio?.playbackRate, 1);
    const hasAudio = !!audio;
    const hasQueue = Array.isArray(player?.playQueue) && player.playQueue.length > 0;
    const status = !hasTrack
      ? 'stopped'
      : hasAudio && !audio.paused && !audio.ended
        ? 'playing'
        : hasAudio && !audio.ended
          ? 'paused'
          : 'stopped';
    return {
      playback: {
        durationMs,
        positionMs,
        rate: rate > 0 ? rate : 1,
        status,
      },
      capabilities: {
        next: hasQueue,
        pause: hasTrack && hasAudio && !audio.paused,
        play: hasTrack,
        previous: hasQueue,
        seek: hasTrack && hasAudio && durationMs > 0,
      },
    };
  }

  function createEislandBridgeRuntime({
    getPlayer = () => ({}),
    now = () => Date.now(),
    publishHeartbeat = () => {},
    publishState = () => {},
    completeCommand = () => {},
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    commandTimeoutMs = 1_500,
  } = {}) {
    const clock = typeof now === 'function' ? now : () => Date.now();
    const sendHeartbeat = typeof publishHeartbeat === 'function' ? publishHeartbeat : () => {};
    const sendState = typeof publishState === 'function' ? publishState : () => {};
    const sendCommandCompletion = typeof completeCommand === 'function' ? completeCommand : () => {};
    const scheduleTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const cancelTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout;
    const timeoutMs = Math.max(1, Math.trunc(finiteNumber(commandTimeoutMs, 1_500)));
    let heartbeatTimer = null;
    let lastTimeUpdateAtMs = Number.NEGATIVE_INFINITY;

    function hasMismatchedBridgeAudioToken(player) {
      const audio = player?.audio && typeof player.audio === 'object' ? player.audio : null;
      const audioToken = Number(audio?._mineradioBridgeTrackToken);
      const trackToken = Number(player?.trackSwitchToken);
      return (
        Number.isSafeInteger(audioToken)
        && Number.isSafeInteger(trackToken)
        && audioToken !== trackToken
      );
    }


    function createSnapshot(playerOverride) {
      const player = playerOverride || getPlayer() || {};
      const transitionFailed = Boolean(player.bridgeTransitionFailed);
      const audio = !transitionFailed && player.audio && typeof player.audio === 'object' ? player.audio : null;
      const track = transitionFailed ? null : projectTrack(player, audio);
      return {
        state: projectState(player, audio, track),
        track,
        lyrics: projectLyrics(player, track),
      };
    }

    function publishWith(sender, commandAttempt = '') {
      const player = getPlayer() || {};
      if (
        player.bridgeTransitionPending
        || (!player.bridgeTransitionFailed && hasMismatchedBridgeAudioToken(player))
      ) return null;
      const snapshot = createSnapshot(player);
      const taggedAttempt = receiptField(commandAttempt);
      if (taggedAttempt) snapshot.commandAttempt = taggedAttempt;
      sender(snapshot);
      return snapshot;
    }

    function start() {
      if (heartbeatTimer !== null) return false;
      publishWith(sendState);
      heartbeatTimer = setIntervalFn(() => {
        if (heartbeatTimer !== null) publishWith(sendHeartbeat);
      }, 1_000);
      return true;
    }

    function stop() {
      if (heartbeatTimer === null) return false;
      clearIntervalFn(heartbeatTimer);
      heartbeatTimer = null;
      return true;
    }

    function publishPlayerEvent(eventName) {
      if (heartbeatTimer === null) return false;
      if (eventName === 'timeupdate') {
        const currentTime = finiteNumber(clock(), 0);
        if (currentTime - lastTimeUpdateAtMs < 250) return false;
        lastTimeUpdateAtMs = currentTime;
      }
      return Boolean(publishWith(sendState));
    }

    function createCommandError(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }

    function getPlayerAudio() {
      const player = getPlayer() || {};
      const audio = player.audio && typeof player.audio === 'object' ? player.audio : null;
      return { audio, player };
    }

    function awaitOperation(operation, {
      failureCode,
      failureMessage,
      timeoutCode,
      timeoutMessage,
    }) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutHandle = null;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          if (timeoutHandle !== null && timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
          callback(value);
        };
        try {
          timeoutHandle = scheduleTimeout(() => {
            settle(reject, createCommandError(timeoutCode, timeoutMessage));
          }, timeoutMs);
        } catch {
          timeoutHandle = null;
        }
        Promise.resolve(operation).then(
          (value) => settle(resolve, value),
          () => settle(reject, createCommandError(failureCode, failureMessage)),
        );
      });
    }

    function createAudioEventWaiter(audio, eventName, details) {
      if (
        typeof audio?.addEventListener !== 'function'
        || typeof audio?.removeEventListener !== 'function'
      ) {
        throw createCommandError(details.unavailableCode, details.unavailableMessage);
      }
      let cancelWait = () => {};
      const promise = new Promise((resolve, reject) => {
        let settled = false;
        let listening = false;
        let timeoutHandle = null;
        const onEvent = () => settle(resolve, true);
        const cleanup = () => {
          if (listening) {
            audio.removeEventListener(eventName, onEvent);
            listening = false;
          }
          if (timeoutHandle !== null && timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        cancelWait = () => settle(resolve, false);
        try {
          audio.addEventListener(eventName, onEvent);
          listening = true;
          timeoutHandle = scheduleTimeout(() => {
            settle(reject, createCommandError(details.timeoutCode, details.timeoutMessage));
          }, timeoutMs);
        } catch {
          settle(reject, createCommandError(details.unavailableCode, details.unavailableMessage));
        }
      });
      return { cancel: cancelWait, promise };
    }

    async function runPlayerAction(player, methodName, details) {
      const method = player && typeof player[methodName] === 'function' ? player[methodName] : null;
      if (!method) throw createCommandError(details.unavailableCode, details.unavailableMessage);
      let operation;
      try {
        operation = method.call(player);
      } catch {
        throw createCommandError(details.failureCode, details.failureMessage);
      }
      return await awaitOperation(operation, details);
    }

    async function runPlaybackAction(player, audio, action) {
      const pauseWaiter = action === 'pause'
        ? createAudioEventWaiter(audio, 'pause', {
          timeoutCode: 'pause-timeout',
          timeoutMessage: 'Timed out waiting for the Audio pause event.',
          unavailableCode: 'pause-events-unavailable',
          unavailableMessage: 'The Audio element cannot confirm pause events.',
        })
        : null;
      try {
        const actionPromise = runPlayerAction(player, action, {
          failureCode: 'playback-command-failed',
          failureMessage: `The player could not ${action}.`,
          timeoutCode: 'playback-command-timeout',
          timeoutMessage: `Timed out waiting for the player to ${action}.`,
          unavailableCode: 'playback-control-unavailable',
          unavailableMessage: `The player cannot ${action}.`,
        });
        if (pauseWaiter) await Promise.all([actionPromise, pauseWaiter.promise]);
        else await actionPromise;
      } catch (error) {
        if (pauseWaiter) pauseWaiter.cancel();
        throw error;
      }
      const completedAudio = getPlayerAudio().audio || audio;
      if (!completedAudio) {
        throw createCommandError('playback-state-not-updated', 'The player did not create an Audio element.');
      }
      const reachedExpectedState = action === 'pause'
        ? Boolean(completedAudio.paused || completedAudio.ended)
        : !completedAudio.paused && !completedAudio.ended;
      if (!reachedExpectedState) {
        const expected = action === 'pause' ? 'paused' : 'playing';
        throw createCommandError(
          'playback-state-not-updated',
          `The player did not enter the expected ${expected} state.`,
        );
      }
    }

    async function runTrackChange(player, methodName, direction) {
      if (!Array.isArray(player?.playQueue) || player.playQueue.length === 0) {
        throw createCommandError(
          'queue-empty',
          `Cannot move to the ${direction} track because the queue is empty.`,
        );
      }
      const outcome = await runPlayerAction(player, methodName, {
        failureCode: 'track-change-failed',
        failureMessage: `The player could not move to the ${direction} track.`,
        timeoutCode: 'track-change-timeout',
        timeoutMessage: `Timed out waiting for the ${direction} track.`,
        unavailableCode: 'track-change-unavailable',
        unavailableMessage: `The player cannot move to the ${direction} track.`,
      });
      if (outcome !== true) {
        throw createCommandError(
          'track-change-failed',
          `The player could not move to the ${direction} track.`,
        );
      }
    }

    function seekAudio(audio, positionMs) {
      if (
        typeof audio?.addEventListener !== 'function'
        || typeof audio?.removeEventListener !== 'function'
      ) {
        throw createCommandError(
          'seek-events-unavailable',
          'The Audio element cannot confirm seeked events.',
        );
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let listening = false;
        let timeoutHandle = null;
        const cleanup = () => {
          if (listening) {
            audio.removeEventListener('seeked', onSeeked);
            listening = false;
          }
          if (timeoutHandle !== null && timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        const onSeeked = () => settle(resolve);
        try {
          audio.addEventListener('seeked', onSeeked);
          listening = true;
          timeoutHandle = scheduleTimeout(() => {
            settle(reject, createCommandError('seek-timeout', 'Timed out waiting for the Audio seeked event.'));
          }, timeoutMs);
          audio.currentTime = positionMs / 1_000;
        } catch {
          settle(reject, createCommandError('seek-failed', 'Unable to set the Audio playback position.'));
        }
      });
    }

    function readSeekPosition(request, audio) {
      const positionMs = request?.payload?.positionMs;
      if (!Number.isSafeInteger(positionMs) || positionMs < 0) {
        throw createCommandError('invalid-seek-position', 'Seek positionMs must be a non-negative safe integer.');
      }
      const durationMs = secondsToMilliseconds(audio.duration);
      return durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
    }

    async function executeCommand(request, commandAttempt = '') {
      const command = typeof request?.command === 'string' ? request.command.trim() : '';
      const { audio, player } = getPlayerAudio();
      const shouldPlay = !audio || Boolean(audio.paused || audio.ended);
      const hasPlayableTrack = Boolean(currentSongForPlayer(player));
      if ((command === 'play' || command === 'pause' || command === 'seek' || command === 'toggle') && !hasPlayableTrack) {
        throw createCommandError('no-playable-track', 'No current track is available for playback control.');
      }
      if (command === 'play') {
        if (shouldPlay) await runPlaybackAction(player, audio, 'play');
      } else if (command === 'pause') {
        if (!audio) {
          throw createCommandError('audio-unavailable', 'No Audio element is available for playback control.');
        }
        if (!shouldPlay) await runPlaybackAction(player, audio, 'pause');
      } else if (command === 'toggle') {
        await runPlaybackAction(player, audio, shouldPlay ? 'play' : 'pause');
      } else if (command === 'next') {
        await runTrackChange(player, 'nextTrack', 'next');
      } else if (command === 'previous') {
        await runTrackChange(player, 'prevTrack', 'previous');
      } else if (command === 'seek') {
        if (!audio) {
          throw createCommandError('audio-unavailable', 'No Audio element is available for playback control.');
        }
        await seekAudio(audio, readSeekPosition(request, audio));
      } else {
        throw createCommandError('unsupported-command', `Unsupported player command: ${command || '(empty)'}.`);
      }
      return publishWith(sendState, commandAttempt);
    }

    function receiptField(value) {
      return value == null ? '' : String(value).slice(0, 128);
    }

    function commandResultFromSnapshot(snapshot) {
      return {
        accepted: true,
        state: snapshot.state,
        track: snapshot.track,
      };
    }

    async function handleCommand(request) {
      const attempt = receiptField(request?.attempt);
      const requestId = receiptField(request?.requestId);
      try {
        const snapshot = await executeCommand(request, attempt);
        sendCommandCompletion({
          attempt,
          ok: true,
          requestId,
          result: commandResultFromSnapshot(snapshot),
        });
        return snapshot;
      } catch (error) {
        const code = typeof error?.code === 'string' ? error.code : 'renderer-command-failed';
        sendCommandCompletion({
          attempt,
          error: { code },
          ok: false,
          requestId,
        });
        return null;
      }
    }

    return { createSnapshot, executeCommand, handleCommand, publishPlayerEvent, start, stop };
  }

  return {
    createEislandBridgeRuntime,
    createEislandBridgeTransitionGate,
  };
}));
