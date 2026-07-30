'use strict';

const {
  SEARCH_PROVIDER_ORDER,
  normalizeSearchPage,
} = require('./search-model');

const SEARCH_SCHEMA = 1;
const SAFE_ERROR_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'AUTH_REQUIRED',
  'SPOTIFY_AUTH_REQUIRED',
  'SPOTIFY_TOKEN_INVALID',
  'UPSTREAM_RATE_LIMITED',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(value, fallback, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function requestError(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function normalizeSearchRequest(params) {
  params = isRecord(params) ? params : {};
  const query = String(params.query || params.q || params.keywords || '').trim();
  if (!query) throw requestError('SEARCH_QUERY_REQUIRED');
  if (query.length > 160) throw requestError('SEARCH_QUERY_TOO_LONG');
  const provider = String(params.provider || 'all').trim().toLowerCase();
  if (provider !== 'all' && !SEARCH_PROVIDER_ORDER.includes(provider)) {
    throw requestError('SEARCH_PROVIDER_INVALID');
  }
  return {
    query,
    provider,
    limit: boundedInteger(params.limit, 12, 1, 20),
    offset: boundedInteger(params.offset, 0, 0, 500),
  };
}

function stableError(provider, error) {
  const inputCode = typeof (error && error.code) === 'string'
    ? error.code
    : '';
  const code = SAFE_ERROR_CODES.has(inputCode)
    ? inputCode
    : 'PROVIDER_REQUEST_FAILED';
  const retryable = code === 'AUTH_REQUIRED'
    || code === 'SPOTIFY_AUTH_REQUIRED'
    || code === 'PROVIDER_UNAVAILABLE'
    ? false
    : error && typeof error.retryable === 'boolean'
      ? error.retryable
      : true;
  return {
    provider,
    code,
    retryable,
  };
}

function failedPage(request) {
  return {
    offset: request.offset,
    limit: request.limit,
    nextOffset: request.offset,
    hasMore: false,
    total: 0,
    failed: true,
  };
}

function sanitizePage(provider, page, request) {
  const raw = isRecord(page) ? page : {};
  const pagination = isRecord(raw.pagination) ? raw.pagination : {};
  const records = Array.isArray(raw.records) ? raw.records : [];
  const normalized = normalizeSearchPage(provider, {
    songs: records,
    offset: pagination.offset,
    limit: pagination.limit,
    nextOffset: pagination.nextOffset,
    hasMore: pagination.hasMore,
    total: pagination.total,
  }, {
    playbackAvailable: provider === 'netease' || provider === 'qq',
    offset: request.offset,
    limit: request.limit,
  });
  return {
    records: normalized.records,
    pagination: {
      ...normalized.pagination,
      failed: false,
    },
  };
}

function timeoutError() {
  const error = new Error('Provider search timed out');
  error.code = 'PROVIDER_TIMEOUT';
  error.retryable = true;
  return error;
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError()), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function safeGeneratedAt(now) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  } catch (_) {
    return Date.now();
  }
}

function createSearchAggregator(options) {
  options = isRecord(options) ? options : {};
  const providers = isRecord(options.providers) ? options.providers : {};
  const timeoutMs = boundedInteger(options.timeoutMs, 8000, 1, 30000);
  const now = typeof options.now === 'function' ? options.now : Date.now;

  return async function search(params) {
    const request = normalizeSearchRequest(params);
    const selected = request.provider === 'all'
      ? SEARCH_PROVIDER_ORDER
      : [request.provider];
    const settled = await Promise.all(selected.map(async provider => {
      const adapter = providers[provider];
      if (!adapter || typeof adapter.search !== 'function') {
        const error = new Error('Provider unavailable');
        error.code = 'PROVIDER_UNAVAILABLE';
        error.retryable = false;
        return { provider, error };
      }
      try {
        const page = await withTimeout(adapter.search({
          query: request.query,
          limit: request.limit,
          offset: request.offset,
        }), timeoutMs);
        return {
          provider,
          page: sanitizePage(provider, page, request),
        };
      } catch (error) {
        return { provider, error };
      }
    }));

    const results = [];
    const pages = {};
    const errors = [];
    for (const item of settled) {
      if (item.error) {
        pages[item.provider] = failedPage(request);
        errors.push(stableError(item.provider, item.error));
        continue;
      }
      pages[item.provider] = item.page.pagination;
      results.push(...item.page.records);
    }

    return {
      schema: SEARCH_SCHEMA,
      query: request.query,
      generatedAt: safeGeneratedAt(now),
      results,
      pages,
      errors,
      partial: errors.length > 0 && results.length > 0,
    };
  };
}

module.exports = {
  SEARCH_SCHEMA,
  createSearchAggregator,
  normalizeSearchRequest,
};
