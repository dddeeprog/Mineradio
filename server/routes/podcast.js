'use strict';

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function createPodcastRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const getUserCookie = requireFunction(deps, 'getUserCookie');
  const cloudsearch = requireFunction(deps, 'cloudsearch');
  const djHot = requireFunction(deps, 'dj_hot');
  const djDetail = requireFunction(deps, 'dj_detail');
  const djProgram = requireFunction(deps, 'dj_program');
  const mapPodcastRadio = requireFunction(deps, 'mapPodcastRadio');
  const mapPodcastProgram = requireFunction(deps, 'mapPodcastProgram');
  const getLoginInfo = requireFunction(deps, 'getLoginInfo');
  const fetchMyPodcastItems = requireFunction(deps, 'fetchMyPodcastItems');
  const podcastCollectionMeta = requireFunction(deps, 'podcastCollectionMeta');
  const assertAllowedProxyTarget = requireFunction(deps, 'assertAllowedProxyTarget');
  const analyzePodcastDjStream = requireFunction(deps, 'analyzePodcastDjStream');
  const analyzePodcastDjIntro = requireFunction(deps, 'analyzePodcastDjIntro');
  const userAgent = deps.userAgent || '';

  function cookie() {
    return getUserCookie() || '';
  }

  async function handleSearch(_req, res, url) {
    try {
      const kw = String(url.searchParams.get('keywords') || '').trim();
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      if (!kw) {
        sendJSON(res, { podcasts: [] });
        return;
      }
      const r = await cloudsearch({ keywords: kw, type: 1009, limit, cookie: cookie(), timestamp: Date.now() });
      const result = (r.body && r.body.result) || {};
      const raw = result.djRadios || result.djradios || result.radios || [];
      const podcasts = raw.map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, total: result.djRadiosCount || result.djradiosCount || podcasts.length });
    } catch (err) {
      console.error('[PodcastSearch]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
  }

  async function handleHot(_req, res, url) {
    try {
      const limit = Math.max(6, Math.min(30, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await djHot({ limit, offset, cookie: cookie(), timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.djRadios || body.djradios || body.radios || body.data || [];
      const podcasts = (Array.isArray(raw) ? raw : []).map(mapPodcastRadio).filter(p => p.id);
      sendJSON(res, { podcasts, more: !!body.hasMore });
    } catch (err) {
      console.error('[PodcastHot]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
  }

  async function handleDetail(_req, res, url) {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) {
        sendJSON(res, { error: 'Missing podcast id' }, 400);
        return;
      }
      const r = await djDetail({ rid, cookie: cookie(), timestamp: Date.now() });
      const body = r.body || {};
      const radio = mapPodcastRadio(body.data || body.djRadio || body.radio || body);
      sendJSON(res, { podcast: radio });
    } catch (err) {
      console.error('[PodcastDetail]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handlePrograms(_req, res, url) {
    try {
      const rid = url.searchParams.get('id') || url.searchParams.get('rid');
      if (!rid) {
        sendJSON(res, { error: 'Missing podcast id', programs: [] }, 400);
        return;
      }
      const limit = Math.max(10, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      const r = await djProgram({ rid, limit, offset, asc: false, cookie: cookie(), timestamp: Date.now() });
      const body = r.body || {};
      const raw = body.programs || (body.data && (body.data.list || body.data.programs)) || [];
      const radio = raw[0] && raw[0].radio ? mapPodcastRadio(raw[0].radio) : { id: rid, rid };
      const programs = (Array.isArray(raw) ? raw : [])
        .map(p => mapPodcastProgram(p, radio))
        .filter(p => p.id && p.name);
      sendJSON(res, { radio, programs, more: !!body.more, total: body.count || programs.length });
    } catch (err) {
      console.error('[PodcastPrograms]', err);
      sendJSON(res, { error: err.message, programs: [] }, 500);
    }
  }

  async function handleMy(_req, res) {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        const empty = ['collect', 'created', 'liked'].map(k => podcastCollectionMeta(k, []));
        sendJSON(res, { loggedIn: false, collections: empty });
        return;
      }
      const keys = ['collect', 'created', 'liked'];
      const collections = await Promise.all(keys.map(async key => {
        try {
          const data = await fetchMyPodcastItems(key, info, 12, 0);
          return podcastCollectionMeta(key, data.items || []);
        } catch (e) {
          console.warn('[MyPodcast]', key, e.message);
          return podcastCollectionMeta(key, []);
        }
      }));
      sendJSON(res, { loggedIn: true, collections });
    } catch (err) {
      console.error('[MyPodcast]', err);
      sendJSON(res, { error: err.message, collections: [] }, 500);
    }
  }

  async function handleMyItems(_req, res, url) {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        sendJSON(res, { loggedIn: false, items: [] });
        return;
      }
      const key = String(url.searchParams.get('key') || 'collect');
      const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36;
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const data = await fetchMyPodcastItems(key, info, limit, offset);
      sendJSON(res, { loggedIn: true, key, ...podcastCollectionMeta(key, data.items || []), itemType: data.itemType, items: data.items || [] });
    } catch (err) {
      console.error('[MyPodcastItems]', err);
      sendJSON(res, { error: err.message, items: [] }, 500);
    }
  }

  async function handleDjBeatmap(_req, res, url) {
    try {
      const audioUrl = url.searchParams.get('url');
      const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0);
      try {
        assertAllowedProxyTarget(audioUrl);
      } catch (e) {
        sendJSON(res, { error: 'Invalid audio url' }, 400);
        return;
      }
      console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's');
      const started = Date.now();
      const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0);
      const map = introSec
        ? await analyzePodcastDjIntro(audioUrl, { durationSec, introSec, userAgent })
        : await analyzePodcastDjStream(audioUrl, { durationSec, userAgent });
      console.log('[PodcastDjBeatmap] done beats:', map.visualBeatCount || 0, 'ms:', Date.now() - started, 'decode:', map.decode || {});
      sendJSON(res, { ok: true, map });
    } catch (err) {
      console.error('[PodcastDjBeatmap]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/podcast/search') {
      await handleSearch(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/hot') {
      await handleHot(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/detail') {
      await handleDetail(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/programs') {
      await handlePrograms(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/my') {
      await handleMy(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/my/items') {
      await handleMyItems(req, res, url);
      return true;
    }
    if (pn === '/api/podcast/dj-beatmap') {
      await handleDjBeatmap(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createPodcastRoutes,
};
