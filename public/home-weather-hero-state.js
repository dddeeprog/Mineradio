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
    collectLyricSnippets: collectLyricSnippets,
    selectRotatingLyric: selectRotatingLyric,
  };
});
