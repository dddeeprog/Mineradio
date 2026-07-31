'use strict';

const {
  test,
  expect,
} = require('../../third_party/folia-major/node_modules/@playwright/test');

const capabilities = {
  schema: 1,
  generatedAt: 1,
  providers: [
    {
      provider: 'netease',
      label: '网易云音乐',
      authMethods: [],
      account: { loggedIn: false, membership: {} },
      capabilities: { playback: true, sourceMatch: true },
      availability: { playback: true, sourceMatch: true },
    },
    {
      provider: 'qq',
      label: 'QQ 音乐',
      authMethods: [],
      account: { loggedIn: false, membership: {} },
      capabilities: { playback: true, sourceMatch: true },
      availability: { playback: true, sourceMatch: true },
    },
  ],
};

test('all-source failure retains the active playback surface', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => {
    pageErrors.push(String(error && error.message || error));
  });
  await page.route('**/api/platform/capabilities*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(capabilities),
  }));
  await page.route('**/api/song/url*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      url: null,
      reason: 'login_required',
      restriction: {
        category: 'login_required',
        message: 'fixture source failure',
      },
    }),
  }));
  await page.route('**/api/qq/search*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ songs: [] }),
  }));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.setOriginalLyricsState === 'function'
    && window.platformLoginCapabilitySnapshot
  ));

  const retained = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'old-song',
      name: '保留中的歌曲',
      artist: '原歌手',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'failed-song',
      name: '不应出现的歌曲',
      artist: '失败歌手',
    };
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.currentLocalSong = null;
    window.targetVolume = 0.63;
    window.audio = new Audio();
    window.audio._fixtureIdentity = 'old-media';
    document.getElementById('thumb-title').textContent = oldSong.name;
    document.getElementById('thumb-artist').textContent = oldSong.artist;
    window.setOriginalLyricsState([
      { time: 0, text: '旧歌词仍然可见' },
    ], false, 'fixture');
    window.applyOriginalLyricsState();
    const oldMedia = window.audio;

    const result = await window.playQueueAt(1, { manual: true });
    return {
      resultState: result && result.state,
      currentIdx: window.currentIdx,
      title: document.getElementById('thumb-title').textContent,
      artist: document.getElementById('thumb-artist').textContent,
      lyrics: window.lyricsLines.map(line => line.text),
      volume: window.targetVolume,
      sameMedia: window.audio === oldMedia,
      mediaIdentity: window.audio && window.audio._fixtureIdentity,
    };
  });

  expect(retained).toEqual({
    resultState: 'rolled-back',
    currentIdx: 0,
    title: '保留中的歌曲',
    artist: '原歌手',
    lyrics: ['旧歌词仍然可见'],
    volume: 0.63,
    sameMedia: true,
    mediaIdentity: 'old-media',
  });
  expect(pageErrors).toEqual([]);
});

test('commit-stage failure restores both playback surfaces and the old media', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.captureCurrentPlaybackTransactionState === 'function'
  ));

  const retained = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'old-song',
      name: '事务前标题',
      artist: '事务前歌手',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'next-song',
      name: '不能残留的标题',
      artist: '不能残留的歌手',
    };
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.currentLocalSong = null;
    window.audio = new Audio();
    window.audio._fixtureIdentity = 'commit-old-media';
    document.getElementById('thumb-title').textContent = oldSong.name;
    document.getElementById('thumb-artist').textContent = oldSong.artist;
    document.getElementById('thumb-cover').setAttribute('src', '/old-cover.jpg');
    document.getElementById('control-title').textContent = oldSong.name;
    document.getElementById('control-artist').textContent = oldSong.artist;
    document.getElementById('control-cover').style.backgroundImage = 'url("/old-control-cover.jpg")';
    const oldMedia = window.audio;

    window.resolvePlaybackPreparation = async () => ({
      catalogSong: nextSong,
      queueSong: nextSong,
      playbackSong: nextSong,
      local: false,
      sourceUrl: '/fixture.mp3',
      mediaUrl: '/fixture.mp3',
      playbackProvider: 'netease',
      resolutionMode: 'catalog',
      requestedQuality: 'standard',
      data: { url: '/fixture.mp3', level: 'standard' },
      attempts: [{ provider: 'netease', reason: 'resolved' }],
      media: new Audio(),
    });
    window.prepareResolvedPlayback = async resolved => {
      resolved.previousAudio = oldMedia;
      return resolved;
    };
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async () => null;
    window.applyAudioOutputToMedia = async () => null;
    window.attemptAudioPlay = async () => false;

    const result = await window.playQueueAt(1);
    return {
      state: result && result.state,
      currentIdx: window.currentIdx,
      sameMedia: window.audio === oldMedia,
      thumbTitle: document.getElementById('thumb-title').textContent,
      thumbArtist: document.getElementById('thumb-artist').textContent,
      thumbCover: document.getElementById('thumb-cover').getAttribute('src'),
      controlTitle: document.getElementById('control-title').textContent,
      controlArtist: document.getElementById('control-artist').textContent,
      controlCover: document.getElementById('control-cover').style.backgroundImage,
    };
  });

  expect(retained).toEqual({
    state: 'rolled-back',
    currentIdx: 0,
    sameMedia: true,
    thumbTitle: '事务前标题',
    thumbArtist: '事务前歌手',
    thumbCover: '/old-cover.jpg',
    controlTitle: '事务前标题',
    controlArtist: '事务前歌手',
    controlCover: 'url("/old-control-cover.jpg")',
  });
});

test('commit-stage failure restores listen, analysis, lyric lighting, and cinema runtime state', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.captureCurrentPlaybackTransactionState === 'function'
  ));

  const restored = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      type: 'local',
      source: 'local-library',
      id: 'old-local',
      localKey: 'old-local-key',
      localUrl: '/old-local.mp3',
      name: '旧本地歌曲',
      artist: '旧歌手',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'next-online',
      name: '新在线歌曲',
      artist: '新歌手',
    };
    const oldMedia = new Audio();
    oldMedia.src = '/old-local.mp3';
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.currentLocalSong = oldSong;
    window.audio = oldMedia;
    window.listenSession = {
      key: 'old-local-key',
      song: { key: 'old-local-key', name: '旧本地歌曲' },
      context: { source: 'fixture' },
      startedAt: 10,
      lastWallAt: 20,
      lastAudioTime: 3,
      listenMs: 12345,
      maxProgress: 0.42,
    };
    window.firstPlayDone = false;
    window.lyricSunEnergy = 0.71;
    window.lyricSunTarget = 0.62;
    window.lyricSunHold = 0.53;
    window.lyricSunAvg = 0.44;
    window.lyricSunPeak = 0.93;
    Object.assign(window.cinemaTrackProfile, {
      scale: 0.46,
      target: 0.57,
      nameHint: 0.68,
      frames: 321,
      energyAvg: 0.31,
      lowAvg: 0.27,
      vocalAvg: 0.23,
      melodyAvg: 0.19,
      punchPeak: 0.81,
      density: 1.7,
    });
    window.localBeatAnalysis = {
      song: oldSong,
      audioUrl: '/old-local.mp3',
      mode: 'mr',
      active: true,
      token: 17,
    };
    window.beatMapToken = 23;
    window.djBeatMapToken = 29;
    window.beatAnalysisTimer = setTimeout(() => {}, 60000);
    window.beatPrefetchTimer = setTimeout(() => {}, 60000);

    const originals = {
      resolvePlaybackPreparation: window.resolvePlaybackPreparation,
      prepareResolvedPlayback: window.prepareResolvedPlayback,
      confirmPreparedPlayback: window.confirmPreparedPlayback,
      ensureAudioGraphForMedia: window.ensureAudioGraphForMedia,
      applyAudioOutputToMedia: window.applyAudioOutputToMedia,
      attemptAudioPlay: window.attemptAudioPlay,
      startLocalBeatAnalysis: window.startLocalBeatAnalysis,
      scheduleBeatAnalysis: window.scheduleBeatAnalysis,
      scheduleQueueBeatPrefetch: window.scheduleQueueBeatPrefetch,
    };
    const restartCalls = [];
    window.resolvePlaybackPreparation = async () => ({
      catalogSong: nextSong,
      queueSong: nextSong,
      playbackSong: nextSong,
      local: false,
      sourceUrl: '/next-online.mp3',
      mediaUrl: '/next-online.mp3',
      playbackProvider: 'netease',
      resolutionMode: 'catalog',
      requestedQuality: 'standard',
      data: { url: '/next-online.mp3', level: 'standard' },
      attempts: [{ provider: 'netease', reason: 'resolved' }],
      media: new Audio(),
    });
    window.prepareResolvedPlayback = async resolved => {
      resolved.previousAudio = oldMedia;
      return resolved;
    };
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async () => null;
    window.applyAudioOutputToMedia = async () => null;
    window.attemptAudioPlay = async () => false;
    window.startLocalBeatAnalysis = async mode => {
      restartCalls.push(['local', mode]);
      window.localBeatAnalysis.active = true;
    };
    window.scheduleBeatAnalysis = (key, url) => {
      restartCalls.push(['beat', key, url]);
    };
    window.scheduleQueueBeatPrefetch = index => {
      restartCalls.push(['prefetch', index]);
    };

    const result = await window.playQueueAt(1);
    await Promise.resolve();
    const snapshot = {
      state: result && result.state,
      listenSession: window.listenSession,
      firstPlayDone: window.firstPlayDone,
      lyricSun: [
        window.lyricSunEnergy,
        window.lyricSunTarget,
        window.lyricSunHold,
        window.lyricSunAvg,
        window.lyricSunPeak,
      ],
      cinema: Object.assign({}, window.cinemaTrackProfile),
      localBeat: {
        songId: window.localBeatAnalysis.song && window.localBeatAnalysis.song.id,
        audioUrl: window.localBeatAnalysis.audioUrl,
        mode: window.localBeatAnalysis.mode,
        active: window.localBeatAnalysis.active,
        tokenAdvanced: window.localBeatAnalysis.token > 17,
      },
      beatMapTokenAdvanced: window.beatMapToken > 23,
      djBeatMapTokenAdvanced: window.djBeatMapToken > 29,
      restartCalls,
    };

    if (window.beatAnalysisTimer) clearTimeout(window.beatAnalysisTimer);
    if (window.beatPrefetchTimer) clearTimeout(window.beatPrefetchTimer);
    Object.assign(window, originals);
    return snapshot;
  });

  expect(restored).toEqual({
    state: 'rolled-back',
    listenSession: {
      key: 'old-local-key',
      song: { key: 'old-local-key', name: '旧本地歌曲' },
      context: { source: 'fixture' },
      startedAt: 10,
      lastWallAt: 20,
      lastAudioTime: 3,
      listenMs: 12345,
      maxProgress: 0.42,
    },
    firstPlayDone: false,
    lyricSun: [0.71, 0.62, 0.53, 0.44, 0.93],
    cinema: {
      scale: 0.46,
      target: 0.57,
      nameHint: 0.68,
      frames: 321,
      energyAvg: 0.31,
      lowAvg: 0.27,
      vocalAvg: 0.23,
      melodyAvg: 0.19,
      punchPeak: 0.81,
      density: 1.7,
    },
    localBeat: {
      songId: 'old-local',
      audioUrl: '/old-local.mp3',
      mode: 'mr',
      active: true,
      tokenAdvanced: true,
    },
    beatMapTokenAdvanced: true,
    djBeatMapTokenAdvanced: true,
    restartCalls: [
      ['beat', 'song:next-online', '/next-online.mp3'],
      ['local', 'mr'],
      ['beat', 'local:old-local-key', '/old-local.mp3'],
      ['prefetch', 0],
    ],
  });
});

