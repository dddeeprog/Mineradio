'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  createListenSessionState,
  createListenTransport,
  recordLocalListen,
} = require('../public/listen-session-state');
const fs = require('node:fs');
const path = require('node:path');
const REPORTING_BINDING = `${'a'.repeat(32)}.${'b'.repeat(64)}`;

function assertSubmitted(result) {
  assert.equal(result && result.delivery, 'submitted');
}

function isSubmitted(result) {
  return !!result && result.delivery === 'submitted';
}

function neteaseSong(overrides) {
  return {
    key: 'netease:101',
    id: '101',
    name: 'Song',
    artist: 'Artist',
    provider: 'netease',
    catalogProvider: 'netease',
    catalogSourceId: '101',
    playbackProvider: 'netease',
    playbackSourceId: '101',
    resolutionMode: 'catalog',
    ...overrides,
  };
}

test('starts only confirmed playback and normalizes direct and matched identities', () => {
  let now = 1_000;
  let serial = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => `session-${++serial}`,
  });

  assert.equal(state.startConfirmed({
    confirmed: false,
    transactionId: 'tx-search',
    song: neteaseSong(),
  }), null);

  const direct = state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-1',
    mediaTime: 0,
    durationMs: 120_000,
    song: neteaseSong(),
  });
  assert.equal(direct.sessionId, 'session-1');
  assert.equal(direct.resolutionMode, 'direct');
  assert.equal(state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-1',
    song: neteaseSong(),
  }).sessionId, direct.sessionId);

  now += 46_000;
  state.tick({ mediaTime: 46, durationMs: 120_000 });
  const event = state.finalize({ reason: 'switch' });
  assert.equal(event.catalogProvider, 'netease');
  assert.equal(event.playbackProvider, 'netease');
  assert.equal(event.resolutionMode, 'direct');
  assert.equal(event.sourceIds.netease, '101');
  assert.equal(event.completeness, 'partial');

  const matched = state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-2',
    mediaTime: 0,
    durationMs: 120_000,
    song: neteaseSong({
      key: 'kugou:kg-1',
      id: 'kg-1',
      catalogProvider: 'kugou',
      catalogSourceId: 'kg-1',
      playbackProvider: 'netease',
      playbackSourceId: '202',
      resolutionMode: 'matched-provider',
    }),
  });
  assert.equal(matched.catalogProvider, 'kugou');
  assert.equal(matched.playbackProvider, 'netease');
  assert.equal(matched.resolutionMode, 'matched-provider');
});

test('confirmed remote sessions preserve only their opaque reporting account binding', () => {
  let now = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'bound-session',
  });
  state.startConfirmed({
    confirmed: true,
    transactionId: 'bound-transaction',
    mediaTime: 0,
    durationMs: 90_000,
    reportingBinding: `${'1'.repeat(32)}.${'2'.repeat(64)}`,
    song: neteaseSong(),
  });
  now = 45_000;
  state.tick({ mediaTime: 45, durationMs: 90_000 });
  const event = state.finalize({ reason: 'switch' });
  assert.equal(event.reportingBinding, `${'1'.repeat(32)}.${'2'.repeat(64)}`);
  assert.doesNotMatch(
    JSON.stringify(event),
    /cookie|token|accountId|credentialGeneration|reportingScope/i,
  );
});

test('transport serializes the opaque account binding and rejects unbound remote events', async () => {
  const requests = [];
  const binding = `${'a'.repeat(32)}.${'b'.repeat(64)}`;
  const transport = createListenTransport({
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            localRecorded: true,
            status: 'submitted',
            completeness: 'complete',
          };
        },
      };
    },
    autoRetry: false,
  });
  const bound = {
    sessionId: 'bound-transport',
    confirmedPlayback: true,
    catalogProvider: 'netease',
    playbackProvider: 'netease',
    resolutionMode: 'direct',
    completeness: 'partial',
    sourceIds: { netease: '101' },
    catalogSourceId: '101',
    playbackSourceId: '101',
    listenMs: 45_000,
    durationMs: 100_000,
    completion: { completed: false, ratio: 0.45 },
    playedAt: 1_000,
    context: null,
    reportingBinding: binding,
  };

  const submitted = await transport.submit(bound);
  assert.equal(submitted.delivery, 'submitted');
  assert.equal(requests[0].reportingBinding, binding);
  assert.equal(Object.hasOwn(requests[0], 'credentialGeneration'), false);
  assert.equal(Object.hasOwn(requests[0], 'reportingScope'), false);

  const rejected = await transport.submit({
    ...bound,
    sessionId: 'unbound-transport',
    reportingBinding: undefined,
  });
  assert.deepEqual(rejected, {
    accepted: false,
    localRecorded: true,
    delivery: 'terminal',
    status: 'rejected',
    code: 'REPORTING_BINDING_REQUIRED',
  });
  assert.equal(requests.length, 1);
});

test('transport preserves uncertain as a durable terminal delivery result', async () => {
  let calls = 0;
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const event = {
    sessionId: 'durable-uncertain',
    confirmedPlayback: true,
    catalogProvider: 'netease',
    playbackProvider: 'netease',
    resolutionMode: 'direct',
    completeness: 'partial',
    sourceIds: { netease: '101' },
    catalogSourceId: '101',
    playbackSourceId: '101',
    listenMs: 45_000,
    durationMs: 100_000,
    completion: { completed: false, ratio: 0.45 },
    playedAt: 1_000,
    context: null,
    reportingBinding: `${'c'.repeat(32)}.${'d'.repeat(64)}`,
  };
  const first = createListenTransport({
    storage,
    autoRetry: false,
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            localRecorded: true,
            status: 'uncertain',
            completeness: 'partial',
          };
        },
      };
    },
  });

  const result = await first.submit(event);
  assert.deepEqual(result, {
    accepted: true,
    localRecorded: true,
    delivery: 'uncertain',
    status: 'uncertain',
    completeness: 'partial',
    duplicate: false,
  });
  assert.deepEqual(first.status(event.sessionId), result);
  first.destroy();

  const restarted = createListenTransport({
    storage,
    autoRetry: false,
    fetch: async () => {
      calls += 1;
      throw new Error('uncertain must not retry');
    },
  });
  assert.deepEqual(restarted.status(event.sessionId), result);
  await restarted.flushDue();
  assert.equal(calls, 1);
  restarted.destroy();
});

test('bounds media and wall clocks across pause, resume, and seeks', () => {
  let now = 10_000;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'clock-session',
  });
  state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-clock',
    mediaTime: 10,
    durationMs: 100_000,
    song: neteaseSong(),
  });

  now += 1_000;
  state.tick({ mediaTime: 11, durationMs: 100_000 });
  now += 1_000;
  state.tick({ mediaTime: 70, durationMs: 100_000 });
  now += 1_000;
  state.tick({ mediaTime: 5, durationMs: 100_000 });
  state.pause({ mediaTime: 5 });
  now += 20_000;
  state.tick({ mediaTime: 25, durationMs: 100_000 });
  state.resume({ mediaTime: 25 });
  now += 1_000;
  state.tick({ mediaTime: 26, durationMs: 100_000 });

  const snapshot = state.snapshot();
  assert.equal(snapshot.listenMs, 3_000);
  assert.equal(snapshot.maxProgress, 0.7);
});

test('short listens do not report while 50 percent, 45 seconds, and ended do', () => {
  function finalizeAt(id, elapsedMs, mediaTime, durationMs, reason) {
    let now = 0;
    const state = createListenSessionState({
      clock: () => now,
      createId: () => id,
    });
    state.startConfirmed({
      confirmed: true,
      transactionId: id,
      mediaTime: 0,
      durationMs,
      song: neteaseSong(),
    });
    now = elapsedMs;
    state.tick({ mediaTime, durationMs });
    return state.finalize({ reason });
  }

  assert.equal(finalizeAt('short', 10_000, 10, 100_000, 'switch'), null);
  assert.equal(finalizeAt('half', 30_000, 50, 100_000, 'switch').completion.ratio, 0.5);
  assert.equal(finalizeAt('forty-five', 45_000, 45, 200_000, 'switch').listenMs, 45_000);
  assert.equal(finalizeAt('ended', 2_000, 2, 100_000, 'ended').completion.completed, true);
  assert.equal(finalizeAt('immediate-ended', 0, 0, 100_000, 'ended'), null);
  assert.equal(finalizeAt('loaded-only', 0, 0, 500, 'ended'), null);
  assert.equal(finalizeAt('short-track', 500, 0.5, 500, 'ended').completion.completed, true);
});

test('switch, ended, unload, and retry finalize each session exactly once', () => {
  let now = 0;
  let serial = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => `once-${++serial}`,
  });
  state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-once',
    mediaTime: 0,
    durationMs: 2_000,
    song: neteaseSong(),
  });
  now = 2_000;
  state.tick({ mediaTime: 2, durationMs: 2_000 });

  const ended = state.finalize({ reason: 'ended' });
  assert.equal(ended.sessionId, 'once-1');
  assert.equal(state.finalize({ reason: 'pagehide' }), null);
  assert.equal(state.finalize({ reason: 'beforeunload' }), null);
  assert.deepEqual(state.retry('once-1'), ended);
  assert.deepEqual(state.retry('once-1'), ended);
});

test('the same song can create a new id only after the previous session finalizes', () => {
  let now = 0;
  let serial = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => `repeat-${++serial}`,
  });
  const first = state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-repeat-1',
    mediaTime: 0,
    durationMs: 1_000,
    song: neteaseSong(),
  });
  now = 1_000;
  assert.equal(state.finalize({ reason: 'ended', mediaTime: 1 }).sessionId, first.sessionId);
  const second = state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-repeat-2',
    mediaTime: 0,
    durationMs: 1_000,
    song: neteaseSong(),
  });
  assert.equal(second.sessionId, 'repeat-2');
  assert.notEqual(second.sessionId, first.sessionId);
});

test('events and local history recursively exclude secrets and full paths', () => {
  const sentinel = 'SECRET_SENTINEL_94f';
  let now = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'safe-session',
  });
  state.startConfirmed({
    confirmed: true,
    transactionId: 'tx-safe',
    mediaTime: 0,
    durationMs: 1_000,
    context: {
      type: 'playlist',
      playlistId: 'list-1',
      cookie: sentinel,
      nested: { token: sentinel },
    },
    song: neteaseSong({
      cookie: sentinel,
      localFilePath: `C:\\Users\\Me\\${sentinel}\\song.mp3`,
      name: 'Safe Song',
    }),
  });
  now = 1_000;
  state.tick({ mediaTime: 1, durationMs: 1_000 });
  const event = state.finalize({ reason: 'ended' });
  const storage = recordLocalListen(null, event);

  assert.doesNotMatch(JSON.stringify({ event, storage }), new RegExp(sentinel));
  assert.deepEqual(event.context, { type: 'playlist', playlistId: 'list-1' });
  assert.equal(storage.history[0].sessionId, 'safe-session');
});

test('HOME song and artist aggregates stay within count and UTF-8 LRU budgets', () => {
  let stats = null;
  for (let index = 0; index < 5_000; index += 1) {
    stats = recordLocalListen(stats, {
      sessionId: `home-bounded-${index}`,
      catalogProvider: 'netease',
      catalogSourceId: String(index + 1),
      listenMs: 45_000,
      playedAt: index + 1,
      completion: { completed: false, ratio: 0.5 },
      context: null,
      display: {
        key: `netease:${index + 1}`,
        name: `Song ${index + 1}`,
        artist: `Artist ${index + 1}`,
        source: 'netease',
      },
    });
  }

  assert.equal(stats.history.length, 180);
  assert.ok(Object.keys(stats.songs).length <= 512);
  assert.ok(Object.keys(stats.artists).length <= 512);
  assert.ok(Buffer.byteLength(JSON.stringify(stats), 'utf8') <= 512 * 1024);
  assert.equal(stats.history[0].sessionId, 'home-bounded-4999');
  assert.equal(stats.songs['netease:5000'].plays, 1);
  assert.equal(stats.artists['Artist 5000'].plays, 1);
  assert.equal(stats.songs['netease:1'], undefined);
});

test('transport uses one keepalive request or beacon per session', async () => {
  const calls = [];
  const transport = createListenTransport({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
    sendBeacon: (url, body) => {
      calls.push({ url, body, beacon: true });
      return true;
    },
    timeoutMs: 20,
  });
  const event = {
    sessionId: 'transport-session',
    catalogProvider: 'qq',
    playbackProvider: 'qq',
  };

  assertSubmitted(await transport.submit(event));
  assert.equal(await transport.submit(event), false);
  assert.equal(await transport.submit(event, { unload: true }), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/listen/report');
  assert.equal(calls[0].options.keepalive, true);
});

test('first unload delivery confirms by fetch when beacon has no durable storage', async () => {
  const calls = [];
  const transport = createListenTransport({
    fetch: async () => {
      calls.push('fetch');
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
    sendBeacon: (url, body) => {
      calls.push({ url, body });
      return true;
    },
  });
  const event = {
    sessionId: 'beacon-session',
    confirmedPlayback: true,
    catalogProvider: 'local',
    playbackProvider: 'local',
    localId: 'Library/Private/beacon-track.flac:1:2',
  };

  assertSubmitted(await transport.submit(event, { unload: true }));
  assert.equal(await transport.submit(event, { unload: true }), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/listen/report');
  assert.doesNotMatch(calls[0].body, /undefined/);
  assert.doesNotMatch(calls[0].body, /Private|beacon-track|\.flac/);
  assert.equal(calls[1], 'fetch');
});

test('transport retries offline and non-2xx delivery without concurrent duplicates', async () => {
  let online = false;
  let calls = 0;
  const storageData = new Map();
  const storage = {
    getItem(key) {
      return storageData.has(key) ? storageData.get(key) : null;
    },
    setItem(key, value) {
      storageData.set(key, String(value));
    },
    removeItem(key) {
      storageData.delete(key);
    },
  };
  const transport = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      calls += 1;
      if (!online) throw new Error('offline');
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true, status: 'submitted' };
        },
      };
    },
  });
  const report = {
    sessionId: 'offline-session',
    confirmedPlayback: true,
    catalogProvider: 'netease',
    playbackProvider: 'netease',
    resolutionMode: 'direct',
    completeness: 'partial',
    sourceIds: { netease: '101', cookie: 'SECRET_SENTINEL_OUTBOX' },
    catalogSourceId: '101',
    playbackSourceId: '101',
    listenMs: 45_000,
    durationMs: 100_000,
    completion: {
      completed: false,
      ratio: 0.45,
      refreshToken: 'SECRET_SENTINEL_OUTBOX',
    },
    playedAt: 1_000,
    context: {
      type: 'playlist',
      token: 'SECRET_SENTINEL_OUTBOX',
      localPath: 'C:\\Users\\SECRET_SENTINEL_OUTBOX\\song.mp3',
    },
    reportingBinding: REPORTING_BINDING,
    token: 'SECRET_SENTINEL_OUTBOX',
  };

  const [first, duplicate] = await Promise.all([
    transport.submit(report),
    transport.submit(report),
  ]);
  assert.equal(first, false);
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  assert.equal(transport.status('offline-session'), 'pending');
  assert.match(storage.getItem('mineradio-listen-report-outbox-v1'), /offline-session/);
  assert.ok(
    Number.isSafeInteger(
      JSON.parse(storage.getItem('mineradio-listen-report-outbox-v1')).lockEpoch,
    ),
  );
  assert.ok(
    JSON.parse(storage.getItem('mineradio-listen-report-outbox-v1')).lockEpoch > 0,
  );
  assert.doesNotMatch(
    storage.getItem('mineradio-listen-report-outbox-v1'),
    /SECRET_SENTINEL_OUTBOX/,
  );

  online = true;
  assertSubmitted(await transport.retry('offline-session'));
  assert.equal(calls, 2);
  assertSubmitted(transport.status('offline-session'));
  assert.equal(storage.getItem('mineradio-listen-report-outbox-v1'), null);
  transport.destroy();
});

