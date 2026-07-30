'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createListenRoutes } = require('../server/routes/listen');
const {
  createListenReporter,
  createReportingBinding,
  normalizeListenEvent,
} = require('../server/platform/listen-reporter');
const { createListenJournal } = require('../server/platform/listen-journal');
const {
  createBaselineImplementationRegistry,
} = require('../server/platform/implementation-registry');
const {
  createFeatureFlags,
} = require('../server/platform/feature-flags');
const {
  createCapabilitySnapshot,
  providerCapability,
} = require('../server/platform/capabilities');
const {
  createListenSessionState,
  createListenTransport,
} = require('../public/listen-session-state');
const {
  isMethodAllowedForRoute,
  isStateChangingRoute,
} = require('../server/security');

function request(body, method) {
  const req = new EventEmitter();
  req.method = method || 'POST';
  req.headers = { 'content-type': 'application/json' };
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  return req;
}

function responseHarness() {
  let response = null;
  return {
    sendJSON(_res, body, status) {
      response = { body, status: status || 200 };
    },
    response: () => response,
  };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('server startup timeout');
}

test('listen report is POST-only and enters the state-changing origin boundary', () => {
  assert.equal(isStateChangingRoute('/api/listen/report'), true);
  assert.equal(isMethodAllowedForRoute('/api/listen/report', 'POST'), true);
  assert.equal(isMethodAllowedForRoute('/api/listen/report', 'GET'), false);
  assert.equal(isMethodAllowedForRoute('/api/listen/report', 'DELETE'), false);
});

test('route accepts bounded JSON and returns only public report status', async () => {
  const harness = responseHarness();
  const reporterCalls = [];
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report(body) {
        reporterCalls.push(body);
        return {
          accepted: true,
          localRecorded: true,
          completeness: 'complete',
          status: 'submitted',
          duplicate: false,
          reportedCapabilities: ['recentPlayReport', 'listenDurationReport'],
          accountScope: 'must-not-leak',
          event: { cookie: 'must-not-leak' },
        };
      },
    },
  });
  const body = JSON.stringify({ sessionId: 'session-1' });
  const handled = await routes.handleRoute(
    '/api/listen/report',
    request(body),
    {},
    new URL('http://localhost/api/listen/report'),
  );

  assert.equal(handled, true);
  assert.equal(reporterCalls.length, 1);
  assert.deepEqual(harness.response(), {
    status: 200,
    body: {
      accepted: true,
      localRecorded: true,
      completeness: 'complete',
      status: 'submitted',
      duplicate: false,
      reportedCapabilities: ['recentPlayReport', 'listenDurationReport'],
    },
  });
});

