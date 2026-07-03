'use strict';

const AMLL_DB_BASE_URL = 'https://amll-ttml-db.stevexmh.net';
const DEFAULT_TIMEOUT_MS = 5000;

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function optionalFunction(deps, name, fallback) {
  return typeof deps[name] === 'function' ? deps[name] : fallback;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDurationMs(value) {
  const n = finiteNumber(value, 0);
  if (!n || n < 0) return 0;
  return n > 1000 ? Math.round(n) : Math.round(n * 1000);
}

function clampLimit(value, fallback) {
  const n = parseInt(value == null ? '' : String(value), 10);
  return Math.max(1, Math.min(12, Number.isFinite(n) ? n : fallback));
}

function param(url, name) {
  return String(url.searchParams.get(name) || '').trim();
}

function targetFromUrl(url) {
  return {
    title: param(url, 'title'),
    artist: param(url, 'artist'),
    album: param(url, 'album'),
    durationMs: normalizeDurationMs(param(url, 'durationMs') || param(url, 'duration')),
  };
}

function albumName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.name || value.title || value.albumName || '';
}

function artistName(song) {
  song = song || {};
  if (song.artist) return String(song.artist);
  if (song.singer) return String(song.singer);
  const list = Array.isArray(song.artists) ? song.artists : (Array.isArray(song.ar) ? song.ar : []);
  return list.map(item => item && (item.name || item.title || item.artist || item)).filter(Boolean).join(' / ');
}

function normalizeSongCandidate(song, fallback) {
  song = song || {};
  fallback = fallback || {};
  return {
    id: song.qqId || song.id || song.songId || fallback.id || '',
    mid: song.mid || song.songmid || song.songMid || fallback.mid || '',
    title: song.name || song.title || song.songName || fallback.title || '',
    artist: artistName(song) || fallback.artist || '',
    album: albumName(song.album || song.al || song.albumName) || fallback.album || '',
    durationMs: normalizeDurationMs(song.duration || song.durationMs || song.interval || fallback.durationMs || 0),
    kgHash: song.kgHash || song.hash || song.FileHash || '',
  };
}

function lyricFormatFromPayload(payload, fallback) {
  payload = payload || {};
  if (payload.qrc) return 'qrc';
  if (payload.yrc) return 'yrc';
  if (payload.format) return String(payload.format).toLowerCase();
  return fallback || 'lrc';
}

function lyricTextFromPayload(payload) {
  payload = payload || {};
  return payload.lyric || payload.lrc || payload.text || payload.qrc || payload.yrc || '';
}

function makeCandidate(source, song, lyricPayload, extra) {
  const meta = normalizeSongCandidate(song, extra);
  const lyric = lyricTextFromPayload(lyricPayload);
  return {
    source,
    id: meta.id == null ? '' : String(meta.id),
    mid: meta.mid == null ? '' : String(meta.mid),
    kgHash: meta.kgHash || '',
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    durationMs: meta.durationMs,
    format: lyricFormatFromPayload(lyricPayload, extra && extra.format),
    lyric,
    tlyric: lyricPayload && (lyricPayload.tlyric || lyricPayload.trans || ''),
    yrc: lyricPayload && (lyricPayload.yrc || ''),
    qrc: lyricPayload && (lyricPayload.qrc || ''),
    providerSource: lyricPayload && (lyricPayload.source || lyricPayload.provider || ''),
  };
}

function uniquePush(target, seen, candidate) {
  if (!candidate || !candidate.lyric) return;
  const key = [candidate.source, candidate.mid, candidate.id, candidate.kgHash, candidate.format].filter(Boolean).join(':') || candidate.lyric;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(candidate);
}