test('transport keeps capacity and server failures pending, then accepts one successful retry', async () => {
  let responseStatus = 503;
  let calls = 0;
  const transport = createListenTransport({
    autoRetry: false,
    fetch: async () => {
      calls += 1;
      if (responseStatus === 503) {
        return {
          ok: false,
          async json() {
            return {
              accepted: false,
              localRecorded: false,
              error: 'LISTEN_JOURNAL_CAPACITY',
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true, status: 'unsupported' };
        },
      };
    },
  });
  const report = { sessionId: 'capacity-session' };
  assert.equal(await transport.submit(report), false);
  assert.equal(transport.status('capacity-session'), 'pending');
  responseStatus = 200;
  assert.equal((await transport.retry('capacity-session')).delivery, 'unsupported');
  assert.equal(await transport.retry('capacity-session'), false);
  assert.equal(calls, 2);
  transport.destroy();
});

test('permanent HTTP failures become terminal while retryable responses remain pending', async () => {
  let calls = 0;
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const conflict = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      calls += 1;
      return {
        ok: false,
        status: 409,
        async json() {
          return { error: 'LISTEN_SESSION_CONFLICT' };
        },
      };
    },
  });
  const conflictResult = await conflict.submit({ sessionId: 'permanent-conflict' });
  assert.equal(conflictResult.delivery, 'terminal');
  assert.equal(conflictResult.status, 'conflict');
  assert.equal(conflict.status('permanent-conflict').status, 'conflict');
  assert.equal(await conflict.retry('permanent-conflict'), false);
  assert.deepEqual(await conflict.flushDue(), []);
  assert.equal(calls, 1);
  conflict.destroy();

  const conflictRestarted = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      calls += 1;
      throw new Error('terminal conflict must not replay');
    },
  });
  const restoredConflict = conflictRestarted.status('permanent-conflict');
  assert.equal(restoredConflict.delivery, 'terminal');
  assert.equal(restoredConflict.status, 'conflict');
  assert.deepEqual(await conflictRestarted.flushDue(), []);
  assert.equal(calls, 1);
  conflictRestarted.destroy();

  const retryable = createListenTransport({
    autoRetry: false,
    fetch: async () => ({
      ok: false,
      status: 429,
      headers: { get: name => name.toLowerCase() === 'retry-after' ? '30' : null },
      async json() {
        return { error: 'RATE_LIMITED' };
      },
    }),
  });
  assert.equal(await retryable.submit({ sessionId: 'rate-limited' }), false);
  assert.equal(retryable.status('rate-limited'), 'pending');
  retryable.destroy();
});

test('outbox reserves bounded capacity before exposing pending state', async () => {
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const first = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  const results = [];
  for (let index = 0; index < 40; index += 1) {
    results.push(await first.submit({ sessionId: `capacity-${index}` }));
  }
  assert.equal(
    results.slice(0, 32).every(result => result === false),
    true,
  );
  assert.deepEqual(
    results.slice(32),
    Array.from({ length: 8 }, () => ({
      accepted: false,
      localRecorded: true,
      status: 'rejected',
      code: 'OUTBOX_CAPACITY_EXCEEDED',
    })),
  );
  for (let index = 0; index < 32; index += 1) {
    assert.equal(first.status(`capacity-${index}`), 'pending');
  }
  for (let index = 32; index < 40; index += 1) {
    assert.equal(first.status(`capacity-${index}`), '');
  }
  first.destroy();

  const restarted = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(
    Array.from({ length: 32 }, (_, index) => restarted.status(`capacity-${index}`))
      .every(status => status === 'pending'),
    true,
  );
  assert.equal(restarted.status('capacity-32'), '');
  restarted.destroy();
});

test('unload falls back from a false beacon and queues a true beacon exactly once', async () => {
  let beaconResult = false;
  let fetchCalls = 0;
  let beaconCalls = 0;
  const transport = createListenTransport({
    autoRetry: false,
    sendBeacon: () => {
      beaconCalls += 1;
      return beaconResult;
    },
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  assertSubmitted(await transport.submit({ sessionId: 'beacon-fallback' }, { unload: true }));
  assert.equal(fetchCalls, 1);
  assert.equal(beaconCalls, 1);

  beaconResult = true;
  assertSubmitted(
    await transport.submit({ sessionId: 'beacon-queued' }, { unload: true }),
  );
  assertSubmitted(transport.status('beacon-queued'));
  assert.equal(await transport.submit({ sessionId: 'beacon-queued' }, { unload: true }), false);
  assert.equal(fetchCalls, 2);
  assert.equal(beaconCalls, 2);
  transport.destroy();
});

test('transport restores a bounded secret-free outbox and destroy clears retry timers', async () => {
  const pendingTimers = new Set();
  const storageData = new Map();
  const storage = {
    getItem(key) {
      return storageData.get(key) || null;
    },
    setItem(key, value) {
      storageData.set(key, String(value));
    },
    removeItem(key) {
      storageData.delete(key);
    },
  };
  const timerApi = {
    setTimeout(fn) {
      const handle = { fn, unref() {} };
      pendingTimers.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      pendingTimers.delete(handle);
    },
  };
  const first = createListenTransport({
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
    setTimeout: timerApi.setTimeout,
    clearTimeout: timerApi.clearTimeout,
  });
  await first.submit({ sessionId: 'persisted-session', token: 'SECRET_SENTINEL' });
  assert.equal(first.status('persisted-session'), 'pending');
  assert.equal(pendingTimers.size, 1);
  first.destroy();
  assert.equal(pendingTimers.size, 0);

  const calls = [];
  const restarted = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  assert.equal(restarted.status('persisted-session'), 'pending');
  assertSubmitted(await restarted.retry('persisted-session'));
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /SECRET_SENTINEL/);
  restarted.destroy();
});

test('transport enforces the outbox budget by UTF-8 serialized bytes', async () => {
  const storageData = new Map();
  const storage = {
    getItem(key) {
      return storageData.get(key) || null;
    },
    setItem(key, value) {
      storageData.set(key, String(value));
    },
    removeItem(key) {
      storageData.delete(key);
    },
  };
  const transport = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  for (let index = 0; index < 20; index += 1) {
    await transport.submit({
      sessionId: `utf8-${index}`,
      context: { type: '听'.repeat(4_000) },
    });
  }
  const serialized = storage.getItem('mineradio-listen-report-outbox-v1');
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 128 * 1024);
  transport.destroy();
});

test('transport destroy aborts inflight delivery and clears its request timeout', async () => {
  const timers = new Set();
  const controllers = [];
  class FakeAbortController {
    constructor() {
      this.signal = {};
      this.aborted = false;
      controllers.push(this);
    }

    abort() {
      this.aborted = true;
    }
  }
  const transport = createListenTransport({
    autoRetry: false,
    AbortController: FakeAbortController,
    setTimeout(fn) {
      const handle = { fn, unref() {} };
      timers.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    fetch: async () => new Promise(() => {}),
  });
  transport.submit({ sessionId: 'destroy-inflight' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.size, 1);
  transport.destroy();
  assert.equal(timers.size, 0);
  assert.equal(controllers[0].aborted, true);
});

test('a successful beacon stays durable until a later server-confirmed replay', async () => {
  const data = new Map();
  const storage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let fetchCalls = 0;
  const first = createListenTransport({
    autoRetry: false,
    storage,
    sendBeacon: () => true,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('beacon path must not also fetch');
    },
  });
  assert.equal(
    (await first.submit({ sessionId: 'beacon-durable' }, { unload: true })).delivery,
    'local-only',
  );
  assert.equal(first.status('beacon-durable').delivery, 'local-only');
  assert.match(
    storage.getItem('mineradio-listen-report-outbox-v1'),
    /beacon-durable/,
  );
  assert.equal(fetchCalls, 0);
  first.destroy();

  const replayed = [];
  const restarted = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async (_url, options) => {
      replayed.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true, duplicate: true };
        },
      };
    },
  });
  assert.equal(restarted.status('beacon-durable'), 'pending');
  assertSubmitted(await restarted.retry('beacon-durable'));
  assert.deepEqual(replayed.map(value => value.sessionId), ['beacon-durable']);
  assert.equal(storage.getItem('mineradio-listen-report-outbox-v1'), null);
  restarted.destroy();
});

