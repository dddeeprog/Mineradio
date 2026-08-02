(function(root, factory) {
  var graph = root && root.MineradioWeatherLivelyGraph;
  if (typeof module === 'object' && module.exports) graph = require('./weather-lively-graph');
  var api = factory(graph || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioWeatherLivelyState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(graph) {
  var METRICS = [
    { key: 'temperature', field: 'temperature', label: '温度', suffix: '°', axisUnit: '°' },
    { key: 'apparentTemperature', field: 'apparentTemperature', label: '体感', suffix: '°', axisUnit: '°' },
    { key: 'humidity', field: 'humidity', label: '湿度', suffix: '%', axisUnit: '%' },
    { key: 'windSpeed', field: 'windSpeed', label: '风速', suffix: ' km/h', axisUnit: 'km/h', min: 0 },
    { key: 'pressure', field: 'pressure', label: '气压', suffix: ' hPa', axisUnit: 'hPa' },
    { key: 'uvIndex', field: 'uvIndex', label: 'UV', suffix: ' 级', axisUnit: '级', min: 0, max: 11 },
    { key: 'precipitationProbability', field: 'precipitationProbability', label: '降水', suffix: '%', axisUnit: '%', min: 0, max: 100 },
    { key: 'cloudCover', field: 'cloudCover', label: '云量', suffix: '%', axisUnit: '%', min: 0, max: 100 },
  ];

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return NaN;
    var n = Number(value);
    return isFinite(n) ? n : NaN;
  }

  function nullableIndex(value) {
    var n = finiteNumber(value);
    return isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  function metricByKey(key) {
    key = String(key || 'temperature');
    for (var i = 0; i < METRICS.length; i++) {
      if (METRICS[i].key === key) return METRICS[i];
    }
    return METRICS[0];
  }

  function buildWeatherMetricOptions() {
    return METRICS.map(function(metric) {
      return { key: metric.key, label: metric.label, axisUnit: metric.axisUnit };
    });
  }

  function normalizeWeatherSelection(state) {
    state = state || {};
    return {
      hoverHourIndex: nullableIndex(state.hoverHourIndex),
      lockedHourIndex: nullableIndex(state.lockedHourIndex),
      selectedDayIndex: nullableIndex(state.selectedDayIndex),
      selectedMetricKey: metricByKey(state.selectedMetricKey).key,
      expandedMetricKey: state.expandedMetricKey ? String(state.expandedMetricKey) : null,
    };
  }

  function resolveWeatherSelection(state, action) {
    var next = normalizeWeatherSelection(state);
    action = action || {};
    if (action.type === 'hoverHour') {
      next.hoverHourIndex = nullableIndex(action.index);
    } else if (action.type === 'leaveHour') {
      next.hoverHourIndex = null;
    } else if (action.type === 'clickHour') {
      var idx = nullableIndex(action.index);
      next.lockedHourIndex = next.lockedHourIndex === idx ? null : idx;
    } else if (action.type === 'clickDay') {
      var day = nullableIndex(action.index);
      next.selectedDayIndex = next.selectedDayIndex === day ? null : day;
      next.hoverHourIndex = null;
      next.lockedHourIndex = null;
    } else if (action.type === 'clickMetric') {
      var key = metricByKey(action.key).key;
      next.selectedMetricKey = key;
      next.expandedMetricKey = next.expandedMetricKey === key ? null : key;
    } else if (action.type === 'reset') {
      next = normalizeWeatherSelection({});
    }
    return next;
  }

  function weatherIconKey(code, isDay, label) {
    var n = Number(code);
    var text = String(label || '');
    var suffix = isDay === 0 ? '-night' : '-day';
    if ([95, 96, 99].includes(n) || /雷/.test(text)) return 'storm' + suffix;
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(n) || /雨/.test(text)) return 'rain' + suffix;
    if ([71, 73, 75, 77, 85, 86].includes(n) || /雪/.test(text)) return 'snow' + suffix;
    if ([45, 48].includes(n) || /雾/.test(text)) return 'fog' + suffix;
    if ([1, 2, 3].includes(n) || /云|阴/.test(text)) return 'cloud' + suffix;
    return 'clear' + suffix;
  }

  function weatherVisualProfile(weather, opts) {
    weather = weather || {};
    opts = opts || {};
    var icon = weatherIconKey(weather.weatherCode, weather.isDay, weather.label);
    var kind = icon.split('-')[0] || 'clear';
    var daylight = icon.indexOf('-night') > -1 ? 'night' : 'day';
    var reduced = !!opts.reducedMotion;
    var layers = visualLayersForKind(kind, daylight, reduced);
    return {
      key: icon,
      kind: kind,
      daylight: daylight,
      visualClass: 'weather-lively-visual-' + kind + '-' + daylight,
      layers: layers,
      ambient: {
        kind: kind,
        defaultEnabled: false,
        followWeather: true,
        duckWhenMusicPlays: true,
      },
      motion: reduced ? 'reduced' : 'live',
      reducedMotion: reduced,
    };
  }

  function layer(type, intensity, animated) {
    return { type: type, intensity: intensity, animated: animated !== false };
  }

  function visualLayersForKind(kind, daylight, reduced) {
    var animated = !reduced;
    if (kind === 'rain') return [layer('mist', 0.32, animated), layer('rain', 0.74, animated)];
    if (kind === 'snow') return [layer('glow', daylight === 'night' ? 0.20 : 0.28, animated), layer('snow', 0.58, animated)];
    if (kind === 'fog') return [layer('mist', 0.74, animated), layer('haze', 0.46, animated)];
    if (kind === 'storm') return [layer('rain', 0.68, animated), layer('flash', 0.42, animated)];
    if (kind === 'cloud') return [layer('mist', 0.40, animated), layer('cloud', 0.52, animated)];
    return [layer('glow', daylight === 'night' ? 0.22 : 0.46, animated), layer('particles', 0.22, animated)];
  }

  function allHourlyRows(weather) {
    if (Array.isArray(weather && weather.hourly)) return weather.hourly;
    if (Array.isArray(weather && weather.hourlyForecastFull)) return weather.hourlyForecastFull;
    if (Array.isArray(weather && weather.hourlyForecast)) return weather.hourlyForecast;
    return [];
  }

  function dailyRows(weather) {
    if (Array.isArray(weather && weather.daily)) return weather.daily;
    if (Array.isArray(weather && weather.dailyForecast)) return weather.dailyForecast;
    return [];
  }

  function dateKey(value) {
    var text = String(value || '');
    var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function parseTime(value) {
    var parsed = Date.parse(String(value || ''));
    return isFinite(parsed) ? parsed : NaN;
  }

  function selectRepresentativeRows(rows, limit) {
    rows = Array.isArray(rows) ? rows : [];
    limit = Math.max(1, Math.round(Number(limit) || 12));
    if (rows.length <= limit) return rows.slice();
    var step = Math.max(1, Math.ceil(rows.length / limit));
    var out = [];
    for (var i = 0; i < rows.length && out.length < limit; i += step) out.push(rows[i]);
    return out;
  }

  function rowsForSelection(weather, selection, limit) {
    var rows = allHourlyRows(weather);
    var days = dailyRows(weather);
    if (selection.selectedDayIndex != null && days[selection.selectedDayIndex]) {
      var day = days[selection.selectedDayIndex];
      var key = dateKey(day.date || day.time);
      var dayRows = rows.filter(function(row) { return dateKey(row && row.time) === key; });
      return {
        rows: selectRepresentativeRows(dayRows.length ? dayRows : rows, limit),
        scopeLabel: day.dayLabel || day.date || '未来',
      };
    }
    var now = Number(selection.now);
    if (!isFinite(now)) now = Date.now();
    var hourStart = Math.floor(now / 3600000) * 3600000;
    var future = rows.filter(function(row) {
      var time = parseTime(row && row.time);
      return isFinite(time) ? time >= hourStart : true;
    });
    return {
      rows: (future.length ? future : rows).slice(0, limit),
      scopeLabel: '未来 12 小时',
    };
  }

  function metricBounds(rows, metric) {
    var values = allHourlyRows({ hourly: rows }).map(function(row) {
      return finiteNumber(row && row[metric.field]);
    }).filter(function(n) { return isFinite(n); });
    if (metric.min != null && metric.max != null) return { min: metric.min, max: metric.max };
    var min = metric.min != null ? metric.min : (values.length ? Math.min.apply(Math, values) : 0);
    var max = metric.max != null ? metric.max : (values.length ? Math.max.apply(Math, values) : min + 1);
    if (metric.key === 'pressure' && max - min < 8) {
      min -= 4;
      max += 4;
    }
    if (max === min) max = min + 1;
    return { min: min, max: max };
  }

  function attachIconKeys(rows, weather) {
    var isDay = weather && weather.current && weather.current.isDay;
    if (isDay == null) isDay = weather && weather.isDay;
    return rows.map(function(row) {
      var copy = {};
      Object.keys(row || {}).forEach(function(key) { copy[key] = row[key]; });
      copy.iconKey = weatherIconKey(copy.weatherCode, isDay, copy.label);
      return copy;
    });
  }

  function buildLivelyWeatherGraph(weather, state) {
    weather = weather || {};
    var selection = normalizeWeatherSelection(state);
    selection.now = state && state.now;
    var metric = metricByKey(selection.selectedMetricKey);
    var sourceRows = allHourlyRows(weather);
    var selected = rowsForSelection(weather, selection, 12);
    var graphRows = attachIconKeys(selected.rows, weather);
    var bounds = metricBounds(sourceRows, metric);
    var points = graph.projectGraphPoints(graphRows, metric, bounds);
    var path = graph.buildPointPath(points);
    var smoothPath = graph.buildSmoothPath(points);
    var areaPath = graph.buildAreaPath(points, 82);
    var layers = graph.buildGraphLayers({ points: points, baselineY: 82, smoothPath: smoothPath, areaPath: areaPath });
    var selectedPoint = selection.lockedHourIndex != null ? points[selection.lockedHourIndex] || null
      : (selection.hoverHourIndex != null ? points[selection.hoverHourIndex] || null : null);
    return {
      metricKey: metric.key,
      metricLabel: metric.label,
      axisUnit: metric.axisUnit,
      scopeLabel: selected.scopeLabel,
      baselineY: 82,
      graphTopY: 30,
      graphBottomY: 70,
      minValue: bounds.min,
      maxValue: bounds.max,
      points: points,
      path: path,
      smoothPath: smoothPath,
      areaPath: areaPath,
      timeTicks: layers.timeTicks,
      iconRow: layers.iconRow,
      valueLabels: layers.valueLabels,
      selectedPoint: selectedPoint,
    };
  }

  return {
    buildLivelyWeatherGraph: buildLivelyWeatherGraph,
    buildWeatherMetricOptions: buildWeatherMetricOptions,
    normalizeWeatherSelection: normalizeWeatherSelection,
    resolveWeatherSelection: resolveWeatherSelection,
    weatherIconKey: weatherIconKey,
    weatherVisualProfile: weatherVisualProfile,
  };
});
