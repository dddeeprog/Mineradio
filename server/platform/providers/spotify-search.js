'use strict';

/*
 * Search-only adaptation from XxHuberrr/Mineradio v2.0.2
 * commit 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * See THIRD_PARTY_NOTICES.md. Playback and write scopes are intentionally absent.
 */

const { normalizeSearchPage } = require('../search-model');

const DEFAULT_ACCOUNTS_BASE = 'https://accounts.spotify.com';
const DEFAULT_API_BASE = 'https://api.spotify.com/v1';
const MINIMAL_SCOPE = 'user-read-private';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function optionalFunction(value, fallback) {
  return typeof value === 'function' ? value : fallback;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function envString(env, names) {
  for (const name of names) {
    const value = cleanString(env && env[name]);
    if (value) return value;
  }
  return '';
}

function spotifyAuthError() {
  const error = new Error('Spotify login is required');
  error.code = 'AUTH_REQUIRED';
  error.provider = 'spotify';
  error.retryable = false;
  return error;
}

function largestImage(images) {
  return (Array.isArray(images) ? images : [])
    .filter(item => item && typeof item.url === 'string')
    .sort((left, right) => (
      (Number(right.width) || 0) - (Number(left.width) || 0)
    ))[0]?.url || '';
}

function mapSpotifyTrack(track) {
  track = track && typeof track === 'object' ? track : {};
  const album = track.album && typeof track.album === 'object'
    ? track.album
    : {};
  return {
    spotifyId: track.id,
    name: track.name,
    artists: Array.isArray(track.artists)
      ? track.artists.map(artist => ({
        id: artist && artist.id,
        name: artist && artist.name,
      }))
      : [],
    album: {
      id: album.id,
      name: album.name,
    },
    cover: largestImage(album.images),
    durationMs: track.duration_ms,
    uri: track.uri,
    spotifyUrl: track.external_urls && track.external_urls.spotify,
    explicit: track.explicit === true,
  };
}

function refreshedCredential(payload, previous, now) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const accessToken = cleanString(payload.access_token || payload.accessToken);
  if (!accessToken) throw spotifyAuthError();
  const expiresIn = Math.max(
    60,
    Math.min(24 * 60 * 60, Number(payload.expires_in) || 3600),
  );
  const scope = cleanString(payload.scope || previous.scope) || MINIMAL_SCOPE;
  if (scope !== MINIMAL_SCOPE) throw spotifyAuthError();
  return {
    accessToken,
    refreshToken: cleanString(
      payload.refresh_token || previous.refreshToken,
    ),
    tokenType: cleanString(payload.token_type || previous.tokenType) || 'Bearer',
    scope,
    expiresAt: Number(now()) + expiresIn * 1000,
    clientId: cleanString(previous.clientId),
  };
}

function createSpotifySearchAdapter(options) {
  options = options && typeof options === 'object' ? options : {};
  const requestJson = requireFunction(options.requestJson, 'requestJson');
  const getCredential = optionalFunction(options.getCredential, () => null);
  const persistCredential = optionalFunction(
    options.persistCredential,
    async () => {},
  );
  const env = options.env && typeof options.env === 'object'
    ? options.env
    : process.env;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const accountsBase = String(
    options.accountsBase || DEFAULT_ACCOUNTS_BASE,
  ).replace(/\/+$/, '');
  const apiBase = String(
    options.apiBase || DEFAULT_API_BASE,
  ).replace(/\/+$/, '');
  const market = (envString(env, [
    'SPOTIFY_MARKET',
    'MINERADIO_SPOTIFY_MARKET',
  ]) || 'US').toUpperCase();
  let refreshPromise = null;

  async function refresh(credential) {
    if (refreshPromise) return refreshPromise;
    const refreshToken = cleanString(credential.refreshToken);
    const clientId = cleanString(credential.clientId);
    if (!refreshToken || !clientId) throw spotifyAuthError();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString();
    refreshPromise = Promise.resolve()
      .then(() => requestJson(accountsBase + '/api/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }, body))
      .then(payload => refreshedCredential(payload, credential, now))
      .then(async nextCredential => {
        const result = await persistCredential(nextCredential, credential);
        if (result && result.replaced === false) throw spotifyAuthError();
        return nextCredential;
      })
      .catch(() => {
        throw spotifyAuthError();
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  async function resolveToken() {
    let credential;
    try {
      credential = getCredential();
    } catch (_error) {
      throw spotifyAuthError();
    }
    credential = credential && typeof credential === 'object'
      ? credential
      : {};
    const accessToken = cleanString(credential.accessToken);
    if (cleanString(credential.scope) !== MINIMAL_SCOPE) {
      throw spotifyAuthError();
    }
    const expiresAt = Number(credential.expiresAt) || 0;
    const timestamp = Number(now());
    if (accessToken && expiresAt > timestamp + 30000) return accessToken;
    const nextCredential = await refresh(credential);
    return nextCredential.accessToken;
  }

  return {
    provider: 'spotify',
    isReady() {
      try {
        const credential = getCredential();
        return Boolean(
          credential
          && typeof credential === 'object'
          && cleanString(credential.accessToken)
          && cleanString(credential.scope) === MINIMAL_SCOPE,
        );
      } catch (_error) {
        return false;
      }
    },
    async search(params) {
      params = params && typeof params === 'object' ? params : {};
      const query = cleanString(params.query);
      const limit = boundedInteger(params.limit, 10, 1, 20);
      const offset = boundedInteger(params.offset, 0, 0, 500);
      const token = await resolveToken();
      const url = new URL(apiBase + '/search');
      url.searchParams.set('q', query);
      url.searchParams.set('type', 'track');
      url.searchParams.set('market', market);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));

      const payload = await requestJson(url.toString(), {
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + token,
          'User-Agent': 'Mineradio/1.1 (Spotify Web API bridge)',
        },
      });
      const tracks = tracksObject(payload && payload.tracks);
      const items = Array.isArray(tracks.items) ? tracks.items : [];
      const songs = items
        .filter(track => !track || track.is_local !== true)
        .map(mapSpotifyTrack);

      return normalizeSearchPage('spotify', {
        songs,
        offset,
        limit,
        nextOffset: offset + songs.length,
        total: Number(tracks.total) || 0,
        hasMore: Boolean(tracks.next),
      });
    },
  };
}

function tracksObject(value) {
  return value && typeof value === 'object' ? value : {};
}

module.exports = {
  createSpotifySearchAdapter,
};
