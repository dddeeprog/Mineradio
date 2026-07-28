const defaultHttp = require('node:http');
const { timingSafeEqual } = require('node:crypto');

function hasValidBearerToken(authorization, expectedToken) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;

  const received = Buffer.from(authorization.slice('Bearer '.length), 'utf8');
  const expected = Buffer.from(typeof expectedToken === 'string' ? expectedToken : '', 'utf8');
  return received.length > 0
    && received.length === expected.length
    && timingSafeEqual(received, expected);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

const COMMAND_BODY_MAX_BYTES = 16_384;
const COMMAND_TYPES = new Set(['play', 'pause', 'toggle', 'next', 'previous', 'seek']);

function createProtocolError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeCommandBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const keys = Object.keys(value);
  const allowedKeys = new Set(['requestId', 'type', 'positionMs']);
  if (keys.some((key) => !allowedKeys.has(key))) return null;

  const { requestId, type } = value;
  if (
    typeof requestId !== 'string'
    || requestId.length < 1
    || requestId.length > 128
    || requestId.trim().length === 0
    || typeof type !== 'string'
    || !COMMAND_TYPES.has(type)
  ) return null;

  const hasPosition = Object.prototype.hasOwnProperty.call(value, 'positionMs');
  if (type !== 'seek') {
    if (hasPosition) return null;
    return { requestId, type };
  }
  if (!hasPosition || !isNonNegativeSafeInteger(value.positionMs)) return null;
  return { positionMs: value.positionMs, requestId, type };
}

function readJsonRequestBody(request) {
  const declaredLength = request?.headers?.['content-length'];
  if (
    typeof declaredLength === 'string'
    && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > COMMAND_BODY_MAX_BYTES
  ) {
    request.resume?.();
    return Promise.reject(createProtocolError('BODY_TOO_LARGE'));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      request.removeListener('aborted', onAborted);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAborted = () => settle(reject, createProtocolError('INVALID_COMMAND'));
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > COMMAND_BODY_MAX_BYTES) {
        request.resume?.();
        settle(reject, createProtocolError('BODY_TOO_LARGE'));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        settle(reject, createProtocolError('INVALID_COMMAND'));
        return;
      }
      settle(resolve, parsed);
    };
    const onError = () => settle(reject, createProtocolError('INVALID_COMMAND'));

    request.once('aborted', onAborted);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
  });
}