test('capability binding survives session transport route reporter and account switches', async t => {
  let now = 1_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-listen-e2e-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secret = Buffer.alloc(32, 0x6b);
  const bindingA = createReportingBinding(secret, 'netease', 'account-a');
  const registry = createBaselineImplementationRegistry();
  registry.register('netease', 'recentPlayReport');
  registry.register('netease', 'listenDurationReport');
  const capability = providerCapability(createCapabilitySnapshot({
    netease: {
      loggedIn: true,
      accountId: 'account-a',
      reportingBinding: bindingA,
    },
  }, {
    implementationRegistry: registry,
    featureFlags: createFeatureFlags({ listenReporting: true }),
  }), 'netease');
  assert.equal(capability.account.reportingBinding, bindingA);
  assert.equal(capability.availability.recentPlayReport, true);

  let currentAccount = 'account-a';
  const providerCalls = [];
  const journal = createListenJournal({
    filePath: path.join(directory, 'listen.json'),
    clock: () => now,
  });
  const reporter = createListenReporter({
    accountBindingSecret: secret,
    registry,
    journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: currentAccount,
      credentialSnapshot: { cookie: `cookie-${currentAccount}` },
    }),
    providerAdapters: {
      netease: async (_event, context) => {
        providerCalls.push(context.credentialSnapshot.cookie);
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());
  const responses = [];
  const routes = createListenRoutes({
    reporter,
    sendJSON(_res, body, status) {
      responses.push({ body, status: status || 200 });
    },
  });
  let offline = false;
  let routeCalls = 0;
  async function routeFetch(_url, options) {
    routeCalls += 1;
    if (offline) throw new Error('offline');
    await routes.handleRoute(
      '/api/listen/report',
      request(options.body),
      {},
      new URL('http://127.0.0.1/api/listen/report'),
    );
    const response = responses.shift();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async json() {
        return response.body;
      },
    };
  }
  function finalizedEvent(sessionId) {
    const session = createListenSessionState({
      clock: () => now,
      createId: () => sessionId,
    });
    session.startConfirmed({
      confirmed: true,
      transactionId: `tx-${sessionId}`,
      mediaTime: 0,
      durationMs: 90_000,
      reportingBinding: capability.account.reportingBinding,
      song: {
        id: '101',
        catalogProvider: 'netease',
        catalogSourceId: '101',
        playbackProvider: 'netease',
        playbackSourceId: '101',
        resolutionMode: 'direct',
      },
    });
    now += 45_000;
    session.tick({ mediaTime: 45, durationMs: 90_000 });
    return session.finalize({ reason: 'switch' });
  }

  const online = createListenTransport({
    fetch: routeFetch,
    autoRetry: false,
    clock: () => now,
  });
  assert.equal((await online.submit(finalizedEvent('binding-online-a'))).delivery, 'submitted');
  assert.deepEqual(providerCalls, ['cookie-account-a']);
  online.destroy();

  const deferredEvent = finalizedEvent('binding-offline-a');
  const deferred = createListenTransport({
    fetch: routeFetch,
    autoRetry: false,
    clock: () => now,
    baseRetryMs: 100,
  });
  offline = true;
  assert.equal(await deferred.submit(deferredEvent), false);
  currentAccount = 'account-b';
  offline = false;
  now += 1_000;
  const localOnly = await deferred.retry(deferredEvent.sessionId);
  assert.equal(localOnly.delivery, 'local-only');
  assert.deepEqual(providerCalls, ['cookie-account-a']);

  currentAccount = 'account-a';
  now += 2_000;
  await reporter.flushDue();
  assert.deepEqual(providerCalls, ['cookie-account-a', 'cookie-account-a']);

  const forged = await deferred.submit({
    ...finalizedEvent('binding-forged'),
    reportingBinding: `${'f'.repeat(32)}.${'e'.repeat(64)}`,
  });
  assert.equal(forged.delivery, 'terminal');
  assert.equal(forged.status, 'rejected');
  assert.equal(deferred.status('binding-forged').status, 'rejected');
  assert.equal(providerCalls.length, 2);
  assert.equal(routeCalls >= 3, true);
  deferred.destroy();
});

test('route rejects malformed and oversized request bodies without calling reporter', async () => {
  let calls = 0;
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    maxBodyBytes: 256,
    reporter: {
      async report() {
        calls += 1;
        return {};
      },
    },
  });

  await routes.handleRoute('/api/listen/report', request('{'), {}, new URL('http://localhost'));
  assert.equal(harness.response().status, 400);
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ value: 'x'.repeat(300) })),
    {},
    new URL('http://localhost'),
  );
  assert.equal(harness.response().status, 413);
  assert.equal(calls, 0);
});

test('route maps validation to 422 and provider retry remains accepted', async () => {
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report(body) {
        if (body.invalid) {
          throw Object.assign(new Error('SECRET_SENTINEL'), {
            code: 'LISTEN_EVENT_INVALID',
            status: 422,
          });
        }
        return {
          accepted: true,
          localRecorded: true,
          completeness: 'partial',
          status: 'pending',
          duplicate: false,
        };
      },
    },
  });
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ invalid: true })),
    {},
    new URL('http://localhost'),
  );
  assert.deepEqual(harness.response(), {
    status: 422,
    body: { accepted: false, error: 'LISTEN_EVENT_INVALID' },
  });

  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ sessionId: 'retry' })),
    {},
    new URL('http://localhost'),
  );
  assert.equal(harness.response().status, 202);
  assert.equal(harness.response().body.localRecorded, true);
});

