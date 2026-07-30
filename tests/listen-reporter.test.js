'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createListenJournal } = require('../server/platform/listen-journal');
const {
  createReportingBinding,
  createListenReporter: createListenReporterBase,
  createNeteaseScrobbleAdapter,
  createReportingAccountResolver,
  loadOrCreateReportingBindingSecret,
  normalizeListenEvent,
} = require('../server/platform/listen-reporter');
const {
  createBaselineImplementationRegistry,
} = require('../server/platform/implementation-registry');

const ACCOUNT_BINDING_SECRET = Buffer.alloc(32, 0x5a);

function createListenReporter(options) {
  return createListenReporterBase({
    accountBindingSecret: ACCOUNT_BINDING_SECRET,
    ...options,
  });
}

function runNode(source, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('child process timeout'));
    }, options.timeoutMs || 5_000);
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function event(overrides) {
  return {
    sessionId: 'session-1',
    confirmedPlayback: true,
    catalogProvider: 'netease',
    playbackProvider: 'netease',
    resolutionMode: 'direct',
    completeness: 'partial',
    sourceIds: { netease: '101' },
    catalogSourceId: '101',
    playbackSourceId: '101',
    listenMs: 45_000,
    durationMs: 100_000,
    completion: { completed: false, ratio: 0.45 },
    playedAt: 1_000,
    context: { type: 'playlist', playlistId: 'list-1' },
    reportingBinding: reportingBinding('netease', 'account-a'),
    ...overrides,
  };
}

function reportingBinding(provider, accountId, secret) {
  return createReportingBinding(
    secret || ACCOUNT_BINDING_SECRET,
    provider,
    accountId,
  );
}

function reportingGeneration(credential) {
  return crypto
    .createHash('sha256')
    .update(
      Object.keys(credential).sort().map(key => (
        `${key}:${String(credential[key])}`
      )).join('\u0000'),
      'utf8',
    )
    .digest('hex');
}

function harness(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-reporter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = createListenJournal({
    filePath: path.join(directory, 'listen.json'),
    clock: options && options.clock,
  });
  const registry = createBaselineImplementationRegistry();
  const calls = [];
  const reporter = createListenReporter({
    accountBindingSecret: ACCOUNT_BINDING_SECRET,
    registry,
    journal,
    clock: options && options.clock,
    autoRetry: false,
    accountResolver: async provider => ({
      provider,
      loggedIn: !options || options.loggedIn !== false,
      accountId: options && options.accountId || 'account-a',
      reportingBinding: reportingBinding(
        provider,
        options && options.accountId || 'account-a',
      ),
      credentialSnapshot: { cookie: 'SECRET_SENTINEL_HARNESS' },
    }),
    providerAdapters: {
      netease: async payload => {
        calls.push(payload);
        if (options && options.failure) throw options.failure;
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());
  return { calls, journal, registry, reporter };
}

test('Netease adapter validates and sends only playback id, sourceid, and time', async () => {
  const calls = [];
  const adapter = createNeteaseScrobbleAdapter({
    scrobble: async options => {
      calls.push(options);
      return { body: { code: 200 } };
    },
    clock: () => 9_999,
  });
  const result = await adapter(event({
    catalogProvider: 'kugou',
    catalogSourceId: 'kg-123',
    playbackProvider: 'netease',
    playbackSourceId: '202',
    sourceIds: { kugou: 'kg-123', netease: '202' },
    resolutionMode: 'matched-provider',
    listenMs: 45_999,
    context: { type: 'playlist', playlistId: '303' },
  }), {
    credentialSnapshot: { cookie: 'MUSIC_U=SECRET_SENTINEL' },
  });

  assert.deepEqual(result, { body: { code: 200 } });
  assert.deepEqual(calls, [{
    id: '202',
    sourceid: '303',
    time: 45,
    cookie: 'MUSIC_U=SECRET_SENTINEL',
    timestamp: 9_999,
  }]);

  for (const invalid of [
    event({ playbackSourceId: 'qq-mid' }),
    event({ listenMs: 0 }),
  ]) {
    await assert.rejects(() => adapter(invalid), /NETEASE_SCROBBLE_INPUT_INVALID/);
  }
  assert.equal(calls.length, 1);
});

test('reporting account binding is opaque and cannot be predicted from credential material', async () => {
  const credential = {
    cookie: 'MUSIC_U=PREDICTABLE_CREDENTIAL_SENTINEL',
    accountId: 'account-a',
  };
  const first = createReportingAccountResolver({
    accountBindingSecret: Buffer.alloc(32, 0x11),
    getCredential: async () => credential,
    getLiveAccount: async () => ({ loggedIn: true, accountId: 'account-a' }),
  });
  const second = createReportingAccountResolver({
    accountBindingSecret: Buffer.alloc(32, 0x22),
    getCredential: async () => credential,
    getLiveAccount: async () => ({ loggedIn: true, accountId: 'account-a' }),
  });

  const [left, right] = await Promise.all([first('netease'), second('netease')]);
  const predictable = reportingGeneration(credential);
  assert.match(left.reportingBinding, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
  assert.notEqual(left.reportingBinding, right.reportingBinding);
  assert.equal(left.reportingBinding.includes(predictable), false);
  assert.equal(JSON.stringify(left).includes('PREDICTABLE_CREDENTIAL_SENTINEL'), false);
  assert.equal(Object.hasOwn(left, 'credentialGeneration'), false);
});

test('binding secret atomically repairs a corrupt canonical and restores old pending work', async t => {
  let now = 1_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-secret-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretFile = path.join(directory, 'listen.binding-secret');
  const foreignTemp = `${secretFile}.tmp-foreign-owner`;
  fs.writeFileSync(secretFile, 'bad!');
  fs.writeFileSync(foreignTemp, 'foreign-temp-must-remain');

  const firstSecret = loadOrCreateReportingBindingSecret(secretFile);
  assert.equal(firstSecret.length, 32);
  assert.match(fs.readFileSync(secretFile, 'utf8'), /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(foreignTemp, 'utf8'), 'foreign-temp-must-remain');
  assert.equal(
    fs.readdirSync(directory).some(name => name.includes('.tmp-v1-')),
    false,
  );
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(secretFile).mode & 0o777, 0o600);
  }

  const registry = createBaselineImplementationRegistry();
  const journalFile = path.join(directory, 'listen.json');
  const journal = createListenJournal({ filePath: journalFile, clock: () => now });
  const binding = createReportingBinding(firstSecret, 'netease', 'account-a');
  const firstReporter = createListenReporterBase({
    accountBindingSecret: firstSecret,
    registry,
    journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async () => {
        throw Object.assign(new Error('offline'), {
          code: 'ETIMEDOUT',
          retrySafe: true,
        });
      },
    },
  });
  const pending = await firstReporter.report(event({
    sessionId: 'binding-secret-restart',
    reportingBinding: binding,
  }));
  assert.equal(pending.status, 'pending');
  firstReporter.destroy();

  const secondSecret = loadOrCreateReportingBindingSecret(secretFile);
  assert.deepEqual(secondSecret, firstSecret);
  assert.equal(
    createReportingBinding(secondSecret, 'netease', 'account-a'),
    binding,
  );
  let providerCalls = 0;
  now = 2_000;
  const restarted = createListenReporterBase({
    accountBindingSecret: secondSecret,
    registry,
    journal: createListenJournal({ filePath: journalFile, clock: () => now }),
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async () => {
        providerCalls += 1;
        return { code: 200 };
      },
    },
  });
  t.after(() => restarted.destroy());
  await restarted.flushDue();
  assert.equal(providerCalls, 1);
});