test('next, previous, and shuffle navigation do not pre-commit currentIdx', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.nextTrack === 'function'
    && typeof window.prevTrack === 'function'
    && typeof window.playQueueAt === 'function'
  ));

  const calls = await page.evaluate(async () => {
    window.playQueue = [
      { provider: 'netease', id: 'one', name: 'One' },
      { provider: 'netease', id: 'two', name: 'Two' },
    ];
    window.currentIdx = 0;
    const observed = [];
    const originalPlayQueueAt = window.playQueueAt;
    const originalRandom = Math.random;
    window.playQueueAt = index => {
      observed.push({
        target: index,
        currentAtCall: window.currentIdx,
        mode: window.playMode,
      });
      return Promise.resolve({ ok: false, state: 'rolled-back' });
    };

    window.playMode = 'loop';
    window.nextTrack();
    await Promise.resolve();
    window.currentIdx = 0;
    window.prevTrack();
    await Promise.resolve();
    window.currentIdx = 0;
    window.playMode = 'shuffle';
    Math.random = () => 0.99;
    window.nextTrack();
    await Promise.resolve();

    Math.random = originalRandom;
    window.playQueueAt = originalPlayQueueAt;
    return {
      observed,
      currentIdx: window.currentIdx,
    };
  });

  expect(calls).toEqual({
    observed: [
      { target: 1, currentAtCall: 0, mode: 'loop' },
      { target: 1, currentAtCall: 0, mode: 'loop' },
      { target: 1, currentAtCall: 0, mode: 'shuffle' },
    ],
    currentIdx: 0,
  });
});

test('shuffleQueue keeps the active song aligned with its new queue index', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.shuffleQueue === 'function');

  const shuffled = await page.evaluate(() => {
    const activeMedia = new Audio();
    activeMedia.src = '/active-two.mp3';
    window.audio = activeMedia;
    window.playQueue = [
      { provider: 'netease', id: 'one', name: 'One' },
      { provider: 'netease', id: 'two', name: 'Two' },
      { provider: 'netease', id: 'three', name: 'Three' },
    ];
    window.currentIdx = 1;
    const originalRandom = Math.random;
    const sequence = [0.4, 0];
    Math.random = () => sequence.shift() || 0;

    window.shuffleQueue();

    Math.random = originalRandom;
    return {
      order: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      currentSongId: window.playQueue[window.currentIdx] && window.playQueue[window.currentIdx].id,
      sameMedia: window.audio === activeMedia,
      mediaSrc: window.audio && new URL(window.audio.src).pathname,
    };
  });

  expect(shuffled).toEqual({
    order: ['three', 'one', 'two'],
    currentIdx: 2,
    currentSongId: 'two',
    sameMedia: true,
    mediaSrc: '/active-two.mp3',
  });
});

test('resolved unsupported stream disables the actual next-track preload policy', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.scheduleNextTrackPreload === 'function'
    && window.MineradioGaplessPlaybackState
  ));

  const preload = await page.evaluate(async () => {
    const currentMedia = new Audio();
    currentMedia.src = '/current.mp3';
    window.audio = currentMedia;
    window.playQueue = [
      { provider: 'netease', id: 'current', name: 'Current' },
      { provider: 'netease', id: 'unsupported', name: 'Unsupported' },
    ];
    window.currentIdx = 0;
    window.playMode = 'loop';
    window.localBeatAnalysis.active = false;
    if (window.nativeLyricConfig && window.nativeLyricConfig.common) {
      window.nativeLyricConfig.common.performanceMode = 'balanced';
    }

    let created = 0;
    const originalResolve = window.resolvePlaybackPreparation;
    const originalCoordinator = window.gaplessPlaybackCoordinator;
    window.gaplessPlaybackCoordinator = window.MineradioGaplessPlaybackState.createGaplessPlaybackCoordinator({
      createMedia() {
        created += 1;
        return {
          src: '',
          preload: '',
          pause() {},
          removeAttribute() {},
          load() {},
        };
      },
      prepare: async () => true,
      release() {},
    });
    window.gaplessPlaybackCoordinator.setCurrent(currentMedia);
    window.resolvePlaybackPreparation = async () => ({
      sourceUrl: 'https://cdn.example/live.m3u8',
      mediaUrl: '/api/audio?url=' + encodeURIComponent('https://cdn.example/live.m3u8'),
      data: {
        url: 'https://cdn.example/live.m3u8',
        streamSupported: false,
      },
    });

    window.scheduleNextTrackPreload('unsupported-fixture');
    for (let index = 0; index < 20 && window.nextTrackPreloadState.pending; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const result = {
      created,
      pending: window.nextTrackPreloadState.pending,
      prepared: !!window.nextTrackPreloadState.prepared,
    };

    window.cancelNextTrackPreload('fixture-cleanup');
    window.resolvePlaybackPreparation = originalResolve;
    window.gaplessPlaybackCoordinator = originalCoordinator;
    return result;
  });

  expect(preload).toEqual({
    created: 0,
    pending: false,
    prepared: false,
  });
});

test('queue-replacing playback entry points submit a proposed queue without pre-committing it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playSearchResult === 'function'
    && typeof window.playHomeSong === 'function'
    && typeof window.playAlbumDetailSong === 'function'
    && typeof window.playPlaylistPanelDetailTrack === 'function'
    && typeof window.importLocalLibrarySongs === 'function'
  ));

  const entries = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'old-active',
      name: '当前播放',
      artist: '原歌手',
    };
    const targets = {
      search: { provider: 'qq', source: 'qq', mid: 'search-target', name: '搜索歌曲' },
      home: { provider: 'netease', source: 'netease', id: 'home-target', name: '首页歌曲' },
      album: { provider: 'netease', source: 'netease', id: 'album-target', name: '专辑歌曲' },
      playlist: { provider: 'qq', source: 'qq', mid: 'playlist-target', name: '歌单歌曲' },
      localLibrary: {
        type: 'local',
        source: 'local-library',
        id: 'local-target',
        localUrl: 'blob:local-library-target',
        name: '本地库歌曲',
      },
    };
    const observations = {};
    const originalPlayQueueAt = window.playQueueAt;
    const originalSearchResultActionState = window.searchResultActionState;
    window.searchResultActionState = () => ({ play: true, queue: true });

    function resetActivePlayback() {
      window.playQueue = [Object.assign({}, oldSong)];
      window.currentIdx = 0;
    }

    async function invoke(name, callback) {
      resetActivePlayback();
      let request = null;
      window.playQueueAt = (index, options) => {
        request = {
          index,
          queue: options && Array.isArray(options.queue)
            ? options.queue.map(song => song.id || song.mid || song.localUrl)
            : null,
          currentQueue: window.playQueue.map(song => song.id || song.mid || song.localUrl),
          currentIdx: window.currentIdx,
        };
        return Promise.resolve({ ok: false, retained: true, state: 'rolled-back' });
      };
      await callback();
      await Promise.resolve();
      observations[name] = {
        request,
        queueAfter: window.playQueue.map(song => song.id || song.mid || song.localUrl),
        indexAfter: window.currentIdx,
      };
    }

    window.playlist = [targets.search];
    await invoke('search', () => window.playSearchResult(0));

    window.homeDiscoverState.songs = [targets.home];
    await invoke('home', () => window.playHomeSong(0));

    window.detailAlbumSongs = [targets.album];
    await invoke('album', () => window.playAlbumDetailSong(0));

    window.playlistPanelDetailState.tracks = [targets.playlist];
    window.playlistPanelDetailState.key = 'qq:fixture';
    await invoke('playlist', () => window.playPlaylistPanelDetailTrack(0));

    await invoke('localLibrary', () => window.importLocalLibrarySongs(
      [targets.localLibrary],
      { folderPath: 'C:\\fixture' },
      { message: 'fixture' }
    ));

    window.playQueueAt = originalPlayQueueAt;
    window.searchResultActionState = originalSearchResultActionState;
    return observations;
  });

  expect(entries).toEqual({
    search: {
      request: {
        index: 0,
        queue: ['search-target', 'old-active'],
        currentQueue: ['old-active'],
        currentIdx: 0,
      },
      queueAfter: ['old-active'],
      indexAfter: 0,
    },
    home: {
      request: {
        index: 0,
        queue: ['home-target'],
        currentQueue: ['old-active'],
        currentIdx: 0,
      },
      queueAfter: ['old-active'],
      indexAfter: 0,
    },
    album: {
      request: {
        index: 0,
        queue: ['album-target'],
        currentQueue: ['old-active'],
        currentIdx: 0,
      },
      queueAfter: ['old-active'],
      indexAfter: 0,
    },
    playlist: {
      request: {
        index: 0,
        queue: ['playlist-target'],
        currentQueue: ['old-active'],
        currentIdx: 0,
      },
      queueAfter: ['old-active'],
      indexAfter: 0,
    },
    localLibrary: {
      request: {
        index: 0,
        queue: ['local-target'],
        currentQueue: ['old-active'],
        currentIdx: 0,
      },
      queueAfter: ['old-active'],
      indexAfter: 0,
    },
  });
});

test('dropped audio enters the playback transaction without pausing or overwriting the old media', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.handleFiles === 'function'
    && typeof window.playQueueAt === 'function'
  ));

  const result = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'old-active',
      name: '当前播放',
    };
    window.playQueue = [oldSong];
    window.currentIdx = 0;
    const oldMedia = new Audio();
    oldMedia.src = '/old-active.mp3';
    let pauseCalls = 0;
    oldMedia.pause = () => {
      pauseCalls += 1;
    };
    window.audio = oldMedia;

    const originalCollect = window.collectLocalImportAssets;
    const originalPlayQueueAt = window.playQueueAt;
    const originalCreateObjectURL = URL.createObjectURL;
    window.collectLocalImportAssets = async () => ({
      metadata: { title: '拖放歌曲', artist: '本地歌手', album: '本地专辑' },
      lyricState: { lines: [], hasNativeKaraoke: false, timingSource: 'fallback' },
    });
    URL.createObjectURL = () => 'blob:dropped-audio';
    let request = null;
    window.playQueueAt = (index, options) => {
      request = {
        index,
        queue: options && Array.isArray(options.queue)
          ? options.queue.map(song => song.localUrl || song.id)
          : null,
        hasLocalImport: !!(options && options.localImport),
      };
      return Promise.resolve({ ok: false, retained: true, state: 'rolled-back' });
    };

    const file = new File(['fixture'], 'dropped.mp3', { type: 'audio/mpeg' });
    await window.handleFiles([file]);

    const snapshot = {
      request,
      queue: window.playQueue.map(song => song.id),
      currentIdx: window.currentIdx,
      sameMedia: window.audio === oldMedia,
      oldSrcPreserved: oldMedia.getAttribute('src') === '/old-active.mp3',
      pauseCalls,
    };
    window.collectLocalImportAssets = originalCollect;
    window.playQueueAt = originalPlayQueueAt;
    URL.createObjectURL = originalCreateObjectURL;
    return snapshot;
  });

  expect(result).toEqual({
    request: {
      index: 0,
      queue: ['blob:dropped-audio'],
      hasLocalImport: true,
    },
    queue: ['old-active'],
    currentIdx: 0,
    sameMedia: true,
    oldSrcPreserved: true,
    pauseCalls: 0,
  });
});

