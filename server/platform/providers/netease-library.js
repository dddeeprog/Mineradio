'use strict';

/*
 * Album and community behavior adapted from XxHuberrr/Mineradio
 * commit 411bce4e4a8e5add3d1f76ac4a9c19306f6a10df.
 * Rewritten as a value-safe adapter for Mineradio.
 * Upstream project license: GPL-3.0.
 */

const MAX_COMMENT_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_ALBUM_SONGS = 120;

class NeteaseLibraryError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = 'NeteaseLibraryError';
    this.code = code;
    this.status = status;
  }
}

function requireFunction(options, name) {
  const value = options[name];
  if (typeof value !== 'function') {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function safeText(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

function safeId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value === 'bigint') value = String(value);
  value = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,20}$/.test(value)) {
    throw new NeteaseLibraryError('NETEASE_LIBRARY_INVALID_ID', 400);
  }
  return value;
}

function requireBoolean(value) {
  if (value !== true && value !== false) {
    throw new NeteaseLibraryError('NETEASE_LIBRARY_INVALID_STATE', 400);
  }
  return value;
}

function responseBody(value) {
  if (!value || typeof value !== 'object') return {};
  const body = value.body;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body
    : value;
}

function responseCode(value) {
  const body = responseBody(value);
  const code = Number(body.code ?? (value && value.code));
  return Number.isFinite(code) ? code : 0;
}

function statusForCode(code, fallback = 502) {
  if (code === 400 || code === 401 || code === 403 || code === 404 || code === 409) {
    return code;
  }
  return fallback;
}

