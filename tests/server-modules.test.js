const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasNeteaseLoginCookie,
  normalizeCookieHeader,
  normalizeQQCookieInput,
  parseCookieString,
  qqCookieAvatar,
  qqCookieMusicKey,
  qqCookieNickname,
  qqCookiePlaybackKey,
  qqCookieUin,
  rawCookieFallback,
  readCookieFromResponse,
} = require('../server/cookies');
const {
  assertAllowedProxyTarget,
  audioContentTypeForUrl,
  audioProxyHeadersFor,
} = require('../server/proxy');
const {
  buildOpenMeteoForecastUrl,
  buildOpenMeteoGeocodeUrl,
  buildWeatherMood,
  fallbackWeatherForRadio,
  normalizeOpenMeteoWeather,
  weatherRadioSeedQueries,
} = require('../server/weather');
const {
  mapDiscoverPlaylist,
  mapSongRecord,
} = require('../server/music/netease');
const {
  mapQQPlaylistTrack,
  mapQQTrack,
  qqAlbumCover,
} = require('../server/music/qq');
const { createAppStatusRoutes } = require('../server/routes/app-status');
const { createBeatmapCacheRoutes } = require('../server/routes/beatmap-cache');
const { createDiscoverRoutes } = require('../server/routes/discover');
const { createNeteaseRoutes } = require('../server/routes/netease');
const { createPodcastRoutes } = require('../server/routes/podcast');
const { createProxyRoutes } = require('../server/routes/proxy');
const { createQQRoutes } = require('../server/routes/qq');
const { createUpdateRoutes } = require('../server/routes/update');
const { createWeatherRadioRoutes } = require('../server/routes/weather-radio');

test('cookie helpers normalize Set-Cookie style inputs and detect login cookies', () => {
  const normalized = normalizeCookieHeader([
    'MUSIC_U=abc; Path=/; HttpOnly',
    { name: '__csrf', value: 'token' },
    { os: { value: 'pc' }, empty: '' },
  ]);

  assert.equal(normalized, 'MUSIC_U=abc; __csrf=token; os=pc');
  assert.equal(rawCookieFallback(['a=1', 'b=2']), 'a=1; b=2');
  assert.equal(hasNeteaseLoginCookie(normalized), true);
  assert.equal(hasNeteaseLoginCookie('NMTID=x'), false);
  assert.equal(readCookieFromResponse({ body: { data: { cookies: ['MUSIC_U=abc; Path=/', 'NMTID=n'] } } }), 'MUSIC_U=abc; NMTID=n');
});

test('qq cookie helpers normalize web login variants', () => {
  const normalized = normalizeQQCookieInput('login_type=2; wxuin=o00012345; qm_keyst=play; ptnick_12345=%E7%95%AA%E8%8C%84');
  const obj = parseCookieString(normalized);

  assert.equal(obj.uin, '12345');
  assert.equal(qqCookieUin(obj), '12345');
  assert.equal(qqCookieMusicKey(obj), 'play');
  assert.equal(qqCookiePlaybackKey(obj), 'play');
  assert.equal(qqCookieNickname(obj, '12345'), '番茄');
  assert.match(qqCookieAvatar(obj, '12345'), /qlogo\.cn/);
});

test('proxy helpers set provider-aware audio headers and reject local targets', () => {
  assert.equal(audioContentTypeForUrl('https://cdn.example/song.flac', ''), 'audio/flac');
  assert.equal(audioContentTypeForUrl('https://cdn.example/song', 'audio/aac'), 'audio/aac');
  assert.equal(audioContentTypeForUrl('not a url', ''), 'audio/mpeg');

  const headers = audioProxyHeadersFor('https://dl.stream.qqmusic.qq.com/song.m4a', 'bytes=0-10', 'UA');
  assert.equal(headers['User-Agent'], 'UA');
  assert.equal(headers.Referer, 'https://y.qq.com/');
  assert.equal(headers.Range, 'bytes=0-10');
  assert.throws(() => assertAllowedProxyTarget('http://127.0.0.1:3000/private'), /LOCAL_NETWORK_URL_REJECTED/);
});

