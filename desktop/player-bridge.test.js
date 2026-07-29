const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEislandBridgeRuntime } = require('../public/eisland-bridge-runtime');

function loadPlayerBridge() {
  try {
    return require('./player-bridge');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function publishPostCommandHeartbeat(bridge, {
  state = { playback: { status: 'paused' } },
  commandAttempt = '',
  track = { source: 'netease', title: '桥接测试歌曲' },
} = {}) {
  const heartbeat = { state, track };
  if (commandAttempt) heartbeat.commandAttempt = commandAttempt;
  bridge.receiveHeartbeat(heartbeat);
}
test('returns_not_ready_then_stale_after_2500ms', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  assert.equal(typeof createPlayerBridge, 'function');

  let now = 10_000;
  const bridge = createPlayerBridge({ clock: () => now });

  assert.deepEqual(bridge.getState(), {
    status: 'not-ready',
    updatedAtMs: null,
    revision: 0,
    trackRevision: 0,
    lyricsRevision: 0,
    state: null,
    track: null,
    lyrics: null,
  });

  bridge.receiveHeartbeat({
    state: { visible: true, cookie: 'secret', account: { id: 'private' } },
    track: { id: 'song-a', title: 'Song A', audioUrl: 'https://audio.example/song-a.mp3' },
    lyrics: { trackId: 'song-a', lines: ['hello'] },
  });

  assert.deepEqual(bridge.getState(), {
    status: 'ready',
    updatedAtMs: 10_000,
    revision: 1,
    trackRevision: 1,
    lyricsRevision: 1,
    state: { visible: true },
    track: { id: 'song-a', title: 'Song A' },
    lyrics: { trackId: 'song-a', lines: ['hello'] },
  });

  now += 2_499;
  assert.equal(bridge.getState().status, 'ready');

  now += 1;
  assert.deepEqual(bridge.getState(), {
    status: 'stale',
    updatedAtMs: 10_000,
    revision: 1,
    trackRevision: 1,
    lyricsRevision: 1,
    state: null,
    track: null,
    lyrics: null,
  });
});

test('increments_revisions_by_visibility_scope', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 20_000 });
  const songA = { id: 'song-a', title: 'Song A' };
  const songB = { id: 'song-b', title: 'Song B' };
  const lyricsA = { trackId: 'song-a', lines: ['A'] };
  const lyricsB = { trackId: 'song-b', lines: ['B'] };

  function revisions() {
    const snapshot = bridge.getState();
    return {
      revision: snapshot.revision,
      trackRevision: snapshot.trackRevision,
      lyricsRevision: snapshot.lyricsRevision,
    };
  }

  bridge.receiveHeartbeat({ state: { visible: true }, track: songA, lyrics: lyricsA });
  assert.deepEqual(revisions(), { revision: 1, trackRevision: 1, lyricsRevision: 1 });

  bridge.receiveHeartbeat({ state: { visible: false }, track: songA, lyrics: lyricsA });
  assert.deepEqual(revisions(), { revision: 2, trackRevision: 1, lyricsRevision: 1 });

  bridge.receiveHeartbeat({ state: { visible: false }, track: songB, lyrics: null });
  assert.deepEqual(revisions(), { revision: 2, trackRevision: 2, lyricsRevision: 2 });
  assert.equal(bridge.getState().lyrics, null);

  bridge.receiveHeartbeat({ state: { visible: false }, track: songB, lyrics: lyricsB });
  assert.deepEqual(revisions(), { revision: 2, trackRevision: 2, lyricsRevision: 3 });
});

test('heartbeats_stamp_local_time_without_bumping_content_revisions', () => {
  const { RENDERER_HEARTBEAT_MS, createPlayerBridge } = loadPlayerBridge();
  assert.equal(RENDERER_HEARTBEAT_MS, 1_000);

  let now = 30_000;
  const bridge = createPlayerBridge({ clock: () => now });
  bridge.receiveHeartbeat({
    updatedAtMs: 1,
    state: { visible: true, volume: 0.5 },
    track: { id: 'song-a', title: 'Song A' },
    lyrics: { trackId: 'song-a', lines: ['line'] },
  });
  const first = bridge.getState();

  now += RENDERER_HEARTBEAT_MS;
  bridge.receiveHeartbeat({
    updatedAtMs: 999_999,
    state: { volume: 0.5, visible: true },
    track: { title: 'Song A', id: 'song-a' },
    lyrics: { lines: ['line'], trackId: 'song-a' },
  });
  const second = bridge.getState();

  assert.equal(first.updatedAtMs, 30_000);
  assert.equal(second.updatedAtMs, 31_000);
  assert.deepEqual(
    {
      revision: second.revision,
      trackRevision: second.trackRevision,
      lyricsRevision: second.lyricsRevision,
    },
    {
      revision: first.revision,
      trackRevision: first.trackRevision,
      lyricsRevision: first.lyricsRevision,
    },
  );
});