test('outbox quota failure on the lock key gates network delivery', async () => {
  let calls = 0;
  const storage = {
    getItem() {
      return null;
    },
    setItem() {
      const error = new Error('quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    },
    removeItem() {},
  };
  const transport = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assert.equal(await transport.submit({ sessionId: 'quota-lock' }), false);
  assert.equal(transport.status('quota-lock'), 'pending');
  assert.equal(calls, 0);
  transport.destroy();
});

test('two transports merge their bounded shared outbox without overwriting peer sessions', async () => {
  const data = new Map();
  const storage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const options = {
    autoRetry: false,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  };
  const first = createListenTransport(options);
  const second = createListenTransport(options);
  await Promise.all([
    first.submit({ sessionId: 'tab-a-session' }),
    second.submit({ sessionId: 'tab-b-session' }),
  ]);

  const saved = JSON.parse(storage.getItem('mineradio-listen-report-outbox-v1'));
  assert.deepEqual(
    saved.entries.map(item => item.event.sessionId).sort(),
    ['tab-a-session', 'tab-b-session'],
  );
  assert.ok(saved.entries.length <= 32);
  assert.ok(
    Buffer.byteLength(JSON.stringify(saved), 'utf8') <= 128 * 1024,
  );
  first.destroy();
  second.destroy();
});

test('local reporting replaces nested path and filename signatures in new and legacy outbox events', async () => {
  let now = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'local-private-session',
  });
  const sourceSignature = 'Albums/Private Folder/Secret Song.flac:123:456';
  const started = state.startConfirmed({
    confirmed: true,
    transactionId: 'local-private-transaction',
    mediaTime: 0,
    durationMs: 1_000,
    song: {
      type: 'local',
      provider: 'local',
      catalogProvider: 'local',
      playbackProvider: 'local',
      catalogSourceId: sourceSignature,
      playbackSourceId: sourceSignature,
      localId: sourceSignature,
      key: `library:${sourceSignature}`,
      name: 'Secret Song',
    },
  });
  assert.match(started.sourceIds.local, /^local-v2-[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(started), /Private Folder|Secret Song\.flac|Albums[\\/]/);
  now = 1_000;
  state.tick({ mediaTime: 1, durationMs: 1_000 });
  const finalized = state.finalize({ reason: 'ended' });

  const sent = [];
  const transport = createListenTransport({
    autoRetry: false,
    fetch: async (_url, options) => {
      sent.push(options.body);
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  assertSubmitted(await transport.submit(finalized));
  assert.doesNotMatch(sent[0], /Private Folder|Secret Song|Albums[\\/]/);
  transport.destroy();

  const legacyData = new Map();
  legacyData.set('mineradio-listen-report-outbox-v1', JSON.stringify({
    version: 1,
    entries: [{
      event: {
        sessionId: 'legacy-local-session',
        confirmedPlayback: true,
        catalogProvider: 'local',
        playbackProvider: 'local',
        resolutionMode: 'local',
        completeness: 'partial',
        sourceIds: { local: 'Secret Song.flac:123:456' },
        catalogSourceId: 'Secret Song.flac:123:456',
        playbackSourceId: 'Secret Song.flac:123:456',
        listenMs: 1_000,
        durationMs: 1_000,
        completion: { completed: true, ratio: 1 },
        playedAt: 1_000,
        context: { type: 'local' },
      },
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: 1,
    }],
  }));
  const legacyStorage = {
    getItem(key) {
      return legacyData.get(key) || null;
    },
    setItem(key, value) {
      legacyData.set(key, String(value));
    },
    removeItem(key) {
      legacyData.delete(key);
    },
  };
  const replayBodies = [];
  const legacy = createListenTransport({
    autoRetry: false,
    storage: legacyStorage,
    fetch: async (_url, options) => {
      replayBodies.push(options.body);
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  assertSubmitted(await legacy.retry('legacy-local-session'));
  assert.match(replayBodies[0], /local-v2-[a-f0-9]{64}/);
  assert.doesNotMatch(replayBodies[0], /Secret Song|\.flac/);
  legacy.destroy();
});

test('expired outbox lease cannot let a stale writer overwrite a durable peer beacon', async () => {
  const data = new Map();
  let now = 0;
  let second;
  let secondSubmit;
  let pauseFirstWriter = false;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (
        key === 'mineradio-listen-report-outbox-v1'
        && pauseFirstWriter
        && JSON.parse(data.get('mineradio-listen-report-outbox-v1-lock') || '{}')
          .token?.startsWith('writer-a:')
      ) {
        pauseFirstWriter = false;
        now = 3_000;
        secondSubmit = second.submit(
          { sessionId: 'durable-tab-b' },
          { unload: true },
        );
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  function cryptoFor(id) {
    return { randomUUID: () => id };
  }
  const first = createListenTransport({
    autoRetry: false,
    clock: () => now,
    crypto: cryptoFor('writer-a'),
    storage,
    sendBeacon: () => true,
  });
  second = createListenTransport({
    autoRetry: false,
    clock: () => now,
    crypto: cryptoFor('writer-b'),
    storage,
    sendBeacon: () => true,
  });

  pauseFirstWriter = true;
  const firstSubmit = first.submit(
    { sessionId: 'durable-tab-a' },
    { unload: true },
  );
  await Promise.all([firstSubmit, secondSubmit]);

  const saved = JSON.parse(data.get('mineradio-listen-report-outbox-v1'));
  assert.deepEqual(
    saved.entries.map(item => item.event.sessionId).sort(),
    ['durable-tab-a', 'durable-tab-b'],
  );
  assert.ok(saved.entries.length <= 32);
  assert.ok(Buffer.byteLength(JSON.stringify(saved), 'utf8') <= 128 * 1024);
  first.destroy();
  second.destroy();
});

test('local media identity is private, stable across sessions and reloads, and aggregates HOME stats', () => {
  const data = new Map();
  const storage = {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const cryptoApi = {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index + 1;
      return bytes;
    },
  };
  const nestedPath = 'Albums/Private Folder/Disc 1/Secret Song.flac:123:456';
  function completedLocal(sessionId, transactionId, signature) {
    let now = 0;
    const state = createListenSessionState({
      clock: () => now,
      createId: () => sessionId,
      crypto: cryptoApi,
      storage,
    });
    state.startConfirmed({
      confirmed: true,
      transactionId,
      mediaTime: 0,
      durationMs: 1_000,
      song: {
        type: 'local',
        provider: 'local',
        catalogProvider: 'local',
        playbackProvider: 'local',
        catalogSourceId: signature,
        playbackSourceId: signature,
        localId: signature,
        key: `library:${signature}`,
        name: 'Secret Song',
        artist: 'Private Artist',
      },
    });
    now = 1_000;
    state.tick({ mediaTime: 1, durationMs: 1_000 });
    return state.finalize({ reason: 'ended' });
  }

  const first = completedLocal('stable-local-a', 'stable-local-tx-a', nestedPath);
  const reloaded = completedLocal('stable-local-b', 'stable-local-tx-b', nestedPath);
  const other = completedLocal(
    'stable-local-c',
    'stable-local-tx-c',
    'Albums/Private Folder/Disc 2/Secret Song.flac:123:456',
  );
  assert.match(first.catalogSourceId, /^local-v2-[a-f0-9]{64}$/);
  const installSalt = storage.getItem('mineradio-local-media-salt-v1');
  assert.match(installSalt, /^[a-f0-9]{64}$/);
  assert.equal(
    first.catalogSourceId,
    `local-v2-${crypto.createHmac('sha256', installSalt).update(nestedPath).digest('hex')}`,
  );
  assert.equal(reloaded.catalogSourceId, first.catalogSourceId);
  assert.notEqual(other.catalogSourceId, first.catalogSourceId);
  assert.doesNotMatch(
    JSON.stringify({ first, reloaded, other, storage: [...data.entries()] }),
    /Private Folder|Secret Song\.flac|Albums[\\/]/,
  );

  let stats = recordLocalListen(null, first);
  stats = recordLocalListen(stats, reloaded);
  assert.equal(Object.keys(stats.songs).length, 1);
  assert.equal(stats.songs[`local:${first.catalogSourceId}`].plays, 2);

  let failedStorageSerial = 0;
  let fallbackNow = 0;
  const fallback = createListenSessionState({
    clock: () => fallbackNow,
    createId: () => `fallback-${++failedStorageSerial}`,
    crypto: null,
    storage: null,
  });
  function fallbackLocal(transactionId, signature) {
    fallback.startConfirmed({
      confirmed: true,
      transactionId,
      mediaTime: 0,
      durationMs: 1_000,
      song: {
        type: 'local',
        provider: 'local',
        playbackProvider: 'local',
        localId: signature,
      },
    });
    fallbackNow += 1_000;
    fallback.tick({ mediaTime: 1, durationMs: 1_000 });
    return fallback.finalize({ reason: 'ended' });
  }
  const fallbackFirst = fallbackLocal('fallback-tx-a', 'nested/a.flac:1:2');
  const fallbackSame = fallbackLocal('fallback-tx-b', 'nested/a.flac:1:2');
  const fallbackOther = fallbackLocal('fallback-tx-c', 'nested/b.flac:1:2');
  assert.equal(fallbackSame.catalogSourceId, fallbackFirst.catalogSourceId);
  assert.notEqual(fallbackOther.catalogSourceId, fallbackFirst.catalogSourceId);
  assert.doesNotMatch(
    JSON.stringify([fallbackFirst, fallbackSame, fallbackOther]),
    /nested[\\/]|\.flac/,
  );
});

test('storage getter and every localStorage operation fail closed to memory without throwing', async t => {
  await t.test('root localStorage getter', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          const error = new Error('storage getter blocked');
          error.name = 'SecurityError';
          throw error;
        },
      });
      assert.doesNotThrow(() => createListenSessionState({
        crypto: null,
        createId: () => 'getter-session',
      }));
      assert.doesNotThrow(() => createListenTransport({
        autoRetry: false,
        crypto: null,
      }));
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  for (const failingOperation of [
    'length',
    'key',
    'getItem',
    'setItem',
    'removeItem',
  ]) {
    await t.test(failingOperation, async () => {
      const data = new Map();
      const storage = {
        key(index) {
          if (failingOperation === 'key') throw new DOMException('blocked', 'SecurityError');
          return [...data.keys()][index] || null;
        },
        getItem(key) {
          if (failingOperation === 'getItem') throw new DOMException('blocked', 'SecurityError');
          return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
          if (failingOperation === 'setItem') throw new DOMException('blocked', 'SecurityError');
          data.set(key, String(value));
        },
        removeItem(key) {
          if (failingOperation === 'removeItem') throw new DOMException('blocked', 'SecurityError');
          data.delete(key);
        },
      };
      Object.defineProperty(storage, 'length', {
        get() {
          if (failingOperation === 'length') throw new DOMException('blocked', 'SecurityError');
          return failingOperation === 'key' ? 1 : data.size;
        },
      });
      let transport;
      assert.doesNotThrow(() => {
        createListenSessionState({
          storage,
          crypto: null,
          createId: () => `storage-${failingOperation}`,
        });
        transport = createListenTransport({
          autoRetry: false,
          storage,
          crypto: null,
          fetch: async () => ({
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          }),
        });
      });
      await assert.doesNotReject(() => transport.submit({
        sessionId: `storage-${failingOperation}`,
      }));
      transport.destroy();
    });
  }

  await t.test('retry timer', async () => {
    const timers = [];
    const blockedStorage = {
      get length() {
        throw new DOMException('blocked', 'SecurityError');
      },
      key() {
        throw new DOMException('blocked', 'SecurityError');
      },
      getItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    const transport = createListenTransport({
      storage: blockedStorage,
      crypto: null,
      fetch: async () => {
        throw new Error('offline');
      },
      setTimeout(callback) {
        const timer = { callback, unref() {} };
        timers.push(timer);
        return timer;
      },
      clearTimeout() {},
    });
    assert.equal(await transport.submit({ sessionId: 'storage-timer' }), false);
    assert.ok(timers.length >= 1);
    assert.doesNotThrow(() => timers[0].callback());
    await new Promise(resolve => setImmediate(resolve));
    transport.destroy();
  });
});

test('same-millisecond no-crypto transports keep distinct shards when canonical quota fails', async () => {
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (key === 'mineradio-listen-report-outbox-v1') {
        const error = new Error('canonical quota');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const options = {
    autoRetry: false,
    clock: () => 1_000,
    crypto: null,
    random: () => 0.5,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  };
  const first = createListenTransport(options);
  const second = createListenTransport(options);
  await Promise.all([
    first.submit({ sessionId: 'same-ms-a' }),
    second.submit({ sessionId: 'same-ms-b' }),
  ]);

  const shardKeys = [...data.keys()]
    .filter(key => key.startsWith('mineradio-listen-report-outbox-v1-writer-'));
  assert.equal(shardKeys.length, 2);
  assert.deepEqual(
    shardKeys.flatMap(key => JSON.parse(data.get(key)).entries)
      .map(item => item.event.sessionId)
      .sort(),
    ['same-ms-a', 'same-ms-b'],
  );
  assert.equal(data.has('mineradio-listen-report-outbox-v1'), false);
  first.destroy();
  second.destroy();
});

test('beacon cannot bypass transient failures from an existing storage API', async () => {
  function blockedStorage() {
    return {
      get length() {
        throw new DOMException('blocked', 'SecurityError');
      },
      key() {
        throw new DOMException('blocked', 'SecurityError');
      },
      getItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem() {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
  }
  let successfulFetches = 0;
  const successful = createListenTransport({
    autoRetry: false,
    storage: blockedStorage(),
    sendBeacon: () => true,
    fetch: async () => {
      successfulFetches += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  assert.equal(
    await successful.submit({ sessionId: 'beacon-memory-success' }, { unload: true }),
    false,
  );
  assert.equal(successfulFetches, 0);
  assert.equal(successful.status('beacon-memory-success'), 'pending');
  successful.destroy();

  let failedFetches = 0;
  const failed = createListenTransport({
    autoRetry: false,
    storage: blockedStorage(),
    sendBeacon: () => true,
    fetch: async () => {
      failedFetches += 1;
      throw new Error('offline');
    },
  });
  assert.equal(
    await failed.submit({ sessionId: 'beacon-memory-failed' }, { unload: true }),
    false,
  );
  assert.equal(failedFetches, 0);
  assert.equal(failed.status('beacon-memory-failed'), 'pending');
  failed.destroy();
});

test('offline outbox shards converge across twenty restarts instead of multiplying', async () => {
  const data = new Map();
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 0;
  for (let restart = 0; restart < 20; restart += 1) {
    const transport = createListenTransport({
      autoRetry: false,
      clock: () => now,
      crypto: null,
      random: () => (restart + 1) / 100,
      storage,
      fetch: async () => {
        throw new Error('offline');
      },
    });
    if (transport.status('twenty-restarts')) {
      await transport.retry('twenty-restarts');
    } else {
      await transport.submit({ sessionId: 'twenty-restarts' });
    }
    transport.destroy();
    now += 5_000;
  }

  const shardKeys = [...data.keys()]
    .filter(key => key.startsWith('mineradio-listen-report-outbox-v1-writer-'));
  assert.ok(shardKeys.length <= 2);
  const main = JSON.parse(data.get('mineradio-listen-report-outbox-v1'));
  assert.deepEqual(
    main.entries.map(item => item.event.sessionId),
    ['twenty-restarts'],
  );
  assert.ok(main.entries.length <= 32);
  assert.ok(Buffer.byteLength(JSON.stringify(main), 'utf8') <= 128 * 1024);
});

test('first-install salt interleaving gives both active instances one final value', () => {
  const data = new Map();
  let interleave = true;
  let second = null;
  let secondNow = 0;
  function cryptoFilled(byte) {
    return {
      getRandomValues(bytes) {
        bytes.fill(byte);
        return bytes;
      },
    };
  }
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (key === 'mineradio-local-media-salt-v1' && interleave) {
        interleave = false;
        second = createListenSessionState({
          clock: () => secondNow,
          createId: () => 'salt-session-b',
          crypto: cryptoFilled(0xbb),
          storage,
        });
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let firstNow = 0;
  const first = createListenSessionState({
    clock: () => firstNow,
    createId: () => 'salt-session-a',
    crypto: cryptoFilled(0xaa),
    storage,
  });
  function finish(state, transactionId, setNow) {
    state.startConfirmed({
      confirmed: true,
      transactionId,
      mediaTime: 0,
      durationMs: 1_000,
      song: {
        type: 'local',
        provider: 'local',
        playbackProvider: 'local',
        localId: 'nested/private/same.flac:1:2',
      },
    });
    setNow();
    state.tick({ mediaTime: 1, durationMs: 1_000 });
    return state.finalize({ reason: 'ended' });
  }
  const firstEvent = finish(first, 'salt-tx-a', () => { firstNow = 1_000; });
  const secondEvent = finish(second, 'salt-tx-b', () => { secondNow = 1_000; });
  assert.equal(firstEvent.catalogSourceId, secondEvent.catalogSourceId);
  assert.match(
    storage.getItem('mineradio-local-media-salt-v1'),
    /^[a-f0-9]{64}$/,
  );
  assert.doesNotMatch(
    JSON.stringify([firstEvent, secondEvent]),
    /nested[\\/]|same\.flac/,
  );
});

test('durable retry state persists every failure and restarts at the exponential deadline', async () => {
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'a'.repeat(64)],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 1_000;
  const first = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    maxRetryMs: 8_000,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('offline once');
    },
  });
  assert.equal(await first.submit({ sessionId: 'durable-backoff' }), false);
  let saved = JSON.parse(data.get('mineradio-listen-report-outbox-v1'));
  let entry = saved.entries.find(item => item.event.sessionId === 'durable-backoff');
  assert.equal(entry.attempts, 1);
  assert.equal(entry.nextAttemptAt, 2_000);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.lastErrorCode, 'NETWORK_ERROR');
  first.destroy();

  now = 2_000;
  const second = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    maxRetryMs: 8_000,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('offline twice');
    },
  });
  assert.equal(await second.retry('durable-backoff'), false);
  saved = JSON.parse(data.get('mineradio-listen-report-outbox-v1'));
  entry = saved.entries.find(item => item.event.sessionId === 'durable-backoff');
  assert.equal(entry.attempts, 2);
  assert.equal(entry.nextAttemptAt, 4_000);
  assert.equal(entry.state, 'pending');
  assert.equal(entry.lastErrorCode, 'NETWORK_ERROR');
  second.destroy();

  now = 2_001;
  const scheduled = [];
  const third = createListenTransport({
    baseRetryMs: 1_000,
    maxRetryMs: 8_000,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('must not hot loop');
    },
    setTimeout(callback, delay) {
      const handle = { callback, delay, unref() {} };
      scheduled.push(handle);
      return handle;
    },
    clearTimeout() {},
  });
  assert.equal(third.status('durable-backoff'), 'pending');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_999);
  third.destroy();
});

test('transient storage operation failures recover and merge memory pending records', async t => {
  for (const failingOperation of [
    'getItem',
    'setItem',
    'length',
    'key',
  ]) {
    await t.test(failingOperation, async () => {
      const data = new Map([
        ['mineradio-local-media-salt-v1', 'b'.repeat(64)],
      ]);
      let now = 0;
      let armed = true;
      function failOnce(operation) {
        if (failingOperation !== operation || !armed) return;
        armed = false;
        throw new DOMException(`transient ${operation}`, 'SecurityError');
      }
      const storage = {
        get length() {
          failOnce('length');
          return data.size;
        },
        key(index) {
          failOnce('key');
          return [...data.keys()][index] || null;
        },
        getItem(key) {
          failOnce('getItem');
          return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
          failOnce('setItem');
          data.set(key, String(value));
        },
        removeItem(key) {
          failOnce('removeItem');
          data.delete(key);
        },
      };
      const transport = createListenTransport({
        autoRetry: false,
        baseRetryMs: 100,
        clock: () => now,
        storage,
        fetch: async () => {
          throw new Error('offline');
        },
      });

      assert.equal(
        await transport.submit({ sessionId: `transient-${failingOperation}` }),
        false,
      );
      now = 5_000;
      assert.equal(
        await transport.retry(`transient-${failingOperation}`),
        false,
      );

      const saved = JSON.parse(data.get('mineradio-listen-report-outbox-v1'));
      const entry = saved.entries.find(item => (
        item.event.sessionId === `transient-${failingOperation}`
      ));
      assert.ok(entry);
      assert.equal(entry.attempts, 2);
      assert.equal(entry.nextAttemptAt, 5_200);
      transport.destroy();
    });
  }
});

test('resolved storage read failures gate delivery until pending is durable', async t => {
  for (const failingOperation of ['getItem', 'length', 'key']) {
    await t.test(failingOperation, async () => {
      const data = new Map([
        ['mineradio-local-media-salt-v1', 'd'.repeat(64)],
      ]);
      let now = 0;
      let failures = 1;
      let online = false;
      let fetchCalls = 0;
      function failOnce(operation) {
        if (operation !== failingOperation || failures === 0) return;
        failures -= 1;
        throw new DOMException(`transient ${operation}`, 'SecurityError');
      }
      const storage = {
        get length() {
          failOnce('length');
          return data.size;
        },
        key(index) {
          failOnce('key');
          return [...data.keys()][index] || null;
        },
        getItem(key) {
          failOnce('getItem');
          return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
          data.set(key, String(value));
        },
        removeItem(key) {
          data.delete(key);
        },
      };
      const event = {
        sessionId: `transient-gate-${failingOperation}`,
        confirmedPlayback: true,
        catalogProvider: 'netease',
        playbackProvider: 'netease',
        reportingBinding: REPORTING_BINDING,
      };
      const first = createListenTransport({
        autoRetry: false,
        baseRetryMs: 100,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          if (!online) throw new Error('offline');
          return {
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          };
        },
      });

      assert.equal(await first.submit(event), false);
      assert.equal(fetchCalls, 0);

      now = 5_000;
      assert.equal(await first.retry(event.sessionId), false);
      assert.equal(fetchCalls, 1);
      assert.match(
        data.get('mineradio-listen-report-outbox-v1'),
        new RegExp(event.sessionId),
      );
      first.destroy();

      online = true;
      const restarted = createListenTransport({
        autoRetry: false,
        baseRetryMs: 100,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          return {
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          };
        },
      });
      assert.equal(restarted.status(event.sessionId), 'pending');
      assertSubmitted(await restarted.retry(event.sessionId));
      assert.equal(fetchCalls, 2);
      restarted.destroy();
    });
  }
});

test('timer accessors and methods cannot reject transport work or destroy', async t => {
  for (const property of ['setTimeout', 'clearTimeout']) {
    await t.test(`${property} getter`, async () => {
      const options = {
        autoRetry: false,
        fetch: async () => ({
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        }),
      };
      Object.defineProperty(options, property, {
        get() {
          throw new DOMException(`${property} blocked`, 'SecurityError');
        },
      });
      let transport;
      assert.doesNotThrow(() => {
        transport = createListenTransport(options);
      });
      assertSubmitted(await transport.submit({ sessionId: `timer-getter-${property}` }));
      assert.doesNotThrow(() => transport.destroy());
    });
  }

  await t.test('request setTimeout method', async () => {
    const transport = createListenTransport({
      autoRetry: false,
      setTimeout() {
        throw new Error('request timer blocked');
      },
      fetch: async () => ({
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      }),
    });
    assertSubmitted(await transport.submit({ sessionId: 'timer-set-method' }));
    transport.destroy();
  });

  await t.test('retry schedule setTimeout method', async () => {
    let timerCalls = 0;
    const transport = createListenTransport({
      setTimeout() {
        timerCalls += 1;
        if (timerCalls > 1) throw new Error('schedule timer blocked');
        return { unref() {} };
      },
      clearTimeout() {},
      fetch: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(await transport.submit({ sessionId: 'timer-schedule-method' }), false);
    assert.equal(await transport.retry('timer-schedule-method'), false);
    transport.destroy();
  });

  await t.test('request clearTimeout method preserves success', async () => {
    const transport = createListenTransport({
      autoRetry: false,
      setTimeout() {
        return {};
      },
      clearTimeout() {
        throw new Error('request clear blocked');
      },
      fetch: async () => ({
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      }),
    });
    assertSubmitted(await transport.submit({ sessionId: 'timer-clear-success' }));
    assert.doesNotThrow(() => transport.destroy());
  });

  await t.test('timer handle unref getter', async () => {
    let timerCalls = 0;
    const transport = createListenTransport({
      setTimeout() {
        timerCalls += 1;
        if (timerCalls === 1) return {};
        const handle = {};
        Object.defineProperty(handle, 'unref', {
          get() {
            throw new Error('unref getter blocked');
          },
        });
        return handle;
      },
      clearTimeout() {},
      fetch: async () => {
        throw new Error('offline');
      },
    });
    assert.equal(await transport.submit({ sessionId: 'timer-unref-getter' }), false);
    transport.destroy();
  });

  await t.test('destroy clearTimeout method still aborts and releases requests', async () => {
    const controllers = [];
    class FakeAbortController {
      constructor() {
        this.signal = {};
        this.aborted = false;
        controllers.push(this);
      }

      abort() {
        this.aborted = true;
      }
    }
    const transport = createListenTransport({
      autoRetry: false,
      AbortController: FakeAbortController,
      setTimeout() {
        return {};
      },
      clearTimeout() {
        throw new Error('destroy clear blocked');
      },
      fetch: async () => new Promise(() => {}),
    });
    transport.submit({ sessionId: 'timer-destroy-clear' });
    await new Promise(resolve => setImmediate(resolve));
    assert.doesNotThrow(() => transport.destroy());
    assert.equal(controllers[0].aborted, true);
  });

  for (const property of ['setTimeout', 'clearTimeout']) {
    await t.test(`global ${property} getter`, () => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, property);
      let transport;
      try {
        Object.defineProperty(globalThis, property, {
          configurable: true,
          get() {
            throw new DOMException(`global ${property} blocked`, 'SecurityError');
          },
        });
        assert.doesNotThrow(() => {
          transport = createListenTransport({
            autoRetry: false,
            fetch: async () => ({
              ok: true,
              async json() {
                return { accepted: true, localRecorded: true };
              },
            }),
          });
        });
      } finally {
        Object.defineProperty(globalThis, property, descriptor);
      }
      assert.doesNotThrow(() => transport.destroy());
    });
  }

  await t.test('global AbortController getter', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'AbortController');
    let transport;
    try {
      Object.defineProperty(globalThis, 'AbortController', {
        configurable: true,
        get() {
          throw new DOMException('global AbortController blocked', 'SecurityError');
        },
      });
      transport = createListenTransport({
        autoRetry: false,
        setTimeout() {
          return {};
        },
        clearTimeout() {},
        fetch: async () => ({
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        }),
      });
      assertSubmitted(
        await transport.submit({ sessionId: 'timer-global-abort-getter' }),
      );
    } finally {
      Object.defineProperty(globalThis, 'AbortController', descriptor);
    }
    transport.destroy();
  });
});

