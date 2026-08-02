'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createTimelineExecutor } = require('../cuefield/timeline-executor');
const { createBrowserRuntime } = require('../public/cuefield-runtime');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function plan(id = 'plan-1') {
  return {
    id,
    mode: 'beat-crossfade',
    triggerAtSec: 10,
    entryAtSec: 4,
    crossfadeMs: 820,
  };
}

test('moves through idle, preparing, armed, handing-off, and idle', async () => {
  const calls = [];
  const executor = createTimelineExecutor({
    prepare: async ({ plan: value }) => {
      calls.push(['prepare', value.id]);
      return { id: 'prepared' };
    },
    claim: async ({ prepared }) => {
      calls.push(['claim', prepared.id]);
      return { id: 'claimed' };
    },
    handoff: async ({ claimed, plan: value }) => {
      calls.push(['handoff', claimed.id, value.crossfadeMs]);
      return { ok: true };
    },
    isCurrent: context => context.current === true,
  });
  const context = { current: true, identity: 'track-a>track-b' };

  assert.equal(executor.snapshot().state, 'idle');
  assert.equal((await executor.prepare(plan(), context)).status, 'armed');
  assert.equal(executor.snapshot().state, 'armed');
  assert.equal((await executor.tick({ currentTimeSec: 9.9 })).status, 'waiting');
  assert.equal((await executor.tick({ currentTimeSec: 10 })).status, 'complete');
  assert.equal(executor.snapshot().state, 'idle');
  assert.deepEqual(calls, [
    ['prepare', 'plan-1'],
    ['claim', 'prepared'],
    ['handoff', 'claimed', 820],
  ]);
});

for (const reason of [
  'manual-skip',
  'seek',
  'pause',
  'source-failure',
  'track-replacement',
  'background-release',
  'feature-disabled',
]) {
  test(`cancels an armed transition for ${reason}`, async () => {
    const released = [];
    const executor = createTimelineExecutor({
      prepare: async () => ({ id: reason }),
      claim: async () => assert.fail('cancelled transition must not claim'),
      handoff: async () => assert.fail('cancelled transition must not hand off'),
      release: (value, why) => released.push([value.id, why]),
      isCurrent: () => true,
    });
    await executor.prepare(plan(reason), { current: true });

    assert.equal(executor.cancel(reason), true);
    assert.equal(executor.snapshot().state, 'idle');
    assert.equal(executor.snapshot().lastReason, reason);
    assert.deepEqual(released, [[reason, reason]]);
  });
}

test('releases a preparation that resolves after cancellation exactly once', async () => {
  const pending = deferred();
  const released = [];
  const executor = createTimelineExecutor({
    prepare: () => pending.promise,
    claim: async () => null,
    handoff: async () => ({ ok: true }),
    release: (value, reason) => released.push([value.id, reason]),
    isCurrent: () => true,
  });
  const preparing = executor.prepare(plan(), { current: true });
  assert.equal(executor.snapshot().state, 'preparing');
  executor.cancel('manual-skip');
  pending.resolve({ id: 'late-prepared' });

  assert.equal((await preparing).status, 'stale');
  assert.deepEqual(released, [['late-prepared', 'manual-skip']]);
  assert.equal(executor.cancel('manual-skip'), false);
});

test('does not release claimed media after ownership transfers to the playback transaction', async () => {
  const handoff = deferred();
  const released = [];
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => ({ id: 'claimed' }),
    handoff: () => handoff.promise,
    release: value => released.push(value.id),
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });
  const running = executor.tick({ currentTimeSec: 10 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executor.snapshot().state, 'handing-off');
  assert.equal(executor.cancel('track-replacement'), true);
  handoff.resolve({ ok: false, stale: true });

  assert.equal((await running).status, 'stale');
  assert.deepEqual(released, []);
});

test('runs ordinary fallback once only for a current non-stale handoff failure', async () => {
  const fallbackCalls = [];
  const context = { current: true };
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => ({ id: 'claimed' }),
    handoff: async () => ({ ok: false, error: new Error('source failed') }),
    fallback: async payload => {
      fallbackCalls.push(payload.error.message);
      return { ok: true };
    },
    isCurrent: value => value.current,
  });
  await executor.prepare(plan(), context);

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'fallback-complete');
  assert.deepEqual(fallbackCalls, ['source failed']);
  assert.equal((await executor.tick({ currentTimeSec: 11 })).status, 'idle');
  assert.equal(fallbackCalls.length, 1);
});