test('serializes_deduplicates_and_bounds_command_results', async () => {
  const {
    COMMAND_RESULT_CACHE_MAX_ENTRIES,
    COMMAND_RESULT_CACHE_TTL_MS,
    RENDERER_COMMAND_TIMEOUT_MS,
    createPlayerBridge,
  } = loadPlayerBridge();
  assert.equal(RENDERER_COMMAND_TIMEOUT_MS, 1_500);
  assert.equal(COMMAND_RESULT_CACHE_TTL_MS, 30_000);
  assert.equal(COMMAND_RESULT_CACHE_MAX_ENTRIES, 256);

  let now = 40_000;
  let generatedId = 0;
  let generatedAttempt = 0;
  const dispatched = [];
  const timers = [];
  const bridge = createPlayerBridge({
    clock: () => now,
    createRequestId: () => `generated-${++generatedId}`,
    createAttemptId: () => `attempt-${++generatedAttempt}`,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    dispatchCommand(command) {
      dispatched.push(command);
      publishPostCommandHeartbeat(bridge, { commandAttempt: command.attempt });
    },
  });

  const first = bridge.enqueueCommand({
    requestId: 'same',
    command: 'play',
    payload: { at: 0, cookie: 'secret' },
  });
  const duplicate = bridge.enqueueCommand({
    requestId: 'same',
    command: 'play',
    payload: { cookie: 'secret', at: 0 },
  });
  const queued = bridge.enqueueCommand({ requestId: 'queued', command: 'next', payload: {} });

  assert.strictEqual(duplicate, first);
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    requestId: 'same',
    attempt: 'attempt-1',
    command: 'play',
    payload: { at: 0 },
  });
  await assert.rejects(
    bridge.enqueueCommand({ requestId: 'same', command: 'pause', payload: {} }),
    { code: 'request-id-conflict' },
  );

  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'same',
      attempt: dispatched[0].attempt,
      ok: true,
      result: { accepted: true, audioUrl: 'https://audio.example/secret.mp3' },
    }),
    true,
  );
  assert.deepEqual(await first, {
    requestId: 'same',
    ok: true,
    result: {
      accepted: true,
      revision: 1,
      state: { playback: { status: 'paused' } },
      track: { source: 'netease', title: '桥接测试歌曲' },
    },
  });
  assert.equal(timers[0].delay, 1_500);
  assert.equal(timers[0].cleared, true);
  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[1].requestId, 'queued');

  assert.equal(bridge.receiveCommandReceipt({
    requestId: 'queued',
    attempt: dispatched[1].attempt,
    ok: true,
    result: { moved: true },
  }), true);
  await queued;
  assert.deepEqual(
    await bridge.enqueueCommand({ requestId: 'same', command: 'play', payload: { at: 0 } }),
    {
      requestId: 'same',
      ok: true,
      result: {
        accepted: true,
        revision: 1,
        state: { playback: { status: 'paused' } },
        track: { source: 'netease', title: '桥接测试歌曲' },
      },
    },
  );
  assert.equal(dispatched.length, 2);

  const generated = bridge.enqueueCommand({ command: 'seek', payload: { seconds: 5 } });
  assert.equal(dispatched[2].requestId, 'generated-1');
  bridge.receiveCommandReceipt({
    requestId: 'generated-1',
    attempt: dispatched[2].attempt,
    ok: true,
    result: { seeked: true },
  });
  await generated;

  const timedOut = bridge.enqueueCommand({ requestId: 'timeout', command: 'pause', payload: {} });
  const timeoutTimer = timers.at(-1);
  assert.equal(timeoutTimer.delay, RENDERER_COMMAND_TIMEOUT_MS);
  timeoutTimer.callback();
  assert.deepEqual(await timedOut, {
    requestId: 'timeout',
    ok: false,
    error: { code: 'renderer-timeout' },
  });

  const ttlRequest = bridge.enqueueCommand({ requestId: 'ttl', command: 'play', payload: {} });
  bridge.receiveCommandReceipt({
    requestId: 'ttl',
    attempt: dispatched.at(-1).attempt,
    ok: true,
    result: { accepted: true },
  });
  await ttlRequest;
  const dispatchesBeforeTtl = dispatched.length;
  now += COMMAND_RESULT_CACHE_TTL_MS - 1;
  await bridge.enqueueCommand({ requestId: 'ttl', command: 'play', payload: {} });
  assert.equal(dispatched.length, dispatchesBeforeTtl);
  now += 1;
  const expired = bridge.enqueueCommand({ requestId: 'ttl', command: 'play', payload: {} });
  assert.equal(dispatched.length, dispatchesBeforeTtl + 1);
  bridge.receiveCommandReceipt({
    requestId: 'ttl',
    attempt: dispatched.at(-1).attempt,
    ok: true,
    result: { accepted: true },
  });
  await expired;

  const bounded = [];
  for (let index = 0; index <= COMMAND_RESULT_CACHE_MAX_ENTRIES; index += 1) {
    const requestId = `bounded-${index}`;
    const request = bridge.enqueueCommand({ requestId, command: 'seek', payload: { position: index } });
    bridge.receiveCommandReceipt({
      requestId,
      attempt: dispatched.at(-1).attempt,
      ok: true,
      result: { position: index },
    });
    bounded.push(request);
  }
  await Promise.all(bounded);

  const evicted = bridge.enqueueCommand({ requestId: 'bounded-0', command: 'seek', payload: { position: 0 } });
  assert.equal(dispatched.at(-1).requestId, 'bounded-0');
  bridge.receiveCommandReceipt({
    requestId: 'bounded-0',
    attempt: dispatched.at(-1).attempt,
    ok: true,
    result: { position: 0 },
  });
  await evicted;
});