test('an abandoned salt candidate is unpublished until an expired owner commits it', () => {
  const modulePath = require.resolve('../public/listen-session-state');
  const data = new Map();
  const candidate = 'c'.repeat(64);
  const localSignature = 'nested/private/crashed-owner.flac:10:20';
  let now = 500;
  data.set('mineradio-local-media-salt-v1-lock', JSON.stringify({
    token: 'crashed-owner',
    candidate,
    expiresAt: 1_000,
  }));
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  function freshApi() {
    delete require.cache[modulePath];
    return require(modulePath);
  }
  function createLocalState(api, sessionId) {
    return api.createListenSessionState({
      clock: () => now,
      createId: () => sessionId,
      crypto: {
        getRandomValues(bytes) {
          bytes.fill(sessionId.endsWith('a') ? 0xaa : 0xbb);
          return bytes;
        },
      },
      storage,
    });
  }
  function finish(state, transactionId) {
    const started = state.startConfirmed({
      confirmed: true,
      transactionId,
      mediaTime: 0,
      durationMs: 1_000,
      song: {
        type: 'local',
        provider: 'local',
        playbackProvider: 'local',
        localId: localSignature,
      },
    });
    if (!started) return null;
    now += 1_000;
    state.tick({ mediaTime: 1, durationMs: 1_000 });
    return state.finalize({ reason: 'ended' });
  }

  const waitingState = createLocalState(freshApi(), 'salt-crash-a');
  const beforeExpiry = waitingState.startConfirmed({
    confirmed: true,
    transactionId: 'salt-crash-tx-a',
    mediaTime: 0,
    durationMs: 1_000,
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
      localId: localSignature,
    },
  });
  assert.equal(beforeExpiry.status, 'waiting-salt');
  assert.equal(data.has('mineradio-local-media-salt-v1'), false);
  assert.doesNotMatch(JSON.stringify(beforeExpiry), /nested[\\/]|crashed-owner\.flac/);
  now = 750;
  assert.equal(waitingState.tick({ mediaTime: 0.25, durationMs: 1_000 }).status, 'waiting-salt');
  assert.equal(data.has('mineradio-local-media-salt-v1'), false);

  now = 2_000;
  const recovered = finish(
    createLocalState(freshApi(), 'salt-crash-b'),
    'salt-crash-tx-b',
  );
  assert.ok(recovered);
  assert.equal(data.get('mineradio-local-media-salt-v1'), candidate);

  now = 4_000;
  const reloaded = finish(
    createLocalState(freshApi(), 'salt-crash-c'),
    'salt-crash-tx-c',
  );
  assert.equal(reloaded.catalogSourceId, recovered.catalogSourceId);
  assert.doesNotMatch(
    JSON.stringify([recovered, reloaded, [...data.entries()]]),
    /nested[\\/]|crashed-owner\.flac/,
  );
});

test('a transient canonical salt confirmation read never publishes an ephemeral id', () => {
  const data = new Map();
  let now = 0;
  let saltReads = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      if (key === 'mineradio-local-media-salt-v1') {
        saltReads += 1;
        if (saltReads === 4) {
          throw new DOMException('transient salt confirmation', 'SecurityError');
        }
      }
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'salt-confirmation-session',
    crypto: {
      getRandomValues(bytes) {
        bytes.fill(0xdd);
        return bytes;
      },
    },
    storage,
  });
  const input = {
    confirmed: true,
    transactionId: 'salt-confirmation-transaction',
    mediaTime: 0,
    durationMs: 1_000,
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
      localId: 'private/confirmation.flac:1:2',
    },
  };

  const waiting = state.startConfirmed(input);
  assert.equal(waiting.status, 'waiting-salt');
  assert.doesNotMatch(JSON.stringify(waiting), /private[\\/]|confirmation\.flac/);
  now = 100;
  const started = state.tick({ mediaTime: 0.1, durationMs: 1_000 });
  assert.ok(started);
  assert.equal(
    started.catalogSourceId,
    `local-v2-${crypto
      .createHmac('sha256', 'dd'.repeat(32))
      .update('private/confirmation.flac:1:2')
      .digest('hex')}`,
  );
  assert.doesNotMatch(JSON.stringify(started), /private[\\/]|confirmation\.flac/);
});

test('retry scheduling falls back after an injected timer failure without a hot loop', async () => {
  const timerDescriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    AbortController: Object.getOwnPropertyDescriptor(globalThis, 'AbortController'),
  };
  const defaultTimers = new Set();
  const injectedTimers = new Set();
  let now = 0;
  let online = false;
  let fetchCalls = 0;
  let injectedCalls = 0;
  function installControlledGlobals() {
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value(callback, delay) {
        const handle = {
          delay,
          unref() {},
          run() {
            defaultTimers.delete(handle);
            callback();
          },
        };
        defaultTimers.add(handle);
        return handle;
      },
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value(handle) {
        defaultTimers.delete(handle);
      },
    });
    Object.defineProperty(globalThis, 'AbortController', {
      configurable: true,
      value: undefined,
    });
  }
  function restoreGlobals() {
    Object.keys(timerDescriptors).forEach(key => {
      Object.defineProperty(globalThis, key, timerDescriptors[key]);
    });
  }

  installControlledGlobals();
  let transport;
  try {
    transport = createListenTransport({
      baseRetryMs: 100,
      clock: () => now,
      setTimeout(callback, delay) {
        injectedCalls += 1;
        if (injectedCalls === 1) throw new Error('transient injected timer failure');
        const handle = {
          callback,
          delay,
          unref() {},
          run() {
            injectedTimers.delete(handle);
            callback();
          },
        };
        injectedTimers.add(handle);
        return handle;
      },
      clearTimeout(handle) {
        injectedTimers.delete(handle);
      },
      fetch: async () => {
        fetchCalls += 1;
        if (!online) throw new Error('offline');
        return {
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        };
      },
    });
    assert.equal(await transport.submit({ sessionId: 'timer-fallback-retry' }), false);
    assert.equal(defaultTimers.size + injectedTimers.size, 1);
    const retryTimer = [...defaultTimers, ...injectedTimers][0];
    assert.equal(retryTimer.delay, 100);
    assert.ok(injectedCalls <= 2);

    now = 100;
    online = true;
    retryTimer.run();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assertSubmitted(transport.status('timer-fallback-retry'));
    assert.equal(fetchCalls, 2);
    assert.ok(injectedCalls <= 4);
    transport.destroy();
    assert.equal(defaultTimers.size, 0);
    assert.equal(injectedTimers.size, 0);
  } finally {
    if (transport) transport.destroy();
    restoreGlobals();
  }
});

test('request deadline and destroy settle delivery when injected timers and fetch never settle', async () => {
  const timerDescriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
  };
  const defaultTimers = new Set();
  function installControlledGlobals() {
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value(callback, delay) {
        const handle = {
          delay,
          unref() {},
          run() {
            defaultTimers.delete(handle);
            callback();
          },
        };
        defaultTimers.add(handle);
        return handle;
      },
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value(handle) {
        defaultTimers.delete(handle);
      },
    });
  }
  function restoreGlobals() {
    Object.keys(timerDescriptors).forEach(key => {
      Object.defineProperty(globalThis, key, timerDescriptors[key]);
    });
  }
  class FakeAbortController {
    constructor() {
      this.signal = {};
      this.aborted = false;
    }

    abort() {
      this.aborted = true;
    }
  }

  installControlledGlobals();
  let timed;
  let destroyed;
  try {
    timed = createListenTransport({
      autoRetry: false,
      timeoutMs: 50,
      AbortController: FakeAbortController,
      setTimeout() {
        throw new Error('injected request timer failed');
      },
      clearTimeout() {
        throw new Error('injected clear failed');
      },
      fetch: async () => new Promise(() => {}),
    });
    const timedDelivery = timed.submit({ sessionId: 'timer-deadline-settle' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(defaultTimers.size, 1);
    assert.equal([...defaultTimers][0].delay, 50);
    [...defaultTimers][0].run();
    assert.equal(await timedDelivery, false);
    assert.equal(timed.status('timer-deadline-settle'), 'pending');
    timed.destroy();
    assert.equal(defaultTimers.size, 0);

    destroyed = createListenTransport({
      autoRetry: false,
      timeoutMs: 50,
      AbortController: FakeAbortController,
      setTimeout() {
        throw new Error('injected request timer failed');
      },
      clearTimeout() {
        throw new Error('injected clear failed');
      },
      fetch: async () => new Promise(() => {}),
    });
    const destroyedDelivery = destroyed.submit({ sessionId: 'timer-destroy-settle' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(defaultTimers.size, 1);
    assert.doesNotThrow(() => destroyed.destroy());
    assert.equal(await destroyedDelivery, false);
    assert.equal(defaultTimers.size, 0);
  } finally {
    if (timed) timed.destroy();
    if (destroyed) destroyed.destroy();
    restoreGlobals();
  }
});

test('waiting salt start activates on tick after lock expiry without exposing local identity', () => {
  const candidate = 'e'.repeat(64);
  const privateSignature = 'nested/private/waiting-song.flac:123:456';
  const data = new Map([
    ['mineradio-local-media-salt-v1-lock', JSON.stringify({
      token: 'active-salt-owner',
      candidate,
      expiresAt: 1_000,
    })],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 500;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'waiting-salt-session',
    storage,
  });
  const waiting = state.startConfirmed({
    confirmed: true,
    transactionId: 'waiting-salt-transaction',
    mediaTime: 0,
    durationMs: 2_000,
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
      localId: privateSignature,
      localKey: privateSignature,
      name: 'waiting-song.flac',
    },
  });
  assert.equal(waiting.status, 'waiting-salt');
  assert.doesNotMatch(
    JSON.stringify({ waiting, snapshot: state.snapshot(), storage: [...data.entries()] }),
    /nested[\\/]|waiting-song\.flac/,
  );

  now = 1_500;
  const activated = state.tick({ mediaTime: 1, durationMs: 2_000 });
  assert.ok(activated);
  assert.equal(activated.sessionId, 'waiting-salt-session');
  assert.equal(activated.catalogProvider, 'local');
  assert.doesNotMatch(JSON.stringify(activated), /nested[\\/]|waiting-song\.flac/);

  now = 2_500;
  state.tick({ mediaTime: 2, durationMs: 2_000 });
  const event = state.finalize({ reason: 'ended', completed: true });
  assert.ok(event);
  const home = recordLocalListen(null, event);
  assert.doesNotMatch(
    JSON.stringify({ event, home, storage: [...data.entries()] }),
    /nested[\\/]|waiting-song\.flac/,
  );
  assert.match(event.catalogSourceId, /^local-v2-[a-f0-9]{64}$/);

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /if \(machineSession && !reportEvent\) return null;/);
});