function assertSuccess(value, errorCode) {
  const code = responseCode(value);
  if (code !== 200) {
    throw new NeteaseLibraryError(errorCode, statusForCode(code));
  }
  return code;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeComment(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
  return {
    id: String(raw.commentId ?? raw.id ?? ''),
    content: safeText(raw.content, MAX_COMMENT_LENGTH),
    likedCount: normalizeCount(raw.likedCount),
    liked: raw.liked === true,
    time: Number.isFinite(Number(raw.time)) ? Number(raw.time) : 0,
    user: {
      id: String(user.userId ?? user.id ?? ''),
      nickname: safeText(user.nickname, 160),
      avatar: safeText(user.avatarUrl || user.avatar, 1000),
    },
  };
}

function normalizeCommentContent(value) {
  const content = typeof value === 'string' ? value.trim() : '';
  if (!content || content.length > MAX_COMMENT_LENGTH) {
    throw new NeteaseLibraryError('NETEASE_COMMENT_CONTENT_INVALID', 400);
  }
  return content;
}

function createNeteaseLibraryAdapter(options = {}) {
  const album = requireFunction(options, 'album');
  const albumDetailDynamic = requireFunction(options, 'albumDetailDynamic');
  const albumSub = requireFunction(options, 'albumSub');
  const playlistSubscribe = requireFunction(options, 'playlistSubscribe');
  const commentLike = requireFunction(options, 'commentLike');
  const commentCreate = requireFunction(options, 'commentCreate');
  const mapSongRecord = requireFunction(options, 'mapSongRecord');
  const now = typeof options.now === 'function' ? options.now : Date.now;

  function callTimestamp() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

  async function safeCall(operation, errorCode) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof NeteaseLibraryError) throw error;
      const code = responseCode(error && (error.body || error.response || error));
      const explicitStatus = Number(error && error.status);
      throw new NeteaseLibraryError(
        errorCode,
        explicitStatus >= 400 && explicitStatus <= 599
          ? explicitStatus
          : statusForCode(code),
      );
    }
  }

  async function getAlbumDetail(input = {}) {
    const id = safeId(input.id);
    const limit = Math.max(
      1,
      Math.min(MAX_ALBUM_SONGS, Math.floor(Number(input.limit) || MAX_ALBUM_SONGS)),
    );
    const common = {
      id,
      cookie: typeof input.cookie === 'string' ? input.cookie : '',
      timestamp: callTimestamp(),
    };
    const detailResult = await safeCall(
      () => album(common),
      'NETEASE_ALBUM_DETAIL_FAILED',
    );
    assertSuccess(detailResult, 'NETEASE_ALBUM_DETAIL_FAILED');

    let dynamicBody = {};
    try {
      const dynamicResult = await albumDetailDynamic(common);
      if (responseCode(dynamicResult) === 200) dynamicBody = responseBody(dynamicResult);
    } catch (_) {
      dynamicBody = {};
    }

    const body = responseBody(detailResult);
    const rawAlbum = body.album && typeof body.album === 'object'
      ? body.album
      : {};
    const rawArtist = rawAlbum.artist && typeof rawAlbum.artist === 'object'
      ? rawAlbum.artist
      : (Array.isArray(rawAlbum.artists) ? rawAlbum.artists[0] || {} : {});
    const rawSongs = Array.isArray(body.songs) ? body.songs : [];
    const songs = rawSongs
      .slice(0, limit)
      .map(mapSongRecord)
      .filter(song => song && song.id != null && song.id !== '');

    return {
      provider: 'netease',
      album: {
        id,
        name: safeText(rawAlbum.name, 500),
        cover: safeText(rawAlbum.picUrl || rawAlbum.coverUrl, 1000),
        artist: safeText(rawArtist.name, 500),
        artistId: String(rawArtist.id ?? ''),
        description: safeText(
          rawAlbum.description || rawAlbum.briefDesc,
          MAX_DESCRIPTION_LENGTH,
        ),
        publishTime: Number.isFinite(Number(rawAlbum.publishTime))
          ? Number(rawAlbum.publishTime)
          : 0,
        company: safeText(rawAlbum.company, 500),
        size: normalizeCount(rawAlbum.size || rawSongs.length),
        collected: dynamicBody.isSub === true
          || dynamicBody.subscribed === true
          || rawAlbum.subscribed === true,
      },
      songs,
      dynamic: {
        commentCount: normalizeCount(dynamicBody.commentCount),
        shareCount: normalizeCount(dynamicBody.shareCount),
        collectCount: normalizeCount(
          dynamicBody.subCount || dynamicBody.collectCount,
        ),
      },
    };
  }

  async function setAlbumCollected(input = {}) {
    const id = safeId(input.id);
    const collected = requireBoolean(input.collected);
    const result = await safeCall(
      () => albumSub({
        id,
        t: collected ? 1 : 0,
        cookie: typeof input.cookie === 'string' ? input.cookie : '',
        timestamp: callTimestamp(),
      }),
      'NETEASE_ALBUM_COLLECT_FAILED',
    );
    const code = assertSuccess(result, 'NETEASE_ALBUM_COLLECT_FAILED');
    return {
      provider: 'netease',
      resource: 'album',
      id,
      collected,
      success: true,
      code,
    };
  }

  async function setPlaylistSubscribed(input = {}) {
    const id = safeId(input.id);
    const subscribed = requireBoolean(input.subscribed);
    const result = await safeCall(
      () => playlistSubscribe({
        id,
        t: subscribed ? 1 : 0,
        cookie: typeof input.cookie === 'string' ? input.cookie : '',
        timestamp: callTimestamp(),
      }),
      'NETEASE_PLAYLIST_SUBSCRIBE_FAILED',
    );
    const code = assertSuccess(result, 'NETEASE_PLAYLIST_SUBSCRIBE_FAILED');
    return {
      provider: 'netease',
      resource: 'playlist',
      id,
      subscribed,
      success: true,
      code,
    };
  }

  async function setCommentLiked(input = {}) {
    const id = safeId(input.id);
    const commentId = safeId(input.commentId);
    const liked = requireBoolean(input.liked);
    const result = await safeCall(
      () => commentLike({
        type: 0,
        id,
        cid: commentId,
        t: liked ? 1 : 0,
        cookie: typeof input.cookie === 'string' ? input.cookie : '',
        timestamp: callTimestamp(),
      }),
      'NETEASE_COMMENT_LIKE_FAILED',
    );
    const code = assertSuccess(result, 'NETEASE_COMMENT_LIKE_FAILED');
    return {
      provider: 'netease',
      resource: 'comment',
      id,
      commentId,
      liked,
      success: true,
      code,
    };
  }

  async function createComment(input = {}) {
    const id = safeId(input.id);
    const content = normalizeCommentContent(input.content);
    const replyTo = input.replyTo == null || input.replyTo === ''
      ? ''
      : safeId(input.replyTo);
    const result = await safeCall(
      () => commentCreate({
        t: replyTo ? 2 : 1,
        type: 0,
        id,
        commentId: replyTo,
        content,
        cookie: typeof input.cookie === 'string' ? input.cookie : '',
        timestamp: callTimestamp(),
      }),
      'NETEASE_COMMENT_CREATE_FAILED',
    );
    const code = assertSuccess(result, 'NETEASE_COMMENT_CREATE_FAILED');
    const body = responseBody(result);
    const rawComment = body.comment
      || body.data && body.data.comment
      || {};
    return {
      provider: 'netease',
      resource: 'comment',
      id,
      created: true,
      success: true,
      code,
      comment: normalizeComment({
        ...rawComment,
        content: rawComment.content || content,
      }),
    };
  }

  return Object.freeze({
    createComment,
    getAlbumDetail,
    setAlbumCollected,
    setCommentLiked,
    setPlaylistSubscribed,
  });
}

module.exports = {
  MAX_COMMENT_LENGTH,
  NeteaseLibraryError,
  createNeteaseLibraryAdapter,
};
