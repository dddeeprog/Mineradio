'use strict';

/*
 * Catalogue-search and read-only session-verification adaptation from
 * XxHuberrr/Mineradio v2.0.2
 * commit 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * See THIRD_PARTY_NOTICES.md. Playback and account mutation APIs are absent.
 */

const crypto = require('node:crypto');
const { normalizeSearchPage } = require('../search-model');

const DEFAULT_ENDPOINT = 'http://songsearch.kugou.com/song_search_v2';
const ACCOUNT_ENDPOINT = 'https://gateway.kugou.com/v7/get_all_list';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const KUGOU_H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const KUGOU_ACCOUNT_ID_KEYS = new Set([
  'userid',
  'user_id',
  'uid',
  'kugooid',
  'list_create_userid',
  'owner_id',
]);

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function stripKugouHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function kugouCoverUrl(value) {
  return String(value || '')
    .replace(/\{size\}/gi, '240')
    .replace(/\{width\}/gi, '240')
    .trim();
}

function parseCookieString(value) {
  const parsed = Object.create(null);
  String(value || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const item = part.slice(index + 1).trim();
    if (key) parsed[key] = item;
  });
  return parsed;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
}

function parseKugouCompound(value) {
  const parsed = Object.create(null);
  safeDecodeURIComponent(value).split('&').forEach(part => {
    const index = part.indexOf('=');
    if (index <= 0) return;
    const key = part.slice(0, index).trim();
    const item = part.slice(index + 1).trim();
    if (key) parsed[key] = item;
  });
  return parsed;
}

function firstKugouValue(objects, keys) {
  for (const object of objects) {
    for (const key of keys) {
      const value = object && object[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }
  return '';
}

function normalizeKugouUserId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(text)) return '';
  const normalized = text.replace(/^0+(?=\d)/, '');
  return normalized === '0' ? '' : normalized;
}

function extractKugouAuth(credential) {
  const cookieText = credential && typeof credential.cookie === 'string'
    ? credential.cookie
    : '';
  const cookie = parseCookieString(cookieText);
  const compound = parseKugouCompound(
    cookie.KuGoo || cookie.Kugou || cookie.kugou || '',
  );
  const sources = [cookie, compound];
  return {
    cookie: cookieText,
    userId: normalizeKugouUserId(firstKugouValue(sources, [
      'userid', 'UserId', 'KugooID', 'kugouID', 'uid',
    ])),
    token: firstKugouValue(sources, ['token', 'Token', 't', 'T']),
    mid: firstKugouValue(sources, [
      'kg_mid', 'KG_MID', 'KUGOU_API_MID', 'mid',
    ]),
    dfid: firstKugouValue(sources, ['kg_dfid', 'KG_DFID', 'dfid', 'DFID']),
    nickname: safeDecodeURIComponent(firstKugouValue(sources, [
      'NickName', 'nickname', 'UserName', 'username',
    ])),
  };
}

