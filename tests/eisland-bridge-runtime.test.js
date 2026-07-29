const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createEislandBridgeTransitionGate,
  createEislandBridgeRuntime,
} = require('../public/eisland-bridge-runtime');

test('acks_with_post_execution_snapshot', async () => {
  const trace = [];
  const published = [];
  const receipts = [];
  const pauseListeners = new Set();
  let releasePause;
  const audio = {
    currentTime: 9,
    duration: 90,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener(eventName, listener) {
      if (eventName === 'pause') pauseListeners.add(listener);
    },
    removeEventListener(eventName, listener) {
      if (eventName === 'pause') pauseListeners.delete(listener);
    },
  };
  const player = {
    audio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [{ t: 0, text: '真实歌词' }],
    playQueue: [{ id: 77, name: '回执歌曲', artist: '歌手', duration: 90_000 }],
    trackSwitchToken: 77,
    pause() {
      trace.push('pause');
      return new Promise((resolve) => {
        releasePause = () => {
          audio.paused = true;
          for (const listener of [...pauseListeners]) listener();
          resolve();
        };
      });
    },
  };
  const runtime = createEislandBridgeRuntime({
    getPlayer: () => player,
    publishState(snapshot) {
      trace.push({ type: 'state', snapshot });
      published.push(snapshot);
    },
    completeCommand(receipt) {
      trace.push({ type: 'receipt', receipt });
      receipts.push(receipt);
    },
  });

  const pending = runtime.handleCommand({
    attempt: 'attempt-3',
    command: 'pause',
    requestId: 'post-snapshot',
  });
  let completed = false;
  pending.then(() => { completed = true; });
  assert.deepEqual(trace, ['pause']);
  await Promise.resolve();
  assert.equal(completed, false);

  releasePause();
  const snapshot = await pending;
  assert.equal(snapshot.state.playback.status, 'paused');
  assert.deepEqual(trace.map((entry) => typeof entry === 'string' ? entry : entry.type), [
    'pause',
    'state',
    'receipt',
  ]);
  assert.strictEqual(published[0], snapshot);
  assert.equal(published[0].commandAttempt, 'attempt-3');
  assert.deepEqual(receipts, [{
    attempt: 'attempt-3',
    ok: true,
    requestId: 'post-snapshot',
    result: {
      accepted: true,
      state: snapshot.state,
      track: snapshot.track,
    },
  }]);
});