test('weather helpers build URLs, normalize provider payloads and produce radio moods', () => {
  assert.match(buildOpenMeteoGeocodeUrl('上海'), /name=%E4%B8%8A%E6%B5%B7/);
  const forecastUrl = buildOpenMeteoForecastUrl({ latitude: 31.2, longitude: 121.5, timezone: 'Asia/Shanghai' });
  assert.match(forecastUrl, /latitude=31\.2/);
  assert.match(forecastUrl, /current=temperature_2m/);
  assert.match(forecastUrl, /surface_pressure/);
  assert.match(forecastUrl, /wind_direction_10m/);
  assert.match(forecastUrl, /hourly=precipitation_probability/);
  assert.match(forecastUrl, /daily=weather_code/);
  assert.match(forecastUrl, /forecast_days=5/);

  const weather = normalizeOpenMeteoWeather({
    timezone: 'Asia/Shanghai',
    current: {
      weather_code: 61,
      temperature_2m: 18,
      apparent_temperature: 16,
      relative_humidity_2m: 88,
      precipitation: 1.2,
      cloud_cover: 90,
      wind_speed_10m: 12,
      wind_direction_10m: 42,
      surface_pressure: 1007.4,
      is_day: 1,
      time: '2026-06-28T09:00',
    },
    hourly: {
      time: ['2026-06-28T08:00', '2026-06-28T09:00', '2026-06-28T10:00', '2026-06-28T11:00'],
      weather_code: [3, 61, 0, null],
      temperature_2m: [17.8, 18.2, 20.3, 21.1],
      precipitation_probability: [10, 65, 5, 0],
    },
    daily: {
      time: ['2026-06-28', '2026-06-29'],
      weather_code: [61, 0],
      temperature_2m_max: [24.5, 29.2],
      temperature_2m_min: [16.4, 20.1],
      sunrise: ['2026-06-28T05:24', '2026-06-29T05:25'],
      sunset: ['2026-06-28T19:29', '2026-06-29T19:29'],
      uv_index_max: [2.4, 6.2],
      precipitation_probability_max: [81, 10],
    },
  }, { name: '上海', country: 'China', latitude: 31.2, longitude: 121.5, timezone: 'Asia/Shanghai' }, new Date('2026-06-28T09:00:00+08:00'));

  assert.equal(weather.label, '雨');
  assert.equal(weather.pressure, 1007.4);
  assert.equal(weather.windDirection, 42);
  assert.deepEqual(weather.hourlyForecast.slice(0, 2), [
    { time: '2026-06-28T09:00', hourLabel: '09:00', temperature: 18.2, precipitationProbability: 65, weatherCode: 61, label: '雨' },
    { time: '2026-06-28T10:00', hourLabel: '10:00', temperature: 20.3, precipitationProbability: 5, weatherCode: 0, label: '晴' },
  ]);
  assert.deepEqual(weather.dailyForecast[0], {
    date: '2026-06-28',
    dayLabel: '今天',
    weatherCode: 61,
    label: '雨',
    temperatureMax: 24.5,
    temperatureMin: 16.4,
    sunrise: '2026-06-28T05:24',
    sunset: '2026-06-28T19:29',
    uvIndexMax: 2.4,
    precipitationProbabilityMax: 81,
  });
  assert.equal(weather.sunrise, '2026-06-28T05:24');
  assert.equal(weather.sunset, '2026-06-28T19:29');
  assert.equal(weather.uvIndexMax, 2.4);
  assert.equal(weather.hourlyForecast[2].label, '天气');
  assert.equal(weather.mood.key, 'rain');
  assert.equal(buildWeatherMood({ weatherCode: 0, temperature: 22, isDay: 0 }, new Date('2026-06-28T22:00:00')).key, 'clear-night');
  assert.deepEqual(weatherRadioSeedQueries({ key: 'rain-night' }).slice(0, 2), ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚']);
  assert.equal(fallbackWeatherForRadio({ city: '杭州' }, new Error('offline')).location.name, '杭州');
});

test('app status route module dispatches version and login status endpoints', async () => {
  const replies = [];
  const routes = createAppStatusRoutes({
    sendJSON: (_res, body, status = 200) => replies.push({ body, status }),
    appVersionPayload: () => ({ version: '1.1.0' }),
    getLoginInfo: async () => ({ loggedIn: true }),
  });

  assert.equal(await routes.handleRoute('/api/app/version', {}, {}), true);
  assert.deepEqual(replies.pop(), { body: { version: '1.1.0' }, status: 200 });

  assert.equal(await routes.handleRoute('/api/login/status', {}, {}), true);
  assert.deepEqual(replies.pop(), { body: { loggedIn: true }, status: 200 });

  assert.equal(await routes.handleRoute('/api/search', {}, {}), false);
});

test('weather radio route module dispatches weather endpoints', async () => {
  const writes = [];
  const routes = createWeatherRadioRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    buildWeatherRadio(params) {
      return Promise.resolve({ ok: true, weather: { location: { name: params.city } }, params });
    },
    fetchIpWeatherLocation() {
      return Promise.resolve({ city: '上海', latitude: 31.2, longitude: 121.5 });
    },
  });

  const weatherUrl = new URL('http://localhost/api/weather/radio?city=杭州&lat=30.2&lon=120.2&timezone=Asia%2FShanghai');
  assert.equal(await routes.handleRoute('/api/weather/radio', {}, {}, weatherUrl), true);
  assert.deepEqual(writes[0], {
    status: 200,
    payload: {
      ok: true,
      weather: { location: { name: '杭州' } },
      params: { city: '杭州', lat: '30.2', lon: '120.2', timezone: 'Asia/Shanghai' },
    },
  });

  assert.equal(await routes.handleRoute('/api/weather/ip-location', {}, {}, new URL('http://localhost/api/weather/ip-location')), true);
  assert.deepEqual(writes[1], {
    status: 200,
    payload: { ok: true, location: { city: '上海', latitude: 31.2, longitude: 121.5 } },
  });
  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search')), false);
});