test('binding secret initialization is cross-process consistent and rejects symlinks', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-race-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretFile = path.join(directory, 'listen.binding-secret');
  fs.writeFileSync(secretFile, 'bad!');
  const modulePath = path.join(
    __dirname,
    '..',
    'server',
    'platform',
    'listen-reporter.js',
  );
  const source = `
    const { loadOrCreateReportingBindingSecret } = require(${JSON.stringify(modulePath)});
    const secret = loadOrCreateReportingBindingSecret(process.env.SECRET_FILE);
    process.stdout.write(secret.toString('hex'));
  `;
  const children = await Promise.all(Array.from({ length: 4 }, () => (
    runNode(source, {
      env: { SECRET_FILE: secretFile },
      timeoutMs: 10_000,
    })
  )));
  children.forEach(child => {
    assert.equal(child.code, 0, child.stderr);
    assert.match(child.stdout, /^[a-f0-9]{64}$/);
  });
  assert.equal(new Set(children.map(child => child.stdout)).size, 1);
  assert.equal(fs.readFileSync(secretFile, 'utf8'), children[0].stdout);

  const symlinkFile = path.join(directory, 'unsafe.binding-secret');
  const symlinkTarget = path.join(directory, 'target.secret');
  fs.writeFileSync(symlinkTarget, 'f'.repeat(64));
  let junctionFallback = false;
  try {
    fs.symlinkSync(symlinkTarget, symlinkFile, 'file');
  } catch (error) {
    if (error && ['EPERM', 'EACCES'].includes(error.code)) {
      fs.rmSync(symlinkTarget);
      fs.mkdirSync(symlinkTarget);
      fs.writeFileSync(path.join(symlinkTarget, 'sentinel'), 'unchanged');
      fs.symlinkSync(symlinkTarget, symlinkFile, 'junction');
      junctionFallback = true;
    } else {
      throw error;
    }
  }
  assert.throws(
    () => loadOrCreateReportingBindingSecret(symlinkFile),
    error => error && error.code === 'LISTEN_BINDING_SECRET_UNSAFE',
  );
  if (junctionFallback) {
    assert.equal(
      fs.readFileSync(path.join(symlinkTarget, 'sentinel'), 'utf8'),
      'unchanged',
    );
  } else {
    assert.equal(fs.readFileSync(symlinkTarget, 'utf8'), 'f'.repeat(64));
  }
});

test('binding secret rejects linked ancestors before writing outside the requested tree', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-ancestor-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-external-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const linkedParent = path.join(directory, 'linked-parent');
  fs.symlinkSync(
    external,
    linkedParent,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const secretFile = path.join(linkedParent, 'nested', 'listen.binding-secret');

  assert.throws(
    () => loadOrCreateReportingBindingSecret(secretFile),
    error => (
      error
      && error.code === 'LISTEN_BINDING_SECRET_UNSAFE'
      && error.message === 'LISTEN_BINDING_SECRET_UNSAFE'
    ),
  );
  assert.equal(fs.existsSync(path.join(external, 'nested')), false);

  const ordinaryFile = path.join(directory, 'ordinary', 'nested', 'listen.binding-secret');
  const secret = loadOrCreateReportingBindingSecret(ordinaryFile);
  assert.equal(secret.length, 32);
  assert.equal(fs.readFileSync(ordinaryFile, 'utf8'), secret.toString('hex'));
});

test('binding secret publishes one verified crash temp instead of changing the binding', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-crash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretFile = path.join(directory, 'listen.binding-secret');
  const crashTemp = `${secretFile}.tmp-v1-999-dead-owner`;
  const expected = Buffer.alloc(32, 0x6b);
  fs.writeFileSync(secretFile, 'bad!');
  fs.writeFileSync(crashTemp, expected.toString('hex'), { mode: 0o600 });

  const recovered = loadOrCreateReportingBindingSecret(secretFile);
  assert.deepEqual(recovered, expected);
  assert.equal(fs.readFileSync(secretFile, 'utf8'), expected.toString('hex'));
  assert.equal(fs.existsSync(crashTemp), false);
  assert.deepEqual(loadOrCreateReportingBindingSecret(secretFile), expected);
});

test('binding secret reclaims a dead owner quickly but never steals a live lock', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const deadFile = path.join(directory, 'dead.binding-secret');
  const deadLock = `${deadFile}.lock`;
  fs.mkdirSync(deadLock);
  fs.writeFileSync(path.join(deadLock, 'owner.json'), JSON.stringify({
    version: 1,
    pid: 2_147_483_647,
    nonce: 'dead-owner-nonce',
    createdAt: Date.now(),
  }));
  const startedAt = Date.now();
  const recovered = loadOrCreateReportingBindingSecret(deadFile, {
    staleLockMs: 200,
    lockTimeoutMs: 500,
  });
  assert.equal(recovered.length, 32);
  assert.ok(Date.now() - startedAt < 1_000);

  const liveFile = path.join(directory, 'live.binding-secret');
  const liveLock = `${liveFile}.lock`;
  fs.mkdirSync(liveLock);
  const liveOwner = {
    version: 1,
    pid: process.pid,
    nonce: 'live-owner-nonce',
    createdAt: Date.now(),
  };
  fs.writeFileSync(path.join(liveLock, 'owner.json'), JSON.stringify(liveOwner));
  const liveStartedAt = Date.now();
  assert.throws(
    () => loadOrCreateReportingBindingSecret(liveFile, {
      staleLockMs: 200,
      lockTimeoutMs: 50,
    }),
    error => (
      error
      && error.code === 'LISTEN_BINDING_SECRET_LOCK_FAILED'
      && error.message === 'LISTEN_BINDING_SECRET_LOCK_FAILED'
    ),
  );
  assert.ok(Date.now() - liveStartedAt >= 200);
  assert.ok(Date.now() - liveStartedAt < 1_000);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(liveLock, 'owner.json'), 'utf8')),
    liveOwner,
  );
});

