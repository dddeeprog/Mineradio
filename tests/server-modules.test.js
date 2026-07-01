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
