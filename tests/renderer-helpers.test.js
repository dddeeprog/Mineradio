const assert = require('node:assert/strict');
const test = require('node:test');

const { createMineradioApi } = require('../public/api-client');
const { createMineradioStorage } = require('../public/storage');
const { createMineradioActions } = require('../public/actions');

function jsonResponse(status, body, headers) {
  const headerMap = new Map(Object.entries(headers || { 'content-type': 'application/json' }).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get(name) {
        return headerMap.get(String(name || '').toLowerCase()) || '';
      },
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

test('renderer api client returns JSON and normalizes non-ok responses', async () => {
  const calls = [];
  const api = createMineradioApi({
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return url === '/fail'
        ? jsonResponse(503, { error: 'offline' })
        : jsonResponse(200, { ok: true, name: 'Mineradio' });
    },
    defaultTimeoutMs: 1000,
  });

  assert.deepEqual(await api.request('/version'), { ok: true, name: 'Mineradio' });
  assert.deepEqual(await api.request('/fail'), { error: 'offline', ok: false, status: 503 });
  assert.equal(calls[0].opts.method, 'GET');
});

test('renderer api client aborts timed requests and returns a stable error shape', async () => {
  let abortHandler;
  const api = createMineradioApi({
    fetch: (_url, opts) => new Promise((_resolve, reject) => {
      abortHandler = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      opts.signal.addEventListener('abort', abortHandler);
    }),
    AbortController,
    setTimeout(fn) {
      fn();
      return 1;
    },
    clearTimeout() {},
    defaultTimeoutMs: 50,
  });

  const result = await api.request('/slow');
  assert.equal(typeof abortHandler, 'function');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REQUEST_TIMEOUT');
  assert.match(result.error, /timed out|aborted/i);
});

test('renderer storage safely reads JSON and flushes debounced writes', () => {
  const values = new Map([['bad', '{nope']]);
  const timers = new Map();
  let nextTimerId = 1;
  const storage = createMineradioStorage({
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
    setTimeout(fn) {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });

  assert.deepEqual(storage.getJson('bad', { ok: false }), { ok: false });
  storage.setJsonDebounced('prefs', { volume: 0.5 }, 500);
  storage.setJsonDebounced('prefs', { volume: 0.8 }, 500);
  assert.equal(values.has('prefs'), false);

  storage.flush();
  assert.equal(values.get('prefs'), '{"volume":0.8}');
});

test('renderer action facade dispatches registered data-action handlers', () => {
  let calledWith = null;
  const actions = createMineradioActions();
  actions.register('play', (event, target) => {
    calledWith = { eventType: event.type, action: target.getAttribute('data-action') };
    return 'handled';
  });

  const target = {
    getAttribute(name) {
      return name === 'data-action' ? 'play' : null;
    },
    closest(selector) {
      return selector === '[data-action]' ? target : null;
    },
  };
  const result = actions.dispatch({ type: 'click', target });

  assert.equal(result, 'handled');
  assert.deepEqual(calledWith, { eventType: 'click', action: 'play' });
});