test('binding secret removes only its own partially published lock after native failure', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-partial-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretFile = path.join(directory, 'listen.binding-secret');
  const failingFs = {
    ...fs,
    fsyncSync() {
      const error = new Error('SECRET_SENTINEL_PARTIAL_LOCK');
      error.code = 'EIO';
      throw error;
    },
  };
  assert.throws(
    () => loadOrCreateReportingBindingSecret(secretFile, {
      fs: failingFs,
      staleLockMs: 20,
      lockTimeoutMs: 50,
    }),
    error => (
      error
      && /^LISTEN_BINDING_SECRET_[A-Z_]+$/.test(error.code || '')
      && error.message === error.code
      && !error.message.includes('SECRET_SENTINEL')
    ),
  );
  assert.equal(fs.existsSync(`${secretFile}.lock`), false);
  const recovered = loadOrCreateReportingBindingSecret(secretFile, {
    staleLockMs: 20,
    lockTimeoutMs: 50,
  });
  assert.equal(recovered.length, 32);
});

test('binding secret keeps ancestor descriptor guards open through publication', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-guards-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const nested = path.join(directory, 'nested');
  fs.mkdirSync(nested);
  const secretFile = path.join(nested, 'listen.binding-secret');
  const directoryDescriptors = new Set();
  const guardedFs = {
    ...fs,
    openSync(target, flags, mode) {
      const descriptor = fs.openSync(target, flags, mode);
      try {
        if (fs.fstatSync(descriptor).isDirectory()) {
          directoryDescriptors.add(descriptor);
        }
      } catch (_) {}
      return descriptor;
    },
    closeSync(descriptor) {
      directoryDescriptors.delete(descriptor);
      return fs.closeSync(descriptor);
    },
    renameSync(source, target) {
      if (
        path.basename(target) === 'listen.binding-secret'
        && directoryDescriptors.size === 0
      ) {
        const error = new Error('PARENT_GUARD_MISSING SECRET_SENTINEL');
        error.code = 'EACCES';
        throw error;
      }
      return fs.renameSync(source, target);
    },
  };

  const secret = loadOrCreateReportingBindingSecret(secretFile, {
    fs: guardedFs,
  });
  assert.equal(secret.length, 32);
  assert.equal(directoryDescriptors.size, 0);
});

test('binding secret sanitizes parent path and native filesystem failures', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-binding-errors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const parentFile = path.join(directory, 'not-a-directory');
  fs.writeFileSync(parentFile, 'SECRET_SENTINEL_PARENT');
  const unsafePath = path.join(parentFile, 'PRIVATE_USER_PATH', 'listen.binding-secret');

  assert.throws(
    () => loadOrCreateReportingBindingSecret(unsafePath),
    error => (
      error
      && /^LISTEN_BINDING_SECRET_[A-Z_]+$/.test(error.code || '')
      && error.message === error.code
      && !error.message.includes(directory)
      && !error.message.includes('PRIVATE_USER_PATH')
      && !error.message.includes('SECRET_SENTINEL')
    ),
  );

  for (const method of ['mkdirSync', 'lstatSync', 'realpathSync', 'openSync', 'renameSync', 'fsyncSync']) {
    const attemptDirectory = path.join(directory, method);
    fs.mkdirSync(attemptDirectory);
    const target = path.join(attemptDirectory, 'listen.binding-secret');
    if (method === 'renameSync') fs.writeFileSync(target, 'bad!');
    const failingFs = {
      ...fs,
      [method](...args) {
        const error = new Error(
          `EACCES ${directory} PRIVATE_USER_PATH SECRET_SENTINEL ${String(args[0])}`,
        );
        error.code = 'EACCES';
        throw error;
      },
    };
    assert.throws(
      () => loadOrCreateReportingBindingSecret(target, {
        fs: failingFs,
        staleLockMs: 20,
        lockTimeoutMs: 50,
      }),
      error => (
        error
        && /^LISTEN_BINDING_SECRET_[A-Z_]+$/.test(error.code || '')
        && error.message === error.code
        && !error.message.includes(directory)
        && !error.message.includes('PRIVATE_USER_PATH')
        && !error.message.includes('SECRET_SENTINEL')
      ),
      method,
    );
  }
});

test('reports only to the real playback provider and preserves catalog identity', async t => {
  const { calls, reporter } = harness(t);
  const result = await reporter.report(event({
    catalogProvider: 'kugou',
    catalogSourceId: 'kg-hash',
    playbackProvider: 'netease',
    playbackSourceId: '202',
    sourceIds: { kugou: 'kg-hash', netease: '202' },
    resolutionMode: 'matched-provider',
  }));

  assert.equal(result.accepted, true);
  assert.equal(result.localRecorded, true);
  assert.equal(result.completeness, 'complete');
  assert.deepEqual(result.reportedCapabilities, [
    'recentPlayReport',
    'listenDurationReport',
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].playbackProvider, 'netease');
  assert.equal(calls[0].playbackSourceId, '202');
  assert.equal(calls[0].catalogProvider, 'kugou');
});

test('rejects search-only, unconfirmed, ineffective, and wrong-provider identities', async t => {
  const { journal, reporter } = harness(t);
  for (const candidate of [
    event({ completeness: undefined }),
    event({ completeness: 'complete-ish' }),
    event({ confirmedPlayback: false }),
    event({ playbackProvider: 'kugou', playbackSourceId: 'kg', sourceIds: { kugou: 'kg' } }),
    event({ listenMs: 1_000, completion: { completed: false, ratio: 0.01 } }),
    event({
      catalogProvider: 'kugou',
      catalogSourceId: '123',
      playbackProvider: 'netease',
      playbackSourceId: '123',
      sourceIds: { kugou: '123' },
      resolutionMode: 'matched-provider',
    }),
  ]) {
    await assert.rejects(
      () => reporter.report(candidate),
      error => error && (error.status === 400 || error.status === 422),
    );
  }
  assert.deepEqual((await journal.snapshot()).entries, {});
});

