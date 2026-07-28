'use strict';

const SEARCH_PROVIDER_ORDER = Object.freeze([
  'netease',
  'qq',
  'kugou',
  'qishui',
  'spotify',
]);

const PLAYBACK_PROVIDERS = new Set(['netease', 'qq']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function safeString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return '';
}

function firstString(values) {
  for (const value of values) {
    const normalized = safeString(value);
    if (normalized) return normalized;
  }
  return '';
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function comparable(value) {
  const source = safeString(value);
  const normalized = typeof source.normalize === 'function'
    ? source.normalize('NFKC')
    : source;
  return normalized
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function sourceIdFor(provider, raw) {
  const candidates = {
    netease: [raw.sourceId, raw.id],
    qq: [raw.sourceId, raw.mid, raw.songmid, raw.id],
    kugou: [
      raw.sourceId,
      raw.hash,
      raw.fileHash,
      raw.id,
      raw.mixSongId,
      raw.albumAudioId,
    ],
    qishui: [
      raw.sourceId,
      raw.providerSongId,
      raw.itemId,
      raw.item_id,
      raw.id,
    ],
    spotify: [raw.sourceId, raw.spotifyId, raw.id],
  };
  return firstString(candidates[provider] || []);
}

function normalizeArtists(raw) {
  const source = Array.isArray(raw.artists)
    ? raw.artists
    : (Array.isArray(raw.ar) ? raw.ar : null);
  if (source) {
    return source
      .map(artist => {
        if (!isRecord(artist)) return null;
        const name = firstString([artist.name, artist.title]);
        if (!name) return null;
        return {
          id: firstString([artist.id, artist.mid]),
          name,
        };
      })
      .filter(Boolean);
  }

  const name = firstString([raw.artist, raw.singer, raw.artistName]);
  return name ? [{ id: '', name }] : [];
}

function normalizeAlbum(raw) {
  const album = isRecord(raw.album)
    ? raw.album
    : (isRecord(raw.al) ? raw.al : {});
  const stringAlbum = typeof raw.album === 'string' ? raw.album : '';
  return {
    id: firstString([
      album.id,
      album.mid,
      raw.albumId,
      raw.album_id,
      raw.albumMid,
    ]),
    name: firstString([
      album.name,
      album.title,
      stringAlbum,
      raw.albumName,
      raw.album_name,
    ]),
  };
}

function normalizeCover(raw) {
  const album = isRecord(raw.album)
    ? raw.album
    : (isRecord(raw.al) ? raw.al : {});
  return firstString([
    raw.cover,
    raw.coverUrl,
    raw.picUrl,
    album.cover,
    album.coverUrl,
    album.picUrl,
  ]);
}

function durationMsFor(raw) {
  if (hasOwn(raw, 'durationMs')) return Math.round(finiteNonNegative(raw.durationMs));
  return Math.round(finiteNonNegative(
    hasOwn(raw, 'duration') ? raw.duration : raw.dt,
  ));
}

function putString(target, key, values) {
  const value = firstString(values);
  if (value) target[key] = value;
}

function putNumber(target, key, value) {
  if (value === '' || value === null || value === undefined) return;
  const number = Number(value);
  if (Number.isFinite(number)) target[key] = number;
}

function providerDataFor(provider, raw, sourceId, album) {
  const nested = isRecord(raw.providerData) ? raw.providerData : {};
  const data = {};
  if (provider === 'netease') {
    data.id = sourceId;
    putString(data, 'albumId', [album.id, nested.albumId]);
    putNumber(data, 'fee', hasOwn(raw, 'fee') ? raw.fee : nested.fee);
  } else if (provider === 'qq') {
    putString(data, 'mid', [raw.mid, raw.songmid, nested.mid, sourceId]);
    putString(data, 'mediaMid', [
      raw.mediaMid,
      raw.media_mid,
      nested.mediaMid,
    ]);
    putString(data, 'qqId', [
      raw.qqId,
      raw.songId,
      raw.songid,
      nested.qqId,
    ]);
    putString(data, 'albumId', [album.id, nested.albumId]);
    putNumber(data, 'fee', hasOwn(raw, 'fee') ? raw.fee : nested.fee);
  } else if (provider === 'kugou') {
    putString(data, 'hash', [
      raw.hash,
      raw.fileHash,
      nested.hash,
      sourceId,
    ]);
    putString(data, 'albumId', [
      raw.albumId,
      raw.album_id,
      album.id,
      nested.albumId,
    ]);
    putString(data, 'albumAudioId', [
      raw.albumAudioId,
      raw.album_audio_id,
      raw.mixSongId,
      nested.albumAudioId,
    ]);
    putNumber(data, 'fee', hasOwn(raw, 'fee') ? raw.fee : nested.fee);
  } else if (provider === 'qishui') {
    data.providerSongId = sourceId;
    putNumber(data, 'rank', firstString([
      raw.qishuiRank,
      raw.rank,
      nested.rank,
    ]));
  } else if (provider === 'spotify') {
    data.spotifyId = sourceId;
    putString(data, 'uri', [raw.uri, raw.spotifyUri, nested.uri]);
    putString(data, 'externalUrl', [
      raw.spotifyUrl,
      raw.externalUrl,
      isRecord(raw.external_urls) && raw.external_urls.spotify,
      nested.externalUrl,
    ]);
    if (typeof raw.explicit === 'boolean') data.explicit = raw.explicit;
    else if (typeof nested.explicit === 'boolean') {
      data.explicit = nested.explicit;
    }
  }
  return data;
}

function normalizeSearchRecord(provider, raw, options) {
  if (!SEARCH_PROVIDER_ORDER.includes(provider) || !isRecord(raw)) return null;
  options = isRecord(options) ? options : {};
  const sourceId = sourceIdFor(provider, raw);
  const title = firstString([raw.title, raw.name, raw.songName, raw.song_name]);
  if (!sourceId || !title) return null;

  const artists = normalizeArtists(raw);
  const album = normalizeAlbum(raw);
  const durationMs = durationMsFor(raw);
  const playable = PLAYBACK_PROVIDERS.has(provider)
    && options.playbackAvailable === true
    && raw.playable !== false;

  return {
    provider,
    sourceId,
    title,
    artists,
    album,
    cover: normalizeCover(raw),
    durationMs,
    playable,
    matchHints: {
      title: comparable(title),
      artists: artists.map(artist => comparable(artist.name)).filter(Boolean),
      album: comparable(album.name),
      durationMs,
    },
    capabilities: {
      playback: playable,
    },
    providerData: providerDataFor(provider, raw, sourceId, album),
  };
}

function searchRecordKey(record) {
  if (!isRecord(record)) return '';
  const provider = safeString(record.provider);
  const sourceId = safeString(record.sourceId);
  if (!SEARCH_PROVIDER_ORDER.includes(provider) || !sourceId) return '';
  return `${provider}:${sourceId}`;
}

function normalizeSearchPage(provider, rawPage, options) {
  options = isRecord(options) ? options : {};
  const page = Array.isArray(rawPage)
    ? { songs: rawPage }
    : (isRecord(rawPage) ? rawPage : {});
  const rawSongs = Array.isArray(page.records)
    ? page.records
    : (Array.isArray(page.songs) ? page.songs : []);
  const records = [];
  const seen = new Set();
  for (const raw of rawSongs) {
    const record = normalizeSearchRecord(provider, raw, options);
    const key = searchRecordKey(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push(record);
  }

  const offset = boundedInteger(
    hasOwn(page, 'offset') ? page.offset : options.offset,
    0,
    0,
    10000,
  );
  const limit = boundedInteger(
    hasOwn(page, 'limit') ? page.limit : options.limit,
    Math.max(1, records.length),
    1,
    50,
  );
  const nextOffset = boundedInteger(
    page.nextOffset,
    offset + records.length,
    offset,
    10000,
  );
  const total = Math.max(
    offset + records.length,
    boundedInteger(page.total, 0, 0, 10000000),
  );
  const hasMore = typeof page.hasMore === 'boolean'
    ? page.hasMore
    : records.length >= limit;

  return {
    provider,
    records,
    pagination: {
      offset,
      limit,
      nextOffset,
      hasMore: hasMore && nextOffset > offset,
      total,
    },
  };
}

module.exports = {
  SEARCH_PROVIDER_ORDER,
  normalizeSearchPage,
  normalizeSearchRecord,
  searchRecordKey,
};