test('never falls back after identity becomes stale', async () => {
  const context = { current: true };
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => ({ id: 'claimed' }),
    handoff: async () => {
      context.current = false;
      return { ok: false, error: new Error('stale failure') };
    },
    fallback: async () => { fallbackCalls += 1; },
    isCurrent: value => value.current,
  });
  await executor.prepare(plan(), context);

  assert.equal((await executor.tick({ currentTimeSec: 10 })).status, 'stale');
  assert.equal(fallbackCalls, 0);
});

test('successful handoff completes when it invalidates the old playback context', async () => {
  const context = { current: true };
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async ({ prepared }) => prepared,
    handoff: async () => {
      context.current = false;
      return { ok: true, state: 'committed' };
    },
    isCurrent: value => value.current,
  });
  await executor.prepare(plan(), context);

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'complete');
  assert.equal(result.result.state, 'committed');
});

test('successful ordinary fallback completes when it replaces the old context', async () => {
  const context = { current: true };
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => null,
    fallback: async () => {
      context.current = false;
      return { ok: true, state: 'committed' };
    },
    release: () => {},
    isCurrent: value => value.current,
  });
  await executor.prepare(plan(), context);

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'fallback-complete');
  assert.equal(result.result.state, 'committed');
});

test('runs ordinary fallback after a handoff transaction explicitly rolls back', async () => {
  const context = { current: true };
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async ({ prepared }) => prepared,
    handoff: async () => {
      context.current = false;
      return {
        ok: false,
        retained: true,
        state: 'rolled-back',
        error: new Error('commit rolled back'),
      };
    },
    fallback: async () => {
      fallbackCalls += 1;
      return { ok: true, state: 'committed' };
    },
    isCurrent: value => value.current,
  });
  await executor.prepare(plan(), context);

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'fallback-complete');
  assert.equal(result.result.state, 'committed');
  assert.equal(fallbackCalls, 1);
});

test('releases prepared playback before fallback when claim fails', async () => {
  const prepared = { id: 'prepared' };
  const released = [];
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => prepared,
    claim: async () => null,
    fallback: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
    release: (value, reason) => released.push([value.id, reason]),
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });

  assert.equal((await executor.tick({ currentTimeSec: 10 })).status, 'fallback-complete');
  assert.deepEqual(released, [['prepared', 'claim-failed']]);
  assert.equal(fallbackCalls, 1);
});

test('releases a claimed playback when handoff throws before accepting ownership', async () => {
  const prepared = { id: 'prepared' };
  const released = [];
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => prepared,
    claim: async () => prepared,
    handoff: () => {
      throw new Error('synchronous handoff failure');
    },
    fallback: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
    release: (value, reason) => released.push([value.id, reason]),
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });

  assert.equal((await executor.tick({ currentTimeSec: 10 })).status, 'fallback-complete');
  assert.deepEqual(released, [['prepared', 'handoff-not-accepted']]);
  assert.equal(fallbackCalls, 1);
});

test('releases prepared playback and falls back once when claim throws', async () => {
  const prepared = { id: 'prepared' };
  const released = [];
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => prepared,
    claim: async () => {
      throw new Error('claim failed');
    },
    fallback: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
    release: (value, reason) => released.push([value.id, reason]),
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });

  assert.equal((await executor.tick({ currentTimeSec: 10 })).status, 'fallback-complete');
  assert.deepEqual(released, [['prepared', 'claim-error']]);
  assert.equal(fallbackCalls, 1);
});

test('contains a rejected fallback and returns to idle without retrying it', async () => {
  let fallbackCalls = 0;
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => null,
    fallback: async () => {
      fallbackCalls += 1;
      throw new Error('ordinary playback failed');
    },
    release: () => {},
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.message, 'ordinary playback failed');
  assert.equal(executor.snapshot().state, 'idle');
  assert.equal(fallbackCalls, 1);
});

test('contains a rejected fallback after claim failure', async () => {
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    claim: async () => {
      throw new Error('claim failed');
    },
    fallback: async () => {
      throw new Error('ordinary playback failed');
    },
    release: () => {},
    isCurrent: () => true,
  });
  await executor.prepare(plan(), { current: true });

  const result = await executor.tick({ currentTimeSec: 10 });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.message, 'ordinary playback failed');
  assert.equal(executor.snapshot().state, 'idle');
});