function createEislandBridgeServer({
  bridge,
  http = defaultHttp,
  instanceId,
  token,
} = {}) {
  let server;
  let startPromise;
  let closePromise;

  function getBridgeState() {
    const state = typeof bridge?.getState === 'function' ? bridge.getState() : null;
    return state && typeof state === 'object' ? state : { status: 'not-ready' };
  }

  function getRoutePath(request) {
    try {
      return new URL(typeof request?.url === 'string' ? request.url : '/', 'http://127.0.0.1').pathname;
    } catch {
      return '';
    }
  }

  async function handleRequest(request, response) {
    if (!hasValidBearerToken(request?.headers?.authorization, token)) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return;
    }

    const routePath = getRoutePath(request);
    const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
    if (routePath === '/api/eisland/v1/health') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      const state = getBridgeState();
      const status = ['ready', 'not-ready', 'stale'].includes(state.status)
        ? state.status
        : 'not-ready';
      sendJson(response, 200, {
        instanceId,
        protocol: 'mineradio-bridge/v1',
        status,
      });
      return;
    }

    if (routePath === '/api/eisland/v1/state') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      sendJson(response, 200, getBridgeState());
      return;
    }
    if (routePath === '/api/eisland/v1/lyrics') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }

      let requestUrl;
      try {
        requestUrl = new URL(
          typeof request?.url === 'string' ? request.url : '/',
          'http://127.0.0.1',
        );
      } catch {
        sendJson(response, 400, { error: 'INVALID_LYRICS_VERSION' });
        return;
      }
      const trackRevisionValues = requestUrl.searchParams.getAll('trackRevision');
      const lyricsRevisionValues = requestUrl.searchParams.getAll('lyricsRevision');
      if (trackRevisionValues.length !== 1 || lyricsRevisionValues.length !== 1) {
        sendJson(response, 400, { error: 'INVALID_LYRICS_VERSION' });
        return;
      }
      const trackRevision = Number(trackRevisionValues[0]);
      const lyricsRevision = Number(lyricsRevisionValues[0]);
      if (
        !/^\d+$/.test(trackRevisionValues[0])
        || !/^\d+$/.test(lyricsRevisionValues[0])
        || !isNonNegativeSafeInteger(trackRevision)
        || !isNonNegativeSafeInteger(lyricsRevision)
      ) {
        sendJson(response, 400, { error: 'INVALID_LYRICS_VERSION' });
        return;
      }

      const state = getBridgeState();
      if (state.trackRevision !== trackRevision || state.lyricsRevision !== lyricsRevision) {
        sendJson(response, 409, { error: 'LYRICS_VERSION_CONFLICT' });
        return;
      }

      let lyrics;
      try {
        lyrics = typeof bridge?.getLyrics === 'function'
          ? await bridge.getLyrics({ lyricsRevision, trackRevision })
          : null;
      } catch {
        sendJson(response, 500, { error: 'INTERNAL' });
        return;
      }
      if (!lyrics || typeof lyrics !== 'object' || Array.isArray(lyrics)) {
        const sourceLyrics = state.lyrics && typeof state.lyrics === 'object'
          ? state.lyrics
          : {};
        lyrics = {
          lines: Array.isArray(sourceLyrics.lines) ? sourceLyrics.lines : [],
          status: sourceLyrics.status === 'loading' || sourceLyrics.status === 'unavailable'
            ? sourceLyrics.status
            : state.lyrics == null
              ? 'unavailable'
              : 'ready',
          trackId: sourceLyrics.trackId ?? state.track?.id ?? null,
        };
      }
      sendJson(response, 200, {
        ...lyrics,
        instanceId,
        lyricsRevision,
        trackRevision,
      });
      return;
    }

    if (routePath === '/api/eisland/v1/command') {
      if (method !== 'POST') {
        sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }

      let rawCommand;
      try {
        rawCommand = await readJsonRequestBody(request);
      } catch (error) {
        sendJson(response, error?.code === 'BODY_TOO_LARGE' ? 413 : 400, {
          error: error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_COMMAND',
        });
        return;
      }
      const command = normalizeCommandBody(rawCommand);
      if (!command) {
        sendJson(response, 400, { error: 'INVALID_COMMAND' });
        return;
      }
      if (getBridgeState().status !== 'ready') {
        sendJson(response, 200, {
          error: 'NOT_READY',
          ok: false,
          outcome: 'rejected',
          requestId: command.requestId,
        });
        return;
      }
      if (typeof bridge?.enqueueCommand !== 'function') {
        sendJson(response, 500, { error: 'INTERNAL' });
        return;
      }

      try {
        const result = await bridge.enqueueCommand({
          command: command.type,
          payload: command.type === 'seek' ? { positionMs: command.positionMs } : {},
          requestId: command.requestId,
        });
        sendJson(response, 200, result);
      } catch {
        sendJson(response, 500, { error: 'INTERNAL' });
      }
      return;
    }


    sendJson(response, 404, { error: 'NOT_FOUND' });
  }

  function start() {
    if (startPromise) return startPromise;

    server = http.createServer(handleRequest);
    startPromise = new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        const address = server.address();
        resolve({ port: address.port });
      };

      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(0, '127.0.0.1');
      } catch (error) {
        onError(error);
      }
    });
    return startPromise;
  }

  function close() {
    if (closePromise) return closePromise;
    if (!server) {
      closePromise = Promise.resolve(false);
      return closePromise;
    }

    closePromise = new Promise((resolve, reject) => {
      try {
        server.close((error) => {
          if (error) reject(error);
          else resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
    return closePromise;
  }

  return {
    close,
    start,
  };
}

module.exports = {
  createEislandBridgeServer,
};