test('a handoff cancelled during commit keeps the outgoing src until committed finalization', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.completePreparedAudioHandoff === 'function'
  ));

  const result = await page.evaluate(async () => {
    const outgoing = new Audio();
    outgoing.setAttribute('src', '/outgoing.mp3');
    const staleIncoming = new Audio();
    staleIncoming.setAttribute('src', '/stale-incoming.mp3');
    window.audio = staleIncoming;
    let current = true;
    const attempt = {
      isCurrent() {
        return current;
      },
    };

    const staleHandoff = window.completePreparedAudioHandoff(
      outgoing,
      staleIncoming,
      { gaplessHandoff: false },
      {},
      attempt
    );
    current = false;
    let staleCode = '';
    try {
      await staleHandoff;
    } catch (error) {
      staleCode = error && error.code || '';
    }

    const committedIncoming = new Audio();
    committedIncoming.setAttribute('src', '/committed-incoming.mp3');
    window.audio = committedIncoming;
    current = true;
    await window.completePreparedAudioHandoff(
      outgoing,
      committedIncoming,
      { gaplessHandoff: false },
      {},
      attempt
    );
    const srcBeforeFinalize = outgoing.getAttribute('src');
    await window.finalizePreparedPlaybackCommit(
      { media: committedIncoming, previousMedia: outgoing },
      { previousAudio: outgoing },
      attempt
    );

    return {
      staleCode,
      srcAfterStale: srcBeforeFinalize,
      srcAfterFinalize: outgoing.getAttribute('src'),
    };
  });

  expect(result).toEqual({
    staleCode: 'PLAYBACK_ATTEMPT_STALE',
    srcAfterStale: '/outgoing.mp3',
    srcAfterFinalize: null,
  });
});

test('rollback releases the failed authoritative media without clearing the retained source', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.captureCurrentPlaybackTransactionState === 'function');

  const sources = await page.evaluate(async () => {
    const retained = new Audio();
    retained.setAttribute('src', '/retained.mp3');
    window.audio = retained;
    window.playQueue = [{ provider: 'netease', id: 'retained', name: 'Retained' }];
    window.currentIdx = 0;
    const snapshot = window.captureCurrentPlaybackTransactionState();
    const failed = new Audio();
    failed.setAttribute('src', '/failed.mp3');
    window.audio = failed;

    await window.restoreCurrentPlaybackTransactionState(snapshot);

    return {
      retained: retained.getAttribute('src'),
      failed: failed.getAttribute('src'),
      sameMedia: window.audio === retained,
    };
  });

  expect(sources).toEqual({
    retained: '/retained.mp3',
    failed: null,
    sameMedia: true,
  });
});

test('committed finalization accounts the old session against outgoing media', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.finalizePreparedPlaybackCommit === 'function');

  const lifecycle = await page.evaluate(async () => {
    const outgoing = new Audio();
    outgoing.src = '/old-session.mp3';
    const incoming = new Audio();
    incoming.src = '/new-session.mp3';
    window.audio = incoming;
    const originalFinalize = window.finalizeListenSession;
    const originalBegin = window.beginListenSession;
    const originalRelease = window.releasePlaybackMedia;
    const observed = [];
    window.finalizeListenSession = () => {
      observed.push(['finalize', window.audio === outgoing ? 'outgoing' : 'incoming']);
      window.listenSession = null;
    };
    window.beginListenSession = () => {
      observed.push(['begin', window.audio === incoming ? 'incoming' : 'outgoing']);
    };
    window.releasePlaybackMedia = () => {};

    await window.finalizePreparedPlaybackCommit({
      song: { provider: 'netease', id: 'next', name: 'Next' },
      media: incoming,
      previousMedia: outgoing,
      playbackContext: null,
      firstVisualPlay: false,
    }, {
      media: incoming,
      previousAudio: outgoing,
    });

    window.finalizeListenSession = originalFinalize;
    window.beginListenSession = originalBegin;
    window.releasePlaybackMedia = originalRelease;
    return observed;
  });

  expect(lifecycle).toEqual([
    ['finalize', 'outgoing'],
    ['begin', 'incoming'],
  ]);
});

test('closed Chromium AudioContext reconstruction replaces the bound media and preserves lifecycle state', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.MineradioAudioOutputState
    && typeof window.MineradioAudioOutputState.createAudioGraphRuntime === 'function'
  ));

  const result = await page.evaluate(async () => {
    const helper = window.MineradioAudioOutputState;
    const contexts = [];
    const endedHandler = () => {};
    const queueIdentity = { key: 'chromium-queue-item' };
    const original = new Audio();
    original.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    original.volume = 0.41;
    original.muted = true;
    original.playbackRate = 1.2;
    original.preload = 'auto';
    original.crossOrigin = 'anonymous';
    original.onended = endedHandler;
    original._fixtureQueueIdentity = queueIdentity;
    let replacement = null;
    const runtime = helper.createAudioGraphRuntime({
      createContext() {
        const context = new AudioContext();
        contexts.push(context);
        return context;
      },
      replaceMedia(media) {
        replacement = new Audio();
        helper.transferMediaElementState(media, replacement, {
          identityKeys: ['_fixtureQueueIdentity'],
        });
        return replacement;
      },
    });

    const first = await runtime.ensure(original);
    await first.context.close();
    const rebuilt = await runtime.ensure(original);
    const snapshot = {
      contextCount: contexts.length,
      replaced: rebuilt.media === replacement && rebuilt.media !== original,
      srcPreserved: rebuilt.media.getAttribute('src') === original.getAttribute('src'),
      volume: rebuilt.media.volume,
      muted: rebuilt.media.muted,
      playbackRate: rebuilt.media.playbackRate,
      handlerPreserved: rebuilt.media.onended === endedHandler,
      identityPreserved: rebuilt.media._fixtureQueueIdentity === queueIdentity,
      mediaCount: runtime.snapshot().mediaCount,
    };
    await rebuilt.context.close();
    return snapshot;
  });

  expect(result).toEqual({
    contextCount: 2,
    replaced: true,
    srcPreserved: true,
    volume: 0.41,
    muted: true,
    playbackRate: 1.2,
    handlerPreserved: true,
    identityPreserved: true,
    mediaCount: 1,
  });
});

test('Mineradio adopts the replacement media when its authoritative AudioContext is closed', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.ensureAudioGraphForMedia === 'function'
  ));

  const result = await page.evaluate(async () => {
    const original = new Audio();
    const endedHandler = () => {};
    const queueIdentity = { key: 'active-queue-item' };
    original.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    original.volume = 0.52;
    original.muted = true;
    original.playbackRate = 1.15;
    original.onended = endedHandler;
    original._mineradioPlaybackQueueIdentity = queueIdentity;
    const originalSrc = original.getAttribute('src');
    window.audioGraphRuntime = null;
    window.audioCtx = null;
    window.source = null;
    window.analyser = null;
    window.beatAnalyser = null;
    window.gainNode = null;
    window.audio = original;

    const first = await window.ensureAudioGraphForMedia(original);
    original.volume = 0.52;
    original.muted = true;
    await first.context.close();
    const rebuilt = await window.ensureAudioGraphForMedia(original);
    const replacement = window.audio;
    const snapshot = {
      replaced: replacement !== original && rebuilt.media === replacement,
      srcPreserved: replacement.getAttribute('src') === originalSrc,
      volume: replacement.volume,
      muted: replacement.muted,
      playbackRate: replacement.playbackRate,
      handlerPreserved: replacement.onended === endedHandler,
      identityPreserved: replacement._mineradioPlaybackQueueIdentity === queueIdentity,
      sourceUsesReplacement: rebuilt.source.mediaElement
        ? rebuilt.source.mediaElement === replacement
        : true,
      generation: window.audioGraphRuntime.snapshot().generation,
      mediaCount: window.audioGraphRuntime.snapshot().mediaCount,
    };
    await rebuilt.context.close();
    return snapshot;
  });

  expect(result).toEqual({
    replaced: true,
    srcPreserved: true,
    volume: 0.52,
    muted: true,
    playbackRate: 1.15,
    handlerPreserved: true,
    identityPreserved: true,
    sourceUsesReplacement: true,
    generation: 2,
    mediaCount: 1,
  });
});

test('a superseding queue request bypasses pending readiness and releases the late media once', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && window.MineradioPlaybackTransaction
  ));

  const result = await page.evaluate(async () => {
    const helper = window.MineradioPlaybackTransaction;
    const originalManager = window.playbackTransactionManager;
    const originalResolve = window.resolvePlaybackPreparation;
    const originalWaitForReady = window.waitForPlaybackMediaReady;
    const originalConfirm = window.confirmPreparedPlayback;
    const originalCommit = window.commitPreparedPlayback;
    const originalFinalize = window.finalizePreparedPlaybackCommit;
    const originalReleaseMedia = window.releasePlaybackMedia;
    const releases = [];
    let slowMedia = null;
    let announcePrepare;
    let finishPrepare;
    const prepareStarted = new Promise(resolve => {
      announcePrepare = resolve;
    });
    const prepareGate = new Promise(resolve => {
      finishPrepare = resolve;
    });

    window.playbackTransactionManager = helper.createPlaybackTransactionManager({
      capture: () => ({ queue: [], index: -1 }),
      restore: () => {},
    });
    window.resolvePlaybackPreparation = async (index, options, attempt, requestQueue) => ({
      id: requestQueue[index].id,
      queueSong: requestQueue[index],
      sourceUrl: '/' + requestQueue[index].id + '.mp3',
      mediaUrl: '/' + requestQueue[index].id + '.mp3',
      data: { url: '/' + requestQueue[index].id + '.mp3' },
    });
    window.waitForPlaybackMediaReady = async media => {
      if (!media.src.includes('/slow.mp3')) return true;
      slowMedia = media;
      announcePrepare();
      await prepareGate;
      return true;
    };
    window.confirmPreparedPlayback = async () => true;
    window.commitPreparedPlayback = async (index, options, prepared) => prepared.id;
    window.finalizePreparedPlaybackCommit = async () => {};
    window.releasePlaybackMedia = media => {
      releases.push(media === slowMedia ? 'slow' : 'other');
      media.removeAttribute('src');
    };

    const first = window.playQueueAt(0, {
      queue: [{ provider: 'netease', id: 'slow', name: 'Slow' }],
    });
    await prepareStarted;
    const second = window.playQueueAt(0, {
      queue: [{ provider: 'netease', id: 'fast', name: 'Fast' }],
    });
    const winner = await Promise.race([
      second.then(() => 'fast'),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 150)),
    ]);
    const slowHasSourceBeforeFinish = !!slowMedia.getAttribute('src');
    finishPrepare();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    await new Promise(resolve => setTimeout(resolve, 0));

    window.playbackTransactionManager = originalManager;
    window.resolvePlaybackPreparation = originalResolve;
    window.waitForPlaybackMediaReady = originalWaitForReady;
    window.confirmPreparedPlayback = originalConfirm;
    window.commitPreparedPlayback = originalCommit;
    window.finalizePreparedPlaybackCommit = originalFinalize;
    window.releasePlaybackMedia = originalReleaseMedia;
    return {
      winner,
      firstState: firstResult.state,
      secondState: secondResult.state,
      releases,
      slowHasSourceBeforeFinish,
    };
  });

  expect(result).toEqual({
    winner: 'fast',
    firstState: 'cancelled',
    secondState: 'committed',
    releases: ['slow'],
    slowHasSourceBeforeFinish: false,
  });
});