test('records local and QQ playback as unsupported without remote writes', async t => {
  const { calls, reporter } = harness(t);
  const qq = await reporter.report(event({
    playbackProvider: 'qq',
    catalogProvider: 'qq',
    playbackSourceId: 'qq-mid',
    catalogSourceId: 'qq-mid',
    sourceIds: { qq: 'qq-mid' },
  }));
  const local = await reporter.report(event({
    sessionId: 'session-local',
    playbackProvider: 'local',
    catalogProvider: 'local',
    playbackSourceId: 'local-safe-id',
    catalogSourceId: 'local-safe-id',
    sourceIds: { local: 'local-safe-id' },
    resolutionMode: 'local',
  }));

  assert.equal(qq.completeness, 'unsupported');
  assert.equal(local.completeness, 'unsupported');
  assert.equal(calls.length, 0);
});

test('preserves only a private stable local media id in the journal', async t => {
  const { calls, journal, reporter } = harness(t);
  const localId = `local-v2-${'a'.repeat(64)}`;
  const result = await reporter.report(event({
    sessionId: 'stable-local-journal',
    catalogProvider: 'local',
    playbackProvider: 'local',
    resolutionMode: 'local',
    sourceIds: { local: localId },
    catalogSourceId: localId,
    playbackSourceId: localId,
  }));

  assert.equal(result.status, 'unsupported');
  const saved = Object.values((await journal.snapshot()).entries)[0];
  assert.equal(saved.event.catalogSourceId, localId);
  assert.equal(saved.event.playbackSourceId, localId);
  assert.deepEqual(saved.event.sourceIds, { local: localId });
  assert.doesNotMatch(JSON.stringify(saved), /[\\/]|\.flac|Private Folder/);
  assert.equal(calls.length, 0);
});

test('logged-out and failed Netease reports stay pending while success completes', async t => {
  const loggedOut = harness(t, { loggedIn: false });
  const pending = await loggedOut.reporter.report(event());
  assert.equal(pending.accepted, true);
  assert.equal(pending.localRecorded, true);
  assert.equal(pending.completeness, 'partial');
  assert.equal(pending.status, 'pending');
  assert.equal(loggedOut.calls.length, 0);

  const failed = harness(t, {
    failure: Object.assign(new Error('SECRET_SENTINEL provider text'), {
      code: 'ECONNRESET',
      retrySafe: true,
    }),
  });
  const retry = await failed.reporter.report(event({ sessionId: 'session-failed' }));
  assert.equal(retry.completeness, 'partial');
  assert.equal(retry.status, 'pending');
  assert.equal(failed.calls.length, 1);

  const success = harness(t);
  const complete = await success.reporter.report(event({ sessionId: 'session-success' }));
  assert.equal(complete.completeness, 'complete');
  assert.equal(complete.status, 'submitted');
  assert.equal(success.calls.length, 1);
});

test('logged-in credentials without a stable account id remain pending', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-reporter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = createListenJournal({ filePath: path.join(directory, 'listen.json') });
  const registry = createBaselineImplementationRegistry();
  let calls = 0;
  const reporter = createListenReporter({
    registry,
    journal,
    autoRetry: false,
    accountResolver: async () => ({ loggedIn: true, accountId: '' }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());

  const result = await reporter.report(event({ sessionId: 'missing-account-id' }));
  assert.equal(result.status, 'pending');
  assert.equal(result.completeness, 'partial');
  assert.equal(calls, 0);
});

test('deduplicates repeated and concurrent session reports and separates account scopes', async t => {
  let accountId = 'account-a';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-reporter-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = createListenJournal({ filePath: path.join(directory, 'listen.json') });
  const registry = createBaselineImplementationRegistry();
  let calls = 0;
  const reporter = createListenReporter({
    registry,
    journal,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId,
      credentialSnapshot: { cookie: `cookie-${accountId}` },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        await new Promise(resolve => setTimeout(resolve, 5));
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());

  const [first, second] = await Promise.all([
    reporter.report(event()),
    reporter.report(event()),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.status, 'submitted');
  assert.equal(second.status, 'submitted');
  assert.equal((await reporter.report(event())).duplicate, true);
  assert.equal(calls, 1);

  accountId = 'account-b';
  await reporter.report(event({
    reportingBinding: reportingBinding('netease', 'account-b'),
  }));
  assert.equal(calls, 2);
  assert.equal(Object.keys((await journal.snapshot()).entries).length, 2);
});

test('two reporters sharing a real journal claim one provider call for the same session', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-provider-claim-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  let releaseProvider;
  let startedProvider;
  const started = new Promise(resolve => { startedProvider = resolve; });
  const blocked = new Promise(resolve => { releaseProvider = resolve; });
  let calls = 0;
  const options = {
    registry: createBaselineImplementationRegistry(),
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'SECRET_SENTINEL_ACCOUNT_A' },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        startedProvider();
        return blocked;
      },
    },
  };
  const first = createListenReporter({
    ...options,
    journal: createListenJournal({ filePath }),
  });
  const second = createListenReporter({
    ...options,
    journal: createListenJournal({ filePath }),
  });
  t.after(() => {
    first.destroy();
    second.destroy();
  });

  const firstReport = first.report(event({ sessionId: 'cross-reporter-claim' }));
  const secondReport = second.report(event({ sessionId: 'cross-reporter-claim' }));
  await started;
  await new Promise(resolve => setTimeout(resolve, 20));
  let claimAssertion = null;
  try {
    assert.equal(calls, 1);
  } catch (error) {
    claimAssertion = error;
  } finally {
    releaseProvider({ code: 200 });
  }
  const settled = await Promise.allSettled([firstReport, secondReport]);
  if (claimAssertion) throw claimAssertion;
  const results = settled.map(result => result.value);
  assert.equal(results.filter(result => result.status === 'submitted').length, 1);
  assert.equal(results.every(result => result.accepted), true);
});

