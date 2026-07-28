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
  assert.deepEqual(revisions(), { revision: 2, trackRevision: 2, lyricsRevision: 1 });
  assert.equal(bridge.getState().lyrics, null);

  bridge.receiveHeartbeat({ state: { visible: false }, track: songB, lyrics: lyricsB });
  assert.deepEqual(revisions(), { revision: 2, trackRevision: 2, lyricsRevision: 2 });
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
  const dispatched = [];
  const timers = [];
  const bridge = createPlayerBridge({
    clock: () => now,
    createRequestId: () => `generated-${++generatedId}`,
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

  assert.equal(bridge.receiveCommandReceipt({ requestId: 'queued', ok: true, result: { moved: true } }), true);
  await queued;
  assert.deepEqual(
    await bridge.enqueueCommand({ requestId: 'same', command: 'play', payload: { at: 0 } }),
    { requestId: 'same', ok: true, result: { accepted: true } },
  );
  assert.equal(dispatched.length, 2);

  const generated = bridge.enqueueCommand({ command: 'seek', payload: { seconds: 5 } });
  assert.equal(dispatched[2].requestId, 'generated-1');
  bridge.receiveCommandReceipt({ requestId: 'generated-1', ok: true, result: { seeked: true } });
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
  bridge.receiveCommandReceipt({ requestId: 'ttl', ok: true, result: { accepted: true } });
  await ttlRequest;
  const dispatchesBeforeTtl = dispatched.length;
  now += COMMAND_RESULT_CACHE_TTL_MS - 1;
  await bridge.enqueueCommand({ requestId: 'ttl', command: 'play', payload: {} });
  assert.equal(dispatched.length, dispatchesBeforeTtl);
  now += 1;
  const expired = bridge.enqueueCommand({ requestId: 'ttl', command: 'play', payload: {} });
  assert.equal(dispatched.length, dispatchesBeforeTtl + 1);
  bridge.receiveCommandReceipt({ requestId: 'ttl', ok: true, result: { accepted: true } });
  await expired;

  const bounded = [];
  for (let index = 0; index <= COMMAND_RESULT_CACHE_MAX_ENTRIES; index += 1) {
    const requestId = `bounded-${index}`;
    const request = bridge.enqueueCommand({ requestId, command: 'seek', payload: { position: index } });
    bridge.receiveCommandReceipt({ requestId, ok: true, result: { position: index } });
    bounded.push(request);
  }
  await Promise.all(bounded);

  const evicted = bridge.enqueueCommand({ requestId: 'bounded-0', command: 'seek', payload: { position: 0 } });
  assert.equal(dispatched.at(-1).requestId, 'bounded-0');
  bridge.receiveCommandReceipt({ requestId: 'bounded-0', ok: true, result: { position: 0 } });
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