test('durable confirmation suppresses restart replay when one cleanup storage operation fails', async t => {
  for (const failure of ['setItem', 'removeItem']) {
    await t.test(failure, async () => {
      const data = new Map([
        ['mineradio-local-media-salt-v1', 'f'.repeat(64)],
      ]);
      let now = 0;
      let armed = false;
      let failed = false;
      let fetchCalls = 0;
      const storage = {
        get length() {
          return data.size;
        },
        key(index) {
          return [...data.keys()][index] || null;
        },
        getItem(key) {
          return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
          if (failure === 'setItem' && armed && !failed) {
            failed = true;
            throw new DOMException('one confirmation write failed', 'SecurityError');
          }
          data.set(key, String(value));
        },
        removeItem(key) {
          if (
            failure === 'removeItem'
            && armed
            && !failed
            && key === 'mineradio-listen-report-outbox-v1'
          ) {
            failed = true;
            throw new DOMException('one event cleanup failed', 'SecurityError');
          }
          data.delete(key);
        },
      };
      const first = createListenTransport({
        autoRetry: false,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          armed = true;
          return {
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          };
        },
      });
      assertSubmitted(
        await first.submit({ sessionId: `confirmed-${failure}` }),
      );
      assert.equal(failed, true);
      first.destroy();

      now = 5_000;
      armed = false;
      const restarted = createListenTransport({
        autoRetry: false,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          throw new Error('confirmed event must not replay');
        },
      });
      assertSubmitted(restarted.status(`confirmed-${failure}`));
      assert.deepEqual(await restarted.flushDue(), []);
      assert.equal(fetchCalls, 1);
      restarted.destroy();

      now = 10_000;
      const converged = createListenTransport({
        autoRetry: false,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          throw new Error('confirmed event must not replay');
        },
      });
      await converged.flushDue();
      converged.destroy();
      assert.equal(
        [...data.entries()].some(([key, value]) => (
          (
            key === 'mineradio-listen-report-outbox-v1'
            || key.startsWith('mineradio-listen-report-outbox-v1-writer-')
          )
          && String(value).includes(`confirmed-${failure}`)
        )),
        false,
      );
      assert.ok(data.size <= 6);
      assert.equal(fetchCalls, 1);
    });
  }
});

test('request deadline settles without AbortController when the injected timer fails', async () => {
  const descriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    AbortController: Object.getOwnPropertyDescriptor(globalThis, 'AbortController'),
  };
  const timers = new Set();
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value(callback, delay) {
      const handle = {
        delay,
        unref() {},
        run() {
          timers.delete(handle);
          callback();
        },
      };
      timers.add(handle);
      return handle;
    },
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value(handle) {
      timers.delete(handle);
    },
  });
  Object.defineProperty(globalThis, 'AbortController', {
    configurable: true,
    value: undefined,
  });

  let transport;
  try {
    transport = createListenTransport({
      autoRetry: false,
      timeoutMs: 75,
      setTimeout() {
        throw new Error('injected timer unavailable');
      },
      clearTimeout() {
        throw new Error('injected clear unavailable');
      },
      fetch: async () => new Promise(() => {}),
    });
    const delivery = transport.submit({ sessionId: 'deadline-without-abort' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers.size, 1);
    assert.equal([...timers][0].delay, 75);
    [...timers][0].run();
    assert.equal(await delivery, false);
    assert.equal(transport.status('deadline-without-abort'), 'pending');
    transport.destroy();
    assert.equal(timers.size, 0);
  } finally {
    if (transport) transport.destroy();
    Object.keys(descriptors).forEach(key => {
      Object.defineProperty(globalThis, key, descriptors[key]);
    });
  }
});

test('waiting salt adjacent lifecycle deduplicates, pauses, switches, destroys, and rejects unsupported', () => {
  const privateSignature = 'folder/private/adjacent.flac:1:2';
  const data = new Map([
    ['mineradio-local-media-salt-v1-lock', JSON.stringify({
      token: 'long-lived-owner',
      candidate: '1'.repeat(64),
      expiresAt: 10_000,
    })],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let serial = 0;
  const state = createListenSessionState({
    clock: () => 500,
    createId: () => `waiting-adjacent-${++serial}`,
    storage,
  });
  const input = {
    confirmed: true,
    transactionId: 'waiting-adjacent-transaction',
    mediaTime: 0,
    durationMs: 5_000,
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
      localId: privateSignature,
      localKey: privateSignature,
      name: 'adjacent.flac',
    },
  };
  const first = state.startConfirmed(input);
  const duplicate = state.startConfirmed(input);
  assert.equal(first.status, 'waiting-salt');
  assert.deepEqual(duplicate, first);
  assert.equal(serial, 1);
  assert.equal(state.pause({ mediaTime: 0 }).paused, true);
  assert.equal(state.resume({ mediaTime: 0 }).paused, false);
  assert.equal(state.finalize({ reason: 'switch' }), null);
  assert.equal(state.snapshot(), null);

  const online = state.startConfirmed({
    confirmed: true,
    transactionId: 'waiting-adjacent-online',
    mediaTime: 0,
    durationMs: 10_000,
    song: neteaseSong(),
  });
  assert.equal(online.catalogProvider, 'netease');
  state.finalize({ reason: 'switch' });

  const waitingAgain = state.startConfirmed({
    ...input,
    transactionId: 'waiting-adjacent-destroy',
  });
  assert.equal(waitingAgain.status, 'waiting-salt');
  state.destroy();
  assert.equal(state.snapshot(), null);

  const unsupported = createListenSessionState({
    createId: () => 'unsupported-local-session',
    storage,
  });
  assert.equal(unsupported.startConfirmed({
    confirmed: true,
    transactionId: 'unsupported-local-transaction',
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
    },
  }), null);
  assert.equal(unsupported.snapshot(), null);
  assert.doesNotMatch(
    JSON.stringify({ first, duplicate, waitingAgain, storage: [...data.entries()] }),
    /folder[\\/]|adjacent\.flac/,
  );
});

test('ack shards remain bounded across transports and converge after the safety window', async () => {
  const data = new Map([
    ['mineradio-local-media-salt-v1', '2'.repeat(64)],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 0;
  let calls = 0;
  const options = {
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  };
  const first = createListenTransport(options);
  const second = createListenTransport(options);
  const submissions = [];
  for (let index = 0; index < 10; index += 1) {
    submissions.push(first.submit({ sessionId: `ack-first-${index}` }));
    submissions.push(second.submit({ sessionId: `ack-second-${index}` }));
  }
  assert.equal((await Promise.all(submissions)).every(Boolean), true);
  assert.equal(calls, 20);
  assert.equal(
    await first.submit({ sessionId: 'ack-first-0' }),
    false,
  );
  const ackKeys = [...data.keys()].filter(key => (
    key.startsWith('mineradio-listen-report-outbox-v1-ack-')
  ));
  assert.ok(ackKeys.length <= 2);
  assert.ok(ackKeys.length >= 1);
  ackKeys.forEach(key => {
    const body = data.get(key);
    assert.ok(Buffer.byteLength(body, 'utf8') <= 128 * 1024);
    assert.ok(JSON.parse(body).entries.length <= 32);
  });
  first.destroy();
  second.destroy();

  now = 9_000;
  const cleanup = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      calls += 1;
      throw new Error('acknowledged entries must not replay');
    },
  });
  assert.deepEqual(await cleanup.flushDue(), []);
  cleanup.destroy();
  const remainingPendingDocuments = [...data.entries()].filter(([key]) => (
    key === 'mineradio-listen-report-outbox-v1'
    || key.startsWith('mineradio-listen-report-outbox-v1-writer-')
  ));
  assert.equal(
    remainingPendingDocuments.some(([, value]) => (
      /ack-(first|second)-/.test(String(value))
    )),
    false,
  );
  assert.ok(data.size <= 6);
  assert.equal(calls, 20);
});

test('delivery stays pending without calling fetch when every request timer is unavailable', async () => {
  const descriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    AbortController: Object.getOwnPropertyDescriptor(globalThis, 'AbortController'),
  };
  const data = new Map([
    ['mineradio-local-media-salt-v1', '3'.repeat(64)],
  ]);
  const handles = new Set();
  let timersAvailable = false;
  let fetchCalls = 0;
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value(callback, delay) {
      if (!timersAvailable) throw new Error('global timer unavailable');
      const handle = {
        callback,
        delay,
        unref() {},
      };
      handles.add(handle);
      return handle;
    },
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value(handle) {
      handles.delete(handle);
    },
  });
  Object.defineProperty(globalThis, 'AbortController', {
    configurable: true,
    value: undefined,
  });
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };

  let transport;
  try {
    transport = createListenTransport({
      autoRetry: true,
      baseRetryMs: 100,
      storage,
      setTimeout() {
        throw new Error('injected timer unavailable');
      },
      clearTimeout() {
        throw new Error('injected clear unavailable');
      },
      fetch: async () => {
        fetchCalls += 1;
        if (!timersAvailable) return new Promise(() => {});
        return {
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        };
      },
    });
    const first = transport.submit({ sessionId: 'all-timers-unavailable' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetchCalls, 0);
    assert.equal(await first, false);
    assert.equal(transport.status('all-timers-unavailable'), 'pending');
    assert.equal(handles.size, 0);

    timersAvailable = true;
    assertSubmitted(await transport.retry('all-timers-unavailable'));
    assert.equal(fetchCalls, 1);
    assertSubmitted(transport.status('all-timers-unavailable'));
    assert.equal(handles.size, 0);
  } finally {
    if (transport) transport.destroy();
    Object.keys(descriptors).forEach(key => {
      Object.defineProperty(globalThis, key, descriptors[key]);
    });
  }
});

test('a recovered global timer getter can resume a timer-unavailable delivery', async () => {
  const descriptors = {
    setTimeout: Object.getOwnPropertyDescriptor(globalThis, 'setTimeout'),
    clearTimeout: Object.getOwnPropertyDescriptor(globalThis, 'clearTimeout'),
    AbortController: Object.getOwnPropertyDescriptor(globalThis, 'AbortController'),
  };
  const data = new Map([
    ['mineradio-local-media-salt-v1', '9'.repeat(64)],
  ]);
  const handles = new Set();
  let gettersAvailable = false;
  let fetchCalls = 0;
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    get() {
      if (!gettersAvailable) throw new Error('transient global timer getter');
      return function setRecoveredTimer(callback, delay) {
        const handle = { callback, delay, unref() {} };
        handles.add(handle);
        return handle;
      };
    },
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    get() {
      if (!gettersAvailable) throw new Error('transient global clear getter');
      return function clearRecoveredTimer(handle) {
        handles.delete(handle);
      };
    },
  });
  Object.defineProperty(globalThis, 'AbortController', {
    configurable: true,
    value: undefined,
  });
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };

  let transport;
  try {
    transport = createListenTransport({
      autoRetry: false,
      storage,
      fetch: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        };
      },
    });
    assert.equal(await transport.submit({ sessionId: 'timer-getter-recovery' }), false);
    assert.equal(fetchCalls, 0);
    gettersAvailable = true;
    assertSubmitted(await transport.retry('timer-getter-recovery'));
    assert.equal(fetchCalls, 1);
    assertSubmitted(transport.status('timer-getter-recovery'));
    assert.equal(handles.size, 0);
  } finally {
    if (transport) transport.destroy();
    Object.keys(descriptors).forEach(key => {
      Object.defineProperty(globalThis, key, descriptors[key]);
    });
  }
});

test('ack persistence retries boundedly after repeated transient writes before clearing outbox', async () => {
  const data = new Map([
    ['mineradio-local-media-salt-v1', '4'.repeat(64)],
  ]);
  const timers = new Set();
  const operations = [];
  let now = 0;
  let ackFailures = 2;
  let ackWrites = 0;
  let fetchCalls = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      operations.push(`set:${key}`);
      if (key.startsWith('mineradio-listen-report-outbox-v1-ack-')) {
        ackWrites += 1;
        if (ackFailures > 0) {
          ackFailures -= 1;
          throw new DOMException('transient ack write', 'SecurityError');
        }
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      operations.push(`remove:${key}`);
      data.delete(key);
    },
  };
  function setTimer(callback, delay) {
    const handle = {
      callback,
      delay,
      unref() {},
      run() {
        timers.delete(handle);
        callback();
      },
    };
    timers.add(handle);
    return handle;
  }
  function clearTimer(handle) {
    timers.delete(handle);
  }
  const transport = createListenTransport({
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assertSubmitted(await transport.submit({ sessionId: 'ack-retry-twice' }));
  assert.equal(fetchCalls, 1);
  assert.equal(ackWrites, 2);
  assertSubmitted(transport.status('ack-retry-twice'));
  assert.equal(timers.size, 1);
  assert.equal([...timers][0].delay, 1_000);
  assert.match(
    data.get('mineradio-listen-report-outbox-v1'),
    /ack-retry-twice/,
  );

  now = 5_000;
  [...timers][0].run();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchCalls, 1);
  assert.equal(ackWrites, 3);
  assertSubmitted(transport.status('ack-retry-twice'));
  assert.equal(timers.size, 0);
  const successfulAck = operations.findIndex(value => (
    value.startsWith('set:mineradio-listen-report-outbox-v1-ack-')
  ));
  const outboxRemoval = operations.lastIndexOf(
    'remove:mineradio-listen-report-outbox-v1',
  );
  assert.ok(successfulAck >= 0);
  assert.ok(outboxRemoval > successfulAck);
  transport.destroy();

  now = 5_001;
  const restarted = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('acknowledged report must not replay');
    },
  });
  assert.deepEqual(await restarted.flushDue(), []);
  assert.equal(fetchCalls, 1);
  restarted.destroy();
});

test('delivery waits for the shared storage lock before network and tombstone work', async () => {
  const lockKey = 'mineradio-listen-report-outbox-v1-lock';
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'a'.repeat(64)],
    [lockKey, JSON.stringify({
      token: 'active-cleanup-owner',
      expiresAt: 10_000,
    })],
  ]);
  let now = 0;
  let fetchCalls = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const transport = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assert.equal(await transport.submit({ sessionId: 'ack-shared-lock' }), false);
  assert.equal(transport.status('ack-shared-lock'), 'pending');
  assert.equal(
    [...data.keys()].some(key => (
      key.startsWith('mineradio-listen-report-outbox-v1-ack-')
    )),
    false,
  );
  assert.equal(fetchCalls, 0);

  now = 11_000;
  assertSubmitted(await transport.retry('ack-shared-lock'));
  assertSubmitted(transport.status('ack-shared-lock'));
  assert.equal(fetchCalls, 1);
  transport.destroy();
});