test('checks_player_bridge_syntax', () => {
  const packageJson = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
  assert.match(packageJson, /node --check desktop\/player-bridge\.js/);
});

test('normalizes_sensitive_state_fields', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 50_000 });

  bridge.receiveHeartbeat({
    state: {
      audio: { url: 'https://audio.example/signed-stream?token=private' },
      accountId: 'private-account',
      coverUrl: 'https://image.example/cover.jpg',
    },
    track: {
      id: 'song-a',
      url: 'https://audio.example/signed-track?token=private',
      coverUrl: 'https://image.example/cover.jpg',
    },
    lyrics: { trackId: 'song-a', lines: ['safe'] },
  });

  const snapshot = bridge.getState();
  assert.deepEqual(snapshot.state, {
    audio: {},
    coverUrl: 'https://image.example/cover.jpg',
  });
  assert.deepEqual(snapshot.track, {
    id: 'song-a',
    coverUrl: 'https://image.example/cover.jpg',
  });
});

test('does_not_accept_lyrics_without_a_current_track', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 60_000 });

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: null,
    lyrics: { trackId: 'song-a', lines: ['stale'] },
  });

  const snapshot = bridge.getState();
  assert.equal(snapshot.track, null);
  assert.equal(snapshot.lyrics, null);
  assert.equal(snapshot.lyricsRevision, 0);
});

test('strips_nested_audio_source_fields', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 70_000 });

  bridge.receiveHeartbeat({
    state: {
      audio: {
        src: 'https://audio.example/song-a.mp3?token=private',
        source: 'https://audio.example/signed-source?token=private',
      },
      stream: {
        source: 'https://stream.example/song-a?token=private',
      },
      coverUrl: 'https://image.example/cover.jpg',
    },
    track: { id: 'song-a' },
    lyrics: { trackId: 'song-a', lines: ['safe'] },
  });

  assert.deepEqual(bridge.getState().state, {
    audio: {},
    coverUrl: 'https://image.example/cover.jpg',
    stream: {},
  });
});

test('rejects_unbound_lyrics_after_a_track_change', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 80_000 });

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-a', title: 'Song A' },
    lyrics: { trackId: 'song-a', lines: ['A current'] },
  });
  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-b', title: 'Song B' },
    lyrics: null,
  });
  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-b', title: 'Song B' },
    lyrics: { lines: ['A stale without an owner'] },
  });

  assert.equal(bridge.getState().lyrics, null);

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-b', title: 'Song B' },
    lyrics: { trackId: 'song-b', lines: ['B current'] },
  });
  assert.deepEqual(bridge.getState().lyrics, {
    trackId: 'song-b',
    lines: ['B current'],
  });
});

test('strips_deeply_nested_media_sources', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 90_000 });

  bridge.receiveHeartbeat({
    state: {
      audio: {
        coverUrl: 'https://image.example/audio-cover.jpg',
        transport: {
          source: 'https://audio.example/signed-source?token=private',
          src: 'https://audio.example/song-a.mp3?token=private',
        },
        variants: [
          { src: 'https://audio.example/variant-a.mp3?token=private' },
        ],
      },
      coverUrl: 'https://image.example/cover.jpg',
    },
    track: { id: 'song-a' },
    lyrics: { trackId: 'song-a', lines: ['safe'] },
  });

  assert.deepEqual(bridge.getState().state, {
    audio: {
      coverUrl: 'https://image.example/audio-cover.jpg',
      transport: {},
      variants: [{}],
    },
    coverUrl: 'https://image.example/cover.jpg',
  });
});

