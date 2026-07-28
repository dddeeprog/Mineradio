'use strict';

/*
 * Search-only adaptation from XxHuberrr/Mineradio v2.0.2
 * commit 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * See THIRD_PARTY_NOTICES.md. Playback and account APIs are intentionally absent.
 */

const crypto = require('node:crypto');
const { normalizeSearchPage } = require('../search-model');

const DEFAULT_ENDPOINT = 'http://songsearch.kugou.com/song_search_v2';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

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

function mapKugouItem(item) {
  item = item && typeof item === 'object' ? item : {};
  const singerNames = String(item.SingerName || '')
    .split(/、|\/|,| feat\.? /i)
    .map(stripKugouHtml)
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
  createKugouSearchAdapter,
};
