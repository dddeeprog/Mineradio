const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWeatherHeroFields,
  buildWeatherAdvice,
  buildWeatherCacheState,
  buildWeatherForecastFields,
  buildWeatherScene,
  buildWeatherAlert,
  buildWeatherMetrics,
  buildWeatherDailyFields,
  buildHourlyTemperatureCurve,
  resolveInteractiveWeatherSelection,
  collectLyricSnippets,
  selectRotatingLyric,
} = require('../public/home-weather-hero-state');

test('builds readable weather fields from Open-Meteo weather', () => {
  const fields = buildWeatherHeroFields({
    location: { name: '杭州' },
    label: '少云',
    temperature: 26.4,
    apparentTemperature: 28.2,
    humidity: 63,
    windSpeed: 14.6,
    windGusts: 25.2,
    precipitation: 0.8,
    cloudCover: 46,
    mood: {
      title: '黄昏电台',
      tagline: '日落把歌也调暖了一点',
    },
  }, { city: '上海' });

  assert.equal(fields.city, '杭州');
  assert.equal(fields.label, '少云');
  assert.equal(fields.temperatureText, '26°');
  assert.equal(fields.apparentText, '体感 28°');
  assert.equal(fields.humidityText, '湿度 63%');
  assert.equal(fields.windText, '风 15 km/h · 阵风 25 km/h');
  assert.equal(fields.precipitationText, '降水 0.8 mm');
  assert.equal(fields.cloudText, '云量 46%');
  assert.equal(fields.moodTitle, '黄昏电台');
  assert.equal(fields.moodTagline, '日落把歌也调暖了一点');
});

test('returns safe weather placeholders when weather is missing', () => {
  const fields = buildWeatherHeroFields(null, { city: '北京', loading: true });

  assert.equal(fields.city, '北京');
  assert.equal(fields.label, '正在整理天气');
  assert.equal(fields.temperatureText, '--°');
  assert.equal(fields.apparentText, '体感 --°');
  assert.equal(fields.humidityText, '湿度 --');
  assert.equal(fields.windText, '风速 --');
  assert.equal(fields.precipitationText, '降水 --');
  assert.equal(fields.cloudText, '云量 --');
});

test('classifies cached weather freshness for startup restore', () => {
  const now = 1_800_000_000_000;

  assert.equal(buildWeatherCacheState({ updatedAt: now - 10 * 60 * 1000 }, now).status, 'fresh');
  assert.equal(buildWeatherCacheState({ updatedAt: now - 90 * 60 * 1000 }, now).status, 'stale');
  assert.equal(buildWeatherCacheState({ updatedAt: now - 7 * 60 * 60 * 1000 }, now).status, 'expired');
  assert.equal(buildWeatherCacheState(null, now).status, 'empty');
});

test('builds six hour forecast fields and weather suggestions', () => {
  const fields = buildWeatherForecastFields({
    hourlyForecast: [
      { time: '2026-06-30T09:00', temperature: 26.1, precipitationProbability: 20, weatherCode: 2, label: '少云' },
      { time: '2026-06-30T10:00', temperature: 27.4, precipitationProbability: 48, weatherCode: 61, label: '雨' },
      { time: '2026-06-30T11:00', temperature: 29.2, precipitationProbability: 8, weatherCode: 0, label: '晴' },
      { time: '2026-06-30T12:00', temperature: 30.2, precipitationProbability: 2, weatherCode: 0, label: '晴' },
      { time: '2026-06-30T13:00', temperature: 31.3, precipitationProbability: 0, weatherCode: 1, label: '少云' },
      { time: '2026-06-30T14:00', temperature: 30.8, precipitationProbability: 5, weatherCode: 3, label: '阴' },
      { time: '2026-06-30T15:00', temperature: 30.1, precipitationProbability: 3, weatherCode: 3, label: '阴' },
    ],
  });

  assert.equal(fields.length, 6);
  assert.deepEqual(fields[0], { time: '2026-06-30T09:00', hourLabel: '09:00', temperatureText: '26°', rainText: '20%', label: '少云' });

  const advice = buildWeatherAdvice({
    label: '雨',
    temperature: 31,
    apparentTemperature: 34,
    humidity: 82,
    precipitation: 1.2,
    windSpeed: 12,
    mood: { title: '雨天电台', tagline: '留一点潮湿的空间给旋律' },
  });
  assert.equal(advice.length, 3);
  assert.match(advice[0].text + advice[1].text + advice[2].text, /伞|补水|雨天电台/);
});

test('builds weather scene, alert and dashboard metrics safely', () => {
  const weather = {
    label: '小雨',
    weatherCode: 61,
    isDay: 0,
    temperature: 23,
    apparentTemperature: 27,
    humidity: 95,
    precipitation: 1.5,
    windSpeed: 8,
    windGusts: 18,
    windDirection: 45,
    pressure: 1007,
    uvIndexMax: 1,
    sunrise: '2026-07-01T05:24',
    sunset: '2026-07-01T19:29',
  };

  const scene = buildWeatherScene(weather);
  assert.equal(scene.key, 'rain-night');
  assert.match(scene.className, /weather-scene-rain/);
  assert.match(scene.className, /weather-scene-night/);

  const alert = buildWeatherAlert(weather);
  assert.match(alert.text, /雨|湿度|通风/);

  const metrics = buildWeatherMetrics(weather);
  assert.equal(metrics.length, 6);
  assert.deepEqual(metrics.map((item) => item.key), ['apparent', 'humidity', 'wind', 'uv', 'pressure', 'sun']);
  assert.equal(metrics.find((item) => item.key === 'wind').value, '东北风 8 km/h');
  assert.equal(metrics.find((item) => item.key === 'pressure').value, '1007 hPa');
});