test('keeps_bound_lyrics_when_late_unbound_lyrics_arrive', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 100_000 });

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-a', title: 'Song A' },
    lyrics: { trackId: 'song-a', lines: ['A current'] },
  });
  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-b', title: 'Song B' },
    lyrics: { trackId: 'song-b', lines: ['B current'] },
  });
  const confirmed = bridge.getState();

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'song-b', title: 'Song B' },
    lyrics: { lines: ['A late without an owner'] },
  });

  const snapshot = bridge.getState();
  assert.deepEqual(snapshot.lyrics, confirmed.lyrics);
  assert.equal(snapshot.lyricsRevision, confirmed.lyricsRevision);
});

test('projects_safe_public_state_without_transport_or_credentials', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 110_000 });

  bridge.receiveHeartbeat({
    state: {
      authToken: 'private-token',
      coverUrl: 'https://image.example/cover.jpg',
      headers: { authorization: 'Bearer private-token' },
      mediaUrl: 'https://audio.example/song-a.mp3?token=private',
      playbackState: {
        playing: true,
        progress: 0.5,
        source: 'https://audio.example/signed-source?token=private',
      },
    },
    track: {
      authToken: 'private-token',
      coverUrl: 'https://image.example/cover.jpg',
      headers: { cookie: 'private-cookie' },
      id: 'song-a',
      mediaUrl: 'https://audio.example/song-a.mp3?token=private',
      title: 'Song A',
    },
    lyrics: { trackId: 'song-a', lines: ['safe'] },
  });

  const snapshot = bridge.getState();
  assert.deepEqual(snapshot.state, {
    coverUrl: 'https://image.example/cover.jpg',
    playbackState: { playing: true, progress: 0.5 },
  });
  assert.deepEqual(snapshot.track, {
    coverUrl: 'https://image.example/cover.jpg',
    id: 'song-a',
    title: 'Song A',
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-token|private-cookie|audio\.example/);
});

test('requires_attempt_to_complete_reused_request_id', async () => {
  const { COMMAND_RESULT_CACHE_TTL_MS, createPlayerBridge } = loadPlayerBridge();
  let now = 120_000;
  let attemptNumber = 0;
  const dispatched = [];
  const timers = [];
  const bridge = createPlayerBridge({
    clock: () => now,
    createAttemptId: () => `attempt-${++attemptNumber}`,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    dispatchCommand(command) {
      dispatched.push(command);
      publishPostCommandHeartbeat(bridge, { commandAttempt: command.attempt });
    },
  });

  const first = bridge.enqueueCommand({ requestId: 'reuse', command: 'play', payload: {} });
  assert.equal(dispatched[0].attempt, 'attempt-1');
  timers[0].callback();
  assert.deepEqual(await first, {
    requestId: 'reuse',
    ok: false,
    error: { code: 'renderer-timeout' },
  });

  now += COMMAND_RESULT_CACHE_TTL_MS;
  const second = bridge.enqueueCommand({ requestId: 'reuse', command: 'play', payload: {} });
  assert.equal(dispatched[1].attempt, 'attempt-2');
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'reuse',
      attempt: 'attempt-1',
      ok: true,
      result: { stale: true },
    }),
    false,
  );

  let secondSettled = false;
  second.then(() => {
    secondSettled = true;
  });
  await Promise.resolve();
  assert.equal(secondSettled, false);

  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'reuse',
      attempt: 'attempt-2',
      ok: true,
      result: { current: true },
    }),
    true,
  );
  assert.deepEqual(await second, {
    requestId: 'reuse',
    ok: true,
    result: {
      accepted: true,
      current: true,
      revision: 1,
      state: { playback: { status: 'paused' } },
      track: { source: 'netease', title: '桥接测试歌曲' },
    },
  });
});

