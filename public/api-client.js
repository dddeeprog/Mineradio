(function(root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioApi = api.createMineradioApi({ root: root });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(globalRoot) {
  var DEFAULT_TIMEOUT_MS = 12000;

  function headerValue(headers, name) {
    if (!headers || typeof headers.get !== 'function') return '';
    try { return headers.get(name) || ''; } catch (e) { return ''; }
  }

  function parseJsonText(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  async function readBody(res) {
    var text = '';
    if (res && typeof res.text === 'function') text = await res.text();
    var type = headerValue(res && res.headers, 'content-type').toLowerCase();
    if (type.indexOf('json') >= 0) return parseJsonText(text);
    var parsed = parseJsonText(text);
    return parsed;
  }

  function messageFromError(err) {
    return err && (err.message || err.name) ? String(err.message || err.name) : 'Request failed';
  }

  function normalizeErrorBody(res, body) {
    var status = res && res.status || 0;
    var fallback = res && (res.statusText || ('HTTP ' + status)) || 'Request failed';
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (body.ok === undefined) body.ok = false;
      if (body.status === undefined) body.status = status;
      if (!body.error) body.error = body.message || fallback;
      return body;
    }
    return {
      ok: false,
      status: status,
      error: body ? String(body) : fallback,
    };
  }

  function createMineradioApi(options) {
    options = options || {};
    var root = options.root || globalRoot || {};
    var fetchImpl = options.fetch || root.fetch;
    var AbortCtor = options.AbortController || root.AbortController;
    var setTimer = options.setTimeout || root.setTimeout || setTimeout;
    var clearTimer = options.clearTimeout || root.clearTimeout || clearTimeout;
    var defaultTimeoutMs = Number(options.defaultTimeoutMs) || DEFAULT_TIMEOUT_MS;

    async function request(url, opts) {
      opts = opts || {};
      if (typeof fetchImpl !== 'function') {
        return { ok: false, status: 0, error: 'Fetch API is unavailable', code: 'FETCH_UNAVAILABLE' };
      }

      var timeoutMs = opts.timeoutMs == null ? defaultTimeoutMs : Number(opts.timeoutMs) || 0;
      var fetchOpts = Object.assign({}, opts);
      delete fetchOpts.timeoutMs;
      fetchOpts.method = fetchOpts.method || 'GET';

      var controller = null;
      var timer = null;
      var timedOut = false;
      if (timeoutMs > 0 && AbortCtor && !fetchOpts.signal) {
        controller = new AbortCtor();
        fetchOpts.signal = controller.signal;
      }

      try {
        var pending = fetchImpl(url, fetchOpts);
        if (controller) {
          timer = setTimer(function() {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
        }
        var res = await pending;
        var body = await readBody(res);
        if (!res || !res.ok) return normalizeErrorBody(res, body);
        if (body && typeof body === 'object') return body;
        if (body == null || body === '') return null;
        return { ok: true, status: res.status || 200, body: body };
      } catch (err) {
        var aborted = timedOut || err && err.name === 'AbortError';
        return {
          ok: false,
          status: 0,
          error: aborted ? 'Request timed out or was aborted' : messageFromError(err),
          code: aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED',
        };
      } finally {
        if (timer) clearTimer(timer);
      }
    }

    return {
      DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
      request: request,
    };
  }

  return {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    createMineradioApi: createMineradioApi,
  };
});