test('two reporters that both observe an empty key reject different payloads atomically', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-provider-conflict-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  const baseJournals = [
    createListenJournal({ filePath }),
    createListenJournal({ filePath }),
  ];
  let emptyReads = 0;
  let releaseReads;
  const bothRead = new Promise(resolve => { releaseReads = resolve; });
  function gatedJournal(journal) {
    return {
      ...journal,
      async get(key) {
        const value = await journal.get(key);
        if (value === null) {
          emptyReads += 1;
          if (emptyReads === 2) releaseReads();
          await bothRead;
        }
        return value;
      },
    };
  }
  let calls = 0;
  const options = {
    autoRetry: false,
    registry: createBaselineImplementationRegistry(),
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'SECRET_SENTINEL_ATOMIC_CONFLICT' },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        return { code: 200 };
      },
    },
  };
  const reporters = baseJournals.map(journal => createListenReporter({
    ...options,
    journal: gatedJournal(journal),
  }));
  t.after(() => reporters.forEach(reporter => reporter.destroy()));

  const results = await Promise.allSettled([
    reporters[0].report(event({
      sessionId: 'atomic-reporter-conflict',
      listenMs: 45_000,
    })),
    reporters[1].report(event({
      sessionId: 'atomic-reporter-conflict',
      listenMs: 46_000,
    })),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejection = results.find(result => result.status === 'rejected');
  assert.equal(rejection.reason.code, 'LISTEN_SESSION_CONFLICT');
  assert.equal(rejection.reason.status, 409);
  assert.equal(calls, 1);
});

test('two child processes sharing a journal execute one provider claim', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-provider-process-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  const callPath = path.join(directory, 'provider-calls.txt');
  const goPath = path.join(directory, 'go');
  const source = `
    const fs = require('node:fs');
    const crypto = require('node:crypto');
    const { createListenJournal } = require('./server/platform/listen-journal');
    const {
      createListenReporter,
      createReportingBinding,
    } = require('./server/platform/listen-reporter');
    const { createBaselineImplementationRegistry } =
      require('./server/platform/implementation-registry');
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    (async () => {
      while (!fs.existsSync(process.env.GO_PATH)) await wait(5);
      const reporter = createListenReporter({
        accountBindingSecret: Buffer.alloc(32, 0x5a),
        registry: createBaselineImplementationRegistry(),
        journal: createListenJournal({ filePath: process.env.JOURNAL_PATH }),
        autoRetry: false,
        accountResolver: async () => ({
          loggedIn: true,
          accountId: 'account-a',
          credentialSnapshot: { cookie: 'child-secret' },
        }),
        providerAdapters: {
          netease: async () => {
            fs.appendFileSync(process.env.CALL_PATH, process.pid + '\\n');
            await wait(50);
            return { code: 200 };
          },
        },
      });
      const result = await reporter.report({
        sessionId: 'child-process-claim',
        confirmedPlayback: true,
        catalogProvider: 'netease',
        playbackProvider: 'netease',
        resolutionMode: 'direct',
        completeness: 'partial',
        sourceIds: { netease: '101' },
        catalogSourceId: '101',
        playbackSourceId: '101',
        listenMs: 45000,
        durationMs: 100000,
        completion: { completed: false, ratio: 0.45 },
        playedAt: 1000,
        context: null,
        reportingBinding: createReportingBinding(
          Buffer.alloc(32, 0x5a),
          'netease',
          'account-a',
        ),
      });
      reporter.destroy();
      process.stdout.write(result.status);
    })().catch(error => {
      process.stderr.write(String(error && error.code || error));
      process.exitCode = 1;
    });
  `;
  const options = {
    env: {
      JOURNAL_PATH: filePath,
      CALL_PATH: callPath,
      GO_PATH: goPath,
    },
  };
  const left = runNode(source, options);
  const right = runNode(source, options);
  await new Promise(resolve => setTimeout(resolve, 100));
  fs.writeFileSync(goPath, 'go');
  const results = await Promise.all([left, right]);
  assert.deepEqual(results.map(result => result.code), [0, 0]);
  assert.equal(
    fs.readFileSync(callPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).length,
    1,
  );
  assert.equal(results.some(result => result.stdout === 'submitted'), true);
});

test('offline event stays bound to its creation account and never uses a switched account cookie', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-account-bound-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 1_000;
  const journal = createListenJournal({
    filePath: path.join(directory, 'listen.json'),
    clock: () => now,
  });
  const calls = [];
  let currentAccount = {
    loggedIn: true,
    accountId: 'account-b',
    credentialSnapshot: { cookie: 'SECRET_SENTINEL_ACCOUNT_B' },
  };
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => currentAccount,
    providerAdapters: {
      netease: async (_payload, context) => {
        calls.push(context.credentialSnapshot.cookie);
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());

  const createdForA = event({
    sessionId: 'offline-account-a',
    reportingBinding: reportingBinding('netease', 'account-a'),
  });
  const first = await reporter.report(createdForA);
  assert.equal(first.status, 'pending');
  assert.equal(calls.length, 0);

  await reporter.flushDue();
  assert.equal(calls.length, 0);

  currentAccount = {
    loggedIn: true,
    accountId: 'account-a',
    credentialSnapshot: { cookie: 'SECRET_SENTINEL_ACCOUNT_A' },
  };
  now = 3_000;
  await reporter.flushDue();
  assert.deepEqual(calls, ['SECRET_SENTINEL_ACCOUNT_A']);
  const stored = Object.values((await journal.snapshot()).entries)[0];
  assert.equal(stored.accountScope, reportingBinding('netease', 'account-a').slice(0, 32));
  assert.equal(Object.hasOwn(stored, 'credentialGeneration'), false);
  assert.doesNotMatch(JSON.stringify(stored), /SECRET_SENTINEL/);
});

test('flushDue is single-flight, respects retry time, and survives restart', async t => {
  let now = 1_000;
  const first = harness(t, {
    clock: () => now,
    failure: Object.assign(new Error('offline'), {
      code: 'ETIMEDOUT',
      retrySafe: true,
    }),
  });
  await first.reporter.report(event({ sessionId: 'retry-session' }));
  assert.equal(first.calls.length, 1);
  await first.reporter.flushDue();
  assert.equal(first.calls.length, 1);
  first.reporter.destroy();

  now = 2_001;
  let calls = 0;
  const restarted = createListenReporter({
    registry: first.registry,
    journal: first.journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        return { code: 200 };
      },
    },
  });
  t.after(() => restarted.destroy());
  await Promise.all([restarted.flushDue(), restarted.flushDue()]);
  assert.equal(calls, 1);
  const values = Object.values((await first.journal.snapshot()).entries);
  assert.equal(values[0].status, 'submitted');
});