test('bounds_pending_commands_with_stable_overload_result', async () => {
  const { COMMAND_QUEUE_MAX_ENTRIES, createPlayerBridge } = loadPlayerBridge();
  assert.equal(COMMAND_QUEUE_MAX_ENTRIES, 256);

  const dispatched = [];
  const bridge = createPlayerBridge({
    createAttemptId: () => 'attempt',
    setTimeoutFn() {
      return { cleared: false };
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const pending = [];
  for (let index = 0; index < COMMAND_QUEUE_MAX_ENTRIES; index += 1) {
    pending.push(bridge.enqueueCommand({
      requestId: `queued-${index}`,
      command: 'seek',
      payload: { position: index },
    }));
  }

  assert.equal(dispatched.length, 1);
  assert.deepEqual(
    await bridge.enqueueCommand({ requestId: 'overflow', command: 'seek', payload: { position: 999 } }),
    {
      requestId: 'overflow',
      ok: false,
      error: { code: 'renderer-queue-full' },
    },
  );
  assert.equal(dispatched.length, 1);
  bridge.dispose();
  const disposed = await Promise.all(pending);
  assert.equal(disposed.every((result) => result.error?.code === 'renderer-disposed'), true);
});

test('dispose_clears_timers_and_completes_pending_commands', async () => {
  let attemptNumber = 0;
  const dispatched = [];
  const timers = [];
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => `attempt-${++attemptNumber}`,
    setTimeoutFn(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const active = bridge.enqueueCommand({ requestId: 'active', command: 'play', payload: {} });
  const queued = bridge.enqueueCommand({ requestId: 'queued', command: 'next', payload: {} });
  assert.equal(dispatched.length, 1);
  assert.equal(timers[0].cleared, false);

  bridge.dispose();

  assert.equal(timers[0].cleared, true);
  assert.deepEqual(await active, {
    requestId: 'active',
    ok: false,
    error: { code: 'renderer-disposed' },
  });
  assert.deepEqual(await queued, {
    requestId: 'queued',
    ok: false,
    error: { code: 'renderer-disposed' },
  });
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'active',
      attempt: 'attempt-1',
      ok: true,
      result: { accepted: true },
    }),
    false,
  );
  assert.deepEqual(
    await bridge.enqueueCommand({ requestId: 'after-dispose', command: 'pause', payload: {} }),
    {
      requestId: 'after-dispose',
      ok: false,
      error: { code: 'renderer-disposed' },
    },
  );
  assert.equal(dispatched.length, 1);
});

test('requires a post-dispatch heartbeat and caches bridge-owned command state', async () => {
  const dispatched = [];
  let now = 90_000;
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({
    clock: () => now,
    createAttemptId: () => 'post-state-attempt-' + (dispatched.length + 1),
    clearTimeoutFn() {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
    setTimeoutFn: () => ({}),
  });
  bridge.receiveHeartbeat({
    state: { playback: { status: 'paused' } },
    track: { source: 'netease', title: '命令前歌曲' },
  });
  const missingPostState = bridge.enqueueCommand({
    command: 'play',
    payload: {},
    requestId: 'post-state-missing',
  });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[0].attempt,
    ok: true,
    requestId: 'post-state-missing',
    result: { accepted: true },
  }), true);
  assert.deepEqual(await missingPostState, {
    error: { code: 'post-state-missing' },
    ok: false,
    requestId: 'post-state-missing',
  });
  const terminalPending = bridge.enqueueCommand({
    command: 'play',
    payload: {},
    requestId: 'bridge-owned-terminal-state',
  });
  now += 1;
  bridge.receiveHeartbeat({
    commandAttempt: dispatched[1].attempt,
    state: { authToken: 'renderer-secret', playback: { status: 'playing' } },
    track: { localPath: 'C:/private/song.mp3', source: 'netease', title: '命令后歌曲' },
  });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[1].attempt,
    ok: true,
    requestId: 'bridge-owned-terminal-state',
    result: {
      accepted: false,
      revision: 999,
      state: { authToken: 'forged-secret', playback: { status: 'forged' } },
      track: { localPath: 'C:/forged/song.mp3', title: '伪造歌曲' },
    },
  }), true);
  const terminal = await terminalPending;
  assert.deepEqual(terminal, {
    ok: true,
    requestId: 'bridge-owned-terminal-state',
    result: {
      accepted: true,
      revision: 2,
      state: { playback: { status: 'playing' } },
      track: { source: 'netease', title: '命令后歌曲' },
    },
  });
  assert.deepEqual(
    await bridge.enqueueCommand({
      command: 'play',
      payload: {},
      requestId: 'bridge-owned-terminal-state',
    }),
    terminal,
  );
  assert.equal(dispatched.length, 2);
  assert.doesNotMatch(JSON.stringify(terminal), /secret|private|forged/i);
});
test('requires a matching command attempt on the post-dispatch snapshot', async () => {
  const dispatched = [];
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({
    clearTimeoutFn() {},
    createAttemptId: () => `attempt-${dispatched.length + 1}`,
    dispatchCommand(command) {
      dispatched.push(command);
    },
    setTimeoutFn: () => ({}),
  });

  bridge.receiveHeartbeat({
    state: { playback: { status: 'paused' } },
    track: { source: 'netease', title: '命令前歌曲' },
  });
  const delayedPreCommand = bridge.enqueueCommand({
    command: 'play',
    payload: {},
    requestId: 'delayed-pre-command-heartbeat',
  });
  bridge.receiveHeartbeat({
    state: { playback: { status: 'playing' } },
    track: { source: 'netease', title: '未绑定的晚到心跳' },
  });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[0].attempt,
    ok: true,
    requestId: 'delayed-pre-command-heartbeat',
    result: { accepted: true },
  }), true);
  assert.deepEqual(await delayedPreCommand, {
    error: { code: 'post-state-missing' },
    ok: false,
    requestId: 'delayed-pre-command-heartbeat',
  });

  const confirmed = bridge.enqueueCommand({
    command: 'play',
    payload: {},
    requestId: 'attempt-bound-heartbeat',
  });
  bridge.receiveHeartbeat({
    commandAttempt: dispatched[1].attempt,
    state: { playback: { status: 'playing' } },
    track: { source: 'netease', title: '命令后歌曲' },
  });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[1].attempt,
    ok: true,
    requestId: 'attempt-bound-heartbeat',
    result: { accepted: true },
  }), true);
  assert.deepEqual(await confirmed, {
    ok: true,
    requestId: 'attempt-bound-heartbeat',
    result: {
      accepted: true,
      revision: 2,
      state: { playback: { status: 'playing' } },
      track: { source: 'netease', title: '命令后歌曲' },
    },
  });
});