test('ack cleanup keeps its tombstone when an old writer loses the lock mid-check', async () => {
  const data = new Map([
    ['mineradio-local-media-salt-v1', '5'.repeat(64)],
  ]);
  const lockKey = 'mineradio-listen-report-outbox-v1-lock';
  const staleShardKey = 'mineradio-listen-report-outbox-v1-writer-stale';
  let now = 0;
  let capturedEvent = null;
  let staleFetchCalls = 0;
  let cleanupMode = false;
  let ackReads = 0;
  let interleaved = false;
  let ackKey = '';
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      if (cleanupMode && key === ackKey) {
        ackReads += 1;
        if (ackReads === 3) {
          interleaved = true;
          data.set(lockKey, JSON.stringify({
            token: 'replacement-owner',
            expiresAt: 10_000,
          }));
          data.set(staleShardKey, JSON.stringify({
            version: 2,
            writer: 'stale-writer',
            createdAt: 0,
            revision: 1,
            entries: [{
              event: capturedEvent,
              attempts: 1,
              nextAttemptAt: 1_000,
              createdAt: 0,
              state: 'pending',
              lastErrorCode: 'NETWORK_ERROR',
            }],
          }));
        }
      }
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const stale = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async (_url, request) => {
      staleFetchCalls += 1;
      capturedEvent = JSON.parse(request.body);
      throw new Error('offline stale writer');
    },
  });
  assert.equal(await stale.submit({ sessionId: 'ack-cleanup-race' }), false);
  assert.equal(staleFetchCalls, 1);

  const confirmer = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return { accepted: true, localRecorded: true };
      },
    }),
  });
  assertSubmitted(await confirmer.retry('ack-cleanup-race'));
  confirmer.destroy();
  ackKey = [...data.keys()].find(key => (
    key.startsWith('mineradio-listen-report-outbox-v1-ack-')
  ));
  assert.ok(ackKey);

  now = 9_000;
  cleanupMode = true;
  const cleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('cleanup must not deliver');
    },
  });
  cleaner.destroy();
  cleanupMode = false;
  assert.equal(interleaved, true);
  assert.equal(data.has(ackKey), true);
  assert.equal(data.has(staleShardKey), true);

  now = 11_000;
  assert.deepEqual(await stale.flushDue(), []);
  assert.equal(staleFetchCalls, 1);
  assertSubmitted(stale.status('ack-cleanup-race'));
  const pendingDocuments = [...data.entries()].filter(([key]) => (
    key === 'mineradio-listen-report-outbox-v1'
    || key.startsWith('mineradio-listen-report-outbox-v1-writer-')
  ));
  assert.doesNotMatch(JSON.stringify(pendingDocuments), /ack-cleanup-race/);
  stale.destroy();
});

test('waiting salt preserves bounded playback progress through activation and lifecycle edges', () => {
  const privateSignature = 'nested/private/waiting-progress.flac:10:20';
  const data = new Map([
    ['mineradio-local-media-salt-v1-lock', JSON.stringify({
      token: 'waiting-progress-owner',
      candidate: '6'.repeat(64),
      expiresAt: 5_000,
    })],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 0;
  const state = createListenSessionState({
    clock: () => now,
    createId: () => 'waiting-progress-session',
    storage,
  });
  const input = {
    confirmed: true,
    transactionId: 'waiting-progress-transaction',
    mediaTime: 0,
    durationMs: 10_000,
    song: {
      type: 'local',
      provider: 'local',
      playbackProvider: 'local',
      localId: privateSignature,
      localKey: privateSignature,
      name: 'waiting-progress.flac',
    },
  };
  assert.equal(state.startConfirmed(input).status, 'waiting-salt');
  now = 1_000;
  assert.equal(state.tick({ mediaTime: 1, durationMs: 10_000 }).listenMs, 1_000);
  now = 2_000;
  const sought = state.tick({ mediaTime: 50, durationMs: 10_000 });
  assert.equal(sought.listenMs, 2_000);
  assert.equal(sought.maxProgress, 1);
  now = 3_000;
  assert.equal(state.tick({ mediaTime: 2, durationMs: 10_000 }).listenMs, 2_000);
  state.pause({ mediaTime: 2 });
  now = 4_000;
  assert.equal(state.tick({ mediaTime: 5, durationMs: 10_000 }).listenMs, 2_000);
  state.resume({ mediaTime: 5 });
  now = 5_000;
  const ended = state.finalize({
    reason: 'ended',
    completed: true,
    mediaTime: 6,
    durationMs: 10_000,
  });
  assert.ok(ended);
  assert.equal(ended.listenMs, 3_000);
  assert.equal(ended.completion.ratio, 1);
  assert.equal(state.finalize({ reason: 'ended' }), null);
  assert.deepEqual(state.retry('waiting-progress-session'), ended);
  assert.doesNotMatch(
    JSON.stringify({ ended, storage: [...data.entries()] }),
    /nested[\\/]|waiting-progress\.flac/,
  );

  const boundedData = new Map([
    ['mineradio-local-media-salt-v1-lock', JSON.stringify({
      token: 'waiting-bounded-owner',
      candidate: '7'.repeat(64),
      expiresAt: 100_000,
    })],
  ]);
  const boundedStorage = {
    ...storage,
    get length() {
      return boundedData.size;
    },
    key(index) {
      return [...boundedData.keys()][index] || null;
    },
    getItem(key) {
      return boundedData.has(key) ? boundedData.get(key) : null;
    },
    setItem(key, value) {
      boundedData.set(key, String(value));
    },
    removeItem(key) {
      boundedData.delete(key);
    },
  };
  now = 0;
  const bounded = createListenSessionState({
    clock: () => now,
    createId: () => 'waiting-bounded-session',
    storage: boundedStorage,
  });
  bounded.startConfirmed({
    ...input,
    transactionId: 'waiting-bounded-transaction',
    durationMs: 120_000,
  });
  now = 70_000;
  assert.equal(
    bounded.tick({ mediaTime: 70, durationMs: 120_000 }).listenMs,
    60_000,
  );
  now = 100_000;
  const switched = bounded.finalize({
    reason: 'switch',
    mediaTime: 70,
    durationMs: 120_000,
  });
  assert.ok(switched);
  assert.equal(switched.listenMs, 60_000);

  const destroyedData = new Map([
    ['mineradio-local-media-salt-v1-lock', JSON.stringify({
      token: 'waiting-destroy-owner',
      candidate: '8'.repeat(64),
      expiresAt: 10_000,
    })],
  ]);
  const destroyedStorage = {
    ...boundedStorage,
    get length() {
      return destroyedData.size;
    },
    key(index) {
      return [...destroyedData.keys()][index] || null;
    },
    getItem(key) {
      return destroyedData.has(key) ? destroyedData.get(key) : null;
    },
    setItem(key, value) {
      destroyedData.set(key, String(value));
    },
    removeItem(key) {
      destroyedData.delete(key);
    },
  };
  now = 0;
  const destroyed = createListenSessionState({
    clock: () => now,
    createId: () => 'waiting-destroy-session',
    storage: destroyedStorage,
  });
  destroyed.startConfirmed({
    ...input,
    transactionId: 'waiting-destroy-transaction',
  });
  now = 1_000;
  destroyed.tick({ mediaTime: 1, durationMs: 10_000 });
  destroyed.destroy();
  assert.equal(destroyed.snapshot(), null);
  assert.equal(destroyed.finalize({ reason: 'switch' }), null);
  assert.doesNotMatch(
    JSON.stringify({ boundedData: [...boundedData], destroyedData: [...destroyedData] }),
    /nested[\\/]|waiting-progress\.flac/,
  );
});

test('ack-pending survives immediate restart when ack shards fail but the main outbox is writable', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', '7'.repeat(64)],
  ]);
  let now = 0;
  let ackWritesFail = true;
  let fetchCalls = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (ackWritesFail && key.startsWith(ackPrefix)) {
        throw new DOMException('ack shard unavailable', 'SecurityError');
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const first = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assertSubmitted(await first.submit({ sessionId: 'ack-main-restart' }));
  assert.equal(fetchCalls, 1);
  assertSubmitted(first.status('ack-main-restart'));
  const persisted = JSON.parse(data.get(outboxKey));
  assert.equal(persisted.entries[0].state, 'ack-pending');
  assert.match(persisted.entries[0].ackDigest, /^[a-f0-9]{64}$/);
  first.destroy();

  now = 5_000;
  ackWritesFail = false;
  const restarted = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('server-confirmed event must not replay');
    },
  });
  assertSubmitted(restarted.status('ack-main-restart'));
  assert.deepEqual(await restarted.flushDue(), ['ack-main-restart']);
  assert.equal(fetchCalls, 1);
  assertSubmitted(restarted.status('ack-main-restart'));
  restarted.destroy();
});

test('ack cleanup fences an interleaved old writer retry and converges after its lease expires', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const writerPrefix = `${outboxKey}-writer-`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', '8'.repeat(64)],
  ]);
  let now = 0;
  let staleFetchCalls = 0;
  let retryDuringRemove = null;
  let interleaved = false;
  let triggerInterleave = false;
  let stale;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      if (triggerInterleave && key.startsWith(ackPrefix) && !interleaved) {
        interleaved = true;
        retryDuringRemove = stale.retry('writer-generation-race');
      }
      data.delete(key);
    },
  };
  stale = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async () => {
      staleFetchCalls += 1;
      throw new Error('offline old writer');
    },
  });
  assert.equal(await stale.submit({ sessionId: 'writer-generation-race' }), false);
  assert.equal(staleFetchCalls, 1);
  const staleWriterKey = [...data.keys()].find(key => key.startsWith(writerPrefix));
  const staleWriter = JSON.parse(data.get(staleWriterKey));
  assert.match(staleWriter.generation, /^[A-Za-z0-9._:-]+$/);
  assert.equal(staleWriter.lastSeen, 0);

  now = 1_000;
  const confirmer = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return { accepted: true, localRecorded: true };
      },
    }),
  });
  assertSubmitted(await confirmer.retry('writer-generation-race'));
  confirmer.destroy();
  const ackKey = [...data.keys()].find(key => key.startsWith(ackPrefix));
  assert.ok(ackKey);

  now = 5_000;
  const activeLeaseCleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('active-lease cleanup must not deliver');
    },
  });
  activeLeaseCleaner.destroy();
  assert.equal(data.has(ackKey), true);
  assert.equal(staleFetchCalls, 1);

  now = 10_000;
  triggerInterleave = true;
  const expiredLeaseCleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('expired-lease cleanup must not deliver');
    },
  });
  expiredLeaseCleaner.destroy();
  if (retryDuringRemove) await retryDuringRemove;
  assert.equal(interleaved, true);
  assert.equal(staleFetchCalls, 1);
  assert.notEqual(stale.status('writer-generation-race'), 'pending');

  await stale.flushDue();
  stale.destroy();
  assert.equal(staleFetchCalls, 1);
  assert.doesNotMatch(
    JSON.stringify([...data.entries()].filter(([key]) => (
      key === outboxKey || key.startsWith(writerPrefix)
    ))),
    /writer-generation-race/,
  );
  assert.ok(data.size <= 6);
});

test('an expired writer generation cannot recreate its shard after acknowledgement cleanup', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const writerPrefix = `${outboxKey}-writer-`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', '9'.repeat(64)],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let now = 0;
  let staleFetchCalls = 0;
  const stale = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      staleFetchCalls += 1;
      throw new Error('offline stale generation');
    },
  });
  assert.equal(await stale.submit({ sessionId: 'expired-writer-generation' }), false);
  assert.equal(staleFetchCalls, 1);

  now = 1_000;
  const confirmer = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return { accepted: true, localRecorded: true };
      },
    }),
  });
  assertSubmitted(await confirmer.retry('expired-writer-generation'));
  confirmer.destroy();

  now = 10_000;
  const cleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('cleanup must not deliver');
    },
  });
  cleaner.destroy();
  assert.equal(
    [...data.keys()].some(key => key.startsWith(ackPrefix)),
    false,
  );

  assert.equal(await stale.retry('expired-writer-generation'), false);
  assert.equal(staleFetchCalls, 1);
  assertSubmitted(stale.status('expired-writer-generation'));
  assert.doesNotMatch(
    JSON.stringify([...data.entries()].filter(([key]) => (
      key === outboxKey || key.startsWith(writerPrefix)
    ))),
    /expired-writer-generation/,
  );
  stale.destroy();
});

test('ack cleanup restores its tombstone when a stale writer lands after the final proof', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const writerPrefix = `${outboxKey}-writer-`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'd'.repeat(64)],
  ]);
  let now = 0;
  let injectLateShard = false;
  let injected = false;
  const lateEvent = { sessionId: 'post-proof-late-writer' };
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      if (injectLateShard && key.startsWith(ackPrefix) && !injected) {
        injected = true;
        data.set(`${writerPrefix}late-old-token`, JSON.stringify({
          version: 2,
          writer: 'late-old-writer',
          generation: 'late-old-generation',
          createdAt: 0,
          lastSeen: 0,
          revision: 1,
          lockEpoch: 1,
          entries: [{
            event: lateEvent,
            attempts: 1,
            nextAttemptAt: 0,
            createdAt: 0,
            state: 'pending',
            lastErrorCode: 'NETWORK_ERROR',
          }],
        }));
      }
      data.delete(key);
    },
  };
  const confirmer = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return { accepted: true, localRecorded: true };
      },
    }),
  });
  assert.equal((await confirmer.submit(lateEvent)).delivery, 'submitted');
  confirmer.destroy();
  assert.equal([...data.keys()].some(key => key.startsWith(ackPrefix)), true);

  now = 10_000;
  injectLateShard = true;
  const cleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('cleaner must not send');
    },
  });
  cleaner.destroy();
  assert.equal(injected, true);
  assert.equal(
    [...data.keys()].some(key => (
      (
        key.startsWith(ackPrefix)
        || key.startsWith(`${outboxKey}-cleanup-`)
      )
      && data.get(key).includes(lateEvent.sessionId)
    )),
    true,
  );

  let replayCalls = 0;
  const restarted = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      replayCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  await restarted.flushDue();
  assert.equal(replayCalls, 0);
  assert.notEqual(restarted.status(lateEvent.sessionId), 'pending');
  restarted.destroy();
});