test('media readiness stops immediately when its playback attempt is cancelled', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.waitForPlaybackMediaReady === 'function');

  const outcome = await page.evaluate(async () => {
    let cancelAttempt;
    const attempt = {
      whenCancelled: new Promise(resolve => {
        cancelAttempt = resolve;
      }),
    };
    const media = new Audio();
    const waiting = window.waitForPlaybackMediaReady(media, 9000, attempt).then(
      () => 'ready',
      error => error && error.code || 'error'
    );
    cancelAttempt();
    return Promise.race([
      waiting,
      new Promise(resolve => setTimeout(() => resolve('timeout'), 150)),
    ]);
  });

  expect(outcome).toBe('PLAYBACK_ATTEMPT_STALE');
});

test('the outgoing media keeps playing until graph output and incoming playback are confirmed', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.commitPreparedPlayback === 'function'
  ));

  const result = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'old-playing',
      name: 'Old Playing',
      artist: 'Old Artist',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'next-fails-at-graph',
      name: 'Next',
      artist: 'Next Artist',
    };
    const oldMedia = new Audio();
    oldMedia.setAttribute('src', '/old-playing.mp3');
    let oldPauseCalls = 0;
    oldMedia.pause = () => {
      oldPauseCalls += 1;
    };
    window.audio = oldMedia;
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.playbackTransactionManager = null;

    const originalResolve = window.resolvePlaybackPreparation;
    const originalPrepare = window.prepareResolvedPlayback;
    const originalConfirm = window.confirmPreparedPlayback;
    const originalEnsureGraph = window.ensureAudioGraphForMedia;
    const incoming = new Audio();
    incoming.setAttribute('src', '/next.mp3');
    let oldPauseCallsAtGraph = -1;
    window.resolvePlaybackPreparation = async () => ({
      catalogSong: nextSong,
      queueSong: nextSong,
      playbackSong: nextSong,
      local: false,
      sourceUrl: '/next.mp3',
      mediaUrl: '/next.mp3',
      playbackProvider: 'netease',
      resolutionMode: 'catalog',
      requestedQuality: 'standard',
      data: { url: '/next.mp3', level: 'standard' },
      attempts: [{ provider: 'netease', reason: 'resolved' }],
      media: incoming,
      previousAudio: oldMedia,
    });
    window.prepareResolvedPlayback = async resolved => resolved;
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async () => {
      oldPauseCallsAtGraph = oldPauseCalls;
      throw new Error('fixture graph failure');
    };

    const transaction = await window.playQueueAt(1);
    const snapshot = {
      state: transaction.state,
      oldPauseCallsAtGraph,
      oldSrc: oldMedia.getAttribute('src'),
      sameMedia: window.audio === oldMedia,
    };
    window.resolvePlaybackPreparation = originalResolve;
    window.prepareResolvedPlayback = originalPrepare;
    window.confirmPreparedPlayback = originalConfirm;
    window.ensureAudioGraphForMedia = originalEnsureGraph;
    return snapshot;
  });

  expect(result).toEqual({
    state: 'rolled-back',
    oldPauseCallsAtGraph: 0,
    oldSrc: '/old-playing.mp3',
    sameMedia: true,
  });
});

test('closed context reconstruction with a standby never creates three sourced media elements', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.ensureAudioGraphForMedia === 'function'
    && window.MineradioGaplessPlaybackState
    && window.MineradioAudioOutputState
  ));

  const result = await page.evaluate(async () => {
    const audioState = window.MineradioAudioOutputState;
    const gaplessState = window.MineradioGaplessPlaybackState;
    const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    const tracked = new Set();
    let maxSourcedMedia = 0;
    function sample(media) {
      if (media) tracked.add(media);
      let sourced = 0;
      tracked.forEach(item => {
        if (item.getAttribute('src')) sourced += 1;
      });
      maxSourcedMedia = Math.max(maxSourcedMedia, sourced);
    }

    const current = new Audio();
    current.setAttribute('src', silentWav);
    tracked.add(current);
    window.audioGraphRuntime = null;
    window.audioCtx = null;
    window.source = null;
    window.analyser = null;
    window.beatAnalyser = null;
    window.gainNode = null;
    window.audio = current;
    const first = await window.ensureAudioGraphForMedia(current);

    const standby = new Audio();
    tracked.add(standby);
    window.gaplessPlaybackCoordinator = gaplessState.createGaplessPlaybackCoordinator({
      createMedia: () => standby,
      prepare: async media => {
        sample(media);
        return true;
      },
      release: media => {
        media.removeAttribute('src');
        sample(media);
      },
    });
    window.gaplessPlaybackCoordinator.setCurrent(current);
    await window.gaplessPlaybackCoordinator.preload({
      key: 'standby',
      src: silentWav + '#standby',
    });
    sample(standby);

    const originalTransfer = audioState.transferMediaElementState;
    audioState.transferMediaElementState = (sourceMedia, targetMedia, options) => {
      const state = originalTransfer(sourceMedia, targetMedia, options);
      sample(targetMedia);
      return state;
    };
    await first.context.close();
    const rebuilt = await window.ensureAudioGraphForMedia(current);
    sample(window.audio);
    audioState.transferMediaElementState = originalTransfer;
    const snapshot = {
      maxSourcedMedia,
      standbyHasSource: !!standby.getAttribute('src'),
      replaced: rebuilt.media === window.audio && window.audio !== current,
    };
    await rebuilt.context.close();
    return snapshot;
  });

  expect(result).toEqual({
    maxSourcedMedia: 2,
    standbyHasSource: false,
    replaced: true,
  });
});

test('failed reversible commit cannot persist listen stats while catalog state is provisional', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.updateListenStatsTick === 'function'
  ));

  const result = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'listen-old',
      name: 'Listen Old',
      artist: 'Old Artist',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'listen-next',
      name: 'Listen Next',
      artist: 'Next Artist',
    };
    const oldKey = window.queueItemKey(oldSong);
    const initialStats = {
      history: [],
      songs: {},
      artists: {},
      updatedAt: 0,
    };
    const initialStorage = JSON.stringify(initialStats);
    localStorage.setItem('mineradio-listen-stats-v1', initialStorage);
    window.listenStatsState = JSON.parse(initialStorage);
    window.listenSession = {
      key: oldKey,
      song: window.listenSongSnapshot(oldSong),
      context: { source: 'listen-fixture' },
      startedAt: Date.now() - 60000,
      lastWallAt: Date.now() - 1000,
      lastAudioTime: 20,
      listenMs: 50000,
      maxProgress: 0.6,
    };

    const oldMedia = new Audio();
    oldMedia.setAttribute('src', '/listen-old.mp3');
    Object.defineProperties(oldMedia, {
      duration: { configurable: true, value: 180 },
      paused: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 20 },
    });
    oldMedia.play = async () => {};
    oldMedia.pause = () => {};
    window.audio = oldMedia;
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.currentLocalSong = null;
    window.playbackTransactionManager = null;

    const originals = {
      resolvePlaybackPreparation: window.resolvePlaybackPreparation,
      prepareResolvedPlayback: window.prepareResolvedPlayback,
      confirmPreparedPlayback: window.confirmPreparedPlayback,
      ensureAudioGraphForMedia: window.ensureAudioGraphForMedia,
      applyAudioOutputToMedia: window.applyAudioOutputToMedia,
    };
    const incoming = new Audio();
    incoming.setAttribute('src', '/listen-next.mp3');
    Object.defineProperties(incoming, {
      duration: { configurable: true, value: 180 },
      paused: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 0 },
    });
    incoming.play = async () => {};
    incoming.pause = () => {};
    window.resolvePlaybackPreparation = async () => ({
      catalogSong: nextSong,
      queueSong: nextSong,
      playbackSong: nextSong,
      local: false,
      sourceUrl: '/listen-next.mp3',
      mediaUrl: '/listen-next.mp3',
      playbackProvider: 'netease',
      resolutionMode: 'catalog',
      requestedQuality: 'standard',
      data: { url: '/listen-next.mp3', level: 'standard' },
      attempts: [{ provider: 'netease', reason: 'resolved' }],
      media: incoming,
      previousAudio: oldMedia,
    });
    window.prepareResolvedPlayback = async resolved => resolved;
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async media => {
      if (media === incoming) {
        await new Promise(resolve => setTimeout(resolve, 450));
        throw new Error('listen stats gate failure');
      }
      return null;
    };
    window.applyAudioOutputToMedia = async () => null;

    const transaction = await window.playQueueAt(1);
    const afterRollback = {
      state: transaction.state,
      currentIdx: window.currentIdx,
      listenKey: window.listenSession && window.listenSession.key,
      stats: JSON.parse(JSON.stringify(window.listenStatsState)),
      storage: localStorage.getItem('mineradio-listen-stats-v1'),
    };
    const listenMsBeforeTick = window.listenSession.listenMs;
    oldMedia.currentTime = 21;
    window.listenSession.lastWallAt = Date.now() - 1000;
    window.updateListenStatsTick(false);
    const normalTickDelta = window.listenSession.listenMs - listenMsBeforeTick;

    Object.assign(window, originals);
    return {
      afterRollback,
      normalTickDelta,
      expectedOldKey: oldKey,
      initialStats,
      initialStorage,
    };
  });

  expect(result.afterRollback).toEqual({
    state: 'rolled-back',
    currentIdx: 0,
    listenKey: result.expectedOldKey,
    stats: result.initialStats,
    storage: result.initialStorage,
  });
  expect(result.normalTickDelta).toBeGreaterThan(0);
});