test('update route module dispatches update endpoints', async () => {
  const writes = [];
  const jobs = new Map([
    ['download-1', { id: 'download-1', createdAt: 2 }],
    ['patch-1', { id: 'patch-1', createdAt: 3, mode: 'patch' }],
  ]);
  const routes = createUpdateRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    fetchLatestUpdateInfo() {
      return Promise.resolve({ version: '9.9.9' });
    },
    localUpdateFallback(reason, opts) {
      return { ok: false, reason, configured: opts.configured };
    },
    updateConfigured: true,
    startUpdateDownloadJob(info) {
      return { ok: true, id: 'download-started', version: info.version };
    },
    startUpdatePatchJob(info) {
      return { ok: false, id: 'patch-started', version: info.version };
    },
    publicUpdateJob(job) {
      return job ? { ok: true, id: job.id, mode: job.mode || 'download' } : { ok: false };
    },
    updateDownloadJobs: jobs,
  });

  assert.equal(await routes.handleRoute('/api/update/latest', {}, {}, new URL('http://localhost/api/update/latest')), true);
  assert.deepEqual(writes[0], { status: 200, payload: { version: '9.9.9' } });
  assert.equal(await routes.handleRoute('/api/update/download', {}, {}, new URL('http://localhost/api/update/download')), true);
  assert.deepEqual(writes[1], { status: 200, payload: { ok: true, id: 'download-started', version: '9.9.9' } });
  assert.equal(await routes.handleRoute('/api/update/download/status', {}, {}, new URL('http://localhost/api/update/download/status?id=download-1')), true);
  assert.deepEqual(writes[2], { status: 200, payload: { ok: true, id: 'download-1', mode: 'download' } });
  assert.equal(await routes.handleRoute('/api/update/patch', {}, {}, new URL('http://localhost/api/update/patch')), true);
  assert.deepEqual(writes[3], { status: 400, payload: { ok: false, id: 'patch-started', version: '9.9.9' } });
  assert.equal(await routes.handleRoute('/api/update/patch/status', {}, {}, new URL('http://localhost/api/update/patch/status')), true);
  assert.deepEqual(writes[4], { status: 200, payload: { ok: true, id: 'patch-1', mode: 'patch' } });
  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search')), false);
});