test('recursively redacts secret sentinel from journal, results, and diagnostics', async t => {
  const sentinel = 'SECRET_SENTINEL_94f';
  const messages = [];
  const { journal, reporter } = harness(t, {
    failure: Object.assign(new Error(`request failed ${sentinel}`), {
      code: `BAD_${sentinel}`,
    }),
  });
  reporter.onDiagnostic(message => messages.push(message));
  await assert.rejects(() => reporter.report(event({
    cookie: sentinel,
    token: sentinel,
    oauth: { code: sentinel, verifier: sentinel },
    context: {
      type: 'playlist',
      playlistId: 'list-1',
      localPath: `C:\\Users\\Me\\${sentinel}\\song.mp3`,
    },
  })), error => error && error.status === 422);

  assert.doesNotMatch(
    JSON.stringify({ journal: await journal.snapshot(), messages }),
    new RegExp(sentinel),
  );
  assert.deepEqual((await journal.snapshot()).entries, {});
});

test('requires exact catalog and playback source mappings for matched, direct, and local events', async t => {
  const { journal, reporter } = harness(t);
  const candidates = [
    event({
      catalogProvider: 'kugou',
      catalogSourceId: 'kg-1',
      playbackProvider: 'netease',
      playbackSourceId: '202',
      sourceIds: { netease: '202' },
      resolutionMode: 'matched-provider',
    }),
    event({
      catalogSourceId: '101',
      playbackSourceId: '101',
      sourceIds: { netease: 'different' },
    }),
    event({
      catalogProvider: 'local',
      playbackProvider: 'local',
      resolutionMode: 'local',
      catalogSourceId: 'local-1',
      playbackSourceId: 'local-1',
      sourceIds: { local: 'other-local' },
    }),
  ];
  for (const candidate of candidates) {
    await assert.rejects(
      () => reporter.report(candidate),
      error => error && error.code === 'PLAYBACK_SOURCE_ID_INVALID' && error.status === 422,
    );
  }
  assert.deepEqual((await journal.snapshot()).entries, {});
});

test('strictly rejects unknown, secret, accessor, array, and invalid context input', async () => {
  const sentinel = 'SECRET_SENTINEL_CONTEXT';
  const invalid = [
    event({ unknown: 'value' }),
    event({ token: sentinel }),
    event({ sourceIds: ['netease', '101'] }),
    event({ context: [] }),
    event({ context: { playlistId: 'x'.repeat(129) } }),
    event({ context: { playlistId: 'C:\\Users\\name\\playlist' } }),
    event({ context: { playlistId: 'line\u0001break' } }),
    event({ context: { playlistId: 123 } }),
    event({ context: { playlistId: 'ok', unknown: 'value' } }),
  ];
  for (const candidate of invalid) {
    assert.throws(
      () => normalizeListenEvent(candidate),
      error => error && error.status === 422,
    );
  }

  let accessed = false;
  const accessor = event();
  Object.defineProperty(accessor, 'cookie', {
    enumerable: true,
    get() {
      accessed = true;
      return sentinel;
    },
  });
  assert.throws(
    () => normalizeListenEvent(accessor),
    error => error && error.status === 422,
  );
  assert.equal(accessed, false);
});

test('rejects coerced and non-finite numeric fields before journal or provider work', async t => {
  const { calls, journal, reporter } = harness(t);
  const candidates = [
    { listenMs: '45000' },
    { listenMs: true },
    { listenMs: new Number(45_000) },
    { durationMs: '100000' },
    { durationMs: false },
    { durationMs: new Number(100_000) },
    { playedAt: '1000' },
    { playedAt: true },
    { playedAt: new Number(1_000) },
    { listenMs: Number.NaN },
    { durationMs: Number.POSITIVE_INFINITY },
    { playedAt: Number.NEGATIVE_INFINITY },
    { completion: { completed: false, ratio: '0.5' } },
    { completion: { completed: false, ratio: true } },
    { completion: { completed: false, ratio: new Number(0.5) } },
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    await assert.rejects(
      () => reporter.report(event({
        sessionId: `numeric-${index}`,
        ...candidates[index],
      })),
      error => (
        error
        && error.code === 'LISTEN_NUMERIC_FIELD_INVALID'
        && error.status === 422
      ),
    );
  }
  assert.equal(calls.length, 0);
  assert.deepEqual((await journal.snapshot()).entries, {});
});

test('restores a Netease account from persisted credentials after restart and isolates account switches', async t => {
  let now = 1_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-account-restart-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  const registry = createBaselineImplementationRegistry();
  const firstJournal = createListenJournal({ filePath, clock: () => now });
  const credentialA = { cookie: 'MUSIC_U=encrypted-session-a' };
  const first = createListenReporter({
    registry,
    journal: firstJournal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: '10001',
      credentialSnapshot: credentialA,
    }),
    providerAdapters: {
      netease: async () => {
        throw Object.assign(new Error('offline'), {
          code: 'ETIMEDOUT',
          retrySafe: true,
        });
      },
    },
  });
  await first.report(event({
    sessionId: 'restart-a',
    reportingBinding: reportingBinding('netease', '10001'),
  }));
  first.destroy();

  let credential = credentialA;
  let liveAccount = { loggedIn: true, userId: 10001 };
  let liveCalls = 0;
  const resolver = createReportingAccountResolver({
    accountBindingSecret: ACCOUNT_BINDING_SECRET,
    clock: () => now,
    timeoutMs: 50,
    cacheMs: 10_000,
    getCredential: () => credential,
    getPublishedAccount: () => null,
    getLiveAccount: async () => {
      liveCalls += 1;
      return liveAccount;
    },
  });
  const restartedJournal = createListenJournal({ filePath, clock: () => now });
  const submitted = [];
  const restarted = createListenReporter({
    registry,
    journal: restartedJournal,
    clock: () => now,
    autoRetry: false,
    accountResolver: resolver,
    providerAdapters: {
      netease: async payload => {
        submitted.push(payload.sessionId);
        return { code: 200 };
      },
    },
  });
  t.after(() => restarted.destroy());
  now = 2_001;
  await restarted.flushDue();
  assert.deepEqual(submitted, ['restart-a']);
  assert.equal(liveCalls, 1);
  assert.equal(Object.values((await restartedJournal.snapshot()).entries)[0].status, 'submitted');

  const secondPending = await restarted.report(event({
    sessionId: 'switch-a',
    reportingBinding: reportingBinding('netease', '10001'),
  }));
  assert.equal(secondPending.status, 'submitted');
  credential = { cookie: 'MUSIC_U=encrypted-session-b' };
  liveAccount = { loggedIn: true, userId: 10002 };
  const switched = await resolver('netease');
  assert.equal(switched.loggedIn, true);
  assert.equal(switched.accountId, '10002');
  assert.match(switched.reportingBinding, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(switched), /encrypted-session-b/);
  assert.equal(liveCalls, 2);
});