test('superseded commit isolates stats until the winning track commits and normal ticks resume', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.updateListenStatsTick === 'function'
  ));

  const result = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const songs = [
      {
        provider: 'netease',
        source: 'netease',
        id: 'stats-old',
        name: 'Stats Old',
        artist: 'Stats Old Artist',
      },
      {
        provider: 'netease',
        source: 'netease',
        id: 'stats-stale',
        name: 'Stats Stale',
        artist: 'Stats Stale Artist',
      },
      {
        provider: 'netease',
        source: 'netease',
        id: 'stats-winner',
        name: 'Stats Winner',
        artist: 'Stats Winner Artist',
      },
    ];
    const oldKey = window.queueItemKey(songs[0]);
    const winnerKey = window.queueItemKey(songs[2]);
    const initialStats = {
      history: [],
      songs: {},
      artists: {},
      updatedAt: 0,
    };
    localStorage.setItem('mineradio-listen-stats-v1', JSON.stringify(initialStats));
    window.listenStatsState = JSON.parse(JSON.stringify(initialStats));
    window.listenSession = {
      key: oldKey,
      song: window.listenSongSnapshot(songs[0]),
      context: { source: 'concurrent-fixture' },
      startedAt: Date.now() - 60000,
      lastWallAt: Date.now() - 1000,
      lastAudioTime: 20,
      listenMs: 50000,
      maxProgress: 0.6,
    };

    const oldMedia = new Audio();
    oldMedia.setAttribute('src', '/stats-old.mp3');
    Object.defineProperties(oldMedia, {
      duration: { configurable: true, value: 180 },
      paused: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 20 },
    });
    oldMedia.play = async () => {};
    oldMedia.pause = () => {};
    window.audio = oldMedia;
    window.playQueue = songs;
    window.currentIdx = 0;
    window.currentLocalSong = null;
    window.playbackTransactionManager = null;

    const originals = {
      resolvePlaybackPreparation: window.resolvePlaybackPreparation,
      prepareResolvedPlayback: window.prepareResolvedPlayback,
      confirmPreparedPlayback: window.confirmPreparedPlayback,
      ensureAudioGraphForMedia: window.ensureAudioGraphForMedia,
      applyAudioOutputToMedia: window.applyAudioOutputToMedia,
      attemptAudioPlay: window.attemptAudioPlay,
      completePreparedAudioHandoff: window.completePreparedAudioHandoff,
    };
    const mediaById = {};
    let staleGraphRelease;
    const staleGraphGate = new Promise(resolve => {
      staleGraphRelease = resolve;
    });
    let statsAtWinnerResolve = null;
    window.resolvePlaybackPreparation = async (idx, opts, attempt, requestQueue) => {
      const song = requestQueue[idx];
      if (song.id === 'stats-winner') {
        statsAtWinnerResolve = JSON.parse(JSON.stringify(window.listenStatsState));
      }
      const media = new Audio();
      media.setAttribute('src', `/${song.id}.mp3`);
      Object.defineProperties(media, {
        duration: { configurable: true, value: 180 },
        paused: { configurable: true, value: false },
        currentTime: { configurable: true, writable: true, value: 0 },
      });
      media.play = async () => {};
      media.pause = () => {};
      mediaById[song.id] = media;
      return {
        catalogSong: song,
        queueSong: song,
        playbackSong: song,
        local: false,
        sourceUrl: `/${song.id}.mp3`,
        mediaUrl: `/${song.id}.mp3`,
        playbackProvider: 'netease',
        resolutionMode: 'catalog',
        requestedQuality: 'standard',
        data: { url: `/${song.id}.mp3`, level: 'standard' },
        attempts: [{ provider: 'netease', reason: 'resolved' }],
        media,
        previousAudio: oldMedia,
      };
    };
    window.prepareResolvedPlayback = async resolved => resolved;
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async media => {
      if (media === mediaById['stats-stale']) {
        await staleGraphGate;
      } else if (media === mediaById['stats-winner']) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      return null;
    };
    window.applyAudioOutputToMedia = async () => null;
    window.attemptAudioPlay = async () => true;
    window.completePreparedAudioHandoff = async () => false;

    const staleRequest = window.playQueueAt(1);
    await new Promise(resolve => setTimeout(resolve, 260));
    const winningRequest = window.playQueueAt(2);
    await new Promise(resolve => setTimeout(resolve, 100));
    staleGraphRelease();
    const [staleResult, winningResult] = await Promise.all([staleRequest, winningRequest]);

    const committedStats = JSON.parse(JSON.stringify(window.listenStatsState));
    const committedStorage = JSON.parse(localStorage.getItem('mineradio-listen-stats-v1'));
    const listenMsBeforeTick = window.listenSession.listenMs;
    window.audio.currentTime = 1;
    window.listenSession.lastWallAt = Date.now() - 1000;
    window.updateListenStatsTick(false);
    const normalTickDelta = window.listenSession.listenMs - listenMsBeforeTick;
    const snapshot = {
      staleState: staleResult.state,
      stale: staleResult.stale,
      winningState: winningResult.state,
      currentIdx: window.currentIdx,
      listenKey: window.listenSession && window.listenSession.key,
      statsAtWinnerResolve,
      committedStats,
      committedStorage,
      normalTickDelta,
      oldKey,
      winnerKey,
    };

    Object.assign(window, originals);
    return snapshot;
  });

  expect(result.staleState).toBe('cancelled');
  expect(result.stale).toBe(true);
  expect(result.winningState).toBe('committed');
  expect(result.currentIdx).toBe(2);
  expect(result.listenKey).toBe(result.winnerKey);
  expect(result.statsAtWinnerResolve).toEqual({
    history: [],
    songs: {},
    artists: {},
    updatedAt: 0,
  });
  expect(result.committedStats.history).toHaveLength(1);
  expect(result.committedStats.history[0].key).toBe(result.oldKey);
  expect(result.committedStats.songs[result.oldKey].plays).toBe(1);
  expect(result.committedStats.artists['Stats Old Artist'].plays).toBe(1);
  expect(result.committedStats.songs[result.winnerKey]).toBeUndefined();
  expect(result.committedStorage).toEqual(result.committedStats);
  expect(result.normalTickDelta).toBeGreaterThan(0);
});

test('audio output arbitration keeps UI preference context and media on the latest device', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.setAudioOutputDevice === 'function'
    && typeof window.refreshAudioOutputDevices === 'function'
    && window.MineradioAudioOutputState
  ));

  const result = await page.evaluate(async () => {
    const helper = window.MineradioAudioOutputState;
    const originalApply = helper.applyAuthoritativeAudioOutput;
    const originalEnumerate = navigator.mediaDevices.enumerateDevices;
    const context = {
      sinkId: '',
      async setSinkId(id) {
        this.sinkId = id;
      },
    };
    const media = new Audio();
    let mediaSink = '';
    media.setSinkId = async function(id) {
      mediaSink = id;
    };
    window.audioCtx = context;
    window.audio = media;
    window.audioReady = true;
    window.gainNode = {};
    window.audioOutputDevices = [
      { deviceId: '', label: 'System', isDefault: true },
      { deviceId: 'A', label: 'Output A', isDefault: false },
      { deviceId: 'B', label: 'Output B', isDefault: false },
    ];
    window.audioOutputDeviceId = '';
    window.audioOutputArbiter = null;
    window.renderAudioOutputDeviceUi();

    const gates = [];
    helper.applyAuthoritativeAudioOutput = async options => {
      if (options.requestedId === 'A') {
        await new Promise((resolve, reject) => {
          gates.push({ reject, resolve });
        });
      }
      context.sinkId = options.requestedId;
      mediaSink = options.requestedId;
      return {
        ok: true,
        supported: true,
        fallback: false,
        disappeared: false,
        sinkId: options.requestedId,
        reason: '',
      };
    };

    const firstA = window.setAudioOutputDevice('A');
    await Promise.resolve();
    const thenB = window.setAudioOutputDevice('B');
    await new Promise(resolve => setTimeout(resolve, 20));
    gates.shift().resolve();
    await Promise.all([firstA, thenB]);
    const rapid = {
      selected: document.getElementById('audio-output-select').value,
      preference: localStorage.getItem('mineradio-audio-output-v1'),
      contextSink: context.sinkId,
      mediaSink,
    };

    const deviceA = window.setAudioOutputDevice('A');
    await Promise.resolve();
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'audiooutput', deviceId: 'default', label: 'System' },
      { kind: 'audiooutput', deviceId: 'B', label: 'Output B' },
    ];
    window.bindAudioOutputControls();
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await new Promise(resolve => setTimeout(resolve, 20));
    gates.shift().resolve();
    await deviceA;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const arbiterState = window.audioOutputArbiter && window.audioOutputArbiter.snapshot();
      if (arbiterState && !arbiterState.applying && !arbiterState.pendingSinkId) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const disappeared = {
      selected: document.getElementById('audio-output-select').value,
      preference: localStorage.getItem('mineradio-audio-output-v1'),
      contextSink: context.sinkId,
      mediaSink,
      requested: window.audioOutputDeviceId,
    };

    helper.applyAuthoritativeAudioOutput = originalApply;
    navigator.mediaDevices.enumerateDevices = originalEnumerate;
    return { disappeared, rapid };
  });

  expect(result.rapid).toEqual({
    selected: 'B',
    preference: 'B',
    contextSink: 'B',
    mediaSink: 'B',
  });
  expect(result.disappeared).toEqual({
    selected: '',
    preference: '',
    contextSink: '',
    mediaSink: '',
    requested: '',
  });
});

test('stale output device enumeration cannot overwrite the latest selected device', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.setAudioOutputDevice === 'function'
    && typeof window.refreshAudioOutputDevices === 'function'
    && window.MineradioAudioOutputState
    && document.getElementById('audio-output-select')
  ));

  const result = await page.evaluate(async () => {
    const helper = window.MineradioAudioOutputState;
    const originalApply = helper.applyAuthoritativeAudioOutput;
    const originalEnumerate = navigator.mediaDevices.enumerateDevices;
    const originalRefresh = window.refreshAudioOutputDevices;
    const context = {
      sinkId: '',
      async setSinkId(id) {
        this.sinkId = id;
      },
    };
    const media = new Audio();
    let mediaSink = '';
    media.setSinkId = async function(id) {
      mediaSink = id;
    };
    const rawDevices = {
      latest: [
        { kind: 'audiooutput', deviceId: 'default', label: 'System' },
        { kind: 'audiooutput', deviceId: 'A', label: 'Output A' },
        { kind: 'audiooutput', deviceId: 'B', label: 'Output B' },
      ],
      stale: [
        { kind: 'audiooutput', deviceId: 'default', label: 'System' },
        { kind: 'audiooutput', deviceId: 'A', label: 'Output A' },
      ],
    };

    window.audioCtx = context;
    window.audio = media;
    window.audioReady = true;
    window.gainNode = {};
    window.audioOutputArbiter = null;
    helper.applyAuthoritativeAudioOutput = async options => {
      context.sinkId = options.requestedId;
      mediaSink = options.requestedId;
      return {
        ok: true,
        supported: true,
        fallback: false,
        disappeared: false,
        sinkId: options.requestedId,
        reason: '',
      };
    };

    async function waitFor(predicate) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      throw new Error('Timed out waiting for output-device refresh race');
    }

    async function runRace(staleRejects) {
      const enumerations = [];
      const refreshes = [];
      navigator.mediaDevices.enumerateDevices = () => new Promise((resolve, reject) => {
        enumerations.push({ reject, resolve });
      });
      window.refreshAudioOutputDevices = options => {
        const refresh = originalRefresh(options);
        refreshes.push(refresh);
        return refresh;
      };
      window.audioOutputDevices = helper.normalizeAudioOutputDevices(rawDevices.latest);
      window.audioOutputDeviceId = 'A';
      context.sinkId = 'A';
      mediaSink = 'A';
      localStorage.setItem('mineradio-audio-output-v1', 'A');
      window.renderAudioOutputDeviceUi();

      const select = document.getElementById('audio-output-select');
      select.dispatchEvent(new Event('focus'));
      await waitFor(() => enumerations.length === 1 && refreshes.length === 1);
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      await waitFor(() => enumerations.length === 2 && refreshes.length === 2);

      enumerations[1].resolve(rawDevices.latest);
      await refreshes[1];
      await window.setAudioOutputDevice('B');

      if (staleRejects) {
        enumerations[0].reject(new Error('stale enumerate failure'));
      } else {
        enumerations[0].resolve(rawDevices.stale);
      }
      await refreshes[0];
      await waitFor(() => {
        const arbiter = window.audioOutputArbiter && window.audioOutputArbiter.snapshot();
        return !arbiter || (!arbiter.applying && !arbiter.pendingSinkId);
      });

      return {
        requested: window.audioOutputDeviceId,
        preference: localStorage.getItem('mineradio-audio-output-v1'),
        contextSink: context.sinkId,
        mediaSink,
        devices: window.audioOutputDevices.map(device => device.deviceId),
        selected: select.value,
        status: document.getElementById('audio-output-status').textContent,
      };
    }

    const staleResolve = await runRace(false);
    const staleReject = await runRace(true);

    helper.applyAuthoritativeAudioOutput = originalApply;
    navigator.mediaDevices.enumerateDevices = originalEnumerate;
    window.refreshAudioOutputDevices = originalRefresh;
    return { staleReject, staleResolve };
  });

  const expected = {
    requested: 'B',
    preference: 'B',
    contextSink: 'B',
    mediaSink: 'B',
    devices: ['', 'A', 'B'],
    selected: 'B',
    status: '',
  };
  expect.soft(result.staleResolve).toEqual(expected);
  expect.soft(result.staleReject).toEqual(expected);
});

