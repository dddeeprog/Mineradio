'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyAuthoritativeAudioOutput,
  applyAudioOutputDevice,
  createAudioOutputArbiter,
  createAudioGraphRuntime,
  normalizeAudioOutputDevices,
  reconcileAudioOutputSelection,
  supportsSetSinkId,
  transferMediaElementState,
} = require('../public/audio-output-state');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fakeNode(name) {
  return {
    name,
    connections: [],
    connect(target) {
      this.connections.push(target);
      return target;
    },
    disconnect() {
      this.connections = [];
    },
  };
}

function fakeContext(id, state = 'running', globallyBoundMedia = null) {
  const context = {
    id,
    state,
    destination: fakeNode('destination-' + id),
    resumed: 0,
    sources: [],
    createMediaElementSource(media) {
      if (globallyBoundMedia && globallyBoundMedia.has(media)) {
        const error = new Error('HTMLMediaElement already connected previously');
        error.name = 'InvalidStateError';
        throw error;
      }
      if (globallyBoundMedia) globallyBoundMedia.add(media);
      const node = fakeNode('source-' + media.id);
      node.media = media;
      this.sources.push(node);
      return node;
    },
    createAnalyser() {
      return fakeNode('analyser-' + id);
    },
    createGain() {
      const node = fakeNode('gain-' + id);
      node.gain = { value: 1 };
      return node;
    },
    async resume() {
      this.resumed += 1;
      this.state = 'running';
    },
  };
  return context;
}