test('late fallback completion cannot reset a replacement operation', async () => {
  const fallback = deferred();
  const executor = createTimelineExecutor({
    prepare: async ({ plan: value }) => ({ id: value.id }),
    claim: async () => null,
    fallback: () => fallback.promise,
    release: () => {},
    isCurrent: () => true,
  });
  await executor.prepare(plan('first'), { current: true });
  const firstTick = executor.tick({ currentTimeSec: 10 });
  await new Promise(resolve => setImmediate(resolve));

  await executor.prepare(plan('second'), { current: true });
  assert.equal(executor.snapshot().state, 'armed');
  fallback.resolve({ ok: true });

  assert.equal((await firstTick).status, 'stale');
  assert.equal(executor.snapshot().state, 'armed');
  assert.equal(executor.snapshot().planId, 'second');
  executor.cancel('cleanup');
});

test('release and current-context callbacks fail closed without corrupting state', async () => {
  const executor = createTimelineExecutor({
    prepare: async () => ({ id: 'prepared' }),
    release: () => {
      throw new Error('release hook failed');
    },
    isCurrent: () => {
      throw new Error('current hook failed');
    },
  });

  assert.equal((await executor.prepare(plan(), { current: true })).status, 'stale');
  assert.equal(executor.snapshot().state, 'idle');
  assert.equal(executor.cancel('cleanup'), false);
});

function runtimeAnalysis(duration = 200) {
  const downbeats = [];
  for (let time = 0; time <= duration; time += 2) {
    downbeats.push({ time, confidence: 0.92, energy: 0.62 });
  }
  return {
    duration,
    bpm: 120,
    gridStep: 0.5,
    camelot: '8A',
    downbeats,
    phraseBoundaries: downbeats.filter((_, index) => index % 8 === 0),
    energyCurve: downbeats.map(boundary => ({ time: boundary.time, value: boundary.energy })),
    tempoStability: 0.92,
    beatConfidence: 0.92,
    downbeatStability: 0.9,
    dataConfidence: 0.9,
  };
}

async function createArmedRuntime(overrides = {}) {
  const initialTimeSec = overrides.initialTimeSec == null ? 190 : overrides.initialTimeSec;
  const runtimeOverrides = { ...overrides };
  delete runtimeOverrides.initialTimeSec;
  const statuses = [];
  const calls = { claim: 0, handoff: 0, release: 0 };
  const runtime = createBrowserRuntime({
    resolveContext: async () => ({
      fromAnalysis: runtimeAnalysis(200),
      toAnalysis: runtimeAnalysis(180),
      context: { current: true },
    }),
    prepare: async () => ({ id: 'prepared' }),
    claim: async ({ prepared }) => {
      calls.claim += 1;
      return prepared;
    },
    handoff: async () => {
      calls.handoff += 1;
      return { ok: true };
    },
    release: () => {
      calls.release += 1;
    },
    isCurrent: context => context.current,
    onStatus: status => statuses.push(status),
    ...runtimeOverrides,
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: initialTimeSec,
  });
  await runtime.settle();
  assert.equal(runtime.snapshot().executor.state, 'armed');
  return { runtime, statuses, calls };
}

test('browser runtime does not schedule executor work on frames before the trigger', async () => {
  const { runtime, statuses, calls } = await createArmedRuntime();
  const trigger = runtime.snapshot().plan.triggerAtSec;
  statuses.length = 0;

  runtime.tick({ nowMs: 110, identity: 'track-a>track-b', playing: true, currentTimeSec: trigger - 1 });
  runtime.tick({ nowMs: 120, identity: 'track-a>track-b', playing: true, currentTimeSec: trigger - 0.5 });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(statuses, []);
  assert.equal(calls.claim, 0);
  assert.equal(runtime.snapshot().executor.state, 'armed');
  runtime.destroy();
});

test('browser runtime expires a plan that misses its trigger window', async () => {
  const { runtime, statuses, calls } = await createArmedRuntime({ maxLateTriggerSec: 0.35 });
  const trigger = runtime.snapshot().plan.triggerAtSec;
  statuses.length = 0;

  runtime.tick({ nowMs: 500, identity: 'track-a>track-b', playing: true, currentTimeSec: trigger + 0.5 });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(runtime.snapshot().executor.state, 'idle');
  assert.equal(runtime.snapshot().status, 'expired');
  assert.deepEqual(statuses, ['expired']);
  assert.equal(calls.claim, 0);
  assert.equal(calls.handoff, 0);
  assert.equal(calls.release, 1);
  assert.ok(runtime.snapshot().retryAfterMs > 500);
  runtime.destroy();
});