test('proxy route module rejects unsafe media proxy requests', async () => {
  const writes = [];
  const res = {
    writeHead(status, headers) {
      writes.push({ type: 'head', status, headers });
    },
    end(body) {
      writes.push({ type: 'end', body });
    },
  };
  const routes = createProxyRoutes({
    port: 3000,
    userAgent: 'UA',
    corsHeadersForOrigin(origin, port) {
      return { 'Access-Control-Allow-Origin': origin || 'http://127.0.0.1:' + port };
    },
    assertAllowedProxyTarget(value) {
      if (!/^https:\/\//.test(String(value || ''))) throw new Error('INVALID');
    },
    audioProxyHeadersFor() {
      return {};
    },
    audioContentTypeForUrl() {
      return 'audio/mpeg';
    },
    fetchImpl() {
      throw new Error('fetch should not be called for invalid requests');
    },
  });

  assert.equal(await routes.handleRoute('/api/cover', { headers: { origin: 'app://local' } }, res, new URL('http://localhost/api/cover?url=http://127.0.0.1/x')), true);
  assert.equal(writes[0].status, 400);
  assert.equal(writes[1].body, 'Invalid cover url');
  writes.length = 0;

  assert.equal(await routes.handleRoute('/api/audio', { headers: { origin: 'app://local' } }, res, new URL('http://localhost/api/audio')), true);
  assert.equal(writes[0].status, 400);
  assert.equal(writes[1].body, 'Missing url');
  assert.equal(await routes.handleRoute('/api/search', {}, res, new URL('http://localhost/api/search')), false);
});

test('beatmap cache route module dispatches cache endpoints', async () => {
  const writes = [];
  const routes = createBeatmapCacheRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    beatCacheRootInfo() {
      return { allowed: true, available: true, dir: 'D:\\MineradioCache\\beatmaps', drive: 'D' };
    },
    readBeatMapCache(key) {
      return key === 'hit' ? { key, map: { beats: [1, 2] }, meta: { bpm: 120 }, savedAt: 7 } : null;
    },
    writeBeatMapCache(body) {
      return { ok: true, key: body.key || 'saved' };
    },
    readRequestBody(req) {
      return Promise.resolve(req.body || {});
    },
  });

  assert.equal(await routes.handleRoute('/api/beatmap/cache/status', { method: 'GET' }, {}, new URL('http://localhost/api/beatmap/cache/status')), true);
  assert.deepEqual(writes[0].payload, {
    enabled: true,
    dir: 'D:\\MineradioCache\\beatmaps',
    drive: 'D',
    reason: '',
    mode: 'disk',
  });
  assert.equal(await routes.handleRoute('/api/beatmap/cache', { method: 'GET' }, {}, new URL('http://localhost/api/beatmap/cache?key=hit')), true);
  assert.deepEqual(writes[1].payload, { ok: true, hit: true, key: 'hit', map: { beats: [1, 2] }, meta: { bpm: 120 }, savedAt: 7 });
  assert.equal(await routes.handleRoute('/api/beatmap/cache', { method: 'POST', body: { key: 'saved' } }, {}, new URL('http://localhost/api/beatmap/cache')), true);
  assert.deepEqual(writes[2].payload, { ok: true, key: 'saved' });
  assert.equal(await routes.handleRoute('/api/search', { method: 'GET' }, {}, new URL('http://localhost/api/search')), false);
});

test('discover route module dispatches the home discovery endpoint', async () => {
  const writes = [];
  const routes = createDiscoverRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    handleDiscoverHome() {
      return Promise.resolve({ loggedIn: true, dailySongs: [1], playlists: [2], podcasts: [3] });
    },
  });

  assert.equal(await routes.handleRoute('/api/discover/home', {}, {}, new URL('http://localhost/api/discover/home')), true);
  assert.deepEqual(writes[0], {
    status: 200,
    payload: { loggedIn: true, dailySongs: [1], playlists: [2], podcasts: [3] },
  });
  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search')), false);
});

