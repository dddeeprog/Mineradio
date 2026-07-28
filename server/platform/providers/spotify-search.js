'use strict';

/*
 * Search-only adaptation from XxHuberrr/Mineradio v2.0.2
 * commit 4abaa190de42c632365ae4244e041bad16443224 (GPL-3.0-only).
 * See THIRD_PARTY_NOTICES.md. Playback and write scopes are intentionally absent.
 */

const { normalizeSearchPage } = require('../search-model');

const DEFAULT_ACCOUNTS_BASE = 'https://accounts.spotify.com';
const DEFAULT_API_BASE = 'https://api.spotify.com/v1';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function envString(env, names) {
  for (const name of names) {
    const value = String(env && env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function spotifyAuthError() {
  const error = new Error('Spotify search authentication is required');
  error.code = 'SPOTIFY_AUTH_REQUIRED';
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

function createSpotifySearchAdapter(options) {
  options = options && typeof options === 'object' ? options : {};
  const requestJson = requireFunction(options.requestJson, 'requestJson');
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
  const accessToken = envString(env, [
    'SPOTIFY_ACCESS_TOKEN',
    'MINERADIO_SPOTIFY_ACCESS_TOKEN',
  ]);
  const clientId = envString(env, [
    'SPOTIFY_CLIENT_ID',
    'MINERADIO_SPOTIFY_CLIENT_ID',
  ]);
  const clientSecret = envString(env, [
    'SPOTIFY_CLIENT_SECRET',
    'MINERADIO_SPOTIFY_CLIENT_SECRET',
  ]);
  const market = (envString(env, [
    'SPOTIFY_MARKET',
    'MINERADIO_SPOTIFY_MARKET',
  ]) || 'US').toUpperCase();
  let clientToken = '';
  let clientTokenExpiresAt = 0;
  let tokenPromise = null;

  async function resolveToken() {
    if (accessToken) return accessToken;
    if (!clientId || !clientSecret) throw spotifyAuthError();
    const timestamp = Number(now()) || Date.now();
    if (clientToken && timestamp < clientTokenExpiresAt - 30000) {
      return clientToken;
    }
    if (tokenPromise) return tokenPromise;
    tokenPromise = requestJson(accountsBase + '/api/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Basic ' + Buffer
          .from(clientId + ':' + clientSecret)
          .toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }, 'grant_type=client_credentials')
      .then(payload => {
        const token = String(payload && payload.access_token || '').trim();
        if (!token) {
          const error = new Error('Spotify token response was invalid');
          error.code = 'SPOTIFY_TOKEN_INVALID';
          error.retryable = true;
          throw error;
        }
        const expiresIn = Math.max(60, Number(payload.expires_in) || 3600);
        clientToken = token;
        clientTokenExpiresAt = (Number(now()) || Date.now()) + expiresIn * 1000;
        return token;
      })
      .finally(() => {
        tokenPromise = null;
      });
    return tokenPromise;
  }

  return {
    provider: 'spotify',
    isReady() {
      return Boolean(accessToken || (clientId && clientSecret));
    },
    async search(params) {
      params = params && typeof params === 'object' ? params : {};
      const query = String(params.query || '').trim();
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
      const tracks = payload && payload.tracks
        && typeof payload.tracks === 'object'
        ? payload.tracks
        : {};
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

module.exports = {
  createSpotifySearchAdapter,
};