test('rejects unsafe cover URLs in transport, public state, and command receipts', async () => {
  const dispatched = [];
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({
    createAttemptId: () => 'attempt-' + (dispatched.length + 1),
    clearTimeoutFn() {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
    setTimeoutFn: () => ({}),
  });
  const unsafeCover = 'https://user:password@image.example/cover.jpg?token=secret';
  const safeCover = 'https://image.example/cover.webp?width=320';
  const transportPending = bridge.enqueueCommand({
    command: 'play',
    payload: {
      coverUrl: unsafeCover,
      track: { coverUrl: safeCover, title: '安全封面' },
    },
    requestId: 'cover-transport',
  });
  assert.deepEqual(dispatched[0].payload, {
    track: { coverUrl: safeCover, title: '安全封面' },
  });
  publishPostCommandHeartbeat(bridge, { commandAttempt: dispatched[0].attempt });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[0].attempt,
    ok: true,
    requestId: 'cover-transport',
    result: { accepted: true },
  }), true);
  await transportPending;
  bridge.receiveHeartbeat({
    state: { playback: { status: 'paused' } },
    track: { coverUrl: unsafeCover, source: 'netease', title: '不安全封面' },
  });
  assert.equal(bridge.getState().track.coverUrl, undefined);
  bridge.receiveHeartbeat({
    state: { playback: { status: 'paused' } },
    track: { coverUrl: safeCover, source: 'netease', title: '安全封面' },
  });
  assert.equal(bridge.getState().track.coverUrl, safeCover);
  const receiptPending = bridge.enqueueCommand({
    command: 'play',
    payload: {},
    requestId: 'cover-receipt',
  });
  publishPostCommandHeartbeat(bridge, {
    state: { playback: { status: 'playing' } },
    commandAttempt: dispatched[1].attempt,
    track: { coverUrl: safeCover, source: 'netease', title: '安全封面' },
  });
  assert.equal(bridge.receiveCommandReceipt({
    attempt: dispatched[1].attempt,
    ok: true,
    requestId: 'cover-receipt',
    result: {
      state: { coverUrl: unsafeCover, playing: true },
      track: { coverUrl: safeCover, title: '安全封面' },
    },
  }), true);
  const receipt = await receiptPending;
  assert.equal(receipt.result.state.coverUrl, undefined);
  assert.equal(receipt.result.track.coverUrl, safeCover);
  assert.doesNotMatch(JSON.stringify(receipt), /password|token=secret/);
});
test('projects_sensitive_command_results_without_media_or_credentials', async () => {
  const dispatched = [];
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => 'attempt-1',
    setTimeoutFn() {
      return {};
    },
    clearTimeoutFn() {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const request = bridge.enqueueCommand({
    requestId: 'safe-result',
    command: 'play',
    payload: {},
  });
  publishPostCommandHeartbeat(bridge, { commandAttempt: dispatched[0].attempt });
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'safe-result',
      attempt: dispatched[0].attempt,
      ok: true,
      result: {
        accepted: true,
        accountId: 'private-account',
        authToken: 'private-token',
        coverUrl: 'https://image.example/cover.jpg',
        headers: { cookie: 'private-cookie' },
        playbackState: {
          progress: 0.5,
          variants: [
            'https://audio.example/signed.mp3?token=private',
            'blob:https://audio.example/private',
            'data:audio/mpeg;base64,private-audio',
            { name: 'fallback', source: 'https://audio.example/fallback.mp3' },
          ],
        },
      },
    }),
    true,
  );

  const response = await request;
  assert.deepEqual(response, {
    requestId: 'safe-result',
    ok: true,
    result: {
      accepted: true,
      coverUrl: 'https://image.example/cover.jpg',
      playbackState: {
        progress: 0.5,
        variants: [{ name: 'fallback' }],
      },
      revision: 1,
      state: { playback: { status: 'paused' } },
      track: { source: 'netease', title: '桥接测试歌曲' },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-account|private-token|private-cookie|audio\.example|data:audio/i,
  );
});

