const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLivelyWeatherGraph,
  buildWeatherMetricOptions,
  normalizeWeatherSelection,
  resolveWeatherSelection,
  weatherIconKey,
  weatherVisualProfile,
} = require('../public/weather-lively-state');

function sampleWeather() {
  const hourly = [];
  for (let day = 2; day <= 3; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      hourly.push({
        time: `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00`,
        temperature: day === 2 ? 20 + hour : 80 + hour,
        apparentTemperature: day === 2 ? 22 + hour : 82 + hour,
        humidity: 40 + hour,
        windSpeed: 8 + hour,
        pressure: 1000 + hour,
        uvIndex: hour / 2,
        precipitationProbability: hour * 3,
        cloudCover: 20 + hour,
        weatherCode: hour % 5 === 0 ? 61 : 0,
        label: hour % 5 === 0 ? '雨' : '晴',
      });
    }
  }
  return {
    current: { weatherCode: 61, isDay: 1, label: '雨' },
    hourly,
    daily: [
      { date: '2026-07-02', dayLabel: '今天' },
      { date: '2026-07-03', dayLabel: '明天' },
    ],
  };
}

test('normalizes selection and resolves day, metric and reset actions', () => {
  assert.deepEqual(normalizeWeatherSelection(null), {
    hoverHourIndex: null,
    lockedHourIndex: null,
    selectedDayIndex: null,
    selectedMetricKey: 'temperature',
    expandedMetricKey: null,
  });

  let state = resolveWeatherSelection(null, { type: 'clickDay', index: 1 });
  assert.equal(state.selectedDayIndex, 1);
  state = resolveWeatherSelection(state, { type: 'clickMetric', key: 'uvIndex' });
  assert.equal(state.selectedMetricKey, 'uvIndex');
  state = resolveWeatherSelection(state, { type: 'reset' });
  assert.equal(state.selectedDayIndex, null);
  assert.equal(state.selectedMetricKey, 'temperature');
});

test('builds metric options matching the 95 percent weather dashboard', () => {
  assert.deepEqual(buildWeatherMetricOptions().map((item) => item.key), [
    'temperature',
    'apparentTemperature',
    'humidity',
    'windSpeed',
    'pressure',
    'uvIndex',
    'precipitationProbability',
    'cloudCover',
  ]);
});

test('builds current and selected-day graph models with stable global bounds', () => {
  const weather = sampleWeather();
  const current = buildLivelyWeatherGraph(weather, {
    now: Date.parse('2026-07-02T08:24:00'),
    selectedMetricKey: 'temperature',
  });

  assert.equal(current.scopeLabel, '未来 12 小时');
  assert.equal(current.points.length, 12);
  assert.equal(current.points[0].time, '2026-07-02T08:00');
  assert.equal(current.minValue, 20);
  assert.equal(current.maxValue, 103);
  current.points.forEach((point) => assert.ok(point.y >= 30 && point.y <= 70));

  const selectedDay = buildLivelyWeatherGraph(weather, {
    selectedDayIndex: 1,
    selectedMetricKey: 'temperature',
  });
  assert.equal(selectedDay.scopeLabel, '明天');
  assert.equal(selectedDay.points.length, 12);
  assert.equal(selectedDay.points[0].time, '2026-07-03T00:00');
  assert.equal(selectedDay.points[11].time, '2026-07-03T22:00');
  assert.equal(selectedDay.minValue, current.minValue);
  assert.equal(selectedDay.maxValue, current.maxValue);
});

test('maps weather icons and visual profiles for major weather states', () => {
  assert.equal(weatherIconKey(0, 1, '晴'), 'clear-day');
  assert.equal(weatherIconKey(0, 0, '晴'), 'clear-night');
  assert.equal(weatherIconKey(61, 1, '雨'), 'rain-day');
  assert.equal(weatherIconKey(71, 1, '雪'), 'snow-day');
  assert.equal(weatherIconKey(45, 0, '雾'), 'fog-night');
  assert.equal(weatherIconKey(95, 1, '雷雨'), 'storm-day');

  assert.equal(weatherVisualProfile({ weatherCode: 61, isDay: 1 }).kind, 'rain');
  assert.equal(weatherVisualProfile({ weatherCode: 0, isDay: 0 }).daylight, 'night');
  assert.equal(weatherVisualProfile({ weatherCode: 95, isDay: 1 }, { reducedMotion: true }).reducedMotion, true);
});

test('builds Lively visual layers and ambient sound hints for weather states', () => {
  const clear = weatherVisualProfile({ weatherCode: 0, isDay: 1, label: '晴' });
  assert.equal(clear.visualClass, 'weather-lively-visual-clear-day');
  assert.deepEqual(clear.layers.map((layer) => layer.type), ['glow', 'particles']);
  assert.equal(clear.ambient.kind, 'clear');
  assert.equal(clear.ambient.defaultEnabled, false);

  const rain = weatherVisualProfile({ weatherCode: 61, isDay: 1, label: '雨' });
  assert.equal(rain.visualClass, 'weather-lively-visual-rain-day');
  assert.ok(rain.layers.some((layer) => layer.type === 'rain'));
  assert.equal(rain.ambient.kind, 'rain');

  const snow = weatherVisualProfile({ weatherCode: 71, isDay: 1, label: '雪' });
  assert.equal(snow.visualClass, 'weather-lively-visual-snow-day');
  assert.ok(snow.layers.some((layer) => layer.type === 'snow'));

  const fog = weatherVisualProfile({ weatherCode: 45, isDay: 0, label: '雾' });
  assert.equal(fog.visualClass, 'weather-lively-visual-fog-night');
  assert.ok(fog.layers.some((layer) => layer.type === 'mist'));

  const storm = weatherVisualProfile({ weatherCode: 95, isDay: 1, label: '雷雨' });
  assert.equal(storm.visualClass, 'weather-lively-visual-storm-day');
  assert.ok(storm.layers.some((layer) => layer.type === 'flash'));

  const reduced = weatherVisualProfile({ weatherCode: 61, isDay: 1, label: '雨' }, { reducedMotion: true });
  assert.equal(reduced.motion, 'reduced');
  assert.equal(reduced.layers.every((layer) => layer.animated === false), true);
});
