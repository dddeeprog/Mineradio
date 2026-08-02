'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CREDENTIAL_SESSION_SCHEMA,
  CREDENTIAL_SESSION_PROVIDERS,
  createCredentialSession,
  createCredentialSessionHost,
} = require('../server/platform/credential-session');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

test('hydrates all credentials before exposing defensive reads', () => {
  const session = createCredentialSession({ mode: 'encrypted' });
  const input = {
    netease: {
      cookie: 'MUSIC_U=secret',
      accountId: '163-user',
    },
    spotify: {
      refreshToken: 'spotify-secret',
      accountId: 'spotify-user',
    },
  };

  assert.equal(session.diagnostics().state, 'cold');
  assert.throws(() => session.read('netease'), {
    code: 'CREDENTIAL_SESSION_NOT_HYDRATED',
  });

  session.hydrate(input);
  input.netease.cookie = 'changed-outside';
  const first = session.read('netease');
  first.cookie = 'changed-read';

  assert.equal(session.read('netease').cookie, 'MUSIC_U=secret');
  assert.equal(session.read('qq'), null);
  assert.deepEqual(session.diagnostics(), {
    schema: CREDENTIAL_SESSION_SCHEMA,
    state: 'ready',
    mode: 'encrypted',
    revision: 1,
    providers: [
      {
        provider: 'netease',
        hasCredential: true,
        accountId: '163-user',
        revision: 1,
      },
      {
        provider: 'spotify',
        hasCredential: true,
        accountId: 'spotify-user',
        revision: 1,
      },
    ],
  });
  assert.equal(JSON.stringify(session.diagnostics()).includes('secret'), false);
});

test('credential session host accepts one hydrated session and rejects replacement', () => {
  const host = createCredentialSessionHost();
  const cold = createCredentialSession({ mode: 'encrypted' });
  const ready = createCredentialSession({ mode: 'memory-only' });
  ready.hydrate({});

  assert.equal(host.get(), null);
  assert.throws(() => host.attach(cold), {
    code: 'CREDENTIAL_SESSION_HOST_NOT_READY',
  });
  assert.equal(host.get(), null);

  assert.equal(host.attach(ready), ready);
  assert.equal(host.attach(ready), ready);
  assert.equal(host.get(), ready);
  assert.throws(
    () => {
      const replacement = createCredentialSession();
      replacement.hydrate({});
      host.attach(replacement);
    },
    { code: 'CREDENTIAL_SESSION_HOST_ALREADY_ATTACHED' },
  );
  assert.deepEqual(Object.keys(host).sort(), ['attach', 'get']);
  assert.equal(Object.isFrozen(host), true);
});

test('replace persists before publishing a value-free event', async () => {
  const order = [];
  const persisted = new Map();
  const session = createCredentialSession({
    mode: 'encrypted',
    async persistCredential(provider, credential, metadata) {
      order.push(`persist:${provider}:${metadata.revision}`);
      persisted.set(provider, structuredClone(credential));
      return { persisted: true, mode: 'encrypted' };
    },
  });
  session.hydrate({});
  const events = [];
  session.subscribe((event) => {
    order.push(`event:${event.provider}:${event.revision}`);
    events.push(event);
  });

  const result = await session.replace('qq', {
    cookie: 'uin=10001; qm_keyst=secret',
    accountId: 10001,
  });

  assert.deepEqual(order, ['persist:qq:2', 'event:qq:2']);
  assert.equal(persisted.get('qq').cookie, 'uin=10001; qm_keyst=secret');
  assert.deepEqual(result, {
    provider: 'qq',
    persisted: true,
    mode: 'encrypted',
    revision: 2,
  });
  assert.deepEqual(events, [{
    type: 'replaced',
    provider: 'qq',
    hasCredential: true,
    accountId: 10001,
    revision: 2,
  }]);
  assert.equal(JSON.stringify(events).includes('qm_keyst'), false);
});

test('replace forwards a validated migration marker only to the persistence sink', async () => {
  const migrationId = 'a'.repeat(64);
  let persistenceMetadata = null;
  const events = [];
  const session = createCredentialSession({
    mode: 'encrypted',
    async persistCredential(_provider, _credential, metadata) {
      persistenceMetadata = metadata;
      return { persisted: true, mode: 'encrypted' };
    },
  });
  session.hydrate({});
  session.subscribe(event => events.push(event));

  const result = await session.replace(
    'netease',
    { accountId: 'imported-user', cookie: 'MUSIC_U=migration-secret' },
    { migrationId },
  );

  assert.deepEqual(persistenceMetadata, { revision: 2, migrationId });
  assert.equal(Object.isFrozen(persistenceMetadata), true);
  assert.equal(JSON.stringify(result).includes(migrationId), false);
  assert.equal(JSON.stringify(events).includes(migrationId), false);
  assert.equal(JSON.stringify(session.diagnostics()).includes(migrationId), false);

  await assert.rejects(
    session.replace(
      'netease',
      { cookie: 'MUSIC_U=invalid-marker-secret' },
      { migrationId: 'invalid-marker' },
    ),
    error => error.code === 'CREDENTIAL_SESSION_INVALID_MIGRATION_ID'
      && !JSON.stringify(error, Object.getOwnPropertyNames(error))
        .includes('invalid-marker-secret'),
  );
  assert.equal(session.read('netease').cookie, 'MUSIC_U=migration-secret');
});