test('awaits_next_previous_and_seek_before_ack', async () => {
  const calls = [];
  const timers = [];
  const listeners = new Map();
  let resolveNext;
  let resolvePrevious;
  const audio = {
    currentTime: 5,
    duration: 120,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
    },
    removeEventListener(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
  };
  const player = {
    audio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    playQueue: [
      { id: 11, name: '前一首', artist: '歌手', duration: 120_000 },
      { id: 12, name: '后一首', artist: '歌手', duration: 120_000 },
    ],
    trackSwitchToken: 11,
    nextTrack() {
      calls.push('next');
      return new Promise((resolve) => {
        resolveNext = () => {
          player.currentIdx = 1;
          resolve(true);
        };
      });
    },
    prevTrack() {
      calls.push('previous');
      return new Promise((resolve) => {
        resolvePrevious = () => {
          player.currentIdx = 0;
          resolve(true);
        };
      });
    },
  };
  const runtime = createEislandBridgeRuntime({
    getPlayer: () => player,
    setTimeoutFn(callback, delay) {
      const timer = { callback, cleared: false, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
  });
  const emitAudioEvent = (eventName) => {
    for (const listener of [...(listeners.get(eventName) || [])]) listener();
  };

  const nextPending = runtime.executeCommand({ command: 'next' });
  let nextCompleted = false;
  nextPending.then(() => { nextCompleted = true; }, () => {});
  assert.deepEqual(calls, ['next']);
  await Promise.resolve();
  assert.equal(nextCompleted, false);
  resolveNext();
  const nextSnapshot = await nextPending;
  assert.equal(nextSnapshot.track.id, 'netease:12');

  const previousPending = runtime.executeCommand({ command: 'previous' });
  let previousCompleted = false;
  previousPending.then(() => { previousCompleted = true; }, () => {});
  assert.deepEqual(calls, ['next', 'previous']);
  await Promise.resolve();
  assert.equal(previousCompleted, false);
  resolvePrevious();
  const previousSnapshot = await previousPending;
  assert.equal(previousSnapshot.track.id, 'netease:11');

  const seekPending = runtime.executeCommand({ command: 'seek', payload: { positionMs: 15_000 } });
  let seekCompleted = false;
  seekPending.then(() => { seekCompleted = true; }, () => {});
  assert.equal(audio.currentTime, 15);
  assert.equal(timers[timers.length - 1].delay, 1_500);
  await Promise.resolve();
  assert.equal(seekCompleted, false);
  emitAudioEvent('seeked');
  const seekSnapshot = await seekPending;
  assert.equal(seekSnapshot.state.playback.positionMs, 15_000);
  assert.equal(timers[timers.length - 1].cleared, true);
  assert.equal(listeners.get('seeked').size, 0);

  player.nextTrack = () => Promise.reject(new Error('queue unavailable'));
  await assert.rejects(
    runtime.executeCommand({ command: 'next' }),
    (error) => error.code === 'track-change-failed' && /next track/.test(error.message),
  );

  const timedOutSeek = runtime.executeCommand({ command: 'seek', payload: { positionMs: 16_000 } });
  timers[timers.length - 1].callback();
  await assert.rejects(
    timedOutSeek,
    (error) => error.code === 'seek-timeout' && /seeked/.test(error.message),
  );
  assert.equal(listeners.get('seeked').size, 0);

  let emptyNextCalls = 0;
  const emptyQueueRuntime = createEislandBridgeRuntime({
    getPlayer: () => ({
      audio: { currentTime: 0, duration: 30, playbackRate: 1, paused: false, ended: false },
      currentIdx: -1,
      currentLocalSong: null,
      lyricsLines: [],
      nextTrack() {
        emptyNextCalls += 1;
        return Promise.resolve(false);
      },
      playQueue: [],
      trackSwitchToken: 0,
    }),
  });
  await assert.rejects(
    emptyQueueRuntime.executeCommand({ command: 'next' }),
    (error) => error.code === 'queue-empty' && /queue is empty/.test(error.message),
  );
  assert.equal(emptyNextCalls, 0);
});

test('executes_play_pause_and_toggle_idempotently', async () => {
  const calls = [];
  let firstPlay = true;
  let resolveFirstPlay;
  const pauseListeners = new Set();
  const audio = {
    currentTime: 0,
    duration: 120,
    playbackRate: 1,
    paused: false,
    ended: false,
    addEventListener(eventName, listener) {
      if (eventName === 'pause') pauseListeners.add(listener);
    },
    removeEventListener(eventName, listener) {
      if (eventName === 'pause') pauseListeners.delete(listener);
    },
  };
  const player = {
    audio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    playQueue: [{ id: 8, name: '命令歌曲', artist: '歌手', duration: 120_000 }],
    trackSwitchToken: 8,
    play() {
      calls.push('play');
      if (firstPlay) {
        firstPlay = false;
        return new Promise((resolve) => {
          resolveFirstPlay = () => {
            audio.paused = false;
            resolve();
          };
        });
      }
      audio.paused = false;
      return Promise.resolve();
    },
    pause: async () => {
      calls.push('pause');
      audio.paused = true;
      for (const listener of [...pauseListeners]) listener();
    },
  };
  const runtime = createEislandBridgeRuntime({ getPlayer: () => player });

  const alreadyPlaying = await runtime.executeCommand({ command: 'play' });
  assert.deepEqual(calls, []);
  assert.equal(alreadyPlaying.state.playback.status, 'playing');

  audio.paused = true;
  const playPending = runtime.executeCommand({ command: 'play' });
  let playCompleted = false;
  playPending.then(() => { playCompleted = true; });
  assert.deepEqual(calls, ['play']);
  await Promise.resolve();
  assert.equal(playCompleted, false);
  resolveFirstPlay();
  const played = await playPending;
  assert.equal(played.state.playback.status, 'playing');

  await runtime.executeCommand({ command: 'play' });
  assert.deepEqual(calls, ['play']);

  const paused = await runtime.executeCommand({ command: 'pause' });
  assert.equal(paused.state.playback.status, 'paused');
  assert.deepEqual(calls, ['play', 'pause']);
  await runtime.executeCommand({ command: 'pause' });
  assert.deepEqual(calls, ['play', 'pause']);

  await runtime.executeCommand({ command: 'toggle' });
  assert.equal(audio.paused, false);
  await runtime.executeCommand({ command: 'toggle' });
  assert.equal(audio.paused, true);
  assert.deepEqual(calls, ['play', 'pause', 'play', 'pause']);
});

test('projects_complete_state_and_full_lyrics_without_fake_track', () => {
  const player = {
    audio: {
      currentTime: 12.5,
      duration: 245.6,
      playbackRate: 1.25,
      paused: false,
      ended: false,
    },
    currentIdx: 0,
    currentLocalSong: null,
    playQueue: [{
      id: 42,
      type: 'netease',
      name: '真实歌曲',
      artist: '真实歌手',
      album: '真实专辑',
      cover: 'https://cdn.example.test/cover.jpg',
      duration: 245_600,
      url: 'https://secret.example.test/audio.mp3',
      cookie: 'must-not-leak',
    }],
    lyricsLines: [
      { t: 0, text: '第一句', translation: 'First line' },
      { t: 10, text: '第二句', translation: 'Second line', duration: 3.2 },
    ],
    trackSwitchToken: 7,
  };
  const runtime = createEislandBridgeRuntime({
    getPlayer: () => player,
  });

  const snapshot = runtime.createSnapshot();

  assert.deepEqual(snapshot.state, {
    playback: {
      durationMs: 245_600,
      positionMs: 12_500,
      rate: 1.25,
      status: 'playing',
    },
    capabilities: {
      next: true,
      pause: true,
      play: true,
      previous: true,
      seek: true,
    },
  });
  assert.deepEqual(snapshot.track, {
    id: 'netease:42',
    source: 'netease',
    title: '真实歌曲',
    artist: '真实歌手',
    album: '真实专辑',
    coverUrl: 'https://cdn.example.test/cover.jpg',
    durationMs: 245_600,
  });
  assert.deepEqual(snapshot.lyrics, {
    trackId: 'netease:42',
    status: 'ready',
    lines: [
      { startMs: 0, endMs: 10_000, text: '第一句', translation: 'First line' },
      { startMs: 10_000, endMs: 13_200, text: '第二句', translation: 'Second line' },
    ],
  });
  assert.equal(JSON.stringify(snapshot).includes('secret.example.test'), false);
  assert.equal(JSON.stringify(snapshot).includes('must-not-leak'), false);

  player.currentIdx = -1;
  const noTrackSnapshot = runtime.createSnapshot();
  assert.equal(noTrackSnapshot.track, null);
  assert.deepEqual(noTrackSnapshot.state, {
    playback: {
      durationMs: 0,
      positionMs: 0,
      rate: 1.25,
      status: 'stopped',
    },
    capabilities: {
      next: true,
      pause: false,
      play: false,
      previous: true,
      seek: false,
    },
  });
  assert.deepEqual(noTrackSnapshot.lyrics, {
    trackId: null,
    status: 'unavailable',
    lines: [],
  });
});

test('exposes only safe HTTPS cover image URLs', () => {
  const coverFor = (cover) => createEislandBridgeRuntime({
    getPlayer: () => ({
      audio: { currentTime: 0, duration: 60, ended: false, paused: true, playbackRate: 1 },
      currentIdx: 0,
      currentLocalSong: null,
      lyricsLines: [],
      playQueue: [{ artist: '歌手', cover, id: 1, name: '封面测试', duration: 60 }],
      trackSwitchToken: 1,
    }),
  }).createSnapshot().track.coverUrl;
  assert.equal(coverFor('http://image.example/cover.jpg'), undefined);
  assert.equal(coverFor('https://user:password@image.example/cover.jpg'), undefined);
  assert.equal(coverFor('https://image.example/cover.jpg?token=secret'), undefined);
  assert.equal(coverFor('https://audio.example/stream/song.mp3'), undefined);
  assert.equal(
    coverFor('https://image.example/cover.webp?width=320'),
    'https://image.example/cover.webp?width=320',
  );
});
test('publishes_events_at_250ms_and_heartbeat_at_1000ms', () => {
  let now = 0;
  const publishedStates = [];
  const heartbeats = [];
  const intervals = [];
  const player = {
    audio: { currentTime: 3, duration: 60, playbackRate: 1, paused: false, ended: false },
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    playQueue: [{ id: 1, name: '节流歌曲', artist: '歌手', duration: 60_000 }],
    trackSwitchToken: 1,
  };
  const runtime = createEislandBridgeRuntime({
    getPlayer: () => player,
    now: () => now,
    publishHeartbeat: (snapshot) => heartbeats.push(snapshot),
    publishState: (snapshot) => publishedStates.push(snapshot),
    setIntervalFn(callback, delay) {
      const timer = { callback, delay, cleared: false };
      intervals.push(timer);
      return timer;
    },
    clearIntervalFn(timer) {
      timer.cleared = true;
    },
  });

  assert.equal(runtime.start(), true);
  assert.equal(publishedStates.length, 1);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 1_000);

  now = 1;
  assert.equal(runtime.publishPlayerEvent('timeupdate'), true);
  now = 249;
  assert.equal(runtime.publishPlayerEvent('timeupdate'), false);
  assert.equal(runtime.publishPlayerEvent('play'), true);
  now = 251;
  assert.equal(runtime.publishPlayerEvent('timeupdate'), true);
  assert.equal(publishedStates.length, 4);

  intervals[0].callback();
  intervals[0].callback();
  assert.equal(heartbeats.length, 2);
  assert.deepEqual(heartbeats[0], heartbeats[1]);
  assert.equal(Object.hasOwn(heartbeats[0], 'revision'), false);
  assert.equal(Object.hasOwn(heartbeats[0], 'updatedAtMs'), false);

  assert.equal(runtime.stop(), true);
  assert.equal(intervals[0].cleared, true);
});

test('uses source-specific seconds and milliseconds for long playback data', async () => {
  const listeners = new Map();
  const timers = [];
  const audio = {
    currentTime: 1_201.25,
    duration: 1_800,
    ended: false,
    paused: false,
    playbackRate: 1,
    addEventListener(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
    },
    removeEventListener(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
  };
  const player = {
    audio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [{ duration: 15, t: 1_200, text: '二十分钟后的第一句' }],
    playQueue: [{
      artist: '歌手',
      duration: 1_800,
      id: 1_800,
      name: '三十分钟歌曲',
    }],
    trackSwitchToken: 1_800,
  };
  const runtime = createEislandBridgeRuntime({
    clearTimeoutFn(timer) { timer.cleared = true; },
    getPlayer: () => player,
    setTimeoutFn(callback, delay) {
      const timer = { callback, cleared: false, delay };
      timers.push(timer);
      return timer;
    },
  });
  const emit = (eventName) => {
    for (const listener of [...(listeners.get(eventName) || [])]) listener();
  };
  const secondsSnapshot = runtime.createSnapshot();
  assert.equal(secondsSnapshot.track.durationMs, 1_800_000);
  assert.equal(secondsSnapshot.state.playback.durationMs, 1_800_000);
  assert.equal(secondsSnapshot.state.playback.positionMs, 1_201_250);
  assert.deepEqual(secondsSnapshot.lyrics.lines, [{
    endMs: 1_215_000,
    startMs: 1_200_000,
    text: '二十分钟后的第一句',
  }]);
  player.audio = null;
  player.playQueue[0] = {
    artist: '歌手',
    durationMs: 1_799_000,
    id: 1_799,
    name: '明确毫秒时长',
  };
  player.lyricsLines = [{ endMs: 1_222_000, startMs: 1_215_000, text: '明确毫秒歌词' }];
  const millisecondSnapshot = runtime.createSnapshot();
  assert.equal(millisecondSnapshot.track.durationMs, 1_799_000);
  assert.deepEqual(millisecondSnapshot.lyrics.lines, [{
    endMs: 1_222_000,
    startMs: 1_215_000,
    text: '明确毫秒歌词',
  }]);
  player.audio = audio;
  const seekPending = runtime.executeCommand({
    command: 'seek',
    payload: { positionMs: 1_799_999 },
  });
  assert.equal(audio.currentTime, 1_799.999);
  assert.equal(timers.at(-1).delay, 1_500);
  emit('seeked');
  const seekSnapshot = await seekPending;
  assert.equal(seekSnapshot.state.playback.positionMs, 1_799_999);
});
test('suppresses transition snapshots through concurrent completion and safe failure', () => {
  const gate = createEislandBridgeTransitionGate();
  const heartbeats = [];
  const intervals = [];
  const states = [];
  const oldAudio = { _mineradioBridgeTrackToken: 1, currentTime: 7, duration: 80, ended: false, paused: false, playbackRate: 1 };
  const player = {
    audio: oldAudio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [{ t: 0, text: '旧歌词' }],
    playQueue: [
      { id: 1, name: '旧曲', artist: '歌手', duration: 80_000 },
      { id: 2, name: '新曲', artist: '歌手', duration: 210_000 },
    ],
    trackSwitchToken: 1,
  };
  const runtime = createEislandBridgeRuntime({
    clearIntervalFn(timer) { timer.cleared = true; },
    getPlayer: () => Object.assign({}, player, {
      bridgeTransitionFailed: gate.getState().failed,
      bridgeTransitionPending: gate.getState().pending,
    }),
    publishHeartbeat(snapshot) { heartbeats.push(snapshot); },
    publishState(snapshot) { states.push(snapshot); },
    setIntervalFn(callback) {
      const timer = { callback, cleared: false };
      intervals.push(timer);
      return timer;
    },
  });

  assert.equal(runtime.start(), true);
  assert.equal(states.length, 1);
  assert.equal(gate.begin(10), true);
  player.currentIdx = 1;
  player.trackSwitchToken = 10;
  assert.equal(runtime.publishPlayerEvent('pause'), false);
  intervals[0].callback();
  assert.equal(states.length, 1);
  assert.equal(heartbeats.length, 0);

  assert.equal(gate.begin(11), true);
  assert.equal(gate.complete(10), false);
  assert.equal(gate.fail(10), false);
  assert.equal(runtime.publishPlayerEvent('lyrics'), false);
  assert.equal(gate.fail(11), true);
  assert.equal(runtime.publishPlayerEvent('trackchange'), true);
  const failed = states.at(-1);
  assert.equal(failed.track, null);
  assert.equal(failed.state.playback.status, 'stopped');
  assert.equal(failed.state.playback.positionMs, 0);

  player.trackSwitchToken = 11;
  assert.equal(gate.recover(11), true);
  assert.equal(runtime.publishPlayerEvent('play'), false);
  player.audio = { _mineradioBridgeTrackToken: 11, currentTime: 12, duration: 210, ended: false, paused: false, playbackRate: 1 };
  player.lyricsLines = [{ t: 0, text: '新歌词' }];
  assert.equal(runtime.publishPlayerEvent('play'), true);
  const recovered = states.at(-1);
  assert.equal(recovered.track.id, 'netease:2');
  player.trackSwitchToken = 12;
  assert.equal(gate.begin(12), true);
  assert.equal(runtime.publishPlayerEvent('play'), false);
  player.audio._mineradioBridgeTrackToken = 12;
  assert.equal(gate.complete(12), true);
  assert.equal(runtime.publishPlayerEvent('trackchange'), true);
  const ready = states.at(-1);
  assert.equal(ready.track.id, 'netease:2');
  assert.deepEqual(ready.lyrics.lines, [{ startMs: 0, text: '新歌词' }]);

  intervals[0].callback();
  assert.equal(heartbeats.length, 1);
  assert.equal(runtime.stop(), true);
});

test('wires_web_player_to_restricted_eisland_runtime', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /<script src="eisland-bridge-runtime\.js"><\/script>/);
  assert.match(html, /function getEislandBridgePlayer\(\) \{/);
  assert.match(html, /function publishEislandBridgePlayerEvent\(eventName\) \{/);
  assert.match(html, /MineradioEislandBridgeRuntime\.createEislandBridgeRuntime/);
  assert.match(html, /eislandBridgeRuntime\.handleCommand\(request\)/);
  assert.match(html, /eislandBridgeRuntime\.start\(\);/);
  assert.doesNotMatch(html, /ipcRenderer/);

  const playerAdapter = html.match(/function getEislandBridgePlayer\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(playerAdapter, /playQueue/);
  assert.match(playerAdapter, /currentIdx/);
  assert.match(playerAdapter, /lyricsLines/);
  assert.match(playerAdapter, /bridgeTransitionFailed/);
  assert.match(playerAdapter, /bridgeTransitionPending/);
  assert.doesNotMatch(playerAdapter, /currentDesktopSongMeta|currentDesktopLyricSnapshot/);
  assert.match(
    html,
    /if \(transition\.failed\) \{\s*var failedAudioToken = Number\(audio && audio\._mineradioBridgeTrackToken\);\s*if \(audio && audio\.src && Number\.isSafeInteger\(failedAudioToken\) && failedAudioToken === trackSwitchToken\) return attemptAudioPlay\(\{ manual: true \}\);\s*if \(playQueue\.length && currentIdx >= 0\) return playQueueAt\(currentIdx, \{ manual: true \}\);\s*return Promise\.resolve\(false\);\s*\}/,
  );
  assert.match(html, /function settleEislandBridgePlaybackOutcome\(operation\) \{/);
  assert.match(html, /return Promise\.resolve\(operation\)\.then\(/);
  assert.match(html, /\['loadedmetadata', 'timeupdate', 'play', 'pause', 'ended', 'seeked', 'ratechange'\]/);
  assert.equal((html.match(/return settleEislandBridgePlaybackOutcome\(playQueueAt\(targetIdx\)\)\.finally\(forcePlaybackControlsInteractive\);/g) || []).length, 2);
  const trackControls = html.match(/function nextTrack\(\) \{[\s\S]*?\n\}\nfunction shuffleQueue/)?.[0] || '';
  assert.doesNotMatch(trackControls, /currentIdx\s*=/);
  const playQueueAt = html.match(/async function playQueueAt\(idx, opts\) \{[\s\S]*?\n\}\nasync function attemptAudioPlay/)?.[0] || '';
  assert.match(playQueueAt, /if \(idx < 0 \|\| idx >= playQueue\.length\) return false;/);
  assert.match(playQueueAt, /beginEislandBridgeTrackTransition\(trackSwitchToken\);/);
  assert.match(playQueueAt, /return finishTrackSwitch\(true\);/);
  assert.match(playQueueAt, /return finishTrackSwitch\(false\);/);
  assert.match(html, /function recoverEislandBridgeTrackTransition\(token\) \{/);
  assert.equal((html.match(/audio\._mineradioBridgeTrackToken = token;/g) || []).length, 3);
  const localImport = html.match(/async function handleFiles\(files\) \{[\s\S]*?\n\}\nvar dropOv/)?.[0] || '';
  assert.match(localImport, /beginEislandBridgeTrackTransition\(trackSwitchToken\);/);
  assert.match(localImport, /settleEislandBridgeTrackTransition\(token, false\);/);
  assert.match(localImport, /\} catch \(localBridgeImportError\) \{\s*settleEislandBridgeTrackTransition\(token, false\);\s*throw localBridgeImportError;\s*\}/);
});

test('checks_eisland_bridge_runtime_syntax', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts.precheck, 'node --check public/eisland-bridge-runtime.js');
});

test('plays_queue_backed_player_without_audio_and_rejects_pause_or_seek_without_audio', async () => {
  const calls = [];
  let currentAudio = null;
  let releasePlay;
  const player = {
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    playQueue: [{ id: 51, name: '队列歌曲', artist: '歌手', duration: 90_000 }],
    play() {
      calls.push('play');
      return new Promise((resolve) => {
        releasePlay = () => {
          currentAudio = {
            currentTime: 0,
            duration: 90,
            ended: false,
            paused: false,
            playbackRate: 1,
          };
          resolve(true);
        };
      });
    },
    trackSwitchToken: 51,
  };
  Object.defineProperty(player, 'audio', { get: () => currentAudio });
  const runtime = createEislandBridgeRuntime({ getPlayer: () => player });

  const pending = runtime.executeCommand({ command: 'play' });
  pending.catch(() => {});
  assert.deepEqual(calls, ['play']);
  await assert.rejects(
    runtime.executeCommand({ command: 'pause' }),
    (error) => error.code === 'audio-unavailable',
  );
  await assert.rejects(
    runtime.executeCommand({ command: 'seek', payload: { positionMs: 1_000 } }),
    (error) => error.code === 'audio-unavailable',
  );
  releasePlay();
  const snapshot = await pending;
  assert.equal(snapshot.state.playback.status, 'playing');
  assert.equal(snapshot.track.id, 'netease:51');
});

test('awaits_pause_event_and_cleans_up_on_timeout_or_failure', async () => {
  const listeners = new Map();
  const timers = [];
  const audio = {
    currentTime: 3,
    duration: 90,
    ended: false,
    paused: false,
    playbackRate: 1,
    addEventListener(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
    },
    removeEventListener(eventName, listener) {
      listeners.get(eventName)?.delete(listener);
    },
  };
  const player = {
    audio,
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    pause() {
      audio.paused = true;
      return Promise.resolve(true);
    },
    playQueue: [{ id: 91, name: '暂停事件歌曲', artist: '歌手', duration: 90_000 }],
    trackSwitchToken: 91,
  };
  const runtime = createEislandBridgeRuntime({
    clearTimeoutFn(timer) { timer.cleared = true; },
    getPlayer: () => player,
    setTimeoutFn(callback, delay) {
      const timer = { callback, cleared: false, delay };
      timers.push(timer);
      return timer;
    },
  });
  const emit = (eventName) => {
    for (const listener of [...(listeners.get(eventName) || [])]) listener();
  };

  const pending = runtime.executeCommand({ command: 'pause' });
  let completed = false;
  pending.then(() => { completed = true; }, () => {});
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(listeners.get('pause').size, 1);
  emit('pause');
  const pausedSnapshot = await pending;
  assert.equal(pausedSnapshot.state.playback.status, 'paused');
  assert.equal(listeners.get('pause').size, 0);

  audio.paused = false;
  const timedOut = runtime.executeCommand({ command: 'pause' });
  await Promise.resolve();
  [...timers].reverse().find((timer) => !timer.cleared).callback();
  await assert.rejects(timedOut, (error) => error.code === 'pause-timeout');
  assert.equal(listeners.get('pause').size, 0);

  audio.paused = false;
  player.pause = () => Promise.reject(new Error('pause failed'));
  await assert.rejects(
    runtime.executeCommand({ command: 'pause' }),
    (error) => error.code === 'playback-command-failed',
  );
  assert.equal(listeners.get('pause').size, 0);
  assert.equal(timers[timers.length - 1].cleared, true);
});

test('toggles_queue_backed_player_without_audio_and_rejects_empty_player', async () => {
  const calls = [];
  let currentAudio = null;
  let releasePlay;
  const player = {
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    play() {
      calls.push('play');
      return new Promise((resolve) => {
        releasePlay = () => {
          currentAudio = {
            currentTime: 0,
            duration: 75,
            ended: false,
            paused: false,
            playbackRate: 1,
          };
          resolve(true);
        };
      });
    },
    playQueue: [{ id: 75, name: '切换播放', artist: '歌手', duration: 75_000 }],
    trackSwitchToken: 75,
  };
  Object.defineProperty(player, 'audio', { get: () => currentAudio });
  const runtime = createEislandBridgeRuntime({ getPlayer: () => player });

  const pending = runtime.executeCommand({ command: 'toggle' });
  pending.catch(() => {});
  assert.deepEqual(calls, ['play']);
  await Promise.resolve();
  assert.equal(typeof releasePlay, 'function');
  releasePlay();
  const snapshot = await pending;
  assert.equal(snapshot.state.playback.status, 'playing');

  const emptyRuntime = createEislandBridgeRuntime({
    getPlayer: () => ({
      audio: null,
      currentIdx: -1,
      currentLocalSong: null,
      lyricsLines: [],
      play: () => Promise.resolve(true),
      playQueue: [],
    }),
  });
  await assert.rejects(
    emptyRuntime.executeCommand({ command: 'toggle' }),
    (error) => error.code === 'no-playable-track',
  );
  const staleCalls = [];
  const staleRuntime = createEislandBridgeRuntime({
    getPlayer: () => ({
      audio: { currentTime: 4, duration: 80, ended: false, paused: true, playbackRate: 1 },
      currentIdx: -1,
      currentLocalSong: null,
      lyricsLines: [],
      play() {
        staleCalls.push('play');
        return Promise.resolve(true);
      },
      playQueue: [],
    }),
  });
  await assert.rejects(
    staleRuntime.executeCommand({ command: 'play' }),
    (error) => error.code === 'no-playable-track',
  );
  await assert.rejects(
    staleRuntime.executeCommand({ command: 'seek', payload: { positionMs: 5_000 } }),
    (error) => error.code === 'no-playable-track',
  );
  await assert.rejects(
    staleRuntime.executeCommand({ command: 'pause' }),
    (error) => error.code === 'no-playable-track',
  );
  assert.deepEqual(staleCalls, []);

});

test('rejects_fulfilled_false_track_changes_without_acknowledging_unchanged_track', async () => {
  const receipts = [];
  const player = {
    audio: { currentTime: 8, duration: 60, ended: false, paused: false, playbackRate: 1 },
    currentIdx: 0,
    currentLocalSong: null,
    lyricsLines: [],
    nextTrack: () => Promise.resolve(false),
    playQueue: [
      { id: 201, name: '原曲', artist: '歌手', duration: 60_000 },
      { id: 202, name: '目标曲', artist: '歌手', duration: 60_000 },
    ],
    trackSwitchToken: 201,
  };
  const runtime = createEislandBridgeRuntime({
    completeCommand(receipt) { receipts.push(receipt); },
    getPlayer: () => player,
  });

  const result = await runtime.handleCommand({
    attempt: 'false-outcome-attempt',
    command: 'next',
    requestId: 'false-outcome',
  });

  assert.equal(result, null);
  assert.equal(player.currentIdx, 0);
  assert.deepEqual(receipts, [{
    attempt: 'false-outcome-attempt',
    error: { code: 'track-change-failed' },
    ok: false,
    requestId: 'false-outcome',
  }]);
});
