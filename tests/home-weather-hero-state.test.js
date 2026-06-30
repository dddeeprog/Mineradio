const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWeatherHeroFields,
  buildWeatherAdvice,
  buildWeatherCacheState,
  buildWeatherForecastFields,
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