test('replace rollback keeps the previous credential and revision', async () => {
  const session = createCredentialSession({
    mode: 'encrypted',
    async persistCredential() {
      throw new Error('disk failed while writing super-secret');
    },
  });
  session.hydrate({
    netease: {
      cookie: 'MUSIC_U=old-secret',
      accountId: 'old-user',
    },
  });
  const events = [];
  session.subscribe(event => events.push(event));

  await assert.rejects(
    session.replace('netease', {
      cookie: 'MUSIC_U=new-secret',
      accountId: 'new-user',
    }),
    error => {
      assert.equal(error.code, 'CREDENTIAL_SESSION_PERSIST_FAILED');
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );

  assert.equal(session.read('netease').cookie, 'MUSIC_U=old-secret');
  assert.equal(session.diagnostics().revision, 1);
  assert.deepEqual(events, []);
});

test('concurrent replacements commit in invocation order', async () => {
  const firstWrite = deferred();
  const calls = [];
  const session = createCredentialSession({
    mode: 'encrypted',
    async persistCredential(_provider, credential, metadata) {
      calls.push([credential.cookie, metadata.revision]);
      if (credential.cookie === 'first') await firstWrite.promise;
      return { persisted: true, mode: 'encrypted' };
    },
  });
  session.hydrate({});

  const first = session.replace('netease', { cookie: 'first' });
  const second = session.replace('netease', { cookie: 'second' });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, [['first', 2]]);
  firstWrite.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [
    ['first', 2],
    ['second', 3],
  ]);
  assert.equal(session.read('netease').cookie, 'second');
  assert.equal(session.diagnostics().revision, 3);
});

test('conditional replacement refuses a credential revision cleared while refresh was pending', async () => {
  const persisted = [];
  const session = createCredentialSession({
    async persistCredential(_provider, credential) {
      persisted.push(credential.accessToken);
      return { persisted: true, mode: 'memory-only' };
    },
  });
  session.hydrate({
    spotify: {
      accessToken: 'expired-access',
      refreshToken: 'refresh-token',
    },
  });

  assert.equal(typeof session.readWithRevision, 'function');
  assert.equal(typeof session.replaceIfRevision, 'function');
  const snapshot = session.readWithRevision('spotify');
  await session.clear('spotify');
  const result = await session.replaceIfRevision(
    'spotify',
    snapshot.revision,
    { accessToken: 'stale-refreshed-access' },
  );

  assert.deepEqual(result, {
    provider: 'spotify',
    replaced: false,
    revision: 2,
  });
  assert.equal(session.read('spotify'), null);
  assert.deepEqual(persisted, []);
});

test('clear persists deletion before removing memory and can roll back', async () => {
  let fail = true;
  const calls = [];
  const session = createCredentialSession({
    mode: 'encrypted',
    async clearCredential(provider, metadata) {
      calls.push([provider, metadata.revision]);
      if (fail) throw new Error('delete failed');
      return { persisted: true, mode: 'encrypted' };
    },
  });
  session.hydrate({
    qishui: {
      token: 'qishui-secret',
      accountId: 'qishui-user',
    },
  });

  await assert.rejects(session.clear('qishui'), {
    code: 'CREDENTIAL_SESSION_CLEAR_FAILED',
  });
  assert.equal(session.read('qishui').token, 'qishui-secret');
  assert.equal(session.diagnostics().revision, 1);

  fail = false;
  const result = await session.clear('qishui');
  assert.deepEqual(calls, [
    ['qishui', 2],
    ['qishui', 2],
  ]);
  assert.deepEqual(result, {
    provider: 'qishui',
    persisted: true,
    mode: 'encrypted',
    revision: 2,
    cleared: true,
  });
  assert.equal(session.read('qishui'), null);
});

test('subscription can be removed and listener failures do not roll back state', async () => {
  const session = createCredentialSession({ mode: 'memory-only' });
  session.hydrate({});
  let calls = 0;
  const unsubscribe = session.subscribe(() => {
    calls += 1;
    throw new Error('listener failure');
  });

  await session.replace('kugou', { cookie: 'kg-secret' });
  unsubscribe();
  await session.clear('kugou');

  assert.equal(calls, 1);
  assert.equal(session.read('kugou'), null);
});

test('rejects invalid providers and credentials without echoing values', async () => {
  const session = createCredentialSession();
  session.hydrate({});
  const secret = 'MUSIC_U=must-not-leak';

  assert.deepEqual(CREDENTIAL_SESSION_PROVIDERS, [
    'netease',
    'qq',
    'kugou',
    'qishui',
    'spotify',
  ]);
  assert.equal(Object.isFrozen(CREDENTIAL_SESSION_PROVIDERS), true);
  assert.throws(() => session.read('unknown'), {
    code: 'CREDENTIAL_SESSION_PROVIDER_UNSUPPORTED',
  });
  await assert.rejects(
    session.replace('netease', { cookie: secret, nested: new Map() }),
    error => {
      assert.equal(error.code, 'CREDENTIAL_SESSION_INVALID_CREDENTIAL');
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.throws(
    () => session.hydrate({ unknown: { token: secret } }),
    error => {
      assert.equal(error.code, 'CREDENTIAL_SESSION_ALREADY_HYDRATED');
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test('package check validates the credential session module', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts.check,
    /node --check server\/platform\/credential-session\.js/,
  );
});
