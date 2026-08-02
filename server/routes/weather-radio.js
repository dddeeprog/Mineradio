'use strict';

function createWeatherRadioRoutes(deps) {
  deps = deps || {};
  const sendJSON = deps.sendJSON;
  const buildWeatherRadio = deps.buildWeatherRadio;
  const fetchIpWeatherLocation = deps.fetchIpWeatherLocation;

  if (typeof sendJSON !== 'function') throw new TypeError('sendJSON is required');
  if (typeof buildWeatherRadio !== 'function') throw new TypeError('buildWeatherRadio is required');
  if (typeof fetchIpWeatherLocation !== 'function') throw new TypeError('fetchIpWeatherLocation is required');

  async function handleWeatherRadio(req, res, url) {
    try {
      const data = await buildWeatherRadio({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[WeatherRadio]', err);
      sendJSON(res, {
        ok: false,
        error: err.message,
        weather: null,
        radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
      }, 500);
    }
  }

  async function handleIpLocation(_req, res) {
    try {
      sendJSON(res, { ok: true, location: await fetchIpWeatherLocation() });
    } catch (err) {
      console.error('[WeatherIpLocation]', err);
      sendJSON(res, { ok: false, error: err.message, location: null }, 500);
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/weather/radio') {
      await handleWeatherRadio(req, res, url);
      return true;
    }
    if (pn === '/api/weather/ip-location') {
      await handleIpLocation(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createWeatherRadioRoutes,
};