test('pagehide persists only the last committed playback session across a reversible commit', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.playQueueAt === 'function'
    && typeof window.savePlaybackSessionNow === 'function'
  ));

  const result = await page.evaluate(async () => {
    document.body.classList.remove('splash-active');
    const oldSong = {
      provider: 'netease',
      source: 'netease',
      id: 'session-old',
      name: 'Session Old',
      artist: 'Old Artist',
    };
    const nextSong = {
      provider: 'netease',
      source: 'netease',
      id: 'session-next',
      name: 'Session Next',
      artist: 'Next Artist',
    };
    const oldMedia = new Audio();
    oldMedia.setAttribute('src', '/session-old.mp3');
    Object.defineProperties(oldMedia, {
      duration: { configurable: true, value: 180 },
      paused: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 24 },
    });
    oldMedia.play = async () => {};
    oldMedia.pause = () => {};
    window.audio = oldMedia;
    window.playQueue = [oldSong, nextSong];
    window.currentIdx = 0;
    window.playing = true;
    window.currentLocalSong = null;
    window.playbackTransactionManager = null;
    window.lastCommittedSessionSnapshot = null;
    window.savePlaybackSessionNow('fixture-old');

    const originals = {
      resolvePlaybackPreparation: window.resolvePlaybackPreparation,
      prepareResolvedPlayback: window.prepareResolvedPlayback,
      confirmPreparedPlayback: window.confirmPreparedPlayback,
      ensureAudioGraphForMedia: window.ensureAudioGraphForMedia,
      applyAudioOutputToMedia: window.applyAudioOutputToMedia,
      attemptAudioPlay: window.attemptAudioPlay,
      completePreparedAudioHandoff: window.completePreparedAudioHandoff,
    };
    let graphRelease;
    let shouldFail = true;
    const incomingMedia = [];
    window.resolvePlaybackPreparation = async () => {
      const media = new Audio();
      media.setAttribute('src', '/session-next.mp3');
      media.play = async () => {};
      media.pause = () => {};
      incomingMedia.push(media);
      return {
        catalogSong: nextSong,
        queueSong: nextSong,
        playbackSong: nextSong,
        local: false,
        sourceUrl: '/session-next.mp3',
        mediaUrl: '/session-next.mp3',
        playbackProvider: 'netease',
        resolutionMode: 'catalog',
        requestedQuality: 'standard',
        data: { url: '/session-next.mp3', level: 'standard' },
        attempts: [{ provider: 'netease', reason: 'resolved' }],
        media,
        previousAudio: oldMedia,
      };
    };
    window.prepareResolvedPlayback = async resolved => resolved;
    window.confirmPreparedPlayback = async () => true;
    window.ensureAudioGraphForMedia = async media => {
      if (media !== oldMedia && shouldFail) {
        await new Promise(resolve => {
          graphRelease = resolve;
        });
        throw new Error('session gate failure');
      }
      return null;
    };
    window.applyAudioOutputToMedia = async () => null;
    window.attemptAudioPlay = async () => true;
    window.completePreparedAudioHandoff = async () => false;

    const failedSwitch = window.playQueueAt(1);
    await new Promise(resolve => setTimeout(resolve, 50));
    window.dispatchEvent(new Event('pagehide'));
    const duringCommit = JSON.parse(localStorage.getItem('mineradio-playback-session-v1'));
    graphRelease();
    const failedResult = await failedSwitch;
    const afterRollback = JSON.parse(localStorage.getItem('mineradio-playback-session-v1'));

    shouldFail = false;
    const committedResult = await window.playQueueAt(1);
    window.dispatchEvent(new Event('pagehide'));
    const afterCommit = JSON.parse(localStorage.getItem('mineradio-playback-session-v1'));
    const snapshot = {
      duringCommitId: duringCommit.queue[duringCommit.currentIdx].id,
      afterRollbackId: afterRollback.queue[afterRollback.currentIdx].id,
      afterCommitId: afterCommit.queue[afterCommit.currentIdx].id,
      failedState: failedResult.state,
      committedState: committedResult.state,
    };

    Object.assign(window, originals);
    return snapshot;
  });

  expect(result).toEqual({
    duringCommitId: 'session-old',
    afterRollbackId: 'session-old',
    afterCommitId: 'session-next',
    failedState: 'rolled-back',
    committedState: 'committed',
  });
});

test('a claimed standby cancelled before start transfers ownership and releases exactly once', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.playQueueAt === 'function');

  const result = await page.evaluate(async () => {
    const songs = [
      { provider: 'netease', source: 'netease', id: 'claim-first', name: 'First', artist: 'Artist' },
      { provider: 'netease', source: 'netease', id: 'claim-middle', name: 'Middle', artist: 'Artist' },
      { provider: 'netease', source: 'netease', id: 'claim-winner', name: 'Winner', artist: 'Artist' },
    ];
    window.playQueue = songs;
    window.currentIdx = 0;
    window.playbackTransactionManager = null;
    const originals = {
      captureCurrentPlaybackTransactionState: window.captureCurrentPlaybackTransactionState,
      restoreCurrentPlaybackTransactionState: window.restoreCurrentPlaybackTransactionState,
      resolvePlaybackPreparation: window.resolvePlaybackPreparation,
      prepareResolvedPlayback: window.prepareResolvedPlayback,
      confirmPreparedPlayback: window.confirmPreparedPlayback,
      commitPreparedPlayback: window.commitPreparedPlayback,
      finalizePreparedPlaybackCommit: window.finalizePreparedPlaybackCommit,
      releasePreparedPlayback: window.releasePreparedPlayback,
    };
    let commitEnteredResolve;
    const commitEntered = new Promise(resolve => {
      commitEnteredResolve = resolve;
    });
    let firstCommitRelease;
    const firstCommitGate = new Promise(resolve => {
      firstCommitRelease = resolve;
    });
    const releases = [];
    const claimed = {
      id: 'claimed-middle',
      media: { id: 'claimed-media' },
      requestQueue: songs,
    };
    const winner = {
      id: 'winner-prepared',
      media: { id: 'winner-media' },
      requestQueue: songs,
    };
    window.captureCurrentPlaybackTransactionState = () => ({ fixture: true });
    window.restoreCurrentPlaybackTransactionState = async () => {};
    window.resolvePlaybackPreparation = async idx => ({
      id: songs[idx].id,
      media: { id: songs[idx].id + '-media' },
      requestQueue: songs,
    });
    window.prepareResolvedPlayback = async resolved => resolved;
    window.confirmPreparedPlayback = async () => true;
    window.commitPreparedPlayback = async (idx, opts, prepared) => {
      if (prepared.id === 'claim-first') {
        commitEnteredResolve();
        await firstCommitGate;
      }
      return { song: songs[idx], media: prepared.media };
    };
    window.finalizePreparedPlaybackCommit = async () => true;
    window.releasePreparedPlayback = prepared => {
      releases.push(prepared && prepared.id);
    };

    const first = window.playQueueAt(0);
    await commitEntered;
    const middle = window.playQueueAt(1, { preparedPlayback: claimed });
    const last = window.playQueueAt(2, { preparedPlayback: winner });
    firstCommitRelease();
    const [firstResult, middleResult, lastResult] = await Promise.all([first, middle, last]);
    const snapshot = {
      states: [firstResult.state, middleResult.state, lastResult.state],
      middleStale: middleResult.stale,
      claimedReleaseCount: releases.filter(id => id === 'claimed-middle').length,
      releases,
    };

    Object.assign(window, originals);
    return snapshot;
  });

  expect(result.states).toEqual(['cancelled', 'cancelled', 'committed']);
  expect(result.middleStale).toBe(true);
  expect(result.claimedReleaseCount).toBe(1);
});

test('closed context replacement rejection keeps the old media authoritative and releases the replacement', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.ensureAudioGraphForMedia === 'function');

  const result = await page.evaluate(async () => {
    const NativeAudio = window.Audio;
    const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    const original = new NativeAudio();
    original.setAttribute('src', silentWav);
    Object.defineProperty(original, 'paused', { configurable: true, value: false });
    let oldPauseCalls = 0;
    original.pause = () => {
      oldPauseCalls += 1;
    };
    window.audioGraphRuntime = null;
    window.audioCtx = null;
    window.source = null;
    window.analyser = null;
    window.beatAnalyser = null;
    window.gainNode = null;
    window.audio = original;
    let coordinatorCurrent = original;
    window.gaplessPlaybackCoordinator = {
      cancel() {},
      setCurrent(media) {
        coordinatorCurrent = media;
      },
    };
    const first = await window.ensureAudioGraphForMedia(original);
    await first.context.close();

    let replacement = null;
    let replacementPauseCalls = 0;
    window.Audio = function() {
      replacement = new NativeAudio();
      replacement.play = async () => {
        const error = new Error('autoplay rejected');
        error.name = 'NotAllowedError';
        throw error;
      };
      replacement.pause = () => {
        replacementPauseCalls += 1;
      };
      return replacement;
    };
    let errorCode = '';
    try {
      await window.ensureAudioGraphForMedia(original);
    } catch (error) {
      errorCode = error && error.code || '';
    }
    window.Audio = NativeAudio;
    const runtimeSnapshot = window.audioGraphRuntime.snapshot();
    const snapshot = {
      errorCode,
      sameAuthoritativeMedia: window.audio === original,
      sameCoordinatorMedia: coordinatorCurrent === original,
      oldPauseCalls,
      oldHasSource: !!original.getAttribute('src'),
      replacementHasSource: !!(replacement && replacement.getAttribute('src')),
      replacementPauseCalls,
      mediaCount: runtimeSnapshot.mediaCount,
    };
    if (runtimeSnapshot.context && runtimeSnapshot.context.state !== 'closed') {
      await runtimeSnapshot.context.close();
    }
    return snapshot;
  });

  expect(result).toEqual({
    errorCode: 'AUDIO_MEDIA_REPLACEMENT_RESUME_FAILED',
    sameAuthoritativeMedia: true,
    sameCoordinatorMedia: true,
    oldPauseCalls: 0,
    oldHasSource: true,
    replacementHasSource: false,
    replacementPauseCalls: 1,
    mediaCount: 0,
  });
});

