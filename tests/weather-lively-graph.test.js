const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAreaPath,
  buildGraphLayers,
  buildSmoothPath,
  projectGraphPoints,
} = require('../public/weather-lively-graph');

test('projects graph points into the Lively Weather safe middle band', () => {
  const rows = [
    { time: '2026-07-02T00:00', temperature: 20, weatherCode: 0, label: '晴' },
    { time: '2026-07-02T01:00', temperature: 30, weatherCode: 61, label: '雨' },
    { time: '2026-07-02T02:00', temperature: 25, weatherCode: 2, label: '少云' },
  ];
  const points = projectGraphPoints(rows, { field: 'temperature', suffix: '°' }, { min: 20, max: 30 });

  assert.equal(points.length, 3);
  assert.deepEqual(points.map((point) => point.x), [8, 50, 92]);
  points.forEach((point) => {
    assert.ok(point.y >= 30 && point.y <= 70);
    assert.match(point.valueText, /\d+°/);
  });
});

test('builds smooth line, area path and fixed graph layers safely', () => {
  const points = [
    { index: 0, x: 8, y: 70, valueText: '20°', hourTick: '00', iconKey: 'clear-day' },
    { index: 1, x: 50, y: 30, valueText: '30°', hourTick: '01', iconKey: 'rain-day' },
    { index: 2, x: 92, y: 50, valueText: '25°', hourTick: '02', iconKey: 'cloud-day' },
  ];
  const smoothPath = buildSmoothPath(points);
  const areaPath = buildAreaPath(points, 82);
  const layers = buildGraphLayers({ points, baselineY: 82, smoothPath, areaPath });

  assert.match(smoothPath, /^M8 70 C/);
  assert.equal(areaPath.endsWith(' L92 82 L8 82 Z'), true);
  assert.equal(layers.timeTicks.length, 3);
  assert.equal(layers.iconRow[0].y, 94);
  assert.equal(layers.valueLabels[1].text, '30°');
  assert.equal(layers.selectedGuide.y1, 18);
  assert.equal(layers.selectedGuide.y2, 86);
});

