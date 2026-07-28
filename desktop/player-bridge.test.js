const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPlayerBridge() {
  try {
    return require('./player-bridge');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
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
    result: { accepted: true },
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
    { requestId: 'same', ok: true, result: { accepted: true } },
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
    result: { current: true },
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
    },
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /private-api-key|private-password|private-key|private-session|private-deep|private-nested/i,
  );
});
