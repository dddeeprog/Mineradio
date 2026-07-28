'use strict';

/*
 * Public-catalog search adaptation from XxHuberrr/Mineradio v2.0.2
 * commit 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * See THIRD_PARTY_NOTICES.md. Decryption and local-session discovery are absent.
 */

const { normalizeSearchPage } = require('../search-model');

const DEFAULT_ENDPOINT = 'https://api-vehicle.volcengine.com/v2/search/type';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function firstUrl(value) {
  if (typeof value === 'string') {
    return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  for (const key of ['url', 'uri', 'url_list', 'urls']) {
    const found = firstUrl(value[key]);
    if (found) return found;
  }
  return '';
}

function mapQishuiItem(raw, index) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const author = raw.author_info && typeof raw.author_info === 'object'
    ? raw.author_info
    : (raw.author && typeof raw.author === 'object' ? raw.author : {});
  const album = raw.album_info && typeof raw.album_info === 'object'
    ? raw.album_info
    : (raw.album && typeof raw.album === 'object' ? raw.album : {});
  const duration = Math.max(
    0,
    Number(raw.duration || raw.duration_ms || 0) || 0,
  );
  return {
    providerSongId: normalizeText(
      raw.item_id || raw.id || raw.song_id || raw.music_id,
    ),
    name: normalizeText(raw.title || raw.name || raw.song_name),
    artists: [{
      id: normalizeText(author.id || author.author_id),
      name: normalizeText(
        author.name || raw.author_name || raw.artist_name || raw.singer,
      ),
    }].filter(artist => artist.name),
    album: {
      id: normalizeText(album.id || album.album_id),
      name: normalizeText(album.name || raw.album_name),
    },
    cover: firstUrl(
      raw.cover_url || raw.cover || raw.artwork || album.cover_url,
    ),
    durationMs: duration > 10000 ? Math.round(duration) : Math.round(duration * 1000),
    qishuiRank: index,
  };
}

function comparable(value) {
  const source = normalizeText(value);
  const normalized = typeof source.normalize === 'function'
    ? source.normalize('NFKC')
    : source;
  return normalized
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function publicScore(song, query) {
  const needle = comparable(query);
  if (!needle) return 0;
  const title = comparable(song && song.name);
  const artist = comparable(
    song && Array.isArray(song.artists)
      ? song.artists.map(item => item.name).join(' ')
      : '',
  );
  const album = comparable(song && song.album && song.album.name);
  let score = 0;
  if (title === needle) score += 180;
  else if (title.includes(needle)) score += 120;
  else if (title && needle.includes(title) && title.length >= 2) score += 70;
  if (artist === needle) score += 150;
  else if (artist.includes(needle)) score += 105;
  if (album === needle) score += 80;
  else if (album.includes(needle)) score += 45;
  return score;
}

function rankPublicSongs(songs, query) {
  const scored = songs.map((song, index) => ({
    song,
    index,
    score: publicScore(song, query),
  }));
  const matched = scored.filter(item => item.score > 0);
  return (matched.length ? matched : scored)
    .sort((left, right) => (
      right.score - left.score || left.index - right.index
    ))
    .map(item => item.song);
}

function createQishuiSearchAdapter(options) {
  options = options && typeof options === 'object' ? options : {};
  const requestJson = requireFunction(options.requestJson, 'requestJson');
  const endpoint = String(options.endpoint || DEFAULT_ENDPOINT);

  return {
    provider: 'qishui',
    async search(params) {
      params = params && typeof params === 'object' ? params : {};
      const query = normalizeText(params.query);
      const limit = boundedInteger(params.limit, 12, 1, 20);
      const offset = boundedInteger(params.offset, 0, 0, 500);
      const requestLimit = Math.min(
        100,
        Math.max(offset + limit * 3, 36),
      );
      const url = new URL(endpoint);
      url.searchParams.set('keyword', query);
      url.searchParams.set('search_type', 'music');
      url.searchParams.set('limit', String(requestLimit));
      url.searchParams.set('real_offset', '0');
      url.searchParams.set('search_source', 'qishui');

      const payload = await requestJson(url.toString(), {
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'User-Agent': 'Mineradio/1.1 (Qishui public catalog bridge)',
        },
      });
      const list = payload && payload.data && Array.isArray(payload.data.list)
        ? payload.data.list
        : [];
      const ranked = rankPublicSongs(
        list.map(mapQishuiItem).filter(song => song.providerSongId && song.name),
        query,
      );
      const songs = ranked.slice(offset, offset + limit);

      return normalizeSearchPage('qishui', {
        songs,
        offset,
        limit,
        nextOffset: offset + songs.length,
        total: ranked.length,
        hasMore: songs.length >= limit
          && (offset + songs.length < ranked.length || requestLimit < 100),
      });
    },
  };
}

module.exports = {
  createQishuiSearchAdapter,
};