test('route preserves uncertain as a public non-retry terminal status', async () => {
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report() {
        return {
          accepted: true,
          localRecorded: true,
          completeness: 'partial',
          status: 'uncertain',
          duplicate: false,
          claimToken: 'must-not-leak',
        };
      },
    },
  });
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ sessionId: 'uncertain-session' })),
    {},
  );
  assert.deepEqual(harness.response(), {
    status: 200,
    body: {
      accepted: true,
      localRecorded: true,
      completeness: 'partial',
      status: 'uncertain',
      duplicate: false,
      reportedCapabilities: [],
    },
  });
});

test('route exposes a retryable capacity rejection without claiming local persistence', async () => {
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report() {
        throw Object.assign(new Error('must not leak old pending'), {
          code: 'LISTEN_JOURNAL_CAPACITY',
          status: 503,
        });
      },
    },
  });
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ sessionId: 'capacity' })),
    {},
    new URL('http://localhost'),
  );
  assert.deepEqual(harness.response(), {
    status: 503,
    body: {
      accepted: false,
      localRecorded: false,
      retryable: true,
      error: 'LISTEN_JOURNAL_CAPACITY',
    },
  });
});

test('route exposes restart budget degradation as local partial and retryable', async () => {
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report() {
        throw Object.assign(new Error('must not expose journal bytes'), {
          code: 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
          status: 503,
        });
      },
    },
  });
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ sessionId: 'degraded' })),
    {},
    new URL('http://localhost'),
  );
  assert.deepEqual(harness.response(), {
    status: 503,
    body: {
      accepted: false,
      localRecorded: true,
      completeness: 'partial',
      status: 'pending',
      retryable: true,
      error: 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
    },
  });
});

test('route maps a session payload conflict to a safe 409 response', async () => {
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report() {
        throw Object.assign(new Error('different payload SECRET_SENTINEL'), {
          code: 'LISTEN_SESSION_CONFLICT',
          status: 409,
        });
      },
    },
  });
  await routes.handleRoute(
    '/api/listen/report',
    request(JSON.stringify({ sessionId: 'conflict' })),
    {},
    new URL('http://localhost'),
  );
  assert.deepEqual(harness.response(), {
    status: 409,
    body: {
      accepted: false,
      error: 'LISTEN_SESSION_CONFLICT',
    },
  });
  assert.doesNotMatch(JSON.stringify(harness.response()), /SECRET_SENTINEL/);
});

test('route rejects oversized, unknown, secret, and wrong-type event fields before persistence', async () => {
  const sentinel = 'SECRET_SENTINEL_ROUTE';
  let accepted = 0;
  const harness = responseHarness();
  const routes = createListenRoutes({
    sendJSON: harness.sendJSON,
    reporter: {
      async report(body) {
        normalizeListenEvent(body);
        accepted += 1;
        return {
          accepted: true,
          localRecorded: true,
          completeness: 'unsupported',
          status: 'unsupported',
          duplicate: false,
          reportedCapabilities: [],
        };
      },
    },
  });
  const valid = {
    sessionId: 'strict-route',
    confirmedPlayback: true,
    catalogProvider: 'local',
    playbackProvider: 'local',
    resolutionMode: 'local',
    completeness: 'partial',
    sourceIds: { local: 'local-1' },
    catalogSourceId: 'local-1',
    playbackSourceId: 'local-1',
    listenMs: 1_000,
    durationMs: 1_000,
    completion: { completed: true, ratio: 1 },
    playedAt: 1_000,
    context: { type: 'local' },
  };
  const invalid = [
    { ...valid, token: sentinel },
    { ...valid, unknown: true },
    { ...valid, sourceIds: [] },
    { ...valid, context: { playlistId: 'x'.repeat(129) } },
    { ...valid, context: { playlistId: 42 } },
  ];
  for (const candidate of invalid) {
    await routes.handleRoute(
      '/api/listen/report',
      request(JSON.stringify(candidate)),
      {},
      new URL('http://localhost'),
    );
    assert.equal(harness.response().status, 422);
    assert.doesNotMatch(JSON.stringify(harness.response()), new RegExp(sentinel));
  }
  assert.equal(accepted, 0);
});