test('ack cleanup marker survives a late shard, restore failure, and lock replacement', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const cleanupPrefix = `${outboxKey}-cleanup-`;
  const writerPrefix = `${outboxKey}-writer-`;
  const lockKey = `${outboxKey}-lock`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'e'.repeat(64)],
  ]);
  let now = 0;
  let injectFailure = false;
  let injected = false;
  const event = {
    sessionId: 'two-phase-cleanup',
    catalogProvider: 'netease',
    playbackProvider: 'netease',
    reportingBinding: `${'e'.repeat(32)}.${'f'.repeat(64)}`,
  };
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (injectFailure && key.startsWith(ackPrefix)) {
        throw new DOMException('transient restore failure', 'SecurityError');
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      if (injectFailure && key.startsWith(ackPrefix) && !injected) {
        injected = true;
        data.set(`${writerPrefix}late-after-proof`, JSON.stringify({
          version: 2,
          writer: 'late-writer',
          generation: 'late-generation',
          createdAt: 0,
          lastSeen: 0,
          revision: 1,
          lockEpoch: 1,
          entries: [{
            event,
            attempts: 1,
            nextAttemptAt: 0,
            createdAt: 0,
            state: 'pending',
            lastErrorCode: 'NETWORK_ERROR',
          }],
        }));
        data.set(lockKey, JSON.stringify({
          token: 'replacement-owner',
          epoch: 99,
          expiresAt: now + 2_000,
        }));
      }
      data.delete(key);
    },
  };
  const confirmer = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return {
          accepted: true,
          localRecorded: true,
          status: 'submitted',
          completeness: 'complete',
        };
      },
    }),
  });
  assert.equal((await confirmer.submit(event)).delivery, 'submitted');
  confirmer.destroy();

  now = 10_000;
  injectFailure = true;
  const cleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      throw new Error('cleanup must not send');
    },
  });
  cleaner.destroy();
  assert.equal(injected, true);
  assert.equal(
    [...data.keys()].some(key => (
      key.startsWith(cleanupPrefix)
      && data.get(key).includes(event.sessionId)
    )),
    true,
  );

  injectFailure = false;
  data.delete(lockKey);
  let replayCalls = 0;
  const restarted = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      replayCalls += 1;
      throw new Error('cleanup marker must suppress replay');
    },
  });
  await restarted.flushDue();
  assert.equal(replayCalls, 0);
  assert.notEqual(restarted.status(event.sessionId), 'pending');
  restarted.destroy();
});

test('cleanup markers roundtrip every structured delivery result without replay', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const cleanupKey = `${outboxKey}-cleanup-roundtrip`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'd'.repeat(64)],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const cases = [
    {
      sessionId: 'marker-submitted',
      result: {
        accepted: true,
        localRecorded: true,
        delivery: 'submitted',
        status: 'submitted',
        completeness: 'complete',
        duplicate: false,
      },
    },
    {
      sessionId: 'marker-local-only',
      result: {
        accepted: true,
        localRecorded: true,
        delivery: 'local-only',
        status: 'pending',
        completeness: 'partial',
        duplicate: false,
        code: 'LOGIN_REQUIRED',
      },
    },
    {
      sessionId: 'marker-unsupported',
      result: {
        accepted: true,
        localRecorded: true,
        delivery: 'unsupported',
        status: 'unsupported',
        completeness: 'unsupported',
        duplicate: false,
        code: 'REPORTING_UNAVAILABLE',
      },
    },
    {
      sessionId: 'marker-uncertain',
      result: {
        accepted: true,
        localRecorded: true,
        delivery: 'uncertain',
        status: 'uncertain',
        completeness: 'partial',
        duplicate: false,
        code: 'PROVIDER_UNCERTAIN',
      },
    },
    {
      sessionId: 'marker-terminal',
      result: {
        accepted: false,
        localRecorded: true,
        delivery: 'terminal',
        status: 'rejected',
        code: 'HTTP_REJECTED',
      },
    },
    {
      sessionId: 'marker-conflict',
      result: {
        accepted: false,
        localRecorded: true,
        delivery: 'terminal',
        status: 'conflict',
        code: 'LISTEN_SESSION_CONFLICT',
      },
    },
  ];
  const seed = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      throw new Error('offline');
    },
  });
  for (const item of cases) {
    assert.equal(await seed.submit({ sessionId: item.sessionId }), false);
  }
  seed.destroy();
  const pending = JSON.parse(data.get(outboxKey)).entries;
  const events = Object.fromEntries(pending.map(item => [
    item.event.sessionId,
    item.event,
  ]));
  [...data.keys()].filter(key => key.startsWith(outboxKey)).forEach(key => {
    data.delete(key);
  });
  data.set(cleanupKey, JSON.stringify({
    version: 1,
    cleanup: true,
    createdAt: 1_000,
    lockEpoch: 1,
    entries: cases.map((item, index) => {
      const event = events[item.sessionId];
      const acknowledgement = {
        sessionId: item.sessionId,
        digest: crypto.createHash('sha256')
          .update(JSON.stringify(event), 'utf8')
          .digest('hex'),
        confirmedAt: 1_000,
      };
      return index % 2 === 0
        ? { ...acknowledgement, ...item.result }
        : { ...acknowledgement, deliveryResult: item.result };
    }),
  }));

  let fetchCalls = 0;
  const restarted = createListenTransport({
    autoRetry: false,
    clock: () => 1_000,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('cleanup marker must suppress replay');
    },
  });
  for (const item of cases) {
    assert.deepEqual(restarted.status(item.sessionId), item.result);
    assert.equal(await restarted.retry(item.sessionId), false);
  }
  assert.deepEqual(await restarted.flushDue(), []);
  assert.equal(fetchCalls, 0);
  restarted.destroy();
});

test('one writer keeps its generation through three sequential successful sessions', async () => {
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'a'.repeat(64)],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  let fetchCalls = 0;
  const transport = createListenTransport({
    autoRetry: false,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  for (let index = 1; index <= 3; index += 1) {
    const sessionId = `sequential-success-${index}`;
    assertSubmitted(await transport.submit({ sessionId }));
    assertSubmitted(transport.status(sessionId));
  }
  assert.equal(fetchCalls, 3);
  const ownWriterDocuments = [...data.entries()]
    .filter(([key]) => key.startsWith('mineradio-listen-report-outbox-v1-writer-'))
    .map(([, value]) => JSON.parse(value));
  assert.equal(ownWriterDocuments.length, 1);
  assert.equal(ownWriterDocuments[0].entries.length, 0);
  transport.destroy();
});

test('a writer can submit again after rebuilding its first acknowledgement', async () => {
  const ackPrefix = 'mineradio-listen-report-outbox-v1-ack-';
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'b'.repeat(64)],
  ]);
  let now = 0;
  let ackFailures = 2;
  let fetchCalls = 0;
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (key.startsWith(ackPrefix) && ackFailures > 0) {
        ackFailures -= 1;
        throw new DOMException('transient ack failure', 'SecurityError');
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
  const transport = createListenTransport({
    autoRetry: false,
    baseRetryMs: 1_000,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assertSubmitted(await transport.submit({ sessionId: 'ack-rebuild-first' }));
  assertSubmitted(transport.status('ack-rebuild-first'));
  now = 5_000;
  assertSubmitted(await transport.retry('ack-rebuild-first'));
  assertSubmitted(transport.status('ack-rebuild-first'));
  assertSubmitted(await transport.submit({ sessionId: 'ack-rebuild-second' }));
  assertSubmitted(transport.status('ack-rebuild-second'));
  assert.equal(fetchCalls, 2);
  transport.destroy();
});

test('lock publication failure gates submit retry flush and multiple writers until recovery', async t => {
  const lockKey = 'mineradio-listen-report-outbox-v1-lock';

  function fixture() {
    const data = new Map([
      ['mineradio-local-media-salt-v1', 'c'.repeat(64)],
    ]);
    let now = 0;
    let lockWritesFail = false;
    let online = true;
    let fetchCalls = 0;
    const storage = {
      get length() {
        return data.size;
      },
      key(index) {
        return [...data.keys()][index] || null;
      },
      getItem(key) {
        return data.has(key) ? data.get(key) : null;
      },
      setItem(key, value) {
        if (key === lockKey && lockWritesFail) {
          throw new DOMException('lock publication failed', 'SecurityError');
        }
        data.set(key, String(value));
      },
      removeItem(key) {
        data.delete(key);
      },
    };
    function transport() {
      return createListenTransport({
        autoRetry: false,
        baseRetryMs: 100,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          if (!online) throw new Error('offline');
          return {
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          };
        },
      });
    }
    return {
      data,
      storage,
      transport,
      setNow(value) {
        now = value;
      },
      setLockFailure(value) {
        lockWritesFail = value;
      },
      setOnline(value) {
        online = value;
      },
      fetchCalls() {
        return fetchCalls;
      },
    };
  }

  await t.test('submit', async () => {
    const state = fixture();
    state.setLockFailure(true);
    const transport = state.transport();
    assert.equal(await transport.submit({ sessionId: 'lock-fail-submit' }), false);
    assert.equal(transport.status('lock-fail-submit'), 'pending');
    assert.equal(state.fetchCalls(), 0);
    state.setNow(5_000);
    state.setLockFailure(false);
    assertSubmitted(await transport.retry('lock-fail-submit'));
    assert.equal(state.fetchCalls(), 1);
    transport.destroy();
  });

  await t.test('retry', async () => {
    const state = fixture();
    state.setOnline(false);
    const transport = state.transport();
    assert.equal(await transport.submit({ sessionId: 'lock-fail-retry' }), false);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(5_000);
    state.setOnline(true);
    state.setLockFailure(true);
    assert.equal(await transport.retry('lock-fail-retry'), false);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(10_000);
    state.setLockFailure(false);
    assertSubmitted(await transport.retry('lock-fail-retry'));
    assert.equal(state.fetchCalls(), 2);
    transport.destroy();
  });

  await t.test('flushDue', async () => {
    const state = fixture();
    state.setOnline(false);
    const transport = state.transport();
    assert.equal(await transport.submit({ sessionId: 'lock-fail-flush' }), false);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(5_000);
    state.setOnline(true);
    state.setLockFailure(true);
    assert.deepEqual(await transport.flushDue(), ['lock-fail-flush']);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(10_000);
    state.setLockFailure(false);
    assert.deepEqual(await transport.flushDue(), ['lock-fail-flush']);
    assert.equal(state.fetchCalls(), 2);
    transport.destroy();
  });

  await t.test('multiple writers', async () => {
    const state = fixture();
    state.setLockFailure(true);
    const first = state.transport();
    const second = state.transport();
    assert.deepEqual(await Promise.all([
      first.submit({ sessionId: 'lock-fail-tab-a' }),
      second.submit({ sessionId: 'lock-fail-tab-b' }),
    ]), [false, false]);
    assert.equal(state.fetchCalls(), 0);
    state.setNow(5_000);
    state.setLockFailure(false);
    assertSubmitted(await first.retry('lock-fail-tab-a'));
    assertSubmitted(await second.retry('lock-fail-tab-b'));
    assert.equal(state.fetchCalls(), 2);
    first.destroy();
    second.destroy();
  });
});

test('one hundred forty writers stay byte bounded and converge without losing pending or foreign keys', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const writerPrefix = `${outboxKey}-writer-`;
  const ackPrefix = `${outboxKey}-ack-`;
  const data = new Map([
    ['mineradio-local-media-salt-v1', 'd'.repeat(64)],
  ]);
  for (let index = 0; index < 140; index += 1) {
    data.set(`foreign-namespace-${index}`, `foreign-value-${index}`);
  }
  let now = 0;
  let peakNamespaceBytes = 0;
  let peakNamespaceKeys = 0;
  function measureNamespace() {
    const entries = [...data.entries()].filter(([key]) => (
      key === outboxKey
      || key.startsWith(writerPrefix)
      || key.startsWith(ackPrefix)
    ));
    peakNamespaceKeys = Math.max(peakNamespaceKeys, entries.length);
    peakNamespaceBytes = Math.max(
      peakNamespaceBytes,
      entries.reduce((total, [key, value]) => (
        total + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
      ), 0),
    );
  }
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      return [...data.keys()][index] || null;
    },
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
      measureNamespace();
    },
    removeItem(key) {
      data.delete(key);
    },
  };

  let pendingFetchCalls = 0;
  const pendingWriter = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      pendingFetchCalls += 1;
      throw new Error('pending sentinel offline');
    },
  });
  assert.equal(await pendingWriter.submit({ sessionId: 'barrier-pending' }), false);
  assert.equal(pendingFetchCalls, 1);

  let releaseBarrier;
  const barrier = new Promise(resolve => {
    releaseBarrier = resolve;
  });
  let confirmedFetchCalls = 0;
  const transports = [];
  const submissions = [];
  for (let index = 0; index < 140; index += 1) {
    const transport = createListenTransport({
      autoRetry: false,
      clock: () => now,
      storage,
      fetch: async () => {
        confirmedFetchCalls += 1;
        await barrier;
        return {
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        };
      },
    });
    transports.push(transport);
    submissions.push(transport.submit({ sessionId: `barrier-confirmed-${index}` }));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(confirmedFetchCalls > 0);
  assert.ok(confirmedFetchCalls <= 31);
  releaseBarrier();
  const firstWave = await Promise.all(submissions);
  assert.equal(
    firstWave.filter(isSubmitted).length,
    confirmedFetchCalls,
  );
  now = 5_000;
  for (let index = 0; index < firstWave.length; index += 1) {
    if (isSubmitted(firstWave[index])) continue;
    const sessionId = `barrier-confirmed-${index}`;
    const retryResult = firstWave[index]
      && firstWave[index].code === 'OUTBOX_CAPACITY_EXCEEDED'
      ? await transports[index].submit({ sessionId })
      : await transports[index].retry(sessionId);
    const retryNamespace = [...data.entries()].filter(([key]) => (
      key === outboxKey
      || key.startsWith(writerPrefix)
      || key.startsWith(ackPrefix)
    ));
    const retryPendingIds = retryNamespace.flatMap(([key, value]) => {
      if (key.startsWith(ackPrefix)) return [];
      try {
        return (JSON.parse(value).entries || []).map(
          entry => entry && entry.event && entry.event.sessionId,
        ).filter(Boolean);
      } catch {
        return [];
      }
    });
    assert.equal(
      isSubmitted(retryResult),
      true,
      `retry ${index} remained ${transports[index].status(`barrier-confirmed-${index}`)} `
        + `with ${retryNamespace.length} keys and ${retryNamespace.reduce((total, [key, value]) => (
          total + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
        ), 0)} bytes; pending=${[...new Set(retryPendingIds)].join(',')}`,
    );
  }
  assert.equal(confirmedFetchCalls, 140);

  const ackEntriesBeforeCleanup = [...data.entries()]
    .filter(([key]) => key.startsWith(ackPrefix))
    .flatMap(([, value]) => JSON.parse(value).entries || []);
  assert.equal(ackEntriesBeforeCleanup.length, 140);
  assert.ok(peakNamespaceKeys <= 300);
  assert.ok(
    peakNamespaceBytes <= 128 * 1024,
    `namespace peak ${peakNamespaceBytes} exceeds 128 KiB`,
  );
  transports.forEach(transport => transport.destroy());

  now = 20_000;
  for (let index = 0; index < 4; index += 1) {
    const cleaner = createListenTransport({
      autoRetry: false,
      clock: () => now,
      storage,
      fetch: async () => {
        throw new Error('cleanup must not deliver');
      },
    });
    cleaner.destroy();
  }

  const namespaceAfterCleanup = [...data.entries()].filter(([key]) => (
    key === outboxKey
    || key.startsWith(writerPrefix)
    || key.startsWith(ackPrefix)
  ));
  assert.ok(namespaceAfterCleanup.length <= 6);
  assert.match(JSON.stringify(namespaceAfterCleanup), /barrier-pending/);
  assert.doesNotMatch(JSON.stringify(namespaceAfterCleanup), /barrier-confirmed-/);
  for (let index = 0; index < 140; index += 1) {
    assert.equal(
      data.get(`foreign-namespace-${index}`),
      `foreign-value-${index}`,
    );
  }

  pendingWriter.destroy();
  now = 25_000;
  const recovered = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => ({
      ok: true,
      async json() {
        return { accepted: true, localRecorded: true };
      },
    }),
  });
  assert.equal(recovered.status('barrier-pending'), 'pending');
  assertSubmitted(await recovered.retry('barrier-pending'));
  recovered.destroy();
});