test('qq route module dispatches QQ music endpoints', async () => {
  const writes = [];
  const saved = [];
  const calls = [];
  const routes = createQQRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    readRequestBody(req) {
      return Promise.resolve(req.body || {});
    },
    normalizeQQCookieInput(raw) {
      return String(raw || '').trim();
    },
    parseCookieString(raw) {
      return Object.fromEntries(String(raw || '').split(';').map(part => part.trim().split('=')));
    },
    qqCookieUin(obj) {
      return obj.uin || '';
    },
    qqCookieMusicKey(obj) {
      return obj.qm_keyst || '';
    },
    saveQQCookie(cookie) {
      saved.push(cookie);
    },
    getQQLoginInfo() {
      return Promise.resolve({ provider: 'qq', loggedIn: true, nickname: 'QQ' });
    },
    handleQQSearch(keywords, limit) {
      calls.push(['search', keywords, limit]);
      return Promise.resolve([{ id: 'qq-song' }]);
    },
    handleQQSongUrl(mid, mediaMid, quality) {
      calls.push(['url', mid, mediaMid, quality]);
      return Promise.resolve({ provider: 'qq', url: 'https://audio.example/song.m4a' });
    },
    handleQQLyric(mid, id) {
      calls.push(['lyric', mid, id]);
      return Promise.resolve({ provider: 'qq', lyric: 'la' });
    },
    handleQQUserPlaylists() {
      return Promise.resolve({ provider: 'qq', playlists: [] });
    },
    handleQQPlaylistTracks(id) {
      calls.push(['tracks', id]);
      return Promise.resolve({ provider: 'qq', tracks: [] });
    },
    handleQQArtistDetail(mid, limit) {
      calls.push(['artist', mid, limit]);
      return Promise.resolve({ provider: 'qq', artist: { mid }, songs: [] });
    },
    parseSongCommentLimit(raw, fallback) {
      return { limit: raw === 'all' ? 0 : fallback, unlimited: raw === 'all' };
    },
    handleQQSongComments(id, mid, limit, offset) {
      calls.push(['comments', id, mid, limit, offset]);
      return Promise.resolve({ provider: 'qq', comments: [] });
    },
  });

  assert.equal(await routes.handleRoute('/api/qq/login/status', {}, {}, new URL('http://localhost/api/qq/login/status')), true);
  assert.deepEqual(writes[0].payload, { provider: 'qq', loggedIn: true, nickname: 'QQ' });
  assert.equal(await routes.handleRoute('/api/qq/search', {}, {}, new URL('http://localhost/api/qq/search?keywords=晴天&limit=99')), true);
  assert.deepEqual(writes[1].payload, { provider: 'qq', songs: [{ id: 'qq-song' }] });
  assert.deepEqual(calls[0], ['search', '晴天', 12]);
  assert.equal(await routes.handleRoute('/api/qq/login/cookie', { body: { cookie: 'uin=123; qm_keyst=key' } }, {}, new URL('http://localhost/api/qq/login/cookie')), true);
  assert.deepEqual(saved, ['uin=123; qm_keyst=key']);
  assert.equal(writes[2].payload.saved, true);
  assert.equal(await routes.handleRoute('/api/qq/song/comments', {}, {}, new URL('http://localhost/api/qq/song/comments?id=7&mid=m&limit=all&offset=4')), true);
  assert.deepEqual(calls[calls.length - 1], ['comments', '7', 'm', 0, 4]);
  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search')), false);
});