test('server registers one shared registry and a restartable reporting runtime before provider routes', () => {
  const repoRoot = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.match(server, /const implementationRegistry = createBaselineImplementationRegistry\(\)/);
  assert.match(server, /implementationRegistry\.register\('netease', 'recentPlayReport'\)/);
  assert.match(server, /implementationRegistry\.register\('netease', 'listenDurationReport'\)/);
  assert.match(server, /listenReporting: true/);
  assert.match(server, /function createListenReportingRuntime\(\)/);
  assert.match(server, /let listenReporter = null/);
  assert.match(server, /if \(!listenReporter\) listenReporter = createListenReportingRuntime\(\)/);
  assert.match(server, /server\.on\('listening', \(\) => \{\s*ensureListenReporter\(\)/);
  assert.match(server, /listenReporter = null;\s*\}\);/);
  assert.match(server, /const listenRoutes = createListenRoutes\(/);
  assert.match(server, /listenRoutes\.handleRoute\(pn, req, res, url\)/);
  assert.match(server, /scrobble/);
  assert.match(server, /createReportingAccountResolver/);
  assert.match(server, /loadOrCreateReportingBindingSecret/);
  assert.match(server, /accountBindingSecret: listenBindingSecret/);
  assert.match(server, /netease\.reportingBinding = reporting\.reportingBinding/);
  assert.doesNotMatch(server, /credentialGeneration = reporting\.credentialGeneration/);
  assert.match(html, /<script src="listen-session-state\.js"><\/script>/);
  assert.match(pkg.scripts.check, /server\/platform\/listen-journal\.js/);
  assert.match(pkg.scripts.check, /server\/platform\/listen-reporter\.js/);
  assert.match(pkg.scripts.check, /server\/routes\/listen\.js/);
  assert.match(pkg.scripts.check, /public\/listen-session-state\.js/);
});

test('real loopback server enforces origin and records local playback without network', async t => {
  const port = await availablePort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-listen-server-'));
  const journalFile = path.join(directory, 'listen.json');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      MINERADIO_LISTEN_SYNC_FILE: journalFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  t.after(() => {
    if (child.exitCode === null) child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/`, child);

  const method = await fetch(`${base}/api/listen/report`);
  assert.equal(method.status, 405);
  const origin = await fetch(`${base}/api/listen/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
    },
    body: '{}',
  });
  assert.equal(origin.status, 403);

  const validEvent = {
    sessionId: 'local-smoke-session',
    confirmedPlayback: true,
    catalogProvider: 'local',
    playbackProvider: 'local',
    resolutionMode: 'local',
    completeness: 'partial',
    sourceIds: { local: 'safe-local-id' },
    catalogSourceId: 'safe-local-id',
    playbackSourceId: 'safe-local-id',
    listenMs: 1_000,
    durationMs: 1_000,
    completion: { completed: true, ratio: 1 },
    playedAt: Date.now(),
    context: { type: 'local' },
  };
  for (const invalid of [
    { ...validEvent, sessionId: 'bad-listen-ms', listenMs: '1000' },
    { ...validEvent, sessionId: 'bad-duration-ms', durationMs: true },
    { ...validEvent, sessionId: 'bad-played-at', playedAt: '1000' },
  ]) {
    const rejected = await fetch(`${base}/api/listen/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    });
    assert.equal(rejected.status, 422);
    assert.deepEqual(await rejected.json(), {
      accepted: false,
      error: 'LISTEN_NUMERIC_FIELD_INVALID',
    });
  }
  assert.equal(fs.existsSync(journalFile), false);

  const response = await fetch(`${base}/api/listen/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validEvent),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    accepted: true,
    localRecorded: true,
    completeness: 'unsupported',
    status: 'unsupported',
    duplicate: false,
    reportedCapabilities: [],
  });
  assert.equal(JSON.parse(fs.readFileSync(journalFile, 'utf8')).version, 6);
  assert.doesNotMatch(output.join(''), /safe-local-id/);
});