test('builds daily fields and switches metrics to selected day summaries', () => {
  const weather = {
    dailyForecast: [
      {
        date: '2026-07-01',
        dayLabel: '今天',
        label: '小雨',
        weatherCode: 61,
        temperatureMax: 30,
        temperatureMin: 24,
        precipitationProbabilityMax: 81,
        uvIndexMax: 2,
        sunrise: '2026-07-01T05:24',
        sunset: '2026-07-01T19:29',
      },
      {
        date: '2026-07-02',
        dayLabel: '明天',
        label: '阴',
        weatherCode: 3,
        temperatureMax: 27,
        temperatureMin: 23,
        precipitationProbabilityMax: 60,
        uvIndexMax: 4,
        sunrise: '2026-07-02T05:25',
        sunset: '2026-07-02T19:29',
      },
    ],
  };

  const days = buildWeatherDailyFields(weather, { limit: 5 });
  assert.equal(days.length, 2);
  assert.equal(days[0].rangeText, '24° / 30°');
  assert.equal(days[0].rainText, '81%');

  const metrics = buildWeatherMetrics(weather, days[1]);
  assert.equal(metrics.find((item) => item.key === 'apparent').value, '23° / 27°');
  assert.equal(metrics.find((item) => item.key === 'uv').value, '4 级');
  assert.equal(metrics.find((item) => item.key === 'sun').value, '05:25 / 19:29');
});

test('builds bounded hourly curve points for normal, flat and empty forecasts', () => {
  const curve = buildHourlyTemperatureCurve({
    hourlyForecast: [
      { time: '2026-07-01T00:00', temperature: 23, precipitationProbability: 40, label: '雨' },
      { time: '2026-07-01T01:00', temperature: 29, precipitationProbability: 5, label: '晴' },
      { time: '2026-07-01T02:00', temperature: 25, precipitationProbability: 12, label: '少云' },
    ],
  }, { limit: 3, selectedIndex: 1 });

  assert.equal(curve.points.length, 3);
  assert.equal(curve.minTemperature, 23);
  assert.equal(curve.maxTemperature, 29);
  assert.match(curve.smoothPath, /^M/);
  assert.match(curve.smoothPath, /C/);
  assert.match(curve.areaPath, /^M/);
  assert.match(curve.areaPath, /Z$/);
  assert.deepEqual(curve.selectedPoint, curve.points[1]);
  curve.points.forEach((point) => {
    assert.ok(point.x >= 0 && point.x <= 100);
    assert.ok(point.y >= 0 && point.y <= 100);
  });

  const flat = buildHourlyTemperatureCurve({ hourlyForecast: [
    { time: '2026-07-01T00:00', temperature: 25 },
    { time: '2026-07-01T01:00', temperature: 25 },
  ] });
  assert.equal(flat.points[0].y, flat.points[1].y);
  assert.match(flat.smoothPath, /^M/);
  assert.match(flat.areaPath, /Z$/);

  const empty = buildHourlyTemperatureCurve(null);
  assert.deepEqual(empty.points, []);
  assert.equal(empty.smoothPath, '');
  assert.equal(empty.areaPath, '');
  assert.equal(empty.selectedPoint, null);
});

test('resolves interactive weather selection state', () => {
  let state = resolveInteractiveWeatherSelection(null, { type: 'hoverHour', index: 2 });
  assert.equal(state.hoverHourIndex, 2);
  assert.equal(state.lockedHourIndex, null);

  state = resolveInteractiveWeatherSelection(state, { type: 'clickHour', index: 2 });
  assert.equal(state.lockedHourIndex, 2);

  state = resolveInteractiveWeatherSelection(state, { type: 'leaveHourly' });
  assert.equal(state.hoverHourIndex, null);
  assert.equal(state.lockedHourIndex, 2);

  state = resolveInteractiveWeatherSelection(state, { type: 'clickDay', index: 1 });
  assert.equal(state.selectedDayIndex, 1);
  assert.equal(state.lockedHourIndex, null);

  state = resolveInteractiveWeatherSelection(state, { type: 'clickDay', index: 1 });
  assert.equal(state.selectedDayIndex, null);

  state = resolveInteractiveWeatherSelection(state, { type: 'clickMetric', key: 'uv' });
  assert.equal(state.expandedMetricKey, 'uv');

  state = resolveInteractiveWeatherSelection(state, { type: 'reset' });
  assert.deepEqual(state, {
    hoverHourIndex: null,
    lockedHourIndex: null,
    selectedDayIndex: null,
    expandedMetricKey: null,
  });
});

test('collects current lyric snippets before local custom lyrics', () => {
  const snippets = collectLyricSnippets({
    currentLines: [
      { text: '' },
      { text: '暂无歌词' },
      { text: '第一句歌很好听' },
      { text: '这是一句特别特别特别特别特别特别特别长的歌词，会被过滤掉' },
    ],
    customLyricMap: {
      a: { text: '[00:01.00]本地歌词一\n[00:04.00]本地歌词二' },
    },
    maxLength: 20,
  });

  assert.deepEqual(snippets.slice(0, 3), ['第一句歌很好听', '本地歌词一', '本地歌词二']);
});

test('selects a rotating lyric without repeating when alternatives exist', () => {
  const snippets = ['A', 'B', 'C'];

  assert.equal(selectRotatingLyric(snippets, 'A', () => 0), 'B');
  assert.equal(selectRotatingLyric(['A'], 'A', () => 0), 'A');
  assert.equal(selectRotatingLyric([], '', () => 0), '');
});