test('podcast route module dispatches podcast endpoints', async () => {
  const writes = [];
  const calls = [];
  const routes = createPodcastRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    getUserCookie() {
      return 'MUSIC_U=1';
    },
    cloudsearch(params) {
      calls.push(['cloudsearch', params.keywords, params.limit, params.type]);
      return Promise.resolve({ body: { result: { djRadios: [{ id: 1, name: '播客' }], djRadiosCount: 1 } } });
    },
    dj_hot() {
      return Promise.resolve({ body: { djRadios: [] } });
    },
    dj_detail() {
      return Promise.resolve({ body: { data: { id: 1 } } });
    },
    dj_program() {
      return Promise.resolve({ body: { programs: [] } });
    },
    mapPodcastRadio(raw) {
      return { id: raw.id, name: raw.name || '播客' };
    },
    mapPodcastProgram(raw) {
      return { id: raw.id, name: raw.name || '节目' };
    },
    getLoginInfo() {
      return Promise.resolve({ loggedIn: false });
    },
    fetchMyPodcastItems() {
      return Promise.resolve({ items: [] });
    },
    podcastCollectionMeta(key, items) {
      return { key, count: items.length };
    },
    assertAllowedProxyTarget(value) {
      if (!/^https:\/\//.test(String(value || ''))) throw new Error('INVALID');
    },
    analyzePodcastDjStream() {
      return Promise.resolve({ beats: [] });
    },
    analyzePodcastDjIntro() {
      return Promise.resolve({ beats: [] });
    },
    userAgent: 'UA',
  });

  assert.equal(await routes.handleRoute('/api/podcast/search', {}, {}, new URL('http://localhost/api/podcast/search?keywords=故事&limit=99')), true);
  assert.deepEqual(calls[0], ['cloudsearch', '故事', 30, 1009]);
  assert.deepEqual(writes[0].payload, { podcasts: [{ id: 1, name: '播客' }], total: 1 });
  assert.equal(await routes.handleRoute('/api/podcast/my', {}, {}, new URL('http://localhost/api/podcast/my')), true);
  assert.equal(writes[1].payload.loggedIn, false);
  assert.equal(writes[1].payload.collections.length, 3);
  assert.equal(await routes.handleRoute('/api/podcast/dj-beatmap', {}, {}, new URL('http://localhost/api/podcast/dj-beatmap?url=http://127.0.0.1/a')), true);
  assert.deepEqual(writes[2].payload, { error: 'Invalid audio url' });
  assert.equal(writes[2].status, 400);
  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search')), false);
});

