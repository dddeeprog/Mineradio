const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

function loadBridgeServer() {
  try {
    return require('./eisland-bridge-server');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function createFakeHttp() {
  const calls = [];
  const server = new EventEmitter();
  server.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 41_234 });
  server.close = (callback) => queueMicrotask(callback);
  server.listen = (...args) => {
    calls.push(args);
    queueMicrotask(() => server.emit('listening'));
    return server;
  };

  return {
    calls,
    server,
    createServer(handler) {
      server.handler = handler;
      return server;
    },
  };
}

async function invokeFakeRequest(handler, {
  body,
  headers = {},
  method = 'GET',
  url = '/',
} = {}) {
  const request = new EventEmitter();
  request.headers = headers;
  request.method = method;
  request.url = url;

  const response = {
    body: '',
    headers: {},
    statusCode: 200,
    end(chunk = '') {
      this.body += String(chunk);
      this.ended = true;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
  };

  const result = handler(request, response);
  if (body !== undefined) request.emit('data', Buffer.from(body));
  request.emit('end');
  await result;
  return response;
}

test('binds_ipv4_loopback_and_ignores_lan_environment', async () => {
  const { createEislandBridgeServer } = loadBridgeServer();
  assert.equal(typeof createEislandBridgeServer, 'function');

  const http = createFakeHttp();
  const previousHost = process.env.HOST;
  const previousAllowLan = process.env.MINERADIO_ALLOW_LAN;
  process.env.HOST = '0.0.0.0';
  process.env.MINERADIO_ALLOW_LAN = 'true';

  try {
    const bridgeServer = createEislandBridgeServer({
      bridge: { getState: () => ({ status: 'not-ready' }) },
      http,
      instanceId: 'loopback-instance',
      token: 'loopback-token',
    });

    assert.deepEqual(await bridgeServer.start(), { port: 41_234 });
    assert.deepEqual(http.calls, [[0, '127.0.0.1']]);
    await bridgeServer.close();
  } finally {
    if (previousHost === undefined) delete process.env.HOST;
    else process.env.HOST = previousHost;
    if (previousAllowLan === undefined) delete process.env.MINERADIO_ALLOW_LAN;
    else process.env.MINERADIO_ALLOW_LAN = previousAllowLan;
  }
});

test('rejects_auth_without_cors_or_secret_leak', async () => {
  const { createEislandBridgeServer } = loadBridgeServer();
  assert.equal(typeof createEislandBridgeServer, 'function');

  const capturedLogs = [];
  const http = createFakeHttp();
  const token = 'bridge-token-must-never-leak';
  const bridgeServer = createEislandBridgeServer({
    bridge: { getState: () => ({ status: 'ready' }) },
    http,
    instanceId: 'auth-instance',
    logger: { error: (message) => capturedLogs.push(String(message)) },
    token,
  });
  await bridgeServer.start();

  try {
    for (const authorization of [undefined, 'Bearer definitely-wrong-token']) {
      const response = await invokeFakeRequest(http.server.handler, {
        headers: authorization === undefined ? {} : { authorization },
        url: '/api/eisland/v1/health',
      });

      assert.equal(response.statusCode, 401);
      assert.equal(response.ended, true);
      assert.doesNotMatch(response.body, new RegExp(token));
      assert.equal(
        Object.keys(response.headers).some((header) => header.startsWith('access-control-allow')),
        false,
      );
    }
    assert.doesNotMatch(capturedLogs.join('\n'), new RegExp(token));
  } finally {
    await bridgeServer.close();
  }
});

test('returns_exact_health_state_and_route_errors', async () => {
  const { createEislandBridgeServer } = loadBridgeServer();
  assert.equal(typeof createEislandBridgeServer, 'function');

  const state = {
    playback: { positionMs: 12_000, status: 'playing' },
    revision: 9,
    status: 'ready',
    trackRevision: 4,
  };
  const http = createFakeHttp();
  const bridgeServer = createEislandBridgeServer({
    bridge: { getState: () => state },
    http,
    instanceId: 'route-instance',
    token: 'route-token',
  });
  await bridgeServer.start();

  const headers = { authorization: 'Bearer route-token' };
  try {
    const health = await invokeFakeRequest(http.server.handler, {
      headers,
      url: '/api/eisland/v1/health',
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.ended, true);
    assert.deepEqual(JSON.parse(health.body), {
      instanceId: 'route-instance',
      protocol: 'mineradio-bridge/v1',
      status: 'ready',
    });

    const stateResponse = await invokeFakeRequest(http.server.handler, {
      headers,
      url: '/api/eisland/v1/state',
    });
    assert.equal(stateResponse.statusCode, 200);
    assert.deepEqual(JSON.parse(stateResponse.body), state);

    const unknownRoute = await invokeFakeRequest(http.server.handler, {
      headers,
      url: '/api/eisland/v1/unknown',
    });
    assert.equal(unknownRoute.statusCode, 404);
    assert.deepEqual(JSON.parse(unknownRoute.body), { error: 'NOT_FOUND' });

    const wrongMethod = await invokeFakeRequest(http.server.handler, {
      headers,
      method: 'POST',
      url: '/api/eisland/v1/health',
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.deepEqual(JSON.parse(wrongMethod.body), { error: 'METHOD_NOT_ALLOWED' });
  } finally {
    await bridgeServer.close();
  }
});

test('validates_lyrics_and_command_bodies', async () => {
  const { createEislandBridgeServer } = loadBridgeServer();
  assert.equal(typeof createEislandBridgeServer, 'function');

  const commandCalls = [];
  const state = {
    lyrics: {
      lines: [{ startMs: 0, text: 'from-player-bridge' }],
      trackId: 'track-8',
    },
    lyricsRevision: 3,
    status: 'ready',
    track: { id: 'track-8' },
    trackRevision: 8,
  };
  const commandResult = {
    ok: true,
    outcome: 'executed',
    requestId: 'seek-okay',
    revision: 10,
  };
  const http = createFakeHttp();
  const bridgeServer = createEislandBridgeServer({
    bridge: {
      enqueueCommand: async (command) => {
        commandCalls.push(command);
        return commandResult;
      },
      getState: () => state,
    },
    http,
    instanceId: 'validation-instance',
    token: 'validation-token',
  });
  await bridgeServer.start();

  const headers = { authorization: 'Bearer validation-token' };
  async function postCommand(body) {
    return invokeFakeRequest(http.server.handler, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
      url: '/api/eisland/v1/command',
    });
  }

  try {
    const oldLyrics = await invokeFakeRequest(http.server.handler, {
      headers,
      url: '/api/eisland/v1/lyrics?trackRevision=7&lyricsRevision=3',
    });
    assert.equal(oldLyrics.statusCode, 409);
    assert.deepEqual(JSON.parse(oldLyrics.body), { error: 'LYRICS_VERSION_CONFLICT' });

    const currentLyrics = await invokeFakeRequest(http.server.handler, {
      headers,
      url: '/api/eisland/v1/lyrics?trackRevision=8&lyricsRevision=3',
    });
    assert.equal(currentLyrics.statusCode, 200);
    assert.deepEqual(JSON.parse(currentLyrics.body), {
      instanceId: 'validation-instance',
      lines: [{ startMs: 0, text: 'from-player-bridge' }],
      lyricsRevision: 3,
      status: 'ready',
      trackId: 'track-8',
      trackRevision: 8,
    });
    const oversized = await invokeFakeRequest(http.server.handler, {
      body: 'x'.repeat(16_385),
      headers,
      method: 'POST',
      url: '/api/eisland/v1/command',
    });
    assert.equal(oversized.statusCode, 413);
    assert.deepEqual(JSON.parse(oversized.body), { error: 'BODY_TOO_LARGE' });

    const nonStringRequestId = await postCommand({ requestId: 7, type: 'play' });
    assert.equal(nonStringRequestId.statusCode, 400);
    assert.deepEqual(JSON.parse(nonStringRequestId.body), { error: 'INVALID_COMMAND' });

    const tooLongRequestId = await postCommand({
      requestId: 'r'.repeat(129),
      type: 'play',
    });
    assert.equal(tooLongRequestId.statusCode, 400);
    assert.deepEqual(JSON.parse(tooLongRequestId.body), { error: 'INVALID_COMMAND' });

    const unknownField = await postCommand({
      extra: true,
      requestId: 'bad-extra',
      type: 'play',
    });
    assert.equal(unknownField.statusCode, 400);
    assert.deepEqual(JSON.parse(unknownField.body), { error: 'INVALID_COMMAND' });

    const invalidSeek = await postCommand({
      positionMs: -1,
      requestId: 'bad-seek',
      type: 'seek',
    });
    assert.equal(invalidSeek.statusCode, 400);
    assert.deepEqual(JSON.parse(invalidSeek.body), { error: 'INVALID_COMMAND' });

    const acceptedSeek = await postCommand({
      positionMs: 3_210,
      requestId: 'seek-okay',
      type: 'seek',
    });
    assert.equal(acceptedSeek.statusCode, 200);
    assert.deepEqual(JSON.parse(acceptedSeek.body), commandResult);
    assert.deepEqual(commandCalls, [{
      command: 'seek',
      payload: { positionMs: 3_210 },
      requestId: 'seek-okay',
    }]);
  } finally {
    await bridgeServer.close();
  }
});

test('returns_not_ready_without_renderer_and_closes_idempotently', async () => {
  const { createEislandBridgeServer } = loadBridgeServer();
  assert.equal(typeof createEislandBridgeServer, 'function');

  let commandCalls = 0;
  const bridgeServer = createEislandBridgeServer({
    bridge: {
      enqueueCommand: async () => {
        commandCalls += 1;
        return { ok: true, outcome: 'executed', requestId: 'not-ready-command' };
      },
      getState: () => ({ status: 'not-ready' }),
    },
    instanceId: 'not-ready-instance',
    token: 'not-ready-token',
  });
  const { port } = await bridgeServer.start();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const commandResponse = await fetch(`${baseUrl}/api/eisland/v1/command`, {
      body: JSON.stringify({ requestId: 'not-ready-command', type: 'play' }),
      headers: {
        authorization: 'Bearer not-ready-token',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    assert.equal(commandResponse.status, 200);
    assert.deepEqual(await commandResponse.json(), {
      error: 'NOT_READY',
      ok: false,
      outcome: 'rejected',
      requestId: 'not-ready-command',
    });
    assert.equal(commandCalls, 0);

    const firstClose = bridgeServer.close();
    const secondClose = bridgeServer.close();
    assert.strictEqual(firstClose, secondClose);
    await firstClose;
    await assert.rejects(
      () => fetch(`${baseUrl}/api/eisland/v1/health`),
      TypeError,
    );
  } finally {
    await bridgeServer.close();
  }
});
