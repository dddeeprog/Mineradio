'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyPlaybackResolution,
  capturePlaybackState,
  createPlaybackTransactionManager,
  playbackProviderCandidates,
  restorePlaybackState,
} = require('../public/playback-transaction');

function fullPlaybackState() {
  const graph = {
    context: { id: 'ctx-1' },
    source: { id: 'source-1' },
    analyser: { id: 'analyser-1' },
    beatAnalyser: { id: 'beat-1' },
    gainNode: { id: 'gain-1' },
    media: { id: 'media-1' },
  };
  return {
    queue: [
      { provider: 'netease', id: 'old', name: 'Still Playing' },
      { provider: 'qq', mid: 'next', name: 'Next Song' },
    ],
    index: 0,
    song: { provider: 'netease', id: 'old', name: 'Still Playing' },
    progress: { currentTime: 73.25, duration: 210, paused: false },
    volume: { target: 0.68, media: 1, muted: false },
    ui: { title: 'Still Playing', artist: 'Original Artist', loading: false },
    lyrics: { lines: [{ time: 0, text: 'old lyric' }], visible: true, source: 'native' },
    beat: { map: { kicks: [1, 2] }, cursor: 1, pulse: 0.4 },
    audioGraph: graph,
  };
}

test('commits through the exact transactional playback state sequence', async () => {
  let state = fullPlaybackState();
  const manager = createPlaybackTransactionManager({
    capture: () => capturePlaybackState(state),
    restore: snapshot => {
      state = restorePlaybackState({}, snapshot);
    },
  });

  const result = await manager.execute({
    resolve: async () => ({ url: '/new.mp3' }),
    prepare: async resolved => ({ ...resolved, media: { id: 'standby' } }),
    confirm: async prepared => prepared.media.id === 'standby',
    commit: async prepared => {
      state.index = 1;
      state.song = state.queue[1];
      state.progress = { currentTime: 0, duration: 190, paused: false };
      state.ui = { title: state.song.name, artist: 'Next Artist', loading: false };
      state.audioGraph = { ...state.audioGraph, media: prepared.media };
      return state.song;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'committed');
  assert.deepEqual(result.history, [
    'idle',
    'snapshot',
    'resolving',
    'preparing',
    'confirming',
    'committed',
  ]);
  assert.equal(state.index, 1);
  assert.equal(state.audioGraph.media.id, 'standby');
});

test('rolls back queue, index, song, progress, volume, UI, lyrics, beat, and graph', async () => {
  const original = fullPlaybackState();
  let state = original;
  const before = capturePlaybackState(original);
  const originalContext = original.audioGraph.context;
  const originalMedia = original.audioGraph.media;
  const manager = createPlaybackTransactionManager({
    capture: () => capturePlaybackState(state),
    restore: snapshot => {
      state = restorePlaybackState({}, snapshot);
    },
  });

  const result = await manager.execute({
    resolve: async () => ({ url: '/broken.mp3' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => {
      state.queue = [{ id: 'mutated' }];
      state.index = 9;
      state.song = { id: 'mutated' };
      state.progress = { currentTime: 0 };
      state.volume = { target: 0 };
      state.ui = { title: 'mutated' };
      state.lyrics = { lines: [] };
      state.beat = { map: null };
      state.audioGraph = { context: { id: 'wrong' } };
      throw new Error('confirmation lost');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.retained, true);
  assert.equal(result.state, 'rolled-back');
  assert.deepEqual(result.history.slice(-2), ['rolling-back', 'rolled-back']);
  assert.deepEqual(capturePlaybackState(state), before);
  assert.equal(state.audioGraph.context, originalContext);
  assert.equal(state.audioGraph.media, originalMedia);
});

test('cancels a stale resolve without fabricating a prepared resource to release', async () => {
  let resolveFirst;
  let released = 0;
  const state = fullPlaybackState();
  const manager = createPlaybackTransactionManager({
    capture: () => capturePlaybackState(state),
    restore: () => {},
  });

  const first = manager.execute({
    resolve: () => new Promise(resolve => {
      resolveFirst = resolve;
    }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => {
      throw new Error('stale attempt committed');
    },
    release: () => {
      released += 1;
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveFirst, 'function');

  const second = manager.execute({
    resolve: async () => ({ url: '/current.mp3' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => 'current',
  });

  resolveFirst({ url: '/stale.mp3' });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, 'cancelled');
  assert.equal(firstResult.stale, true);
  assert.equal(secondResult.state, 'committed');
  assert.equal(released, 0);
});

test('superseding a pending prepare starts the next request and releases the late resource once', async () => {
  let finishPrepare;
  let announcePrepare;
  const prepareStarted = new Promise(resolve => {
    announcePrepare = resolve;
  });
  const prepareGate = new Promise(resolve => {
    finishPrepare = resolve;
  });
  const released = [];
  const manager = createPlaybackTransactionManager({
    capture: () => ({ index: 0 }),
  });

  const first = manager.execute({
    resolve: async () => ({ id: 'first' }),
    prepare: async () => {
      announcePrepare();
      return prepareGate;
    },
    confirm: async () => true,
    commit: async () => 'first',
    release: prepared => {
      released.push(prepared && prepared.id || null);
    },
  });
  await prepareStarted;

  const second = manager.execute({
    resolve: async () => ({ id: 'second' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => 'second',
  });
  const winner = await Promise.race([
    second.then(() => 'second'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 40)),
  ]);

  const latePrepared = { id: 'late-first' };
  finishPrepare(latePrepared);
  const [firstResult, secondResult] = await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(winner, 'second');
  assert.equal(firstResult.state, 'cancelled');
  assert.equal(secondResult.state, 'committed');
  assert.deepEqual(released, ['late-first']);
});

test('releases a registered in-flight resource immediately without waiting for prepare', async () => {
  let finishPrepare;
  let announcePrepare;
  const prepareStarted = new Promise(resolve => {
    announcePrepare = resolve;
  });
  const prepareGate = new Promise(resolve => {
    finishPrepare = resolve;
  });
  const prepared = { id: 'registered-first' };
  const released = [];
  const manager = createPlaybackTransactionManager({
    capture: () => ({ index: 0 }),
  });

  const first = manager.execute({
    resolve: async () => ({ id: 'first' }),
    prepare: async (resolved, attempt) => {
      announcePrepare();
      attempt.registerPrepared(prepared);
      await prepareGate;
      return prepared;
    },
    confirm: async () => true,
    commit: async () => 'first',
    release: resource => {
      released.push(resource.id);
    },
  });
  await prepareStarted;

  const second = manager.execute({
    resolve: async () => ({ id: 'second' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => 'second',
  });
  const secondResult = await second;

  assert.equal(secondResult.state, 'committed');
  assert.deepEqual(released, ['registered-first']);
  finishPrepare();
  const firstResult = await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(firstResult.state, 'cancelled');
  assert.deepEqual(released, ['registered-first']);
});

test('rolls back a cancelled in-flight commit before the next attempt snapshots', async () => {
  let state = fullPlaybackState();
  let announceCommit;
  let finishCommit;
  const commitStarted = new Promise(resolve => {
    announceCommit = resolve;
  });
  const commitGate = new Promise(resolve => {
    finishCommit = resolve;
  });
  const manager = createPlaybackTransactionManager({
    capture: () => capturePlaybackState(state),
    restore: snapshot => {
      state = restorePlaybackState({}, snapshot);
    },
  });

  const first = manager.execute({
    resolve: async () => ({ url: '/first.mp3' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => {
      state.index = 1;
      state.song = state.queue[1];
      announceCommit();
      await commitGate;
    },
  });
  await commitStarted;

  const second = manager.execute({
    resolve: async () => {
      const error = new Error('second source failed');
      error.code = 'PLAYBACK_SOURCES_EXHAUSTED';
      throw error;
    },
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => {},
  });
  finishCommit();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, 'cancelled');
  assert.equal(secondResult.state, 'rolled-back');
  assert.equal(state.index, 0);
  assert.equal(state.song.id, 'old');
});

test('commit cancellation promise releases the serial queue without waiting for a throttled timer', async () => {
  let announceCommit;
  const commitStarted = new Promise(resolve => {
    announceCommit = resolve;
  });
  const manager = createPlaybackTransactionManager({
    capture: () => ({ index: 0 }),
    restore: async () => {},
  });
  const first = manager.execute({
    resolve: async () => ({ id: 'first' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async (prepared, attempt) => {
      announceCommit();
      if (attempt.whenCancelled) {
        await attempt.whenCancelled;
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const error = new Error('first commit cancelled');
      error.code = 'PLAYBACK_ATTEMPT_STALE';
      throw error;
    },
  });
  await commitStarted;

  const startedAt = Date.now();
  const second = manager.execute({
    resolve: async () => ({ id: 'second' }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => 'second',
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(firstResult.state, 'cancelled');
  assert.equal(secondResult.state, 'committed');
  assert.equal(secondResult.value, 'second');
  assert.ok(elapsedMs < 200, `second request waited ${elapsedMs}ms`);
});

test('queues a new execute while the active attempt is rolling back', async () => {
  let announceRollback;
  let finishRollback;
  const rollbackStarted = new Promise(resolve => {
    announceRollback = resolve;
  });
  const rollbackGate = new Promise(resolve => {
    finishRollback = resolve;
  });
  const manager = createPlaybackTransactionManager({
    capture: () => ({ index: 0 }),
    restore: async () => {
      announceRollback();
      await rollbackGate;
    },
  });

  const first = manager.execute({
    resolve: async () => {
      throw new Error('first source failed');
    },
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async () => 'first',
  });
  await rollbackStarted;

  let second;
  assert.doesNotThrow(() => {
    second = manager.execute({
      resolve: async () => ({ url: '/second.mp3' }),
      prepare: async resolved => resolved,
      confirm: async () => true,
      commit: async () => 'second',
    });
  });
  assert.equal(manager.snapshot().state, 'rolling-back');
  finishRollback();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.state, 'rolled-back');
  assert.equal(secondResult.state, 'committed');
  assert.equal(secondResult.value, 'second');
});

test('rapid switching never finalizes a stale commit before the winning media is committed', async () => {
  const oldMedia = { id: 'old', src: '/old.mp3' };
  const firstMedia = { id: 'first', src: '/first.mp3' };
  const secondMedia = { id: 'second', src: '/second.mp3' };
  let activeMedia = oldMedia;
  let announceFirstCommit;
  let finishFirstCommit;
  let oldSrcSeenBySecond = '';
  const finalizations = [];
  const firstCommitStarted = new Promise(resolve => {
    announceFirstCommit = resolve;
  });
  const firstCommitGate = new Promise(resolve => {
    finishFirstCommit = resolve;
  });
  const manager = createPlaybackTransactionManager({
    capture: () => ({ media: activeMedia }),
    restore: snapshot => {
      activeMedia = snapshot.media;
    },
  });

  const first = manager.execute({
    resolve: async () => ({ media: firstMedia }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async (prepared, attempt) => {
      activeMedia = prepared.media;
      announceFirstCommit();
      await firstCommitGate;
      assert.equal(attempt.isCurrent(), false);
      const error = new Error('stale first commit');
      error.code = 'PLAYBACK_ATTEMPT_STALE';
      throw error;
    },
    finalize: async () => {
      finalizations.push('first');
      oldMedia.src = '';
    },
    release: prepared => {
      if (prepared && prepared.media) prepared.media.src = '';
    },
  });
  await firstCommitStarted;

  const second = manager.execute({
    resolve: async () => ({ media: secondMedia }),
    prepare: async resolved => resolved,
    confirm: async () => true,
    commit: async (prepared, attempt) => {
      assert.equal(attempt.isCurrent(), true);
      oldSrcSeenBySecond = oldMedia.src;
      activeMedia = prepared.media;
      return { previousMedia: oldMedia };
    },
    finalize: async value => {
      finalizations.push('second');
      value.previousMedia.src = '';
    },
  });

  assert.equal(oldMedia.src, '/old.mp3');
  finishFirstCommit();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.state, 'cancelled');
  assert.equal(secondResult.state, 'committed');
  assert.equal(activeMedia, secondMedia);
  assert.equal(firstMedia.src, '');
  assert.equal(oldSrcSeenBySecond, '/old.mp3');
  assert.deepEqual(finalizations, ['second']);
  assert.equal(oldMedia.src, '');
});

test('derives playback candidates only from currently available capabilities', () => {
  const candidates = playbackProviderCandidates({
    provider: 'kugou',
    sourceId: 'kg-catalog-id',
    name: 'Same Song',
  }, {
    providers: [
      {
        provider: 'kugou',
        capabilities: { playback: false },
        availability: { playback: false },
      },
      {
        provider: 'qq',
        capabilities: { playback: true },
        availability: { playback: true },
      },
      {
        provider: 'netease',
        capabilities: { playback: true },
        availability: { playback: false },
      },
      {
        provider: 'future-provider',
        capabilities: { playback: true },
        availability: { playback: true },
      },
    ],
  });

  assert.deepEqual(candidates.map(item => item.playbackProvider), [
    'qq',
    'future-provider',
  ]);
  assert.ok(candidates.every(item => item.resolutionMode === 'matched-provider'));
  assert.ok(candidates.every(item => item.catalogProvider === 'kugou'));
  assert.ok(candidates.every(item => item.catalogSourceId === 'kg-catalog-id'));
});

test('preserves catalog metadata separately from a matched playback provider', () => {
  const resolved = applyPlaybackResolution({
    provider: 'spotify',
    source: 'spotify',
    sourceId: 'spotify-track',
    id: 'spotify-track',
    name: 'Catalog Title',
    artist: 'Catalog Artist',
    cover: 'catalog-cover.jpg',
  }, {
    catalogProvider: 'spotify',
    catalogSourceId: 'spotify-track',
    playbackProvider: 'netease',
    resolutionMode: 'matched-provider',
  }, {
    provider: 'netease',
    id: 'netease-match',
    name: 'Catalog Title',
    artist: 'Catalog Artist',
    cover: 'matched-cover.jpg',
  });

  assert.equal(resolved.provider, 'spotify');
  assert.equal(resolved.id, 'spotify-track');
  assert.equal(resolved.cover, 'catalog-cover.jpg');
  assert.equal(resolved.catalogProvider, 'spotify');
  assert.equal(resolved.catalogSourceId, 'spotify-track');
  assert.equal(resolved.playbackProvider, 'netease');
  assert.equal(resolved.playbackSourceId, 'netease-match');
  assert.equal(resolved.resolutionMode, 'matched-provider');
});

test('uses the matched media id even when the playback record carries catalog fields', () => {
  const resolved = applyPlaybackResolution({
    provider: 'spotify',
    id: 'catalog-track',
    name: 'Catalog Title',
  }, {
    catalogProvider: 'spotify',
    catalogSourceId: 'catalog-track',
    playbackProvider: 'netease',
    resolutionMode: 'matched-provider',
  }, {
    provider: 'netease',
    id: 'matched-track',
    catalogProvider: 'spotify',
    catalogSourceId: 'catalog-track',
  });

  assert.equal(resolved.catalogSourceId, 'catalog-track');
  assert.equal(resolved.playbackSourceId, 'matched-track');
});

test('uses the current provider identity when returning from a QQ match to Netease catalog playback', () => {
  const catalogSong = {
    provider: 'netease',
    source: 'netease',
    id: 'netease-catalog-id',
    mid: 'stale-qq-mid',
    playbackProvider: 'qq',
    playbackSourceId: 'stale-qq-playback-id',
    resolutionMode: 'matched-provider',
    name: 'Catalog Title',
  };
  const resolved = applyPlaybackResolution(catalogSong, {
    catalogProvider: 'netease',
    catalogSourceId: 'netease-catalog-id',
    playbackProvider: 'netease',
    resolutionMode: 'catalog',
  }, {
    ...catalogSong,
    provider: 'netease',
    source: 'netease',
  });

  assert.equal(resolved.playbackProvider, 'netease');
  assert.equal(resolved.playbackSourceId, 'netease-catalog-id');
  assert.equal(resolved.resolutionMode, 'catalog');
});

test('retains current playback when every source fails', async () => {
  let state = fullPlaybackState();
  const before = capturePlaybackState(state);
  const manager = createPlaybackTransactionManager({
    capture: () => capturePlaybackState(state),
    restore: snapshot => {
      state = restorePlaybackState({}, snapshot);
    },
  });

  const result = await manager.execute({
    resolve: async () => {
      const error = new Error('all providers failed');
      error.code = 'PLAYBACK_SOURCES_EXHAUSTED';
      throw error;
    },
    prepare: async () => {
      throw new Error('must not prepare');
    },
    confirm: async () => true,
    commit: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.retained, true);
  assert.equal(result.error.code, 'PLAYBACK_SOURCES_EXHAUSTED');
  assert.deepEqual(capturePlaybackState(state), before);
});