test('detects setSinkId support and applies a selected output', async () => {
  const calls = [];
  const media = {
    async setSinkId(id) {
      calls.push(id);
      this.sinkId = id;
    },
  };

  assert.equal(supportsSetSinkId(media), true);
  const result = await applyAudioOutputDevice(media, 'usb-output', [
    { kind: 'audiooutput', deviceId: 'default', label: '系统默认' },
    { kind: 'audiooutput', deviceId: 'usb-output', label: 'USB DAC' },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.supported, true);
  assert.equal(result.sinkId, 'usb-output');
  assert.deepEqual(calls, ['usb-output']);
});

test('falls back without throwing when setSinkId is unsupported', async () => {
  const result = await applyAudioOutputDevice({}, 'usb-output', []);

  assert.deepEqual(result, {
    ok: false,
    supported: false,
    fallback: true,
    disappeared: false,
    sinkId: '',
    reason: 'unsupported',
  });
});

test('routes the authoritative graph and media element to the selected output', async () => {
  const calls = [];
  const context = {
    async setSinkId(id) {
      calls.push(['context', id]);
    },
  };
  const media = {
    async setSinkId(id) {
      calls.push(['media', id]);
    },
  };

  const result = await applyAuthoritativeAudioOutput({
    context,
    graphActive: true,
    media,
    requestedId: 'studio-output',
    devices: [
      { kind: 'audiooutput', deviceId: 'studio-output', label: 'Studio DAC' },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.authoritativeTarget, 'context');
  assert.equal(result.sinkId, 'studio-output');
  assert.deepEqual(calls, [
    ['context', 'studio-output'],
    ['media', 'studio-output'],
  ]);
});

test('reports graph fallback when only the media element supports setSinkId', async () => {
  const calls = [];
  const result = await applyAuthoritativeAudioOutput({
    context: {},
    graphActive: true,
    media: {
      async setSinkId(id) {
        calls.push(id);
      },
    },
    requestedId: 'usb-output',
    devices: [
      { kind: 'audiooutput', deviceId: 'usb-output', label: 'USB DAC' },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'graph-output-unsupported');
  assert.equal(result.sinkId, 'usb-output');
  assert.deepEqual(calls, ['usb-output']);
});

test('normalizes output devices and falls back when the selected device disappears', async () => {
  const devices = normalizeAudioOutputDevices([
    { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
    { kind: 'audiooutput', deviceId: 'default', label: '' },
    { kind: 'audiooutput', deviceId: 'usb', label: 'USB DAC' },
    { kind: 'audiooutput', deviceId: 'usb', label: 'Duplicate' },
  ]);
  assert.deepEqual(devices, [
    { deviceId: '', label: '系统默认输出', isDefault: true },
    { deviceId: 'usb', label: 'USB DAC', isDefault: false },
  ]);

  const reconciliation = reconcileAudioOutputSelection('removed-device', devices);
  assert.equal(reconciliation.sinkId, '');
  assert.equal(reconciliation.disappeared, true);

  const calls = [];
  const media = {
    async setSinkId(id) {
      calls.push(id);
    },
  };
  const result = await applyAudioOutputDevice(media, 'removed-device', devices);
  assert.equal(result.ok, true);
  assert.equal(result.fallback, true);
  assert.equal(result.disappeared, true);
  assert.deepEqual(calls, ['']);
});

test('serializes output changes and reapplies the latest generation after an older resolve', async () => {
  const firstGate = deferred();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const arbiter = createAudioOutputArbiter({
    async apply(request) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(request.sinkId);
      if (request.sinkId === 'A') await firstGate.promise;
      active -= 1;
      return { ok: true, sinkId: request.sinkId };
    },
  });

  const first = arbiter.request({ sinkId: 'A' });
  await Promise.resolve();
  const second = arbiter.request({ sinkId: 'B' });
  firstGate.resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, ['A', 'B']);
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.stale, false);
  assert.equal(secondResult.sinkId, 'B');
  assert.deepEqual(arbiter.snapshot(), {
    applying: false,
    appliedGeneration: 2,
    appliedSinkId: 'B',
    generation: 2,
    pendingSinkId: '',
  });
});

test('continues with the latest output generation after an older request rejects', async () => {
  const firstGate = deferred();
  const calls = [];
  const arbiter = createAudioOutputArbiter({
    async apply(request) {
      calls.push(request.sinkId);
      if (request.sinkId === 'A') await firstGate.promise;
      return { ok: true, sinkId: request.sinkId };
    },
  });

  const first = arbiter.request({ sinkId: 'A' });
  await Promise.resolve();
  const second = arbiter.request({ sinkId: 'B' });
  firstGate.reject(new Error('A failed late'));

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.stale, true);
  assert.equal(firstResult.ok, false);
  assert.match(firstResult.error.message, /failed late/);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.sinkId, 'B');
  assert.deepEqual(calls, ['A', 'B']);
  assert.equal(arbiter.snapshot().appliedSinkId, 'B');
});

test('reconnects interrupted graphs and replaces a closed context only once', async () => {
  const contexts = [
    fakeContext('ctx-1', 'suspended'),
    fakeContext('ctx-2', 'running'),
  ];
  let contextCreates = 0;
  const replacementMedia = { id: 'one-replacement' };
  const runtime = createAudioGraphRuntime({
    createContext() {
      const context = contexts[contextCreates];
      contextCreates += 1;
      return context;
    },
    replaceMedia() {
      return replacementMedia;
    },
  });
  const firstMedia = { id: 'one' };

  const first = await runtime.ensure(firstMedia);
  assert.equal(contextCreates, 1);
  assert.equal(first.context.id, 'ctx-1');
  assert.equal(first.context.resumed, 1);
  assert.equal(first.createdContext, true);

  runtime.markInterrupted(firstMedia);
  const reconnected = await runtime.ensure(firstMedia);
  assert.equal(contextCreates, 1);
  assert.equal(reconnected.reconnected, true);
  assert.equal(reconnected.source, first.source);

  contexts[0].state = 'closed';
  const replaced = await runtime.ensure(firstMedia);
  const reused = await runtime.ensure(firstMedia);
  assert.equal(contextCreates, 2);
  assert.equal(replaced.context.id, 'ctx-2');
  assert.equal(replaced.media, replacementMedia);
  assert.equal(replaced.replacedMedia, firstMedia);
  assert.equal(reused.context, replaced.context);
  assert.equal(reused.media, replacementMedia);
  assert.equal(reused.createdContext, false);
  assert.equal(runtime.snapshot().mediaCount, 1);
});

test('shares one authoritative analyser and gain graph across two media elements', async () => {
  const context = fakeContext('ctx');
  const runtime = createAudioGraphRuntime({ createContext: () => context });
  const current = { id: 'current' };
  const standby = { id: 'standby' };

  const first = await runtime.ensure(current);
  const second = await runtime.ensure(standby);

  assert.equal(first.context, second.context);
  assert.equal(first.analyser, second.analyser);
  assert.equal(first.beatAnalyser, second.beatAnalyser);
  assert.equal(first.gainNode, second.gainNode);
  assert.notEqual(first.source, second.source);
  assert.equal(runtime.snapshot().mediaCount, 2);

  runtime.release(current);
  assert.equal(runtime.snapshot().mediaCount, 1);
});

test('replaces a previously-bound media element when rebuilding a closed graph', async () => {
  const globallyBoundMedia = new WeakSet();
  const contexts = [
    fakeContext('ctx-1', 'running', globallyBoundMedia),
    fakeContext('ctx-2', 'running', globallyBoundMedia),
  ];
  const endedHandler = () => {};
  const queueIdentity = { key: 'queue-item-7' };
  const original = {
    id: 'original',
    src: '/current.mp3',
    currentTime: 42.5,
    paused: false,
    volume: 0.37,
    muted: true,
    playbackRate: 1.25,
    preload: 'auto',
    crossOrigin: 'anonymous',
    onended: endedHandler,
    queueIdentity,
  };
  let replacement = null;
  let contextCreates = 0;
  const runtime = createAudioGraphRuntime({
    createContext() {
      return contexts[contextCreates++];
    },
    replaceMedia(media) {
      replacement = {
        id: 'replacement',
        src: '',
        currentTime: 0,
        paused: true,
        volume: 1,
        muted: false,
        playbackRate: 1,
        preload: '',
        crossOrigin: '',
        onended: null,
        queueIdentity: null,
      };
      transferMediaElementState(media, replacement, {
        identityKeys: ['queueIdentity'],
      });
      return replacement;
    },
  });

  const first = await runtime.ensure(original);
  contexts[0].state = 'closed';
  const rebuilt = await runtime.ensure(original);

  assert.equal(first.media, original);
  assert.equal(rebuilt.media, replacement);
  assert.notEqual(rebuilt.media, original);
  assert.equal(contextCreates, 2);
  assert.equal(rebuilt.context, contexts[1]);
  assert.equal(rebuilt.media.src, '/current.mp3');
  assert.equal(rebuilt.media.currentTime, 42.5);
  assert.equal(rebuilt.media.paused, false);
  assert.equal(rebuilt.media.volume, 0.37);
  assert.equal(rebuilt.media.muted, true);
  assert.equal(rebuilt.media.playbackRate, 1.25);
  assert.equal(rebuilt.media.onended, endedHandler);
  assert.equal(rebuilt.media.queueIdentity, queueIdentity);
  assert.equal(runtime.snapshot().mediaCount, 1);
});
