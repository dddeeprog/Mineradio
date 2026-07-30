'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  boundedCrossfadeMs,
  createGaplessPlaybackCoordinator,
  equalPowerCrossfade,
  inferStreamSupport,
  shouldUseCrossfade,
} = require('../public/gapless-playback-state');

function media(id) {
  return {
    id,
    src: '',
    paused: true,
    released: false,
    pause() {
      this.paused = true;
    },
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
    load() {},
  };
}

test('disables crossfade for seek, manual retry, unsupported streams, local analysis, and reduced resources', () => {
  assert.equal(shouldUseCrossfade({}), true);
  for (const option of [
    { seek: true },
    { manualRetry: true },
    { supportedStream: false },
    { localAnalysis: true },
    { reducedResource: true },
  ]) {
    assert.equal(shouldUseCrossfade(option), false);
  }
});

test('derives stream support from explicit resolution, URL format, and media capability', () => {
  const mediaCapability = {
    canPlayType(type) {
      return type === 'audio/ogg' ? 'probably' : '';
    },
  };

  assert.equal(inferStreamSupport({
    data: { streamSupported: false },
    sourceUrl: 'https://cdn.example/song.mp3',
  }), false);
  assert.equal(inferStreamSupport({
    data: { supportedStream: true },
    sourceUrl: 'https://cdn.example/live.m3u8',
  }), true);
  assert.equal(inferStreamSupport({
    sourceUrl: 'https://cdn.example/song.mp3?token=one',
  }), true);
  assert.equal(inferStreamSupport({
    sourceUrl: 'https://cdn.example/live.m3u8',
  }), false);
  assert.equal(inferStreamSupport({
    data: { contentType: 'audio/ogg' },
  }, mediaCapability), true);
  assert.equal(inferStreamSupport({
    data: { contentType: 'audio/flac' },
  }, mediaCapability), false);
  assert.equal(inferStreamSupport({
    sourceUrl: 'https://cdn.example/audio-without-format',
  }), false);
});

test('feeds resolved unsupported-stream state into preload policy before creating standby media', async () => {
  let created = 0;
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia() {
      created += 1;
      return media('standby');
    },
  });
  const resolved = {
    mediaUrl: '/api/audio?url=' + encodeURIComponent('https://cdn.example/live.m3u8'),
    sourceUrl: 'https://cdn.example/live.m3u8',
    data: { streamSupported: false },
  };
  const supportedStream = inferStreamSupport(resolved);

  const result = await coordinator.preload({
    key: 'next',
    src: resolved.mediaUrl,
  }, {
    unsupportedStream: supportedStream !== true,
  });

  assert.equal(supportedStream, false);
  assert.equal(result.disabled, true);
  assert.equal(result.reason, 'unsupported-stream');
  assert.equal(created, 0);
});

test('bounds crossfade duration and produces equal-power gains', () => {
  assert.equal(boundedCrossfadeMs(-1), 80);
  assert.equal(boundedCrossfadeMs(420), 420);
  assert.equal(boundedCrossfadeMs(9000), 1200);
  assert.deepEqual(equalPowerCrossfade(0), { outgoing: 1, incoming: 0 });
  const middle = equalPowerCrossfade(0.5);
  assert.ok(Math.abs(middle.outgoing - Math.SQRT1_2) < 0.0001);
  assert.ok(Math.abs(middle.incoming - Math.SQRT1_2) < 0.0001);
  assert.deepEqual(equalPowerCrossfade(1), { outgoing: 0, incoming: 1 });
});

test('keeps at most current and one standby media while replacing preloads', async () => {
  let serial = 0;
  const created = [];
  const released = [];
  const current = media('current');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia() {
      const next = media('standby-' + (++serial));
      created.push(next);
      return next;
    },
    prepare: async value => {
      value.readyState = 4;
      return true;
    },
    release(value) {
      value.released = true;
      released.push(value.id);
    },
  });
  coordinator.setCurrent(current);

  await coordinator.preload({ key: 'one', src: '/one.mp3' });
  await coordinator.preload({ key: 'two', src: '/two.mp3' });

  assert.equal(created.length, 2);
  assert.deepEqual(released, ['standby-1']);
  assert.equal(coordinator.snapshot().mediaCount, 2);
  assert.equal(coordinator.snapshot().standbyKey, 'two');
});

test('releases standby immediately when a pending preload is cancelled', async () => {
  let finishPrepare;
  const released = [];
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia: () => media('standby'),
    prepare: () => new Promise(resolve => {
      finishPrepare = resolve;
    }),
    release(value) {
      value.released = true;
      released.push(value.id);
    },
  });
  coordinator.setCurrent(media('current'));

  const pending = coordinator.preload({ key: 'next', src: '/next.mp3' });
  coordinator.cancel('manual-track-switch');
  assert.deepEqual(released, ['standby']);
  assert.equal(coordinator.snapshot().mediaCount, 1);

  finishPrepare(true);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
});

test('hands off the prepared standby and releases outgoing media after bounded crossfade', async () => {
  const calls = [];
  const outgoing = media('outgoing');
  const incoming = media('incoming');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia: () => incoming,
    prepare: async () => true,
    async crossfade(from, to, durationMs) {
      calls.push(['crossfade', from.id, to.id, durationMs]);
    },
    release(value) {
      value.released = true;
      calls.push(['release', value.id]);
    },
  });
  coordinator.setCurrent(outgoing);
  await coordinator.preload({ key: 'next', src: '/next.mp3' });

  const result = await coordinator.handoff({ crossfadeMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.media, incoming);
  assert.equal(coordinator.snapshot().currentId, 'incoming');
  assert.equal(coordinator.snapshot().standbyKey, '');
  assert.deepEqual(calls, [
    ['crossfade', 'outgoing', 'incoming', 1200],
    ['release', 'outgoing'],
  ]);
});