test('browser runtime publishes a paused state only once while frames keep arriving', () => {
  const statuses = [];
  const runtime = createBrowserRuntime({
    onStatus: status => statuses.push(status),
  });
  runtime.setIntensity('balanced');
  statuses.length = 0;

  runtime.tick({ nowMs: 1, identity: 'track-a>track-b', playing: false, currentTimeSec: 0 });
  runtime.tick({ nowMs: 2, identity: 'track-a>track-b', playing: false, currentTimeSec: 0 });
  runtime.tick({ nowMs: 3, identity: 'track-a>track-b', playing: false, currentTimeSec: 0 });

  assert.deepEqual(statuses, ['track-replacement', 'pause']);
  runtime.destroy();
});

test('browser runtime plans early but defers media preparation until the preload window', async () => {
  let prepareCalls = 0;
  const runtime = createBrowserRuntime({
    preloadLeadSec: 10,
    resolveContext: async () => ({
      fromAnalysis: runtimeAnalysis(200),
      toAnalysis: runtimeAnalysis(180),
      context: { current: true },
    }),
    prepare: async () => {
      prepareCalls += 1;
      return { id: 'prepared' };
    },
    release: () => {},
    isCurrent: context => context.current,
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 80,
  });
  await runtime.settle();
  const scheduled = runtime.snapshot();

  assert.equal(scheduled.scheduled, true);
  assert.equal(scheduled.executor.state, 'idle');
  assert.equal(prepareCalls, 0);

  runtime.tick({
    nowMs: 200,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: scheduled.plan.triggerAtSec - 9.9,
  });
  await runtime.settle();

  assert.equal(runtime.snapshot().scheduled, false);
  assert.equal(runtime.snapshot().executor.state, 'armed');
  assert.equal(prepareCalls, 1);
  runtime.destroy();
});

test('changing intensity cancels an armed plan before publishing the new mode', async () => {
  const { runtime, calls } = await createArmedRuntime();

  assert.equal(runtime.setIntensity('club'), 'club');
  assert.equal(runtime.snapshot().intensity, 'club');
  assert.equal(runtime.snapshot().executor.state, 'idle');
  assert.equal(runtime.snapshot().status, 'waiting');
  assert.equal(calls.release, 1);
  runtime.destroy();
});

test('browser runtime notifies the media owner when preparation is cancelled', async () => {
  const pending = deferred();
  const cancellations = [];
  const runtime = createBrowserRuntime({
    resolveContext: async () => ({
      fromAnalysis: runtimeAnalysis(200),
      toAnalysis: runtimeAnalysis(180),
      context: { current: true },
    }),
    prepare: () => pending.promise,
    release: () => {},
    isCurrent: context => context.current,
    onCancel: reason => cancellations.push(reason),
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190,
  });
  const preparing = runtime.settle();
  await new Promise(resolve => setImmediate(resolve));

  runtime.setIntensity('club');
  assert.deepEqual(cancellations, ['intensity-changed']);
  pending.resolve({ id: 'late-prepared' });
  await preparing;
  runtime.destroy();
});

