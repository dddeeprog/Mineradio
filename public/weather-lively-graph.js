(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioWeatherLivelyGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return NaN;
    var n = Number(value);
    return isFinite(n) ? n : NaN;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatValue(value, metric) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return '--';
    var suffix = metric && metric.suffix || '';
    if (metric && metric.key === 'pressure') return Math.round(n) + suffix;
    if (metric && metric.key === 'uvIndex') return (Math.round(n * 10) / 10) + suffix;
    return Math.round(n) + suffix;
  }

  function hourTick(time) {
    var text = String(time || '');
    var match = text.match(/T(\d{2})/);
    if (match) return match[1];
    match = text.match(/^(\d{2})/);
    return match ? match[1] : '--';
  }

  function buildPointPath(points) {
    points = Array.isArray(points) ? points : [];
    if (!points.length) return '';
    return points.map(function(point, index) {
      return (index ? 'L' : 'M') + point.x + ' ' + point.y;
    }).join(' ');
  }

  function buildSmoothPath(points) {
    points = Array.isArray(points) ? points : [];
    if (!points.length) return '';
    if (points.length === 1) return 'M' + points[0].x + ' ' + points[0].y;
    var d = 'M' + points[0].x + ' ' + points[0].y;
    for (var i = 1; i < points.length; i++) {
      var prev = points[i - 1];
      var cur = points[i];
      var midX = round2((prev.x + cur.x) / 2);
      d += ' C' + midX + ' ' + prev.y + ' ' + midX + ' ' + cur.y + ' ' + cur.x + ' ' + cur.y;
    }
    return d;
  }

  function buildAreaPath(points, baselineY) {
    points = Array.isArray(points) ? points : [];
    if (!points.length) return '';
    baselineY = isFinite(finiteNumber(baselineY)) ? Number(baselineY) : 82;
    var smooth = buildSmoothPath(points);
    return smooth + ' L' + points[points.length - 1].x + ' ' + baselineY + ' L' + points[0].x + ' ' + baselineY + ' Z';
  }

  function projectGraphPoints(rows, metric, bounds) {
    rows = Array.isArray(rows) ? rows : [];
    metric = metric || {};
    bounds = bounds || {};
    var min = finiteNumber(bounds.min);
    var max = finiteNumber(bounds.max);
    if (!isFinite(min) || !isFinite(max)) {
      var values = rows.map(function(row) { return finiteNumber(row && row[metric.field]); }).filter(function(n) { return isFinite(n); });
      min = values.length ? Math.min.apply(Math, values) : 0;
      max = values.length ? Math.max.apply(Math, values) : min + 1;
    }
    var span = Math.max(1, max - min);
    return rows.map(function(row, index) {
      var value = finiteNumber(row && row[metric.field]);
      if (!isFinite(value)) value = min;
      var x = rows.length === 1 ? 50 : 8 + index * 84 / Math.max(1, rows.length - 1);
      var y = max === min ? 50 : 70 - ((value - min) / span) * 40;
      return {
        index: index,
        x: round2(clamp(x, 0, 100)),
        y: round2(clamp(y, 30, 70)),
        value: value,
        valueText: formatValue(value, metric),
        time: row && row.time || '',
        hourTick: row && row.hourTick || hourTick(row && row.time),
        weatherCode: row && row.weatherCode,
        label: row && row.label || '',
        iconKey: row && row.iconKey || '',
        raw: row || null,
      };
    });
  }

  function buildGraphLayers(model) {
    model = model || {};
    var points = Array.isArray(model.points) ? model.points : [];
    var baselineY = isFinite(finiteNumber(model.baselineY)) ? Number(model.baselineY) : 82;
    var smoothPath = model.smoothPath || buildSmoothPath(points);
    var areaPath = model.areaPath || buildAreaPath(points, baselineY);
    return {
      path: model.path || buildPointPath(points),
      smoothPath: smoothPath,
      areaPath: areaPath,
      baselineY: baselineY,
      timeTicks: points.map(function(point) {
        return { index: point.index, x: point.x, text: point.hourTick || hourTick(point.time), time: point.time };
      }),
      iconRow: points.map(function(point) {
        return { index: point.index, x: point.x, y: 94, iconKey: point.iconKey || '', label: point.label || '' };
      }),
      valueLabels: points.map(function(point) {
        return { index: point.index, x: point.x, y: Math.max(18, point.y - 8), text: point.valueText || '--' };
      }),
      selectedGuide: { y1: 18, y2: 86 },
    };
  }

  return {
    buildAreaPath: buildAreaPath,
    buildGraphLayers: buildGraphLayers,
    buildPointPath: buildPointPath,
    buildSmoothPath: buildSmoothPath,
    projectGraphPoints: projectGraphPoints,
  };
});