test('crossfade cancellation does not wait for a throttled interval tick', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.crossfadePlaybackMedia === 'function');

  const result = await page.evaluate(async () => {
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    let clearCalls = 0;
    window.setInterval = () => 9182;
    window.clearInterval = () => {
      clearCalls += 1;
    };
    const outgoing = {
      paused: false,
      ended: false,
      volume: 0.8,
      onended: () => {},
      pause() {},
    };
    let incomingPauseCalls = 0;
    const incoming = {
      muted: true,
      volume: 0,
      pause() {
        incomingPauseCalls += 1;
      },
    };
    let current = true;
    let cancelResolve;
    const whenCancelled = new Promise(resolve => {
      cancelResolve = resolve;
    });
    const attempt = {
      isCurrent: () => current,
      whenCancelled,
    };
    const startedAt = performance.now();
    const crossfade = window.crossfadePlaybackMedia(
      outgoing,
      incoming,
      { gaplessHandoff: true, crossfadeMs: 600 },
      { streamSupported: true },
      attempt
    ).then(
      () => ({ code: 'resolved' }),
      error => ({ code: error && error.code || 'rejected' })
    );
    current = false;
    cancelResolve();
    const outcome = await Promise.race([
      crossfade,
      new Promise(resolve => setTimeout(() => resolve({ code: 'timeout' }), 120)),
    ]);
    const elapsedMs = performance.now() - startedAt;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    return {
      code: outcome.code,
      elapsedMs,
      clearCalls,
      outgoingVolume: outgoing.volume,
      incomingPauseCalls,
    };
  });

  expect(result.code).toBe('PLAYBACK_ATTEMPT_STALE');
  expect(result.elapsedMs).toBeLessThan(100);
  expect(result.clearCalls).toBe(1);
  expect(result.outgoingVolume).toBe(0.8);
  expect(result.incomingPauseCalls).toBe(1);
});

test('audio output popover stays inside medium viewports with a visible focus ring', async ({ page }) => {
  const widths = [640, 800, 920];
  const measurements = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.body.classList.remove('splash-active');
      const row = document.getElementById('audio-output-row');
      const control = document.getElementById('volume-control');
      if (row) row.hidden = false;
      if (control) control.classList.add('open');
    });
    await page.locator('#audio-output-select').focus();
    measurements.push(await page.evaluate(() => {
      const popover = document.querySelector('.volume-popover');
      const select = document.getElementById('audio-output-select');
      const popoverBox = popover.getBoundingClientRect();
      const selectBox = select.getBoundingClientRect();
      const selectStyle = getComputedStyle(select);
      return {
        viewportWidth: window.innerWidth,
        popoverLeft: popoverBox.left,
        popoverRight: popoverBox.right,
        selectLeft: selectBox.left,
        selectRight: selectBox.right,
        focusBoxShadow: selectStyle.boxShadow,
        focusBorderColor: selectStyle.borderColor,
      };
    }));
  }

  for (const measurement of measurements) {
    expect(measurement.popoverLeft).toBeGreaterThanOrEqual(0);
    expect(measurement.popoverRight).toBeLessThanOrEqual(measurement.viewportWidth);
    expect(measurement.selectLeft).toBeGreaterThanOrEqual(measurement.popoverLeft);
    expect(measurement.selectRight).toBeLessThanOrEqual(measurement.popoverRight);
    expect(measurement.focusBoxShadow).not.toBe('none');
    expect(measurement.focusBorderColor).not.toBe('rgba(255, 255, 255, 0.1)');
  }
});

test('Cuefield adopts the normal standby without creating a second media element', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.prepareSharedNextTrackPlayback === 'function'
    && typeof window.claimSharedNextTrackPlayback === 'function'
  ));

  const result = await page.evaluate(async () => {
    const originalAudio = window.audio;
    const originalQueue = window.playQueue;
    const originalIndex = window.currentIdx;
    const originalMode = window.playMode;
    const originalResolve = window.resolvePlaybackPreparation;
    const originalCoordinator = window.gaplessPlaybackCoordinator;
    const current = { id: 'current', paused: false, src: '/current.mp3' };
    let created = 0;
    const released = [];
    window.audio = current;
    window.playQueue = [
      { provider: 'netease', id: 'current', name: 'Current' },
      { provider: 'netease', id: 'next', name: 'Next' },
    ];
    window.currentIdx = 0;
    window.playMode = 'loop';
    let resolvePreparation;
    window.resolvePlaybackPreparation = () => new Promise(resolve => {
      resolvePreparation = resolve;
    });
    window.gaplessPlaybackCoordinator = window.MineradioGaplessPlaybackState.createGaplessPlaybackCoordinator({
      createMedia() {
        created += 1;
        return {
          id: `standby-${created}`,
          src: '',
          preload: '',
          pause() {},
          removeAttribute(name) { if (name === 'src') this.src = ''; },
          load() {},
        };
      },
      prepare: async () => true,
      release(media) { released.push(media.id); },
    });
    window.gaplessPlaybackCoordinator.setCurrent(current);

    const normalPending = window.prepareSharedNextTrackPlayback({ owner: 'normal', reason: 'fixture-normal' });
    const cuefieldPending = window.prepareSharedNextTrackPlayback({
      owner: 'cuefield',
      planId: 'fixture-plan',
      index: 1,
      reason: 'fixture-cuefield',
    });
    resolvePreparation({
      sourceUrl: 'https://cdn.example/next.mp3',
      mediaUrl: '/api/audio?url=' + encodeURIComponent('https://cdn.example/next.mp3'),
      data: { url: 'https://cdn.example/next.mp3', streamSupported: true },
    });
    const [normal, cuefield] = await Promise.all([normalPending, cuefieldPending]);
    const claimed = window.claimSharedNextTrackPlayback('cuefield', 'fixture-plan', window.queueItemKey(window.playQueue[1]));
    const snapshot = {
      created,
      samePreparation: normal === cuefield,
      claimedId: claimed && claimed.media && claimed.media.id,
      owner: window.nextTrackPreloadState.owner,
      planId: window.nextTrackPreloadState.planId,
      preparedPlanId: claimed && claimed.__cuefieldPlanId,
      mediaCount: window.gaplessPlaybackCoordinator.snapshot().mediaCount,
    };

    if (claimed) window.releasePreparedPlayback(claimed);
    window.cancelNextTrackPreload('fixture-cleanup');
    window.audio = originalAudio;
    window.playQueue = originalQueue;
    window.currentIdx = originalIndex;
    window.playMode = originalMode;
    window.resolvePlaybackPreparation = originalResolve;
    window.gaplessPlaybackCoordinator = originalCoordinator;
    snapshot.released = released;
    return snapshot;
  });

  expect(result).toEqual({
    created: 1,
    samePreparation: true,
    claimedId: 'standby-1',
    owner: 'cuefield',
    planId: 'fixture-plan',
    preparedPlanId: 'fixture-plan',
    mediaCount: 1,
    released: [],
  });
});

test('Cuefield balanced mode hands one claimed preparation to the playback transaction', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.MineradioCuefield
    && window.cuefieldFeatureEnabled === true
    && typeof window.ensureCuefieldAutoMixRuntime === 'function'
    && typeof window.tickCuefieldAutoMix === 'function'
  ));

  const result = await page.evaluate(async () => {
    const original = {
      audio: window.audio,
      playQueue: window.playQueue,
      currentIdx: window.currentIdx,
      playMode: window.playMode,
      playing: window.playing,
      trackSwitchToken: window.trackSwitchToken,
      resolveContext: window.resolveCuefieldAutoMixContext,
      prepareShared: window.prepareSharedNextTrackPlayback,
      claimShared: window.claimSharedNextTrackPlayback,
      playQueueAt: window.playQueueAt,
      tick: window.tickCuefieldAutoMix,
      intensity: window.fx.cuefieldAutoMixIntensity,
    };
    if (window.cuefieldAutoMixRuntime) window.cuefieldAutoMixRuntime.destroy();
    window.cuefieldAutoMixRuntime = null;
    window.tickCuefieldAutoMix = () => {};
    const currentMedia = { paused: false, currentTime: 190, duration: 200, src: '/current.mp3' };
    const queue = [
      { provider: 'netease', id: 'a', name: 'A', duration: 200 },
      { provider: 'netease', id: 'b', name: 'B', duration: 180 },
    ];
    const boundaries = [];
    for (let time = 0; time <= 200; time += 2) {
      boundaries.push({ time, confidence: 0.92, energy: 0.62 });
    }
    const makeAnalysis = duration => ({
      duration,
      bpm: 120,
      gridStep: 0.5,
      camelot: '8A',
      downbeats: boundaries.filter(boundary => boundary.time <= duration),
      phraseBoundaries: boundaries.filter((boundary, index) => index % 8 === 0 && boundary.time <= duration),
      energyCurve: boundaries.filter(boundary => boundary.time <= duration).map(boundary => ({ time: boundary.time, value: 0.62 })),
      tempoStability: 0.92,
      beatConfidence: 0.92,
      downbeatStability: 0.9,
      dataConfidence: 0.9,
    });
    const calls = [];
    let prepared = null;
    window.audio = currentMedia;
    window.playQueue = queue;
    window.currentIdx = 0;
    window.playMode = 'loop';
    window.playing = true;
    window.trackSwitchToken = 44;
    window.fx.cuefieldAutoMixIntensity = 'balanced';
    window.resolveCuefieldAutoMixContext = async frame => ({
      fromAnalysis: makeAnalysis(200),
      toAnalysis: makeAnalysis(180),
      context: {
        token: 44,
        currentIndex: 0,
        nextIndex: frame.nextIndex,
        currentQueueKey: window.queueItemKey(queue[0]),
        nextQueueKey: window.queueItemKey(queue[1]),
        currentMedia,
        queueSnapshot: queue,
      },
    });
    window.prepareSharedNextTrackPlayback = async options => {
      calls.push(['prepare', options.owner, options.planId]);
      prepared = {
        media: { currentTime: 0 },
        previousAudio: currentMedia,
        streamSupported: true,
        __cuefieldPlanId: options.planId,
      };
      return prepared;
    };
    window.claimSharedNextTrackPlayback = (owner, planId, key) => {
      calls.push(['claim', owner, planId, key]);
      return prepared;
    };
    window.playQueueAt = async (index, options) => {
      calls.push(['handoff', index, options.cuefieldAutoMixHandoff, options.gaplessHandoff, options.crossfadeMs]);
      return { ok: true, state: 'committed' };
    };

    const runtime = window.ensureCuefieldAutoMixRuntime();
    original.tick(100);
    await runtime.settle();
    const armed = runtime.snapshot();
    currentMedia.currentTime = armed.plan.triggerAtSec;
    original.tick(200);
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    const completed = runtime.snapshot();

    runtime.destroy();
    window.cuefieldAutoMixRuntime = null;
    Object.assign(window, {
      audio: original.audio,
      playQueue: original.playQueue,
      currentIdx: original.currentIdx,
      playMode: original.playMode,
      playing: original.playing,
      trackSwitchToken: original.trackSwitchToken,
      resolveCuefieldAutoMixContext: original.resolveContext,
      prepareSharedNextTrackPlayback: original.prepareShared,
      claimSharedNextTrackPlayback: original.claimShared,
      playQueueAt: original.playQueueAt,
      tickCuefieldAutoMix: original.tick,
    });
    window.fx.cuefieldAutoMixIntensity = original.intensity;
    return {
      armedState: armed.executor.state,
      completedState: completed.executor.state,
      crossfadeMs: armed.plan.crossfadeMs,
      calls,
    };
  });

  expect(result.armedState).toBe('armed');
  expect(result.completedState).toBe('idle');
  expect(result.crossfadeMs).toBeGreaterThan(0);
  expect(result.crossfadeMs).toBeLessThanOrEqual(1200);
  expect(result.calls.map(call => call[0])).toEqual(['prepare', 'claim', 'handoff']);
  expect(result.calls[2].slice(1)).toEqual([1, true, true, result.crossfadeMs]);
});