test('a restarted reporter never submits an old account pending entry with a new account credential', async t => {
  let now = 1_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-account-switch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  const registry = createBaselineImplementationRegistry();
  const journal = createListenJournal({ filePath, clock: () => now });
  const original = createListenReporter({
    registry,
    journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async () => {
        throw Object.assign(new Error('offline'), {
          code: 'ETIMEDOUT',
          retrySafe: true,
        });
      },
    },
  });
  await original.report(event({ sessionId: 'old-account-pending' }));
  original.destroy();

  let calls = 0;
  const resolver = createReportingAccountResolver({
    getCredential: () => ({ cookie: 'MUSIC_U=encrypted-session-b' }),
    getPublishedAccount: () => null,
    getLiveAccount: async () => ({ loggedIn: true, userId: 'account-b' }),
  });
  const restarted = createListenReporter({
    registry,
    journal: createListenJournal({ filePath, clock: () => now }),
    clock: () => now,
    autoRetry: false,
    accountResolver: resolver,
    providerAdapters: {
      netease: async () => {
        calls += 1;
        return { code: 200 };
      },
    },
  });
  t.after(() => restarted.destroy());
  now = 2_001;
  await restarted.flushDue();
  assert.equal(calls, 0);
  const saved = await createListenJournal({ filePath, clock: () => now }).snapshot();
  assert.equal(Object.values(saved.entries)[0].status, 'pending');
  assert.equal(Object.values(saved.entries)[0].lastErrorCode, 'ACCOUNT_CHANGED');
});

test('binds the resolved opaque account identity and credential snapshot through provider submission', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-account-race-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let credential = { cookie: 'MUSIC_U=ACCOUNT_A_SECRET' };
  const resolver = createReportingAccountResolver({
    accountBindingSecret: ACCOUNT_BINDING_SECRET,
    getCredential: () => credential,
    getLiveAccount: async (_provider, snapshot) => {
      if (snapshot.cookie.includes('ACCOUNT_A')) {
        credential = { cookie: 'MUSIC_U=ACCOUNT_B_SECRET' };
        return { loggedIn: true, userId: 'account-a' };
      }
      return { loggedIn: true, userId: 'account-b' };
    },
  });
  const cookies = [];
  const adapter = createNeteaseScrobbleAdapter({
    getCredential: () => credential.cookie,
    scrobble: async options => {
      cookies.push(options.cookie);
      return { code: 200 };
    },
  });
  const journal = createListenJournal({
    filePath: path.join(directory, 'listen.json'),
  });
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal,
    autoRetry: false,
    accountResolver: resolver,
    providerAdapters: { netease: adapter },
  });
  t.after(() => reporter.destroy());

  const result = await reporter.report(event({
    sessionId: 'account-race',
    context: { type: 'playlist', playlistId: '303' },
    reportingBinding: reportingBinding('netease', 'account-a'),
  }));
  assert.deepEqual(cookies, ['MUSIC_U=ACCOUNT_A_SECRET']);
  assert.equal(result.status, 'submitted');
  const saved = Object.values((await journal.snapshot()).entries)[0];
  assert.equal(saved.status, 'submitted');
  assert.doesNotMatch(
    JSON.stringify({ result, journal: await journal.snapshot() }),
    /ACCOUNT_[AB]_SECRET/,
  );
});

test('auto retry consumes due failures and emits only a bounded safe diagnostic', async () => {
  const child = await runNode(`
    const { createListenReporter } = require('./server/platform/listen-reporter');
    const { createBaselineImplementationRegistry } = require('./server/platform/implementation-registry');
    let unhandled = 0;
    process.on('unhandledRejection', error => {
      unhandled += 1;
      process.stderr.write('UNHANDLED:' + String(error && error.message));
    });
    const journal = {
      load: async () => ({ version: 2, entries: {} }),
      put: async () => null,
      due: async () => { throw new Error('SECRET_SENTINEL_DUE_FAILURE'); },
    };
    const reporter = createListenReporter({
      registry: createBaselineImplementationRegistry(),
      journal,
      retryPollMs: 250,
    });
    const codes = [];
    reporter.onDiagnostic(code => codes.push(code));
    setTimeout(() => {
      reporter.destroy();
      process.stdout.write(JSON.stringify({ unhandled, codes }));
    }, 40);
  `);
  assert.equal(child.code, 0);
  assert.doesNotMatch(child.stderr, /UNHANDLED|SECRET_SENTINEL/);
  assert.deepEqual(JSON.parse(child.stdout), {
    unhandled: 0,
    codes: ['LISTEN_RETRY_FAILED'],
  });
});

test('times out a provider that never settles as terminal uncertain without a second call', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-provider-timeout-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = createListenJournal({ filePath: path.join(directory, 'listen.json') });
  let signal = null;
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal,
    autoRetry: false,
    providerTimeoutMs: 20,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'SECRET_SENTINEL_TIMEOUT' },
    }),
    providerAdapters: {
      netease: async (_payload, context) => {
        signal = context && context.signal;
        return new Promise(() => {});
      },
    },
  });
  t.after(() => reporter.destroy());

  const result = await Promise.race([
    reporter.report(event({ sessionId: 'never-settle' })),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('report remained pending')),
      150,
    )),
  ]);
  assert.equal(result.status, 'uncertain');
  assert.equal(signal.aborted, true);
  const saved = Object.values((await journal.snapshot()).entries)[0];
  assert.equal(saved.status, 'uncertain');
  assert.equal(saved.lastErrorCode, 'PROVIDER_UNCERTAIN');
  await reporter.flushDue();
  assert.equal(Object.values((await journal.snapshot()).entries)[0].status, 'uncertain');
});

