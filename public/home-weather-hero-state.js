(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioHomeWeatherHeroState = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  var NO_LYRIC_TEXTS = {
    '纯音乐请欣赏': true,
    '暂无歌词': true,
    '暂无歌词敬请期待': true,
    '此歌曲为没有填词的纯音乐请您欣赏': true,
  };

  function finiteNumber(value) {
    if (value == null || value === '') return NaN;
    var n = Number(value);
    return isFinite(n) ? n : NaN;
  }

  function roundedText(value, suffix, fallback) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return fallback;
    return String(Math.round(n)) + (suffix || '');
  }

  function formatDecimal(value, suffix, fallback) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return fallback;
    var text = Math.round(n * 10) / 10;
    return String(text).replace(/\.0$/, '') + (suffix || '');
  }

  function buildWeatherHeroFields(weather, options) {
    options = options || {};
    var city = weather && weather.location && weather.location.name || options.city || '上海';
    var loading = !!options.loading;
    var label = weather && weather.label || (loading ? '正在整理天气' : '天气暂不可用');
    var mood = weather && weather.mood || {};
    return {
      city: city,
      label: label,
      temperatureText: roundedText(weather && weather.temperature, '°', '--°'),
      apparentText: '体感 ' + roundedText(weather && weather.apparentTemperature, '°', '--°'),
      humidityText: '湿度 ' + roundedText(weather && weather.humidity, '%', '--'),
      windText: isFinite(finiteNumber(weather && weather.windSpeed))
        ? ('风 ' + roundedText(weather && weather.windSpeed, ' km/h', '--') + (isFinite(finiteNumber(weather && weather.windGusts)) ? (' · 阵风 ' + roundedText(weather && weather.windGusts, ' km/h', '--')) : ''))
        : '风速 --',
      precipitationText: '降水 ' + formatDecimal(weather && weather.precipitation, ' mm', '--'),
      cloudText: '云量 ' + roundedText(weather && weather.cloudCover, '%', '--'),
      moodTitle: mood.title || '天气电台',
      moodTagline: mood.tagline || '让今天的天气替你挑一段旋律',
    };
  }

  var WEATHER_CACHE_FRESH_MS = 30 * 60 * 1000;
  var WEATHER_CACHE_STALE_MS = 6 * 60 * 60 * 1000;

  function buildWeatherCacheState(cache, now) {
    now = Number(now);
    if (!isFinite(now)) now = Date.now();
    var updatedAt = Number(cache && cache.updatedAt);
    if (!cache || !isFinite(updatedAt) || updatedAt <= 0) return { status: 'empty', ageMs: Infinity, usable: false, fresh: false };
    var ageMs = Math.max(0, now - updatedAt);
    if (ageMs <= WEATHER_CACHE_FRESH_MS) return { status: 'fresh', ageMs: ageMs, usable: true, fresh: true };
    if (ageMs <= WEATHER_CACHE_STALE_MS) return { status: 'stale', ageMs: ageMs, usable: true, fresh: false };
    return { status: 'expired', ageMs: ageMs, usable: false, fresh: false };
  }

  function buildWeatherForecastFields(weather, options) {
    options = options || {};
    var limit = Number(options.limit);
    if (!isFinite(limit) || limit <= 0) limit = 6;
    var rows = Array.isArray(weather && weather.hourlyForecast) ? weather.hourlyForecast : [];
    return rows.slice(0, limit).map(function(row) {
      var label = row && row.label || '天气';
      var temp = roundedText(row && row.temperature, '°', '--°');
      var rain = roundedText(row && row.precipitationProbability, '%', '--');
      var time = String(row && row.time || '');
      var hourLabel = row && row.hourLabel || (time.match(/T(\d{2}:\d{2})/) || [])[1] || '--:--';
      return {
        time: time,
        hourLabel: hourLabel,
        temperatureText: temp,
        rainText: rain,
        label: label,
      };
    });
  }

  function buildWeatherAdvice(weather) {
    if (!weather) {
      return [
        { title: '出行', text: '天气还在路上，先按常规通勤准备。' },
        { title: '体感', text: '等天气刷新后，会补上温度和风的建议。' },
        { title: '电台', text: '先用默认氛围歌单垫一下。' },
      ];
    }
    var label = String(weather.label || '天气');
    var temp = finiteNumber(weather.temperature);
    var apparent = finiteNumber(weather.apparentTemperature);
    var humidity = finiteNumber(weather.humidity);
    var rain = finiteNumber(weather.precipitation);
    var wind = finiteNumber(weather.windSpeed);
    var feels = isFinite(apparent) ? apparent : temp;
    var moodTitle = weather.mood && weather.mood.title || '天气电台';
    var moodTagline = weather.mood && weather.mood.tagline || '让今天的天气替你挑一段旋律';
    var rainy = /雨|雪|雷|雾/.test(label) || (isFinite(rain) && rain > 0);
    var hot = isFinite(feels) && feels >= 30;
    var cold = isFinite(feels) && feels <= 8;
    var windy = isFinite(wind) && wind >= 24;
    return [
      {
        title: '出行',
        text: rainy ? '记得带伞，路上留一点缓冲。' : (windy ? '风有点明显，外套别太轻。' : '路况适合轻装出门。'),
      },
      {
        title: '体感',
        text: hot ? '体感偏热，补水和慢节奏都安排上。' : (cold ? '体感偏冷，适合多加一层。' : (isFinite(humidity) && humidity >= 78 ? '湿度偏高，给空气留点呼吸。' : '体感稳定，适合正常节奏。')),
      },
      {
        title: moodTitle,
        text: moodTagline,
      },
    ];
  }

  function isRainCode(code) {
    code = Number(code);
    return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].indexOf(code) >= 0;
  }

  function isSnowCode(code) {
    code = Number(code);
    return [71, 73, 75, 77, 85, 86].indexOf(code) >= 0;
  }

  function isFogCode(code) {
    code = Number(code);
    return code === 45 || code === 48;
  }

  function isCloudCode(code) {
    code = Number(code);
    return code === 1 || code === 2 || code === 3;
  }

  function weatherTimeLabel(value) {
    var text = String(value || '');
    var match = text.match(/T(\d{2}:\d{2})/);
    if (match) return match[1];
    return text || '--:--';
  }

  function windDirectionText(value) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return '';
    var dirs = ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'];
    var idx = Math.round((((n % 360) + 360) % 360) / 45) % 8;
    return dirs[idx];
  }

  function clamp(value, min, max, fallback) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function clampPercent(value, fallback) {
    return Math.round(clamp(value, 0, 100, fallback == null ? 0 : fallback));
  }

  function pressurePercent(value) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return 50;
    return clampPercent(((n - 950) / 100) * 100, 50);
  }

  function uvPercent(value) {
    var n = finiteNumber(value);
    if (!isFinite(n)) return 0;
    return clampPercent((n / 11) * 100, 0);
  }

  function weatherIconKey(code, isDay, label) {
    code = finiteNumber(code);
    label = String(label || '');
    var suffix = isDay === 0 ? '-night' : '-day';
    if (isRainCode(code) || /雨|雷/.test(label)) return 'rain';
    if (isSnowCode(code) || /雪/.test(label)) return 'snow';
    if (isFogCode(code) || /雾/.test(label)) return 'fog' + suffix;
    if (isCloudCode(code) || /云|阴/.test(label)) return 'cloud' + suffix;
    return 'clear' + suffix;
  }

  var CURVE_METRICS = [
    { key: 'temperature', field: 'temperature', label: '温度', suffix: '°', axisUnit: '°', fallback: '--°', min: null, max: null },
    { key: 'precipitation', field: 'precipitationProbability', label: '降水', suffix: '%', axisUnit: '%', fallback: '--', min: 0, max: 100 },
    { key: 'humidity', field: 'humidity', label: '湿度', suffix: '%', axisUnit: '%', fallback: '--', min: 0, max: 100 },
    { key: 'windSpeed', field: 'windSpeed', label: '风速', suffix: ' km/h', axisUnit: 'km/h', fallback: '--', min: 0, max: null },
    { key: 'pressure', field: 'pressure', label: '气压', suffix: ' hPa', axisUnit: 'hPa', fallback: '--', min: null, max: null },
    { key: 'uvIndex', field: 'uvIndex', label: 'UV', suffix: ' 级', axisUnit: '级', fallback: '--', min: 0, max: 11 },
  ];

  function buildWeatherCurveMetricOptions() {
    return CURVE_METRICS.map(function(item) {
      return { key: item.key, label: item.label };
    });
  }

  function curveMetricByKey(key) {
    key = String(key || 'temperature');
    for (var i = 0; i < CURVE_METRICS.length; i++) {
      if (CURVE_METRICS[i].key === key) return CURVE_METRICS[i];
    }
    return CURVE_METRICS[0];
  }

  function metricCardToCurveMetric(key) {
    key = String(key || '');
    if (key === 'humidity') return 'humidity';
    if (key === 'wind') return 'windSpeed';
    if (key === 'uv') return 'uvIndex';
    if (key === 'pressure') return 'pressure';
    if (key === 'precipitation') return 'precipitation';
    return 'temperature';
  }

  function formatCurveValue(value, metric) {
    if (metric.key === 'temperature') return roundedText(value, metric.suffix, metric.fallback);
    if (metric.key === 'uvIndex' || metric.key === 'windSpeed' || metric.key === 'pressure') return formatDecimal(value, metric.suffix, metric.fallback);
    return roundedText(value, metric.suffix, metric.fallback);
  }

  function parseWeatherHourTime(value) {
    var text = String(value || '');
    if (!text) return NaN;
    var parsed = Date.parse(text);
    return isFinite(parsed) ? parsed : NaN;
  }

  function weatherDateKey(value) {
    var text = String(value || '');
    var match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    var parsed = parseWeatherHourTime(text);
    if (!isFinite(parsed)) return '';
    var d = new Date(parsed);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function weatherHourTick(value) {
    var label = weatherTimeLabel(value);
    var match = label.match(/^(\d{2})/);
    return match ? match[1] : '--';
  }

  function selectRepresentativeRows(rows, limit) {
    rows = Array.isArray(rows) ? rows : [];
    if (rows.length <= limit) return rows.slice(0, limit);
    var stride = Math.max(1, Math.ceil(rows.length / limit));
    var out = [];
    for (var i = 0; i < rows.length && out.length < limit; i += stride) out.push(rows[i]);
    return out;
  }

  function hourlyRowsForCurve(weather) {
    return Array.isArray(weather && weather.hourlyForecastFull) && weather.hourlyForecastFull.length
      ? weather.hourlyForecastFull
      : (Array.isArray(weather && weather.hourlyForecast) ? weather.hourlyForecast : []);
  }

  function selectHourlyRowsForCurve(weather, options, limit) {
    options = options || {};
    var fullRows = hourlyRowsForCurve(weather);
    var selectedDayIndex = Number(options.selectedDayIndex);
    if (isFinite(selectedDayIndex) && selectedDayIndex >= 0) {
      var days = Array.isArray(weather && weather.dailyForecast) ? weather.dailyForecast : [];
      var day = days[Math.round(selectedDayIndex)] || null;
      var dayKey = weatherDateKey(day && day.date);
      var dayRows = dayKey ? fullRows.filter(function(row) { return weatherDateKey(row && row.time) === dayKey; }) : [];
      return {
        rows: selectRepresentativeRows(dayRows.length ? dayRows : fullRows, limit),
        scopeLabel: day && day.dayLabel || (day && day.date) || '未来',
      };
    }
    var now = Number(options.now);
    if (!isFinite(now)) now = Date.now();
    var hourStart = Math.floor(now / 3600000) * 3600000;
    var futureRows = fullRows.filter(function(row) {
      var t = parseWeatherHourTime(row && row.time);
      return isFinite(t) ? t >= hourStart : true;
    });
    return {
      rows: (futureRows.length ? futureRows : fullRows).slice(0, limit),
      scopeLabel: '未来 12 小时',
    };
  }

  function metricBoundsForCurve(weather, metric, fallbackValues) {
    var rows = hourlyRowsForCurve(weather);
    var sourceValues = rows.map(function(row) { return finiteNumber(row && row[metric.field]); }).filter(function(n) { return isFinite(n); });
    if (!sourceValues.length) sourceValues = Array.isArray(fallbackValues) ? fallbackValues.filter(function(n) { return isFinite(n); }) : [];
    var min = metric.min == null ? (sourceValues.length ? Math.min.apply(Math, sourceValues) : 0) : metric.min;
    var max = metric.max == null ? (sourceValues.length ? Math.max.apply(Math, sourceValues) : min) : metric.max;
    if (metric.key === 'pressure' && max - min < 8) {
      min -= 4;
      max += 4;
    }
    return { min: min, max: max };
  }

  function metricItem(key, title, value, detail, icon, instrument) {
    return {
      key: key,
      title: title,
      value: value || '--',
      detail: detail || '',
      icon: icon || '',
      instrument: instrument || { type: 'none' },
    };
  }

  function buildWeatherScene(weather) {
    var code = finiteNumber(weather && weather.weatherCode);
    var label = String(weather && weather.label || '');
    var rainy = isRainCode(code) || /雨|雷/.test(label) || finiteNumber(weather && weather.precipitation) > 0;
    var snowy = isSnowCode(code) || /雪/.test(label);
    var foggy = isFogCode(code) || /雾/.test(label);
    var cloudy = isCloudCode(code) || /云|阴/.test(label);
    var daylight = weather && weather.isDay === 0 ? 'night' : 'day';
    var base = rainy ? 'rain' : (snowy ? 'snow' : (foggy ? 'fog' : (cloudy ? 'cloud' : 'clear')));
    return {
      key: base + '-' + daylight,
      base: base,
      daylight: daylight,
      className: 'home-weather-scene weather-scene-' + base + ' weather-scene-' + daylight,
    };
  }

  function buildWeatherAlert(weather) {
    if (!weather) return { title: '天气提醒', text: '天气正在刷新，先按常规出行准备。', tone: 'neutral' };
    var label = String(weather.label || '');
    var rain = finiteNumber(weather.precipitation);
    var humidity = finiteNumber(weather.humidity);
    var wind = Math.max(finiteNumber(weather.windSpeed), finiteNumber(weather.windGusts));
    var uv = finiteNumber(weather.uvIndexMax);
    var code = finiteNumber(weather.weatherCode);
    if (isRainCode(code) || /雨|雷/.test(label) || rain > 0) {
      return { title: '天气提醒', text: humidity >= 80 ? '湿度较高，请注意通风换气，保持室内干燥。' : '有降雨概率，出门记得带伞。', tone: 'rain' };
    }
    if (wind >= 28) return { title: '天气提醒', text: '风力偏强，轻薄外套和帽子要收好。', tone: 'wind' };
    if (uv >= 6) return { title: '天气提醒', text: '紫外线偏强，外出注意防晒。', tone: 'uv' };
    if (humidity >= 80) return { title: '天气提醒', text: '湿度偏高，适合开窗或除湿。', tone: 'humid' };
    return { title: '天气提醒', text: '天气状态平稳，适合按原计划出门。', tone: 'calm' };
  }

  function buildWeatherMetrics(weather, selectedDay) {
    weather = weather || {};
    var day = selectedDay && selectedDay.date ? selectedDay : null;
    if (day) {
      return [
        metricItem('humidity', '高低温', roundedText(day.temperatureMin, '°', '--') + ' / ' + roundedText(day.temperatureMax, '°', '--'), day.label || '未来天气', 'thermo', { type: 'split', primary: clampPercent(day.temperatureMax, 0), secondary: clampPercent(day.temperatureMin, 0) }),
        metricItem('wind', '天气', day.label || '天气', day.dayLabel || day.date || '', 'wind', { type: 'icon', iconKey: weatherIconKey(day.weatherCode, 1, day.label) }),
        metricItem('sun', '日出日落', weatherTimeLabel(day.sunrise) + ' / ' + weatherTimeLabel(day.sunset), '白昼节奏', 'sun', { type: 'sunArc', progress: 50 }),
        metricItem('uv', '紫外线', roundedText(day.uvIndexMax, ' 级', '--'), '当日最高 UV 指数', 'uv', { type: 'bar', percent: uvPercent(day.uvIndexMax) }),
        metricItem('pressure', '日期', day.date ? day.date.slice(5) : '--', day.dayLabel || '未来', 'gauge', { type: 'gauge', percent: 50 }),
        metricItem('precipitation', '降水', roundedText(day.precipitationProbabilityMax, '%', '--'), '当日最高降水概率', 'drop', { type: 'split', primary: clampPercent(day.precipitationProbabilityMax, 0), secondary: 0 }),
      ];
    }
    var windDir = windDirectionText(weather.windDirection);
    var windSpeed = roundedText(weather.windSpeed, ' km/h', '--');
    var precipitation = finiteNumber(weather.precipitation);
    var rainPercent = clampPercent((isFinite(precipitation) ? precipitation : 0) * 18, 0);
    return [
      metricItem('humidity', '湿度', roundedText(weather.humidity, '%', '--'), '空气含水量', 'drop', { type: 'ring', percent: clampPercent(weather.humidity, 0) }),
      metricItem('wind', '风', (windDir ? windDir + ' ' : '') + windSpeed, isFinite(finiteNumber(weather.windGusts)) ? ('阵风 ' + roundedText(weather.windGusts, ' km/h', '--')) : '实时风速', 'wind', { type: 'compass', degrees: Math.round(clamp(weather.windDirection, 0, 359, 0)), percent: clampPercent(weather.windSpeed, 0) }),
      metricItem('sun', '日出日落', weatherTimeLabel(weather.sunrise) + ' / ' + weatherTimeLabel(weather.sunset), '今天的光照节奏', 'sun', { type: 'sunArc', progress: 50 }),
      metricItem('uv', '紫外线', roundedText(weather.uvIndexMax, ' 级', '--'), '今日最高 UV', 'uv', { type: 'bar', percent: uvPercent(weather.uvIndexMax) }),
      metricItem('pressure', '气压', roundedText(weather.pressure, ' hPa', '--'), '近地面气压', 'gauge', { type: 'gauge', percent: pressurePercent(weather.pressure) }),
      metricItem('precipitation', '降水/云量', formatDecimal(weather.precipitation, ' mm', '--'), '云量 ' + roundedText(weather.cloudCover, '%', '--'), 'drop', { type: 'split', primary: rainPercent, secondary: clampPercent(weather.cloudCover, 0) }),
    ];
  }

  function buildWeatherDailyFields(weather, options) {
    options = options || {};
    var limit = Number(options.limit);
    if (!isFinite(limit) || limit <= 0) limit = 5;
    var rows = Array.isArray(weather && weather.dailyForecast) ? weather.dailyForecast : [];
    return rows.slice(0, limit).map(function(row, index) {
      var date = String(row && row.date || '');
      return {
        date: date,
        index: index,
        dayLabel: row && row.dayLabel || (index === 0 ? '今天' : (index === 1 ? '明天' : (date.slice(5) || '未来'))),
        label: row && row.label || '天气',
        iconKey: weatherIconKey(row && row.weatherCode, weather && weather.isDay, row && row.label),
        weatherCode: row && row.weatherCode,
        highText: roundedText(row && row.temperatureMax, '°', '--'),
        lowText: roundedText(row && row.temperatureMin, '°', '--'),
        rangeText: roundedText(row && row.temperatureMin, '°', '--') + ' / ' + roundedText(row && row.temperatureMax, '°', '--'),
        rainText: roundedText(row && row.precipitationProbabilityMax, '%', '--'),
        uvText: roundedText(row && row.uvIndexMax, ' 级', '--'),
        sunriseText: weatherTimeLabel(row && row.sunrise),
        sunsetText: weatherTimeLabel(row && row.sunset),
        temperatureMax: row && row.temperatureMax,
        temperatureMin: row && row.temperatureMin,
        precipitationProbabilityMax: row && row.precipitationProbabilityMax,
        uvIndexMax: row && row.uvIndexMax,
        sunrise: row && row.sunrise,
        sunset: row && row.sunset,
      };
    });
  }

  function buildHourlyTemperatureCurve(weather, options) {
    options = options || {};
    var limit = Number(options.limit);
    if (!isFinite(limit) || limit <= 0) limit = 12;
    var metric = curveMetricByKey(options.metricKey);
    var rowSelection = selectHourlyRowsForCurve(weather, options, limit);
    var rows = rowSelection.rows;
    var values = rows.map(function(row) { return finiteNumber(row && row[metric.field]); });
    var finiteValues = values.filter(function(n) { return isFinite(n); });
    if (!rows.length || !finiteValues.length) return { metricKey: metric.key, metricLabel: metric.label, axisUnit: metric.axisUnit || metric.suffix || '', scopeLabel: rowSelection.scopeLabel || '未来 12 小时', baselineY: 82, graphTopY: 30, graphBottomY: 70, points: [], timeTicks: [], iconRow: [], valueLabels: [], minTemperature: null, maxTemperature: null, minValue: null, maxValue: null, path: '', smoothPath: '', areaPath: '', selectedPoint: null };
    var bounds = metricBoundsForCurve(weather, metric, finiteValues);
    var min = bounds.min;
    var max = bounds.max;
    var span = Math.max(1, max - min);
    var points = rows.map(function(row, index) {
      var value = values[index];
      if (!isFinite(value)) value = min;
      var x = rows.length === 1 ? 50 : 8 + index * 84 / Math.max(1, rows.length - 1);
      var y = max === min ? 50 : 70 - ((value - min) / span) * 40;
      return {
        index: index,
        x: Math.max(0, Math.min(100, Math.round(x * 100) / 100)),
        y: Math.max(0, Math.min(100, Math.round(y * 100) / 100)),
        value: value,
        valueText: formatCurveValue(value, metric),
        time: row && row.time || '',
        hourLabel: row && row.hourLabel || weatherTimeLabel(row && row.time),
        hourTick: weatherHourTick(row && row.hourLabel || row && row.time),
        temperatureText: roundedText(row && row.temperature, '°', '--'),
        rainText: roundedText(row && row.precipitationProbability, '%', '--'),
        label: row && row.label || '天气',
        iconKey: weatherIconKey(row && row.weatherCode, weather && weather.isDay, row && row.label),
        raw: row || null,
      };
    });
    function pointPath(list) {
      return list.map(function(point, index) { return (index ? 'L' : 'M') + point.x + ' ' + point.y; }).join(' ');
    }
    function smoothPointPath(list) {
      if (!list.length) return '';
      if (list.length === 1) return 'M' + list[0].x + ' ' + list[0].y;
      var d = 'M' + list[0].x + ' ' + list[0].y;
      for (var i = 1; i < list.length; i++) {
        var prev = list[i - 1];
        var point = list[i];
        var dx = (point.x - prev.x) * 0.46;
        d += ' C' + (Math.round((prev.x + dx) * 100) / 100) + ' ' + prev.y +
          ' ' + (Math.round((point.x - dx) * 100) / 100) + ' ' + point.y +
          ' ' + point.x + ' ' + point.y;
      }
      return d;
    }
    var smoothPath = smoothPointPath(points);
    var selectedIndex = Number(options.selectedIndex);
    var selectedPoint = isFinite(selectedIndex) && selectedIndex >= 0 ? points[Math.round(selectedIndex)] || null : null;
    var timeTicks = points.map(function(point) {
      return {
        index: point.index,
        x: point.x,
        text: point.hourTick,
        hourLabel: point.hourLabel,
        time: point.time,
      };
    });
    var iconRow = points.map(function(point) {
      return {
        index: point.index,
        x: point.x,
        y: 94,
        iconKey: point.iconKey,
        label: point.label,
        time: point.time,
      };
    });
    var valueLabels = points.map(function(point) {
      return {
        index: point.index,
        x: point.x,
        y: Math.max(18, point.y - 8),
        text: point.valueText,
        valueText: point.valueText,
      };
    });
    return {
      metricKey: metric.key,
      metricLabel: metric.label,
      axisUnit: metric.axisUnit || metric.suffix || '',
      scopeLabel: rowSelection.scopeLabel,
      baselineY: 82,
      graphTopY: 30,
      graphBottomY: 70,
      points: points,
      timeTicks: timeTicks,
      iconRow: iconRow,
      valueLabels: valueLabels,
      minTemperature: metric.key === 'temperature' ? min : null,
      maxTemperature: metric.key === 'temperature' ? max : null,
      minValue: min,
      maxValue: max,
      path: pointPath(points),
      smoothPath: smoothPath,
      areaPath: smoothPath ? (smoothPath + ' L' + points[points.length - 1].x + ' 82 L' + points[0].x + ' 82 Z') : '',
      selectedPoint: selectedPoint,
    };
  }

  function normalizeInteractiveWeatherSelection(state) {
    state = state || {};
    function nullableNumber(value) {
      var n = Number(value);
      return isFinite(n) && n >= 0 ? Math.round(n) : null;
    }
    return {
      hoverHourIndex: nullableNumber(state.hoverHourIndex),
      lockedHourIndex: nullableNumber(state.lockedHourIndex),
      selectedDayIndex: nullableNumber(state.selectedDayIndex),
      expandedMetricKey: state.expandedMetricKey ? String(state.expandedMetricKey) : null,
      selectedMetricKey: curveMetricByKey(state.selectedMetricKey).key,
    };
  }

  function resolveInteractiveWeatherSelection(state, action) {
    var next = normalizeInteractiveWeatherSelection(state);
    action = action || {};
    var index = Number(action.index);
    if (action.type === 'hoverHour') {
      next.hoverHourIndex = isFinite(index) && index >= 0 ? Math.round(index) : null;
    } else if (action.type === 'leaveHourly') {
      next.hoverHourIndex = null;
    } else if (action.type === 'clickHour') {
      var hourIndex = isFinite(index) && index >= 0 ? Math.round(index) : null;
      next.lockedHourIndex = next.lockedHourIndex === hourIndex ? null : hourIndex;
      next.hoverHourIndex = null;
      next.selectedDayIndex = null;
    } else if (action.type === 'clickDay') {
      var dayIndex = isFinite(index) && index >= 0 ? Math.round(index) : null;
      next.selectedDayIndex = next.selectedDayIndex === dayIndex ? null : dayIndex;
      next.lockedHourIndex = null;
      next.hoverHourIndex = null;
    } else if (action.type === 'clickMetric') {
      var key = action.key ? String(action.key) : null;
      next.expandedMetricKey = next.expandedMetricKey === key ? null : key;
      next.selectedMetricKey = metricCardToCurveMetric(key);
    } else if (action.type === 'clickCurveMetric') {
      next.selectedMetricKey = curveMetricByKey(action.key).key;
    } else if (action.type === 'reset') {
      next = { hoverHourIndex: null, lockedHourIndex: null, selectedDayIndex: null, expandedMetricKey: null, selectedMetricKey: 'temperature' };
    }
    return next;
  }

  function normalizeLyricSnippet(text) {
    var value = String(text || '')
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    var compact = value.replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
    if (!compact || NO_LYRIC_TEXTS[compact]) return '';
    return value;
  }

  function pushSnippet(out, seen, text, maxLength) {
    var value = normalizeLyricSnippet(text);
    if (!value || value.length > maxLength || seen[value]) return;
    seen[value] = true;
    out.push(value);
  }

  function collectCustomLyricSnippets(customLyricMap, out, seen, maxLength) {
    if (!customLyricMap || typeof customLyricMap !== 'object') return;
    Object.keys(customLyricMap).forEach(function(key) {
      var item = customLyricMap[key];
      var raw = typeof item === 'string' ? item : (item && item.text);
      String(raw || '').split(/\r?\n/).forEach(function(line) {
        pushSnippet(out, seen, line, maxLength);
      });
    });
  }

  function collectLyricSnippets(options) {
    options = options || {};
    var maxLength = Number(options.maxLength);
    if (!isFinite(maxLength) || maxLength <= 0) maxLength = 34;
    var out = [];
    var seen = {};
    (Array.isArray(options.currentLines) ? options.currentLines : []).forEach(function(line) {
      pushSnippet(out, seen, line && line.text, maxLength);
    });
    collectCustomLyricSnippets(options.customLyricMap, out, seen, maxLength);
    return out;
  }

  function selectRotatingLyric(snippets, previous, randomFn) {
    var list = (Array.isArray(snippets) ? snippets : []).filter(Boolean);
    if (!list.length) return '';
    var random = typeof randomFn === 'function' ? randomFn : Math.random;
    var idx = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * list.length);
    var picked = list[idx] || list[0];
    if (list.length > 1 && picked === previous) picked = list[(idx + 1) % list.length];
    return picked;
  }

  return {
    buildWeatherHeroFields: buildWeatherHeroFields,
    buildWeatherAdvice: buildWeatherAdvice,
    buildWeatherCacheState: buildWeatherCacheState,
    buildWeatherForecastFields: buildWeatherForecastFields,
    buildWeatherScene: buildWeatherScene,
    buildWeatherAlert: buildWeatherAlert,
    buildWeatherMetrics: buildWeatherMetrics,
    buildWeatherDailyFields: buildWeatherDailyFields,
    buildHourlyTemperatureCurve: buildHourlyTemperatureCurve,
    buildWeatherCurveMetricOptions: buildWeatherCurveMetricOptions,
    buildWeatherIconKey: weatherIconKey,
    resolveInteractiveWeatherSelection: resolveInteractiveWeatherSelection,
    collectLyricSnippets: collectLyricSnippets,
    selectRotatingLyric: selectRotatingLyric,
  };
});