test('netease route module dispatches core music endpoints', async () => {
  const writes = [];
  const saved = [];
  const calls = [];
  const routes = createNeteaseRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status: status || 200 });
    },
    readRequestBody(req) {
      return Promise.resolve(req.body || {});
    },
    normalizeCookieHeader(raw) {
      return String(raw || '').trim();
    },
    parseCookieString(raw) {
      return Object.fromEntries(String(raw || '').split(';').map(part => part.trim().split('=')));
    },
    saveCookie(cookie) {
      saved.push(cookie);
    },
    getUserCookie() {
      return saved[saved.length - 1] || 'MUSIC_U=old';
    },
    getLoginInfo() {
      return Promise.resolve({ loggedIn: true, userId: 7, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' });
    },
    handleSearch(keywords, limit) {
      calls.push(['search', keywords, limit]);
      return Promise.resolve([{ id: 1, name: '晴天' }]);
    },
    handleSongUrl(id, loginInfo, quality) {
      calls.push(['songUrl', id, loginInfo.loggedIn, quality]);
      return Promise.resolve({ id, url: 'https://audio.example/song.mp3' });
    },
    readCookieFromResponse() { return ''; },
    normalizeLoginInfo(profile) { return { loggedIn: true, nickname: profile && profile.nickname || '' }; },
    login_qr_key() { return Promise.resolve({ body: { data: { unikey: 'key' } } }); },
    login_qr_create() { return Promise.resolve({ body: { data: { qrurl: 'qr' } } }); },
    login_qr_check() { return Promise.resolve({ body: { code: 801 } }); },
    logout() { return Promise.resolve({}); },
    user_playlist() { return Promise.resolve({ body: { playlist: [] } }); },
    requireLogin() { return Promise.resolve({ loggedIn: true, userId: 7 }); },
    song_like_check() { return Promise.resolve({ body: { data: {} } }); },
    likelist() { return Promise.resolve({ body: { ids: [] } }); },
    like_song() { return Promise.resolve({ body: { code: 200 } }); },
    playlist_create() { return Promise.resolve({ body: { playlist: { id: 9 } } }); },
    playlist_tracks() { return Promise.resolve({ body: { code: 200 } }); },
    playlist_track_add() { return Promise.resolve({ body: { code: 200 } }); },
    lyric_new() { return Promise.resolve({ body: { lrc: { lyric: 'la' } } }); },
    lyric() { return Promise.resolve({ body: { lrc: { lyric: 'fallback' } } }); },
    comment_music() { return Promise.resolve({ body: { total: 0, comments: [] } }); },
    parseSongCommentLimit() { return { limit: 20, unlimited: false }; },
    mapNeteaseComment(raw) { return { id: raw.commentId, content: raw.content || '' }; },
    pushUniqueSongComment(target, _seen, comment) { if (comment.content) target.push(comment); },
    artist_detail() { return Promise.resolve({ body: { artist: { id: 1, name: '歌手' } } }); },
    artist_songs() { return Promise.resolve({ body: { songs: [] } }); },
    artist_top_song() { return Promise.resolve({ body: { songs: [] } }); },
    mapSongRecord(raw) { return { id: raw.id, name: raw.name || '歌' }; },
    playlist_track_all() { return Promise.resolve({ body: { songs: [] } }); },
    playlist_detail() { return Promise.resolve({ body: { playlist: { id: 1, tracks: [] } } }); },
    normalizeApiCode(payload) { return payload && payload.code || 200; },
    normalizeApiMessage(payload) { return payload && payload.message || ''; },
  });

  assert.equal(await routes.handleRoute('/api/search', {}, {}, new URL('http://localhost/api/search?keywords=晴天&limit=2')), true);
  assert.deepEqual(writes[0].payload, { songs: [{ id: 1, name: '晴天' }] });
  assert.deepEqual(calls[0], ['search', '晴天', 2]);
  assert.equal(await routes.handleRoute('/api/song/url', {}, {}, new URL('http://localhost/api/song/url?id=1&quality=lossless')), true);
  assert.equal(writes[1].payload.loggedIn, true);
  assert.deepEqual(calls[1], ['songUrl', '1', true, 'lossless']);
  assert.equal(await routes.handleRoute('/api/login/cookie', { method: 'POST', body: { cookie: 'MUSIC_U=new' } }, {}, new URL('http://localhost/api/login/cookie')), true);
  assert.deepEqual(saved, ['MUSIC_U=new']);
  assert.equal(writes[2].payload.saved, true);
  assert.equal(await routes.handleRoute('/api/lyric', {}, {}, new URL('http://localhost/api/lyric?id=1')), true);
  assert.equal(writes[3].payload.lyric, 'la');
  assert.equal(await routes.handleRoute('/api/qq/search', {}, {}, new URL('http://localhost/api/qq/search')), false);
});

test('music mapping helpers preserve renderer-facing response shape', () => {
  assert.deepEqual(mapSongRecord({
    id: 1,
    name: '晴天',
    ar: [{ id: 2, name: '周杰伦' }],
    al: { name: '叶惠美', picUrl: 'https://img.example/cover.jpg' },
    dt: 269000,
    fee: 1,
  }), {
    provider: 'netease',
    source: 'netease',
    type: 'song',
    id: 1,
    name: '晴天',
    artist: '周杰伦',
    artists: [{ id: 2, name: '周杰伦' }],
    artistId: 2,
    album: '叶惠美',
    cover: 'https://img.example/cover.jpg',
    duration: 269000,
    fee: 1,
  });

  assert.equal(mapDiscoverPlaylist({ id: 9, name: '早晨', creator: { nickname: 'DJ' }, coverImgUrl: 'c' }, '推荐').tag, '推荐');

  const qqTrack = mapQQPlaylistTrack({
    songmid: 'mid1',
    songid: 12,
    songname: 'QQ 歌',
    singer: [{ id: 7, mid: 'singerMid', name: '歌手' }],
    album: { mid: 'albumMid', name: '专辑' },
    interval: 180,
  });
  assert.equal(qqTrack.cover, qqAlbumCover('albumMid', 300));
  assert.equal(qqTrack.duration, 180000);

  assert.equal(mapQQTrack({ mid: 'm', name: '标题', singer: [{ name: '歌手' }], album: { pmid: 'pmid' }, interval: 3 }, {}).artist, '歌手');
});