test('global namespace count and byte budgets reject a new shard before network delivery', async t => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const writerPrefix = `${outboxKey}-writer-`;

  async function runCase(name, seed) {
    const data = new Map([
      ['mineradio-local-media-salt-v1', 'e'.repeat(64)],
    ]);
    seed(data);
    let now = 0;
    let fetchCalls = 0;
    const storage = {
      get length() {
        return data.size;
      },
      key(index) {
        return [...data.keys()][index] || null;
      },
      getItem(key) {
        return data.has(key) ? data.get(key) : null;
      },
      setItem(key, value) {
        data.set(key, String(value));
      },
      removeItem(key) {
        data.delete(key);
      },
    };
    const transport = createListenTransport({
      autoRetry: false,
      clock: () => now,
      storage,
      fetch: async () => {
        fetchCalls += 1;
        return {
          ok: true,
          async json() {
            return { accepted: true, localRecorded: true };
          },
        };
      },
    });
    const sessionId = `namespace-budget-${name}`;
    assert.deepEqual(await transport.submit({ sessionId }), {
      accepted: false,
      localRecorded: true,
      status: 'rejected',
      code: 'OUTBOX_CAPACITY_EXCEEDED',
    });
    assert.equal(transport.status(sessionId), '');
    assert.equal(fetchCalls, 0);
    assert.equal(
      [...data.keys()].some(key => (
        key.startsWith(writerPrefix)
        && String(data.get(key)).includes(sessionId)
      )),
      false,
    );

    [...data.keys()].filter(key => (
      key.startsWith(writerPrefix)
      && key.includes('external')
    ))
      .forEach(key => data.delete(key));
    now = 5_000;
    const recovered = await transport.submit({ sessionId });
    if (recovered === false) {
      assert.equal(transport.status(sessionId), 'pending');
      now = 7_000;
      assertSubmitted(await transport.retry(sessionId));
    } else {
      assertSubmitted(recovered);
    }
    assert.equal(fetchCalls, 1);
    transport.destroy();
  }

  await t.test('byte budget', async () => {
    await runCase('bytes', data => {
      data.set(
        `${writerPrefix}oversized-external`,
        'x'.repeat(128 * 1024 - 512),
      );
    });
  });

  await t.test('key count budget', async () => {
    await runCase('count', data => {
      for (let index = 0; index < 512; index += 1) {
        data.set(`${writerPrefix}external-${index}`, 'x');
      }
    });
  });
});

test('writer shard ownership loss after set gates every delivery entry until recovery', async t => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const lockKey = `${outboxKey}-lock`;
  const writerPrefix = `${outboxKey}-writer-`;

  function fixture(sessionId) {
    const data = new Map([
      ['mineradio-local-media-salt-v1', 'f'.repeat(64)],
    ]);
    let now = 0;
    let online = true;
    let fetchCalls = 0;
    let replaceOwner = false;
    let replaced = false;
    const storage = {
      get length() {
        return data.size;
      },
      key(index) {
        return [...data.keys()][index] || null;
      },
      getItem(key) {
        return data.has(key) ? data.get(key) : null;
      },
      setItem(key, value) {
        data.set(key, String(value));
        if (
          replaceOwner
          && !replaced
          && key.startsWith(writerPrefix)
          && String(value).includes(sessionId)
        ) {
          replaced = true;
          data.set(lockKey, JSON.stringify({
            token: 'replacement-owner',
            expiresAt: now + 2_000,
          }));
        }
      },
      removeItem(key) {
        data.delete(key);
      },
    };
    function transport() {
      return createListenTransport({
        autoRetry: false,
        baseRetryMs: 100,
        clock: () => now,
        storage,
        fetch: async () => {
          fetchCalls += 1;
          if (!online) throw new Error('offline');
          return {
            ok: true,
            async json() {
              return { accepted: true, localRecorded: true };
            },
          };
        },
      });
    }
    return {
      data,
      transport,
      armOwnershipLoss() {
        replaceOwner = true;
      },
      setNow(value) {
        now = value;
      },
      setOnline(value) {
        online = value;
      },
      fetchCalls() {
        return fetchCalls;
      },
      replaced() {
        return replaced;
      },
    };
  }

  await t.test('submit and a new owner', async () => {
    const sessionId = 'post-write-owner-submit';
    const state = fixture(sessionId);
    const stale = state.transport();
    state.armOwnershipLoss();
    assert.equal(await stale.submit({ sessionId }), false);
    assert.equal(state.replaced(), true);
    assert.equal(state.fetchCalls(), 0);
    assert.equal(stale.status(sessionId), 'pending');
    stale.destroy();

    state.setNow(5_000);
    const recovered = state.transport();
    assert.equal(recovered.status(sessionId), 'pending');
    assertSubmitted(await recovered.retry(sessionId));
    assert.equal(state.fetchCalls(), 1);
    recovered.destroy();
  });

  await t.test('retry', async () => {
    const sessionId = 'post-write-owner-retry';
    const state = fixture(sessionId);
    state.setOnline(false);
    const transport = state.transport();
    assert.equal(await transport.submit({ sessionId }), false);
    assert.equal(state.fetchCalls(), 1);
    state.setOnline(true);
    state.setNow(1_000);
    state.armOwnershipLoss();
    assert.equal(await transport.retry(sessionId), false);
    assert.equal(state.replaced(), true);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(5_000);
    assertSubmitted(await transport.retry(sessionId));
    assert.equal(state.fetchCalls(), 2);
    transport.destroy();
  });

  await t.test('flushDue', async () => {
    const sessionId = 'post-write-owner-flush';
    const state = fixture(sessionId);
    state.setOnline(false);
    const transport = state.transport();
    assert.equal(await transport.submit({ sessionId }), false);
    assert.equal(state.fetchCalls(), 1);
    state.setOnline(true);
    state.setNow(1_000);
    state.armOwnershipLoss();
    assert.deepEqual(await transport.flushDue(), [sessionId]);
    assert.equal(state.replaced(), true);
    assert.equal(state.fetchCalls(), 1);
    state.setNow(5_000);
    assert.deepEqual(await transport.flushDue(), [sessionId]);
    assert.equal(state.fetchCalls(), 2);
    transport.destroy();
  });
});

test('incomplete paged key snapshots retain acknowledgements and shards until a full proof', async () => {
  const outboxKey = 'mineradio-listen-report-outbox-v1';
  const ackPrefix = `${outboxKey}-ack-`;
  const writerPrefix = `${outboxKey}-writer-`;

  function event(sessionId) {
    return {
      sessionId,
      confirmedPlayback: false,
      catalogProvider: '',
      playbackProvider: '',
      resolutionMode: '',
      completeness: 'partial',
      sourceIds: {},
      catalogSourceId: '',
      playbackSourceId: '',
      listenMs: 0,
      durationMs: 0,
      completion: {
        completed: false,
        ratio: 0,
      },
      playedAt: 0,
      context: null,
    };
  }

  function entry(sessionId) {
    return {
      event: event(sessionId),
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: 0,
      state: 'pending',
      lastErrorCode: '',
    };
  }

  function digest(sessionId) {
    return crypto.createHash('sha256')
      .update(JSON.stringify(event(sessionId)))
      .digest('hex');
  }

  const bootstrapSession = 'paged-bootstrap-ack';
  const targetSession = 'paged-target-ack';
  const survivorSession = 'paged-unacknowledged-pending';
  const bootstrapAckKey = `${ackPrefix}bootstrap`;
  const raceShardKey = `${writerPrefix}same-length-race`;
  const earlyShardKey = `${writerPrefix}early-acknowledged`;
  const targetAckKey = `${ackPrefix}target`;
  const targetShardKey = `${writerPrefix}late-acknowledged`;
  const survivorShardKey = `${writerPrefix}late-unacknowledged`;
  const replacedForeignKey = 'foreign-paged-1000';
  const data = new Map();
  data.set('mineradio-local-media-salt-v1', '1'.repeat(64));
  data.set(bootstrapAckKey, JSON.stringify({
    version: 1,
    writer: 'bootstrap',
    revision: 1,
    entries: [{
      sessionId: bootstrapSession,
      digest: digest(bootstrapSession),
      confirmedAt: 0,
    }],
  }));
  for (let index = 2; index < 384; index += 1) {
    data.set(`foreign-paged-${index}`, `foreign-value-${index}`);
  }
  data.set(earlyShardKey, JSON.stringify({
    version: 2,
    writer: 'early',
    generation: 'early-generation',
    createdAt: 0,
    lastSeen: 0,
    revision: 1,
    entries: [entry(bootstrapSession)],
  }));
  for (let index = 385; index < 640; index += 1) {
    data.set(`foreign-paged-${index}`, `foreign-value-${index}`);
  }
  data.set(targetAckKey, JSON.stringify({
    version: 1,
    writer: 'target',
    revision: 1,
    entries: [{
      sessionId: targetSession,
      digest: digest(targetSession),
      confirmedAt: 0,
    }],
  }));
  for (let index = 641; index < 4100; index += 1) {
    data.set(`foreign-paged-${index}`, `foreign-value-${index}`);
  }
  data.set(targetShardKey, JSON.stringify({
    version: 2,
    writer: 'late-target',
    generation: 'late-target-generation',
    createdAt: 0,
    lastSeen: 0,
    revision: 1,
    entries: [entry(targetSession)],
  }));
  data.set(survivorShardKey, JSON.stringify({
    version: 2,
    writer: 'late-survivor',
    generation: 'late-survivor-generation',
    createdAt: 0,
    lastSeen: 0,
    revision: 1,
    entries: [entry(survivorSession)],
  }));
  for (let index = 4102; index < 4200; index += 1) {
    data.set(`foreign-paged-${index}`, `foreign-value-${index}`);
  }
  const foreignBefore = [...data.entries()].filter(([key]) => (
    key.startsWith('foreign-paged-') && key !== replacedForeignKey
  ));
  let now = 10_000;
  let fetchCalls = 0;
  let keyCalls = 0;
  let maxKeyIndex = 0;
  let sameLengthMutation = false;
  let completeScanAwaitingAckRead = false;
  let cachedKeys = null;
  function storageKeys() {
    if (!cachedKeys) cachedKeys = [...data.keys()];
    return cachedKeys;
  }
  const storage = {
    get length() {
      return data.size;
    },
    key(index) {
      keyCalls += 1;
      maxKeyIndex = Math.max(maxKeyIndex, index);
      if (index === data.size - 1) completeScanAwaitingAckRead = true;
      return storageKeys()[index] || null;
    },
    getItem(key) {
      if (
        !sameLengthMutation
        && key === targetAckKey
        && completeScanAwaitingAckRead
      ) {
        data.delete(replacedForeignKey);
        data.set(raceShardKey, JSON.stringify({
          version: 2,
          writer: 'same-length-race-writer',
          generation: 'same-length-race-generation',
          createdAt: now,
          lastSeen: now,
          revision: 1,
          entries: [entry(targetSession)],
        }));
        cachedKeys = null;
        sameLengthMutation = true;
        completeScanAwaitingAckRead = false;
      }
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
      cachedKeys = null;
    },
    removeItem(key) {
      data.delete(key);
      cachedKeys = null;
    },
  };
  const transport = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });

  assert.equal(data.has(earlyShardKey), false);
  assert.equal(data.has(targetAckKey), true);
  assert.equal(data.has(targetShardKey), true);
  assert.equal(data.has(survivorShardKey), true);
  assert.deepEqual(await transport.submit({ sessionId: 'paged-scan-probe' }), {
    accepted: false,
    localRecorded: true,
    status: 'rejected',
    code: 'OUTBOX_CAPACITY_EXCEEDED',
  });

  for (
    let attempt = 0;
    attempt < 100
    && (
      !sameLengthMutation
      ||
      data.has(earlyShardKey)
      || data.has(targetAckKey)
      || data.has(targetShardKey)
    );
    attempt += 1
  ) {
    if (transport.status('paged-scan-probe') === 'pending') {
      await transport.retry('paged-scan-probe');
    } else {
      await transport.flushDue();
    }
  }

  assert.equal(sameLengthMutation, true);
  assert.equal(
    data.has(targetAckKey),
    true,
    'an active shard inserted without changing storage.length must retain its ack',
  );
  assert.equal(data.has(raceShardKey), true);

  transport.destroy();
  now = 30_000;
  const cleaner = createListenTransport({
    autoRetry: false,
    clock: () => now,
    storage,
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return { accepted: true, localRecorded: true };
        },
      };
    },
  });
  await cleaner.submit({ sessionId: 'paged-cleanup-probe' });
  for (
    let attempt = 0;
    attempt < 100
    && (
      data.has(earlyShardKey)
      || data.has(raceShardKey)
      || data.has(targetAckKey)
      || data.has(targetShardKey)
    );
    attempt += 1
  ) {
    await cleaner.flushDue();
  }

  assert.equal(
    data.has(earlyShardKey),
    false,
    `keyCalls=${keyCalls} maxKeyIndex=${maxKeyIndex}`,
  );
  assert.equal(data.has(raceShardKey), false);
  assert.equal(
    data.has(targetAckKey),
    false,
    `targetShard=${data.has(targetShardKey)} survivor=${data.has(survivorShardKey)} `
      + `keyCalls=${keyCalls} maxKeyIndex=${maxKeyIndex} fetchCalls=${fetchCalls}`,
  );
  assert.equal(data.has(targetShardKey), false);
  assert.match(JSON.stringify([...data.entries()]), new RegExp(survivorSession));
  assert.equal(fetchCalls, 0);
  foreignBefore.forEach(([key, value]) => {
    assert.equal(data.get(key), value);
  });
  cleaner.destroy();
});

test('Task7 integration starts after commit and closes on switch, ended, and unload only once', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8',
  );
  const finalizeCommit = html.indexOf("finalizeListenSession(false, 'switch')");
  const beginCommit = html.indexOf('beginListenSession(value.song, value.playbackContext || null)');

  assert.notEqual(finalizeCommit, -1);
  assert.notEqual(beginCommit, -1);
  assert.ok(finalizeCommit < beginCommit);
  assert.match(html, /if \(!listenSession \|\| listenSession\.key !== key\) return;/);
  assert.match(html, /finalizeListenSession\(true, 'ended'\)/);
  assert.match(html, /finalizeListenSession\(false, 'pagehide', true\)/);
  assert.match(html, /finalizeListenSession\(false, 'beforeunload', true\)/);
  assert.match(html, /listenReportTransport\.submit\(reportEvent, \{ unload: !!unload \}\)/);
  assert.match(html, /if \(machineSession && !reportEvent\) return null;/);
  assert.match(html, /listenReportingBinding\(snap\.playbackProvider\)/);
  assert.match(html, /reportingBinding: reportingBinding \?/);
  assert.doesNotMatch(html, /status: result === true \? 'delivered'/);
  assert.match(html, /result\.delivery === 'uncertain'[\s\S]{0,40}\? '不确定'/);
  assert.match(html, /result\.delivery === 'local-only'[\s\S]{0,40}\? '仅本地'/);
  assert.match(html, /result\.delivery === 'terminal'[\s\S]{0,40}\? '已拒绝'/);
  assert.match(html, /listenReporting: listenReportStatus/);
  assert.match(html, /code: 'OUTBOX_CAPACITY_EXCEEDED'/);
  assert.match(html, /code: 'LISTEN_STATS_STORAGE_FAILED'/);
});
