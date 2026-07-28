'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createSearchAggregator,
  normalizeSearchRequest,
} = require('../server/platform/search-aggregator');

function page(provider, sourceId, params) {
  return {
    provider,
    records: [{
      provider,
      sourceId,
      title: provider + ' title',
      artists: [],
      album: { id: '', name: '' },
      cover: '',
      durationMs: 0,
      playable: provider === 'netease' || provider === 'qq',
      matchHints: {
        title: provider + 'title',
        artists: [],
        album: '',
        durationMs: 0,
      },
      capabilities: {
        playback: provider === 'netease' || provider === 'qq',
      },
      providerData: {},
    }],
    pagination: {
      offset: params.offset,
      limit: params.limit,
      nextOffset: params.offset + 1,
      hasMore: false,
      total: 1,
    },
  };
}

function adapters(overrides) {
  const providers = {};
  for (const provider of [
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify',
  ]) {
    providers[provider] = {
      provider,
      async search(params) {
        return page(provider, provider + '-1', params);
      },
    };
  }
  return Object.assign(providers, overrides || {});
}

test('aggregates all providers in fixed order with independent page state', async () => {
  const calls = [];
  const providers = adapters();
  providers.qq.search = async params => {
    calls.push(['qq', params]);
    await new Promise(resolve => setTimeout(resolve, 4));
    return page('qq', 'qq-1', params);
  };
  providers.netease.search = async params => {
    calls.push(['netease', params]);
    await new Promise(resolve => setTimeout(resolve, 8));
    return page('netease', 'ne-1', params);
  };
  const search = createSearchAggregator({
    providers,
    timeoutMs: 100,
    now: () => 1234,
  });

  const response = await search({
    query: 'Signal',
    provider: 'all',
    limit: 7,
    offset: 14,
  });

  assert.equal(response.schema, 1);
  assert.equal(response.query, 'Signal');
  assert.equal(response.generatedAt, 1234);
  assert.deepEqual(
    response.results.map(record => record.provider),
    ['netease', 'qq', 'kugou', 'qishui', 'spotify'],
  );
  assert.deepEqual(Object.keys(response.pages), [
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify',
  ]);
  assert.deepEqual(response.pages.qq, {
    offset: 14,
    limit: 7,
    nextOffset: 15,
    hasMore: false,
    total: 15,
    failed: false,
  });
  assert.deepEqual(response.errors, []);
  assert.equal(response.partial, false);
  assert.deepEqual(calls, [
    ['netease', { query: 'Signal', limit: 7, offset: 14 }],
    ['qq', { query: 'Signal', limit: 7, offset: 14 }],
  ]);
});

test('supports a single provider without invoking the others', async () => {
  const calls = [];
  const providers = adapters();
  for (const provider of Object.keys(providers)) {
    providers[provider].search = async params => {
      calls.push(provider);
      return page(provider, provider + '-1', params);
    };
  }
  const search = createSearchAggregator({ providers });

  const response = await search({
    query: 'one',
    provider: 'qishui',
    limit: 5,
    offset: 0,
  });

  assert.deepEqual(calls, ['qishui']);
  assert.deepEqual(response.results.map(record => record.provider), ['qishui']);
  assert.deepEqual(Object.keys(response.pages), ['qishui']);
});

test('one timeout returns a partial response without delaying successful providers', async () => {
  const providers = adapters({
    spotify: {
      provider: 'spotify',
      search() {
        return new Promise(() => {});
      },
    },
  });
  const search = createSearchAggregator({
    providers,
    timeoutMs: 10,
  });

  const response = await search({
    query: 'timeout',
    provider: 'all',
    limit: 5,
    offset: 0,
  });

  assert.equal(response.results.length, 4);
  assert.equal(response.partial, true);
  assert.deepEqual(response.errors, [{
    provider: 'spotify',
    code: 'PROVIDER_TIMEOUT',
    retryable: true,
  }]);
  assert.deepEqual(response.pages.spotify, {
    offset: 0,
    limit: 5,
    nextOffset: 0,
    hasMore: false,
    total: 0,
    failed: true,
  });
});

test('sanitizes unknown upstream errors and preserves expected auth codes', async () => {
  const secretError = new Error('token=very-secret');
  secretError.code = 'TOKEN_very-secret';
  secretError.body = 'cookie=also-secret';
  const authError = new Error('client-secret');
  authError.code = 'SPOTIFY_AUTH_REQUIRED';
  authError.retryable = false;
  const search = createSearchAggregator({
    providers: adapters({
      kugou: {
        provider: 'kugou',
        async search() {
          throw secretError;
        },
      },
      spotify: {
        provider: 'spotify',
        async search() {
          throw authError;
        },
      },
    }),
  });

  const response = await search({
    query: 'safe',
    provider: 'all',
    limit: 5,
    offset: 0,
  });

  assert.deepEqual(response.errors, [
    {
      provider: 'kugou',
      code: 'PROVIDER_REQUEST_FAILED',
      retryable: true,
    },
    {
      provider: 'spotify',
      code: 'SPOTIFY_AUTH_REQUIRED',
      retryable: false,
    },
  ]);
  assert.equal(JSON.stringify(response).includes('secret'), false);
  assert.equal(response.results.length, 3);
});

test('rebuilds adapter records without unknown fields', async () => {
  const providers = adapters();
  providers.netease.search = async params => {
    const result = page('netease', 'safe-id', params);
    result.records[0].token = 'record-secret';
    result.records[0].providerData = {
      id: 'safe-id',
      fee: 1,
      cookie: 'provider-secret',
    };
    return result;
  };
  const search = createSearchAggregator({ providers });

  const response = await search({
    query: 'sanitize',
    provider: 'netease',
    limit: 5,
    offset: 0,
  });

  assert.deepEqual(response.results[0].providerData, {
    id: 'safe-id',
    fee: 1,
  });
  assert.equal(JSON.stringify(response).includes('secret'), false);
});

test('reports a missing adapter as an isolated provider error', async () => {
  const providers = adapters();
  delete providers.qishui;
  const search = createSearchAggregator({ providers });

  const response = await search({
    query: 'missing',
    provider: 'all',
    limit: 5,
    offset: 0,
  });

  assert.equal(response.results.length, 4);
  assert.deepEqual(
    response.errors.find(error => error.provider === 'qishui'),
    {
      provider: 'qishui',
      code: 'PROVIDER_UNAVAILABLE',
      retryable: false,
    },
  );
});

test('normalizes bounded request values and rejects invalid queries or providers', () => {
  assert.deepEqual(normalizeSearchRequest({
    query: '  Signal  ',
    provider: 'qq',
    limit: 999,
    offset: -20,
  }), {
    query: 'Signal',
    provider: 'qq',
    limit: 20,
    offset: 0,
  });

  assert.throws(
    () => normalizeSearchRequest({ query: '' }),
    error => error.code === 'SEARCH_QUERY_REQUIRED'
      && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeSearchRequest({ query: 'x', provider: 'unknown' }),
    error => error.code === 'SEARCH_PROVIDER_INVALID'
      && error.statusCode === 400,
  );
  assert.throws(
    () => normalizeSearchRequest({ query: 'x'.repeat(161) }),
    error => error.code === 'SEARCH_QUERY_TOO_LONG'
      && error.statusCode === 400,
  );
});