test('hands off without a crossfade when the transition policy disables it', async () => {
  const calls = [];
  const outgoing = media('outgoing');
  const incoming = media('incoming');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia: () => incoming,
    prepare: async () => true,
    crossfade: async () => {
      calls.push('crossfade');
    },
    release(value) {
      calls.push('release:' + value.id);
    },
  });
  coordinator.setCurrent(outgoing);
  await coordinator.preload({ key: 'next', src: '/next.mp3' });

  const result = await coordinator.handoff({ seek: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['release:outgoing']);
});

test('can defer outgoing release until the surrounding transaction is irreversibly committed', async () => {
  const calls = [];
  const outgoing = media('outgoing');
  outgoing.src = '/outgoing.mp3';
  const incoming = media('incoming');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia: () => incoming,
    prepare: async () => true,
    async crossfade(from, to, durationMs) {
      calls.push(['crossfade', from.id, to.id, durationMs]);
    },
    release(value) {
      value.released = true;
      value.src = '';
      calls.push(['release', value.id]);
    },
  });
  coordinator.setCurrent(outgoing);
  await coordinator.preload({ key: 'next', src: '/next.mp3' });

  const result = await coordinator.handoff({
    crossfadeMs: 420,
    deferOutgoingRelease: true,
  });

  assert.equal(result.ok, true);
  assert.equal(outgoing.src, '/outgoing.mp3');
  assert.equal(outgoing.released, false);
  assert.deepEqual(calls, [
    ['crossfade', 'outgoing', 'incoming', 420],
  ]);

  assert.equal(coordinator.finalizeHandoff(result), true);
  assert.equal(outgoing.src, '');
  assert.equal(outgoing.released, true);
  assert.deepEqual(calls, [
    ['crossfade', 'outgoing', 'incoming', 420],
    ['release', 'outgoing'],
  ]);
  assert.equal(coordinator.finalizeHandoff(result), false);
});

test('does not create a third media element while a deferred handoff awaits finalization', async () => {
  let created = 0;
  const outgoing = media('outgoing');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia() {
      created += 1;
      return media('standby-' + created);
    },
    prepare: async () => true,
  });
  coordinator.setCurrent(outgoing);
  await coordinator.preload({ key: 'next', src: '/next.mp3' });
  const handoff = await coordinator.handoff({ deferOutgoingRelease: true });

  const preload = await coordinator.preload({ key: 'later', src: '/later.mp3' });

  assert.equal(handoff.ok, true);
  assert.equal(preload.ok, false);
  assert.equal(preload.disabled, true);
  assert.equal(preload.reason, 'handoff-pending-finalize');
  assert.equal(created, 1);
  assert.equal(coordinator.snapshot().mediaCount, 2);
});

test('tracks and cancels an in-flight handoff without allowing a third media element', async () => {
  let created = 0;
  let announceCrossfade;
  let finishCrossfade;
  const crossfadeStarted = new Promise(resolve => {
    announceCrossfade = resolve;
  });
  const crossfadeGate = new Promise(resolve => {
    finishCrossfade = resolve;
  });
  const released = [];
  const outgoing = media('outgoing');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia() {
      created += 1;
      return media('incoming-' + created);
    },
    prepare: async () => true,
    async crossfade() {
      announceCrossfade();
      await crossfadeGate;
    },
    release(value, reason) {
      released.push([value.id, reason]);
    },
  });
  coordinator.setCurrent(outgoing);
  await coordinator.preload({ key: 'next', src: '/next.mp3' });

  const handoffPromise = coordinator.handoff({ crossfadeMs: 600 });
  await crossfadeStarted;
  const during = coordinator.snapshot();
  const preload = await coordinator.preload({ key: 'later', src: '/later.mp3' });
  const cancelled = coordinator.cancel('user-cancelled');
  const afterCancel = coordinator.snapshot();
  finishCrossfade();
  const handoff = await handoffPromise;

  assert.equal(during.currentId, 'outgoing');
  assert.equal(during.handoffInFlight, true);
  assert.equal(during.handoffOutgoingId, 'outgoing');
  assert.equal(during.handoffIncomingId, 'incoming-1');
  assert.equal(during.mediaCount, 2);
  assert.deepEqual(preload, {
    ok: false,
    disabled: true,
    reason: 'handoff-in-flight',
  });
  assert.equal(created, 1);
  assert.equal(cancelled, true);
  assert.equal(afterCancel.currentId, 'outgoing');
  assert.equal(afterCancel.handoffInFlight, false);
  assert.equal(afterCancel.mediaCount, 1);
  assert.equal(handoff.ok, false);
  assert.equal(handoff.cancelled, true);
  assert.equal(handoff.reason, 'handoff-cancelled');
  assert.deepEqual(released, [['incoming-1', 'user-cancelled']]);
});

test('claims a ready standby for a transaction without releasing it', async () => {
  const released = [];
  const incoming = media('incoming');
  const coordinator = createGaplessPlaybackCoordinator({
    createMedia: () => incoming,
    prepare: async () => true,
    release(value) {
      released.push(value.id);
    },
  });
  coordinator.setCurrent(media('outgoing'));
  await coordinator.preload({ key: 'next', src: '/next.mp3' });

  assert.equal(coordinator.claim('wrong'), null);
  const claimed = coordinator.claim('next');
  assert.equal(claimed, incoming);
  assert.equal(coordinator.snapshot().standbyKey, '');
  assert.equal(coordinator.snapshot().mediaCount, 1);
  assert.deepEqual(released, []);
});