test('preserves_safe_dispatcher_error_code_without_error_details', async () => {
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => 'attempt-1',
    setTimeoutFn() {
      return {};
    },
    clearTimeoutFn() {},
    dispatchCommand() {
      throw {
        authToken: 'private-token',
        code: 'not-permitted',
        headers: { authorization: 'Bearer private-token' },
        stack: 'private-stack',
      };
    },
  });

  const response = await bridge.enqueueCommand({
    requestId: 'dispatch-failure',
    command: 'play',
    payload: {},
  });
  assert.deepEqual(response, {
    requestId: 'dispatch-failure',
    ok: false,
    error: { code: 'not-permitted' },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-token|private-stack|authorization/i,
  );
});

test('preserves_safe_renderer_receipt_error_code_without_error_details', async () => {
  const dispatched = [];
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => 'attempt-1',
    setTimeoutFn() {
      return {};
    },
    clearTimeoutFn() {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const request = bridge.enqueueCommand({
    requestId: 'receipt-failure',
    command: 'play',
    payload: {},
  });
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'receipt-failure',
      attempt: dispatched[0].attempt,
      ok: false,
      error: {
        authToken: 'private-token',
        code: 'not-permitted',
        headers: { authorization: 'Bearer private-token' },
        stack: 'private-stack',
      },
    }),
    true,
  );

  const response = await request;
  assert.deepEqual(response, {
    requestId: 'receipt-failure',
    ok: false,
    error: { code: 'not-permitted' },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-token|private-stack|authorization/i,
  );
});

test('projects_command_results_to_explicit_public_dto', async () => {
  const dispatched = [];
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => 'attempt-1',
    setTimeoutFn: () => ({}),
    clearTimeoutFn: () => {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const request = bridge.enqueueCommand({
    requestId: 'dto-result',
    command: 'play',
    payload: {},
  });
  publishPostCommandHeartbeat(bridge, { commandAttempt: dispatched[0].attempt });
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'dto-result',
      attempt: dispatched[0].attempt,
      ok: true,
      result: {
        accepted: true,
        apiKey: 'private-api-key',
        coverUrl: 'https://image.example/cover.jpg',
        name: 'Safe command result',
        password: 'private-password',
        playbackState: {
          progress: 0.5,
          unknownNested: { sessionId: 'private-nested-session' },
          variants: [{ apiKey: 'private-variant-key', name: 'fallback' }],
        },
        privateKey: 'private-key',
        progress: 0.75,
        sessionId: 'private-session',
        unknown: { deep: { token: 'private-deep-token' } },
      },
    }),
    true,
  );

  const response = await request;
  assert.deepEqual(response, {
    requestId: 'dto-result',
    ok: true,
    result: {
      accepted: true,
      coverUrl: 'https://image.example/cover.jpg',
      name: 'Safe command result',
      playbackState: {
        progress: 0.5,
        variants: [{ name: 'fallback' }],
      },
      progress: 0.75,
      revision: 1,
      state: { playback: { status: 'paused' } },
      track: { source: 'netease', title: '桥接测试歌曲' },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-api-key|private-password|private-key|private-session|private-deep|private-nested/i,
  );
});

test('restricts_nested_command_result_cover_urls_to_http', async () => {
  const dispatched = [];
  const bridge = loadPlayerBridge().createPlayerBridge({
    createAttemptId: () => 'attempt-1',
    setTimeoutFn: () => ({}),
    clearTimeoutFn: () => {},
    dispatchCommand(command) {
      dispatched.push(command);
    },
  });

  const request = bridge.enqueueCommand({
    requestId: 'nested-cover-url',
    command: 'play',
    payload: {},
  });
  publishPostCommandHeartbeat(bridge, {
    commandAttempt: dispatched[0].attempt,
    state: {
      coverUrl: 'blob:https://audio.example/private',
      metadata: { coverUrl: 'https://image.example/nested-cover.jpg' },
      progress: 0.5,
    },
    track: { coverUrl: 'file:///C:/private-cover.jpg', title: 'Song A' },
  });
  assert.equal(
    bridge.receiveCommandReceipt({
      requestId: 'nested-cover-url',
      attempt: dispatched[0].attempt,
      ok: true,
      result: {
        playbackState: {
          coverUrl: 'data:audio/mpeg;base64,private-audio',
          playing: true,
          transport: { coverUrl: 'javascript:alert(1)' },
        },
        state: {
          coverUrl: 'blob:https://audio.example/private',
          metadata: { coverUrl: 'https://image.example/nested-cover.jpg' },
          progress: 0.5,
        },
        track: {
          coverUrl: 'file:///C:/private-cover.jpg',
          title: 'Song A',
        },
      },
    }),
    true,
  );

  const response = await request;
  assert.deepEqual(response, {
    requestId: 'nested-cover-url',
    ok: true,
    result: {
      accepted: true,
      playbackState: { playing: true },
      revision: 1,
      state: {
        metadata: { coverUrl: 'https://image.example/nested-cover.jpg' },
        progress: 0.5,
      },
      track: { title: 'Song A' },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /data:audio|blob:|file:|javascript:/i,
  );
});

test('keeps_only_canonical_track_sources', () => {
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 115_000 });

  for (const [rawSource, expectedSource] of [
    ['NETEASE', 'netease'],
    ['QQ', 'qq'],
    ['local', 'local'],
    ['podcast', 'podcast'],
  ]) {
    bridge.receiveHeartbeat({
      state: { visible: true },
      track: { id: `song-${expectedSource}`, source: rawSource, title: '安全歌曲' },
      lyrics: { lines: [], trackId: `song-${expectedSource}` },
    });
    assert.equal(bridge.getState().track.source, expectedSource);
  }

  bridge.receiveHeartbeat({
    state: { visible: true },
    track: { id: 'unsafe-source', source: 'file:///C:/private/song.mp3', title: '安全歌曲' },
    lyrics: { lines: [], trackId: 'unsafe-source' },
  });
  const unsafeSnapshot = bridge.getState();
  assert.equal(Object.hasOwn(unsafeSnapshot.track, 'source'), false);
  assert.doesNotMatch(JSON.stringify(unsafeSnapshot), /private\/song\.mp3/);
});