async function requestWithTimeout(fetchImpl, url, options, timeoutMs) {
  timeoutMs = Math.max(1000, Math.min(15000, finiteNumber(timeoutMs, DEFAULT_TIMEOUT_MS)));
  if (typeof AbortController !== 'function') return fetchImpl(url, options || {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const response = await requestWithTimeout(fetchImpl, url, options, timeoutMs);
  if (!response || !response.ok) throw new Error('REQUEST_FAILED_' + (response && response.status ? response.status : 'UNKNOWN'));
  return response.json();
}

async function fetchText(fetchImpl, url, options, timeoutMs) {
  const response = await requestWithTimeout(fetchImpl, url, options, timeoutMs);
  if (!response || !response.ok) throw new Error('REQUEST_FAILED_' + (response && response.status ? response.status : 'UNKNOWN'));
  return response.text();
}

function buildAmllUrl(platform, id) {
  return AMLL_DB_BASE_URL + '/' + encodeURIComponent(platform) + '/' + encodeURIComponent(String(id)) + '?format=ttml';
}

function kugouSearchUrl(query, limit) {
  const url = new URL('http://mobiles.kugou.com/api/v3/search/song');
  url.searchParams.set('showtype', '14');
  url.searchParams.set('highlight', '');
  url.searchParams.set('pagesize', String(limit));
  url.searchParams.set('tag_aggr', '1');
  url.searchParams.set('plat', '0');
  url.searchParams.set('sver', '5');
  url.searchParams.set('keyword', query);
  url.searchParams.set('correct', '1');
  url.searchParams.set('api_ver', '1');
  url.searchParams.set('version', '9108');
  url.searchParams.set('page', '1');
  return url.toString();
}

function kugouLyricSearchUrl(song) {
  const url = new URL('https://lyrics.kugou.com/v1/search');
  url.searchParams.set('album_audio_id', String(song.id || ''));
  url.searchParams.set('duration', String(song.durationMs || 0));
  url.searchParams.set('hash', song.kgHash || '');
  url.searchParams.set('keyword', [song.artist, song.title].filter(Boolean).join(' - '));
  url.searchParams.set('lrctxt', '1');
  url.searchParams.set('man', 'no');
  return url.toString();
}

function kugouDownloadUrl(candidate) {
  const url = new URL('http://lyrics.kugou.com/download');
  url.searchParams.set('accesskey', String(candidate.accesskey || ''));
  url.searchParams.set('charset', 'utf8');
  url.searchParams.set('client', 'mobi');
  url.searchParams.set('fmt', 'lrc');
  url.searchParams.set('id', String(candidate.id || ''));
  url.searchParams.set('ver', '1');
  return url.toString();
}

function decodeKugouContent(body) {
  body = body || {};
  const content = String(body.content || '');
  if (!content) return '';
  try {
    return Buffer.from(content, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
  } catch (_err) {
    return content;
  }
}

function mapKugouSong(raw, fallback) {
  raw = raw || {};
  return normalizeSongCandidate({
    id: raw.album_audio_id || raw.ID || raw.id,
    name: raw.songname || raw.SongName || raw.name,
    artist: raw.singername || (Array.isArray(raw.Singers) ? raw.Singers.map(s => s && s.name).filter(Boolean).join(' / ') : ''),
    album: raw.album_name || raw.AlbumName || '',
    duration: raw.duration || raw.Duration || 0,
    hash: raw.hash || raw.FileHash || '',
  }, fallback);
}

function createFoliaLyricRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const handleQQSearch = optionalFunction(deps, 'handleQQSearch', async () => []);
  const handleQQLyric = optionalFunction(deps, 'handleQQLyric', async () => ({ lyric: '' }));
  const providerTimeoutMs = finiteNumber(deps.providerTimeoutMs, DEFAULT_TIMEOUT_MS);
  const logErrors = deps.logErrors !== false;

  async function handleQQ(_req, res, url) {
    try {
      const target = targetFromUrl(url);
      const query = param(url, 'query') || [target.title, target.artist].filter(Boolean).join(' ');
      const limit = clampLimit(url.searchParams.get('limit'), 8);
      const candidates = [];
      const seen = new Set();
      const directMid = param(url, 'mid') || param(url, 'qqMid');
      const directId = param(url, 'id') || param(url, 'qqId');
      if (directMid || directId) {
        const payload = await handleQQLyric(directMid, directId);
        uniquePush(candidates, seen, makeCandidate('qq', { mid: directMid, id: directId }, payload, target));
      }
      if (query) {
        const songs = await handleQQSearch(query, limit);
        for (const song of Array.isArray(songs) ? songs.slice(0, limit) : []) {
          const meta = normalizeSongCandidate(song, target);
        const payload = await handleQQLyric(meta.mid, meta.id == null ? '' : String(meta.id));
          uniquePush(candidates, seen, makeCandidate('qq', meta, payload, target));
        }
      }
      sendJSON(res, { provider: 'qq', candidates });
    } catch (err) {
      if (logErrors) console.error('[FoliaLyricsQQ]', err);
      sendJSON(res, { provider: 'qq', candidates: [], error: err.message });
    }
  }

  async function handleAmll(_req, res, url) {
    try {
      if (!fetchImpl) throw new Error('fetch unavailable');
      const target = targetFromUrl(url);
      const ids = [];
      const neteaseId = param(url, 'neteaseId') || param(url, 'id');
      const qqMid = param(url, 'qqMid') || param(url, 'mid');
      if (neteaseId) ids.push({ platform: 'netease', id: neteaseId });
      if (qqMid) ids.push({ platform: 'qq', id: qqMid });
      const candidates = [];
      const seen = new Set();
      for (const item of ids) {
        const ttml = await fetchText(fetchImpl, buildAmllUrl(item.platform, item.id), { method: 'GET' }, providerTimeoutMs);
        if (!ttml || !/<tt(?:\s|>)/i.test(ttml)) continue;
        uniquePush(candidates, seen, {
          source: 'amll',
          providerPlatform: item.platform,
          id: String(item.id),
          title: target.title,
          artist: target.artist,
          album: target.album,
          durationMs: target.durationMs,
          format: 'ttml',
          lyric: ttml,
        });
      }
      sendJSON(res, { provider: 'amll', candidates });
    } catch (err) {
      if (logErrors) console.error('[FoliaLyricsAMLL]', err);
      sendJSON(res, { provider: 'amll', candidates: [], error: err.message });
    }
  }

  async function handleKugou(_req, res, url) {
    try {
      if (!fetchImpl) throw new Error('fetch unavailable');
      const target = targetFromUrl(url);
      const query = param(url, 'query') || [target.title, target.artist].filter(Boolean).join(' ');
      const limit = clampLimit(url.searchParams.get('limit'), 6);
      if (!query) {
        sendJSON(res, { provider: 'kugou', candidates: [] });
        return;
      }
      const searchBody = await fetchJson(fetchImpl, kugouSearchUrl(query, limit), {
        method: 'GET',
        headers: { 'User-Agent': 'Android14-1070-11070-201-0-SearchSong-wifi' },
      }, providerTimeoutMs);
      const rawSongs = (searchBody && searchBody.data && (searchBody.data.info || searchBody.data.lists)) || [];
      const candidates = [];
      const seen = new Set();
      for (const rawSong of rawSongs.slice(0, limit)) {
        const song = mapKugouSong(rawSong, target);
        if (!song.kgHash) continue;
        const lyricSearch = await fetchJson(fetchImpl, kugouLyricSearchUrl(song), { method: 'GET' }, providerTimeoutMs);
        const lyricCandidate = lyricSearch && Array.isArray(lyricSearch.candidates) ? lyricSearch.candidates[0] : null;
        if (!lyricCandidate) continue;
        const downloadBody = await fetchJson(fetchImpl, kugouDownloadUrl(lyricCandidate), { method: 'GET' }, providerTimeoutMs);
        const lyric = decodeKugouContent(downloadBody);
        uniquePush(candidates, seen, makeCandidate('kugou', song, {
          lyric,
          format: String(downloadBody && downloadBody.contenttype || 'lrc').toLowerCase().includes('krc') ? 'krc' : 'lrc',
          source: 'kugou',
        }, target));
      }
      sendJSON(res, { provider: 'kugou', candidates });
    } catch (err) {
      if (logErrors) console.error('[FoliaLyricsKugou]', err);
      sendJSON(res, { provider: 'kugou', candidates: [], error: err.message });
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/folia/lyrics/qq') {
      await handleQQ(req, res, url);
      return true;
    }
    if (pn === '/api/folia/lyrics/amll') {
      await handleAmll(req, res, url);
      return true;
    }
    if (pn === '/api/folia/lyrics/kugou') {
      await handleKugou(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createFoliaLyricRoutes,
};