test('real server stays alive and retryable when a valid main exceeds restart count capacity', async t => {
  const port = await availablePort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-listen-degraded-'));
  const journalFile = path.join(directory, 'listen.json');
  const entries = {};
  for (let index = 0; index < 513; index += 1) {
    const sessionId = `degraded-${index}`;
    const key = `local:anonymous:${sessionId}`;
    entries[key] = {
      key,
      provider: 'local',
      accountScope: 'anonymous',
      sessionId,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastErrorCode: '',
      createdAt: index + 1,
      updatedAt: index + 1,
      event: {
        sessionId,
        catalogProvider: 'local',
        playbackProvider: 'local',
        resolutionMode: 'local',
        completeness: 'partial',
        sourceIds: { local: `local-${index}` },
        catalogSourceId: `local-${index}`,
        playbackSourceId: `local-${index}`,
        listenMs: 1_000,
        durationMs: 1_000,
        completion: { completed: true, ratio: 1 },
        playedAt: index + 1,
        context: null,
      },
    };
  }
  fs.writeFileSync(journalFile, JSON.stringify({ version: 2, entries }));
  const originalHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(journalFile))
    .digest('hex');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      MINERADIO_LISTEN_SYNC_FILE: journalFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(String(chunk)));
  child.stderr.on('data', chunk => output.push(String(chunk)));
  t.after(() => {
    if (child.exitCode === null) child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/`, child);

  const response = await fetch(`${base}/api/listen/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'degraded-new',
      confirmedPlayback: true,
      catalogProvider: 'local',
      playbackProvider: 'local',
      resolutionMode: 'local',
      completeness: 'partial',
      sourceIds: { local: 'new-local-id' },
      catalogSourceId: 'new-local-id',
      playbackSourceId: 'new-local-id',
      listenMs: 1_000,
      durationMs: 1_000,
      completion: { completed: true, ratio: 1 },
      playedAt: Date.now(),
      context: null,
    }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    accepted: false,
    error: 'LISTEN_JOURNAL_CAPACITY_EXCEEDED',
    localRecorded: true,
    completeness: 'partial',
    status: 'pending',
    retryable: true,
  });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(child.exitCode, null);
  assert.equal(
    crypto.createHash('sha256').update(fs.readFileSync(journalFile)).digest('hex'),
    originalHash,
  );
  assert.doesNotMatch(output.join(''), /new-local-id|degraded-\d+/);
});

test('real server recreates its reporting runtime after close and relisten', async t => {
  const port = await availablePort();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-listen-relisten-'));
  const journalFile = path.join(directory, 'listen.json');
  const source = `
    const server = require('./server');
    const event = sessionId => ({
      sessionId,
      confirmedPlayback: true,
      catalogProvider: 'local',
      playbackProvider: 'local',
      resolutionMode: 'local',
      completeness: 'partial',
      sourceIds: { local: 'local-' + sessionId },
      catalogSourceId: 'local-' + sessionId,
      playbackSourceId: 'local-' + sessionId,
      listenMs: 1000,
      durationMs: 1000,
      completion: { completed: true, ratio: 1 },
      playedAt: Date.now(),
      context: { type: 'local' },
    });
    const waitListening = () => server.listening
      ? Promise.resolve()
      : new Promise(resolve => server.once('listening', resolve));
    const close = () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    const listen = () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const post = async sessionId => {
      const port = server.address().port;
      const response = await fetch('http://127.0.0.1:' + port + '/api/listen/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event(sessionId)),
      });
      return { status: response.status, body: await response.json() };
    };
    (async () => {
      await waitListening();
      const first = await post('first-listen');
      await close();
      await listen();
      const second = await post('second-listen');
      process.stdout.write('\\nRELISTEN_RESULT:' + JSON.stringify({ first, second }) + '\\n');
      await close();
    })().catch(error => {
      process.stderr.write(String(error && error.stack || error));
      process.exitCode = 1;
    });
  `;
  const child = spawn(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      MINERADIO_LISTEN_SYNC_FILE: journalFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  t.after(() => {
    if (child.exitCode === null) child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('relisten child timeout'));
    }, 20_000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr);
  const match = stdout.match(/RELISTEN_RESULT:(\{.*\})/);
  assert.ok(match, stdout);
  const result = JSON.parse(match[1]);
  assert.equal(result.first.status, 200);
  assert.equal(result.second.status, 200);
  assert.equal(result.second.body.accepted, true);
  assert.equal(result.second.body.localRecorded, true);
});
