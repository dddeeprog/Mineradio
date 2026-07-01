const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'http://ip-api.com/json/';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  code = Number(code);
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code === 51 || code === 53 || code === 55) return '毛毛雨';
  if (code === 56 || code === 57) return '冻雨';
  if (code === 61 || code === 63 || code === 65) return '雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '雪';
  if (code === 80 || code === 81 || code === 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code === 95 || code === 96 || code === 99) return '雷雨';
  return '天气';
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

function buildOpenMeteoGeocodeUrl(query) {
  const u = new URL(OPEN_METEO_GEOCODE_URL);
  u.searchParams.set('name', String(query || '').trim());
  u.searchParams.set('count', '1');
  u.searchParams.set('language', 'zh');
  u.searchParams.set('format', 'json');
  return u.toString();
}

function buildOpenMeteoForecastUrl(location) {
  const u = new URL(OPEN_METEO_FORECAST_URL);
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,surface_pressure');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max');
  u.searchParams.set('forecast_days', '5');
  u.searchParams.set('timezone', location.timezone || 'auto');
  return u.toString();
}

function normalizeOpenMeteoLocation(first, raw) {
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true };
  return {
    name: first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  };
}

function locationFromParams(params) {
  params = params || {};
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    name: String(params.city || params.name || '当前位置').trim() || '当前位置',
    country: '',
    latitude: lat,
    longitude: lon,
    timezone: params.timezone || 'auto',
  };
}

function weatherHourLabel(time) {
  const text = String(time || '');
  const match = text.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return '--:--';
}

function weatherDayLabel(date, index) {
  if (index === 0) return '今天';
  if (index === 1) return '明天';
  const text = String(date || '');
  const d = new Date(`${text}T00:00:00`);
  if (!Number.isNaN(d.getTime())) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  }
  return text.slice(5) || '未来';
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeOpenMeteoHourlyForecast(hourly, currentTime, limit = 12) {
  const times = Array.isArray(hourly && hourly.time) ? hourly.time : [];
  const codes = Array.isArray(hourly && hourly.weather_code) ? hourly.weather_code : [];
  const temps = Array.isArray(hourly && hourly.temperature_2m) ? hourly.temperature_2m : [];
  const pops = Array.isArray(hourly && hourly.precipitation_probability) ? hourly.precipitation_probability : [];
  const startTime = String(currentTime || '');
  const rows = [];
  for (let i = 0; i < times.length && rows.length < limit; i++) {
    const time = String(times[i] || '');
    if (!time) continue;
    if (startTime && time < startTime) continue;
    const weatherCode = finiteOrNull(codes[i]);
    rows.push({
      time,
      hourLabel: weatherHourLabel(time),
      temperature: finiteOrNull(temps[i]),
      precipitationProbability: finiteOrNull(pops[i]),
      weatherCode,
      label: weatherCode == null ? '天气' : openMeteoWeatherLabel(weatherCode),
    });
  }
  return rows;
}

function normalizeOpenMeteoDailyForecast(daily, limit = 5) {
  const times = Array.isArray(daily && daily.time) ? daily.time : [];
  const codes = Array.isArray(daily && daily.weather_code) ? daily.weather_code : [];
  const maxTemps = Array.isArray(daily && daily.temperature_2m_max) ? daily.temperature_2m_max : [];
  const minTemps = Array.isArray(daily && daily.temperature_2m_min) ? daily.temperature_2m_min : [];
  const sunrises = Array.isArray(daily && daily.sunrise) ? daily.sunrise : [];
  const sunsets = Array.isArray(daily && daily.sunset) ? daily.sunset : [];
  const uvs = Array.isArray(daily && daily.uv_index_max) ? daily.uv_index_max : [];
  const pops = Array.isArray(daily && daily.precipitation_probability_max) ? daily.precipitation_probability_max : [];
  const rows = [];
  for (let i = 0; i < times.length && rows.length < limit; i++) {
    const date = String(times[i] || '');
    if (!date) continue;
    const weatherCode = finiteOrNull(codes[i]);
    rows.push({
      date,
      dayLabel: weatherDayLabel(date, rows.length),
      weatherCode,
      label: weatherCode == null ? '天气' : openMeteoWeatherLabel(weatherCode),
      temperatureMax: finiteOrNull(maxTemps[i]),
      temperatureMin: finiteOrNull(minTemps[i]),
      sunrise: sunrises[i] ? String(sunrises[i]) : '',
      sunset: sunsets[i] ? String(sunsets[i]) : '',
      uvIndexMax: finiteOrNull(uvs[i]),
      precipitationProbabilityMax: finiteOrNull(pops[i]),
    });
  }
  return rows;
}

function normalizeOpenMeteoWeather(body, location, date) {
  const cur = body && body.current || {};
  const dailyForecast = normalizeOpenMeteoDailyForecast(body && body.daily, 5);
  const today = dailyForecast[0] || {};
  const weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: body && body.timezone || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    windDirection: finiteOrNull(cur.wind_direction_10m),
    pressure: finiteOrNull(cur.surface_pressure),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    hourlyForecast: normalizeOpenMeteoHourlyForecast(body && body.hourly, cur.time, 12),
    dailyForecast,
    sunrise: today.sunrise || '',
    sunset: today.sunset || '',
    uvIndexMax: today.uvIndexMax == null ? null : today.uvIndexMax,
    updatedAt: Date.now(),
  };
  weather.mood = buildWeatherMood(weather, date);
  return weather;
}

function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    windDirection: null,
    pressure: null,
    isDay: null,
    time: '',
    hourlyForecast: [],
    dailyForecast: [],
    sunrise: '',
    sunset: '',
    uvIndexMax: null,
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

module.exports = {
  OPEN_METEO_FORECAST_URL,
  OPEN_METEO_GEOCODE_URL,
  WEATHER_DEFAULT_LOCATION,
  WEATHER_IP_LOCATION_URL,
  buildOpenMeteoForecastUrl,
  buildOpenMeteoGeocodeUrl,
  buildWeatherMood,
  clampNumber,
  fallbackWeatherForRadio,
  locationFromParams,
  normalizeOpenMeteoLocation,
  normalizeOpenMeteoWeather,
  openMeteoWeatherLabel,
  weatherRadioSeedQueries,
};
