'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPlatformSearchRoutes,
} = require('../server/routes/platform-search');

function harness(overrides) {
  const writes = [];
  const calls = [];
  const routes = createPlatformSearchRoutes({
    sendJSON(_res, payload, status) {
      writes.push({ payload, status });
    },
    async search(params) {
      calls.push(params);
      return {
        schema: 1,
        query: params.query,
        results: [],
        pages: {},
        errors: [],
      };
    },
    ...(overrides || {}),
  });
  return { calls, routes, writes };
}

test('unified search route forwards bounded query parameters', async () => {
  const state = harness();
  const handled = await state.routes.handleRoute(
    '/api/platform/search',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/search?keywords=Signal&provider=qq&limit=9&offset=18'),
  );

  assert.equal(handled, true);
  assert.deepEqual(state.calls, [{
    query: 'Signal',
    provider: 'qq',
    limit: '9',
    offset: '18',
  }]);
  assert.deepEqual(state.writes, [{
    status: 200,
    payload: {
      schema: 1,
      query: 'Signal',
      results: [],
      pages: {},
      errors: [],
    },
  }]);
});

test('unified search route rejects non-GET methods before searching', async () => {
  const state = harness();
  const handled = await state.routes.handleRoute(
    '/api/platform/search',
    { method: 'POST' },
    {},
    new URL('http://localhost/api/platform/search?q=x'),
  );

  assert.equal(handled, true);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.writes, [{
    status: 405,
    payload: {
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
    },
  }]);
});

test('unified search route returns only stable validation errors', async () => {
  const state = harness({
    async search() {
      const error = new Error('token=secret');
      error.code = 'SEARCH_QUERY_REQUIRED';
      error.statusCode = 400;
      throw error;
    },
  });

  await state.routes.handleRoute(
    '/api/platform/search',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/search'),
  );

  assert.deepEqual(state.writes, [{
    status: 400,
    payload: {
      ok: false,
      error: 'SEARCH_QUERY_REQUIRED',
    },
  }]);
  assert.equal(JSON.stringify(state.writes).includes('secret'), false);
});

test('unified search route converts unexpected failures to a generic response', async () => {
  const state = harness({
    async search() {
      const error = new Error('cookie=secret');
      error.code = 'SECRET_CODE';
      throw error;
    },
  });

  await state.routes.handleRoute(
    '/api/platform/search',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/platform/search?q=x'),
  );

  assert.deepEqual(state.writes, [{
    status: 500,
    payload: {
      ok: false,
      error: 'SEARCH_FAILED',
    },
  }]);
});

test('unified search route ignores unrelated paths', async () => {
  const state = harness();
  assert.equal(await state.routes.handleRoute(
    '/api/search',
    { method: 'GET' },
    {},
    new URL('http://localhost/api/search?q=x'),
  ), false);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.writes, []);
});
