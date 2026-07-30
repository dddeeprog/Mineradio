'use strict';

function requireFunction(deps, name) {
  const fn = deps[name];
  if (typeof fn !== 'function') throw new TypeError(name + ' is required');
  return fn;
}

function createNeteaseRoutes(deps) {
  deps = deps || {};
  const sendJSON = requireFunction(deps, 'sendJSON');
  const readRequestBody = requireFunction(deps, 'readRequestBody');
  const normalizeCookieHeader = requireFunction(deps, 'normalizeCookieHeader');
  const parseCookieString = requireFunction(deps, 'parseCookieString');
  const loginCredential = requireFunction(deps, 'loginCredential');
  const logoutCredential = requireFunction(deps, 'logoutCredential');
  const getUserCookie = requireFunction(deps, 'getUserCookie');
  const getLoginInfo = requireFunction(deps, 'getLoginInfo');
  const handleSearchImpl = requireFunction(deps, 'handleSearch');
  const handleSongUrlImpl = requireFunction(deps, 'handleSongUrl');
  const readCookieFromResponse = requireFunction(deps, 'readCookieFromResponse');
  const normalizeLoginInfo = requireFunction(deps, 'normalizeLoginInfo');
  const loginQrKey = requireFunction(deps, 'login_qr_key');
  const loginQrCreate = requireFunction(deps, 'login_qr_create');
  const loginQrCheck = requireFunction(deps, 'login_qr_check');
  const logout = requireFunction(deps, 'logout');
  const userPlaylist = requireFunction(deps, 'user_playlist');
  const requireLogin = requireFunction(deps, 'requireLogin');
  const songLikeCheck = deps.song_like_check;
  const likelist = requireFunction(deps, 'likelist');
  const likeSong = requireFunction(deps, 'like_song');
  const playlistCreate = requireFunction(deps, 'playlist_create');
  const playlistTracks = requireFunction(deps, 'playlist_tracks');
  const playlistTrackAdd = deps.playlist_track_add;
  const lyricNew = deps.lyric_new;
  const lyric = requireFunction(deps, 'lyric');
  const commentMusic = requireFunction(deps, 'comment_music');
  const parseSongCommentLimit = requireFunction(deps, 'parseSongCommentLimit');
  const mapNeteaseComment = requireFunction(deps, 'mapNeteaseComment');
  const pushUniqueSongComment = requireFunction(deps, 'pushUniqueSongComment');
  const artistDetail = requireFunction(deps, 'artist_detail');
  const artistSongs = requireFunction(deps, 'artist_songs');
  const artistTopSong = requireFunction(deps, 'artist_top_song');
  const mapSongRecord = requireFunction(deps, 'mapSongRecord');
  const playlistTrackAll = deps.playlist_track_all;
  const playlistDetail = deps.playlist_detail;
  const normalizeApiCode = requireFunction(deps, 'normalizeApiCode');
  const normalizeApiMessage = requireFunction(deps, 'normalizeApiMessage');

  function cookie() {
    return getUserCookie() || '';
  }

  async function handleSearch(_req, res, url) {
    try {
      const kw = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const songs = await handleSearchImpl(kw, limit);
      sendJSON(res, { songs });
    } catch (err) {
      console.error('[Search]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
  }

  async function handleSongUrl(_req, res, url) {
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      const loginInfo = await getLoginInfo();
      const info = await handleSongUrlImpl(sid, loginInfo, quality);
      sendJSON(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      });
    } catch (err) {
      console.error('[SongUrl]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleLoginCookie(req, res) {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      const obj = parseCookieString(normalized);
      if (!obj.MUSIC_U) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_NETEASE_COOKIE', message: '网易云 cookie 缺少 MUSIC_U' }, 400);
        return;
      }
      await loginCredential(normalized);
      let info = await getLoginInfo();
      if (!info.loggedIn && cookie()) {
        info = {
          loggedIn: true,
          pendingProfile: true,
          nickname: '网易云用户',
          avatar: '',
          vipType: 0,
          vipLevel: 'none',
          isVip: false,
          isSvip: false,
          vipLabel: '无VIP',
        };
      }
      sendJSON(res, { ...info, saved: true, hasCookie: !!cookie() });
    } catch (err) {
      console.error('[LoginCookie]', err);
      sendJSON(res, { loggedIn: false, error: err.message }, 500);
    }
  }

  async function handleQrKey(_req, res) {
    try {
      const r = await loginQrKey({ timestamp: Date.now() });
      const key = r.body && r.body.data && r.body.data.unikey;
      sendJSON(res, { key });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleQrCreate(_req, res, url) {
    try {
      const key = url.searchParams.get('key');
      const r = await loginQrCreate({ key, qrimg: true, timestamp: Date.now() });
      const d = r.body && r.body.data;
      sendJSON(res, { img: d && d.qrimg, url: d && d.qrurl });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleQrCheck(_req, res, url) {
    try {
      const key = url.searchParams.get('key');
      let r = await loginQrCheck({ key, noCookie: true, timestamp: Date.now() });
      let body = r.body || {};
      let code = Number(body.code || r.code);
      let msg = body.message || r.message || '';
      let loginCookie = readCookieFromResponse(r);
      if (code === 803 && !loginCookie) {
        try {
          const retry = await loginQrCheck({ key, timestamp: Date.now() });
          const retryCookie = readCookieFromResponse(retry);
          if (retryCookie) {
            r = retry;
            body = retry.body || body;
            code = Number(body.code || retry.code || code);
            msg = body.message || retry.message || msg;
            loginCookie = retryCookie;
          }
        } catch (retryErr) {
          console.warn('[Login] qr cookie retry failed:', retryErr.message);
        }
      }
      if (code === 803) {
        if (loginCookie) await loginCredential(loginCookie);
        let info = await getLoginInfo();
        if (!info.loggedIn) {
          const profile = body.profile || (body.data && body.data.profile) || {};
          info = normalizeLoginInfo(profile, body.account || (body.data && body.data.account), body.data || body);
        }
        if (!info.loggedIn && loginCookie) {
          info = {
            loggedIn: true,
            pendingProfile: true,
            nickname: (body.nickname || (body.profile && body.profile.nickname) || '网易云用户'),
            avatar: body.avatarUrl || (body.profile && body.profile.avatarUrl) || '',
            vipType: 0,
            vipLevel: 'none',
            isVip: false,
            isSvip: false,
            vipLabel: '无VIP',
          };
        }
        sendJSON(res, { code, message: msg, ...info, hasCookie: !!loginCookie });
        return;
      }
      sendJSON(res, { code, message: msg, nickname: body.nickname, avatar: body.avatarUrl });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleLogout(_req, res) {
    try { await logout({ cookie: cookie() }); } catch (e) {}
    try {
      await logoutCredential();
      sendJSON(res, { ok: true });
    } catch (err) {
      sendJSON(res, { ok: false, error: err.code || 'LOGOUT_FAILED' }, 500);
    }
  }

  async function handleUserPlaylists(_req, res, url) {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        sendJSON(res, { loggedIn: false, playlists: [] });
        return;
      }
      const limit = Math.max(12, Math.min(100, parseInt(url.searchParams.get('limit') || '60', 10) || 60));
      const r = await userPlaylist({ uid: info.userId, limit, cookie: cookie(), timestamp: Date.now() });
      const list = ((r.body && r.body.playlist) || []).map(pl => ({
        id: pl.id,
        name: pl.name,
        cover: pl.coverImgUrl || '',
        trackCount: pl.trackCount || 0,
        playCount: pl.playCount || 0,
        creator: (pl.creator && pl.creator.nickname) || '',
        subscribed: !!pl.subscribed,
        specialType: pl.specialType || 0,
      }));
      sendJSON(res, { loggedIn: true, userId: info.userId, playlists: list });
    } catch (err) {
      console.error('[UserPlaylists]', err);
      sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
    }
  }

  async function handleLikeCheck(_req, res, url) {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!ids.length) {
        sendJSON(res, { error: 'Missing song id', liked: {}, ids: [] }, 400);
        return;
      }
      let likedIds = [];
      try {
        if (typeof songLikeCheck === 'function') {
          const checked = await songLikeCheck({ ids: JSON.stringify(ids.map(Number).filter(Boolean)), cookie: cookie(), timestamp: Date.now() });
          const data = (checked.body && (checked.body.data || checked.body.ids)) || checked.body || {};
          if (Array.isArray(data)) likedIds = data.map(String);
          else if (data && typeof data === 'object') {
            ids.forEach(id => {
              if (data[id] || data[String(id)] || data[Number(id)]) likedIds.push(String(id));
            });
          }
        }
      } catch (e) {
        console.warn('[LikeCheck] direct check failed:', e.message);
      }
      if (!likedIds.length) {
        const r = await likelist({ uid: info.userId, cookie: cookie(), timestamp: Date.now() });
        likedIds = ((r.body && r.body.ids) || []).map(String);
      }
      const set = new Set(likedIds);
      const liked = {};
      ids.forEach(id => { liked[id] = set.has(String(id)); });
      sendJSON(res, { loggedIn: true, ids, liked });
    } catch (err) {
      console.error('[LikeCheck]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleLike(req, res, url) {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) {
        sendJSON(res, { error: 'Missing song id' }, 400);
        return;
      }
      const r = await likeSong({ id, like: String(nextLike), cookie: cookie(), timestamp: Date.now() });
      const code = (r.body && r.body.code) || r.code || 200;
      sendJSON(res, { loggedIn: true, id, liked: nextLike, code, body: r.body || r });
    } catch (err) {
      console.error('[Like]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handlePlaylistCreate(req, res, url) {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const name = String(body.name || url.searchParams.get('name') || '').trim();
      const privacy = String(body.privacy || url.searchParams.get('privacy') || '0');
      if (!name) {
        sendJSON(res, { error: 'Missing playlist name' }, 400);
        return;
      }
      const r = await playlistCreate({ name, privacy, cookie: cookie(), timestamp: Date.now() });
      const created = (r.body && (r.body.playlist || r.body.data)) || {};
      sendJSON(res, { loggedIn: true, playlist: created, body: r.body || r });
    } catch (err) {
      console.error('[PlaylistCreate]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handlePlaylistAddSong(req, res, url) {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = body.pid || url.searchParams.get('pid');
      const id = body.id || body.ids || url.searchParams.get('id') || url.searchParams.get('ids');
      if (!pid || !id) {
        sendJSON(res, { error: 'Missing playlist id or song id' }, 400);
        return;
      }
      const attempts = [];
      let finalBody = null;
      let finalCode = 0;
      let finalMessage = '';
      let success = false;

      const primary = await playlistTracks({ op: 'add', pid, tracks: String(id), cookie: cookie(), timestamp: Date.now() });
      finalBody = primary.body || primary;
      finalCode = normalizeApiCode(primary);
      finalMessage = normalizeApiMessage(primary);
      success = finalCode === 200 && !(finalBody && finalBody.error);
      attempts.push({ api: 'playlist_tracks', code: finalCode, message: finalMessage, body: finalBody });

      if (!success && typeof playlistTrackAdd === 'function') {
        try {
          const fallback = await playlistTrackAdd({ pid, ids: String(id), cookie: cookie(), timestamp: Date.now() });
          finalBody = fallback.body || fallback;
          finalCode = normalizeApiCode(fallback);
          finalMessage = normalizeApiMessage(fallback);
          success = finalCode === 200 && !(finalBody && finalBody.error);
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: finalBody });
        } catch (fallbackErr) {
          const errBody = fallbackErr.body || fallbackErr.response || {};
          finalBody = errBody;
          finalCode = normalizeApiCode(errBody);
          finalMessage = normalizeApiMessage(errBody) || fallbackErr.message || '';
          attempts.push({ api: 'playlist_track_add', code: finalCode, message: finalMessage, body: errBody });
        }
      }

      if (!success) {
        sendJSON(res, { loggedIn: true, pid, id, success: false, code: finalCode, error: finalMessage || 'PLAYLIST_ADD_FAILED', attempts }, finalCode === 401 ? 401 : 409);
        return;
      }
      sendJSON(res, { loggedIn: true, pid, id, success: true, code: finalCode, body: finalBody, attempts });
    } catch (err) {
      console.error('[PlaylistAddSong]', err);
      sendJSON(res, { error: err.message }, 500);
    }
  }

  async function handleLyric(_req, res, url) {
    try {
      const id = url.searchParams.get('id');
      if (!id) {
        sendJSON(res, { error: 'Missing song id', lyric: '' }, 400);
        return;
      }
      let body = {};
      let source = 'lyric';
      try {
        if (typeof lyricNew === 'function') {
          const nr = await lyricNew({ id, cookie: cookie(), timestamp: Date.now() });
          body = nr.body || {};
          source = 'lyric_new';
        }
      } catch (errNew) {
        console.warn('[LyricNew]', errNew.message);
      }
      if (!((body.lrc && body.lrc.lyric) || (body.yrc && body.yrc.lyric))) {
        const r = await lyric({ id, cookie: cookie(), timestamp: Date.now() });
        body = r.body || body || {};
        source = 'lyric';
      }
      sendJSON(res, {
        lyric: (body.lrc && body.lrc.lyric) || '',
        tlyric: (body.tlyric && body.tlyric.lyric) || '',
        yrc: (body.yrc && body.yrc.lyric) || '',
        source,
      });
    } catch (err) {
      console.error('[Lyric]', err);
      sendJSON(res, { error: err.message, lyric: '' }, 500);
    }
  }

  async function handleSongComments(_req, res, url) {
    try {
      const id = url.searchParams.get('id');
      const limitInfo = parseSongCommentLimit(url.searchParams.get('limit'), 20);
      const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
      if (!id) {
        sendJSON(res, { error: 'Missing song id', comments: [] }, 400);
        return;
      }

      if (limitInfo.unlimited) {
        const pageSize = 100;
        let currentOffset = offset;
        let total = 0;
        let hot = false;
        let firstBody = null;
        const comments = [];
        const seen = new Set();
        while (true) {
          const r = await commentMusic({ id, limit: pageSize, offset: currentOffset, cookie: cookie(), timestamp: Date.now() });
          const body = r.body || r || {};
          if (!firstBody) firstBody = body;
          total = Number(body.total || total) || total;
          const hotRaw = currentOffset === 0 && Array.isArray(body.hotComments) ? body.hotComments : [];
          const normalRaw = Array.isArray(body.comments) ? body.comments : [];
          if (hotRaw.length) hot = true;
          hotRaw.concat(normalRaw).forEach(c => pushUniqueSongComment(comments, seen, mapNeteaseComment(c)));
          if (!normalRaw.length || normalRaw.length < pageSize) break;
          currentOffset += normalRaw.length;
          if (total && currentOffset >= total) break;
        }
        sendJSON(res, { id, total: total || comments.length, comments, hot, unlimited: true, body: firstBody || {} });
        return;
      }

      const limit = limitInfo.limit;
      const r = await commentMusic({ id, limit, offset, cookie: cookie(), timestamp: Date.now() });
      const body = r.body || r || {};
      const raw = body.hotComments && offset === 0 ? body.hotComments : (body.comments || []);
      const comments = (raw || []).map(mapNeteaseComment).filter(c => c.content);
      sendJSON(res, { id, total: body.total || 0, comments, hot: !!(body.hotComments && offset === 0), body });
    } catch (err) {
      console.error('[SongComments]', err);
      sendJSON(res, { error: err.message, comments: [] }, 500);
    }
  }

  async function handleArtistDetail(_req, res, url) {
    try {
      const id = url.searchParams.get('id');
      const limit = Math.max(10, Math.min(80, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      if (!id) {
        sendJSON(res, { error: 'Missing artist id', songs: [] }, 400);
        return;
      }
      let detailBody = {};
      try {
        const detail = await artistDetail({ id, cookie: cookie(), timestamp: Date.now() });
        detailBody = detail.body || detail || {};
      } catch (e) {
        console.warn('[ArtistDetail] detail failed:', e.message);
      }
      let rawSongs = [];
      try {
        const list = await artistSongs({ id, order: 'hot', limit, offset: 0, cookie: cookie(), timestamp: Date.now() });
        const b = list.body || list || {};
        rawSongs = (b.songs || (b.data && b.data.songs) || []);
      } catch (e) {
        console.warn('[ArtistSongs] hot failed:', e.message);
      }
      if (!rawSongs.length) {
        const top = await artistTopSong({ id, cookie: cookie(), timestamp: Date.now() });
        const b = top.body || top || {};
        rawSongs = b.songs || [];
      }
      const artist = detailBody.artist || (detailBody.data && (detailBody.data.artist || detailBody.data)) || {};
      const songs = rawSongs.map(mapSongRecord).filter(s => s.id).slice(0, limit);
      sendJSON(res, {
        id,
        artist: {
          id: artist.id || id,
          name: artist.name || artist.artistName || '',
          avatar: artist.avatar || artist.cover || artist.picUrl || artist.img1v1Url || '',
          brief: artist.briefDesc || artist.description || artist.desc || '',
          musicSize: artist.musicSize || artist.songSize || 0,
          albumSize: artist.albumSize || 0,
        },
        songs,
        body: detailBody,
      });
    } catch (err) {
      console.error('[ArtistDetail]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
  }

  async function handlePlaylistTracks(_req, res, url) {
    try {
      const id = url.searchParams.get('id');
      if (!id) {
        sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400);
        return;
      }

      let playlistMeta = { id, name: '', cover: '', trackCount: 0 };
      let rawTracks = [];

      if (typeof playlistTrackAll === 'function') {
        try {
          const all = await playlistTrackAll({ id, limit: 500, offset: 0, cookie: cookie(), timestamp: Date.now() });
          rawTracks = (all.body && (all.body.songs || all.body.tracks)) || [];
        } catch (err) {
          console.warn('[PlaylistTracks] playlist_track_all failed, fallback to detail:', err.message);
        }
      }

      if (!rawTracks.length && typeof playlistDetail === 'function') {
        const detail = await playlistDetail({ id, s: 0, cookie: cookie(), timestamp: Date.now() });
        const pl = (detail.body && detail.body.playlist) || {};
        playlistMeta = { id: pl.id || id, name: pl.name || '', cover: pl.coverImgUrl || '', trackCount: pl.trackCount || 0 };
        rawTracks = pl.tracks || [];
      }

      const tracks = rawTracks.map(mapSongRecord).filter(t => t.id);
      if (!playlistMeta.trackCount) playlistMeta.trackCount = tracks.length;
      sendJSON(res, { playlist: playlistMeta, tracks });
    } catch (err) {
      console.error('[PlaylistTracks]', err);
      sendJSON(res, { error: err.message, tracks: [] }, 500);
    }
  }

  async function handleRoute(pn, req, res, url) {
    if (pn === '/api/search') {
      await handleSearch(req, res, url);
      return true;
    }
    if (pn === '/api/song/url') {
      await handleSongUrl(req, res, url);
      return true;
    }
    if (pn === '/api/login/cookie') {
      await handleLoginCookie(req, res, url);
      return true;
    }
    if (pn === '/api/login/qr/key') {
      await handleQrKey(req, res, url);
      return true;
    }
    if (pn === '/api/login/qr/create') {
      await handleQrCreate(req, res, url);
      return true;
    }
    if (pn === '/api/login/qr/check') {
      await handleQrCheck(req, res, url);
      return true;
    }
    if (pn === '/api/logout') {
      await handleLogout(req, res, url);
      return true;
    }
    if (pn === '/api/user/playlists') {
      await handleUserPlaylists(req, res, url);
      return true;
    }
    if (pn === '/api/song/like/check') {
      await handleLikeCheck(req, res, url);
      return true;
    }
    if (pn === '/api/song/like') {
      await handleLike(req, res, url);
      return true;
    }
    if (pn === '/api/playlist/create') {
      await handlePlaylistCreate(req, res, url);
      return true;
    }
    if (pn === '/api/playlist/add-song') {
      await handlePlaylistAddSong(req, res, url);
      return true;
    }
    if (pn === '/api/lyric') {
      await handleLyric(req, res, url);
      return true;
    }
    if (pn === '/api/song/comments') {
      await handleSongComments(req, res, url);
      return true;
    }
    if (pn === '/api/artist/detail') {
      await handleArtistDetail(req, res, url);
      return true;
    }
    if (pn === '/api/playlist/tracks') {
      await handlePlaylistTracks(req, res, url);
      return true;
    }
    return false;
  }

  return {
    handleRoute,
  };
}

module.exports = {
  createNeteaseRoutes,
};