function kugouH5Signature(params, body) {
  const parts = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`);
  parts.push(JSON.stringify(body));
  return crypto.createHash('md5')
    .update(`${KUGOU_H5_SALT}${parts.join('')}${KUGOU_H5_SALT}`)
    .digest('hex');
}

function findMatchingKugouIdentity(payload, expectedUserId) {
  const queue = [{ value: payload, depth: 0 }];
  const visited = new WeakSet();
  let inspected = 0;
  while (queue.length > 0 && inspected < 256) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    inspected += 1;
    for (const [key, item] of Object.entries(value)) {
      if (KUGOU_ACCOUNT_ID_KEYS.has(key.toLowerCase())
        && normalizeKugouUserId(item) === expectedUserId) {
        return value;
      }
      if (depth < 6 && item && typeof item === 'object') {
        queue.push({ value: item, depth: depth + 1 });
      }
    }
  }
  return null;
}

function unverifiedKugouAccount(reason) {
  return {
    provider: 'kugou',
    loggedIn: false,
    verified: false,
    verification: 'unverified',
    reason,
  };
}

function createKugouAccountVerifier(options) {
  options = options && typeof options === 'object' ? options : {};
  const requestJson = requireFunction(options.requestJson, 'requestJson');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const userAgent = String(options.userAgent || DEFAULT_USER_AGENT);
  const fallbackMid = String(
    options.mid || crypto.randomBytes(16).toString('hex'),
  );

  return async function verifyKugouAccount(credential) {
    const auth = extractKugouAuth(credential);
    const numericUserId = Number(auth.userId);
    if (!auth.userId || !auth.token || !Number.isSafeInteger(numericUserId)) {
      return unverifiedKugouAccount('credential-incomplete');
    }

    const timestamp = Math.floor(Number(now()));
    const body = {
      userid: numericUserId,
      token: auth.token,
      total_ver: 979,
      type: 2,
      page: 1,
      pagesize: 20,
    };
    const params = {
      srcappid: '2919',
      clientver: '20000',
      clienttime: timestamp,
      mid: auth.mid || fallbackMid,
      uuid: timestamp,
      dfid: auth.dfid || '-',
      appid: '1014',
      token: auth.token,
      userid: numericUserId,
      plat: 1,
    };
    params.signature = kugouH5Signature(params, body);
    const url = new URL(ACCOUNT_ENDPOINT);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    let payload;
    try {
      payload = await requestJson(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Referer: 'https://www.kugou.com/',
          'User-Agent': userAgent,
          Cookie: auth.cookie,
          'x-router': 'cloudlist.service.kugou.com',
        },
      }, JSON.stringify(body));
    } catch (_) {
      return unverifiedKugouAccount('remote-rejected');
    }

    const errorCode = payload && (
      payload.error_code ?? payload.errorCode ?? payload.errcode
    );
    if (!payload
      || Number(payload.status) !== 1
      || (errorCode !== undefined && Number(errorCode) !== 0)) {
      return unverifiedKugouAccount('remote-rejected');
    }
    const identity = findMatchingKugouIdentity(payload.data, auth.userId);
    if (!identity) return unverifiedKugouAccount('identity-unbound');

    const nickname = stripKugouHtml(firstKugouValue([identity], [
      'list_create_username',
      'nickname',
      'username',
      'user_name',
      'owner_name',
    ]) || auth.nickname || '酷狗音乐用户');
    return {
      provider: 'kugou',
      loggedIn: true,
      verified: true,
      verification: 'verified',
      accountId: auth.userId,
      nickname,
      avatar: '',
      membership: { known: false },
    };
  };
}

function mapKugouItem(item) {
  item = item && typeof item === 'object' ? item : {};
  const singerNames = stripKugouHtml(item.SingerName || '')
    .split(/、|\/|,| feat\.? /i)
    .map(name => name.trim())
    .filter(Boolean);
  const singerIds = Array.isArray(item.SingerId) ? item.SingerId : [];
  const hash = String(item.FileHash || '').trim();
  const mixSongId = String(item.MixSongID || item.mixsongid || '').trim();
  const albumAudioId = String(
    (/^\d+$/.test(mixSongId) && mixSongId)
      || item.EMixSongID
      || item.AlbumAudioID
      || item.album_audio_id
      || mixSongId
      || '',
  ).trim();
  const privilege = Number(item.Privilege || 0) || 0;
  return {
    hash,
    id: hash || mixSongId || albumAudioId,
    name: stripKugouHtml(
      item.SongName || item.FileName || item.OriSongName || '',
    ),
    artists: singerNames.map((name, index) => ({
      id: singerIds[index] || '',
      name,
    })),
    artist: singerNames.join(' / '),
    album: stripKugouHtml(item.AlbumName || ''),
    albumId: String(item.AlbumID || '').trim(),
    mixSongId,
    albumAudioId,
    cover: kugouCoverUrl(
      item.Image
      || item.AlbumImage
      || item.cover
      || item.img
      || item.album_cover
      || item.album_img,
    ),
    durationMs: Math.max(0, Number(item.Duration) || 0) * 1000,
    fee: privilege >= 10 ? 1 : 0,
    privilege,
  };
}

function createKugouSearchAdapter(options) {
  options = options && typeof options === 'object' ? options : {};
  const requestJson = requireFunction(options.requestJson, 'requestJson');
  const endpoint = String(options.endpoint || DEFAULT_ENDPOINT);
  const userAgent = String(options.userAgent || DEFAULT_USER_AGENT);
  const mid = String(
    options.mid || crypto.randomBytes(16).toString('hex'),
  );

  return {
    provider: 'kugou',
    async search(params) {
      params = params && typeof params === 'object' ? params : {};
      const query = String(params.query || '').trim();
      const limit = boundedInteger(params.limit, 12, 1, 20);
      const offset = boundedInteger(params.offset, 0, 0, 500);
      const url = new URL(endpoint);
      url.searchParams.set('keyword', query);
      url.searchParams.set('page', String(Math.floor(offset / limit) + 1));
      url.searchParams.set('pagesize', String(limit));
      url.searchParams.set('userid', '-1');
      url.searchParams.set('clientver', '2000');
      url.searchParams.set('platform', 'WebFilter');
      url.searchParams.set('tag', 'em');
      url.searchParams.set('filter', '2');
      url.searchParams.set('iscorrection', '1');
      url.searchParams.set('privilege_filter', '0');
      url.searchParams.set('filter_ver', '2');
      url.searchParams.set('appid', '1014');
      url.searchParams.set('token', '');
      url.searchParams.set('mid', mid);

      const payload = await requestJson(url.toString(), {
        headers: {
          Referer: 'https://www.kugou.com/',
          'User-Agent': userAgent,
        },
      });
      const data = payload && payload.data && typeof payload.data === 'object'
        ? payload.data
        : {};
      const list = Array.isArray(data.lists) ? data.lists : [];
      const songs = list.map(mapKugouItem);
      const total = Math.max(0, Number(data.total) || 0);

      return normalizeSearchPage('kugou', {
        songs,
        offset,
        limit,
        nextOffset: offset + songs.length,
        total,
        hasMore: total
          ? offset + songs.length < total
          : songs.length >= limit,
      });
    },
  };
}

module.exports = {
  createKugouAccountVerifier,
  createKugouSearchAdapter,
};
