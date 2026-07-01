'use strict';

function createWeatherFullRoutes(deps) {
  deps = deps || {};
  const sendJSON = deps.sendJSON;
  const buildFullWeather = deps.buildFullWeather;

  if (typeof sendJSON !== 'function') throw new TypeError('sendJSON is required');
  if (typeof buildFullWeather !== 'function') throw new TypeError('buildFullWeather is required');

  async function handleWeatherFull(_req, res, url) {
    try {
      const data = await buildFullWeather({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[WeatherFull]', err);
      sendJSON(res, {
        ok: false,
        error: err.message,
        weather: null,
      }, 500);
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/weather/full') {
      await handleWeatherFull(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createWeatherFullRoutes,
};
