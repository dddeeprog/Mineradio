'use strict';

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function createQQRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const readRequestBody = requireFunction(deps, 'readRequestBody');
  const normalizeQQCookieInput = requireFunction(deps, 'normalizeQQCookieInput');
  const parseCookieString = requireFunction(deps, 'parseCookieString');
  const qqCookieUin = requireFunction(deps, 'qqCookieUin');
  const qqCookieMusicKey = requireFunction(deps, 'qqCookieMusicKey');
  const loginCredential = requireFunction(deps, 'loginCredential');
  const logoutCredential = requireFunction(deps, 'logoutCredential');
  const getQQLoginInfo = requireFunction(deps, 'getQQLoginInfo');
  const handleQQSearch = requireFunction(deps, 'handleQQSearch');
  const handleQQSongUrl = requireFunction(deps, 'handleQQSongUrl');
  const handleQQLyric = requireFunction(deps, 'handleQQLyric');
  const handleQQUserPlaylists = requireFunction(deps, 'handleQQUserPlaylists');
  const handleQQPlaylistTracks = requireFunction(deps, 'handleQQPlaylistTracks');
  const handleQQArtistDetail = requireFunction(deps, 'handleQQArtistDetail');
  const parseSongCommentLimit = requireFunction(deps, 'parseSongCommentLimit');
  const handleQQSongComments = requireFunction(deps, 'handleQQSongComments');

  async function handleLoginStatus(_req, res) {
    try {
      sendJSON(res, await getQQLoginInfo());
    } catch (err) {
      console.error('[QQLoginStatus]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
  }

  async function handleSearch(_req, res, url) {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = Math.max(4, Math.min(12, parseInt(url.searchParams.get('limit') || '8', 10) || 8));
      const songs = await handleQQSearch(kw, limit);
      sendJSON(res, { provider: 'qq', songs });
    } catch (err) {
      console.error('[QQSearch]', err);
      sendJSON(res, { provider: 'qq', error: err.message, songs: [] }, 500);
    }
  }

  async function handleSongUrl(_req, res, url) {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('id') || '';
      const mediaMid = url.searchParams.get('mediaMid') || url.searchParams.get('media_mid') || '';
      const quality = url.searchParams.get('quality') || '';
      const info = await handleQQSongUrl(mid, mediaMid, quality);
      sendJSON(res, info);
    } catch (err) {
      console.error('[QQSongUrl]', err);
      sendJSON(res, { provider: 'qq', url: '', playable: false, error: err.message }, 500);
    }
  }

  async function handleLyric(_req, res, url) {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      if (!mid && !id) {
        sendJSON(res, { provider: 'qq', error: 'Missing QQ song mid or id', lyric: '' }, 400);
        return;
      }
      sendJSON(res, await handleQQLyric(mid, id));
    } catch (err) {
      console.error('[QQLyric]', err);
      sendJSON(res, { provider: 'qq', error: err.message, lyric: '' }, 500);
    }
  }

  async function handleLoginCookie(req, res) {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeQQCookieInput(raw);
      const obj = parseCookieString(normalized);
      if (!qqCookieUin(obj) || !qqCookieMusicKey(obj)) {
        sendJSON(res, { provider: 'qq', loggedIn: false, error: 'INVALID_QQ_COOKIE', message: 'QQ cookie 缺少 uin 或有效登录票据' }, 400);
        return;
      }
      await loginCredential(normalized);
      const info = await getQQLoginInfo();
      sendJSON(res, { ...info, saved: true });
    } catch (err) {
      console.error('[QQLoginCookie]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message }, 500);
    }
  }

  async function handleUserPlaylists(_req, res) {
    try {
      sendJSON(res, await handleQQUserPlaylists());
    } catch (err) {
      console.error('[QQUserPlaylists]', err);
      sendJSON(res, { provider: 'qq', loggedIn: false, error: err.message, playlists: [] }, 500);
    }
  }

  async function handlePlaylistTracks(_req, res, url) {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('disstid') || '';
      sendJSON(res, await handleQQPlaylistTracks(id));
    } catch (err) {
      console.error('[QQPlaylistTracks]', err);
      sendJSON(res, { provider: 'qq', error: err.message, tracks: [] }, 500);
    }
  }

  async function handleArtistDetail(_req, res, url) {
    try {
      const mid = url.searchParams.get('mid') || url.searchParams.get('singermid') || '';
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '36', 10) || 36));
      if (!mid) {
        sendJSON(res, { provider: 'qq', error: 'MISSING_SINGER_MID', artist: null, songs: [] }, 400);
        return;
      }
      sendJSON(res, await handleQQArtistDetail(mid, limit));
    } catch (err) {
      console.error('[QQArtistDetail]', err);
      sendJSON(res, { provider: 'qq', error: err.message, artist: null, songs: [] }, 500);
    }
  }

  async function handleSongComments(_req, res, url) {
    try {
      const id = url.searchParams.get('id') || url.searchParams.get('qqId') || '';
      const mid = url.searchParams.get('mid') || url.searchParams.get('songmid') || '';
      const limitInfo = parseSongCommentLimit(url.searchParams.get('limit'), 20);
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      sendJSON(res, await handleQQSongComments(id, mid, limitInfo.limit, offset));
    } catch (err) {
      console.error('[QQSongComments]', err);
      sendJSON(res, { provider: 'qq', error: err.message, comments: [] }, 500);
    }
  }

  async function handleLogout(_req, res) {
    try {
      await logoutCredential();
      sendJSON(res, { provider: 'qq', ok: true, loggedIn: false });
    } catch (err) {
      sendJSON(res, {
        provider: 'qq',
        ok: false,
        loggedIn: true,
        error: err.code || 'LOGOUT_FAILED',
      }, 500);
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/qq/login/status') {
      await handleLoginStatus(req, res, url);
      return true;
    }
    if (pn === '/api/qq/search') {
      await handleSearch(req, res, url);
      return true;
    }
    if (pn === '/api/qq/song/url') {
      await handleSongUrl(req, res, url);
      return true;
    }
    if (pn === '/api/qq/lyric') {
      await handleLyric(req, res, url);
      return true;
    }
    if (pn === '/api/qq/login/cookie') {
      await handleLoginCookie(req, res, url);
      return true;
    }
    if (pn === '/api/qq/logout') {
      await handleLogout(req, res);
      return true;
    }
    if (pn === '/api/qq/user/playlists') {
      await handleUserPlaylists(req, res, url);
      return true;
    }
    if (pn === '/api/qq/playlist/tracks') {
      await handlePlaylistTracks(req, res, url);
      return true;
    }
    if (pn === '/api/qq/artist/detail') {
      await handleArtistDetail(req, res, url);
      return true;
    }
    if (pn === '/api/qq/song/comments') {
      await handleSongComments(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createQQRoutes,
};