test('browser runtime backs off after media preparation is unavailable', async () => {
  let resolveCalls = 0;
  let prepareCalls = 0;
  const runtime = createBrowserRuntime({
    retryDelayMs: 1000,
    maxRetryDelayMs: 4000,
    preloadLeadSec: 10,
    resolveContext: async () => {
      resolveCalls += 1;
      return {
        fromAnalysis: runtimeAnalysis(200),
        toAnalysis: runtimeAnalysis(180),
        context: { current: true },
      };
    },
    prepare: async () => {
      prepareCalls += 1;
      return null;
    },
    isCurrent: context => context.current,
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190,
  });
  await runtime.settle();

  assert.equal(runtime.snapshot().status, 'prepare-failed');
  assert.equal(runtime.snapshot().retryAfterMs, 1100);
  runtime.tick({
    nowMs: 101,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190.1,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolveCalls, 1);
  assert.equal(prepareCalls, 1);

  runtime.tick({
    nowMs: 1100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190.2,
  });
  await runtime.settle();
  assert.equal(runtime.snapshot().retryAfterMs, 3100);

  runtime.tick({
    nowMs: 3100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190.4,
  });
  await runtime.settle();
  assert.equal(runtime.snapshot().retryAfterMs, 7100);
  runtime.destroy();
});

test('browser runtime resets retry backoff for a new playback identity', async () => {
  let resolveCalls = 0;
  const runtime = createBrowserRuntime({
    retryDelayMs: 1000,
    resolveContext: async () => {
      resolveCalls += 1;
      return {
        fromAnalysis: runtimeAnalysis(200),
        toAnalysis: runtimeAnalysis(180),
        context: { current: true },
      };
    },
    prepare: async () => null,
    isCurrent: context => context.current,
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190,
  });
  await runtime.settle();
  assert.equal(runtime.snapshot().retryAfterMs, 1100);

  runtime.tick({
    nowMs: 200,
    identity: 'track-b>track-c',
    playing: true,
    currentTimeSec: 190,
  });
  await runtime.settle();

  assert.equal(resolveCalls, 2);
  assert.equal(runtime.snapshot().retryAfterMs, 1200);
  runtime.destroy();
});

test('browser runtime backs off after transition execution and fallback fail', async () => {
  const { runtime } = await createArmedRuntime({
    retryDelayMs: 1000,
    handoff: async () => ({ ok: false, error: new Error('handoff failed') }),
    fallback: async () => ({ ok: false }),
  });
  const trigger = runtime.snapshot().plan.triggerAtSec;

  runtime.tick({
    nowMs: 200,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: trigger,
  });
  for (let attempt = 0; attempt < 10 && runtime.snapshot().executor.state !== 'idle'; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(runtime.snapshot().status, 'failed');
  assert.equal(runtime.snapshot().retryAfterMs, 1200);
  runtime.destroy();
});

test('late execution results cannot overwrite a newer paused state', async () => {
  const handoff = deferred();
  const { runtime } = await createArmedRuntime({
    handoff: () => handoff.promise,
  });
  const trigger = runtime.snapshot().plan.triggerAtSec;
  runtime.tick({
    nowMs: 200,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: trigger,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.snapshot().executor.state, 'handing-off');

  runtime.tick({
    nowMs: 201,
    identity: 'track-a>track-b',
    playing: false,
    currentTimeSec: trigger,
  });
  handoff.resolve({ ok: false, stale: true });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(runtime.snapshot().status, 'pause');
  assert.equal(runtime.snapshot().executor.state, 'idle');
  runtime.destroy();
});

test('late preparation results cannot overwrite a newer paused state', async () => {
  const pending = deferred();
  const released = [];
  const runtime = createBrowserRuntime({
    resolveContext: async () => ({
      fromAnalysis: runtimeAnalysis(200),
      toAnalysis: runtimeAnalysis(180),
      context: { current: true },
    }),
    prepare: () => pending.promise,
    release: value => released.push(value.id),
    isCurrent: context => context.current,
  });
  runtime.setIntensity('balanced');
  runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190,
  });
  const preparing = runtime.settle();
  await new Promise(resolve => setImmediate(resolve));
  runtime.tick({
    nowMs: 101,
    identity: 'track-a>track-b',
    playing: false,
    currentTimeSec: 190,
  });
  pending.resolve({ id: 'late-prepared' });
  await preparing;

  assert.equal(runtime.snapshot().status, 'pause');
  assert.equal(runtime.snapshot().executor.state, 'idle');
  assert.deepEqual(released, ['late-prepared']);
  runtime.destroy();
});

test('browser runtime contains synchronous context resolver failures', async () => {
  const runtime = createBrowserRuntime({
    retryDelayMs: 1000,
    resolveContext: () => {
      throw new Error('resolver failed synchronously');
    },
  });
  runtime.setIntensity('balanced');

  assert.doesNotThrow(() => runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: true,
    currentTimeSec: 190,
  }));
  await runtime.settle();

  assert.equal(runtime.snapshot().status, 'planning-error');
  assert.equal(runtime.snapshot().retryAfterMs, 1100);
  runtime.destroy();
});

test('browser runtime contains status callback failures', () => {
  const runtime = createBrowserRuntime({
    onStatus: () => {
      throw new Error('status callback failed');
    },
  });

  assert.doesNotThrow(() => runtime.setIntensity('balanced'));
  assert.equal(runtime.snapshot().status, 'waiting');
  assert.doesNotThrow(() => runtime.tick({
    nowMs: 100,
    identity: 'track-a>track-b',
    playing: false,
    currentTimeSec: 0,
  }));
  assert.equal(runtime.snapshot().status, 'pause');
  runtime.destroy();
});
