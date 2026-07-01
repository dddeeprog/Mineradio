'use strict';

function createBeatmapCacheRoutes(deps) {
  deps = deps || {};
  const sendJSON = deps.sendJSON;
  const beatCacheRootInfo = deps.beatCacheRootInfo;
  const readBeatMapCache = deps.readBeatMapCache;
  const writeBeatMapCache = deps.writeBeatMapCache;
  const readRequestBody = deps.readRequestBody;

  [
    ['sendJSON', sendJSON],
    ['beatCacheRootInfo', beatCacheRootInfo],
    ['readBeatMapCache', readBeatMapCache],
    ['writeBeatMapCache', writeBeatMapCache],
    ['readRequestBody', readRequestBody],
  ].forEach(([name, fn]) => {
    if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  });

  function handleStatus(_req, res) {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
  }

  function handleRead(_req, res, url) {
    const key = url.searchParams.get('key') || '';
    try {
      const entry = readBeatMapCache(key);
      sendJSON(res, entry
        ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
        : { ok: true, hit: false, key });
    } catch (err) {
      const info = err.info || beatCacheRootInfo();
      sendJSON(res, {
        ok: false,
        hit: false,
        enabled: false,
        mode: 'memory-only',
        key,
        reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
        dir: info.dir,
      });
    }
  }

  async function handleWrite(req, res) {
    try {
      const body = await readRequestBody(req);
      sendJSON(res, writeBeatMapCache(body));
    } catch (err) {
      const info = err.info || beatCacheRootInfo();
      sendJSON(res, {
        ok: false,
        enabled: false,
        mode: 'memory-only',
        reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
        dir: info.dir,
      });
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/beatmap/cache/status') {
      handleStatus(req, res, url);
      return true;
    }
    if (pn !== '/api/beatmap/cache') return false;
    if (req.method === 'GET') {
      handleRead(req, res, url);
      return true;
    }
    if (req.method === 'POST') {
      await handleWrite(req, res, url);
      return true;
    }
    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return true;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createBeatmapCacheRoutes,
};