test('Cuefield setting migrates old archives to off and persists schema 3 selections', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.setCuefieldAutoMixIntensity === 'function'
    && typeof window.normalizeFxArchiveSnapshot === 'function'
  ));

  const result = await page.evaluate(() => {
    const original = window.fx.cuefieldAutoMixIntensity;
    const migrated = window.normalizeFxArchiveSnapshot({ preset: 0 });
    window.setCuefieldAutoMixIntensity('balanced', true);
    const snapshot = window.captureFxArchiveSnapshot();
    const payload = window.userFxArchiveExportPayload({
      name: 'Cuefield fixture',
      savedAt: 1,
      snapshot,
    });
    const active = document.querySelector('#cuefield-intensity-seg [data-cuefield-intensity="balanced"]');
    const segment = document.getElementById('cuefield-intensity-seg').getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll('#cuefield-intensity-seg button')).map(button => button.getBoundingClientRect());
    const activeSelected = active.classList.contains('active');
    window.setCuefieldAutoMixIntensity(original, true);
    return {
      migrated: migrated.cuefieldAutoMixIntensity,
      stored: snapshot.cuefieldAutoMixIntensity,
      schema: payload.schema,
      active: activeSelected,
      inside: buttons.every(button => button.left >= segment.left && button.right <= segment.right),
    };
  });

  expect(result).toEqual({
    migrated: 'off',
    stored: 'balanced',
    schema: 3,
    active: true,
    inside: true,
  });
});

test('Cuefield cannot adopt a standby after ordinary playback has claimed it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    typeof window.prepareSharedNextTrackPlayback === 'function'
    && typeof window.claimSharedNextTrackPlayback === 'function'
  ));

  const result = await page.evaluate(async () => {
    const originalAudio = window.audio;
    const originalQueue = window.playQueue;
    const originalIndex = window.currentIdx;
    const originalMode = window.playMode;
    const originalResolve = window.resolvePlaybackPreparation;
    const originalCoordinator = window.gaplessPlaybackCoordinator;
    const current = { id: 'current', paused: false, src: '/current.mp3' };
    let created = 0;
    window.audio = current;
    window.playQueue = [
      { provider: 'netease', id: 'current', name: 'Current' },
      { provider: 'netease', id: 'next', name: 'Next' },
    ];
    window.currentIdx = 0;
    window.playMode = 'loop';
    window.resolvePlaybackPreparation = async () => ({
      sourceUrl: 'https://cdn.example/next.mp3',
      mediaUrl: '/api/audio?url=' + encodeURIComponent('https://cdn.example/next.mp3'),
      data: { url: 'https://cdn.example/next.mp3', streamSupported: true },
    });
    window.gaplessPlaybackCoordinator = window.MineradioGaplessPlaybackState.createGaplessPlaybackCoordinator({
      createMedia() {
        created += 1;
        return {
          id: `standby-${created}`,
          src: '',
          preload: '',
          pause() {},
          removeAttribute(name) { if (name === 'src') this.src = ''; },
          load() {},
        };
      },
      prepare: async () => true,
      release() {},
    });
    window.gaplessPlaybackCoordinator.setCurrent(current);

    await window.prepareSharedNextTrackPlayback({ owner: 'normal', reason: 'fixture-normal' });
    const claimed = window.claimSharedNextTrackPlayback(
      'normal',
      '',
      window.queueItemKey(window.playQueue[1]),
    );
    const adopted = await window.prepareSharedNextTrackPlayback({
      owner: 'cuefield',
      planId: 'late-plan',
      index: 1,
      reason: 'fixture-late-cuefield',
    });
    const snapshot = {
      adopted: adopted !== null,
      created,
      owner: window.nextTrackPreloadState.owner,
      planId: window.nextTrackPreloadState.planId,
      switching: window.nextTrackPreloadState.switching,
      claimedId: claimed && claimed.media && claimed.media.id,
    };

    if (claimed) window.releasePreparedPlayback(claimed);
    window.cancelNextTrackPreload('fixture-cleanup');
    window.audio = originalAudio;
    window.playQueue = originalQueue;
    window.currentIdx = originalIndex;
    window.playMode = originalMode;
    window.resolvePlaybackPreparation = originalResolve;
    window.gaplessPlaybackCoordinator = originalCoordinator;
    return snapshot;
  });

  expect(result).toEqual({
    adopted: false,
    created: 1,
    owner: 'normal',
    planId: '',
    switching: true,
    claimedId: 'standby-1',
  });
});

test('Cuefield releases claimed media when handoff rejects ownership synchronously', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (
    window.cuefieldFeatureEnabled === true
    && typeof window.ensureCuefieldAutoMixRuntime === 'function'
  ));

  const result = await page.evaluate(async () => {
    const original = {
      audio: window.audio,
      playQueue: window.playQueue,
      currentIdx: window.currentIdx,
      playMode: window.playMode,
      playing: window.playing,
      trackSwitchToken: window.trackSwitchToken,
      resolveContext: window.resolveCuefieldAutoMixContext,
      resolvePreparation: window.resolvePlaybackPreparation,
      coordinator: window.gaplessPlaybackCoordinator,
      playQueueAt: window.playQueueAt,
      tick: window.tickCuefieldAutoMix,
      intensity: window.fx.cuefieldAutoMixIntensity,
    };
    if (window.cuefieldAutoMixRuntime) window.cuefieldAutoMixRuntime.destroy();
    window.cuefieldAutoMixRuntime = null;
    window.tickCuefieldAutoMix = () => {};
    const currentMedia = { paused: false, currentTime: 190, duration: 200, src: '/current.mp3' };
    const queue = [
      { provider: 'netease', id: 'a', name: 'A', duration: 200 },
      { provider: 'netease', id: 'b', name: 'B', duration: 180 },
    ];
    const boundaries = [];
    for (let time = 0; time <= 200; time += 2) {
      boundaries.push({ time, confidence: 0.92, energy: 0.62 });
    }
    const makeAnalysis = duration => ({
      duration,
      bpm: 120,
      gridStep: 0.5,
      camelot: '8A',
      downbeats: boundaries.filter(boundary => boundary.time <= duration),
      phraseBoundaries: boundaries.filter((boundary, index) => index % 8 === 0 && boundary.time <= duration),
      energyCurve: boundaries.filter(boundary => boundary.time <= duration).map(boundary => ({ time: boundary.time, value: 0.62 })),
      tempoStability: 0.92,
      beatConfidence: 0.92,
      downbeatStability: 0.9,
      dataConfidence: 0.9,
    });
    let standby = null;
    const calls = [];
    window.audio = currentMedia;
    window.playQueue = queue;
    window.currentIdx = 0;
    window.playMode = 'loop';
    window.playing = true;
    window.trackSwitchToken = 91;
    window.fx.cuefieldAutoMixIntensity = 'balanced';
    window.resolveCuefieldAutoMixContext = async frame => ({
      fromAnalysis: makeAnalysis(200),
      toAnalysis: makeAnalysis(180),
      context: {
        token: 91,
        currentIndex: 0,
        nextIndex: frame.nextIndex,
        currentQueueKey: window.queueItemKey(queue[0]),
        nextQueueKey: window.queueItemKey(queue[1]),
        currentMedia,
        queueSnapshot: queue,
      },
    });
    window.resolvePlaybackPreparation = async () => ({
      sourceUrl: 'https://cdn.example/next.mp3',
      mediaUrl: '/api/audio?url=' + encodeURIComponent('https://cdn.example/next.mp3'),
      data: { url: 'https://cdn.example/next.mp3', streamSupported: true },
    });
    window.gaplessPlaybackCoordinator = window.MineradioGaplessPlaybackState.createGaplessPlaybackCoordinator({
      createMedia() {
        standby = {
          id: 'standby-1',
          src: '',
          preload: '',
          pauseCalls: 0,
          removeCalls: 0,
          loadCalls: 0,
          pause() { this.pauseCalls += 1; },
          removeAttribute(name) {
            if (name === 'src') {
              this.src = '';
              this.removeCalls += 1;
            }
          },
          load() { this.loadCalls += 1; },
        };
        return standby;
      },
      prepare: async () => true,
      release(media, reason) {
        calls.push(['coordinator-release', media.id, reason]);
      },
    });
    window.gaplessPlaybackCoordinator.setCurrent(currentMedia);
    window.playQueueAt = (index, options) => {
      if (options.cuefieldAutoMixHandoff) {
        calls.push(['handoff', index]);
        throw new Error('handoff rejected ownership');
      }
      calls.push(['fallback', index]);
      return Promise.resolve({ ok: true });
    };

    const runtime = window.ensureCuefieldAutoMixRuntime();
    const identity = window.cuefieldPlaybackIdentity(1);
    runtime.tick({ nowMs: 100, identity, playing: true, currentTimeSec: 190, nextIndex: 1 });
    await runtime.settle();
    const trigger = runtime.snapshot().plan.triggerAtSec;
    runtime.tick({ nowMs: 200, identity, playing: true, currentTimeSec: trigger, nextIndex: 1 });
    for (let attempt = 0; attempt < 20 && runtime.snapshot().executor.state !== 'idle'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const snapshot = {
      status: runtime.snapshot().status,
      state: runtime.snapshot().executor.state,
      pauseCalls: standby.pauseCalls,
      removeCalls: standby.removeCalls,
      loadCalls: standby.loadCalls,
      calls,
    };

    runtime.destroy();
    window.cuefieldAutoMixRuntime = null;
    window.cancelNextTrackPreload('fixture-cleanup');
    Object.assign(window, {
      audio: original.audio,
      playQueue: original.playQueue,
      currentIdx: original.currentIdx,
      playMode: original.playMode,
      playing: original.playing,
      trackSwitchToken: original.trackSwitchToken,
      resolveCuefieldAutoMixContext: original.resolveContext,
      resolvePlaybackPreparation: original.resolvePreparation,
      gaplessPlaybackCoordinator: original.coordinator,
      playQueueAt: original.playQueueAt,
      tickCuefieldAutoMix: original.tick,
    });
    window.fx.cuefieldAutoMixIntensity = original.intensity;
    return snapshot;
  });

  expect(result.status, JSON.stringify(result)).toBe('fallback-complete');
  expect(result.state).toBe('idle');
  expect(result.pauseCalls).toBe(1);
  expect(result.removeCalls).toBe(1);
  expect(result.loadCalls).toBe(1);
  expect(result.calls.filter(call => call[0] === 'handoff')).toHaveLength(1);
  expect(result.calls.filter(call => call[0] === 'fallback')).toHaveLength(1);
});