test('provider success followed by markSubmitted failure keeps the durable claim uncertain', async t => {
  let now = 1_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-submit-fault-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const baseJournal = createListenJournal({
    filePath: path.join(directory, 'listen.json'),
    clock: () => now,
  });
  let failSubmitted = true;
  const journal = {
    load: (...args) => baseJournal.load(...args),
    snapshot: (...args) => baseJournal.snapshot(...args),
    get: (...args) => baseJournal.get(...args),
    put: (...args) => baseJournal.put(...args),
    due: (...args) => baseJournal.due(...args),
    claim: (...args) => baseJournal.claim(...args),
    markClaimStarted: (...args) => baseJournal.markClaimStarted(...args),
    markFailure: (...args) => baseJournal.markFailure(...args),
    markUncertain: (...args) => baseJournal.markUncertain(...args),
    async markSubmitted(...args) {
      if (failSubmitted) {
        failSubmitted = false;
        const error = new Error('simulated durable confirmation failure');
        error.code = 'JOURNAL_WRITE_FAILED';
        throw error;
      }
      return baseJournal.markSubmitted(...args);
    },
  };
  let calls = 0;
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal,
    clock: () => now,
    autoRetry: false,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'SECRET_SENTINEL_MARK_SUBMITTED' },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        return { code: 200 };
      },
    },
  });
  t.after(() => reporter.destroy());

  const result = await reporter.report(event({ sessionId: 'submit-fault' }));
  assert.equal(result.status, 'uncertain');
  now = 100_000;
  await reporter.flushDue();
  assert.equal(calls, 1);
  assert.equal(
    Object.values((await baseJournal.snapshot()).entries)[0].status,
    'uncertain',
  );
});

test('destroy aborts and releases an inflight provider report without open work', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-provider-destroy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const journal = createListenJournal({ filePath: path.join(directory, 'listen.json') });
  let signal = null;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal,
    autoRetry: false,
    providerTimeoutMs: 10_000,
    accountResolver: async () => ({
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async (_payload, context) => {
        signal = context && context.signal;
        markStarted();
        return new Promise(() => {});
      },
    },
  });
  const pending = reporter.report(event({ sessionId: 'destroy-provider' }));
  await started;
  reporter.destroy();
  const result = await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('destroy did not release report')),
      150,
    )),
  ]);
  assert.equal(result.status, 'uncertain');
  assert.equal(signal.aborted, true);
});

test('returns a stable conflict for the same account session with a different normalized payload', async t => {
  const { calls, journal, reporter } = harness(t);
  const first = await reporter.report(event({ sessionId: 'conflict-session' }));
  assert.equal(first.status, 'submitted');
  const duplicate = await reporter.report(event({ sessionId: 'conflict-session' }));
  assert.equal(duplicate.duplicate, true);

  await assert.rejects(
    () => reporter.report(event({
      sessionId: 'conflict-session',
      listenMs: 46_000,
      completion: { completed: false, ratio: 0.46 },
    })),
    error => (
      error
      && error.code === 'LISTEN_SESSION_CONFLICT'
      && error.status === 409
    ),
  );
  assert.equal(calls.length, 1);
  const saved = Object.values((await journal.snapshot()).entries)[0];
  assert.match(saved.eventDigest, /^[a-f0-9]{64}$/);
});

test('migrates a digest-less journal entry without conflicting with the same normalized event', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-digest-migrate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'listen.json');
  const legacyEvent = event({
    sessionId: 'legacy-digest',
    confirmedPlayback: undefined,
  });
  const legacyScope = reportingBinding('netease', 'account-a').slice(0, 32);
  const legacyKey = `netease:${legacyScope}:legacy-digest`;
  fs.writeFileSync(filePath, JSON.stringify({
    version: 2,
    entries: {
      [legacyKey]: {
        key: legacyKey,
        provider: 'netease',
        accountScope: legacyScope,
        sessionId: 'legacy-digest',
        status: 'pending',
        attempts: 1,
        nextAttemptAt: 10_000,
        lastErrorCode: 'LOGIN_REQUIRED',
        createdAt: 1_000,
        updatedAt: 1_000,
        event: legacyEvent,
      },
    },
  }));
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal: createListenJournal({ filePath, clock: () => 2_000 }),
    clock: () => 2_000,
    autoRetry: false,
    accountResolver: async () => ({ loggedIn: false, accountId: '' }),
    providerAdapters: {},
  });
  t.after(() => reporter.destroy());

  const duplicate = await reporter.report(event({ sessionId: 'legacy-digest' }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, 'pending');
});

test('single-flight rejects a concurrent different digest and shares an identical payload', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-inflight-digest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let releaseProvider;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const providerResult = new Promise(resolve => { releaseProvider = resolve; });
  let calls = 0;
  const reporter = createListenReporter({
    registry: createBaselineImplementationRegistry(),
    journal: createListenJournal({ filePath: path.join(directory, 'listen.json') }),
    autoRetry: false,
    accountResolver: async provider => ({
      provider,
      loggedIn: true,
      accountId: 'account-a',
      credentialSnapshot: { cookie: 'cookie-a' },
    }),
    providerAdapters: {
      netease: async () => {
        calls += 1;
        markStarted();
        return providerResult;
      },
    },
  });
  t.after(() => reporter.destroy());
  const original = event({ sessionId: 'concurrent-digest' });
  const first = reporter.report(original);
  await started;
  const identical = reporter.report({ ...original });
  const conflict = reporter.report(event({
    sessionId: 'concurrent-digest',
    listenMs: 46_000,
    completion: { completed: false, ratio: 0.46 },
  }));

  let conflictAssertion = null;
  try {
    await assert.rejects(
      Promise.race([
        conflict,
        new Promise((_, reject) => setTimeout(() => {
          const error = new Error('concurrent conflict was not rejected');
          error.code = 'TEST_CONFLICT_TIMEOUT';
          reject(error);
        }, 50)),
      ]),
      error => (
        error
        && error.code === 'LISTEN_SESSION_CONFLICT'
        && error.status === 409
      ),
    );
  } catch (error) {
    conflictAssertion = error;
  } finally {
    releaseProvider({ code: 200 });
  }
  const settled = await Promise.allSettled([first, identical, conflict]);
  if (conflictAssertion) throw conflictAssertion;
  const firstResult = settled[0].value;
  const identicalResult = settled[1].value;
  assert.equal(firstResult.status, 'submitted');
  assert.equal(identicalResult.status, 'submitted');
  assert.equal(calls, 1);
});
