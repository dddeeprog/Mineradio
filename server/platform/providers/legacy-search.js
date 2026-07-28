'use strict';

const {
  SEARCH_PROVIDER_ORDER,
  normalizeSearchPage,
} = require('../search-model');

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} is required`);
  return value;
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function responseSongs(response) {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== 'object') return [];
  if (Array.isArray(response.songs)) return response.songs;
  if (Array.isArray(response.records)) return response.records;
  return [];
}

function createLegacySearchAdapter(options) {
  options = options && typeof options === 'object' ? options : {};
  const provider = String(options.provider || '');
  if (!SEARCH_PROVIDER_ORDER.includes(provider)) {
    throw new TypeError('provider is required');
  }
  const search = requireFunction(options.search, 'search');
  const supportsOffset = options.supportsOffset === true;
  const playbackAvailable = options.playbackAvailable === true;
  const maxFetch = boundedInteger(options.maxFetch, 200, 1, 500);

  return {
    provider,
    async search(params) {
      params = params && typeof params === 'object' ? params : {};
      const query = String(params.query || '').trim();
      const limit = boundedInteger(params.limit, 12, 1, 20);
      const offset = boundedInteger(params.offset, 0, 0, 500);
      const fetchLimit = supportsOffset
        ? limit
        : Math.min(maxFetch, offset + limit);
      const response = await search(
        query,
        fetchLimit,
        supportsOffset ? offset : 0,
      );
      const sourceSongs = responseSongs(response);
      const songs = (supportsOffset
        ? sourceSongs
        : sourceSongs.slice(offset, offset + limit))
        .map(song => ({
          ...song,
          playable: playbackAvailable,
        }));
      const responsePage = response && typeof response === 'object'
        && !Array.isArray(response)
        ? response
        : {};
      const hasMore = typeof responsePage.hasMore === 'boolean'
        ? responsePage.hasMore
        : (supportsOffset
          ? songs.length >= limit
          : sourceSongs.length >= fetchLimit && fetchLimit < maxFetch);

      return normalizeSearchPage(provider, {
        songs,
        offset,
        limit,
        nextOffset: offset + songs.length,
        total: Number(responsePage.total) || offset + songs.length,
        hasMore,
      }, {
        playbackAvailable,
      });
    },
  };
}

module.exports = {
  createLegacySearchAdapter,
};