test('preserves_runtime_v1_public_shape_through_heartbeat_and_command_receipt', async () => {
  const player = {
    audio: { currentTime: 42.125, duration: 240, ended: false, paused: false, playbackRate: 1 },
    currentIdx: 0,
    lyricsLines: [{ durationMs: 5_000, t: 12.5, text: '完整歌词', translation: 'Complete lyric' }],
    playQueue: [{
      album: '专辑', artist: '歌手', cover: 'https://image.example/cover.jpg', cookie: 'runtime-cookie',
      durationMs: 240_000, id: 123, localPath: 'C:/private/runtime-song.mp3', name: '运行时歌曲',
      source: 'netease', url: 'https://audio.example/private-song.mp3',
    }],
    trackSwitchToken: 3,
  };
  const snapshot = createEislandBridgeRuntime({ getPlayer: () => player }).createSnapshot();
  const { createPlayerBridge } = loadPlayerBridge();
  const bridge = createPlayerBridge({ clock: () => 50_000 });

  bridge.receiveHeartbeat({
    ...snapshot,
    lyrics: { ...snapshot.lyrics, cookie: 'lyrics-cookie' },
    state: { ...snapshot.state, mediaUrl: 'file:///C:/private/runtime-state.mp3' },
    track: { ...snapshot.track, localPath: 'C:/private/runtime-song.mp3' },
  });

  const heartbeatState = bridge.getState();
  assert.equal(heartbeatState.track.durationMs, 240_000);
  assert.equal(heartbeatState.state.playback.durationMs, 240_000);
  assert.equal(heartbeatState.state.playback.positionMs, 42_125);
  assert.deepEqual(heartbeatState.state.capabilities, {
    next: true, pause: true, play: true, previous: true, seek: true,
  });
  assert.deepEqual(heartbeatState.lyrics.lines, [{
    endMs: 17_500, startMs: 12_500, text: '完整歌词', translation: 'Complete lyric',
  }]);
  assert.doesNotMatch(
    JSON.stringify(heartbeatState),
    /runtime-cookie|lyrics-cookie|private\/runtime|private-song\.mp3/i,
  );

  const dispatched = [];
  const commandBridge = createPlayerBridge({
    clock: () => 50_000,
    createAttemptId: () => 'runtime-attempt',
    clearTimeoutFn: () => {},
    dispatchCommand(command) { dispatched.push(command); },
    setTimeoutFn: () => ({}),
  });
  const pending = commandBridge.enqueueCommand({
    command: 'play', payload: {}, requestId: 'runtime-command-result',
  });
  commandBridge.receiveHeartbeat({ ...snapshot, commandAttempt: dispatched[0].attempt });
  assert.equal(commandBridge.receiveCommandReceipt({
    attempt: dispatched[0].attempt,
    ok: true,
    requestId: 'runtime-command-result',
    result: {
      accepted: true,
      state: { ...snapshot.state, authToken: 'private-command-token' },
      track: { ...snapshot.track, mediaUrl: 'file:///C:/private/command-song.mp3' },
    },
  }), true);

  const response = await pending;
  assert.deepEqual(response, {
    ok: true,
    requestId: 'runtime-command-result',
    result: { accepted: true, revision: 1, state: snapshot.state, track: snapshot.track },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-command-token|private\/command-song\.mp3/i,
  );
});
