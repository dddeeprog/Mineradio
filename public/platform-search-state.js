/*
 * Adapted from XxHuberrr/Mineradio at
 * 4abaa190de42c632365ae4244e041bad16443224.
 * Upstream project license: GPL-3.0-only.
 */
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlatformSearch = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  'use strict';

  var PROVIDER_ORDER = Object.freeze([
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify'
  ]);
  var PROVIDER_LABELS = Object.freeze({
    netease: '网易云',
    qq: 'QQ 音乐',
    kugou: '酷狗',
    qishui: '汽水',
    spotify: 'Spotify'
  });
  var DEFAULT_PAGE_LIMITS = Object.freeze({
    netease: 18,
    qq: 12,
    kugou: 12,
    qishui: 12,
    spotify: 10
  });
  var CAPABILITY_KEYS = [
    'search',
    'playback',
    'playlistWrite',
    'commentsRead'
  ];
  var SAFE_ERROR_CODES = [
    'PROVIDER_TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'PROVIDER_REQUEST_FAILED',
    'AUTH_REQUIRED',
    'SPOTIFY_AUTH_REQUIRED',
    'SPOTIFY_TOKEN_INVALID',
    'UPSTREAM_RATE_LIMITED'
  ];

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function boundedInteger(value, fallback, min, max) {
    var number = Math.floor(Number(value));
    if (!isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function capabilityMap(value) {
    var source = isRecord(value) ? value : {};
    var out = {};
    CAPABILITY_KEYS.forEach(function(key) {
      out[key] = source[key] === true;
    });
    return out;
  }

  function emptyCapability(provider) {
    return {
      provider: provider,
      label: PROVIDER_LABELS[provider],
      capabilities: capabilityMap(),
      availability: capabilityMap()
    };
  }

  function fallbackCapabilities() {
    var map = {};
    PROVIDER_ORDER.forEach(function(provider) {
      map[provider] = emptyCapability(provider);
    });
    ['netease', 'qq'].forEach(function(provider) {
      map[provider].capabilities.search = true;
      map[provider].capabilities.playback = true;
      map[provider].availability.search = true;
      map[provider].availability.playback = true;
    });
    map.netease.capabilities.playlistWrite = true;
    return map;
  }

  function normalizeCapabilitySnapshot(snapshot) {
    if (!isRecord(snapshot) || !Array.isArray(snapshot.providers)) {
      return fallbackCapabilities();
    }
    var map = {};
    PROVIDER_ORDER.forEach(function(provider) {
      map[provider] = emptyCapability(provider);
    });
    snapshot.providers.forEach(function(item) {
      if (!isRecord(item) || PROVIDER_ORDER.indexOf(item.provider) < 0) return;
      var provider = item.provider;
      map[provider] = {
        provider: provider,
        label: typeof item.label === 'string' && item.label.trim()
          ? item.label.trim()
          : PROVIDER_LABELS[provider],
        capabilities: capabilityMap(item.capabilities),
        availability: capabilityMap(item.availability)
      };
    });
    return map;
  }

  function sessionKey(query, mode) {
    return String(mode || 'song') + '|' + String(query || '').trim();
  }

  function activeProviders(mode, capabilities) {
    if (PROVIDER_ORDER.indexOf(mode) >= 0) {
      return capabilities[mode]
        && capabilities[mode].capabilities.search
        && capabilities[mode].availability.search
        ? [mode]
        : [];
    }
    if (mode !== 'song') return [];
    return PROVIDER_ORDER.filter(function(provider) {
      var item = capabilities[provider];
      return !!(item
        && item.capabilities.search
        && item.availability.search);
    });
  }

  function normalizePageLimits(value) {
    var source = isRecord(value) ? value : {};
    var out = {};
    PROVIDER_ORDER.forEach(function(provider) {
      out[provider] = boundedInteger(
        source[provider],
        DEFAULT_PAGE_LIMITS[provider],
        1,
        20
      );
    });
    return out;
  }

  function createProviderState(provider, pageLimit) {
    return {
      provider: provider,
      status: 'idle',
      errorCode: '',
      count: 0,
      page: {
        offset: 0,
        limit: pageLimit,
        nextOffset: 0,
        hasMore: false,
        total: 0
      }
    };
  }

  function createSession(options) {
    options = isRecord(options) ? options : {};
    var query = String(options.query || '').trim();
    var mode = String(options.mode || 'song');
    var capabilities = isRecord(options.capabilities)
      ? options.capabilities
      : normalizeCapabilitySnapshot(options.capabilitySnapshot);
    var providers = activeProviders(mode, capabilities);
    var pageLimits = normalizePageLimits(options.pageLimits);
    var providerState = {};
    var pools = {};
    providers.forEach(function(provider) {
      providerState[provider] = createProviderState(
        provider,
        pageLimits[provider]
      );
      pools[provider] = [];
    });
    return {
      key: sessionKey(query, mode),
      query: query,
      mode: mode,
      providers: providers,
      capabilities: capabilities,
      pageLimits: pageLimits,
      providerState: providerState,
      pools: pools,
      songs: [],
      maxResults: boundedInteger(options.maxResults, 200, 1, 300)
    };
  }

  function providerRequestUrl(provider, query, limit, offset) {
    return '/api/platform/search?q=' + encodeURIComponent(String(query || ''))
      + '&provider=' + encodeURIComponent(String(provider || ''))
      + '&limit=' + boundedInteger(limit, 12, 1, 20)
      + '&offset=' + boundedInteger(offset, 0, 0, 500);
  }

  function takeProviderRequests(session, options) {
    if (!isRecord(session)) return [];
    options = isRecord(options) ? options : {};
    var nextPage = options.nextPage === true;
    var requests = [];
    (session.providers || []).forEach(function(provider) {
      var state = session.providerState[provider];
      if (!state) return;
      if (state.status === 'loading' || state.status === 'loading-more') return;
      if (nextPage) {
        if (!state.page.hasMore) return;
      } else if (state.status !== 'idle') {
        return;
      }
      var offset = nextPage ? state.page.nextOffset : 0;
      var limit = session.pageLimits[provider];
      state.status = nextPage ? 'loading-more' : 'loading';
      state.errorCode = '';
      requests.push({
        provider: provider,
        offset: offset,
        limit: limit,
        url: providerRequestUrl(provider, session.query, limit, offset)
      });
    });
    return requests;
  }

  function recordKey(record) {
    if (!isRecord(record)) return '';
    var provider = String(record.provider || '');
    var sourceId = String(record.sourceId || '');
    if (PROVIDER_ORDER.indexOf(provider) < 0 || !sourceId) return '';
    return provider + ':' + sourceId;
  }

  function normalizeArtists(value) {
    return (Array.isArray(value) ? value : []).map(function(artist) {
      if (!isRecord(artist) || !String(artist.name || '').trim()) return null;
      return {
        id: String(artist.id || ''),
        name: String(artist.name || '').trim()
      };
    }).filter(Boolean);
  }

  function copyAvailability(capability) {
    return {
      capabilities: capabilityMap(capability && capability.capabilities),
      availability: capabilityMap(capability && capability.availability)
    };
  }

  function recordToSong(record, capability) {
    if (!isRecord(record)) return null;
    var key = recordKey(record);
    if (!key || !String(record.title || '').trim()) return null;
    var provider = record.provider;
    var artists = normalizeArtists(record.artists);
    var album = isRecord(record.album) ? record.album : {};
    var providerData = isRecord(record.providerData)
      ? record.providerData
      : {};
    var access = copyAvailability(capability);
    var playbackSupported = access.capabilities.playback
      && access.availability.playback;
    var playable = record.playable === true
      && isRecord(record.capabilities)
      && record.capabilities.playback === true
      && playbackSupported;
    var song = {
      provider: provider,
      source: provider,
      type: provider,
      id: String(record.sourceId),
      name: String(record.title).trim(),
      artist: artists.map(function(artist) { return artist.name; }).join(' / '),
      artists: artists,
      album: String(album.name || ''),
      albumId: String(album.id || providerData.albumId || ''),
      cover: String(record.cover || ''),
      duration: Math.max(0, Number(record.durationMs) || 0),
      durationMs: Math.max(0, Number(record.durationMs) || 0),
      playable: playable,
      fee: Number(providerData.fee) || 0,
      _searchRecordKey: key,
      _platformAccess: access
    };
    if (providerData.mid) {
      song.mid = String(providerData.mid);
      song.songmid = song.mid;
    }
    if (providerData.mediaMid) song.mediaMid = String(providerData.mediaMid);
    if (providerData.qqId) song.qqId = String(providerData.qqId);
    if (providerData.hash) {
      song.hash = String(providerData.hash);
      song.fileHash = song.hash;
    }
    if (providerData.albumAudioId) {
      song.albumAudioId = String(providerData.albumAudioId);
    }
    if (providerData.providerSongId) {
      song.providerSongId = String(providerData.providerSongId);
    }
    if (providerData.spotifyId) {
      song.spotifyId = String(providerData.spotifyId);
    }
    if (providerData.uri) song.uri = String(providerData.uri);
    if (providerData.externalUrl) {
      song.spotifyUrl = String(providerData.externalUrl);
    }
    return song;
  }

  function mergePool(existing, incoming, maxCount) {
    var out = [];
    var seen = {};
    function push(song) {
      if (!song || out.length >= maxCount) return;
      var key = String(song._searchRecordKey || '');
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(song);
    }
    (existing || []).forEach(push);
    (incoming || []).forEach(push);
    return out;
  }

  function rebuildSongs(session) {
    var songs = [];
    session.providers.forEach(function(provider) {
      (session.pools[provider] || []).forEach(function(song) {
        if (songs.length < session.maxResults) songs.push(song);
      });
    });
    session.songs = songs;
  }

  function safePage(raw, fallbackLimit, count) {
    raw = isRecord(raw) ? raw : {};
    var offset = boundedInteger(raw.offset, 0, 0, 500);
    var limit = boundedInteger(raw.limit, fallbackLimit, 1, 20);
    var nextOffset = boundedInteger(
      raw.nextOffset,
      offset + count,
      offset,
      500
    );
    return {
      offset: offset,
      limit: limit,
      nextOffset: nextOffset,
      hasMore: raw.hasMore === true && nextOffset > offset,
      total: Math.max(
        offset + count,
        boundedInteger(raw.total, 0, 0, 10000000)
      )
    };
  }

  function safeErrorCode(value) {
    var code = String(value || '');
    return SAFE_ERROR_CODES.indexOf(code) >= 0
      ? code
      : 'PROVIDER_REQUEST_FAILED';
  }

  function applyProviderResponse(session, provider, payload) {
    if (!isRecord(session) || !session.providerState[provider]) return false;
    payload = isRecord(payload) ? payload : {};
    var state = session.providerState[provider];
    var error = (Array.isArray(payload.errors) ? payload.errors : [])
      .filter(function(item) {
        return isRecord(item) && item.provider === provider;
      })[0];
    if (error) {
      state.status = 'error';
      state.errorCode = safeErrorCode(error.code);
      state.page.hasMore = false;
      return true;
    }

    var rawRecords = (Array.isArray(payload.results) ? payload.results : [])
      .filter(function(item) {
        return isRecord(item) && item.provider === provider;
      });
    var incoming = rawRecords.map(function(item) {
      return recordToSong(item, session.capabilities[provider]);
    }).filter(Boolean);
    var rawPage = isRecord(payload.pages) ? payload.pages[provider] : {};
    var page = safePage(
      rawPage,
      session.pageLimits[provider],
      incoming.length
    );
    session.pools[provider] = page.offset > 0
      ? mergePool(session.pools[provider], incoming, session.maxResults)
      : mergePool([], incoming, session.maxResults);
    state.page = page;
    state.count = session.pools[provider].length;
    state.status = state.count ? 'success' : 'empty';
    state.errorCode = '';
    rebuildSongs(session);
    return true;
  }

  function applyProviderFailure(session, provider, error) {
    if (!isRecord(session) || !session.providerState[provider]) return false;
    var state = session.providerState[provider];
    state.status = 'error';
    state.errorCode = safeErrorCode(error && error.code);
    state.page.hasMore = false;
    return true;
  }

  function statusItems(session) {
    if (!isRecord(session)) return [];
    return (session.providers || []).map(function(provider) {
      var state = session.providerState[provider];
      var capability = session.capabilities[provider];
      return {
        provider: provider,
        label: capability && capability.label || PROVIDER_LABELS[provider],
        status: state.status,
        count: state.count,
        errorCode: state.errorCode,
        hasMore: state.page.hasMore
      };
    });
  }

  function hasMore(session) {
    if (!isRecord(session)) return false;
    return (session.providers || []).some(function(provider) {
      var state = session.providerState[provider];
      return !!(state && state.page.hasMore);
    });
  }

  function actionState(song) {
    var access = isRecord(song && song._platformAccess)
      ? song._platformAccess
      : {};
    var capabilities = capabilityMap(access.capabilities);
    var availability = capabilityMap(access.availability);
    var play = !!(song
      && song.playable === true
      && capabilities.playback
      && availability.playback);
    var playlistWrite = capabilities.playlistWrite
      && availability.playlistWrite;
    return {
      play: play,
      queue: play,
      like: playlistWrite,
      collect: playlistWrite,
      metadataOnly: !play
    };
  }

  function sessionMatches(session, key) {
    return !!(isRecord(session) && session.key === String(key || ''));
  }

  return {
    PROVIDER_LABELS: PROVIDER_LABELS,
    PROVIDER_ORDER: PROVIDER_ORDER,
    actionState: actionState,
    applyProviderFailure: applyProviderFailure,
    applyProviderResponse: applyProviderResponse,
    createSession: createSession,
    hasMore: hasMore,
    normalizeCapabilitySnapshot: normalizeCapabilitySnapshot,
    providerRequestUrl: providerRequestUrl,
    sessionKey: sessionKey,
    sessionMatches: sessionMatches,
    statusItems: statusItems,
    takeProviderRequests: takeProviderRequests
  };
});
